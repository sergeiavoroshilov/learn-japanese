/**
 * Every word and kanji reading the drill can show must be a word the
 * recogniser knows — a card it cannot say is a card that can only be failed.
 *
 *   bun run check:words
 *
 * Run after editing lib/words.ts by hand, and after regenerating the kanji
 * table against a new model.
 */
import { KANJI } from '../apps/web/src/lib/kanji';
import { HIRAGANA_WORDS, KATAKANA_WORDS } from '../apps/web/src/lib/words';

const modelDir = process.argv[2];
if (!modelDir) {
  console.error('usage: bun scripts/check-words.ts <extracted-model-dir>');
  process.exit(1);
}
const known = new Set(
  (await Bun.file(`${modelDir}/graph/words.txt`).text())
    .split('\n')
    .map((line) => line.split(' ')[0] ?? ''),
);

let bad = 0;
const seen = new Set<string>();

for (const [name, list] of [
  ['hiragana', HIRAGANA_WORDS],
  ['katakana', KATAKANA_WORDS],
] as const) {
  for (const entry of list) {
    if (seen.has(entry.w)) {
      console.error(`× ${name}: ${entry.w} listed twice`);
      bad++;
    }
    seen.add(entry.w);
    if (!known.has(entry.w)) {
      console.error(`× ${name}: ${entry.w} (${entry.ru}) is not in the model's lexicon`);
      bad++;
    }
  }
}

for (const k of KANJI) {
  const missing = k.r.filter((r) => !known.has(r));
  if (missing.length > 0) {
    console.error(`× kanji ${k.k}: unknown readings ${missing.join(', ')}`);
    bad++;
  }
}

const total = HIRAGANA_WORDS.length + KATAKANA_WORDS.length;
console.log(
  bad === 0
    ? `ok — ${total} words and ${KANJI.length} kanji, every reading is in the lexicon`
    : `${bad} problem(s)`,
);
process.exit(bad === 0 ? 0 : 1);
