import type { DrillCard } from './card';
import { LEVELS, type Level } from './levels';
import { isDue, isLearned, isNew, type CardProgress } from './srs';

export type ProgressLookup = (id: string) => CardProgress;

/**
 * How much of a level must be learned before the next one opens.
 *
 * Not 100 %: a handful of stubborn glyphs would otherwise hold the whole
 * syllabus hostage, and they keep coming back through the review queue
 * anyway. Not 50 % either — the point of the gate is that the next level is
 * built on this one.
 */
export const UNLOCK_SHARE = 0.9;

export interface LevelProgress {
  level: Level;
  total: number;
  /** Never shown. */
  fresh: number;
  /** Seen, not yet stable. */
  learning: number;
  learned: number;
  /** Due for review right now. */
  due: number;
  /** Learned as a share of the whole level, 0..1. */
  share: number;
  /** The learner has reached this level. */
  unlocked: boolean;
  /** Everything here is learned; the level is behind them. */
  complete: boolean;
}

/**
 * The syllabus with the learner's standing in it.
 *
 * A level unlocks when the one before it is complete. Reviews from earlier
 * levels never stop — only the introduction of *new* glyphs is gated, which
 * is the difference between pacing someone and blocking them.
 */
export function curriculum(progressFor: ProgressLookup, now: Date): LevelProgress[] {
  const out: LevelProgress[] = [];
  let previousComplete = true;

  for (const level of LEVELS) {
    // A glyph the recogniser has no word for cannot be learned by voice, so
    // it must not sit in the denominator holding a level shut forever.
    const cards = level.cards.filter((c) => !c.voiceOov);
    let fresh = 0;
    let learning = 0;
    let learned = 0;
    let due = 0;

    for (const card of cards) {
      const progress = progressFor(card.id);
      if (isNew(progress)) fresh++;
      else if (isLearned(progress)) learned++;
      else learning++;
      if (!isNew(progress) && isDue(progress, now)) due++;
    }

    const share = cards.length === 0 ? 1 : learned / cards.length;
    const complete = share >= UNLOCK_SHARE;
    out.push({
      level,
      total: cards.length,
      fresh,
      learning,
      learned,
      due,
      share,
      unlocked: previousComplete,
      complete,
    });
    previousComplete = previousComplete && complete;
  }

  return out;
}

/** The level new glyphs are drawn from: the first unlocked, unfinished one. */
export function currentLevel(state: LevelProgress[]): LevelProgress | null {
  return state.find((l) => l.unlocked && !l.complete) ?? null;
}

/** Every card the learner has reached — what reviews may be drawn from. */
export function reachedCards(state: LevelProgress[]): DrillCard[] {
  return state.filter((l) => l.unlocked).flatMap((l) => l.level.cards);
}
