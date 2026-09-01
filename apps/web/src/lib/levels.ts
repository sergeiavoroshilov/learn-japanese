import { toRomaji } from 'wanakana';
import type { DrillCard } from './card';
import { DECKS } from './kana';
import { KANJI } from './kanji';
import { toKiriji } from './kiriji';
import { HIRAGANA_WORDS, KATAKANA_WORDS, type WordEntry } from './words';

/**
 * The syllabus, in the order it is meant to be learned, and the rule that
 * keeps a learner from running ahead of themselves.
 */
export interface Level {
  id: string;
  /** Shown in the progress list. */
  label: string;
  /** One line about what this level is. */
  note: string;
  /** Cards in teaching order: kana by the gojūon table, kanji by frequency. */
  cards: DrillCard[];
}

/**
 * A word written in kana reads exactly as it is written — that is the whole
 * exercise. Two or three moras at a time instead of one, which is the step
 * between knowing the letters and reading.
 */
function wordCards(words: WordEntry[], levelId: string, prefix: string): DrillCard[] {
  return words.map((entry) => ({
    id: `${prefix}-${entry.w}`,
    glyph: entry.w,
    readings: [entry.w],
    readingsShort: [entry.w],
    typed: [toRomaji(entry.w)],
    kind: 'word' as const,
    reading: '',
    romaji: toRomaji(entry.w),
    kiriji: toKiriji(entry.w),
    answer: toRomaji(entry.w),
    meaning: { primary: entry.ru, extra: [entry.en] },
    levelId,
  }));
}

function kanjiCards(level: number): DrillCard[] {
  return KANJI.filter((k) => k.n === level).map((k) => {
    // Both scripts are accepted, but only the hiragana ones are shown back —
    // a reading is a reading, and two spellings of it would read as two
    // different answers.
    const hiragana = k.r.filter((r) => !/[ァ-ヶ]/.test(r));
    return {
      id: `kanji-${k.k}`,
      glyph: k.k,
      readings: k.r,
      readingsShort: k.r,
      typed: hiragana.map((r) => toRomaji(r)),
      kind: 'kanji' as const,
      // Furigana: for a character the learner has never met, this is the
      // single most useful thing on the screen.
      reading: hiragana.join(' · '),
      romaji: hiragana.map((r) => toRomaji(r)).join(' · '),
      kiriji: hiragana.map((r) => toKiriji(r)).join(' · '),
      answer: hiragana.join(' · '),
      meaning: k.m.length > 0 ? { primary: k.m[0]!, extra: k.m.slice(1) } : undefined,
      levelId: `kanji-n${k.n}`,
    } satisfies DrillCard;
  });
}

const KANA_LEVELS: { id: string; label: string; note: string }[] = [
  { id: 'hira-basic', label: 'Хирагана', note: '46 базовых мор — с них начинается всё' },
  { id: 'hira-dakuten', label: 'Хирагана · дакутэн', note: 'звонкие: が, ざ, だ, ば, ぱ' },
  { id: 'hira-youon', label: 'Хирагана · ёон', note: 'слитные: きゃ, しゅ, ちょ' },
  { id: 'kata-basic', label: 'Катакана', note: 'та же таблица, другие знаки' },
  { id: 'kata-dakuten', label: 'Катакана · дакутэн', note: 'звонкие катаканой' },
  { id: 'kata-youon', label: 'Катакана · ёон', note: 'слитные катаканой' },
];

function kanaLevel(id: string) {
  const spec = KANA_LEVELS.find((l) => l.id === id)!;
  return { ...spec, cards: DECKS.find((d) => d.id === id)!.cards as DrillCard[] };
}

/**
 * Kana, then words in that kana, then kanji by JLPT level.
 *
 * Words come right after the letters that spell them: knowing every mora and
 * still reading them one at a time is the gap this level exists to close.
 * Within a kanji level the order is newspaper frequency, so the characters
 * that carry the most text come first — learning 日 before 妹 is worth more
 * than any amount of tidiness.
 */
export const LEVELS: Level[] = [
  kanaLevel('hira-basic'),
  kanaLevel('hira-dakuten'),
  kanaLevel('hira-youon'),
  {
    id: 'hira-words',
    label: 'Слова хираганой',
    note: 'две-три моры подряд, а не по одной',
    cards: wordCards(HIRAGANA_WORDS, 'hira-words', 'word-h'),
  },
  kanaLevel('kata-basic'),
  kanaLevel('kata-dakuten'),
  kanaLevel('kata-youon'),
  {
    id: 'kata-words',
    label: 'Слова катаканой',
    note: 'заимствования — то, ради чего катакана и нужна',
    cards: wordCards(KATAKANA_WORDS, 'kata-words', 'word-k'),
  },
  { id: 'kanji-n5', label: 'Кандзи N5', note: '79 знаков, по частоте в печати', cards: kanjiCards(5) },
  { id: 'kanji-n4', label: 'Кандзи N4', note: '166 знаков', cards: kanjiCards(4) },
  { id: 'kanji-n3', label: 'Кандзи N3', note: '367 знаков', cards: kanjiCards(3) },
];

export const ALL_LEVEL_CARDS: DrillCard[] = LEVELS.flatMap((l) => l.cards);

const CARD_BY_ID = new Map(ALL_LEVEL_CARDS.map((c) => [c.id, c]));

export function drillCardById(id: string): DrillCard | undefined {
  return CARD_BY_ID.get(id);
}

export function levelById(id: string): Level | undefined {
  return LEVELS.find((l) => l.id === id);
}
