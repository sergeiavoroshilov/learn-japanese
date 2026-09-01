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
/** What a length mark repeats: я is a long а, not a second я. */
const LENGTHENS: Record<string, string> = { я: 'а', ю: 'у', ё: 'о' };
/** ん assimilates before these. */
const LABIAL = new Set(['ば', 'び', 'ぶ', 'べ', 'ぼ', 'ぱ', 'ぴ', 'ぷ', 'ぺ', 'ぽ', 'ま', 'み', 'む', 'め', 'も']);
/** After ん, a vowel or a yotated mora needs a hard sign to stay separate. */
const NEEDS_HARD_SIGN = new Set(['あ', 'い', 'う', 'え', 'お', 'や', 'ゆ', 'よ']);
/**
 * Vowels after which い is written й. Only а and э: あい and えい are the
 * falling diphthongs Russian renders that way (такай, сэнсэй, токэй), while
 * おい and うい are two separate vowels (おいしい — оисии) and いい is simply
 * long (おおきい — оокии).
 */
const DIPHTHONG_BASE = new Set(['а', 'э']);
/** Moras whose Cyrillic ends in the vowel that う lengthens. */
const O_ROW = new Set([
  'お', 'こ', 'そ', 'と', 'の', 'ほ', 'も', 'よ', 'ろ', 'ご', 'ぞ', 'ど', 'ぼ', 'ぽ',
  'きょ', 'しょ', 'ちょ', 'にょ', 'ひょ', 'みょ', 'りょ', 'ぎょ', 'じょ', 'びょ', 'ぴょ',
]);
const U_ROW = new Set([
  'う', 'く', 'す', 'つ', 'ぬ', 'ふ', 'む', 'ゆ', 'る', 'ぐ', 'ず', 'づ', 'ぶ', 'ぷ',
  'きゅ', 'しゅ', 'ちゅ', 'にゅ', 'ひゅ', 'みゅ', 'りゅ', 'ぎゅ', 'じゅ', 'びゅ', 'ぴゅ',
]);

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
  /** The mora just written, so length marks know what they are lengthening. */
  let previous = '';

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    const next = src[i + 1];
    const digraph = next && SMALL_Y.has(next) && MORA[ch + next] ? ch + next : null;
    const mora = digraph ?? ch;

    if (ch === 'っ') {
      // Gemination doubles the consonant that follows, and it is written
      // before the mora it belongs to, so it has to look ahead. Doubling the
      // first Cyrillic letter is the whole rule: きって → киттэ, まっちゃ →
      // маття, よっつ → ёццу.
      const ahead = next && SMALL_Y.has(src[i + 2] ?? '') ? next + src[i + 2]! : (next ?? '');
      const after = MORA[ahead];
      if (after) out += after[0];
      continue;
    }

    if (ch === 'ー') {
      const last = out.at(-1);
      if (last && VOWELS.has(last)) out += LENGTHENS[last] ?? last;
      continue;
    }

    if (ch === 'ん') {
      // Before a labial ん is written м — симбун, сэмпай — and before a vowel
      // or a yotated mora it needs a hard sign to keep the syllables apart:
      // хонъя, not хоня.
      out += next && LABIAL.has(next) ? 'м' : 'н';
      if (next && NEEDS_HARD_SIGN.has(next)) out += 'ъ';
      previous = ch;
      continue;
    }

    if (ch === 'い' && DIPHTHONG_BASE.has(out.at(-1) ?? '')) {
      // い after another vowel is a diphthong, and Russian writes it with й:
      // сэнсэй, токэй, сэмпай, такай. Only after и does it stay и —
      // おいしい is оисии, not оисий.
      out += 'й';
      previous = ch;
      continue;
    }

    if (ch === 'う' && (O_ROW.has(previous) || U_ROW.has(previous))) {
      // おう and うう are length, not a diphthong. Writing «гаккоу» would have
      // the learner pronounce an о and then a у, which is not the word.
      const last = out.at(-1);
      if (last && VOWELS.has(last)) out += LENGTHENS[last] ?? last;
      previous = ch;
      continue;
    }

    out += MORA[mora] ?? mora;
    previous = mora;
    if (digraph) i++;
  }
  return out;
}
