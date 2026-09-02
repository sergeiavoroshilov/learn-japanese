import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DrillCard } from '../lib/card';
import { NAMEABLE_CARDS } from '../lib/kana';
import { curriculum, type LevelProgress } from '../lib/curriculum';
import { classify, factsFrom } from '../lib/grade';
import { grammarFor } from '../lib/match';
import { correctionFor, type Correction } from '../lib/pronounce';
import { planSession } from '../lib/plan';
import { DrillSession, type Engine, type SessionSnapshot } from '../lib/session';
import { applyAnswer, isNew, type AnswerQuality, type CardProgress } from '../lib/srs';
import { ProgressStore, type Settings } from '../lib/store';
import { ScreenWakeLock, type WakeLockState } from '../lib/wakelock';
import { Drill } from './Drill';
import { Home } from './Home';
import { Stats } from './Stats';
import { Summary } from './Summary';

export interface CardResult {
  card: DrillCard;
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
  awaitingContinue: false,
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

/**
 * A card is shown with its reading for the first couple of answers, then on
 * its own. Asking someone to recall what they have never been told is not a
 * test of memory, it is a guessing game.
 */
const TEACH_REPS = 2;

export function Trainer() {
  const storeRef = useRef<ProgressStore | null>(null);
  storeRef.current ??= new ProgressStore();
  const store = storeRef.current;

  const mock = useMemo(() => new URLSearchParams(window.location.search).has('mock'), []);
  const engine: Engine = mock ? 'mock' : 'vosk';

  const [settings, setSettings] = useState<Settings>(store.settings);
  const [screen, setScreen] = useState<'home' | 'drill' | 'summary' | 'stats'>('home');
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(IDLE);
  const [results, setResults] = useState<CardResult[]>([]);
  const [micLevel, setMicLevel] = useState(0);
  /** Why the last attempt to start failed — a blocked microphone, usually. */
  const [failure, setFailure] = useState<string | null>(null);
  /** Bumped after every answer so the dashboard re-reads the store. */
  const [revision, setRevision] = useState(0);

  const sessionRef = useRef<DrillSession | null>(null);
  const requeuesRef = useRef(new Map<string, number>());
  /** Cards already sent to the scheduler in this session. */
  const gradedRef = useRef(new Set<string>());
  /** Cards this session was actually asked for, as opposed to practice. */
  const scheduledRef = useRef(new Set<string>());
  /**
   * Cards still being taught rather than tested. Frozen when the session
   * starts: a card must not stop showing its reading halfway through, in the
   * middle of the very repeat that is teaching it.
   */
  const [teaching, setTeaching] = useState<Set<string>>(new Set());
  const wakeLockRef = useRef<ScreenWakeLock | null>(null);
  wakeLockRef.current ??= new ScreenWakeLock();
  const [wakeLock, setWakeLock] = useState<WakeLockState>('idle');

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

  const state: LevelProgress[] = useMemo(
    () => curriculum(progressFor, new Date()),
    [progressFor],
  );

  const start = useCallback(() => {
    const now = new Date();
    const look = (id: string) => store.progressFor(id, now);
    const built = planSession(curriculum(look, now), look, now, {
      size: settings.sessionSize,
      newLimit: settings.newPerSession,
      excludeOov: engine === 'vosk',
    });
    if (built.cards.length === 0) return;

    sessionRef.current?.stop();
    requeuesRef.current = new Map();
    gradedRef.current = new Set();
    scheduledRef.current = built.scheduled;
    setResults([]);
    setFailure(null);
    setTeaching(
      new Set(
        built.cards
          .filter((c) => store.progressFor(c.id, now).fsrs.reps < TEACH_REPS)
          .map((c) => c.id),
      ),
    );
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
      deckVocabulary: grammarFor(built.cards.filter((c) => !c.voiceOov)),
      witnessVocabulary: grammarFor(NAMEABLE_CARDS),
      witness: true,
      acceptFromWitness: true,
      flushOnSilence: true,
      // Stop on a miss and wait: the correction is the point of that moment.
      pauseOnMiss: true,
      onUpdate: setSnapshot,
      onOutcome: (outcome) => {
        const at = new Date();
        const facts = factsFrom(outcome);
        const quality = classify(facts);
        const before = store.progressFor(outcome.card.id, at);
        const introduced = isNew(before);
        // Only the first answer to a card moves its schedule. The rest of
        // the session is practice: it sharpens the glyph and is measured,
        // but FSRS must not read «answered right four times in a minute» as
        // a memory that has held for a minute.
        //
        // Cards added to fill the session were not due, and getting one of
        // those right says little — it was never in doubt. Getting one wrong
        // says a great deal: the interval was too long. So an early success
        // leaves the schedule alone and an early failure does not.
        const seenBefore = gradedRef.current.has(outcome.card.id);
        const asked = scheduledRef.current.has(outcome.card.id);
        const failed = quality === 'wrong' || quality === 'silent';
        const practice = seenBefore || (!asked && !failed);
        gradedRef.current.add(outcome.card.id);
        const applied = applyAnswer(
          before,
          {
            quality,
            onsetMs: outcome.onsetMs,
            repeated: facts.repeated,
            assisted: teaching.has(outcome.card.id),
            firstThisSession: !seenBefore,
            practice,
          },
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

  /**
   * A drill is minutes of talking at the screen without touching it, which is
   * exactly what a phone treats as idle. Hold the screen awake for as long as
   * the drill runs, and no longer.
   */
  useEffect(() => {
    const lock = wakeLockRef.current!;
    if (screen !== 'drill') {
      void lock.release().then(() => setWakeLock(lock.status));
      return;
    }
    void lock.hold().then(() => setWakeLock(lock.status));
    return () => void lock.release();
  }, [screen]);

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
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        // The same key does both, because at any moment only one of them is
        // possible: you cannot give up on a card that is already finished.
        if (snapshot.awaitingContinue) sessionRef.current?.resume();
        else if (e.code === 'Space') sessionRef.current?.skip();
      }
      if (e.code === 'Escape') stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen, stop, snapshot.awaitingContinue]);

  const lastResult = results.length > 0 ? results[results.length - 1]! : null;

  return (
    <main className="page">
      {screen === 'home' && (
        <Home
          settings={settings}
          onSettings={updateSettings}
          state={state}
          store={store}
          mock={mock}
          failure={failure}
          onStart={start}
          onStats={() => setScreen('stats')}
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
          wakeLock={wakeLock}
          teaching={teaching}
          lastResult={lastResult}
          onContinue={() => sessionRef.current?.resume()}
          onSkip={() => sessionRef.current?.skip()}
          onStop={stop}
        />
      )}

      {screen === 'stats' && (
        <Stats store={store} state={state} onBack={() => setScreen('home')} />
      )}

      {screen === 'summary' && (
        <Summary
          results={results}
          onAgain={start}
          onHome={() => {
            setSnapshot(IDLE);
            setScreen('home');
          }}
        />
      )}
    </main>
  );
}
