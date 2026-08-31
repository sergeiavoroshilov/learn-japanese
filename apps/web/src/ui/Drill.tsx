import { correctionFor } from '../lib/pronounce';
import type { SessionSnapshot } from '../lib/session';
import type { CardResult } from './Trainer';
import { ms } from './format';

interface Props {
  snapshot: SessionSnapshot;
  micLevel: number;
  showRomaji: boolean;
  lastResult: CardResult | null;
  onSkip(): void;
  onStop(): void;
}

const QUALITY_TEXT: Record<string, string> = {
  wrong: 'услышал другую мору',
  mispronounced: 'чтение верное — дело в произношении',
  silent: 'ответа не было',
  unplaced: 'не разобрал — скажем ещё раз',
  skipped: 'пропущено',
};

export function Drill({ snapshot, micLevel, showRomaji, lastResult, onSkip, onStop }: Props) {
  const paused = snapshot.lastStatus !== null;
  /**
   * The decoder answered «[unk]»: it heard something and could not place it.
   * Saying it again is the useful move, and silence gives the learner no clue.
   */
  const notPlaced =
    !paused &&
    snapshot.liveHypotheses.length > 0 &&
    snapshot.liveHypotheses.every((h) => h.verdict.normalized === '');

  /**
   * What the control decoder heard instead, turned into something to do about
   * it. «услышал を, японская /u/ — без округления губ» is a lesson;
   * «не расслышал» is a dead end.
   */
  const correction = snapshot.current
    ? correctionFor(snapshot.current, snapshot.liveWitness)
    : null;

  const feedbackCard = paused ? snapshot.outcomes[snapshot.outcomes.length - 1]?.card : undefined;
  const showAnswer = paused && snapshot.lastStatus !== 'match' && feedbackCard;

  if (snapshot.status === 'starting') {
    return (
      <section className="panel stage">
        <div className="loading">{snapshot.statusText || 'запускаю…'}</div>
        <button onClick={onStop}>Отмена</button>
      </section>
    );
  }

  return (
    <section className={`panel stage ${paused ? (snapshot.lastStatus ?? '') : ''}`}>
      <div className="stage-top">
        <span className="counter">осталось {snapshot.remaining + 1}</span>
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

      {snapshot.error && <div className="banner error">Ошибка: {snapshot.error}</div>}

      <div className="glyph">{(showAnswer ? feedbackCard.glyph : snapshot.current?.glyph) ?? '…'}</div>
      {showAnswer ? (
        <div className="answer">
          <span className="answer-romaji">{feedbackCard.romaji}</span>
          <span className="answer-why">
            {lastResult ? (QUALITY_TEXT[lastResult.quality] ?? '') : ''}
          </span>
          {lastResult?.correction && (
            <span className="answer-why">{lastResult.correction.hint}</span>
          )}
        </div>
      ) : (
        showRomaji && <div className="romaji">{snapshot.current?.romaji}</div>
      )}

      <div className="live">
        {notPlaced &&
          (correction ? (
            <div className="retry">
              <span>услышал «{correction.heard}» — скажите ещё раз</span>
              <span className="retry-hint">{correction.hint}</span>
            </div>
          ) : (
            <div className="retry">не расслышал — скажите ещё раз</div>
          ))}
        {!paused && snapshot.liveOnsetMs !== null && (
          <div className="live-onset">{ms(snapshot.liveOnsetMs)}</div>
        )}
      </div>

      <div className="stage-actions">
        <button onClick={onSkip}>
          Не помню<span className="key"> (Space)</span>
        </button>
        <button onClick={onStop}>
          Закончить<span className="key"> (Esc)</span>
        </button>
      </div>
    </section>
  );
}
