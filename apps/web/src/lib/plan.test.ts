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
  const answer = { quality: 'correct' as const, onsetMs: 500, firstThisSession: true };
  const first = applyAnswer(newProgress(id, NOW), answer, NOW);
  return applyAnswer(first.progress, answer, new Date(first.progress.fsrs.due)).progress;
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

  test('nothing due and nothing new still gives a session, all practice', () => {
    const states = Object.fromEntries(HIRA.map((c) => [c.id, scheduled(c.id)]));
    const built = plan(states);
    expect(built.due).toBe(0);
    expect(built.fresh).toBe(0);
    expect(built.practice).toBe(20);
    expect(built.scheduled.size).toBe(0);
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

  test('practice takes the cards nearest to falling due', () => {
    const states: Record<string, CardProgress> = {};
    HIRA.forEach((c) => (states[c.id] = scheduled(c.id)));
    // Push one card far out; it must be the last thing practised, not the first.
    const far = HIRA[0]!;
    states[far.id] = {
      ...states[far.id]!,
      fsrs: { ...states[far.id]!.fsrs, due: new Date(NOW.getTime() + 400 * 86_400_000) },
    };
    const built = plan(states, { size: 3 });
    expect(built.cards.some((c) => c.id === far.id)).toBe(false);
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

  test('reviews do not repeat, but the room goes to practice', () => {
    const states: Record<string, CardProgress> = {};
    HIRA.slice(0, 3).forEach((c) => (states[c.id] = overdue(c.id, 1)));
    HIRA.slice(3).forEach((c) => (states[c.id] = scheduled(c.id)));
    const built = plan(states, { size: 20, newLimit: 5 });
    expect(built.due).toBe(3);
    expect(built.practice).toBe(17);
    // Every card distinct: no review is asked twice.
    expect(new Set(built.cards.map((c) => c.id)).size).toBe(20);
    // Only what the scheduler asked for counts towards the schedule.
    expect(built.scheduled.size).toBe(3);
  });

  test('one new glyph still fills a session', () => {
    const built = plan({}, { size: 8, newLimit: 1 });
    expect(built.cards).toHaveLength(8);
    expect(new Set(built.cards.map((c) => c.id)).size).toBe(1);
  });
});

describe('practice fills the idle days', () => {
  test('glyphs learned yesterday come back today, nearest to due first', () => {
    // Five cards answered and scheduled days out. Without practice the next
    // session would be five brand-new glyphs and nothing else, which is what
    // «I keep drilling five new ones in circles» looks like.
    const states: Record<string, CardProgress> = {};
    HIRA.slice(0, 5).forEach((c) => (states[c.id] = scheduled(c.id)));
    const built = plan(states, { size: 20, newLimit: 5 });
    expect(built.due).toBe(0);
    expect(built.fresh).toBe(5);
    expect(built.practice).toBe(5);
    // Ten distinct glyphs, padded to the session length by repeating the new
    // ones — which is the point of them being new.
    expect(new Set(built.cards.map((c) => c.id)).size).toBe(10);
    expect(built.cards).toHaveLength(20);
  });

  test('practice does not count towards the schedule', () => {
    const states: Record<string, CardProgress> = {};
    HIRA.slice(0, 5).forEach((c) => (states[c.id] = scheduled(c.id)));
    const built = plan(states, { size: 20, newLimit: 0 });
    expect(built.scheduled.size).toBe(0);
    expect(built.cards).toHaveLength(5);
  });

  test('the very first session has nothing to practise and repeats instead', () => {
    const built = plan({}, { size: 20, newLimit: 5 });
    expect(built.practice).toBe(0);
    expect(built.cards).toHaveLength(20);
  });
});

describe('practice goes where the work is', () => {
  test('unlearned glyphs come before learned ones, whatever their due dates', () => {
    // The failure this guards: a glyph is unlearned mostly because the
    // answers were slow, slow glyphs get answered often, and being answered
    // often pushes the due date out. Sorted by due date alone, the cards that
    // needed the work sat at the back of the queue and the level froze.
    const states: Record<string, CardProgress> = {};
    const stuck = HIRA.slice(0, 5);
    const done = HIRA.slice(5, 25);
    // Slow but answered many times, so due far out.
    for (const c of stuck) {
      let p = newProgress(c.id, NOW);
      for (let i = 0; i < 4; i++) {
        p = applyAnswer(p, { quality: 'correct', onsetMs: 2600, firstThisSession: true }, NOW)
          .progress;
      }
      states[c.id] = { ...p, fsrs: { ...p.fsrs, due: new Date(NOW.getTime() + 90 * 86_400_000) } };
    }
    // Learned, and due sooner.
    for (const c of done) {
      const p = learned(c.id);
      states[c.id] = { ...p, fsrs: { ...p.fsrs, due: new Date(NOW.getTime() + 5 * 86_400_000) } };
    }

    const built = plan(states, { size: 10, newLimit: 0 });
    const picked = new Set(built.cards.map((c) => c.id));
    for (const c of stuck) expect(picked.has(c.id)).toBe(true);
  });
});
