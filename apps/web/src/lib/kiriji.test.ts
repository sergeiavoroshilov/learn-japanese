import { describe, expect, test } from 'bun:test';
import { ALL_CARDS } from './kana';
import { toKiriji } from './kiriji';

describe('toKiriji', () => {
  test('every mora in the tables has a transliteration', () => {
    for (const card of ALL_CARDS) {
      expect(toKiriji(card.kana)).not.toBe(card.kana);
    }
  });

  test('follows Polivanov where it differs from Hepburn — that is the point', () => {
    // Hepburn's shi/chi/tsu/ji lead a Russian speaker straight to «щи» and
    // «джи»; these are the spellings that do not.
    expect(toKiriji('し')).toBe('си');
    expect(toKiriji('ち')).toBe('ти');
    expect(toKiriji('つ')).toBe('цу');
    expect(toKiriji('じ')).toBe('дзи');
    expect(toKiriji('しゃ')).toBe('ся');
    expect(toKiriji('ちょ')).toBe('тё');
    expect(toKiriji('じゅ')).toBe('дзю');
  });

  test('katakana reads the same as hiragana', () => {
    expect(toKiriji('カメラ')).toBe(toKiriji('かめら'));
    expect(toKiriji('カメラ')).toBe('камэра');
  });

  test('joins moras into words', () => {
    expect(toKiriji('やま')).toBe('яма');
    expect(toKiriji('にほん')).toBe('нихон');
    expect(toKiriji('がっこう')).toBe('гаккоо');
  });

  test('っ doubles the consonant that follows it', () => {
    // て is тэ, so the doubled consonant lands before it: киттэ.
    expect(toKiriji('きって')).toBe('киттэ');
    expect(toKiriji('いっしょ')).toBe('иссё');
  });

  test('ー lengthens the vowel before it', () => {
    expect(toKiriji('コーヒー')).toBe('коохии');
    expect(toKiriji('テーブル')).toBe('тээбуру');
  });

  test('anything unknown is passed through, not swallowed', () => {
    expect(toKiriji('日')).toBe('日');
  });
});

describe('length and assimilation', () => {
  test('えい is a long e, written with й as Russian does', () => {
    expect(toKiriji('せんせい')).toBe('сэнсэй');
    expect(toKiriji('とけい')).toBe('токэй');
  });

  test('おう and うう are length, not a diphthong', () => {
    // «гаккоу» would have the learner say an о and then a у, which is not
    // the word; the vowel is simply long.
    expect(toKiriji('がっこう')).toBe('гаккоо');
    expect(toKiriji('とうきょう')).toBe('тоокёо');
    expect(toKiriji('ゆうめい')).toBe('юумэй');
  });

  test('ん becomes м before a labial', () => {
    expect(toKiriji('しんぶん')).toBe('симбун');
    expect(toKiriji('せんぱい')).toBe('сэмпай');
  });

  test('ん takes a hard sign before a vowel or a yotated mora', () => {
    // Without it хонъや reads as хо-ня, a different word.
    expect(toKiriji('ほんや')).toBe('хонъя');
    expect(toKiriji('しんいち')).toBe('синъити');
  });

  test('gemination doubles the first letter of the mora that follows', () => {
    expect(toKiriji('まっちゃ')).toBe('маття');
    expect(toKiriji('よっつ')).toBe('ёццу');
  });

  test('い is й only where Russian actually writes it so', () => {
    expect(toKiriji('たかい')).toBe('такай');
    // おい and いい are not diphthongs: two vowels, and a long one.
    expect(toKiriji('おいしい')).toBe('оисии');
    expect(toKiriji('おおきい')).toBe('оокии');
  });

  test('a length mark after a yotated mora repeats the vowel, not the yot', () => {
    expect(toKiriji('ジャー')).toBe('дзяа');
  });
});
