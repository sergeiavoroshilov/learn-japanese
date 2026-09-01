import type { DrillCard } from './card';
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
  /**
   * True when the slip has a phonetic explanation that holds across moras —
   * the whole /u/ column rounding into /o/, a vowel growing onto ん. Those are
   * mouth problems, not memory problems, and the scheduler must treat them
   * differently from confusing one glyph with another.
   */
  systematic: boolean;
}

export function correctionFor(expected: DrillCard, heardRaw: string[]): Correction | null {
  // Every rule below is about where a mora sits in the gojūon table, and a
  // kanji sits nowhere in it. Nothing to say about those yet.
  if (expected.row === undefined || expected.col === undefined) return null;
  for (const raw of heardRaw) {
    const heard = moraOf(raw);
    if (!heard || heard.readingsShort.includes(expected.readingsShort[0] ?? '')) continue;
    return { heard: heard.glyph, ...hintFor(expected, heard) };
  }
  return null;
}

function hintFor(expected: DrillCard, heard: KanaCard): Omit<Correction, 'heard'> {
  // /u/ heard as /o/ — う→を, く→こ, す→そ, ふ→ほ, む→も, る→ろ, ゆ→よ. Seven
  // different moras, one error, in every run so far.
  //
  // The consonant is deliberately not required to match. つ comes back as しょ,
  // and reading つ *as* しょ is not a mistake anyone makes — the glyphs look
  // nothing alike. A rounded vowel that also smears the affricate is one
  // articulation problem, not a misread glyph; the invariant across every
  // observed case is the vowel column, so that is what the rule keys on.
  if (expected.col === 'u' && heard.col === 'o') {
    return {
      hint: 'японская /u/ — без округления губ. Губы трубочкой дают /o/: растяните их, как при «ы».',
      systematic: true,
    };
  }

  // ん is one nasal sound and nothing else; «ну» adds a vowel and becomes ぬ.
  if (expected.row === 'N' && (heard.row === 'n' || heard.row === 'm')) {
    return {
      hint: 'ん — один носовой звук, без гласного после него: не «ну», а тянущееся «н».',
      systematic: true,
    };
  }

  // Russian «х» is a velar fricative and its noise sits close to /s/.
  if (expected.row === 'h' && heard.row === 's') {
    return {
      hint: 'японская /h/ — лёгкий выдох, а не русское «х»: от «х» получается шум, похожий на /s/.',
      systematic: true,
    };
  }

  // No phonetic story — the wrong mora was read, not the right one said badly.
  if (expected.row === heard.row) {
    return { hint: `тот же ряд, другой гласный — ${heard.romaji} вместо ${expected.answer}.`, systematic: false };
  }
  if (expected.col === heard.col) {
    return { hint: `тот же гласный, другой согласный — ${heard.romaji} вместо ${expected.answer}.`, systematic: false };
  }
  return { hint: `это ${heard.romaji}, а не ${expected.answer}.`, systematic: false };
}
