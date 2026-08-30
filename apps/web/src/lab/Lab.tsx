import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DECKS,
  NAMEABLE_CARDS,
  VOICE_OOV_KANA,
  drawFrom,
  type DeckId,
  type KanaCard,
} from '../lib/kana';
import { KanaGrid } from './KanaGrid';
import { grammarFor } from '../lib/match';
import { correctionFor } from '../lib/pronounce';
import { isWebSpeechSupported, type MatchRule } from '../lib/recognizer';
import { DrillSession, type Engine, type SessionSnapshot } from '../lib/session';
import { buildReport, summarize } from '../lib/stats';
import { type GrammarMode } from '../lib/vosk';

const ENGINE_LABELS: Record<Engine, string> = {
  vosk: 'Vosk в браузере (локально)',
  webspeech: 'Web Speech API (отклонён спайком №1)',
  mock: 'Клавиатура (мок)',
};

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
  recognizerName: 'Web Speech API',
};

export function Lab() {
  const [decks, setDecks] = useState<DeckId[]>(['hira-basic']);
  /**
   * Individual cards in play. The deck chips decide which tables are on
   * screen; this decides which of their moras a run actually draws from, so a
   * measurement can be aimed at one row — «только гласные» — instead of a
   * random twenty out of forty-six.
   */
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(DECKS.find((d) => d.id === 'hira-basic')!.cards.map((c) => c.id)),
  );
  const [count, setCount] = useState(20);
  const [timeoutMs, setTimeoutMs] = useState(6000);
  const [rule, setRule] = useState<MatchRule>('exact');
  const [showRomaji, setShowRomaji] = useState(false);
  const [engine, setEngine] = useState<Engine>('vosk');
  const [grammarMode, setGrammarMode] = useState<GrammarMode>('card');
  const [flushOnSilence, setFlushOnSilence] = useState(true);
  const [witness, setWitness] = useState(true);
  const [acceptFromWitness, setAcceptFromWitness] = useState(true);
  const [interCardMs, setInterCardMs] = useState(220);
  const [flushDelayMs, setFlushDelayMs] = useState(250);
  const [longForms, setLongForms] = useState(true);

  const [snapshot, setSnapshot] = useState<SessionSnapshot>(IDLE);
  const [micLevel, setMicLevel] = useState(0);
  const [startedAt, setStartedAt] = useState<string>('');

  const sessionRef = useRef<DrillSession | null>(null);

  const mock = useMemo(() => new URLSearchParams(window.location.search).has('mock'), []);
  const activeEngine: Engine = mock ? 'mock' : engine;
  const supported = useMemo(
    () => activeEngine !== 'webspeech' || isWebSpeechSupported(),
    [activeEngine],
  );
  const secure = window.isSecureContext || activeEngine === 'mock';
  const running = snapshot.status === 'running' || snapshot.status === 'starting';

  /**
   * The restricted vocabulary handed to Vosk: every mora in the selected decks.
   * Three rare youon are not in the model's lexicon, so they are dropped from
   * both the vocabulary and the deck — a card the decoder cannot output would
   * otherwise look like a recognition failure.
   */
  const grammarActive = activeEngine === 'vosk' && grammarMode !== 'none';
  const shown = useMemo(() => DECKS.filter((d) => decks.includes(d.id)), [decks]);
  const pool = useMemo<KanaCard[]>(
    () => shown.flatMap((d) => d.cards).filter((c) => selected.has(c.id)),
    [shown, selected],
  );
  /** The control decoder always knows the whole table, not just the selection. */
  const witnessVocabulary = useMemo(() => grammarFor(NAMEABLE_CARDS), []);
  const vocabulary = useMemo(
    () =>
      grammarActive
        ? grammarFor(
            pool.filter((c) => !VOICE_OOV_KANA.includes(c.kana)),
            longForms,
          )
        : null,
    [grammarActive, pool, longForms],
  );

  const start = useCallback(() => {
    const deck = drawFrom(
      pool.filter((card) => !grammarActive || !VOICE_OOV_KANA.includes(card.kana)),
      count,
    );
    if (deck.length === 0) return;
    sessionRef.current?.stop();
    const session = new DrillSession({
      cards: deck,
      timeoutMs,
      rule,
      engine: activeEngine,
      grammarMode: activeEngine === 'vosk' ? grammarMode : undefined,
      deckVocabulary: vocabulary ?? [],
      witnessVocabulary: witnessVocabulary,
      witness: grammarMode === 'card' && witness,
      acceptFromWitness: grammarMode === 'card' && witness && acceptFromWitness,
      flushOnSilence,
      flushDelayMs,
      interCardMs,
      longForms,
      onUpdate: setSnapshot,
    });
    sessionRef.current = session;
    setStartedAt(new Date().toISOString());
    void session.start();
  }, [
    pool,
    count,
    timeoutMs,
    rule,
    activeEngine,
    grammarMode,
    grammarActive,
    vocabulary,
    flushOnSilence,
    witness,
    acceptFromWitness,
    flushDelayMs,
    interCardMs,
    longForms,
    witnessVocabulary,
  ]);

  const stop = useCallback(() => sessionRef.current?.stop(), []);

  // Mic meter, so a dead microphone is obvious before blaming the engine.
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setMicLevel(sessionRef.current?.micLevel ?? 0), 60);
    return () => window.clearInterval(id);
  }, [running]);

  useEffect(() => () => sessionRef.current?.stop(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && running) {
        e.preventDefault();
        sessionRef.current?.skip();
      }
      if (e.code === 'Escape') stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, stop]);

  const stats = useMemo(() => summarize(snapshot.outcomes), [snapshot.outcomes]);

  /**
   * The decoder answered «[unk]»: it heard something and could not place it.
   * Saying it again is the useful move, and silence gives the user no clue.
   */
  const notPlaced =
    snapshot.liveHypotheses.length > 0 &&
    snapshot.liveHypotheses.every((h) => h.verdict.normalized === '');

  /**
   * What the control decoder made of the answer the card decoder refused.
   * «услышал を» is actionable; «не расслышал» is not.
   */
  const correction = useMemo(
    () => (snapshot.current ? correctionFor(snapshot.current, snapshot.liveWitness) : null),
    [snapshot.liveWitness, snapshot.current],
  );

  const copyReport = useCallback(async () => {
    const report = buildReport(snapshot.outcomes, {
      recognizer: snapshot.recognizerName,
      rule,
      grammarMode,
      flushDelayMs,
      grammarSize:
        grammarMode === 'card' ? 1 : grammarMode === 'deck' ? (vocabulary?.length ?? null) : null,
      timeoutMs,
      startedAt,
    });
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
  }, [
    snapshot.outcomes,
    snapshot.recognizerName,
    rule,
    grammarMode,
    flushDelayMs,
    vocabulary,
    timeoutMs,
    startedAt,
  ]);

  /** Turning a table on brings all of its moras with it; off takes them away. */
  const toggleDeck = (id: DeckId) => {
    const deck = DECKS.find((d) => d.id === id)!;
    const on = decks.includes(id);
    setDecks((prev) => (on ? prev.filter((x) => x !== id) : [...prev, id]));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const card of deck.cards) {
        if (on) next.delete(card.id);
        else next.add(card.id);
      }
      return next;
    });
  };

  return (
    <main className="page">
      <header>
        <h1>Лаборатория: замер распознавания каны</h1>
        <p className="sub">
          Показывается символ — произнесите его вслух. Замеряем отдельно время
          до начала речи (это метрика обучения) и задержку движка (это
          go/no-go для Web Speech API).
        </p>
      </header>

      {mock && (
        <div className="banner mock">
          Мок-режим: отвечайте с клавиатуры (ромадзи), микрофон не нужен.
          Задержка движка здесь нулевая по построению — на вопрос go/no-go
          такой прогон не отвечает, он только проверяет сам цикл дрилла.
        </div>
      )}
      {activeEngine === 'vosk' && !mock && (
        <div className="banner note">
          {grammarMode === 'card'
            ? 'Декодер знает одно слово — ожидаемую мору. Вопрос сводится к «это она или нет», и близкие пары (く/こ, む/も) перестают конкурировать. Обратная сторона: проверьте, не засчитывает ли он заведомо неверный ответ.'
            : grammarMode === 'deck'
              ? `Декодер выбирает из ${vocabulary?.length ?? 0} мор — подставить «部屋» вместо へ ему неоткуда, но перепутать く с こ он всё ещё может. Карточки ${VOICE_OOV_KANA.join(', ')} исключены: их нет в словаре модели.`
              : 'Свободное распознавание — контрольная группа: видно, что даёт та же модель без ограничения словаря.'}
        </div>
      )}
      {!supported && (
        <div className="banner error">
          Web Speech API не поддерживается этим браузером. Нужен Chrome
          (десктоп/Android) или Safari.
        </div>
      )}
      {!secure && (
        <div className="banner error">
          Страница открыта не в защищённом контексте — микрофон будет
          заблокирован. Откройте по <code>localhost</code> или запустите{' '}
          <code>bun run dev:https</code>.
        </div>
      )}
      {snapshot.error && <div className="banner error">Ошибка: {snapshot.error}</div>}

      {!running && (
        <section className="panel settings">
          <div className="field">
            <span className="label">Наборы</span>
            <div className="chips">
              {DECKS.map((deck) => (
                <label key={deck.id} className={decks.includes(deck.id) ? 'chip on' : 'chip'}>
                  <input
                    type="checkbox"
                    checked={decks.includes(deck.id)}
                    onChange={() => toggleDeck(deck.id)}
                  />
                  {deck.label}
                </label>
              ))}
            </div>
          </div>

          {shown.map((deck) => (
            <KanaGrid
              key={deck.id}
              deck={deck}
              selected={selected}
              onChange={setSelected}
            />
          ))}

          <div className="row">
            <label className="field">
              <span className="label">Движок</span>
              <select
                value={activeEngine}
                disabled={mock}
                onChange={(e) => setEngine(e.target.value as Engine)}
              >
                {mock ? (
                  <option value="mock">{ENGINE_LABELS.mock}</option>
                ) : (
                  <>
                    <option value="vosk">{ENGINE_LABELS.vosk}</option>
                    <option value="webspeech">{ENGINE_LABELS.webspeech}</option>
                  </>
                )}
              </select>
            </label>

            {activeEngine === 'vosk' && (
              <label className="field">
                <span className="label">Словарь декодера</span>
                <select
                  value={grammarMode}
                  onChange={(e) => setGrammarMode(e.target.value as GrammarMode)}
                >
                  <option value="card">Только ожидаемая мора</option>
                  <option value="deck">Вся колода ({vocabulary?.length ?? 0} мор)</option>
                  <option value="none">Без ограничения</option>
                </select>
              </label>
            )}
          </div>

          <div className="row">
            <label className="field">
              <span className="label">Карточек</span>
              <input
                type="number"
                min={1}
                max={200}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </label>

            <label className="field">
              <span className="label">Таймаут, мс</span>
              <input
                type="number"
                min={1000}
                max={20000}
                step={500}
                value={timeoutMs}
                onChange={(e) => setTimeoutMs(Number(e.target.value))}
              />
            </label>

            <label className="field">
              <span className="label">Правило совпадения</span>
              <select value={rule} onChange={(e) => setRule(e.target.value as MatchRule)}>
                <option value="contains">Мягкое (содержит ответ)</option>
                <option value="exact">Строгое (в точности ответ)</option>
              </select>
            </label>

            {activeEngine !== 'mock' && (
              <label className="field">
                <span className="label">Задержка коммита, мс</span>
                <input
                  type="number"
                  min={0}
                  max={1000}
                  step={50}
                  value={flushDelayMs}
                  onChange={(e) => setFlushDelayMs(Number(e.target.value))}
                />
              </label>
            )}

            <label className="field">
              <span className="label">Пауза между карточками, мс</span>
              <input
                type="number"
                min={0}
                max={2000}
                step={20}
                value={interCardMs}
                onChange={(e) => setInterCardMs(Number(e.target.value))}
              />
            </label>

            <label className="field checkbox">
              <input
                type="checkbox"
                checked={showRomaji}
                onChange={(e) => setShowRomaji(e.target.checked)}
              />
              <span>Показывать ромадзи</span>
            </label>

            {activeEngine === 'vosk' && (
              <label className="field checkbox">
                <input
                  type="checkbox"
                  checked={longForms}
                  onChange={(e) => setLongForms(e.target.checked)}
                />
                <span>Принимать долгие формы (ああ, あー)</span>
              </label>
            )}

            {activeEngine !== 'mock' && (
              <label className="field checkbox">
                <input
                  type="checkbox"
                  checked={flushOnSilence}
                  onChange={(e) => setFlushOnSilence(e.target.checked)}
                />
                <span>Отвечать по тишине, не ждать движок</span>
              </label>
            )}

            {activeEngine === 'vosk' && grammarMode === 'card' && (
              <label className="field checkbox">
                <input
                  type="checkbox"
                  checked={witness}
                  onChange={(e) => setWitness(e.target.checked)}
                />
                <span>Контрольный декодер (вся колода)</span>
              </label>
            )}

            {activeEngine === 'vosk' && grammarMode === 'card' && witness && (
              <label className="field checkbox">
                <input
                  type="checkbox"
                  checked={acceptFromWitness}
                  onChange={(e) => setAcceptFromWitness(e.target.checked)}
                />
                <span>Засчитывать и по контрольному</span>
              </label>
            )}
          </div>

          <button className="primary" onClick={start} disabled={!supported || pool.length === 0}>
            {snapshot.outcomes.length > 0 ? 'Ещё сессия' : 'Начать сессию'}
          </button>
        </section>
      )}

      {snapshot.status === 'starting' && snapshot.statusText && (
        <div className="banner note">{snapshot.statusText}</div>
      )}

      {running && (
        <section className={`panel stage ${snapshot.lastStatus ?? ''}`}>
          <div className="stage-top">
            <span className="counter">
              {snapshot.cardIndex + 1} / {snapshot.totalCards}
            </span>
            <span className={snapshot.listening ? 'mic on' : 'mic'}>
              {snapshot.listening ? 'слушаю' : 'пауза'}
            </span>
            <div className="meter">
              <div
                className="meter-fill"
                style={{ width: `${Math.min(100, Math.round(micLevel * 800))}%` }}
              />
            </div>
          </div>

          <div className="glyph">{snapshot.current?.glyph ?? '…'}</div>
          {showRomaji && <div className="romaji">{snapshot.current?.romaji}</div>}

          <div className="live">
            {notPlaced && (
              <div className="retry">
                <span>
                  {correction
                    ? `услышал «${correction.heard}» — скажите ещё раз`
                    : 'не расслышал — скажите ещё раз'}
                </span>
                {correction && <span className="retry-hint">{correction.hint}</span>}
              </div>
            )}
            <div className="live-onset">
              {snapshot.liveOnsetMs === null
                ? 'ждём речь…'
                : `начало речи: ${snapshot.liveOnsetMs} мс`}
            </div>
            <ul className="hyps">
              {snapshot.liveHypotheses.slice(-4).map((h, i) => (
                <li key={i} className={h.verdict.contains ? 'hit' : ''}>
                  <span className="t">{h.transcript}</span>
                  <span className="ms">{h.atMs} мс{h.final ? ' · final' : ''}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="stage-actions">
            <button onClick={() => sessionRef.current?.skip()}>Пропустить (Space)</button>
            <button onClick={stop}>Остановить (Esc)</button>
          </div>
        </section>
      )}

      {snapshot.outcomes.length > 0 && (
        <section className="panel results">
          <h2>
            Результаты · {snapshot.recognizerName} ·{' '}
            {rule === 'exact' ? 'строгое совпадение' : 'мягкое совпадение'}
          </h2>
          <div className="stats">
            <Stat label="Распознано" value={`${stats.matched}/${stats.total}`} hint={`${Math.round(stats.hitRate * 100)}%`} />
            <Stat
              label="Поздних ответов"
              value={String(stats.late)}
              hint={stats.lateMedian !== null ? `медиана ${ms(stats.lateMedian)}` : undefined}
            />
            <Stat
              label="С учётом поздних"
              value={`${Math.round(stats.eventualHitRate * 100)}%`}
            />
            <Stat
              label="Зачтено контрольным"
              value={String(stats.matchedByDeck)}
              hint={`из ${stats.matched}`}
            />
            <Stat
              label="Звук не опознан"
              value={String(stats.notPlaced)}
              hint="движок ответил [unk]"
            />
            <Stat label="Движок промолчал" value={String(stats.engineSilent)} />
            <Stat
              label="Зачтено со второй попытки"
              value={String(stats.acceptedAfterRepeat)}
              hint={`из ${stats.matched}`}
            />
            <Stat label="Таймауты" value={String(stats.timeouts)} />
            <Stat label="Точных / по подстроке" value={`${stats.exact} / ${stats.containsOnly}`} />
            <Stat label="Начало речи, медиана" value={ms(stats.onsetMedian)} />
            <Stat label="Задержка движка, медиана" value={ms(stats.asrLagMedian)} hint={`p90 ${ms(stats.asrLagP90)}`} />
            <Stat label="Полная латентность, медиана" value={ms(stats.matchMedian)} />
            <Stat label="Карточек с левыми гипотезами" value={String(stats.cardsWithWrongHypotheses)} />
          </div>

          <div className="verdict">
            {activeEngine === 'mock'
              ? 'Мок-прогон: задержка движка здесь искусственная, вердикт go/no-go не считается.'
              : stats.asrLagMedian !== null && stats.asrLagMedian <= 500 && stats.hitRate >= 0.9
                ? 'Похоже на go: движок укладывается в бюджет и почти не промахивается.'
                : stats.eventualHitRate >= 0.9
                  ? 'Движок узнаёт моры, но не успевает: точность с учётом поздних ответов в норме, проблема в задержке — увеличьте таймаут или проверьте «отвечать по тишине».'
                  : 'Пока не проходит: промахи или задержка выше бюджета (90% / 500 мс).'}
          </div>

          <div className="results-actions">
            <button onClick={copyReport}>Скопировать JSON-отчёт</button>
          </div>

          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Символ</th>
                <th>Ответ</th>
                <th>Статус</th>
                <th>Начало</th>
                <th>Речь</th>
                <th>Движок</th>
                <th>Итого</th>
                <th>Что услышал движок</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.outcomes.map((o) => (
                <tr key={o.index} className={o.status}>
                  <td>{o.index + 1}</td>
                  <td className="cell-glyph">{o.card.glyph}</td>
                  <td>{o.card.romaji}</td>
                  <td>
                    {statusLabel(o.status)}
                    {o.exact === false ? ' (подстрока)' : ''}
                    {o.matchedBy === 'deck' ? ' · контрольным' : ''}
                  </td>
                  <td>{ms(o.onsetMs)}</td>
                  <td>{ms(o.speechMs)}</td>
                  <td>{ms(o.asrLagMs)}</td>
                  <td>{ms(o.matchMs ?? o.lateMs)}</td>
                  <td className="cell-hyps">
                    {o.hypotheses.length === 0
                      ? '—'
                      : o.hypotheses
                          .map(
                            (h) =>
                              `${h.transcript}${h.final ? '*' : ''} @${h.atMs}` +
                              (h.conf !== undefined ? ` conf ${h.conf}` : '') +
                              (h.spanMs !== undefined ? ` ${h.spanMs}мс` : ''),
                          )
                          .join(' · ')}
                    {o.witnessHeard.length > 0 && (
                      <span className="witness"> контроль: {o.witnessHeard.join(' ')}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

function ms(value: number | null): string {
  return value === null ? '—' : `${value} мс`;
}

function statusLabel(status: string): string {
  if (status === 'match') return 'ок';
  if (status === 'late') return 'поздно';
  if (status === 'timeout') return 'таймаут';
  return 'пропуск';
}
