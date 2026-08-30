import { ALL_CARDS, type KanaCard } from './kana';
import { LEXICON_FORMS } from './lexicon';
import { normalize } from './match';

/**
 * The control decoder names the mora the learner actually said. Turning that
 * name into a correction is the difference between a drill that rejects you
 * and one that teaches you.
 *
 * Every rule here comes from a confusion seen in the measurement runs, not
 * from a textbook list of common mistakes.
 */

/** Any spelling the model might return, mapped back to the mora it writes. */
const BY_FORM = new Map<string, KanaCard>();
for (const card of ALL_CARDS) {
  if (card.script !== 'hiragana') continue;
  for (const form of LEXICON_FORMS[card.kana] ?? [card.kana]) {
    BY_FORM.set(normalize(form), card);
  }
}

export function moraOf(transcript: string): KanaCard | null {
  return BY_FORM.get(normalize(transcript)) ?? null;
}

export interface Correction {
  /** The mora the decoder actually heard, as a glyph. */
  heard: string;
  /** One line the learner can act on. */
  hint: string;
}

export function correctionFor(expected: KanaCard, heardRaw: string[]): Correction | null {
  for (const raw of heardRaw) {
    const heard = moraOf(raw);
    if (!heard || heard.kana === expected.kana) continue;
    const hint = hintFor(expected, heard);
    if (hint) return { heard: heard.glyph, hint };
  }
  return null;
}

function hintFor(expected: KanaCard, heard: KanaCard): string | null {
  // /u/ heard as /o/ — う→を/お, く→こ, つ→そ, る→ろ, ゆ→よ. The most common
  // failure in every run so far, and always the same cause.
  if (expected.col === 'u' && heard.col === 'o') {
    return 'японская /u/ — без округления губ. Губы трубочкой дают /o/: растяните их, как при «ы».';
  }

  // ん is one nasal sound and nothing else; «ну» adds a vowel and becomes ぬ.
  if (expected.row === 'N' && (heard.row === 'n' || heard.row === 'm')) {
    return 'ん — один носовой звук, без гласного после него: не «ну», а тянущееся «н».';
  }

  // Russian «х» is a velar fricative and its noise sits close to /s/.
  if (expected.row === 'h' && heard.row === 's') {
    return 'японская /h/ — лёгкий выдох, а не русское «х»: от «х» получается шум, похожий на /s/.';
  }

  if (expected.row === heard.row) return `тот же ряд, другой гласный — ${heard.romaji} вместо ${expected.romaji}.`;
  if (expected.col === heard.col) return `тот же гласный, другой согласный — ${heard.romaji} вместо ${expected.romaji}.`;
  return null;
}
