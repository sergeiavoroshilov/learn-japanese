import * as voskModule from 'vosk-browser';
import type { KaldiRecognizer, Model } from 'vosk-browser';
import type { MicSource } from './audio';
import { judge, type Expected } from './match';
import type { DrillRecognizer, Hypothesis, MatchRule, RecognizerEvents } from './recognizer';

/**
 * vosk-browser ships a UMD bundle. Depending on who does the interop, the API
 * arrives either as named exports or under `default` — Vite's dev-time dep
 * optimizer produces the latter, and a named import would be `undefined` at
 * runtime while still typechecking. Normalise once, here.
 */
const vosk = ((voskModule as { default?: typeof voskModule }).default ??
  voskModule) as typeof voskModule;

export const VOSK_MODEL_URL = '/models/vosk-model-small-ja-0.22.tar.gz';

/**
 * Moras absent from vosk-model-small-ja-0.22's lexicon (checked against
 * graph/words.txt: 46/46 basic and 25/25 dakuten are present, these three are
 * not). A grammar may only list words the model knows, so cards for these are
 * dropped from a grammar-restricted session rather than left silently
 * unmatchable.
 */
export const VOSK_OOV_KANA = ['びゃ', 'ぴゃ', 'ぴょ'];

/**
 * How tightly the decoder is constrained.
 *
 * - `deck` — every mora in the session (46 for basic kana). The decoder cannot
 *   answer «部屋» to へ, but it can still confuse く with こ.
 * - `card` — only the expected mora plus `[unk]`. The question becomes
 *   "did you say this, yes or no?", which is what the drill actually asks.
 *   Minimal pairs stop competing; the risk moves to false accepts.
 * - `none` — free recognition, the control group.
 */
export type GrammarMode = 'deck' | 'card' | 'none';

export interface VoskOptions {
  mode: GrammarMode;
  /** Every mora of the session; used by `deck` mode. */
  deckVocabulary: string[];
  /** Run a deck-wide decoder alongside `card` mode, purely to log its opinion. */
  witness?: boolean;
  /**
   * Let that control decoder also accept an answer. Two decoders constrained
   * differently fail on different sounds, so the union recovers cards the
   * single-word one refuses — while a wrong answer still has to fool both.
   */
  acceptFromWitness?: boolean;
  onStatus?(text: string): void;
}

/**
 * Vosk (Kaldi) recognizer running in-page via WebAssembly.
 *
 * Two properties matter here and neither is about accuracy: the decoder can be
 * constrained to a word list, and it runs locally, so there is no per-minute
 * cost for a drill that is mostly microphone time.
 */
export class VoskRecognizer implements DrillRecognizer {
  readonly name: string;

  private model: Model | null = null;
  private recognizer: KaldiRecognizer | null = null;
  private current: { expected: Expected; shownAt: number } | null = null;
  /**
   * The card before this one. Vosk often commits an answer just after the
   * drill has moved on; judged against this, such a result is recorded as a
   * late answer to the right card instead of a wrong one to the next.
   */
  private previous: { expected: Expected; shownAt: number } | null = null;
  /** False between cards: results then belong to the card that just closed. */
  private armed = false;
  private matched = false;
  private seen = new Set<string>();

  private mic: MicSource | null = null;
  private witness: KaldiRecognizer | null = null;

  constructor(
    private readonly events: RecognizerEvents,
    private readonly rule: MatchRule,
    private readonly opts: VoskOptions,
  ) {
    this.name =
      opts.mode === 'card'
        ? 'Vosk (словарь из одной ожидаемой моры)'
        : opts.mode === 'deck'
          ? `Vosk (словарь из ${opts.deckVocabulary.length} мор)`
          : 'Vosk (свободное распознавание)';
  }

  async start(mic: MicSource | null): Promise<void> {
    if (!mic) throw new Error('Vosk требует микрофон');
    this.mic = mic;

    // A missing model file otherwise surfaces as an opaque worker failure.
    const head = await fetch(VOSK_MODEL_URL, { method: 'HEAD' });
    if (!head.ok) {
      throw new Error(
        `Модель не найдена по ${VOSK_MODEL_URL} — запустите: bun run fetch:model`,
      );
    }

    this.opts.onStatus?.('загружаю модель (~48 МБ, первый раз дольше)…');
    this.model = await vosk.createModel(VOSK_MODEL_URL);

    this.opts.onStatus?.('готовлю распознаватель…');
    if (this.opts.mode !== 'card') {
      this.recognizer = this.spawn(
        this.opts.mode === 'deck' ? this.opts.deckVocabulary : null,
      );
    } else if (this.opts.witness && this.opts.deckVocabulary.length > 0) {
      this.witness = this.spawnWitness(this.opts.deckVocabulary);
    }

    // Audio is routed to whichever recognizer is current: in per-card mode a
    // fresh one is built for every card.
    mic.onChunk((chunk, sampleRate) => {
      this.recognizer?.acceptWaveformFloat(chunk, sampleRate);
      this.witness?.acceptWaveformFloat(chunk, sampleRate);
    });

    this.opts.onStatus?.('');
    this.events.onListening(true);
  }

