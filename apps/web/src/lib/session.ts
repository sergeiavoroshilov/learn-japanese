import { MicSource } from './audio';
import type { KanaCard } from './kana';
import { KeyboardSource } from './keyboard';
import { expectedFor } from './match';
import { OnsetDetector, type OnsetSource } from './onset';
import { VoskRecognizer, type GrammarMode } from './vosk';
import {
  WebSpeechRecognizer,
  type DrillRecognizer,
  type Hypothesis,
  type MatchRule,
  type RecognizerEvents,
} from './recognizer';

export type CardStatus = 'match' | 'late' | 'timeout' | 'skipped';

export interface CardOutcome {
  index: number;
  card: KanaCard;
  /** ms from card shown to the user starting to speak (mic energy). */
  onsetMs: number | null;
  /**
   * How long the answer itself lasted, by mic energy. A card the decoder
   * ignored entirely is usually a very short one.
   */
  speechMs: number | null;
  /** ms from card shown to the engine reporting a matching hypothesis. */
  matchMs: number | null;
  /** Engine overhead: matchMs − onsetMs. The number that decides variant A. */
  asrLagMs: number | null;
  status: CardStatus;
  matchedTranscript: string | null;
  /** Whether the match was exact or only a substring. */
  exact: boolean | null;
  /**
   * The engine got this card right, but only after the drill had moved on.
   * Kept separate from a match: correct-but-too-slow is a latency problem,
   * not an accuracy one, and the two need different fixes.
   */
  lateMs: number | null;
  /** Everything the engine said for this card, in order. */
  hypotheses: Hypothesis[];
  /** What the parallel deck-wide decoder heard, when it was running. */
  witnessHeard: string[];
}

export type Engine = 'webspeech' | 'vosk' | 'mock';

export interface SessionSnapshot {
  status: 'idle' | 'starting' | 'running' | 'done' | 'error';
  /** What a slow start is currently doing (model download, warm-up). */
  statusText: string;
  cardIndex: number;
  totalCards: number;
  current: KanaCard | null;
  /** Set briefly after a match so the UI can flash green. */
  lastStatus: CardStatus | null;
  liveHypotheses: Hypothesis[];
  liveOnsetMs: number | null;
  outcomes: CardOutcome[];
  listening: boolean;
  error: string | null;
  recognizerName: string;
}

export interface SessionOptions {
  cards: KanaCard[];
  timeoutMs: number;
  rule: MatchRule;
  /** Pause between a match and the next card. Keep it short — this is a flow drill. */
  interCardMs?: number;
  engine: Engine;
  /** Commit the decoder as soon as our VAD hears the answer end. */
  flushOnSilence?: boolean;
  /** How tightly the Vosk decoder is constrained. */
  grammarMode?: GrammarMode;
  /** Every mora of this session, for deck-wide grammar. */
  deckVocabulary?: string[];
  /** Log a deck-wide decoder's opinion alongside per-card grammar. */
  witness?: boolean;
  onUpdate(snapshot: SessionSnapshot): void;
}

export class DrillSession {
  private recognizer: DrillRecognizer;
  private detector: OnsetSource;

  private mic: MicSource | null = null;
  private status: SessionSnapshot['status'] = 'idle';
  private statusText = '';
  private cardIndex = -1;
  private outcomes: CardOutcome[] = [];
  private liveHypotheses: Hypothesis[] = [];
  private liveOnsetMs: number | null = null;
  private liveSpeechMs: number | null = null;
  private liveWitness: string[] = [];
  private lastStatus: CardStatus | null = null;
  private listening = false;
  private error: string | null = null;

  private shownAt = 0;
  private timeoutTimer: number | null = null;
  private advanceTimer: number | null = null;
  private readonly interCardMs: number;

  constructor(private readonly opts: SessionOptions) {
    this.interCardMs = opts.interCardMs ?? 220;
    const events: RecognizerEvents = {
      onHypothesis: (h) => {
        this.liveHypotheses = [...this.liveHypotheses, h];
        this.emit();
      },
      onMatch: (h) => this.finishCard('match', h),
      onLateMatch: (h) => this.recordLateMatch(h),
      onWitness: (transcript) => {
        this.liveWitness = [...this.liveWitness, transcript];
      },
      onError: (err) => {
        this.error = err;
        this.emit();
      },
      onListening: (listening) => {
        this.listening = listening;
        this.emit();
      },
    };

    if (opts.engine === 'mock') {
      // One object plays both roles: the keystroke is both the answer and the
      // onset, so no microphone is involved.
      const keyboard = new KeyboardSource(events, opts.rule);
      this.recognizer = keyboard;
      this.detector = keyboard;
    } else {
      this.detector = new OnsetDetector();
      // Our VAD hears the mora end long before Kaldi's sentence-tuned
      // endpointing does; committing there is the difference between a
      // ~2 s answer and an instant one.
      this.detector.onSpeechEnd((speechMs) => {
        this.liveSpeechMs = speechMs;
        if (this.opts.flushOnSilence !== false) this.recognizer.flush?.();
      });
      this.recognizer =
        opts.engine === 'vosk'
          ? new VoskRecognizer(events, opts.rule, {
              mode: opts.grammarMode ?? 'deck',
              deckVocabulary: opts.deckVocabulary ?? [],
              witness: opts.witness,
              onStatus: (text) => {
                this.statusText = text;
                this.emit();
              },
            })
          : new WebSpeechRecognizer(events, opts.rule);
    }
  }

