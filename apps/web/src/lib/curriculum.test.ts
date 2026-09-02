import { describe, expect, test } from 'bun:test';
import { UNLOCK_SHARE, curriculum, currentLevel, reachedCards } from './curriculum';
import { LEVELS } from './levels';
import { applyAnswer, newProgress, type CardProgress } from './srs';

const NOW = new Date('2026-09-01T09:00:00Z');

/** A card answered right in two separate sessions, quickly. */
function learnedCard(id: string): CardProgress {
  // Two separate sessions, which is what «learned» means now.
  const answer = { quality: 'correct' as const, onsetMs: 500, firstThisSession: true };
  const first = applyAnswer(newProgress(id, NOW), answer, NOW);
  return applyAnswer(first.progress, answer, new Date(first.progress.fsrs.due)).progress;
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
  test('is ordered letters, then words in them, then kanji by JLPT level', () => {
    expect(LEVELS.map((l) => l.id)).toEqual([
      'hira-basic',
      'hira-dakuten',
      'hira-youon',
      'hira-words',
      'kata-basic',
      'kata-dakuten',
      'kata-youon',
      'kata-words',
      'kanji-n5',
      'kanji-n4',
      'kanji-n3',
    ]);
  });

  test('words come straight after the letters that spell them', () => {
    const words = LEVELS.find((l) => l.id === 'hira-words')!;
    expect(words.cards.length).toBeGreaterThan(20);
    // A kana word is read exactly as written: the glyph is the answer.
    expect(words.cards.every((c) => c.readings[0] === c.glyph)).toBe(true);
    expect(words.cards.every((c) => c.meaning !== undefined)).toBe(true);
  });

  test('a kanji card carries its reading in kana, in Latin and in Cyrillic', () => {
    const hi = LEVELS.find((l) => l.id === 'kanji-n5')!.cards.find((c) => c.glyph === '日')!;
    expect(hi.reading).toContain('にち');
    expect(hi.romaji).toContain('nichi');
    expect(hi.kiriji).toContain('нити');
    // «day», not «Japan»: the dataset's senses are sorted alphabetically, so
    // the primary comes from Heisig's keyword instead of that order.
    expect(hi.meaning?.primary).toBe('day');
    expect(hi.meaning?.extra).toContain('sun');
  });

  test('bound readings are not accepted answers', () => {
    const n5 = LEVELS.find((l) => l.id === 'kanji-n5')!.cards;
    // 十's «じっ» only exists before gemination, and 号's «さけ» is the stem of
    // 号ぶ — accepting it would pass a learner who said «сакэ».
    expect(n5.find((c) => c.glyph === '十')!.readings).not.toContain('じっ');
    const kanji = LEVELS.flatMap((l) => l.cards).filter((c) => c.kind === 'kanji');
    expect(kanji.every((c) => c.readings.every((r) => !r.endsWith('っ')))).toBe(true);
    expect(kanji.every((c) => c.readings.length > 0)).toBe(true);
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
