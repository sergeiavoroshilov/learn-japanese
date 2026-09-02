import { useMemo } from 'react';
import type { LevelProgress } from '../lib/curriculum';
import { drillCardById } from '../lib/levels';
import { LATENCY_GOOD_MS } from '../lib/srs';
import { accuracy, percentile } from '../lib/stats';
import type { ProgressStore } from '../lib/store';
import { ms, percent } from './format';

interface Props {
  store: ProgressStore;
  state: LevelProgress[];
  onBack(): void;
}

const DAYS = 14;

export function Stats({ store, state, onBack }: Props) {
  const now = useMemo(() => new Date(), [store, state]);
  const reviews = store.progress.reviews;

  const learned = state.reduce((n, l) => n + l.learned, 0);
  const seen = state.reduce((n, l) => n + l.learned + l.learning, 0);
  const total = state.reduce((n, l) => n + l.total, 0);

  const scored = accuracy(reviews.map((r) => r.quality));
  const correct = reviews.filter((r) => r.quality === 'correct');
  const medianOnset = percentile(
    correct.map((r) => r.onsetMs).filter((v): v is number => v !== null),
    50,
  );

  /**
   * A fortnight of activity. Counting answers rather than sessions: a day
   * with one card and a day with sixty are not the same day.
   */
  const days = useMemo(() => {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const buckets = Array.from({ length: DAYS }, () => 0);
    for (const r of reviews) {
      const day = Math.floor((start.getTime() - new Date(r.at).setHours(0, 0, 0, 0)) / 86_400_000);
      if (day >= 0 && day < DAYS) buckets[DAYS - 1 - day]! += 1;
    }
    return buckets;
  }, [reviews, now]);
  const peak = Math.max(1, ...days);
  const streak = useMemo(() => {
    let n = 0;
    for (let i = days.length - 1; i >= 0 && days[i]! > 0; i--) n++;
    return n;
  }, [days]);

  /** Slow but correct: known and not yet automatic — the drill's whole target. */
  const slowest = useMemo(() => {
    const rows = Object.values(store.progress.cards)
      .filter((p) => p.avgOnsetMs !== null)
      .sort((a, b) => (b.avgOnsetMs ?? 0) - (a.avgOnsetMs ?? 0))
      .slice(0, 10);
    return rows.flatMap((p) => {
      const card = drillCardById(p.id);
      return card ? [{ card, avg: p.avgOnsetMs! }] : [];
    });
  }, [store.progress.cards]);

  /** Moras a named pronunciation slip keeps hitting. */
  const slips = useMemo(
    () =>
      Object.values(store.progress.cards)
        .filter((p) => p.mispronounced > 0)
        .sort((a, b) => b.mispronounced - a.mispronounced)
        .slice(0, 8)
        .flatMap((p) => {
          const card = drillCardById(p.id);
          return card ? [{ card, count: p.mispronounced }] : [];
        }),
    [store.progress.cards],
  );

  return (
    <>
      <header>
        <h1>Статистика</h1>
      </header>

      <div className="block">
        <div className="stats">
          <Stat label="Выучено" value={`${learned}`} hint={`из ${total} в программе`} />
          <Stat label="Знакомо" value={`${seen}`} hint="хотя бы раз отвечено" />
          <Stat
            label="Скорость ответа"
            value={ms(medianOnset)}
            hint="медиана по верным"
          />
          <Stat
            label="Доля верных"
            value={scored.share === null ? '—' : percent(scored.share)}
            hint={
              `${scored.attempts} ответов` +
              (scored.excluded > 0 ? ` · ещё ${scored.excluded} не в счёт` : '')
            }
          />
        </div>
      </div>

      <div className="block">
        <h2>Две недели</h2>
        <div className="spark">
          {days.map((n, i) => (
            <div
              key={i}
              className={n > 0 ? 'spark-day on' : 'spark-day'}
              style={{ height: `${Math.max(4, Math.round((n / peak) * 100))}%` }}
              title={`${n} ответов`}
            />
          ))}
        </div>
        <div className="spark-axis">
          <span>14 дней назад</span>
          <span>
            {streak > 0 ? `подряд дней: ${streak}` : 'сегодня пока пусто'}
          </span>
        </div>
      </div>

      {slowest.length > 0 && (
        <div className="block">
          <h2>Самые медленные</h2>
          <div className="slow-list">
            {slowest.map(({ card, avg }) => (
              <div key={card.id} className={avg > LATENCY_GOOD_MS ? 'slow slow-bad' : 'slow'}>
                <span className="slow-glyph">{card.glyph}</span>
                <span className="slow-romaji">{card.answer}</span>
                <span className="slow-ms">{ms(avg)}</span>
              </div>
            ))}
          </div>
          <p className="note-inline">
            Верно, но медленно — это и есть то, ради чего режим существует:
            символ известен и ещё не читается.
          </p>
        </div>
      )}

      {slips.length > 0 && (
        <div className="block">
          <h2>Произношение</h2>
          <div className="slow-list">
            {slips.map(({ card, count }) => (
              <div key={card.id} className="slow">
                <span className="slow-glyph">{card.glyph}</span>
                <span className="slow-romaji">{card.answer}</span>
                <span className="slow-ms">{count}×</span>
              </div>
            ))}
          </div>
          <p className="note-inline">
            Здесь чтение было верным, а звук — нет. На график повторений это не
            влияет: забыть символ и не уметь его выговорить — разные вещи.
          </p>
        </div>
      )}

      <div className="actions">
        <button onClick={onBack}>Назад</button>
      </div>
    </>
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
