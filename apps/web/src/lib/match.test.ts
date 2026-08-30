import { describe, expect, test } from 'bun:test';
import { ALL_CARDS } from './kana';
import { expectedFor, grammarFor, judge, normalize } from './match';

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

describe('lexicon forms', () => {
  test('a card accepts every spelling of its own mora the model knows', () => {
    const expected = expectedFor(card('い'));
    // All the same reading: held long, «い» is honestly transcribed «いい».
    expect(expected.lexical).toContain('い');
    expect(expected.lexical).toContain('いい');
    expect(expected.lexical).toContain('いー');
    expect(expected.lexical).toContain('イ');
  });

  test('the long forms judge as the same answer', () => {
    for (const said of ['い', 'イ', 'いー', 'イー', 'いい', 'イイ']) {
      expect(judge(said, expectedFor(card('い'))).exact).toBe(true);
    }
  });

  test('they do not make a different mora acceptable', () => {
    for (const said of ['え', 'ええ', 'えー', 'お', 'おお']) {
      expect(judge(said, expectedFor(card('い'))).contains).toBe(false);
    }
  });

  test('the bare mora comes first, so switching long forms off still works', () => {
    const short = expectedFor(card('い'), false);
    expect(short.lexical).toEqual(['い']);
    expect(judge('い', short).exact).toBe(true);
    expect(judge('いい', short).exact).toBe(false);
  });

  test('a deck grammar is the union of its cards, de-duplicated', () => {
    const grammar = grammarFor([card('あ'), card('い')]);
    expect(grammar).toContain('ああ');
    expect(grammar).toContain('いい');
    expect(new Set(grammar).size).toBe(grammar.length);
  });

  test('moras the lexicon has only one form for still work', () => {
    // ぢ and づ have no long variants in this model; they must not break.
    expect(expectedFor(card('ぢ')).lexical).toEqual(['ぢ']);
    expect(judge('ぢ', expectedFor(card('ぢ'))).exact).toBe(true);
  });
});

describe('moras the model has no word for', () => {
  test('still have an accepted reading rather than an empty grammar', () => {
    // びゃ is absent from the lexicon; the card is kept out of voice sessions,
    // but nothing downstream may be handed an empty word list.
    const expected = expectedFor(card('びゃ'));
    expect(expected.lexical).toEqual(['びゃ']);
    expect(judge('びゃ', expected).exact).toBe(true);
  });
});
