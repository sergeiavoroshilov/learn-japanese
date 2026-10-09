import { beforeAll, describe, expect, test } from 'bun:test';
import { ALL_CARDS } from './kana';
import { expectedFor, judge } from './match';
import type { Hypothesis, RecognizerEvents } from './recognizer';
import { DrillSession, type SessionSnapshot } from './session';
import type { Speaker } from './speech';

beforeAll(() => {
  // The session schedules on `window`; the mock recogniser listens on it.
  (globalThis as { window?: unknown }).window ??= {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    addEventListener() {},
    removeEventListener() {},
  };
});

const u = ALL_CARDS.find((c) => c.glyph === 'う')!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A voice that finishes only when told to. */
function fakeSpeaker() {
  const state = { said: [] as string[], cancelled: 0, finish: () => {} };
  const speaker: Speaker = {
    prime() {},
    say(text) {
      state.said.push(text);
      return new Promise((resolve) => (state.finish = resolve));
    },
    cancel() {
      state.cancelled++;
      state.finish();
    },
  };
  return { state, speaker };
}

async function missedSession() {
  const { state, speaker } = fakeSpeaker();
  let last: SessionSnapshot | null = null;
  const session = new DrillSession({
    cards: [u],
    timeoutMs: 60_000,
    rule: 'exact',
    engine: 'mock',
    pauseOnMiss: true,
    speaker,
    onUpdate: (s) => (last = s),
  });
  await session.start();
  session.skip();
  // Reaching into the recogniser stands in for the Vosk decoder, which the
  // mock engine does not have: it is what reports a voice it overheard.
  const events = (session as unknown as { recognizer: { events: RecognizerEvents } }).recognizer.events;
  const hit: Hypothesis = { transcript: 'う', atMs: 100, final: true, verdict: judge('う', expectedFor(u)) };
  return { session, state, events, hit, snapshot: () => last! };
}

describe('DrillSession with a speaker', () => {
  test('says the reading of a missed card by itself', async () => {
    const { state, snapshot } = await missedSession();
    expect(state.said).toEqual(['う']);
    expect(snapshot().awaitingContinue).toBe(true);
    expect(snapshot().speaking).toBe(true);
  });

  test('the voice saying the answer does not turn the miss into a hit', async () => {
    const { events, hit, snapshot } = await missedSession();
    // Overheard between cards this would be booked as a late answer.
    events.onLateMatch(hit);
    events.onMatch(hit);
    events.onWitness?.('う');
    expect(snapshot().outcomes.map((o) => o.status)).toEqual(['skipped']);
    expect(snapshot().awaitingContinue).toBe(true);
    expect(snapshot().liveWitness).toEqual([]);
  });

  test('listens for the learner again once the voice and its echo are gone', async () => {
    const { state, events, hit, snapshot } = await missedSession();
    state.finish();
    await sleep(700);
    expect(snapshot().speaking).toBe(false);
    events.onMatch(hit);
    expect(snapshot().lastStatus).toBe('match');
    expect(snapshot().outcomes.map((o) => o.status)).toEqual(['skipped']);
  });

  test('going on cuts the voice off', async () => {
    const { session, state, snapshot } = await missedSession();
    session.resume();
    expect(state.cancelled).toBe(1);
    expect(snapshot().speaking).toBe(false);
  });
});
