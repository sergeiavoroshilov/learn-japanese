import type { DrillCard } from './card';

/**
 * Says a reading out loud, so a correction can be heard and not only read.
 *
 * The recogniser cannot supply this: a Vosk model is weights and a decoding
 * graph, and the recordings it was trained on are not in it. The system's own
 * Japanese voice is — Kyoko on macOS and iOS, a Google voice in Chrome — and it
 * works offline.
 */
export interface Speaker {
  /**
   * Unlock speech while a user gesture is still live. iOS refuses an utterance
   * that does not start inside one, and the first card is missed long after the
   * «start» tap has been spent on the microphone prompt.
   */
  prime(): void;
  /** Resolves when the voice has finished, or was cut off. */
  say(text: string): Promise<void>;
  cancel(): void;
}

/**
 * The novelty voices macOS ships for every language. They read Japanese, but
 * as a character would — not something to imitate. Matched on the name before
 * its localised suffix: «Grandma (японский (Япония))».
 */
const NOVELTY = /^(Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley)\b/;

/** Safari sometimes never fires `end`; do not let a hold depend on it. */
const SAY_TIMEOUT_MS = 4000;

export class BrowserSpeaker implements Speaker {
  /**
   * Held so the utterance is not collected mid-sentence — Chrome drops the
   * `end` event of one that nothing references any more.
   */
  private current: SpeechSynthesisUtterance | null = null;

  static available(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  prime(): void {
    if (!BrowserSpeaker.available()) return;
    // In the Japanese voice, not the default one: macOS loads a voice on its
    // first use, and a cold Kyoko held the first correction of a session for
    // seconds. Whatever this costs is spent on the start screen instead.
    const silent = this.utterance('あ');
    silent.volume = 0;
    speechSynthesis.speak(silent);
  }

  say(text: string): Promise<void> {
    if (!BrowserSpeaker.available()) return Promise.resolve();
    speechSynthesis.cancel();
    const utterance = this.utterance(text);
    this.current = utterance;

    return new Promise((resolve) => {
      const done = () => {
        window.clearTimeout(timer);
        if (this.current === utterance) this.current = null;
        resolve();
      };
      const timer = window.setTimeout(done, SAY_TIMEOUT_MS);
      utterance.onend = done;
      utterance.onerror = done;
      speechSynthesis.speak(utterance);
    });
  }

  cancel(): void {
    if (BrowserSpeaker.available()) speechSynthesis.cancel();
  }

  private utterance(text: string): SpeechSynthesisUtterance {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ja-JP';
    const voice = japaneseVoice();
    if (voice) utterance.voice = voice;
    // A touch slower than conversation: one mora at full speed is over
    // before you have started listening to it.
    utterance.rate = 0.8;
    return utterance;
  }
}

// Chrome fills the voice list asynchronously and only once something asks
// for it. Ask at load, so a session started on the home screen finds Kyoko
// rather than whatever ja-JP voice the browser falls back to.
if (BrowserSpeaker.available()) speechSynthesis.getVoices();

function japaneseVoice(): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.replace('_', '-').startsWith('ja'));
  const rank = (v: SpeechSynthesisVoice) => (NOVELTY.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1);
  return voices.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/**
 * What to say for a card: the kana a kanji is read as, never the kanji
 * itself, which a voice would read whichever way it likes best.
 *
 * A lone kana is said held and twice — «うー、うー». Said plainly a voice gives
 * it about 200 ms, half-swallowed, and over before you have started listening.
 * Held is also how the learner says a mora on its own, and what the decoder
 * expects (`lexicon.ts` carries the long spellings for exactly that reason).
 */
export function spokenFormOf(card: DrillCard): string {
  if (card.kind === 'kana') {
    const held = card.glyph === 'ん' || card.glyph === 'ン' ? card.glyph : `${card.glyph}ー`;
    return `${held}、${held}`;
  }
  return card.reading || card.glyph;
}