  get micLevel(): number {
    return this.detector.level;
  }

  get micThreshold(): number {
    return this.detector.threshold;
  }

  async start(): Promise<void> {
    this.status = 'starting';
    this.emit();
    try {
      if (this.opts.engine !== 'mock') {
        this.mic = new MicSource();
        // Vosk models are trained at 16 kHz; asking for it avoids resampling.
        await this.mic.start(this.opts.engine === 'vosk' ? 16000 : undefined);
      }
      await this.detector.start(this.mic);
      await this.recognizer.start(this.mic);
    } catch (err) {
      this.status = 'error';
      this.error = err instanceof Error ? err.message : String(err);
      this.emit();
      return;
    }
    this.status = 'running';
    this.cardIndex = -1;
    this.outcomes = [];
    this.nextCard();
  }

  /** User gave up on the current card. */
  skip(): void {
    if (this.status !== 'running') return;
    this.finishCard('skipped', null);
  }

  stop(): void {
    this.clearTimers();
    this.recognizer.stop();
    this.detector.stop();
    this.mic?.stop();
    this.mic = null;
    if (this.status === 'running' || this.status === 'starting') {
      this.status = this.outcomes.length > 0 ? 'done' : 'idle';
    }
    this.emit();
  }

  private nextCard(): void {
    this.cardIndex++;
    const card = this.opts.cards[this.cardIndex];
    if (!card) {
      this.status = 'done';
      this.recognizer.stop();
      this.detector.stop();
      this.mic?.stop();
      this.mic = null;
      this.emit();
      return;
    }

    this.liveHypotheses = [];
    this.liveOnsetMs = null;
    this.liveSpeechMs = null;
    this.liveWitness = [];
    this.lastStatus = null;
    this.shownAt = performance.now();

    this.detector.arm((onsetMs) => {
      this.liveOnsetMs = onsetMs;
      this.emit();
    });
    this.recognizer.expect(expectedFor(card), this.shownAt);

    this.timeoutTimer = window.setTimeout(() => this.finishCard('timeout', null), this.opts.timeoutMs);
    this.emit();
  }

  private finishCard(status: CardStatus, match: Hypothesis | null): void {
    const card = this.opts.cards[this.cardIndex];
    if (!card || this.status !== 'running') return;

    this.clearTimers();
    this.recognizer.disarm();
    this.detector.disarm();
    // Never carry one card's audio into the next card's decode.
    this.recognizer.flush?.();

    const matchMs = match?.atMs ?? null;
    const onsetMs = this.liveOnsetMs;
    this.outcomes = [
      ...this.outcomes,
      {
        index: this.cardIndex,
        card,
        onsetMs,
        speechMs: this.liveSpeechMs,
        matchMs,
        asrLagMs: matchMs !== null && onsetMs !== null ? matchMs - onsetMs : null,
        status,
        matchedTranscript: match?.transcript ?? null,
        exact: match ? match.verdict.exact : null,
        lateMs: null,
        hypotheses: this.liveHypotheses,
        witnessHeard: this.liveWitness,
      },
    ];
    this.lastStatus = status;
    this.emit();

    this.advanceTimer = window.setTimeout(() => this.nextCard(), this.interCardMs);
  }

  /** The previous card's answer arrived after we gave up on it. */
  private recordLateMatch(hypothesis: Hypothesis): void {
    const index = this.outcomes.length - 1;
    const previous = this.outcomes[index];
    if (!previous || previous.status === 'match' || previous.status === 'late') return;

    this.outcomes = [
      ...this.outcomes.slice(0, index),
      {
        ...previous,
        status: 'late',
        lateMs: hypothesis.atMs,
        matchedTranscript: hypothesis.transcript,
        exact: hypothesis.verdict.exact,
      },
    ];
    this.emit();
  }

  private clearTimers(): void {
    if (this.timeoutTimer !== null) window.clearTimeout(this.timeoutTimer);
    if (this.advanceTimer !== null) window.clearTimeout(this.advanceTimer);
    this.timeoutTimer = null;
    this.advanceTimer = null;
  }

  private emit(): void {
    this.opts.onUpdate({
      status: this.status,
      statusText: this.statusText,
      cardIndex: this.cardIndex,
      totalCards: this.opts.cards.length,
      current: this.opts.cards[this.cardIndex] ?? null,
      lastStatus: this.lastStatus,
      liveHypotheses: this.liveHypotheses,
      liveOnsetMs: this.liveOnsetMs,
      outcomes: this.outcomes,
      listening: this.listening,
      error: this.error,
      recognizerName: this.recognizer.name,
    });
  }
}
