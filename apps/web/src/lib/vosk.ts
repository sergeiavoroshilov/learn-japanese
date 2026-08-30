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

export interface VoskOptions {
  /**
   * Vocabulary the decoder is restricted to. This is the point of the spike:
   * with 46 moras to choose from, the decoder cannot answer «部屋» to へ.
   * `null` runs free recognition, for comparison.
   */
  grammar: string[] | null;
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
  private expected: Expected | null = null;
  private shownAt = 0;
  private matched = false;
  private seen = new Set<string>();
  /**
   * Vosk keeps decoding one continuous utterance, so its partial text carries
   * residue from previous cards; everything up to this offset is ignored.
   */
  private partialBase = 0;

  constructor(
    private readonly events: RecognizerEvents,
    private readonly rule: MatchRule,
    private readonly opts: VoskOptions,
  ) {
    this.name = opts.grammar
      ? `Vosk (словарь из ${opts.grammar.length} мор)`
      : 'Vosk (свободное распознавание)';
  }

  async start(mic: MicSource | null): Promise<void> {
    if (!mic) throw new Error('Vosk требует микрофон');

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
    const grammar = this.opts.grammar
      ? // "[unk]" gives the decoder somewhere to put anything that is not a
        // listed mora, instead of forcing a wrong one.
        JSON.stringify([...this.opts.grammar, '[unk]'])
      : undefined;
    const recognizer = new this.model.KaldiRecognizer(mic.sampleRate, grammar);

    recognizer.on('partialresult', (message) => {
      if ('result' in message && 'partial' in message.result) {
        this.handle(message.result.partial, false);
      }
    });
    recognizer.on('result', (message) => {
      if ('result' in message && 'text' in message.result) {
        this.handle(message.result.text, true);
      }
    });
    recognizer.on('error', (message) => {
      if ('error' in message) this.events.onError(message.error);
    });

    this.recognizer = recognizer;
    mic.onChunk((chunk, sampleRate) => recognizer.acceptWaveformFloat(chunk, sampleRate));

    this.opts.onStatus?.('');
    this.events.onListening(true);
  }

  expect(expected: Expected, shownAt: number): void {
    this.expected = expected;
    this.shownAt = shownAt;
    this.matched = false;
    this.seen.clear();
    this.partialBase = this.lastPartialLength;
  }

  disarm(): void {
    this.expected = null;
  }

  stop(): void {
    this.expected = null;
    this.recognizer?.remove();
    this.recognizer = null;
    this.model?.terminate();
    this.model = null;
    this.events.onListening(false);
  }

  private lastPartialLength = 0;

  private handle(rawText: string, final: boolean): void {
    if (!final) this.lastPartialLength = rawText.length;
    const expected = this.expected;
    if (!expected || this.matched) return;

    // Judge only what was said after this card appeared.
    const fresh = rawText.length >= this.partialBase ? rawText.slice(this.partialBase) : rawText;
    const transcript = fresh.trim();
    if (!transcript) return;

    const key = `${transcript}:${final}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);

    const atMs = Math.round(performance.now() - this.shownAt);
    const verdict = judge(transcript, expected);
    const hypothesis: Hypothesis = { transcript, atMs, final, verdict };
    this.events.onHypothesis(hypothesis);

    if (this.rule === 'exact' ? verdict.exact : verdict.contains) {
      this.matched = true;
      this.events.onMatch(hypothesis);
    }
  }
}
