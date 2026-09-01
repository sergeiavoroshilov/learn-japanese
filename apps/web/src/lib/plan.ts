import type { DrillCard } from './card';
import { currentLevel, reachedCards, type LevelProgress, type ProgressLookup } from './curriculum';
import { shuffle } from './kana';
import { isDue, isNew } from './srs';

export interface SessionPlan {
  cards: DrillCard[];
  /** How many of them are repeats the schedule asked for. */
  due: number;
  /** How many are glyphs the learner has never seen. */
  fresh: number;
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
  /**
   * «free» ignores the due dates and drills whatever is closest to falling
   * due. Reviewing early is not cheating — FSRS accounts for the shorter
   * interval and simply grants less stability — so wanting another round when
   * nothing is due should not be refused.
   */
  mode?: 'due' | 'free';
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
    .filter((c) => opts.mode === 'free' || isDue(progressFor(c.id), now))
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

  return {
    cards: fill(shuffle([...due, ...fresh]), fresh, opts.size),
    due: due.length,
    fresh: fresh.length,
    fromLevel: fresh.length > 0 ? (level?.level.id ?? null) : null,
    excluded,
  };
}

/**
 * Pad the session out to the requested length by showing the new glyphs
 * again.
 *
 * A glyph met for the first time needs several looks in one sitting; a review
 * needs one, which is the whole point of scheduling it. So only the new ones
 * repeat — a session of three due cards stays three cards long, because
 * asking them seven times each would teach nothing.
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
