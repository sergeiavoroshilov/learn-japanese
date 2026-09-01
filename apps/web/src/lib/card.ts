/**
 * What the drill shows and what it accepts, independent of whether the glyph
 * is a kana or a kanji. Everything downstream — matching, grading, the
 * scheduler, the session queue — works on this and nothing else.
 */
export interface DrillCard {
  /** Stable SRS key. */
  id: string;
  /** What is shown, large, on the card. */
  glyph: string;
  /**
   * Every spelling of a correct answer the recogniser may return, in any
   * script. For kana this includes the long forms a mora takes when named on
   * its own; for kanji, each of its on and kun readings.
   */
  readings: string[];
  /** The same answers without the held-vowel variants. */
  readingsShort: string[];
  /** What may be typed in keyboard mode. */
  typed: string[];
  /** What kind of thing is on the card, which decides how help is shown. */
  kind: 'kana' | 'word' | 'kanji';
  /**
   * The reading in kana — furigana. Empty when the glyph *is* kana and reads
   * as itself; for a kanji this is the thing a learner most needs to see.
   */
  reading: string;
  /** The reading in Latin letters. */
  romaji: string;
  /** The reading in Cyrillic, Polivanov. */
  kiriji: string;
  /** The answer key shown after a miss. */
  answer: string;
  /** One main meaning and the lesser ones, for kanji and words. */
  meaning?: { primary: string; extra: string[] };
  /** Which level this card belongs to. */
  levelId: string;
  /** Gojūon coordinates. Kana only; kanji sit in no table. */
  row?: string;
  col?: string;
  /** The recogniser has no word for this reading, so it cannot be drilled. */
  voiceOov?: boolean;
}
