import { describe, expect, test } from 'bun:test';
import { UNLOCK_SHARE, curriculum, currentLevel, reachedCards } from './curriculum';
import { LEVELS } from './levels';
import { applyAnswer, newProgress, type CardProgress } from './srs';

const NOW = new Date('2026-09-01T09:00:00Z');

/** A card answered right twice, far enough apart that FSRS calls it learned. */
function learnedCard(id: string): CardProgress {
  const first = applyAnswer(newProgress(id, NOW), { quality: 'correct', onsetMs: 500 }, NOW);
  const later = new Date(first.progress.fsrs.due);
  return applyAnswer(first.progress, { quality: 'correct', onsetMs: 500 }, later).progress;
}

function lookup(states: Record<string, CardProgress>) {
  return (id: string) => states[id] ?? newProgress(id, NOW);
}

/** Learn the given share of a level, rounded up. */
function learnLevel(states: Record<string, CardProgress>, index: number, share = 1) {
  const cards = LEVELS[index]!.cards.filter((c) => !c.voiceOov);
  for (const card of cards.slice(0, Math.ceil(cards.length * share))) {
    states[card.id] = learnedCard(card.id);
  }
}

describe('curriculum', () => {
  test('is ordered kana first, then kanji by JLPT level', () => {
    expect(LEVELS.map((l) => l.id)).toEqual([
      'hira-basic',
      'hira-dakuten',
      'hira-youon',
      'kata-basic',
      'kata-dakuten',
      'kata-youon',
      'kanji-n5',
      'kanji-n4',
      'kanji-n3',
    ]);
  });

  test('kanji are ordered by how often they appear in print', () => {
    const n5 = LEVELS.find((l) => l.id === 'kanji-n5')!;
    expect(n5.cards[0]!.glyph).toBe('日');
    expect(n5.cards[1]!.glyph).toBe('一');
  });

  test('only the first level is open to a beginner', () => {
    const state = curriculum(lookup({}), NOW);
    expect(state.filter((l) => l.unlocked).map((l) => l.level.id)).toEqual(['hira-basic']);
    expect(currentLevel(state)!.level.id).toBe('hira-basic');
  });

  test('a level opens when the one before it is learned', () => {
    const states: Record<string, CardProgress> = {};
    learnLevel(states, 0);
    const state = curriculum(lookup(states), NOW);
    expect(state[0]!.complete).toBe(true);
    expect(state[1]!.unlocked).toBe(true);
    expect(state[2]!.unlocked).toBe(false);
    expect(currentLevel(state)!.level.id).toBe('hira-dakuten');
  });

  test('a half-learned level does not open the next one', () => {
    const states: Record<string, CardProgress> = {};
    learnLevel(states, 0, 0.5);
    const state = curriculum(lookup(states), NOW);
    expect(state[0]!.complete).toBe(false);
    expect(state[1]!.unlocked).toBe(false);
    expect(currentLevel(state)!.level.id).toBe('hira-basic');
  });

  test('a few stubborn glyphs do not hold the syllabus hostage', () => {
    const states: Record<string, CardProgress> = {};
    learnLevel(states, 0, UNLOCK_SHARE);
    expect(curriculum(lookup(states), NOW)[1]!.unlocked).toBe(true);
  });

  test('moras the recogniser cannot say are left out of the denominator', () => {
    // びゃ, ぴゃ, ぴょ can never be learned by voice; counting them would keep
    // the youon level permanently short of the gate.
    const youon = curriculum(lookup({}), NOW).find((l) => l.level.id === 'hira-youon')!;
    expect(youon.total).toBe(30);
    expect(youon.level.cards).toHaveLength(33);
  });

  test('reviews keep coming from every level already reached', () => {
    const states: Record<string, CardProgress> = {};
    learnLevel(states, 0);
    const reached = reachedCards(curriculum(lookup(states), NOW));
    expect(reached.some((c) => c.levelId === 'hira-basic')).toBe(true);
    expect(reached.some((c) => c.levelId === 'hira-dakuten')).toBe(true);
    expect(reached.some((c) => c.levelId === 'kanji-n5')).toBe(false);
  });

  test('the whole syllabus is reachable and finite', () => {
    const states: Record<string, CardProgress> = {};
    LEVELS.forEach((_, i) => learnLevel(states, i));
    const state = curriculum(lookup(states), NOW);
    expect(state.every((l) => l.complete && l.unlocked)).toBe(true);
    expect(currentLevel(state)).toBeNull();
  });
});
