import { useRef, useState } from 'react';
import { UNLOCK_SHARE, currentLevel, type LevelProgress } from '../lib/curriculum';
import { serialize, type ProgressStore, type Settings } from '../lib/store';
import { percent } from './format';

interface Props {
  settings: Settings;
  onSettings(next: Settings): void;
  state: LevelProgress[];
  store: ProgressStore;
  mock: boolean;
  /** Why the previous attempt to start a session failed. */
  failure: string | null;
  onStart(): void;
  onStats(): void;
  onImported(): void;
}

export function Home({
  settings,
  onSettings,
  state,
  store,
  mock,
  failure,
  onStart,
  onStats,
  onImported,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [showSettings, setShowSettings] = useState(false);
  const current = currentLevel(state);
  const due = state.filter((l) => l.unlocked).reduce((n, l) => n + l.due, 0);
  const plannedDue = Math.min(due, settings.sessionSize);
  const plannedNew = Math.min(
    settings.newPerSession,
    Math.max(0, settings.sessionSize - plannedDue),
    current?.fresh ?? 0,
  );
  const nothingToDo = plannedDue === 0 && plannedNew === 0;
  const seen = state.reduce((n, l) => n + l.learned + l.learning, 0);
  /** The rest of the session goes to glyphs already met but not yet due. */
  const plannedPractice = Math.max(
    0,
    Math.min(settings.sessionSize - plannedDue - plannedNew, seen - plannedDue),
  );
  const secure = window.isSecureContext || mock;

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
          ответа: то, что вспоминается две секунды, ещё не выучено.
        </p>
      </header>

      {mock && (
        <div className="banner mock">Мок-режим: ответы с клавиатуры, микрофон не нужен.</div>
      )}
      {failure && (
        <div className="banner error">
          Сессия не запустилась: {failure}
          {/Permission|denied|NotAllowed/i.test(failure) && (
            <>
              {' '}— разрешите микрофон в настройках сайта, либо тренируйтесь
              с клавиатуры: <a href="?mock=1">мок-режим</a>.
            </>
          )}
        </div>
      )}
      {!secure && (
        <div className="banner error">
          Микрофон работает только в защищённом контексте: откройте по{' '}
          <code>localhost</code> или запустите <code>bun run dev:https</code>.
        </div>
      )}

      <div className="block">
        {nothingToDo ? (
          <>
            <button className="primary" onClick={onStart} disabled={seen === 0}>
              Потренироваться
            </button>
            <p className="note-inline">
              По графику сегодня ничего не нужно — будет закрепление того, что
              уже знакомо. Оно не двигает график: интервал это срок, к которому
              символ надо вспомнить, а не карантин до него.
            </p>
          </>
        ) : (
          <>
            <button className="primary" onClick={onStart}>
              Начать
            </button>
            <p className="note-inline">
              {/* New glyphs repeat inside the session, so the card count and
                  the number of distinct glyphs are different things. */}
              {[
                plannedDue > 0 ? `${plannedDue} на повторение` : null,
                plannedNew > 0
                  ? `${plannedNew} новых${current ? ` из «${current.level.label}»` : ''}`
                  : null,
                plannedPractice > 0 ? `${plannedPractice} на закрепление` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </>
        )}
      </div>

      <div className="block">
        <h2>Программа</h2>
        <div className="levels">
          {state.map((l) => (
            <LevelRow key={l.level.id} level={l} current={l.level.id === current?.level.id} />
          ))}
        </div>
        <p className="note-inline">
          Символ считается выученным, когда назван верно <b>в двух сессиях
          подряд</b> и <b>быстрее двух секунд</b>: то, что вспоминается дольше,
          ещё не читается. Промах обнуляет счёт. Насечка на полосе — {percent(UNLOCK_SHARE)},
          на которых открывается следующий уровень; бледная часть — знакомое,
          но ещё не беглое. Повторения идут со всех пройденных уровней.
        </p>
      </div>

      <div className="block">
        <div className="actions">
          <button className="link" onClick={onStats}>
            Статистика
          </button>
          <button className="link" onClick={() => setShowSettings((v) => !v)}>
            {showSettings ? 'Скрыть настройки' : 'Настройки'}
          </button>
        </div>

        {showSettings && (
          <div className="settings">
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
                  onChange={(e) =>
                    onSettings({ ...settings, newPerSession: Number(e.target.value) })
                  }
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
                <span>Показывать чтение</span>
              </label>
            </div>

            <div className="actions">
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
              Прогресс хранится только в этом браузере: очистка данных сайта
              стирает его безвозвратно.
            </p>
          </div>
        )}
      </div>

      <footer className="foot">
        <a href="?lab=1">Лаборатория распознавания</a> — стенд из спайка №2:
        таблица годзюон, ручки декодера и JSON-отчёт для замеров.
      </footer>
    </>
  );

  function LevelRow({ level, current }: { level: LevelProgress; current: boolean }) {
    const cls = [
      'level',
      current ? 'current' : '',
      level.complete ? 'done' : '',
      level.unlocked ? '' : 'locked',
    ]
      .filter(Boolean)
      .join(' ');
    return (
      <div className={cls}>
        <span className="level-name">
          {level.level.label}
          {level.complete ? ' ✓' : ''}
        </span>
        <span className="level-count">
          {level.unlocked ? `${level.learned} / ${level.total}` : 'закрыт'}
        </span>
        {level.unlocked && (
          // Solid is learned — the number the gate reads. Faint is met and on
          // its way. The notch marks where the next level opens, so «why is
          // it still shut» has an answer on the screen.
          <div className="bar">
            <div className="bar-fill" style={{ width: percent(level.share) }} />
            <div
              className="bar-fill soft"
              style={{ width: percent(level.learning / Math.max(1, level.total)) }}
            />
            <div className="bar-gate" style={{ left: percent(UNLOCK_SHARE) }} />
          </div>
        )}
        {level.unlocked && (level.learning > 0 || level.due > 0 || current) && (
          <span className="level-note">
            {[
              current ? level.level.note : null,
              level.blocked.sessions > 0
                ? `${level.blocked.sessions} ждут второй сессии`
                : null,
              level.blocked.slow > 0 ? `${level.blocked.slow} медленнее двух секунд` : null,
              level.due > 0 ? `${level.due} к повторению` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}
      </div>
    );
  }
}
