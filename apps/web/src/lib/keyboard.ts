import { judge, type Expected } from './match';
import type { OnsetSource } from './onset';
import type { DrillRecognizer, Hypothesis, MatchRule, RecognizerEvents } from './recognizer';

/**
 * Keyboard stand-in for the recognizer (`?mock=1`).
 *
 * Type the romaji reading instead of speaking it. Two uses:
 *   - drives the drill loop where no mic is available (CI, browser sandboxes);
 *   - keeps the `DrillRecognizer` seam honest — variant B (OpenAI streaming
 *     transcription, see docs/TECH.md) has to drop in the same way.
 *
 * Onset here is the first keystroke, so it is a real measurement; engine lag is
 * zero by construction, which is exactly why mock runs cannot answer the
 * go/no-go question.
 */
export class KeyboardSource implements DrillRecognizer, OnsetSource {
  readonly name = 'Клавиатура (мок)';
  readonly level = 0;
  readonly threshold = 0;

  private expected: Expected | null = null;
  private shownAt = 0;
  private buffer = '';
  private matched = false;
  private onOnset: ((ms: number) => void) | null = null;
  private listener = (e: KeyboardEvent) => this.handleKey(e);

  constructor(
    private readonly events: RecognizerEvents,
    private readonly rule: MatchRule,
  ) {}

  async start(_mic?: unknown): Promise<void> {
    window.addEventListener('keydown', this.listener);
    this.events.onListening(true);
  }

  expect(expected: Expected, shownAt: number): void {
    this.expected = expected;
    this.shownAt = shownAt;
    this.buffer = '';
    this.matched = false;
  }

  arm(onOnset: (ms: number) => void): void {
    this.onOnset = onOnset;
  }

  disarm(): void {
    this.expected = null;
    this.onOnset = null;
  }

  /** Typing has no engine lag, so there is nothing to commit early. */
  onSpeechEnd(_cb: (speechMs: number) => void): void {}

  stop(): void {
    window.removeEventListener('keydown', this.listener);
    this.disarm();
    this.events.onListening(false);
  }

  private handleKey(e: KeyboardEvent): void {
    const expected = this.expected;
    if (!expected || this.matched) return;
    // Space skips the card and Escape stops the session — leave them alone.
    if (e.key.length !== 1 || e.key === ' ' || e.metaKey || e.ctrlKey || e.altKey) return;

    if (this.buffer === '') {
      const onset = Math.round(performance.now() - this.shownAt);
      this.onOnset?.(onset);
      this.onOnset = null;
    }
    this.buffer += e.key.toLowerCase();

    const atMs = Math.round(performance.now() - this.shownAt);
    const verdict = judge(this.buffer, expected);
    const hypothesis: Hypothesis = { transcript: this.buffer, atMs, final: false, verdict };
    this.events.onHypothesis(hypothesis);

    if (this.rule === 'exact' ? verdict.exact : verdict.contains) {
      this.matched = true;
      this.events.onMatch(hypothesis);
    }
  }
}
