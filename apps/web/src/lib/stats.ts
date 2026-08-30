import type { CardOutcome } from './session';

/** Nearest-rank percentile: no interpolation, so every reported number is one
 * measurement that actually happened. For an even count the median is the
 * lower of the two middles. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export interface SessionStats {
  total: number;
  matched: number;
  exact: number;
  containsOnly: number;
  /** Matches the per-card decoder refused and the deck-wide one caught. */
  matchedByDeck: number;
  /** Right answer, but only after the card had closed. */
  late: number;
  timeouts: number;
  skipped: number;
  /** Share of cards matched in time. */
  hitRate: number;
  /**
   * Share the engine got right at all, counting late answers. The gap between
   * this and hitRate is pure latency: recognition that works but arrives too
   * slowly to drive a speed drill.
   */
  eventualHitRate: number;
  /** Median delay of those late answers, from card shown to answer. */
  lateMedian: number | null;
  onsetMedian: number | null;
  matchMedian: number | null;
  asrLagMedian: number | null;
  asrLagP90: number | null;
  /** Cards where the engine reported something that did not match. */
  cardsWithWrongHypotheses: number;
  /**
   * Timeouts where the decoder only ever answered «[unk]»: it heard a sound
   * and could not place it. Different failure from hearing a different mora,
   * and different again from hearing nothing at all.
   */
  notPlaced: number;
  /** Timeouts where the decoder said nothing whatsoever. */
  engineSilent: number;
  /**
   * Cards that were eventually accepted but only after the decoder had first
   * answered «[unk]» — i.e. the learner had to say it again. The cost of the
   * engine's strictness, in repeats rather than in lost cards.
   */
  acceptedAfterRepeat: number;
}

export function summarize(outcomes: CardOutcome[]): SessionStats {
  const matched = outcomes.filter((o) => o.status === 'match');
  const late = outcomes.filter((o) => o.status === 'late');
  const nums = (pick: (o: CardOutcome) => number | null) =>
    outcomes.map(pick).filter((v): v is number => v !== null);

  return {
    total: outcomes.length,
    matched: matched.length,
    exact: matched.filter((o) => o.exact === true).length,
    containsOnly: matched.filter((o) => o.exact === false).length,
    matchedByDeck: matched.filter((o) => o.matchedBy === 'deck').length,
    late: late.length,
    timeouts: outcomes.filter((o) => o.status === 'timeout').length,
    skipped: outcomes.filter((o) => o.status === 'skipped').length,
    hitRate: outcomes.length === 0 ? 0 : matched.length / outcomes.length,
    eventualHitRate:
      outcomes.length === 0 ? 0 : (matched.length + late.length) / outcomes.length,
    lateMedian: percentile(nums((o) => o.lateMs), 50),
    onsetMedian: percentile(nums((o) => o.onsetMs), 50),
    matchMedian: percentile(nums((o) => o.matchMs), 50),
    asrLagMedian: percentile(nums((o) => o.asrLagMs), 50),
    asrLagP90: percentile(nums((o) => o.asrLagMs), 90),
    // «[unk]» is counted under notPlaced; lumping it in here would call every
    // unplaced sound a misrecognised mora.
    cardsWithWrongHypotheses: outcomes.filter((o) =>
      o.hypotheses.some(
        (h) => h.verdict.normalized !== '' && !h.verdict.contains && !h.verdict.partial,
      ),
    ).length,
    notPlaced: outcomes.filter(
      (o) =>
        o.status === 'timeout' &&
        o.hypotheses.length > 0 &&
        o.hypotheses.every((h) => h.verdict.normalized === ''),
    ).length,
    engineSilent: outcomes.filter((o) => o.status === 'timeout' && o.hypotheses.length === 0)
      .length,
    acceptedAfterRepeat: matched.filter((o) =>
      o.hypotheses.some((h) => h.verdict.normalized === ''),
    ).length,
  };
}

export interface RunReport {
  recognizer: string;
  rule: string;
  /** How the decoder was constrained: deck-wide, per card, or not at all. */
  grammarMode: string;
  /** ms waited after silence before committing the decoder. */
  flushDelayMs: number;
  /** Size of the restricted vocabulary, or null for free recognition. */
  grammarSize: number | null;
  timeoutMs: number;
  userAgent: string;
  startedAt: string;
  stats: SessionStats;
  cards: {
    glyph: string;
    romaji: string;
    status: string;
    onsetMs: number | null;
    speechMs: number | null;
    matchMs: number | null;
    asrLagMs: number | null;
    exact: boolean | null;
    matchedBy: string | null;
    lateMs: number | null;
    matchedTranscript: string | null;
    witnessHeard: string[];
    hypotheses: {
      transcript: string;
      source: string | null;
      atMs: number;
      final: boolean;
      matched: boolean;
      /** Kaldi's confidence, when the result carried one. */
      conf: number | null;
      /** How much audio the decoder based this on — compare with speechMs. */
      spanMs: number | null;
    }[];
  }[];
}

export function buildReport(
  outcomes: CardOutcome[],
  meta: {
    recognizer: string;
    rule: string;
    grammarMode: string;
    flushDelayMs: number;
    grammarSize: number | null;
    timeoutMs: number;
    startedAt: string;
  },
): RunReport {
  return {
    ...meta,
    userAgent: navigator.userAgent,
    stats: summarize(outcomes),
    cards: outcomes.map((o) => ({
      glyph: o.card.glyph,
      romaji: o.card.romaji,
      status: o.status,
      onsetMs: o.onsetMs,
      speechMs: o.speechMs,
      matchMs: o.matchMs,
      asrLagMs: o.asrLagMs,
      exact: o.exact,
      matchedBy: o.matchedBy,
      lateMs: o.lateMs,
      matchedTranscript: o.matchedTranscript,
      witnessHeard: o.witnessHeard,
      hypotheses: o.hypotheses.map((h) => ({
        transcript: h.transcript,
        source: h.source ?? null,
        atMs: h.atMs,
        final: h.final,
        matched: h.verdict.contains,
        conf: h.conf ?? null,
        spanMs: h.spanMs ?? null,
      })),
    })),
  };
}
