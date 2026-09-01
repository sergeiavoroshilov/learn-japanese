import { useMemo } from 'react';
import type { SessionPlan } from '../lib/plan';
import { accuracy, percentile } from '../lib/stats';
import { interval, ms, percent } from './format';
import type { CardResult } from './Trainer';

interface Props {
  results: CardResult[];
  plan: SessionPlan | null;
  onAgain(): void;
  onHome(): void;
}

const QUALITY_LABEL: Record<string, string> = {
  correct: 'верно',
  wrong: 'другая мора',
  mispronounced: 'произношение',
  silent: 'не вспомнил',
  unplaced: 'не разобрал',
  skipped: 'пропуск',
};

export function Summary({ results, plan, onAgain, onHome }: Props) {
  const correct = results.filter((r) => r.quality === 'correct');
  const wrong = results.filter((r) => r.quality === 'wrong' || r.quality === 'silent');
  const unplaced = results.filter((r) => r.quality === 'unplaced');
  const slips = results.filter((r) => r.quality === 'mispronounced');

  const medianOnset = useMemo(
    () =>
      percentile(
        correct.map((r) => r.onsetMs).filter((v): v is number => v !== null),
        50,
      ),
    [correct],
  );

  const scored = accuracy(results.map((r) => r.quality));
  const introduced = new Set(results.filter((r) => r.introduced).map((r) => r.card.id));

  /**
   * One line per mora that came out wrong in a nameable way. Deduplicated:
   * the same slip on four cards is one thing to fix, not four.
   */
  const corrections = useMemo(() => {
    const seen = new Set<string>();
    return results.filter((r) => {
      if (!r.correction || seen.has(r.card.id)) return false;
      seen.add(r.card.id);
      return true;
    });
  }, [results]);

  return (
    <section className="panel results">
      <h2>Сессия закончена</h2>

      <div className="stats">
        <Stat
          label="Верно"
          value={`${scored.correct} из ${scored.attempts}`}
          hint={scored.share === null ? undefined : percent(scored.share)}
        />
        <Stat label="Скорость ответа, медиана" value={ms(medianOnset)} />
        <Stat label="Ошибок чтения" value={String(wrong.length)} />
        <Stat
          label="Произношение"
          value={String(slips.length)}
          hint="чтение верное, на график не влияет"
        />
        <Stat
          label="Не разобрал распознаватель"
          value={String(unplaced.length)}
          hint="на планирование не влияет"
        />
        <Stat label="Новых символов" value={String(introduced.size)} />
        {plan && <Stat label="Было к повторению" value={String(plan.due)} />}
      </div>

      {corrections.length > 0 && (
        <div className="banner note">
          <strong>Что поправить в произношении</strong>
          <ul className="corrections">
            {corrections.map((r, i) => (
              <li key={i}>
                {r.card.glyph} ({r.card.kiriji}) — услышано «{r.correction!.heard}»:{' '}
                {r.correction!.hint}
              </li>
            ))}
          </ul>
        </div>
      )}

      {unplaced.length > 0 && (
        <p className="note-inline">
          {unplaced.length} ответ(ов) распознаватель не смог отнести ни к какой
          море. Такие карточки не понижены в графике повторений — вы их не
          забыли, их не расслышали. Если одна и та же мора не разбирается
          раз за разом, дело обычно в произношении: японская /u/ (う, る, つ)
          произносится с растянутыми, а не округлёнными губами.
        </p>
      )}

      <table>
        <thead>
          <tr>
            <th>Символ</th>
            <th>Чтение</th>
            <th>Итог</th>
            <th>Скорость</th>
            <th>Повтор</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => (
            <tr key={`${r.card.id}-${i}`} className={r.quality === 'correct' ? '' : 'miss'}>
              <td className="cell-glyph">{r.card.glyph}</td>
              <td>{r.card.answer}</td>
              <td>
                {QUALITY_LABEL[r.quality] ?? r.quality}
                {r.introduced ? ' · новая' : ''}
              </td>
              <td>{ms(r.onsetMs)}</td>
              <td>{r.rating === null ? '—' : interval(r.intervalDays)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="results-actions">
        <button className="primary" onClick={onAgain}>
          Ещё сессия
        </button>
        <button onClick={onHome}>К прогрессу</button>
      </div>
    </section>
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
