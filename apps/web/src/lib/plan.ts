import type { DrillCard } from './card';
import { currentLevel, reachedCards, type LevelProgress, type ProgressLookup } from './curriculum';
import { shuffle } from './kana';
import { isDue, isLearned, isNew } from './srs';

export interface SessionPlan {
  cards: DrillCard[];
  /**
   * Cards whose first answer this session counts towards the schedule: the
   * ones the scheduler actually asked for, plus the new ones. Everything else
   * in `cards` is practice — see `fill`.
   */
  scheduled: Set<string>;
  /** How many of them are repeats the schedule asked for. */
  due: number;
  /** How many are glyphs the learner has never seen. */
  fresh: number;
  /** Cards added for practice: met before, not due yet. */
  practice: number;
  /** Which level the new glyphs came from. */
  fromLevel: string | null;
  /** Cards left out because the recogniser has no word for them. */
  excluded: DrillCard[];
}

export interface PlanOptions {
  size: number;
  newLimit: number;
  /** Drop cards the decoder cannot output (voice sessions only). */
  excludeOov: boolean;
}

/**
 * Build one session out of the syllabus.
 *
 * Reviews are drawn from every level the learner has reached; new glyphs only
 * from the level they are on. That is the whole of the pacing rule: nothing
 * blocks a review, and nothing hands you 花 before you can read か.
 */
export function planSession(
  state: LevelProgress[],
  progressFor: ProgressLookup,
  now: Date,
  opts: PlanOptions,
): SessionPlan {
  const reached = reachedCards(state);
  const excluded = opts.excludeOov ? reached.filter((c) => c.voiceOov) : [];
  const usable = opts.excludeOov ? reached.filter((c) => !c.voiceOov) : reached;

  const due = usable
    .filter((c) => !isNew(progressFor(c.id)))
    .filter((c) => isDue(progressFor(c.id), now))
    .sort(
      (a, b) => progressFor(a.id).fsrs.due.getTime() - progressFor(b.id).fsrs.due.getTime(),
    )
    .slice(0, opts.size);

  const level = currentLevel(state);
  // New glyphs come in the level's own order — kana by the gojūon table,
  // kanji by how often they appear in print — never at random.
  const fresh = (level?.level.cards ?? [])
    .filter((c) => !opts.excludeOov || !c.voiceOov)
    .filter((c) => isNew(progressFor(c.id)))
    .slice(0, Math.max(0, Math.min(opts.newLimit, opts.size - due.length)));

  const scheduled = new Set([...due, ...fresh].map((c) => c.id));

  /**
   * Whatever room is left goes to glyphs already met but not yet due, the
   * nearest to falling due first.
   *
   * The schedule answers one question — when will this be forgotten — and it
   * answers it in days. But this drill has a second goal the scheduler knows
   * nothing about: making the answer *fast*. Speed comes from repetition, not
   * from waiting, and there is nothing to be gained by sitting idle for three
   * days with five glyphs learned. So the interval is a deadline, not a
   * quarantine: practise as much as you like before it.
   *
   * Not-yet-learned glyphs come first, and only then the due date. Sorting by
   * due date alone froze the level: a glyph is unlearned mostly because the
   * answers were slow, slow glyphs have been answered *often*, and being
   * answered often pushes the due date out — so the cards that needed the
   * work were last in a queue ordered by exactly the wrong thing.
   */
  const rank = (card: DrillCard) => {
    const progress = progressFor(card.id);
    return [isLearned(progress) ? 1 : 0, progress.fsrs.due.getTime()] as const;
  };
  const idle = usable
    .filter((c) => !scheduled.has(c.id) && !isNew(progressFor(c.id)))
    .sort((a, b) => {
      const [aLearned, aDue] = rank(a);
      const [bLearned, bDue] = rank(b);
      return aLearned - bLearned || aDue - bDue;
    })
    .slice(0, Math.max(0, opts.size - scheduled.size));

  return {
    cards: fill(shuffle([...due, ...fresh, ...idle]), fresh, opts.size),
    scheduled,
    due: due.length,
    fresh: fresh.length,
    practice: idle.length,
    fromLevel: fresh.length > 0 ? (level?.level.id ?? null) : null,
    excluded,
  };
}

/**
 * Last resort: pad the session out by showing the new glyphs again.
 *
 * Only reached when there is nothing else to practise — the very first
 * sessions, when the whole syllabus met so far is the five cards on screen.
 */
function fill(cards: DrillCard[], fresh: DrillCard[], size: number): DrillCard[] {
  if (fresh.length === 0 || cards.length >= size) return cards;
  const out = [...cards];
  while (out.length < size) {
    const round = shuffle(fresh);
    // Never twice in a row across a round boundary.
    if (round.length > 1 && round[0]!.id === out[out.length - 1]!.id) round.push(round.shift()!);
    out.push(...round);
  }
  return out.slice(0, size);
}
