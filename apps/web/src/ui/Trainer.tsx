import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NAMEABLE_CARDS, cardsOf, type KanaCard } from '../lib/kana';
import { classify, factsFrom } from '../lib/grade';
import { grammarFor } from '../lib/match';
import { correctionFor, type Correction } from '../lib/pronounce';
import { planSession, type SessionPlan } from '../lib/plan';
import { DrillSession, type Engine, type SessionSnapshot } from '../lib/session';
import { applyAnswer, isNew, type AnswerQuality, type CardProgress } from '../lib/srs';
import { ProgressStore, type Settings } from '../lib/store';
import { Drill } from './Drill';
import { Home } from './Home';
import { Summary } from './Summary';

export interface CardResult {
  card: KanaCard;
  quality: AnswerQuality;
  onsetMs: number | null;
  /** FSRS grade, or null when the answer never reached the scheduler. */
  rating: number | null;
  /** Days until this card is due again. */
  intervalDays: number | null;
  /** The learner met this glyph for the first time in this session. */
  introduced: boolean;
  /** What was heard instead, and what to do about it. */
  correction: Correction | null;
}

const IDLE: SessionSnapshot = {
  status: 'idle',
  statusText: '',
  cardIndex: -1,
  totalCards: 0,
  remaining: 0,
  current: null,
  lastStatus: null,
  liveHypotheses: [],
  liveWitness: [],
  liveOnsetMs: null,
  outcomes: [],
  listening: false,
  error: null,
  recognizerName: '',
};

/** How many times one card may come back inside a single session. */
const MAX_REQUEUES = 2;

