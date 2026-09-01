/**
 * Kana → Cyrillic (Polivanov), the transliteration Russian textbooks use.
 *
 * Written out per mora rather than derived from romaji: the two systems
 * disagree exactly where beginners need help — Hepburn's shi/chi/tsu/ji are
 * Polivanov's си/ти/цу/дзи, and a rule built from the Latin spelling would
 * reproduce «щи», which is precisely the mispronunciation to avoid.
 */
const MORA: Record<string, string> = {
  あ: 'а', い: 'и', う: 'у', え: 'э', お: 'о',
  か: 'ка', き: 'ки', く: 'ку', け: 'кэ', こ: 'ко',
  さ: 'са', し: 'си', す: 'су', せ: 'сэ', そ: 'со',
  た: 'та', ち: 'ти', つ: 'цу', て: 'тэ', と: 'то',
  な: 'на', に: 'ни', ぬ: 'ну', ね: 'нэ', の: 'но',
  は: 'ха', ひ: 'хи', ふ: 'фу', へ: 'хэ', ほ: 'хо',
  ま: 'ма', み: 'ми', む: 'му', め: 'мэ', も: 'мо',
  や: 'я', ゆ: 'ю', よ: 'ё',
  ら: 'ра', り: 'ри', る: 'ру', れ: 'рэ', ろ: 'ро',
  わ: 'ва', を: 'о', ん: 'н',
  が: 'га', ぎ: 'ги', ぐ: 'гу', げ: 'гэ', ご: 'го',
  ざ: 'дза', じ: 'дзи', ず: 'дзу', ぜ: 'дзэ', ぞ: 'дзо',
  だ: 'да', ぢ: 'дзи', づ: 'дзу', で: 'дэ', ど: 'до',
  ば: 'ба', び: 'би', ぶ: 'бу', べ: 'бэ', ぼ: 'бо',
  ぱ: 'па', ぴ: 'пи', ぷ: 'пу', ぺ: 'пэ', ぽ: 'по',
  きゃ: 'кя', きゅ: 'кю', きょ: 'кё',
  しゃ: 'ся', しゅ: 'сю', しょ: 'сё',
  ちゃ: 'тя', ちゅ: 'тю', ちょ: 'тё',
  にゃ: 'ня', にゅ: 'ню', にょ: 'нё',
  ひゃ: 'хя', ひゅ: 'хю', ひょ: 'хё',
  みゃ: 'мя', みゅ: 'мю', みょ: 'мё',
  りゃ: 'ря', りゅ: 'рю', りょ: 'рё',
  ぎゃ: 'гя', ぎゅ: 'гю', ぎょ: 'гё',
  じゃ: 'дзя', じゅ: 'дзю', じょ: 'дзё',
  びゃ: 'бя', びゅ: 'бю', びょ: 'бё',
  ぴゃ: 'пя', ぴゅ: 'пю', ぴょ: 'пё',
};

const SMALL_Y = new Set(['ゃ', 'ゅ', 'ょ']);
const VOWELS = new Set(['а', 'и', 'у', 'э', 'о', 'я', 'ю', 'ё']);

function toHiragana(s: string): string {
  return [...s]
    .map((c) => {
      const code = c.codePointAt(0)!;
      return code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : c;
    })
    .join('');
}

/**
 * Transliterate a kana string. Katakana is folded onto hiragana first — the
 * sound is the same and so is its Cyrillic.
 *
 * The two length marks are written the way a reader can act on them: ー and a
 * repeated vowel both double the vowel (тэ→тээ), and っ doubles the next
 * consonant (きって → китте). Anything the table does not know is passed
 * through rather than dropped, so a gap shows up instead of hiding.
 */
export function toKiriji(kana: string): string {
  const src = toHiragana(kana);
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    const next = src[i + 1];

    if (next && SMALL_Y.has(next) && MORA[ch + next]) {
      out += MORA[ch + next];
      i++;
      continue;
    }
    if (ch === 'っ') {
      // Gemination: the following consonant is doubled. Written before the
      // mora it belongs to, so it has to peek ahead.
      const after = next && SMALL_Y.has(src[i + 2] ?? '') ? MORA[next + src[i + 2]!] : MORA[next ?? ''];
      if (after) out += after[0];
      continue;
    }
    if (ch === 'ー') {
      const last = out.at(-1);
      if (last && VOWELS.has(last)) out += last;
      continue;
    }
    out += MORA[ch] ?? ch;
  }
  return out;
}
