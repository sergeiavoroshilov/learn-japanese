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
    // う after a mora in the о-row is left as a plain vowel rather than a
    // length mark: гаккоу is what a beginner can act on.
    expect(toKiriji('がっこう')).toBe('гаккоу');
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
