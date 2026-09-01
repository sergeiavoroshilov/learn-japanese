import { toKatakana } from 'wanakana';
import type { DrillCard } from './card';
import { toKiriji } from './kiriji';
import { LEXICON_FORMS } from './lexicon';

export type KanaScript = 'hiragana' | 'katakana';
export type KanaGroup = 'basic' | 'dakuten' | 'youon';
export type DeckId = `${'hira' | 'kata'}-${KanaGroup}`;

/**
 * Moras the Vosk lexicon has no entry for. The decoder physically cannot
 * output them, so a voice drill would score them as failures no matter how
 * well they were pronounced — they are excluded from voice sessions and said
 * so out loud in the UI, rather than quietly counted as mistakes.
 */
export const VOICE_OOV_KANA = ['びゃ', 'ぴゃ', 'ぴょ'];

export interface KanaCard extends DrillCard {
  /** Canonical reading in hiragana. This is what the decoder is asked for. */
  kana: string;
  /** Hepburn romaji, shown to the user as the answer key. */
  romaji: string;
  script: KanaScript;
  group: KanaGroup;
  /** Gojūon row: '' for the bare vowels, 'k' for か行, 'ky' for きゃ… */
  row: string;
  /** Gojūon column: the vowel, 'a' | 'i' | 'u' | 'e' | 'o'. */
  col: string;
  /** Extra romaji spellings an engine might return (kunrei-shiki etc). */
  alt?: string[];
}

/** kana, romaji, then any alternative romaji spellings. */
type Entry = [string, string, ...string[]];

interface RowSpec {
  key: string;
  /** One entry per column; null where the gojūon table has a gap. */
  cells: (Entry | null)[];
}

interface TableSpec {
  columns: string[];
  rows: RowSpec[];
}

/** 46 base moras, laid out as the gojūon table rather than a flat list. */
const BASIC: TableSpec = {
  columns: ['a', 'i', 'u', 'e', 'o'],
  rows: [
    { key: '', cells: [['あ', 'a'], ['い', 'i'], ['う', 'u'], ['え', 'e'], ['お', 'o']] },
    { key: 'k', cells: [['か', 'ka'], ['き', 'ki'], ['く', 'ku'], ['け', 'ke'], ['こ', 'ko']] },
    { key: 's', cells: [['さ', 'sa'], ['し', 'shi', 'si'], ['す', 'su'], ['せ', 'se'], ['そ', 'so']] },
    { key: 't', cells: [['た', 'ta'], ['ち', 'chi', 'ti'], ['つ', 'tsu', 'tu'], ['て', 'te'], ['と', 'to']] },
    { key: 'n', cells: [['な', 'na'], ['に', 'ni'], ['ぬ', 'nu'], ['ね', 'ne'], ['の', 'no']] },
    { key: 'h', cells: [['は', 'ha'], ['ひ', 'hi'], ['ふ', 'fu', 'hu'], ['へ', 'he'], ['ほ', 'ho']] },
    { key: 'm', cells: [['ま', 'ma'], ['み', 'mi'], ['む', 'mu'], ['め', 'me'], ['も', 'mo']] },
    { key: 'y', cells: [['や', 'ya'], null, ['ゆ', 'yu'], null, ['よ', 'yo']] },
    { key: 'r', cells: [['ら', 'ra'], ['り', 'ri'], ['る', 'ru'], ['れ', 're'], ['ろ', 'ro']] },
    { key: 'w', cells: [['わ', 'wa'], null, null, null, ['を', 'wo', 'o']] },
    // ん belongs to no row of the table; it gets one of its own.
    { key: 'N', cells: [['ん', 'n', 'nn'], null, null, null, null] },
  ],
};

/** Voiced / semi-voiced. */
const DAKUTEN: TableSpec = {
  columns: ['a', 'i', 'u', 'e', 'o'],
  rows: [
    { key: 'g', cells: [['が', 'ga'], ['ぎ', 'gi'], ['ぐ', 'gu'], ['げ', 'ge'], ['ご', 'go']] },
    { key: 'z', cells: [['ざ', 'za'], ['じ', 'ji', 'zi'], ['ず', 'zu'], ['ぜ', 'ze'], ['ぞ', 'zo']] },
    { key: 'd', cells: [['だ', 'da'], ['ぢ', 'ji', 'di'], ['づ', 'zu', 'du'], ['で', 'de'], ['ど', 'do']] },
    { key: 'b', cells: [['ば', 'ba'], ['び', 'bi'], ['ぶ', 'bu'], ['べ', 'be'], ['ぼ', 'bo']] },
    { key: 'p', cells: [['ぱ', 'pa'], ['ぴ', 'pi'], ['ぷ', 'pu'], ['ぺ', 'pe'], ['ぽ', 'po']] },
  ],
};

