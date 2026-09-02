import { describe, expect, test } from 'bun:test';
import { DECKS } from './kana';
import type { CardOutcome } from './session';
import { accuracy, percentile, summarize } from './stats';

const card = DECKS[0]!.cards[0]!;

function outcome(over: Partial<CardOutcome>): CardOutcome {
  return {
    index: 0,
    card,
    onsetMs: 500,
    speechMs: 300,
    matchMs: 800,
    asrLagMs: 300,
    status: 'match',
    matchedTranscript: card.glyph,
    exact: true,
    matchedBy: 'card',
    lateMs: null,
    witnessHeard: [],
    hypotheses: [],
    ...over,
  };
}

describe('percentile', () => {
  test('empty input has no percentile', () => {
    expect(percentile([], 50)).toBeNull();
  });

  test('median of an odd-sized set', () => {
    expect(percentile([100, 300, 200], 50)).toBe(200);
  });

  test('p90 picks the tail, not the max of a short set', () => {
    expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 1000], 90)).toBe(90);
  });
});

describe('summarize', () => {
  test('counts statuses and hit rate', () => {
    const stats = summarize([
      outcome({}),
      outcome({ status: 'timeout', matchMs: null, asrLagMs: null, exact: null }),
      outcome({ status: 'skipped', matchMs: null, asrLagMs: null, exact: null }),
      outcome({ exact: false }),
    ]);
    expect(stats.total).toBe(4);
    expect(stats.matched).toBe(2);
    expect(stats.exact).toBe(1);
    expect(stats.containsOnly).toBe(1);
    expect(stats.timeouts).toBe(1);
    expect(stats.skipped).toBe(1);
    expect(stats.hitRate).toBe(0.5);
  });

  test('counts which decoder accepted the answer', () => {
    const stats = summarize([
      outcome({}),
      outcome({ matchedBy: 'deck' }),
      outcome({ matchedBy: 'deck' }),
      outcome({ status: 'timeout', matchedBy: null, exact: null }),
    ]);
    expect(stats.matched).toBe(3);
    expect(stats.matchedByDeck).toBe(2);
  });

  test('latency medians ignore cards without a measurement', () => {
    const stats = summarize([
      outcome({ onsetMs: 400, matchMs: 700, asrLagMs: 300 }),
      outcome({ onsetMs: null, matchMs: null, asrLagMs: null, status: 'timeout' }),
      outcome({ onsetMs: 600, matchMs: 1000, asrLagMs: 400 }),
    ]);
    // Nearest-rank convention: for two values the median is the lower one.
    expect(stats.onsetMedian).toBe(400);
    expect(stats.asrLagMedian).toBe(300);
  });

  test('flags cards where the engine reported something off-target', () => {
    const wrong = outcome({
      hypotheses: [
        {
          transcript: 'こんにちは',
          atMs: 300,
          final: false,
          verdict: { exact: false, contains: false, partial: false, normalized: 'こんにちは' },
        },
      ],
    });
    expect(summarize([wrong, outcome({})]).cardsWithWrongHypotheses).toBe(1);
  });

  test('an interim prefix of the right answer is not an off-target hypothesis', () => {
    const interim = outcome({
      hypotheses: [
        {
          transcript: 'あ',
          atMs: 200,
          final: false,
          verdict: { exact: false, contains: false, partial: true, normalized: 'あ' },
        },
      ],
    });
    expect(summarize([interim]).cardsWithWrongHypotheses).toBe(0);
  });

  test('no cards yields a zero hit rate rather than NaN', () => {
    expect(summarize([]).hitRate).toBe(0);
    expect(summarize([]).eventualHitRate).toBe(0);
  });

  test('late answers count towards the eventual hit rate, not the timely one', () => {
    const stats = summarize([
      outcome({}),
      outcome({ status: 'late', matchMs: null, asrLagMs: null, lateMs: 2400 }),
      outcome({ status: 'timeout', matchMs: null, asrLagMs: null, exact: null }),
      outcome({ status: 'late', matchMs: null, asrLagMs: null, lateMs: 1800 }),
    ]);
    expect(stats.matched).toBe(1);
    expect(stats.late).toBe(2);
    expect(stats.hitRate).toBe(0.25);
    expect(stats.eventualHitRate).toBe(0.75);
    expect(stats.lateMedian).toBe(1800);
  });
});

describe('accuracy', () => {
  test('everything asked is in the denominator — twenty asked, eighteen right', () => {
    const qualities = [...Array<string>(18).fill('correct'), 'wrong', 'unplaced'];
    const scored = accuracy(qualities);
    expect(scored.correct).toBe(18);
    expect(scored.total).toBe(20);
    expect(scored.share).toBe(0.9);
  });

  test('a share can never exceed one', () => {
    // «18/2 — 900%»: the denominator had once been «answers that moved the
    // schedule», which after a session of practice is a handful.
    expect(accuracy([...Array<string>(18).fill('correct'), 'unplaced']).share).toBeLessThan(1.01);
  });

  test('an empty session has no share to report', () => {
    expect(accuracy([]).share).toBeNull();
  });
});
