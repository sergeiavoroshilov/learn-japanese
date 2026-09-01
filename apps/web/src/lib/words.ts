/**
 * Short kana words — two or three moras read as one unit rather than one
 * mora at a time.
 *
 * Written by hand, not generated, and that is deliberate. Deriving this list
 * from the JMdict-based dataset produced あて glossed «father», いろは glossed
 * «mother» and いそ glossed «fifty»: archaic readings paired with whichever
 * sense happened to sort first. A drill that teaches one of those is worse
 * than a drill that is short, so this list is small enough to be read by a
 * person — and it should be, before it is trusted.
 *
 * Every reading here is checked against the recogniser's own lexicon by
 * `bun run check:words`; a word it cannot say cannot be drilled.
 */
export interface WordEntry {
  /** Shown on the card. Already kana, so it reads exactly as written. */
  w: string;
  /** Russian meaning. */
  ru: string;
  /** English meaning, for the same reason the kanji carry one. */
  en: string;
}

/** Everyday nouns a beginner meets first, all in plain hiragana. */
export const HIRAGANA_WORDS: WordEntry[] = [
  { w: 'やま', ru: 'гора', en: 'mountain' },
  { w: 'うみ', ru: 'море', en: 'sea' },
  { w: 'そら', ru: 'небо', en: 'sky' },
  { w: 'かわ', ru: 'река', en: 'river' },
  { w: 'いし', ru: 'камень', en: 'stone' },
  { w: 'き', ru: 'дерево', en: 'tree' },
  { w: 'はな', ru: 'цветок', en: 'flower' },
  { w: 'みず', ru: 'вода', en: 'water' },
  { w: 'ひ', ru: 'огонь', en: 'fire' },
  { w: 'かぜ', ru: 'ветер', en: 'wind' },
  { w: 'あめ', ru: 'дождь', en: 'rain' },
  { w: 'ゆき', ru: 'снег', en: 'snow' },
  { w: 'つき', ru: 'луна', en: 'moon' },
  { w: 'ほし', ru: 'звезда', en: 'star' },
  { w: 'あさ', ru: 'утро', en: 'morning' },
  { w: 'ひる', ru: 'день, полдень', en: 'daytime, noon' },
  { w: 'よる', ru: 'ночь', en: 'night' },
  { w: 'いま', ru: 'сейчас', en: 'now' },
  { w: 'ねこ', ru: 'кошка', en: 'cat' },
  { w: 'いぬ', ru: 'собака', en: 'dog' },
  { w: 'とり', ru: 'птица', en: 'bird' },
  { w: 'さかな', ru: 'рыба', en: 'fish' },
  { w: 'うし', ru: 'корова', en: 'cow' },
  { w: 'うま', ru: 'лошадь', en: 'horse' },
  { w: 'ひと', ru: 'человек', en: 'person' },
  { w: 'こども', ru: 'ребёнок', en: 'child' },
  { w: 'おとこ', ru: 'мужчина', en: 'man' },
  { w: 'おんな', ru: 'женщина', en: 'woman' },
  { w: 'ともだち', ru: 'друг', en: 'friend' },
  { w: 'あたま', ru: 'голова', en: 'head' },
  { w: 'め', ru: 'глаз', en: 'eye' },
  { w: 'みみ', ru: 'ухо', en: 'ear' },
  { w: 'くち', ru: 'рот', en: 'mouth' },
  { w: 'て', ru: 'рука', en: 'hand' },
  { w: 'あし', ru: 'нога', en: 'leg, foot' },
  { w: 'いえ', ru: 'дом', en: 'house' },
  { w: 'まち', ru: 'город', en: 'town' },
  { w: 'みち', ru: 'дорога', en: 'road' },
  { w: 'くるま', ru: 'машина', en: 'car' },
  { w: 'とけい', ru: 'часы', en: 'clock, watch' },
  { w: 'ほん', ru: 'книга', en: 'book' },
  { w: 'かみ', ru: 'бумага', en: 'paper' },
  { w: 'えき', ru: 'станция', en: 'station' },
  { w: 'たまご', ru: 'яйцо', en: 'egg' },
  { w: 'にく', ru: 'мясо', en: 'meat' },
  { w: 'さけ', ru: 'сакэ, алкоголь', en: 'sake, alcohol' },
  { w: 'しお', ru: 'соль', en: 'salt' },
  { w: 'あお', ru: 'синий', en: 'blue' },
  { w: 'あか', ru: 'красный', en: 'red' },
  { w: 'しろ', ru: 'белый', en: 'white' },
  { w: 'くろ', ru: 'чёрный', en: 'black' },
  { w: 'おおきい', ru: 'большой', en: 'big' },
  { w: 'たかい', ru: 'высокий, дорогой', en: 'tall, expensive' },
  { w: 'あたらしい', ru: 'новый', en: 'new' },
  { w: 'いち', ru: 'один', en: 'one' },
  { w: 'に', ru: 'два', en: 'two' },
  { w: 'さん', ru: 'три', en: 'three' },
  { w: 'はる', ru: 'весна', en: 'spring' },
  { w: 'なつ', ru: 'лето', en: 'summer' },
  { w: 'あき', ru: 'осень', en: 'autumn' },
  { w: 'ふゆ', ru: 'зима', en: 'winter' },
  { w: 'がっこう', ru: 'школа', en: 'school' },
  { w: 'せんせい', ru: 'учитель', en: 'teacher' },
  { w: 'でんわ', ru: 'телефон', en: 'telephone' },
  { w: 'おかね', ru: 'деньги', en: 'money' },
  { w: 'なまえ', ru: 'имя', en: 'name' },
];

