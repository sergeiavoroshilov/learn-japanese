import type { Deck, KanaCard } from '../lib/kana';

interface Props {
  deck: Deck;
  /** Ids of every card currently selected, across all decks. */
  selected: Set<string>;
  onChange(update: (prev: Set<string>) => Set<string>): void;
  disabled?: boolean;
}

const COLUMN_LABELS: Record<string, string> = {
  a: 'あ',
  i: 'い',
  u: 'う',
  e: 'え',
  o: 'お',
};

/**
 * The deck as its gojūon table, with a checkbox per row and per column.
 *
 * The flat chip list could only say «all 46 base moras»; a measurement usually
 * wants one line of it — the bare vowels, or everything ending in /u/ — and
 * cutting that out of a random 20-card draw by hand is not practical.
 */
export function KanaGrid({ deck, selected, onChange, disabled }: Props) {
  const cardsIn = (cards: (KanaCard | null)[]) => cards.filter((c): c is KanaCard => c !== null);

  const allCards = deck.cards;
  const columnCards = (col: string) => allCards.filter((c) => c.col === col);

  const state = (cards: KanaCard[]): 'none' | 'some' | 'all' => {
    if (cards.length === 0) return 'none';
    const on = cards.filter((c) => selected.has(c.id)).length;
    return on === 0 ? 'none' : on === cards.length ? 'all' : 'some';
  };

  const toggle = (cards: KanaCard[]) => {
    // A partly-filled row fills up rather than empties — clicking a half-on
    // checkbox to turn things off is the surprising reading.
    const turnOn = state(cards) !== 'all';
    // Functional update, not a set built from the current prop: two toggles
    // landing in one React batch would otherwise silently drop one of them.
    onChange((prev) => {
      const next = new Set(prev);
      for (const card of cards) {
        if (turnOn) next.add(card.id);
        else next.delete(card.id);
      }
      return next;
    });
  };

  return (
    <div className="grid-wrap">
      <div className="grid-head">
        <span className="grid-title">{deck.label}</span>
        <button type="button" onClick={() => toggle(allCards)} disabled={disabled}>
          {state(allCards) === 'all' ? 'Снять все' : 'Выбрать все'}
        </button>
        <span className="grid-count">
          выбрано {allCards.filter((c) => selected.has(c.id)).length} из {allCards.length}
        </span>
      </div>

      <table className="kana-grid">
        <thead>
          <tr>
            <th />
            {deck.grid.columns.map((col) => (
              <th key={col}>
                <Box
                  state={state(columnCards(col))}
                  disabled={disabled}
                  label={COLUMN_LABELS[col] ?? col}
                  onToggle={() => toggle(columnCards(col))}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {deck.grid.rows.map((row) => (
            <tr key={row.key}>
              <th>
                <Box
                  state={state(cardsIn(row.cells))}
                  disabled={disabled}
                  label={row.label}
                  onToggle={() => toggle(cardsIn(row.cells))}
                />
              </th>
              {row.cells.map((card, i) => (
                <td key={i}>
                  {card && (
                    <button
                      type="button"
                      disabled={disabled}
                      title={card.voiceOov ? `${card.romaji} — нет в словаре модели` : card.romaji}
                      className={[
                        'cell',
                        selected.has(card.id) ? 'on' : '',
                        card.voiceOov ? 'oov' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => toggle([card])}
                    >
                      <span className="cell-kana">{card.glyph}</span>
                      <span className="cell-romaji">{card.romaji}</span>
                    </button>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Box({
  state,
  label,
  disabled,
  onToggle,
}: {
  state: 'none' | 'some' | 'all';
  label: string;
  disabled?: boolean;
  onToggle(): void;
}) {
  return (
    <button
      type="button"
      className={`grid-box ${state}`}
      disabled={disabled}
      onClick={onToggle}
      aria-pressed={state === 'all'}
    >
      {label}
    </button>
  );
}