  /** Deck-wide decoder whose output is recorded but never matched against. */
  private spawnWitness(words: string[]): KaldiRecognizer | null {
    const model = this.model;
    const mic = this.mic;
    if (!model || !mic) return null;
    const recognizer = new model.KaldiRecognizer(mic.sampleRate, JSON.stringify([...words, '[unk]']));
    recognizer.on('result', (message) => {
      if (!('result' in message) || !('text' in message.result)) return;
      const text = message.result.text.trim();
      if (!text) return;
      this.events.onWitness?.(text);
      if (this.opts.acceptFromWitness) this.handle(text, true, 'deck');
    });
    return recognizer;
  }

  /** Builds a recognizer whose vocabulary is `words`, or unrestricted if null. */
  private spawn(words: string[] | null): KaldiRecognizer | null {
    const model = this.model;
    const mic = this.mic;
    if (!model || !mic) return null;

    // "[unk]" gives the decoder somewhere to put anything that is not a listed
    // mora, instead of forcing a wrong one.
    const grammar = words ? JSON.stringify([...words, '[unk]']) : undefined;
    const recognizer = new model.KaldiRecognizer(mic.sampleRate, grammar);

    recognizer.on('partialresult', (message) => {
      if ('result' in message && 'partial' in message.result) {
        this.handle(message.result.partial, false, 'card');
      }
    });
    recognizer.on('result', (message) => {
      if ('result' in message && 'text' in message.result) {
        this.handle(message.result.text, true, 'card');
      }
    });
    recognizer.on('error', (message) => {
      if ('error' in message) this.events.onError(message.error);
    });
    return recognizer;
  }

  expect(expected: Expected, shownAt: number): void {
    this.previous = this.current;
    this.current = { expected, shownAt };
    this.armed = true;
    this.matched = false;
    this.seen.clear();

    if (this.opts.mode === 'card') {
      // accept[0] is the kana itself — the only form the model has as a word.
      const previous = this.recognizer;
      this.recognizer = this.spawn([expected.accept[0]]);
      previous?.remove();
    }
  }

  /**
   * Commit the current utterance and reset the decoder. Called when the drill's
   * VAD hears the answer end and whenever a card closes, so each card is
   * decoded on its own — earlier this class trimmed the previous card's text
   * off the partial by length, which cut mid-token and produced «unk]».
   */
  flush(): void {
    this.recognizer?.retrieveFinalResult();
    this.witness?.retrieveFinalResult();
  }

  disarm(): void {
    // Keep the card itself: an answer landing in the gap between cards is a
    // late answer to it, not noise.
    this.armed = false;
  }

  stop(): void {
    this.witness?.remove();
    this.witness = null;
    this.armed = false;
    this.current = null;
    this.previous = null;
    this.recognizer?.remove();
    this.recognizer = null;
    this.model?.terminate();
    this.model = null;
    this.events.onListening(false);
  }

  private handle(rawText: string, final: boolean, source: 'card' | 'deck'): void {
    const transcript = rawText.trim();
    if (!transcript || !this.current) return;

    const key = `${source}:${transcript}:${final}:${this.armed}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);

    const now = performance.now();
    const hits = (verdict: ReturnType<typeof judge>) =>
      this.rule === 'exact' ? verdict.exact : verdict.contains;

    if (this.armed && !this.matched) {
      const verdict = judge(transcript, this.current.expected);
      const hypothesis: Hypothesis = {
        transcript,
        source,
        atMs: Math.round(now - this.current.shownAt),
        final,
        verdict,
      };

      if (hits(verdict)) {
        this.matched = true;
        this.events.onHypothesis(hypothesis);
        this.events.onMatch(hypothesis);
        return;
      }

      // Not this card's answer — the previous card's, arriving late?
      if (this.previous) {
        const lateVerdict = judge(transcript, this.previous.expected);
        if (hits(lateVerdict)) {
          const shownAt = this.previous.shownAt;
          this.previous = null;
          this.events.onLateMatch({
            transcript,
            source,
            atMs: Math.round(now - shownAt),
            final,
            verdict: lateVerdict,
          });
          return;
        }
      }

      this.events.onHypothesis(hypothesis);
      return;
    }

    // Between cards: this can only be the answer to the one just closed.
    if (!this.armed) {
      const verdict = judge(transcript, this.current.expected);
      if (hits(verdict)) {
        this.events.onLateMatch({
          transcript,
          source,
          atMs: Math.round(now - this.current.shownAt),
          final,
          verdict,
        });
      }
    }
  }
}
