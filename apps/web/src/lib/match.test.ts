import { describe, expect, test } from 'bun:test';
import { ALL_CARDS } from './kana';
import { expectedFor, judge, normalize } from './match';

const card = (glyph: string) => {
  const found = ALL_CARDS.find((c) => c.glyph === glyph);
  if (!found) throw new Error(`no card for ${glyph}`);
  return found;
};

describe('normalize', () => {
  test('folds katakana onto hiragana', () => {
    expect(normalize('ク')).toBe('く');
  });

  test('folds romaji onto hiragana', () => {
    expect(normalize('ku')).toBe('く');
    expect(normalize('SHI')).toBe('し');
  });

  test('drops spacing and punctuation the engine adds', () => {
    expect(normalize(' く 。')).toBe('く');
    expect(normalize('く、')).toBe('く');
  });
});

describe('judge', () => {
  test('accepts the kana itself', () => {
    const v = judge('く', expectedFor(card('く')));
    expect(v.exact).toBe(true);
    expect(v.contains).toBe(true);
  });

  test('accepts katakana and romaji spellings', () => {
    expect(judge('ク', expectedFor(card('く'))).exact).toBe(true);
    expect(judge('ku', expectedFor(card('く'))).exact).toBe(true);
  });

  test('accepts kunrei-shiki alternatives', () => {
    expect(judge('si', expectedFor(card('し'))).exact).toBe(true);
    expect(judge('tu', expectedFor(card('つ'))).exact).toBe(true);
  });

  test('a longer word containing the reading is a substring hit, not exact', () => {
    const v = judge('ください', expectedFor(card('く')));
    expect(v.contains).toBe(true);
    expect(v.exact).toBe(false);
  });

  test('the decoder\'s [unk] filler does not spoil an otherwise exact answer', () => {
    const v = judge('[unk] り', expectedFor(card('り')));
    expect(v.exact).toBe(true);
  });

  test('[unk] alone is not an answer', () => {
    const v = judge('[unk]', expectedFor(card('り')));
    expect(v.exact).toBe(false);
    expect(v.contains).toBe(false);
    expect(v.partial).toBe(false);
  });

  test('[unk] does not turn a wrong mora into a right one', () => {
    expect(judge('[unk] こ', expectedFor(card('く'))).contains).toBe(false);
  });

  test('rejects a different syllable', () => {
    const v = judge('け', expectedFor(card('く')));
    expect(v.contains).toBe(false);
    expect(v.exact).toBe(false);
    expect(v.partial).toBe(false);
  });

  test('an unfinished romaji prefix counts as partial, not as a miss', () => {
    const v = judge('s', expectedFor(card('せ')));
    expect(v.contains).toBe(false);
    expect(v.partial).toBe(true);
  });

  test('an unfinished kana prefix of youon counts as partial', () => {
    const v = judge('き', expectedFor(card('きゃ')));
    expect(v.contains).toBe(false);
    expect(v.partial).toBe(true);
  });

  test('a full match is not reported as partial', () => {
    expect(judge('せ', expectedFor(card('せ'))).partial).toBe(false);
  });

  test('youon is not satisfied by its first kana alone', () => {
    const v = judge('き', expectedFor(card('きゃ')));
    expect(v.contains).toBe(false);
  });
});
