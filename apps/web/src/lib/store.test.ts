import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_SETTINGS,
  ProgressStore,
  STORAGE_KEY,
  deserialize,
  serialize,
  type StorageLike,
} from './store';
import { applyAnswer, newProgress } from './srs';

const NOW = new Date('2026-08-31T09:00:00Z');

function memory(seed: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...seed };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe('serialisation', () => {
  test('due dates survive the round trip as Dates, not strings', () => {
    const progress = applyAnswer(newProgress('hira-か', NOW), { quality: 'correct', onsetMs: 700 }, NOW)
      .progress;
    const restored = deserialize(
      serialize({ version: 1, cards: { 'hira-か': progress }, reviews: [], settings: { ...DEFAULT_SETTINGS } }),
    );
    // JSON turns a Date into a string; everything downstream calls getTime()
    // on it, which would silently be NaN.
    expect(restored.cards['hira-か']!.fsrs.due).toBeInstanceOf(Date);
    expect(restored.cards['hira-か']!.fsrs.due.getTime()).toBe(progress.fsrs.due.getTime());
    expect(restored.cards['hira-か']!.fsrs.last_review).toBeInstanceOf(Date);
  });

  test('unknown settings fall back to defaults instead of undefined', () => {
    const restored = deserialize('{"version":1,"cards":{},"reviews":[],"settings":{"sessionSize":7}}');
    expect(restored.settings.sessionSize).toBe(7);
    expect(restored.settings.decks).toEqual(['hira-basic']);
  });
});

describe('ProgressStore', () => {
  test('a fresh store hands out unseen cards', () => {
    const store = new ProgressStore(memory());
    expect(store.progressFor('hira-か', NOW).graded).toBe(0);
  });

  test('answers are persisted immediately', () => {
    const storage = memory();
    const store = new ProgressStore(storage);
    const applied = applyAnswer(store.progressFor('hira-か', NOW), { quality: 'correct', onsetMs: 700 }, NOW);
    store.record(applied.progress, {
      id: 'hira-か',
      at: NOW.toISOString(),
      quality: 'correct',
      onsetMs: 700,
      rating: applied.rating,
    });

    const reopened = new ProgressStore(storage);
    expect(reopened.progressFor('hira-か', NOW).graded).toBe(1);
    expect(reopened.progress.reviews).toHaveLength(1);
  });

  test('a corrupt blob starts over rather than bricking the app', () => {
    const store = new ProgressStore(memory({ [STORAGE_KEY]: 'not json' }));
    expect(store.progress.cards).toEqual({});
    expect(store.settings.decks).toEqual(['hira-basic']);
  });

  test('a browser with storage switched off still runs a session', () => {
    const store = new ProgressStore(null);
    const applied = applyAnswer(store.progressFor('hira-か', NOW), { quality: 'correct', onsetMs: 700 }, NOW);
    expect(() =>
      store.record(applied.progress, {
        id: 'hira-か',
        at: NOW.toISOString(),
        quality: 'correct',
        onsetMs: 700,
        rating: applied.rating,
      }),
    ).not.toThrow();
    expect(store.progressFor('hira-か', NOW).graded).toBe(1);
  });

  test('reset clears progress but keeps the chosen decks', () => {
    const store = new ProgressStore(memory());
    store.saveSettings({ ...DEFAULT_SETTINGS, decks: ['kata-basic'], sessionSize: 30 });
    const applied = applyAnswer(store.progressFor('kata-か', NOW), { quality: 'correct', onsetMs: 700 }, NOW);
    store.record(applied.progress, {
      id: 'kata-か',
      at: NOW.toISOString(),
      quality: 'correct',
      onsetMs: 700,
      rating: applied.rating,
    });

    store.reset();
    expect(store.progress.cards).toEqual({});
    expect(store.settings.decks).toEqual(['kata-basic']);
    expect(store.settings.sessionSize).toBe(30);
  });
});