/** Contracted sounds — three columns, not five. */
const YOUON: TableSpec = {
  columns: ['a', 'u', 'o'],
  rows: [
    { key: 'ky', cells: [['きゃ', 'kya'], ['きゅ', 'kyu'], ['きょ', 'kyo']] },
    { key: 'sh', cells: [['しゃ', 'sha', 'sya'], ['しゅ', 'shu', 'syu'], ['しょ', 'sho', 'syo']] },
    { key: 'ch', cells: [['ちゃ', 'cha', 'tya'], ['ちゅ', 'chu', 'tyu'], ['ちょ', 'cho', 'tyo']] },
    { key: 'ny', cells: [['にゃ', 'nya'], ['にゅ', 'nyu'], ['にょ', 'nyo']] },
    { key: 'hy', cells: [['ひゃ', 'hya'], ['ひゅ', 'hyu'], ['ひょ', 'hyo']] },
    { key: 'my', cells: [['みゃ', 'mya'], ['みゅ', 'myu'], ['みょ', 'myo']] },
    { key: 'ry', cells: [['りゃ', 'rya'], ['りゅ', 'ryu'], ['りょ', 'ryo']] },
    { key: 'gy', cells: [['ぎゃ', 'gya'], ['ぎゅ', 'gyu'], ['ぎょ', 'gyo']] },
    { key: 'j', cells: [['じゃ', 'ja', 'jya'], ['じゅ', 'ju', 'jyu'], ['じょ', 'jo', 'jyo']] },
    { key: 'by', cells: [['びゃ', 'bya'], ['びゅ', 'byu'], ['びょ', 'byo']] },
    { key: 'py', cells: [['ぴゃ', 'pya'], ['ぴゅ', 'pyu'], ['ぴょ', 'pyo']] },
  ],
};

const TABLES: Record<KanaGroup, TableSpec> = { basic: BASIC, dakuten: DAKUTEN, youon: YOUON };

export interface GridRow {
  key: string;
  /** What labels the row in the UI — its first mora, e.g. か for か行. */
  label: string;
  /** Aligned to the grid's columns; null where the table has a gap. */
  cells: (KanaCard | null)[];
}

export interface DeckGrid {
  columns: string[];
  rows: GridRow[];
}

function buildGrid(script: KanaScript, group: KanaGroup): DeckGrid {
  const prefix = script === 'hiragana' ? 'hira' : 'kata';
  const table = TABLES[group];
  return {
    columns: table.columns,
    rows: table.rows.map((spec) => {
      const cells = spec.cells.map((entry, i) => {
        if (!entry) return null;
        const [kana, romaji, ...alt] = entry;
        const known = LEXICON_FORMS[kana];
        const forms = known && known.length > 0 ? known : [kana];
        const card: KanaCard = {
          // Keyed by script and glyph, not by romaji: じ/ぢ and ず/づ share a
          // reading but are different cards, and this id is the SRS key.
          id: `${prefix}-${kana}`,
          glyph: script === 'hiragana' ? kana : toKatakana(kana),
          kana,
          romaji,
          script,
          group,
          row: spec.key,
          col: table.columns[i]!,
          alt: alt.length ? alt : undefined,
          readings: forms,
          readingsShort: [kana],
          typed: [romaji, ...alt],
          kind: 'kana',
          // The glyph already is the reading; repeating it would say nothing.
          reading: '',
          kiriji: toKiriji(kana),
          answer: romaji,
          levelId: `${prefix}-${group}`,
          voiceOov: VOICE_OOV_KANA.includes(kana) || undefined,
        };
        return card;
      });
      return {
        key: spec.key,
        label: cells.find((c): c is KanaCard => c !== null)!.glyph,
        cells,
      };
    }),
  };
}

export interface Deck {
  id: DeckId;
  label: string;
  script: KanaScript;
  group: KanaGroup;
  grid: DeckGrid;
  cards: KanaCard[];
}

const GROUP_LABELS: Record<KanaGroup, string> = {
  basic: 'базовые',
  dakuten: 'дакутэн',
  youon: 'ёон',
};

const SCRIPT_LABELS: Record<KanaScript, string> = {
  hiragana: 'Хирагана',
  katakana: 'Катакана',
};

export const DECKS: Deck[] = (['hiragana', 'katakana'] as KanaScript[]).flatMap((script) =>
  (['basic', 'dakuten', 'youon'] as KanaGroup[]).map((group) => {
    const grid = buildGrid(script, group);
    const cards = grid.rows.flatMap((r) => r.cells.filter((c): c is KanaCard => c !== null));
    return {
      id: `${script === 'hiragana' ? 'hira' : 'kata'}-${group}` as DeckId,
      label: `${SCRIPT_LABELS[script]} · ${GROUP_LABELS[group]} (${cards.length})`,
      script,
      group,
      grid,
      cards,
    };
  }),
);

export const ALL_CARDS: KanaCard[] = DECKS.flatMap((d) => d.cards);

/**
 * Every mora the recogniser can name, once each. This is what the control
 * decoder gets: it decides nothing, so a wide vocabulary costs nothing, and a
 * narrow one leaves it unable to name the very confusion worth naming.
 */
export const NAMEABLE_CARDS: KanaCard[] = DECKS.filter((d) => d.script === 'hiragana')
  .flatMap((d) => d.cards)
  .filter((c) => !c.voiceOov);

const BY_ID = new Map(ALL_CARDS.map((c) => [c.id, c]));

export function cardById(id: string): KanaCard | undefined {
  return BY_ID.get(id);
}

export function deckById(id: DeckId): Deck | undefined {
  return DECKS.find((d) => d.id === id);
}

/** Cards of the given decks, in table order. */
export function cardsOf(decks: DeckId[]): KanaCard[] {
  const wanted = new Set(decks);
  return DECKS.filter((d) => wanted.has(d.id)).flatMap((d) => d.cards);
}

/** Random cards without repeating a glyph until the pool is exhausted. */
export function drawFrom(pool: KanaCard[], count: number): KanaCard[] {
  if (pool.length === 0) return [];
  const out: KanaCard[] = [];
  let bag: KanaCard[] = [];
  while (out.length < count) {
    if (bag.length === 0) bag = shuffle(pool);
    out.push(bag.pop()!);
  }
  return out;
}

export function drawCards(decks: DeckId[], count: number): KanaCard[] {
  return drawFrom(cardsOf(decks), count);
}

export function shuffle<T>(items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
