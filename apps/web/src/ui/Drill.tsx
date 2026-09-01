import type { DrillCard } from '../lib/card';
import { correctionFor } from '../lib/pronounce';
import type { SessionSnapshot } from '../lib/session';
import type { WakeLockState } from '../lib/wakelock';
import type { CardResult } from './Trainer';
import { ms } from './format';

interface Props {
  snapshot: SessionSnapshot;
  micLevel: number;
  showRomaji: boolean;
  wakeLock: WakeLockState;
  /** Cards the learner has barely met, which are still being taught. */
  teaching: Set<string>;
  lastResult: CardResult | null;
  onContinue(): void;
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

export function Drill({
  snapshot,
  micLevel,
  showRomaji,
  wakeLock,
  teaching,
  lastResult,
  onContinue,
  onSkip,
  onStop,
}: Props) {
  const paused = snapshot.lastStatus !== null;
  const notPlaced =
    !paused &&
    snapshot.liveHypotheses.length > 0 &&
    snapshot.liveHypotheses.every((h) => h.verdict.normalized === '');

  const correction = snapshot.current
    ? correctionFor(snapshot.current, snapshot.liveWitness)
    : null;

  const feedbackCard = paused ? snapshot.outcomes[snapshot.outcomes.length - 1]?.card : undefined;
  const missed = paused && snapshot.lastStatus !== 'match' && feedbackCard;
  const card = missed ? feedbackCard : snapshot.current;

  /**
   * A card is shown with its reading the first couple of times it comes up,
   * then on its own. Asking someone to recall what they have never been told
   * is not a test of anything — and after a miss the answer is the point.
   */
  const showAnswer = Boolean(
    card && (missed || showRomaji || teaching.has(card.id)),
  );

  if (snapshot.status === 'starting') {
    return (
      <section className="stage">
        <div className="loading">{snapshot.statusText || 'запускаю…'}</div>
        <button onClick={onStop}>Отмена</button>
      </section>
    );
  }

  return (
    <section className={`stage ${paused ? (snapshot.lastStatus ?? '') : ''}`}>
      <div className="stage-top">
        <span className="counter">осталось {snapshot.remaining + 1}</span>
        <span className={snapshot.listening && !snapshot.awaitingContinue ? 'mic on' : 'mic'}>
          {/* The engine is still on while the drill holds, but the card is
              disarmed and nothing said now counts — «слушаю» would be a lie. */}
          {snapshot.listening && !snapshot.awaitingContinue ? 'слушаю' : 'пауза'}
        </span>
        <div className="meter">
          <div
            className="meter-fill"
            style={{ width: `${Math.min(100, Math.round(micLevel * 800))}%` }}
          />
        </div>
      </div>

      {(wakeLock === 'unsupported' || wakeLock === 'refused') && (
        <div className="dim-warning">экран может погаснуть — браузер не даёт его удержать</div>
      )}

      {snapshot.error && <div className="banner error">Ошибка: {snapshot.error}</div>}

      <div className="glyph">{card?.glyph ?? '…'}</div>

      {showAnswer && card && <CardHelp card={card} missed={Boolean(missed)} />}
      {missed && (
        <span className="answer-why">
          {lastResult ? (QUALITY_TEXT[lastResult.quality] ?? '') : ''}
        </span>
      )}
      {missed && lastResult?.correction && (
        <span className="answer-why">{lastResult.correction.hint}</span>
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
        {snapshot.awaitingContinue ? (
          // Shown on the desktop too, not only where there is no keyboard:
          // the hint alone leaves you wondering whether anything is expected.
          <button className="primary" onClick={onContinue} autoFocus>
            Продолжить<span className="key"> (Space)</span>
          </button>
        ) : (
          <button onClick={onSkip}>
            Не помню<span className="key"> (Space)</span>
          </button>
        )}
        <button onClick={onStop}>
          Закончить<span className="key"> (Esc)</span>
        </button>
      </div>
    </section>
  );
}

/**
 * How the card reads, and what it means.
 *
 * For a kanji the kana reading comes first and largest: it is the answer the
 * drill is asking for, and the Latin and Cyrillic lines underneath are only
 * there to say how that kana sounds to someone who cannot yet read it.
 */
function CardHelp({ card, missed }: { card: DrillCard; missed: boolean }) {
  return (
    <div className={missed ? 'help missed' : 'help'}>
      {card.reading && <span className="help-reading">{card.reading}</span>}
      <span className="help-latin">
        {card.romaji}
        <span className="help-sep"> · </span>
        {card.kiriji}
      </span>
      {card.meaning && (
        <span className="help-meaning">
          {card.meaning.primary}
          {card.meaning.extra.length > 0 && (
            <span className="help-extra"> · {card.meaning.extra.join(', ')}</span>
          )}
        </span>
      )}
    </div>
  );
}
