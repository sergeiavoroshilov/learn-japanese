import {
  Rating,
  State,
  createEmptyCard,
  fsrs,
  generatorParameters,
  type Card as FsrsCard,
  type Grade,
} from 'ts-fsrs';
import type { KanaCard } from './kana';

/**
 * Short-term (intra-day) steps are off on purpose. A card missed inside a
 * session is repeated by the session queue itself, within a minute — letting
 * FSRS also schedule it "in 10 minutes" would mean two mechanisms fighting
 * over the same card, and every freshly learned mora would show up as due
 * again before the user had left the page. FSRS here answers one question
 * only: which day should this glyph come back on.
 */
const scheduler = fsrs(
  generatorParameters({ enable_short_term: false, request_retention: 0.9 }),
);

/**
 * What actually happened on a card, before it becomes an FSRS grade. The
 * distinction that matters for this product is between «the learner failed»
 * and «the recogniser failed»: only the first may touch the schedule.
 */
export type AnswerQuality =
  /** Said correctly, in time. */
  | 'correct'
  /** The recogniser heard a different, existing mora — a real reading error. */
  | 'wrong'
  /** The learner said nothing at all. */
  | 'silent'
  /** Sound heard but not placed («[unk]»): says nothing about the learner. */
  | 'unplaced'
  /** The learner asked to move on. */
  | 'skipped';

/**
 * Latency bands for a single mora. Naming a familiar character is a
 * sub-second act; anything past two seconds is being worked out rather than
 * recalled, which is exactly what «Hard» means to FSRS.
 */
export const LATENCY_EASY_MS = 1000;
export const LATENCY_GOOD_MS = 2000;

/**
 * Grade for the scheduler, or null when this answer must not affect it.
 *
 * Null is the whole point of the spike-2 verdict: a mora the decoder refused
 * to place was not forgotten by the learner, and demoting the card for it
 * would poison the schedule with the recogniser's own error rate.
 */
export function ratingFor(
  quality: AnswerQuality,
  onsetMs: number | null,
  opts: { repeated?: boolean } = {},
): Grade | null {
  if (quality === 'unplaced' || quality === 'skipped') return null;
  if (quality === 'wrong' || quality === 'silent') return Rating.Again;
  // Correct, but we never measured when speech started: treat as ordinary.
  if (onsetMs === null) return Rating.Good;
  // Had to say it twice — the recogniser's fault, but it also means we no
  // longer know how fluent the answer really was. Never promote to Easy.
  if (onsetMs < LATENCY_EASY_MS) return opts.repeated ? Rating.Good : Rating.Easy;
  if (onsetMs < LATENCY_GOOD_MS) return Rating.Good;
  return Rating.Hard;
}

export interface CardProgress {
  id: string;
  fsrs: FsrsCard;
  /** Answers that reached the scheduler. */
  graded: number;
  /** Fastest correct answer ever, ms from glyph shown to speech onset. */
  bestOnsetMs: number | null;
  /** Latency of the most recent correct answer. */
  lastOnsetMs: number | null;
  /** Smoothed latency — what the dashboard sorts by. */
  avgOnsetMs: number | null;
  /** Times the recogniser refused to place the sound. Pronunciation signal. */
  unplaced: number;
}

export function newProgress(id: string, now: Date): CardProgress {
  return {
    id,
    fsrs: createEmptyCard(now),
    graded: 0,
    bestOnsetMs: null,
    lastOnsetMs: null,
    avgOnsetMs: null,
    unplaced: 0,
  };
}

/** Weight of the newest measurement in the smoothed latency. */
const LATENCY_ALPHA = 0.4;

export interface Applied {
  progress: CardProgress;
  rating: Grade | null;
  /** Days until this card is due again, for the session summary. */
  intervalDays: number | null;
}

export function applyAnswer(
  progress: CardProgress,
  answer: { quality: AnswerQuality; onsetMs: number | null; repeated?: boolean },
  now: Date,
): Applied {
  const rating = ratingFor(answer.quality, answer.onsetMs, { repeated: answer.repeated });
  const next: CardProgress = {
    ...progress,
    unplaced: progress.unplaced + (answer.quality === 'unplaced' ? 1 : 0),
  };

  if (answer.quality === 'correct' && answer.onsetMs !== null) {
    next.lastOnsetMs = answer.onsetMs;
    next.bestOnsetMs =
      progress.bestOnsetMs === null ? answer.onsetMs : Math.min(progress.bestOnsetMs, answer.onsetMs);
    next.avgOnsetMs =
      progress.avgOnsetMs === null
        ? answer.onsetMs
        : Math.round(progress.avgOnsetMs * (1 - LATENCY_ALPHA) + answer.onsetMs * LATENCY_ALPHA);
  }

  if (rating === null) return { progress: next, rating: null, intervalDays: null };

  const { card } = scheduler.next(progress.fsrs, now, rating);
  next.fsrs = card;
  next.graded = progress.graded + 1;
  return {
    progress: next,
    rating,
    intervalDays: Math.max(0, Math.round((card.due.getTime() - now.getTime()) / 86_400_000)),
  };
}

export function isDue(progress: CardProgress, now: Date): boolean {
  return progress.fsrs.due.getTime() <= now.getTime();
}

export function isNew(progress: CardProgress): boolean {
  return progress.fsrs.state === State.New;
}

/** Probability the learner still remembers this card right now, 0..1. */
export function retrievability(progress: CardProgress, now: Date): number {
  if (progress.fsrs.state === State.New) return 0;
  return scheduler.get_retrievability(progress.fsrs, now, false);
}

/**
 * A glyph counts as learned once FSRS is willing to wait a week before asking
 * again — and only after it has come back at least once. The very first
 * answer, however fast, proves nothing about retention: no time had passed
 * for the glyph to be forgotten in. FSRS would happily hand a brand-new card
 * a two-week interval off one «Easy», and calling that «learned» would be the
 * same lie as a Duolingo streak.
 */
export const LEARNED_STABILITY_DAYS = 7;
const LEARNED_MIN_REPS = 2;

export function isLearned(progress: CardProgress): boolean {
  return (
    progress.fsrs.state === State.Review &&
    progress.fsrs.reps >= LEARNED_MIN_REPS &&
    progress.fsrs.stability >= LEARNED_STABILITY_DAYS
  );
}

export { Rating, State };
export type { FsrsCard, Grade, KanaCard };
