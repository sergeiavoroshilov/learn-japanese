import { describe, expect, test } from 'bun:test';
import { DECODER_FRAME_MS, isFragment } from './recognizer';

describe('isFragment', () => {
  test('a single decoder frame is not an answer', () => {
    expect(isFragment(DECODER_FRAME_MS)).toBe(true);
  });

  test('the shortest mora ever measured is not a fragment', () => {
    // 117 ms, a clipped つ from run 7 — accepted on the second attempt.
    expect(isFragment(117)).toBe(false);
    expect(isFragment(180)).toBe(false);
  });

  test('a result with no span at all is left alone', () => {
    // Partials carry no timing; dropping them would blind the live view.
    expect(isFragment(undefined)).toBe(false);
  });
});
