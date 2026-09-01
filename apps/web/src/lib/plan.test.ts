import { describe, expect, test } from 'bun:test';
import { curriculum } from './curriculum';
import { LEVELS } from './levels';
import { planSession } from './plan';
import { applyAnswer, newProgress, type CardProgress } from './srs';

const NOW = new Date('2026-09-01T09:00:00Z');
const HIRA = LEVELS[0]!.cards;

function lookup(states: Record<string, CardProgress>) {
  return (id: string) => states[id] ?? newProgress(id, NOW);
}

/** Answered correctly just now, so not due again today. */
function scheduled(id: string): CardProgress {
  return applyAnswer(newProgress(id, NOW), { quality: 'correct', onsetMs: 700 }, NOW).progress;
}

/** Answered right twice, far enough apart that FSRS calls it learned. */
function learned(id: string): CardProgress {
  const first = applyAnswer(newProgress(id, NOW), { quality: 'correct', onsetMs: 500 }, NOW);
  const later = new Date(first.progress.fsrs.due);
  return applyAnswer(first.progress, { quality: 'correct', onsetMs: 500 }, later).progress;
}

/** Answered a while ago and now overdue by `daysAgo`. */
function overdue(id: string, daysAgo: number): CardProgress {
  const p = scheduled(id);
  return { ...p, fsrs: { ...p.fsrs, due: new Date(NOW.getTime() - daysAgo * 86_400_000) } };
}

function plan(states: Record<string, CardProgress>, over: Partial<Parameters<typeof planSession>[3]> = {}) {
  const look = lookup(states);
  return planSession(curriculum(look, NOW), look, NOW, {
    size: 20,
    newLimit: 5,
    excludeOov: false,
    ...over,
  });
}

describe('planSession', () => {
  test('a beginner gets new glyphs from the first level only', () => {
    const built = plan({});
    expect(built.fresh).toBe(5);
    expect(new Set(built.cards.map((c) => c.id)).size).toBe(5);
    expect(built.fromLevel).toBe('hira-basic');
  });

  test('new glyphs arrive in the level order, not at random', () => {
    const glyphs = new Set(plan({}, { newLimit: 3 }).cards.map((c) => c.glyph));
    expect([...glyphs].sort()).toEqual(['あ', 'い', 'う']);
  });

  test('nothing due and nothing new leaves an empty session', () => {
    const states = Object.fromEntries(HIRA.map((c) => [c.id, scheduled(c.id)]));
    expect(plan(states).cards).toHaveLength(0);
  });

  test('the most overdue cards come first when the backlog is bigger than the session', () => {
    const states: Record<string, CardProgress> = {};
    HIRA.forEach((c, i) => (states[c.id] = overdue(c.id, i + 1)));
    const built = plan(states, { size: 3 });
    expect(built.due).toBe(3);
    expect(new Set(built.cards.map((c) => c.id))).toEqual(
      new Set(HIRA.slice(-3).map((c) => c.id)),
    );
  });

  test('new glyphs only fill the room the backlog leaves', () => {
    const states: Record<string, CardProgress> = {};
    HIRA.slice(0, 8).forEach((c) => (states[c.id] = overdue(c.id, 1)));
    const built = plan(states, { size: 10 });
    expect(built.due).toBe(8);
    expect(built.fresh).toBe(2);
  });

  test('a locked level never contributes a new glyph', () => {
    // Every hiragana card seen but none learned: dakuten stays shut, so the
    // session has nothing new to offer even though the level exists.
    const states = Object.fromEntries(HIRA.map((c) => [c.id, scheduled(c.id)]));
    const built = plan(states, { newLimit: 5 });
    expect(built.fresh).toBe(0);
    expect(built.cards.every((c) => c.levelId === 'hira-basic')).toBe(true);
  });

  test('moras the recogniser cannot say are excluded and named', () => {
    // Learn the two levels before youon, so its three OOV moras are reached.
    const states: Record<string, CardProgress> = {};
    LEVELS.slice(0, 2).forEach((l) => l.cards.forEach((c) => (states[c.id] = learned(c.id))));
    const built = plan(states, { excludeOov: true });
    expect(built.excluded.map((c) => c.glyph)).toEqual(['びゃ', 'ぴゃ', 'ぴょ']);
    expect(built.cards.some((c) => c.voiceOov)).toBe(false);
  });

  test('free practice drills what is closest to due when nothing is', () => {
    const states = Object.fromEntries(HIRA.map((c) => [c.id, scheduled(c.id)]));
    expect(plan(states, { size: 3 }).cards).toHaveLength(0);
    expect(plan(states, { size: 3, mode: 'free' }).cards).toHaveLength(3);
  });
});

describe('session length', () => {
  test('new glyphs repeat to fill the session the settings asked for', () => {
    // Five new cards and a twenty-card session: a glyph met for the first
    // time is worth several looks in one sitting.
    const built = plan({}, { size: 20, newLimit: 5 });
    expect(built.cards).toHaveLength(20);
    expect(new Set(built.cards.map((c) => c.id)).size).toBe(5);
    expect(built.fresh).toBe(5);
  });

  test('the same glyph never comes twice in a row', () => {
    const cards = plan({}, { size: 20, newLimit: 5 }).cards;
    for (let i = 1; i < cards.length; i++) {
      expect(cards[i]!.id).not.toBe(cards[i - 1]!.id);
    }
  });

  test('reviews do not repeat — asking them seven times teaches nothing', () => {
    const states: Record<string, CardProgress> = {};
    HIRA.slice(0, 3).forEach((c) => (states[c.id] = overdue(c.id, 1)));
    HIRA.slice(3).forEach((c) => (states[c.id] = scheduled(c.id)));
    const built = plan(states, { size: 20, newLimit: 5 });
    expect(built.cards).toHaveLength(3);
    expect(built.due).toBe(3);
  });

  test('one new glyph still fills a session', () => {
    const built = plan({}, { size: 8, newLimit: 1 });
    expect(built.cards).toHaveLength(8);
    expect(new Set(built.cards.map((c) => c.id)).size).toBe(1);
  });
});
