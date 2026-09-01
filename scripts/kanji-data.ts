/**
 * Regenerate apps/web/src/lib/kanji.ts from the `kanji-data` package (MIT,
 * derived from KANJIDIC2) and a Vosk model's word list.
 *
 *   tar xzf apps/web/public/models/vosk-model-small-ja-0.22.tar.gz -C /tmp
 *   bun scripts/kanji-data.ts /tmp/vosk-model-small-ja-0.22
 *
 * A card is one character, and every on/kun reading the recogniser can
 * actually say counts as a correct answer.
 *
 * VISION.md asks for readings inside real words instead, and that is the
 * right end state — but it needs a vetted vocabulary list, which this
 * dataset is not. Selecting words from it automatically produces 五十 read
 * 「い」 and 三人 read 「みたり」: archaic readings a learner must not be
 * taught. Until there is a reviewed word list, a card asks the honest
 * smaller question — how is this character read — and every answer it
 * accepts is a real reading of it.
 */
import kanjiData from 'kanji-data';

const modelDir = process.argv[2];
if (!modelDir) {
  console.error('usage: bun scripts/kanji-data.ts <extracted-model-dir>');
  process.exit(1);
}

const wordsFile = Bun.file(`${modelDir}/graph/words.txt`);
if (!(await wordsFile.exists())) {
  console.error(`no ${modelDir}/graph/words.txt — is that an extracted Vosk model?`);
  process.exit(1);
}
const known = new Set(
  (await wordsFile.text()).split('\n').map((line) => line.split(' ')[0] ?? ''),
);

function toHiragana(s: string): string {
  return [...s]
    .map((c) => {
      const code = c.codePointAt(0)!;
      return code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : c;
    })
    .join('');
}
function toKatakana(s: string): string {
  return [...s]
    .map((c) => {
      const code = c.codePointAt(0)!;
      return code >= 0x3041 && code <= 0x3096 ? String.fromCodePoint(code + 0x60) : c;
    })
    .join('');
}

interface Meta {
  kanji: string;
  jlpt?: number;
  freq_mainichi_shinbun?: number;
  /** Alphabetically sorted by the package — see the note in `sensesOf`. */
  meanings?: string[];
  /** Heisig's single keyword for the character. */
  heisig_en?: string;
  on_readings?: string[];
  kun_readings?: string[];
}

/**
 * Readings that survive every rule below but should not: on-readings that
 * only live inside one place name or one archaism. There is no field marking
 * them, so they are named here, and the list is meant to grow as they are
 * found.
 */
const REJECTED: Record<string, string[]> = {
  三: ['ぞう'],
  上: ['しゃん'],          // only in 上海
  二: ['ふたたび'],         // «again», a word, not a reading of «two»
  円: ['まど', 'まろ'],
  百: ['もも'],
  十: ['そ'],
  政: ['まん'],
  済: ['わたし'],
  号: ['よびな'],
};

const api = kanjiData as unknown as {
  get(k: string): Meta | undefined;
  getJlpt(level: number): string[];
};

/**
 * KANJIDIC writes okurigana as «う.まれる» — the stem before the dot is what
 * the character itself spells, and that is a reading of it.
 *
 * A hyphen marks a *bound* form: «-か» and «-び» for 日 only exist as a
 * suffix (三日, 日曜日), never as an answer to «how is this read». Left in,
 * 日 would accept か and 人 would accept り, which turns the card into a
 * freebie and teaches a reading nobody uses on its own.
 */
function readingsOf(meta: Meta): string[] {
  const rejected = REJECTED[meta.kanji] ?? [];
  const out: string[] = [];

  const take = (raw: string[], okurigana: boolean) => {
    for (const r of raw) {
      // A hyphen marks a bound form: «-か» for 日 exists only as a suffix.
      if (r.includes('-')) continue;
      // A dot marks okurigana. The stem before it is not a reading of the
      // character on its own: 号's «さけ.ぶ» would accept «сакэ» for a
      // character read ごう, and 済's «わた.る» would accept «вата».
      if (!okurigana && r.includes('.')) continue;
      const base = toHiragana(r).split('.')[0] ?? '';
      // A reading ending in っ is a prefix form before gemination — 十's
      // «じっ» exists only in じっぷん, never alone.
      if (!base || base.endsWith('っ')) continue;
      if (rejected.includes(base) || out.includes(base)) continue;
      out.push(base);
    }
  };

  take(meta.on_readings ?? [], false);
  take(meta.kun_readings ?? [], false);
  // Characters made in Japan (峠, 込) have no on-reading at all. For those the
  // okurigana stem is the only reading there is, so take it rather than ship
  // a card with no answer.
  if (out.length === 0) take(meta.kun_readings ?? [], true);
  return out;
}

