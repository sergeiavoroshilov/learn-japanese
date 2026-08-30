import { expectedFor, judge, type MatchVerdict } from './match';
import type { CardOutcome } from './session';
import type { AnswerQuality } from './srs';

/**
 * Everything grading needs from a finished card, with nothing from the
 * recogniser plumbing attached. Kept separate so the rule below can be tested
 * without loading a WASM decoder.
 */
export interface AnswerFacts {
  status: 'match' | 'late' | 'timeout' | 'skipped';
  onsetMs: number | null;
  /** Readings some decoder actually placed, normalised, «[unk]» removed. */
  heard: string[];
  /** Any decoder produced output at all, even if only «[unk]». */
  soundHeard: boolean;
  /** The answer was only accepted after an unplaced first attempt. */
  repeated: boolean;
}

/**
 * A reading that is neither the expected one nor an unfinished beginning of
 * it. Interim results arrive as prefixes — «き» on the way to «きゃ» — and
 * counting those as a different mora would turn every slow youon into a
 * reading error.
 */
function offTarget(verdict: MatchVerdict): boolean {
  return verdict.normalized !== '' && !verdict.contains && !verdict.partial;
}

export function factsFrom(outcome: CardOutcome): AnswerFacts {
  const expected = expectedFor(outcome.card);
  const heard = [
    ...outcome.hypotheses.map((h) => h.verdict),
    // The control decoder reports raw text; it has not been judged yet.
    ...outcome.witnessHeard.map((text) => judge(text, expected)),
  ]
    .filter(offTarget)
    .map((v) => v.normalized);

  return {
    status: outcome.status,
    onsetMs: outcome.onsetMs,
    heard,
    soundHeard: outcome.hypotheses.length > 0 || outcome.witnessHeard.length > 0,
    repeated: outcome.hypotheses.some((h) => h.verdict.normalized === ''),
  };
}

/**
 * The three-way split the spike ended on: a correct answer, a real reading
 * error, and a card the recogniser simply could not place. Only the first two
 * say anything about the learner, and only they may reach the scheduler.
 */
export function classify(facts: AnswerFacts): AnswerQuality {
  if (facts.status === 'match' || facts.status === 'late') return 'correct';
  if (facts.status === 'skipped') return 'skipped';

  // A different, existing mora came back — that is a misreading.
  if (facts.heard.length > 0) return 'wrong';
  // Sound arrived and nothing could be made of it: the decoder's problem.
  if (facts.soundHeard) return 'unplaced';
  // The decoder said nothing. The microphone's own VAD decides whether that
  // is because the learner stayed silent, or because a real answer went by
  // unheard — the difference between «forgot it» and «engine missed it».
  return facts.onsetMs === null ? 'silent' : 'unplaced';
}