export function Trainer() {
  const storeRef = useRef<ProgressStore | null>(null);
  storeRef.current ??= new ProgressStore();
  const store = storeRef.current;

  const mock = useMemo(() => new URLSearchParams(window.location.search).has('mock'), []);
  const engine: Engine = mock ? 'mock' : 'vosk';

  const [settings, setSettings] = useState<Settings>(store.settings);
  const [screen, setScreen] = useState<'home' | 'drill' | 'summary'>('home');
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(IDLE);
  const [results, setResults] = useState<CardResult[]>([]);
  const [plan, setPlan] = useState<SessionPlan | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  /** Why the last attempt to start failed — a blocked microphone, usually. */
  const [failure, setFailure] = useState<string | null>(null);
  /** Bumped after every answer so the dashboard re-reads the store. */
  const [revision, setRevision] = useState(0);

  const sessionRef = useRef<DrillSession | null>(null);
  const requeuesRef = useRef(new Map<string, number>());

  const progressFor = useCallback(
    (id: string): CardProgress => store.progressFor(id, new Date()),
    // revision is the dependency that matters: the store mutates in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, revision],
  );

  const updateSettings = useCallback(
    (next: Settings) => {
      setSettings(next);
      store.saveSettings(next);
    },
    [store],
  );

  const start = useCallback((mode: 'due' | 'free' = 'due') => {
    const now = new Date();
    const pool = cardsOf(settings.decks);
    const built = planSession(pool, (id) => store.progressFor(id, now), now, {
      size: settings.sessionSize,
      newLimit: settings.newPerSession,
      excludeOov: engine === 'vosk',
      mode,
    });
    if (built.cards.length === 0) return;

    sessionRef.current?.stop();
    requeuesRef.current = new Map();
    setResults([]);
    setPlan(built);
    setFailure(null);
    setScreen('drill');

    const session = new DrillSession({
      cards: built.cards,
      timeoutMs: settings.timeoutMs,
      // Only ever the expected mora or «[unk]» comes back from a per-card
      // grammar, so a loose «contains» rule would buy nothing but false hits.
      rule: 'exact',
      engine,
      grammarMode: 'card',
      // The deck-wide decoder runs alongside and never decides anything on its
      // own; its job is to name the mora the learner actually said, which is
      // what separates a misreading from a sound the decoder could not place.
      deckVocabulary: grammarFor(pool.filter((c) => !c.voiceOov)),
      witnessVocabulary: grammarFor(NAMEABLE_CARDS),
      witness: true,
      acceptFromWitness: true,
      flushOnSilence: true,
      onUpdate: setSnapshot,
      onOutcome: (outcome) => {
        const at = new Date();
        const facts = factsFrom(outcome);
        const quality = classify(facts);
        const before = store.progressFor(outcome.card.id, at);
        const introduced = isNew(before);
        const applied = applyAnswer(
          before,
          { quality, onsetMs: outcome.onsetMs, repeated: facts.repeated },
          at,
        );
        store.record(applied.progress, {
          id: outcome.card.id,
          at: at.toISOString(),
          quality,
          onsetMs: outcome.onsetMs,
          rating: applied.rating,
        });
        setResults((prev) => [
          ...prev,
          {
            card: outcome.card,
            quality,
            onsetMs: outcome.onsetMs,
            rating: applied.rating,
            intervalDays: applied.intervalDays,
            introduced,
            correction: correctionFor(outcome.card, outcome.witnessHeard),
          },
        ]);
        setRevision((r) => r + 1);

        // Anything short of a clean answer comes back later in this session —
        // including a card the decoder failed to place, which is the one case
        // where the learner may well have been right all along.
        if (quality === 'correct' || quality === 'skipped') return;
        const seen = requeuesRef.current.get(outcome.card.id) ?? 0;
        if (seen >= MAX_REQUEUES) return;
        requeuesRef.current.set(outcome.card.id, seen + 1);
        sessionRef.current?.requeue(outcome.card);
      },
    });
    sessionRef.current = session;
    void session.start();
  }, [engine, settings, store]);

  const stop = useCallback(() => {
    sessionRef.current?.stop();
    sessionRef.current = null;
    setScreen((s) => (s === 'drill' ? 'summary' : s));
  }, []);

  useEffect(() => {
    if (screen !== 'drill') return;
    if (snapshot.status === 'done') setScreen('summary');
    // A drill that could not start — no microphone permission, no model — has
    // nothing to show but a dead stage. Say why, back on the screen that has
    // the controls to do something about it.
    if (snapshot.status === 'error') {
      sessionRef.current?.stop();
      sessionRef.current = null;
      setFailure(snapshot.error);
      setScreen('home');
    }
  }, [snapshot.status, snapshot.error, screen]);

  // Mic meter, so a dead microphone is obvious before blaming the recogniser.
  useEffect(() => {
    if (screen !== 'drill') return;
    const id = window.setInterval(() => setMicLevel(sessionRef.current?.micLevel ?? 0), 60);
    return () => window.clearInterval(id);
  }, [screen]);

  useEffect(() => () => sessionRef.current?.stop(), []);

  useEffect(() => {
    if (screen !== 'drill') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        sessionRef.current?.skip();
      }
      if (e.code === 'Escape') stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen, stop]);

  const lastResult = results.length > 0 ? results[results.length - 1]! : null;

  return (
    <main className="page">
      {screen === 'home' && (
        <Home
          settings={settings}
          onSettings={updateSettings}
          progressFor={progressFor}
          store={store}
          mock={mock}
          failure={failure}
          onStart={start}
          onImported={() => {
            setSettings(store.settings);
            setRevision((r) => r + 1);
          }}
        />
      )}

      {screen === 'drill' && (
        <Drill
          snapshot={snapshot}
          micLevel={micLevel}
          showRomaji={settings.showRomaji}
          lastResult={lastResult}
          onSkip={() => sessionRef.current?.skip()}
          onStop={stop}
        />
      )}

      {screen === 'summary' && (
        <Summary
          results={results}
          plan={plan}
          onAgain={() => start('due')}
          onHome={() => {
            setSnapshot(IDLE);
            setScreen('home');
          }}
        />
      )}
    </main>
  );
}
