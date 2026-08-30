import { describe, expect, test } from 'bun:test';
import { cardById } from './kana';
import { correctionFor, moraOf } from './pronounce';

const card = (id: string) => cardById(id)!;

describe('moraOf', () => {
  test('reads back every spelling the decoder might return', () => {
    for (const said of ['い', 'イ', 'いい', 'イイ', 'いー']) {
      expect(moraOf(said)?.kana).toBe('い');
    }
  });

  test('a transcript that is not a mora is not forced into one', () => {
    expect(moraOf('[unk]')).toBeNull();
    expect(moraOf('こんにちは')).toBeNull();
  });
});

describe('correctionFor', () => {
  test('/u/ heard as /o/ is named as lip rounding — the run-8 finding', () => {
    const note = correctionFor(card('hira-う'), ['を']);
    expect(note?.heard).toBe('を');
    expect(note?.hint).toContain('округления губ');
  });

  test('the same rule covers the whole /u/ column, not just the bare vowel', () => {
    // る→ろ, つ→そ and ゆ→よ are one error, seen in three separate runs.
    expect(correctionFor(card('hira-る'), ['ろ'])?.hint).toContain('округления губ');
    expect(correctionFor(card('hira-つ'), ['そ'])?.hint).toContain('округления губ');
    expect(correctionFor(card('hira-ゆ'), ['ヨ'])?.hint).toContain('округления губ');
  });

  test('a vowel added to the syllabic nasal is named', () => {
    expect(correctionFor(card('hira-ん'), ['ぬ'])?.hint).toContain('без гласного');
  });

  test('へ heard as せ is about the Russian «х», not about the vowel', () => {
    expect(correctionFor(card('hira-へ'), ['せ'])?.hint).toContain('выдох');
  });

  test('an unremarkable mix-up still says what was heard', () => {
    const note = correctionFor(card('hira-か'), ['き']);
    expect(note?.heard).toBe('き');
    expect(note?.hint).toContain('другой гласный');
  });

  test('hearing the card itself is not a correction', () => {
    expect(correctionFor(card('hira-い'), ['イイ'])).toBeNull();
  });

  test('«[unk]» carries no correction — nothing was heard to correct', () => {
    expect(correctionFor(card('hira-い'), ['[unk]', '[unk]'])).toBeNull();
  });

  test('katakana cards get the same corrections as their hiragana twins', () => {
    expect(correctionFor(card('kata-う'), ['オ'])?.hint).toContain('округления губ');
  });
});