/**
 * The senses, most useful first.
 *
 * `meanings` comes out of the package sorted **alphabetically**, which is why
 * 日 used to lead with «Japan» and truncating to three lost «see» from 見 and
 * «school» from 校 entirely. Heisig's keyword is one curated sense per
 * character, so it leads; everything else follows, untruncated, so nothing
 * can go missing again. Where Heisig's mnemonic differs from the everyday
 * sense (校 → «exam»), the everyday one is still in the list behind it.
 */
function sensesOf(meta: Meta): string[] {
  const all = (meta.meanings ?? []).filter((m) => !/\bradical\b|\(no\.\s*\d+\)/i.test(m));
  const primary = meta.heisig_en;
  if (!primary) return all;
  return [primary, ...all.filter((m) => m.toLowerCase() !== primary.toLowerCase())];
}

const LEVELS = [5, 4, 3] as const;
const lines: string[] = [];
let cards = 0;
let dropped = 0;

for (const level of LEVELS) {
  const list = api.getJlpt(level);
  const rows = list
    .map((k) => ({ k, meta: api.get(k) }))
    .filter((r): r is { k: string; meta: Meta } => r.meta !== undefined)
    // Newspaper frequency: rank 1 is the most used character in print.
    .sort(
      (a, b) =>
        (a.meta.freq_mainichi_shinbun ?? 9999) - (b.meta.freq_mainichi_shinbun ?? 9999),
    );

  for (const { k, meta } of rows) {
    // Both scripts: the decoder may return an on-reading in either.
    const forms: string[] = [];
    for (const r of readingsOf(meta)) {
      for (const form of [r, toKatakana(r)]) {
        if (known.has(form) && !forms.includes(form)) forms.push(form);
      }
    }
    if (forms.length === 0) {
      dropped++;
      continue;
    }
    const meanings = sensesOf(meta);
    cards++;
    lines.push(
      `  { k: '${k}', n: ${level}, f: ${meta.freq_mainichi_shinbun ?? 0}, ` +
        `r: [${forms.map((f) => `'${f}'`).join(', ')}], ` +
        `m: ${JSON.stringify(meanings)} },`,
    );
  }
}

const header = `/**
 * JLPT N5–N3 kanji, ordered by how often they appear in print (Mainichi
 * Shimbun frequency rank, 1 = most frequent). Generated from the \`kanji-data\`
 * package (MIT, derived from KANJIDIC2) and checked against the recogniser's
 * own word list — a reading it cannot say is not offered as an answer.
 *
 * A card is one character and accepts the readings it has on its own —
 * okurigana stems, bound prefixes and suffixes are not among them. VISION.md
 * asks for readings inside real words, which is the right end state and needs
 * a vetted vocabulary list; deriving one from this dataset automatically
 * yields 五十 read 「い」 and 三人 read 「みたり」, archaic readings nobody should
 * be taught. See scripts/kanji-data.ts.
 *
 * Regenerate with: bun run kanji
 */
export interface KanjiEntry {
  /** The character. */
  k: string;
  /** JLPT level: 5, 4 or 3. */
  n: number;
  /** Newspaper frequency rank; lower is more common. */
  f: number;
  /** Accepted readings, in both scripts, filtered to the model's lexicon. */
  r: string[];
  /** English senses, the most useful one first. */
  m: string[];
}

export const KANJI: KanjiEntry[] = [
`;

await Bun.write('apps/web/src/lib/kanji.ts', `${header}${lines.join('\n')}\n];\n`);
console.log(`${cards} kanji -> apps/web/src/lib/kanji.ts` + (dropped ? ` (${dropped} dropped)` : ''));