/** Loanwords, which is what katakana is mostly used for. */
export const KATAKANA_WORDS: WordEntry[] = [
  { w: 'パン', ru: 'хлеб', en: 'bread' },
  { w: 'ペン', ru: 'ручка', en: 'pen' },
  { w: 'バス', ru: 'автобус', en: 'bus' },
  { w: 'ドア', ru: 'дверь', en: 'door' },
  { w: 'カメラ', ru: 'фотоаппарат', en: 'camera' },
  { w: 'テレビ', ru: 'телевизор', en: 'television' },
  { w: 'ラジオ', ru: 'радио', en: 'radio' },
  { w: 'ホテル', ru: 'отель', en: 'hotel' },
  { w: 'コーヒー', ru: 'кофе', en: 'coffee' },
  { w: 'ケーキ', ru: 'торт', en: 'cake' },
  { w: 'ビール', ru: 'пиво', en: 'beer' },
  { w: 'ミルク', ru: 'молоко', en: 'milk' },
  { w: 'ジュース', ru: 'сок', en: 'juice' },
  { w: 'テーブル', ru: 'стол', en: 'table' },
  { w: 'ノート', ru: 'тетрадь', en: 'notebook' },
  { w: 'タクシー', ru: 'такси', en: 'taxi' },
  { w: 'スーパー', ru: 'супермаркет', en: 'supermarket' },
  { w: 'アメリカ', ru: 'Америка', en: 'America' },
  { w: 'ロシア', ru: 'Россия', en: 'Russia' },
  { w: 'シャツ', ru: 'рубашка', en: 'shirt' },
  { w: 'スポーツ', ru: 'спорт', en: 'sport' },
  { w: 'ギター', ru: 'гитара', en: 'guitar' },
  { w: 'ピアノ', ru: 'пианино', en: 'piano' },
  { w: 'ボール', ru: 'мяч', en: 'ball' },
  { w: 'カード', ru: 'карта, карточка', en: 'card' },
  { w: 'メール', ru: 'имейл, электронное письмо', en: 'email' },
  { w: 'ニュース', ru: 'новости', en: 'news' },
  { w: 'クラス', ru: 'класс', en: 'class' },
  { w: 'ホーム', ru: 'платформа (на станции)', en: 'platform' },
];
