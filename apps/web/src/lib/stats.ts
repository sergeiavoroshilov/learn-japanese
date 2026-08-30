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
  timeouts: number;
  skipped: number;
  /** Share of cards the engine matched at all. */
  hitRate: number;
  onsetMedian: number | null;
  matchMedian: number | null;
  asrLagMedian: number | null;
  asrLagP90: number | null;
  /** Cards where the engine reported something that did not match. */
  cardsWithWrongHypotheses: number;
}

export function summarize(outcomes: CardOutcome[]): SessionStats {
  const matched = outcomes.filter((o) => o.status === 'match');
  const nums = (pick: (o: CardOutcome) => number | null) =>
    outcomes.map(pick).filter((v): v is number => v !== null);

  return {
    total: outcomes.length,
    matched: matched.length,
    exact: matched.filter((o) => o.exact === true).length,
    containsOnly: matched.filter((o) => o.exact === false).length,
    timeouts: outcomes.filter((o) => o.status === 'timeout').length,
    skipped: outcomes.filter((o) => o.status === 'skipped').length,
    hitRate: outcomes.length === 0 ? 0 : matched.length / outcomes.length,
    onsetMedian: percentile(nums((o) => o.onsetMs), 50),
    matchMedian: percentile(nums((o) => o.matchMs), 50),
    asrLagMedian: percentile(nums((o) => o.asrLagMs), 50),
    asrLagP90: percentile(nums((o) => o.asrLagMs), 90),
    cardsWithWrongHypotheses: outcomes.filter((o) =>
      o.hypotheses.some((h) => !h.verdict.contains && !h.verdict.partial),
    ).length,
  };
}

export interface RunReport {
  recognizer: string;
  rule: string;
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
    matchMs: number | null;
    asrLagMs: number | null;
    exact: boolean | null;
    matchedTranscript: string | null;
    hypotheses: { transcript: string; atMs: number; final: boolean; matched: boolean }[];
  }[];
}

export function buildReport(
  outcomes: CardOutcome[],
  meta: {
    recognizer: string;
    rule: string;
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
      matchMs: o.matchMs,
      asrLagMs: o.asrLagMs,
      exact: o.exact,
      matchedTranscript: o.matchedTranscript,
      hypotheses: o.hypotheses.map((h) => ({
        transcript: h.transcript,
        atMs: h.atMs,
        final: h.final,
        matched: h.verdict.contains,
      })),
    })),
  };
}
