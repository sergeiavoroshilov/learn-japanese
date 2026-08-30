import * as voskModule from 'vosk-browser';
import type { KaldiRecognizer, Model } from 'vosk-browser';
import type { MicSource } from './audio';
import { judge, type Expected } from './match';
import {
  isFragment,
  type DrillRecognizer,
  type Hypothesis,
  type MatchRule,
  type RecognizerEvents,
} from './recognizer';

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
 * Moras absent from vosk-model-small-ja-0.22's lexicon, checked against
 * graph/words.txt: 46/46 basic and 25/25 dakuten are present, three youon are
 * not. The list itself lives with the kana table, where the cards are.
 */
export { VOICE_OOV_KANA as VOSK_OOV_KANA } from './kana';

interface HypothesisDetail {
  conf?: number;
  spanMs?: number;
}

/**
 * Confidence and audio span of a final result. Vosk reports one entry per
 * word with `conf`, `start` and `end` in seconds; the span is taken across
 * every word, and the confidence is the weakest of them — a hypothesis is
 * only as good as its shakiest piece.
 */
function detail(result: { result?: { conf: number; start: number; end: number }[] }): HypothesisDetail {
  const words = result.result;
  if (!words || words.length === 0) return {};
  const start = Math.min(...words.map((w) => w.start));
  const end = Math.max(...words.map((w) => w.end));
  return {
    conf: Math.round(Math.min(...words.map((w) => w.conf)) * 1000) / 1000,
    spanMs: Math.round((end - start) * 1000),
  };
}

/** How long after a card appears a bare «[unk]» is still the previous card's tail. */
const TAIL_WINDOW_MS = 300;



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
  /**
   * What the control decoder is allowed to name — the whole kana table by
   * default, not just what is being drilled.
   *
   * Restricting it to the session's own moras made it useless exactly when it
   * mattered: drilling only the /u/ column, it could not answer «を» for う
   * because を was not on the list, so a confusion it had named clearly in
   * three earlier runs came back as a shrug.
   */
  witnessVocabulary?: string[];
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
    } else if (this.opts.witness) {
      const vocabulary = this.opts.witnessVocabulary ?? this.opts.deckVocabulary;
      if (vocabulary.length > 0) this.witness = this.spawnWitness(vocabulary);
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
    // Per-word confidences and timings: the only way to tell a decoder that
    // heard the whole sound and refused it from one that got a fragment.
    recognizer.setWords(true);
    recognizer.on('result', (message) => {
      if (!('result' in message) || !('text' in message.result)) return;
      const text = message.result.text.trim();
      if (!text) return;
      this.events.onWitness?.(text);
      if (this.opts.acceptFromWitness) this.handle(text, true, 'deck', detail(message.result));
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
    recognizer.setWords(true);

    recognizer.on('partialresult', (message) => {
      if ('result' in message && 'partial' in message.result) {
        this.handle(message.result.partial, false, 'card');
      }
    });
    recognizer.on('result', (message) => {
      if ('result' in message && 'text' in message.result) {
        this.handle(message.result.text, true, 'card', detail(message.result));
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
      // Every spelling of this one mora that the model knows — the bare kana
      // plus its katakana and long-vowel forms. A kana named in isolation is
      // held long enough that «いい» is the honest transcription, and a
      // grammar without it leaves the decoder no option but «[unk]».
      const previous = this.recognizer;
      this.recognizer = this.spawn(expected.lexical);
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

  private handle(
    rawText: string,
    final: boolean,
    source: 'card' | 'deck',
    detail?: HypothesisDetail,
  ): void {
    const transcript = rawText.trim();
    if (!transcript || !this.current) return;

    // One frame of audio cannot be a mora — in either direction. Logging it
    // makes the drill ask for a repeat that was never needed, and matching on
    // it would be a false accept on a fragment.
    if (isFragment(detail?.spanMs)) return;

    // Closing a card flushes the decoder, and that final result lands just
    // after the next card appears. An empty-but-for-[unk] result in the first
    // moments is that tail, not an answer to the card now on screen.
    const sinceShown = performance.now() - this.current.shownAt;
    if (sinceShown < TAIL_WINDOW_MS && judge(transcript, this.current.expected).normalized === '') {
      return;
    }

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
        ...detail,
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
            ...detail,
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
          ...detail,
        });
      }
    }
  }
}
