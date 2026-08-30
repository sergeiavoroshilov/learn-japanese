import { describe, expect, test } from 'bun:test';
import { cardById, cardsOf, type KanaCard } from './kana';
import { planSession, poolStats } from './plan';
import { applyAnswer, newProgress, type CardProgress } from './srs';

const NOW = new Date('2026-08-31T09:00:00Z');
const POOL = cardsOf(['hira-basic']);

/** A lookup backed by a plain map, so a test can set up any history it likes. */
function lookup(states: Record<string, CardProgress>) {
  return (id: string) => states[id] ?? newProgress(id, NOW);
}

/** A card answered correctly just now, hence not due again today. */
function scheduled(id: string, onsetMs = 700): CardProgress {
  return applyAnswer(newProgress(id, NOW), { quality: 'correct', onsetMs }, NOW).progress;
}

/** A card whose due date is in the past. */
function overdue(id: string, daysAgo: number): CardProgress {
  const progress = scheduled(id);
  return { ...progress, fsrs: { ...progress.fsrs, due: new Date(NOW.getTime() - daysAgo * 86_400_000) } };
}

describe('planSession', () => {
  test('an untouched deck yields only new cards, up to the ceiling', () => {
    const plan = planSession(POOL, lookup({}), NOW, { size: 20, newLimit: 5, excludeOov: false });
    expect(plan.cards).toHaveLength(5);
    expect(plan.fresh).toBe(5);
    expect(plan.due).toBe(0);
  });

  test('new glyphs are introduced in table order, not at random', () => {
    const plan = planSession(POOL, lookup({}), NOW, { size: 20, newLimit: 3, excludeOov: false });
    expect(plan.cards.map((c) => c.glyph).sort()).toEqual(['あ', 'い', 'う']);
  });

  test('cards not yet due are left alone', () => {
    const states = Object.fromEntries(POOL.map((c) => [c.id, scheduled(c.id)]));
    const plan = planSession(POOL, lookup(states), NOW, {
      size: 20,
      newLimit: 5,
      excludeOov: false,
    });
    expect(plan.cards).toHaveLength(0);
  });

  test('the most overdue cards come first when the backlog exceeds the session', () => {
    const states: Record<string, CardProgress> = {};
    POOL.forEach((c, i) => (states[c.id] = overdue(c.id, i + 1)));
    const plan = planSession(POOL, lookup(states), NOW, {
      size: 3,
      newLimit: 5,
      excludeOov: false,
    });
    expect(plan.due).toBe(3);
    expect(plan.fresh).toBe(0);
    // The last three cards of the table were made the most overdue.
    const picked = new Set(plan.cards.map((c) => c.id));
    expect(picked).toEqual(new Set(POOL.slice(-3).map((c) => c.id)));
  });

  test('new cards only fill the room the backlog leaves', () => {
    const states: Record<string, CardProgress> = {};
    POOL.slice(0, 8).forEach((c) => (states[c.id] = overdue(c.id, 1)));
    const plan = planSession(POOL, lookup(states), NOW, {
      size: 10,
      newLimit: 5,
      excludeOov: false,
    });
    expect(plan.due).toBe(8);
    expect(plan.fresh).toBe(2);
    expect(plan.cards).toHaveLength(10);
  });

  test('moras the recogniser has no word for are excluded, and named', () => {
    const youon = cardsOf(['hira-youon']);
    const plan = planSession(youon, lookup({}), NOW, {
      size: 40,
      newLimit: 40,
      excludeOov: true,
    });
    expect(plan.excluded.map((c: KanaCard) => c.glyph)).toEqual(['びゃ', 'ぴゃ', 'ぴょ']);
    expect(plan.cards.some((c) => c.voiceOov)).toBe(false);
  });

  test('typing practice keeps them — the limitation is the microphone, not the card', () => {
    const youon = cardsOf(['hira-youon']);
    const plan = planSession(youon, lookup({}), NOW, {
      size: 40,
      newLimit: 40,
      excludeOov: false,
    });
    expect(plan.cards).toHaveLength(33);
    expect(plan.excluded).toHaveLength(0);
  });
});

describe('poolStats', () => {
  test('an untouched deck is all new', () => {
    const stats = poolStats(POOL, lookup({}), NOW);
    expect(stats).toMatchObject({ total: 46, fresh: 46, learning: 0, learned: 0, due: 0 });
    expect(stats.nextDue).toBeNull();
  });

  test('answered cards move out of "not started" and report when they return', () => {
    const states = { [cardById('hira-あ')!.id]: scheduled('hira-あ') };
    const stats = poolStats(POOL, lookup(states), NOW);
    expect(stats.fresh).toBe(45);
    expect(stats.learning).toBe(1);
    expect(stats.due).toBe(0);
    expect(stats.nextDue).not.toBeNull();
    expect(stats.nextDue!.getTime()).toBeGreaterThan(NOW.getTime());
  });

  test('overdue cards are counted as due', () => {
    const states = { [cardById('hira-あ')!.id]: overdue('hira-あ', 3) };
    expect(poolStats(POOL, lookup(states), NOW).due).toBe(1);
  });
});

describe('free practice', () => {
  test('drills the cards closest to falling due when nothing is due yet', () => {
    const states: Record<string, CardProgress> = {};
    POOL.slice(0, 5).forEach((c) => (states[c.id] = scheduled(c.id)));
    const now = lookup(states);

    expect(
      planSession(POOL, now, NOW, { size: 3, newLimit: 0, excludeOov: false }).cards,
    ).toHaveLength(0);

    const free = planSession(POOL, now, NOW, {
      size: 3,
      newLimit: 0,
      excludeOov: false,
      mode: 'free',
    });
    expect(free.cards).toHaveLength(3);
    expect(free.cards.every((c) => POOL.slice(0, 5).some((p) => p.id === c.id))).toBe(true);
  });
});
