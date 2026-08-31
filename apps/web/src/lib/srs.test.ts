import { describe, expect, test } from 'bun:test';
import { State } from 'ts-fsrs';
import {
  LATENCY_EASY_MS,
  LATENCY_GOOD_MS,
  LEARNED_STABILITY_DAYS,
  Rating,
  applyAnswer,
  isDue,
  isLearned,
  isNew,
  newProgress,
  ratingFor,
} from './srs';

const NOW = new Date('2026-08-31T09:00:00Z');

describe('ratingFor', () => {
  test('a fast correct answer is Easy', () => {
    expect(ratingFor('correct', LATENCY_EASY_MS - 1)).toBe(Rating.Easy);
  });

  test('an ordinary correct answer is Good', () => {
    expect(ratingFor('correct', LATENCY_GOOD_MS - 1)).toBe(Rating.Good);
  });

  test('a slow correct answer is Hard — knowing it is not the same as reading it', () => {
    expect(ratingFor('correct', LATENCY_GOOD_MS + 1)).toBe(Rating.Hard);
  });

  test('a fast answer that had to be repeated is capped at Good', () => {
    expect(ratingFor('correct', 400, { repeated: true })).toBe(Rating.Good);
  });

  test('a misread mora and a silent card are both Again', () => {
    expect(ratingFor('wrong', null)).toBe(Rating.Again);
    expect(ratingFor('silent', null)).toBe(Rating.Again);
  });

  test('a sound the decoder could not place never reaches the scheduler', () => {
    // The core rule from spike 2: the recogniser's failure is not the
    // learner's, and must not push the card back down the schedule.
    expect(ratingFor('unplaced', 700)).toBeNull();
  });

  test('skipping does not reach the scheduler either', () => {
    expect(ratingFor('skipped', null)).toBeNull();
  });
});

describe('applyAnswer', () => {
  test('a correct answer schedules the card into the future', () => {
    const applied = applyAnswer(
      newProgress('hira-か', NOW),
      { quality: 'correct', onsetMs: 700 },
      NOW,
    );
    expect(applied.rating).toBe(Rating.Easy);
    expect(applied.progress.fsrs.due.getTime()).toBeGreaterThan(NOW.getTime());
    expect(applied.progress.graded).toBe(1);
    expect(isNew(applied.progress)).toBe(false);
  });

  test('an unplaced answer leaves the schedule untouched but is counted', () => {
    const before = newProgress('hira-か', NOW);
    const applied = applyAnswer(before, { quality: 'unplaced', onsetMs: 700 }, NOW);
    expect(applied.rating).toBeNull();
    expect(applied.progress.fsrs.state).toBe(State.New);
    expect(applied.progress.fsrs.due).toEqual(before.fsrs.due);
    expect(applied.progress.graded).toBe(0);
    // Still worth knowing: a card the decoder keeps refusing is a
    // pronunciation signal, even though it says nothing about recall.
    expect(applied.progress.unplaced).toBe(1);
  });

  test('latency is tracked only from answers that were actually correct', () => {
    let p = newProgress('hira-か', NOW);
    p = applyAnswer(p, { quality: 'correct', onsetMs: 900 }, NOW).progress;
    p = applyAnswer(p, { quality: 'wrong', onsetMs: 4000 }, NOW).progress;
    expect(p.bestOnsetMs).toBe(900);
    expect(p.lastOnsetMs).toBe(900);
  });

  test('the smoothed latency follows improvement without jumping to it', () => {
    let p = newProgress('hira-か', NOW);
    p = applyAnswer(p, { quality: 'correct', onsetMs: 2000 }, NOW).progress;
    p = applyAnswer(p, { quality: 'correct', onsetMs: 1000 }, NOW).progress;
    expect(p.avgOnsetMs).toBeLessThan(2000);
    expect(p.avgOnsetMs).toBeGreaterThan(1000);
    expect(p.bestOnsetMs).toBe(1000);
  });

  test('a failed card comes due again sooner than a passed one', () => {
    const good = applyAnswer(newProgress('a', NOW), { quality: 'correct', onsetMs: 700 }, NOW);
    const bad = applyAnswer(newProgress('a', NOW), { quality: 'wrong', onsetMs: null }, NOW);
    expect(bad.progress.fsrs.due.getTime()).toBeLessThan(good.progress.fsrs.due.getTime());
  });

  test('a scheduled card is not due before its date', () => {
    const applied = applyAnswer(newProgress('a', NOW), { quality: 'correct', onsetMs: 700 }, NOW);
    expect(isDue(applied.progress, NOW)).toBe(false);
    expect(isDue(applied.progress, new Date('2030-01-01T00:00:00Z'))).toBe(true);
  });
});

describe('isLearned', () => {
  test('one fast answer is not enough, however long the interval it earns', () => {
    const first = applyAnswer(newProgress('a', NOW), { quality: 'correct', onsetMs: 500 }, NOW);
    expect(first.progress.fsrs.stability).toBeGreaterThan(LEARNED_STABILITY_DAYS);
    expect(isLearned(first.progress)).toBe(false);
  });

  test('a glyph recalled again after the wait counts as learned', () => {
    const first = applyAnswer(newProgress('a', NOW), { quality: 'correct', onsetMs: 500 }, NOW);
    const later = new Date(first.progress.fsrs.due);
    expect(isLearned(applyAnswer(first.progress, { quality: 'correct', onsetMs: 500 }, later).progress)).toBe(
      true,
    );
  });

  test('failing it again drops it back out', () => {
    const first = applyAnswer(newProgress('a', NOW), { quality: 'correct', onsetMs: 500 }, NOW);
    const later = new Date(first.progress.fsrs.due);
    const lapsed = applyAnswer(first.progress, { quality: 'wrong', onsetMs: null }, later);
    expect(isLearned(lapsed.progress)).toBe(false);
  });
});

describe('mispronunciation', () => {
  test('a nameable slip never reaches the scheduler', () => {
    // The glyph was read correctly; only the mouth was wrong. Demoting the
    // card would confuse a pronunciation problem with a memory one.
    expect(ratingFor('mispronounced', 900)).toBeNull();
  });

  test('it is counted per mora, because that is the signal worth keeping', () => {
    let p = newProgress('hira-む', NOW);
    p = applyAnswer(p, { quality: 'mispronounced', onsetMs: 800 }, NOW).progress;
    p = applyAnswer(p, { quality: 'mispronounced', onsetMs: 850 }, NOW).progress;
    expect(p.mispronounced).toBe(2);
    expect(p.graded).toBe(0);
    expect(isNew(p)).toBe(true);
  });

  test('a plain misreading still costs the card its interval', () => {
    const before = applyAnswer(newProgress('a', NOW), { quality: 'correct', onsetMs: 500 }, NOW);
    const later = new Date(before.progress.fsrs.due);
    const wrong = applyAnswer(before.progress, { quality: 'wrong', onsetMs: null }, later);
    expect(wrong.rating).toBe(Rating.Again);
    expect(wrong.progress.fsrs.stability).toBeLessThan(before.progress.fsrs.stability);
  });
});
