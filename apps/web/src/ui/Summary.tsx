import { useMemo } from 'react';
import { percentile } from '../lib/stats';
import { interval, ms, percent } from './format';
import type { CardResult } from './Trainer';

interface Props {
  results: CardResult[];
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

export function Summary({ results, onAgain, onHome }: Props) {
  /**
   * One line per card, from its first answer — the one that was graded.
   *
   * A card that came back after a miss produces a second result, and counting
   * those made a twenty-card session report twenty-two answers. The session
   * was twenty cards, so that is what everything here counts.
   */
  const cards = useMemo(() => {
    const seen = new Set<string>();
    const out: CardResult[] = [];
    for (const result of results) {
      if (seen.has(result.card.id)) continue;
      seen.add(result.card.id);
      out.push(result);
    }
    return out;
  }, [results]);

  const correct = cards.filter((r) => r.quality === 'correct');
  const medianOnset = useMemo(
    () =>
      percentile(
        correct.map((r) => r.onsetMs).filter((v): v is number => v !== null),
        50,
      ),
    [correct],
  );
  const introduced = cards.filter((r) => r.introduced).length;

  /**
   * One line per mora that came out wrong in a nameable way — the part of a
   * session actually worth acting on. Deduplicated: the same slip on four
   * cards is one thing to fix, not four.
   */
  const corrections = useMemo(() => cards.filter((r) => r.correction), [cards]);

  return (
    <section className="results">
      <h2>Сессия закончена</h2>

      <div className="stats">
        <Stat
          label="Верно"
          value={`${correct.length} из ${cards.length}`}
          hint={cards.length > 0 ? percent(correct.length / cards.length) : undefined}
        />
        <Stat label="Скорость ответа" value={ms(medianOnset)} hint="медиана" />
        {introduced > 0 && <Stat label="Новых символов" value={String(introduced)} />}
      </div>

      {corrections.length > 0 && (
        <div className="banner note">
          <strong>Что поправить в произношении</strong>
          <ul className="corrections">
            {corrections.map((r) => (
              <li key={r.card.id}>
                {r.card.glyph} ({r.card.kiriji}) — услышано «{r.correction!.heard}»:{' '}
                {r.correction!.hint}
              </li>
            ))}
          </ul>
        </div>
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
          {cards.map((r) => (
            <tr key={r.card.id} className={r.quality === 'correct' ? '' : 'miss'}>
              <td className="cell-glyph">{r.card.glyph}</td>
              <td>{r.card.answer}</td>
              <td>{QUALITY_LABEL[r.quality] ?? r.quality}</td>
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
