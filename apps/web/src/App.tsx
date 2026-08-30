import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GROUP_LABELS, KANA_GROUPS, drawCards, type KanaGroup } from './lib/kana';
import { isWebSpeechSupported, type MatchRule } from './lib/recognizer';
import { DrillSession, type Engine, type SessionSnapshot } from './lib/session';
import { buildReport, summarize } from './lib/stats';
import { VOSK_OOV_KANA } from './lib/vosk';

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
  current: null,
  lastStatus: null,
  liveHypotheses: [],
  liveOnsetMs: null,
  outcomes: [],
  listening: false,
  error: null,
  recognizerName: 'Web Speech API',
};

export function App() {
  const [groups, setGroups] = useState<KanaGroup[]>(['basic']);
  const [count, setCount] = useState(20);
  const [timeoutMs, setTimeoutMs] = useState(6000);
  const [rule, setRule] = useState<MatchRule>('exact');
  const [showRomaji, setShowRomaji] = useState(false);
  const [engine, setEngine] = useState<Engine>('vosk');
  const [grammar, setGrammar] = useState(true);

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
  const grammarActive = activeEngine === 'vosk' && grammar;
  const vocabulary = useMemo(
    () =>
      grammarActive
        ? groups
            .flatMap((g) => KANA_GROUPS[g])
            .map((c) => c.kana)
            .filter((kana) => !VOSK_OOV_KANA.includes(kana))
        : null,
    [grammarActive, groups],
  );

  const start = useCallback(() => {
    const deck = drawCards(groups, count).filter(
      (card) => !grammarActive || !VOSK_OOV_KANA.includes(card.kana),
    );
    if (deck.length === 0) return;
    sessionRef.current?.stop();
    const session = new DrillSession({
      cards: deck,
      timeoutMs,
      rule,
      engine: activeEngine,
      grammar: vocabulary,
      onUpdate: setSnapshot,
    });
    sessionRef.current = session;
    setStartedAt(new Date().toISOString());
    void session.start();
  }, [groups, count, timeoutMs, rule, activeEngine, grammarActive, vocabulary]);

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

  const copyReport = useCallback(async () => {
    const report = buildReport(snapshot.outcomes, {
      recognizer: snapshot.recognizerName,
      rule,
      grammarSize: vocabulary?.length ?? null,
      timeoutMs,
      startedAt,
    });
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
  }, [snapshot.outcomes, snapshot.recognizerName, rule, vocabulary, timeoutMs, startedAt]);

  const toggleGroup = (g: KanaGroup) =>
    setGroups((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));

  return (
    <main className="page">
      <header>
        <h1>Спайк: мгновенное распознавание каны</h1>
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
          {grammar
            ? `Декодер выбирает только из ${vocabulary?.length ?? 0} мор — подставить «部屋» вместо へ ему неоткуда. Карточки ${VOSK_OOV_KANA.join(', ')} исключены: их нет в словаре модели.`
            : 'Свободное распознавание — режим для сравнения: видно, что даёт локальная модель без ограничения словаря.'}
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
              {(Object.keys(GROUP_LABELS) as KanaGroup[]).map((g) => (
                <label key={g} className={groups.includes(g) ? 'chip on' : 'chip'}>
                  <input
                    type="checkbox"
                    checked={groups.includes(g)}
                    onChange={() => toggleGroup(g)}
                  />
                  {GROUP_LABELS[g]}
                </label>
              ))}
            </div>
          </div>

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
              <label className="field checkbox">
                <input
                  type="checkbox"
                  checked={grammar}
                  onChange={(e) => setGrammar(e.target.checked)}
                />
                <span>
                  Ограничить словарь
                  {vocabulary ? ` (${vocabulary.length} мор)` : ''}
                </span>
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

            <label className="field checkbox">
              <input
                type="checkbox"
                checked={showRomaji}
                onChange={(e) => setShowRomaji(e.target.checked)}
              />
              <span>Показывать ромадзи</span>
            </label>
          </div>

          <button className="primary" onClick={start} disabled={!supported || groups.length === 0}>
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
                : 'Похоже на no-go для варианта A на этих данных — смотрите таблицу: промахи или задержка выше бюджета (500 мс / 90%).'}
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
                  <td>{statusLabel(o.status)}{o.exact === false ? ' (подстрока)' : ''}</td>
                  <td>{ms(o.onsetMs)}</td>
                  <td>{ms(o.asrLagMs)}</td>
                  <td>{ms(o.matchMs)}</td>
                  <td className="cell-hyps">
                    {o.hypotheses.length === 0
                      ? '—'
                      : o.hypotheses
                          .map((h) => `${h.transcript}${h.final ? '*' : ''} @${h.atMs}`)
                          .join(' · ')}
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
  if (status === 'timeout') return 'таймаут';
  return 'пропуск';
}
