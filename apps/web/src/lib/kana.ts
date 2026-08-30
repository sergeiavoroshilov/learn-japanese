import { toKatakana } from 'wanakana';

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

export interface KanaCard {
  id: string;
  /** What is shown on screen — hiragana or katakana. */
  glyph: string;
  /** Canonical reading in hiragana. This is what the decoder is asked for. */
  kana: string;
  /** Hepburn romaji, shown to the user as the answer key. */
  romaji: string;
  script: KanaScript;
  group: KanaGroup;
  /** Extra romaji spellings an engine might return (kunrei-shiki etc). */
  alt?: string[];
  /** The reading is outside the recogniser's lexicon. */
  voiceOov?: boolean;
}

type Entry = [string, string, ...string[]];

/** 46 base moras. */
const BASIC: Entry[] = [
  ['あ', 'a'], ['い', 'i'], ['う', 'u'], ['え', 'e'], ['お', 'o'],
  ['か', 'ka'], ['き', 'ki'], ['く', 'ku'], ['け', 'ke'], ['こ', 'ko'],
  ['さ', 'sa'], ['し', 'shi', 'si'], ['す', 'su'], ['せ', 'se'], ['そ', 'so'],
  ['た', 'ta'], ['ち', 'chi', 'ti'], ['つ', 'tsu', 'tu'], ['て', 'te'], ['と', 'to'],
  ['な', 'na'], ['に', 'ni'], ['ぬ', 'nu'], ['ね', 'ne'], ['の', 'no'],
  ['は', 'ha'], ['ひ', 'hi'], ['ふ', 'fu', 'hu'], ['へ', 'he'], ['ほ', 'ho'],
  ['ま', 'ma'], ['み', 'mi'], ['む', 'mu'], ['め', 'me'], ['も', 'mo'],
  ['や', 'ya'], ['ゆ', 'yu'], ['よ', 'yo'],
  ['ら', 'ra'], ['り', 'ri'], ['る', 'ru'], ['れ', 're'], ['ろ', 'ro'],
  ['わ', 'wa'], ['を', 'wo', 'o'], ['ん', 'n', 'nn'],
];

/** Voiced / semi-voiced. */
const DAKUTEN: Entry[] = [
  ['が', 'ga'], ['ぎ', 'gi'], ['ぐ', 'gu'], ['げ', 'ge'], ['ご', 'go'],
  ['ざ', 'za'], ['じ', 'ji', 'zi'], ['ず', 'zu'], ['ぜ', 'ze'], ['ぞ', 'zo'],
  ['だ', 'da'], ['ぢ', 'ji', 'di'], ['づ', 'zu', 'du'], ['で', 'de'], ['ど', 'do'],
  ['ば', 'ba'], ['び', 'bi'], ['ぶ', 'bu'], ['べ', 'be'], ['ぼ', 'bo'],
  ['ぱ', 'pa'], ['ぴ', 'pi'], ['ぷ', 'pu'], ['ぺ', 'pe'], ['ぽ', 'po'],
];

/** Contracted sounds. */
const YOUON: Entry[] = [
  ['きゃ', 'kya'], ['きゅ', 'kyu'], ['きょ', 'kyo'],
  ['しゃ', 'sha', 'sya'], ['しゅ', 'shu', 'syu'], ['しょ', 'sho', 'syo'],
  ['ちゃ', 'cha', 'tya'], ['ちゅ', 'chu', 'tyu'], ['ちょ', 'cho', 'tyo'],
  ['にゃ', 'nya'], ['にゅ', 'nyu'], ['にょ', 'nyo'],
  ['ひゃ', 'hya'], ['ひゅ', 'hyu'], ['ひょ', 'hyo'],
  ['みゃ', 'mya'], ['みゅ', 'myu'], ['みょ', 'myo'],
  ['りゃ', 'rya'], ['りゅ', 'ryu'], ['りょ', 'ryo'],
  ['ぎゃ', 'gya'], ['ぎゅ', 'gyu'], ['ぎょ', 'gyo'],
  ['じゃ', 'ja', 'jya'], ['じゅ', 'ju', 'jyu'], ['じょ', 'jo', 'jyo'],
  ['びゃ', 'bya'], ['びゅ', 'byu'], ['びょ', 'byo'],
  ['ぴゃ', 'pya'], ['ぴゅ', 'pyu'], ['ぴょ', 'pyo'],
];

const TABLES: Record<KanaGroup, Entry[]> = { basic: BASIC, dakuten: DAKUTEN, youon: YOUON };

function build(script: KanaScript, group: KanaGroup): KanaCard[] {
  const prefix = script === 'hiragana' ? 'hira' : 'kata';
  return TABLES[group].map(([kana, romaji, ...alt]) => ({
    // Keyed by script and glyph, not by romaji: じ/ぢ and ず/づ share a
    // reading but are different cards, and this id is the SRS key.
    id: `${prefix}-${kana}`,
    glyph: script === 'hiragana' ? kana : toKatakana(kana),
    kana,
    romaji,
    script,
    group,
    alt: alt.length ? alt : undefined,
    voiceOov: VOICE_OOV_KANA.includes(kana) || undefined,
  }));
}

export interface Deck {
  id: DeckId;
  label: string;
  script: KanaScript;
  group: KanaGroup;
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
    const cards = build(script, group);
    return {
      id: `${script === 'hiragana' ? 'hira' : 'kata'}-${group}` as DeckId,
      label: `${SCRIPT_LABELS[script]} · ${GROUP_LABELS[group]} (${cards.length})`,
      script,
      group,
      cards,
    };
  }),
);

export const ALL_CARDS: KanaCard[] = DECKS.flatMap((d) => d.cards);

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
export function drawCards(decks: DeckId[], count: number): KanaCard[] {
  const pool = cardsOf(decks);
  if (pool.length === 0) return [];
  const out: KanaCard[] = [];
  let bag: KanaCard[] = [];
  while (out.length < count) {
    if (bag.length === 0) bag = shuffle(pool);
    out.push(bag.pop()!);
  }
  return out;
}

export function shuffle<T>(items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
