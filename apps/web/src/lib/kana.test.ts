import { describe, expect, test } from 'bun:test';
import { KANA_GROUPS, drawCards } from './kana';

const ALL = Object.values(KANA_GROUPS).flat();

describe('kana table', () => {
  test('group sizes match the standard tables', () => {
    expect(KANA_GROUPS.basic).toHaveLength(46);
    expect(KANA_GROUPS.dakuten).toHaveLength(25);
    expect(KANA_GROUPS.youon).toHaveLength(33);
  });

  test('card ids are unique — they are the SRS keys', () => {
    const ids = new Set(ALL.map((c) => c.id));
    expect(ids.size).toBe(ALL.length);
  });

  test('readings that share romaji stay separate cards', () => {
    const ji = ALL.filter((c) => c.romaji === 'ji');
    expect(ji.map((c) => c.glyph).sort()).toEqual(['じ', 'ぢ']);
    expect(new Set(ji.map((c) => c.id)).size).toBe(2);
  });
});

describe('drawCards', () => {
  test('returns the requested count', () => {
    expect(drawCards(['basic'], 20)).toHaveLength(20);
  });

  test('does not repeat a card until the pool is exhausted', () => {
    const cards = drawCards(['basic'], 46);
    expect(new Set(cards.map((c) => c.id)).size).toBe(46);
  });

  test('wraps around for counts beyond the pool', () => {
    expect(drawCards(['basic'], 60)).toHaveLength(60);
  });

  test('no groups selected yields nothing', () => {
    expect(drawCards([], 10)).toEqual([]);
  });
});
