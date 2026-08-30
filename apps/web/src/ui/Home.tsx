import { useMemo, useRef } from 'react';
import { DECKS, VOICE_OOV_KANA, cardsOf, type DeckId } from '../lib/kana';
import { poolStats, type ProgressLookup } from '../lib/plan';
import { LATENCY_GOOD_MS } from '../lib/srs';
import { serialize, type ProgressStore, type Settings } from '../lib/store';
import { cards as cardsWord, ms, when } from './format';

interface Props {
  settings: Settings;
  onSettings(next: Settings): void;
  progressFor: ProgressLookup;
  store: ProgressStore;
  mock: boolean;
  /** Why the previous attempt to start a session failed. */
  failure: string | null;
  onStart(mode?: 'due' | 'free'): void;
  onImported(): void;
}

export function Home({
  settings,
  onSettings,
  progressFor,
  store,
  mock,
  failure,
  onStart,
  onImported,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const now = useMemo(() => new Date(), [settings, progressFor]);
  const pool = useMemo(() => cardsOf(settings.decks), [settings.decks]);
  const stats = useMemo(() => poolStats(pool, progressFor, now), [pool, progressFor, now]);

  /**
   * Slow but correct is the interesting state: the glyph is known and not yet
   * automatic, which is exactly what this drill exists to fix.
   */
  const slowest = useMemo(
    () =>
      pool
        .map((card) => ({ card, avg: progressFor(card.id).avgOnsetMs }))
        .filter((row): row is { card: (typeof pool)[number]; avg: number } => row.avg !== null)
        .sort((a, b) => b.avg - a.avg)
        .slice(0, 8),
    [pool, progressFor],
  );

  const excluded = useMemo(
    () => (mock ? [] : pool.filter((c) => c.voiceOov)),
    [pool, mock],
  );

  const plannedNew = Math.max(
    0,
    Math.min(settings.newPerSession, settings.sessionSize - Math.min(stats.due, settings.sessionSize)),
  );
  const plannedNewReal = Math.min(plannedNew, stats.fresh);
  const plannedDue = Math.min(stats.due, settings.sessionSize);
  const nothingToDo = plannedDue === 0 && plannedNewReal === 0;

  const secure = window.isSecureContext || mock;

  const toggleDeck = (id: DeckId) =>
    onSettings({
      ...settings,
      decks: settings.decks.includes(id)
        ? settings.decks.filter((d) => d !== id)
        : [...settings.decks, id],
    });

  const backup = async () => {
    await navigator.clipboard.writeText(serialize(store.progress));
  };

  const restore = async (file: File | undefined) => {
    if (!file) return;
    store.import(await file.text());
    onImported();
  };

  return (
    <>
      <header>
        <h1>Кана на скорость</h1>
        <p className="sub">
          Символ на экране — произнесите его вслух. Считается время до начала
          ответа: символ, который вспоминается две секунды, ещё не выучен, даже
          если назван верно. Повторения планирует FSRS.
        </p>
      </header>

      {mock && (
        <div className="banner mock">
          Мок-режим: отвечайте с клавиатуры ромадзи, микрофон не нужен.
        </div>
      )}
      {failure && (
        <div className="banner error">
          Сессия не запустилась: {failure}
          {/Permission|denied|NotAllowed/i.test(failure) && (
            <>
              {' '}— браузер не дал доступ к микрофону. Разрешите его в настройках
              сайта и попробуйте снова, либо тренируйтесь с клавиатуры:{' '}
              <a href="?mock=1">мок-режим</a>.
            </>
          )}
        </div>
      )}
      {!secure && (
        <div className="banner error">
          Страница открыта не в защищённом контексте — микрофон будет
          заблокирован. Откройте по <code>localhost</code> или запустите{' '}
          <code>bun run dev:https</code>.
        </div>
      )}

      <section className="panel">
        <h2>Наборы</h2>
        <div className="chips">
          {DECKS.map((deck) => (
            <label key={deck.id} className={settings.decks.includes(deck.id) ? 'chip on' : 'chip'}>
              <input
                type="checkbox"
                checked={settings.decks.includes(deck.id)}
                onChange={() => toggleDeck(deck.id)}
              />
              {deck.label}
            </label>
          ))}
        </div>
        {excluded.length > 0 && (
          <p className="note-inline">
            Голосом не тренируются: {excluded.map((c) => c.glyph).join(' ')} — этих
            мор ({VOICE_OOV_KANA.join(', ')}) нет в словаре распознавателя, и
            засчитать их нечем.
          </p>
        )}
      </section>

      <section className="panel">
        <h2>Прогресс</h2>
        <div className="stats">
          <Stat label="Символов в наборах" value={String(stats.total)} />
          <Stat
            label="Выучено"
            value={String(stats.learned)}
            hint="повтор реже раза в неделю"
          />
          <Stat label="В работе" value={String(stats.learning)} />
          <Stat label="Не начато" value={String(stats.fresh)} />
          <Stat
            label="К повторению"
            value={String(stats.due)}
            hint={stats.due === 0 ? `следующее ${when(stats.nextDue, now)}` : undefined}
          />
        </div>

        {nothingToDo ? (
          <>
            <button className="primary" onClick={() => onStart('free')} disabled={stats.total === 0}>
              Потренироваться сверх плана
            </button>
            <p className="note-inline">
              По графику сегодня ничего не нужно — следующее повторение{' '}
              {when(stats.nextDue, now)}. Лишняя тренировка не вредит: FSRS
              учтёт, что символ спросили раньше срока.
            </p>
          </>
        ) : (
          <>
            <button className="primary" onClick={() => onStart('due')}>
              Начать сессию
            </button>
            <p className="note-inline">В сессии: {sessionShape(plannedDue, plannedNewReal)}.</p>
          </>
        )}
      </section>

      {slowest.length > 0 && (
        <section className="panel">
          <h2>Самые медленные</h2>
          <div className="slow-list">
            {slowest.map(({ card, avg }) => (
              <div key={card.id} className={avg > LATENCY_GOOD_MS ? 'slow slow-bad' : 'slow'}>
                <span className="slow-glyph">{card.glyph}</span>
                <span className="slow-romaji">{card.romaji}</span>
                <span className="slow-ms">{ms(avg)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel settings">
        <h2>Настройки</h2>
        <div className="row">
          <label className="field">
            <span className="label">Карточек в сессии</span>
            <input
              type="number"
              min={5}
              max={100}
              value={settings.sessionSize}
              onChange={(e) => onSettings({ ...settings, sessionSize: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            <span className="label">Новых за сессию</span>
            <input
              type="number"
              min={0}
              max={20}
              value={settings.newPerSession}
              onChange={(e) => onSettings({ ...settings, newPerSession: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            <span className="label">Ждать ответа, мс</span>
            <input
              type="number"
              min={2000}
              max={15000}
              step={500}
              value={settings.timeoutMs}
              onChange={(e) => onSettings({ ...settings, timeoutMs: Number(e.target.value) })}
            />
          </label>
          <label className="field checkbox">
            <input
              type="checkbox"
              checked={settings.showRomaji}
              onChange={(e) => onSettings({ ...settings, showRomaji: e.target.checked })}
            />
            <span>Показывать ромадзи</span>
          </label>
        </div>

        <div className="row">
          <button onClick={backup}>Копия прогресса в буфер</button>
          <button onClick={() => fileRef.current?.click()}>Восстановить из файла</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            hidden
            onChange={(e) => void restore(e.target.files?.[0])}
          />
          <button
            onClick={() => {
              if (window.confirm('Удалить весь прогресс? Это необратимо.')) {
                store.reset();
                onImported();
              }
            }}
          >
            Сбросить прогресс
          </button>
        </div>
        <p className="note-inline">
          Прогресс хранится только в этом браузере: очистка данных сайта стирает
          его безвозвратно.
        </p>
      </section>

      <footer className="foot">
        <a href="?lab=1">Лаборатория распознавания</a> — стенд из спайка №2:
        ручки декодера, сырые гипотезы и JSON-отчёт для замеров на новом
        устройстве.
      </footer>
    </>
  );
}

/** «5 карточек на повторение и 3 новых» without the zero-valued halves. */
function sessionShape(due: number, fresh: number): string {
  const parts: string[] = [];
  if (due > 0) parts.push(`${cardsWord(due)} на повторение`);
  if (fresh > 0) parts.push(`${fresh} новых`);
  return parts.join(' и ');
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
