import { describe, expect, test } from 'bun:test';
import { ALL_CARDS, DECKS, cardById, cardsOf, drawCards } from './kana';

describe('kana tables', () => {
  test('every script has the standard group sizes', () => {
    for (const deck of DECKS) {
      const expected = { basic: 46, dakuten: 25, youon: 33 }[deck.group];
      expect(deck.cards).toHaveLength(expected);
    }
    expect(DECKS).toHaveLength(6);
  });

  test('card ids are unique — they are the SRS keys', () => {
    expect(new Set(ALL_CARDS.map((c) => c.id)).size).toBe(ALL_CARDS.length);
  });

  test('readings that share romaji stay separate cards', () => {
    const ji = ALL_CARDS.filter((c) => c.romaji === 'ji' && c.script === 'hiragana');
    expect(ji.map((c) => c.glyph).sort()).toEqual(['じ', 'ぢ']);
    expect(new Set(ji.map((c) => c.id)).size).toBe(2);
  });

  test('the same mora in two scripts is two cards with one reading', () => {
    const hira = cardById('hira-か')!;
    const kata = cardById('kata-か')!;
    expect(hira.glyph).toBe('か');
    expect(kata.glyph).toBe('カ');
    // What the recogniser is asked for is the reading, never the glyph.
    expect(kata.kana).toBe('か');
    expect(kata.romaji).toBe(hira.romaji);
  });

  test('katakana youon are built as digraphs, not single characters', () => {
    expect(cardById('kata-きゃ')!.glyph).toBe('キャ');
  });

  test('moras outside the recogniser lexicon are flagged', () => {
    expect(cardById('hira-びゃ')!.voiceOov).toBe(true);
    expect(cardById('kata-びゃ')!.voiceOov).toBe(true);
    expect(cardById('hira-か')!.voiceOov).toBeUndefined();
  });
});

describe('drawCards', () => {
  test('returns the requested count', () => {
    expect(drawCards(['hira-basic'], 20)).toHaveLength(20);
  });

  test('does not repeat a card until the pool is exhausted', () => {
    const cards = drawCards(['hira-basic'], 46);
    expect(new Set(cards.map((c) => c.id)).size).toBe(46);
  });

  test('wraps around for counts beyond the pool', () => {
    expect(drawCards(['hira-basic'], 60)).toHaveLength(60);
  });

  test('no decks selected yields nothing', () => {
    expect(drawCards([], 10)).toEqual([]);
  });

  test('draws across every selected deck', () => {
    expect(cardsOf(['hira-basic', 'kata-basic'])).toHaveLength(92);
  });
});
