import { shuffle, type KanaCard } from './kana';
import { isDue, isNew, isLearned, type CardProgress } from './srs';

export type ProgressLookup = (id: string) => CardProgress;

export interface SessionPlan {
  cards: KanaCard[];
  /** How many of them are repeats the schedule asked for. */
  due: number;
  /** How many are glyphs the learner has never seen. */
  fresh: number;
  /** Cards left out because the recogniser has no word for them. */
  excluded: KanaCard[];
}

export interface PlanOptions {
  size: number;
  newLimit: number;
  /** Drop cards the decoder cannot output (voice sessions only). */
  excludeOov: boolean;
  /**
   * «free» ignores the due dates and drills whatever is closest to falling
   * due. Reviewing early is not cheating — FSRS accounts for the shorter
   * interval and simply grants less stability — so wanting another round when
   * nothing is due should not be refused.
   */
  mode?: 'due' | 'free';
}

/**
 * Build one session: everything the schedule says is due, oldest first, then
 * new glyphs to fill the remaining room.
 *
 * Due cards come first in the selection but not in the running order — the
 * final deck is shuffled, so a session does not open with the whole backlog
 * and end with the easy new ones.
 */
export function planSession(
  pool: KanaCard[],
  progressFor: ProgressLookup,
  now: Date,
  opts: PlanOptions,
): SessionPlan {
  const excluded = opts.excludeOov ? pool.filter((c) => c.voiceOov) : [];
  const usable = opts.excludeOov ? pool.filter((c) => !c.voiceOov) : pool;

  const seen = usable.filter((c) => !isNew(progressFor(c.id)));
  const fresh = usable.filter((c) => isNew(progressFor(c.id)));

  const due = seen
    .filter((c) => opts.mode === 'free' || isDue(progressFor(c.id), now))
    .sort(
      (a, b) => progressFor(a.id).fsrs.due.getTime() - progressFor(b.id).fsrs.due.getTime(),
    )
    .slice(0, opts.size);

  // New glyphs are introduced in table order — あいうえお teaches better than
  // a random scatter — and only up to the daily ceiling.
  const introduced = fresh.slice(0, Math.max(0, Math.min(opts.newLimit, opts.size - due.length)));

  return {
    cards: shuffle([...due, ...introduced]),
    due: due.length,
    fresh: introduced.length,
    excluded,
  };
}

export interface PoolStats {
  total: number;
  /** Never shown. */
  fresh: number;
  /** Seen, but not yet stable enough to count as learned. */
  learning: number;
  /** FSRS is willing to wait a week or more. */
  learned: number;
  /** Due right now. */
  due: number;
  /** When the next card falls due, if none is due yet. */
  nextDue: Date | null;
}

export function poolStats(pool: KanaCard[], progressFor: ProgressLookup, now: Date): PoolStats {
  let fresh = 0;
  let learning = 0;
  let learned = 0;
  let due = 0;
  let nextDue: Date | null = null;

  for (const card of pool) {
    const progress = progressFor(card.id);
    if (isNew(progress)) {
      fresh++;
      continue;
    }
    if (isLearned(progress)) learned++;
    else learning++;
    if (isDue(progress, now)) due++;
    else if (nextDue === null || progress.fsrs.due < nextDue) nextDue = progress.fsrs.due;
  }

  return { total: pool.length, fresh, learning, learned, due, nextDue };
}
