import type { MicSource } from './audio';
import { judge, type Expected, type MatchVerdict } from './match';

export interface Hypothesis {
  /** Raw text as the engine returned it. */
  transcript: string;
  /**
   * Which decoder said it: the per-card one, or the deck-wide control running
   * alongside. Kept so the two can be counted separately after the fact.
   */
  source?: 'card' | 'deck';
  /** ms since the card was shown. */
  atMs: number;
  final: boolean;
  verdict: MatchVerdict;
  /**
   * What the decoder reported about the audio it actually consumed, when it
   * says so (final results only). `conf` is Kaldi's confidence; `spanMs` is
   * how much audio the hypothesis covers.
   *
   * The span is the diagnostic that matters: compared against the VAD's own
   * measurement of the answer, it separates «the decoder heard the whole
   * sound and rejected it» from «the decoder only got a fragment».
   */
  conf?: number;
  spanMs?: number;
}

export interface RecognizerEvents {
  /** Any hypothesis for the current card — matching or not. Logged verbatim. */
  onHypothesis(h: Hypothesis): void;
  /** First hypothesis that satisfies the current match rule. */
  onMatch(h: Hypothesis): void;
  /**
   * The answer to the PREVIOUS card, arriving after it had already been given
   * up on. Recorded against that card instead of counting as a miss here —
   * otherwise a slow engine looks like an inaccurate one.
   */
  onLateMatch(h: Hypothesis): void;
  /**
   * A parallel decoder that decides nothing and only reports what it heard.
   * In per-card grammar mode it is the check on false accepts: a decoder that
   * knows a single word can force any sound into it.
   */
  onWitness?(transcript: string): void;
  onError(error: string): void;
  /** Engine started/stopped listening (Chrome restarts on its own). */
  onListening(listening: boolean): void;
}

/**
 * The one interface the drill talks to. A second implementation (OpenAI
 * streaming transcription) can drop in behind it — see docs/TECH.md.
 */
export interface DrillRecognizer {
  readonly name: string;
  /** @param mic shared capture; null when the engine needs no audio (mock). */
  start(mic: MicSource | null): Promise<void>;
  /** Arm for a new card; resets the "already matched" latch. */
  expect(expected: Expected, shownAt: number): void;
  /** Stop matching without tearing the engine down (between cards). */
  disarm(): void;
  /**
   * Ask the engine to commit what it has right now. The drill calls this when
   * its own VAD hears the answer end, rather than waiting for the engine's
   * endpointing, which is tuned for sentences.
   */
  flush?(): void;
  stop(): void;
}

export type MatchRule = 'exact' | 'contains';

export function isWebSpeechSupported(): boolean {
  return Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition);
}

/**
 * Web Speech API recognizer (variant A in docs/TECH.md).
 *
 * Runs one continuous session for the whole drill and swaps the expected
 * reading between cards, because starting recognition per card costs a
 * connection setup we cannot afford in a speed drill. Results accumulate
 * across the session, so each card only looks at results produced after it
 * was shown.
 */
export class WebSpeechRecognizer implements DrillRecognizer {
  readonly name = 'Web Speech API';

  private recognition: SpeechRecognition | null = null;
  private running = false;
  private expected: Expected | null = null;
  private shownAt = 0;
  private matched = false;
  private baseIndex = 0;
  private seen = new Set<string>();

  constructor(
    private readonly events: RecognizerEvents,
    private readonly rule: MatchRule,
    private readonly lang = 'ja-JP',
  ) {}

  async start(_mic: MicSource | null): Promise<void> {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) throw new Error('Web Speech API недоступен в этом браузере');

    this.running = true;
    this.spawn(Ctor);
  }

  private spawn(Ctor: typeof SpeechRecognition): void {
    const recognition = new Ctor();
    recognition.lang = this.lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;

    recognition.onstart = () => this.events.onListening(true);
    recognition.onresult = (event) => this.handleResult(event);
    recognition.onerror = (event) => {
      // `no-speech` and `aborted` are routine in a drill; surface the rest.
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        this.events.onError(event.error);
      }
    };
    recognition.onend = () => {
      this.events.onListening(false);
      if (!this.running) return;
      // Chrome ends the session after a silence; keep the drill alive.
      this.baseIndex = 0;
      this.spawn(Ctor);
    };

    this.recognition = recognition;
    this.baseIndex = 0;
    try {
      recognition.start();
    } catch (err) {
      this.events.onError(String(err));
    }
  }

  expect(expected: Expected, shownAt: number): void {
    this.expected = expected;
    this.shownAt = shownAt;
    this.matched = false;
    this.seen.clear();
    // Ignore everything the engine produced for previous cards.
    this.baseIndex = this.lastResultCount;
  }

  disarm(): void {
    this.expected = null;
  }

  stop(): void {
    this.running = false;
    this.expected = null;
    const recognition = this.recognition;
    this.recognition = null;
    recognition?.abort();
  }

  private lastResultCount = 0;

  private handleResult(event: SpeechRecognitionEvent): void {
    this.lastResultCount = event.results.length;
    const expected = this.expected;
    if (!expected) return;

    const atMs = Math.round(performance.now() - this.shownAt);

    for (let i = Math.max(this.baseIndex, event.resultIndex); i < event.results.length; i++) {
      const result = event.results[i];
      for (let a = 0; a < result.length; a++) {
        const transcript = result[a].transcript.trim();
        if (!transcript) continue;

        const key = `${i}:${a}:${transcript}:${result.isFinal}`;
        if (this.seen.has(key)) continue;
        this.seen.add(key);

        const verdict = judge(transcript, expected);
        const hypothesis: Hypothesis = { transcript, atMs, final: result.isFinal, verdict };
        this.events.onHypothesis(hypothesis);

        if (!this.matched && (this.rule === 'exact' ? verdict.exact : verdict.contains)) {
          this.matched = true;
          this.events.onMatch(hypothesis);
          return;
        }
      }
    }
  }
}
