export type KanaGroup = 'basic' | 'dakuten' | 'youon';

export interface KanaCard {
  id: string;
  glyph: string;
  /** Canonical reading in hiragana. */
  kana: string;
  /** Hepburn romaji, shown to the user as the answer key. */
  romaji: string;
  group: KanaGroup;
  /** Extra romaji spellings an engine might return (kunrei-shiki etc). */
  alt?: string[];
}

function row(group: KanaGroup, entries: [string, string, ...string[]][]): KanaCard[] {
  return entries.map(([glyph, romaji, ...alt]) => ({
    // Keyed by the glyph, not the romaji: じ/ぢ and ず/づ share a reading but
    // are different cards, and this id is the SRS key later.
    id: `hira-${glyph}`,
    glyph,
    kana: glyph,
    romaji,
    group,
    alt: alt.length ? alt : undefined,
  }));
}

/** 46 base hiragana. */
const BASIC = row('basic', [
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
]);

/** Voiced / semi-voiced. */
const DAKUTEN = row('dakuten', [
  ['が', 'ga'], ['ぎ', 'gi'], ['ぐ', 'gu'], ['げ', 'ge'], ['ご', 'go'],
  ['ざ', 'za'], ['じ', 'ji', 'zi'], ['ず', 'zu'], ['ぜ', 'ze'], ['ぞ', 'zo'],
  ['だ', 'da'], ['ぢ', 'ji', 'di'], ['づ', 'zu', 'du'], ['で', 'de'], ['ど', 'do'],
  ['ば', 'ba'], ['び', 'bi'], ['ぶ', 'bu'], ['べ', 'be'], ['ぼ', 'bo'],
  ['ぱ', 'pa'], ['ぴ', 'pi'], ['ぷ', 'pu'], ['ぺ', 'pe'], ['ぽ', 'po'],
]);

/** Contracted sounds. */
const YOUON = row('youon', [
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
]);

export const KANA_GROUPS: Record<KanaGroup, KanaCard[]> = {
  basic: BASIC,
  dakuten: DAKUTEN,
  youon: YOUON,
};

export const GROUP_LABELS: Record<KanaGroup, string> = {
  basic: 'Базовые (46)',
  dakuten: 'Дакутэн (25)',
  youon: 'Ёон (33)',
};

/** Random cards without repeating a glyph until the pool is exhausted. */
export function drawCards(groups: KanaGroup[], count: number): KanaCard[] {
  const pool = groups.flatMap((g) => KANA_GROUPS[g]);
  if (pool.length === 0) return [];
  const out: KanaCard[] = [];
  let bag: KanaCard[] = [];
  while (out.length < count) {
    if (bag.length === 0) bag = shuffle(pool);
    out.push(bag.pop()!);
  }
  return out;
}

function shuffle<T>(items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
