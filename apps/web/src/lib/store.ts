import type { DeckId } from './kana';
import { newProgress, type AnswerQuality, type CardProgress } from './srs';

export interface Settings {
  decks: DeckId[];
  /** Cards per session. A drill is meant to last a couple of minutes. */
  sessionSize: number;
  /** Ceiling on unseen glyphs introduced in one session. */
  newPerSession: number;
  /** How long a card waits for an answer before it counts as forgotten. */
  timeoutMs: number;
  /** Show the romaji under the glyph — a crutch for the first days. */
  showRomaji: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  decks: ['hira-basic'],
  sessionSize: 20,
  newPerSession: 5,
  timeoutMs: 6000,
  showRomaji: false,
};

export interface ReviewEntry {
  id: string;
  /** ISO timestamp. */
  at: string;
  quality: AnswerQuality;
  onsetMs: number | null;
  /** FSRS grade, or null when the answer did not reach the scheduler. */
  rating: number | null;
}

export interface Progress {
  version: number;
  cards: Record<string, CardProgress>;
  reviews: ReviewEntry[];
  settings: Settings;
}

export const STORAGE_KEY = 'learn-japanese:progress';
const VERSION = 1;

/** Keep the log bounded; it is a history view, not an audit trail. */
const MAX_REVIEWS = 5000;

export function emptyProgress(): Progress {
  return { version: VERSION, cards: {}, reviews: [], settings: { ...DEFAULT_SETTINGS } };
}

/**
 * JSON has no Date, so the FSRS card's due/last_review come back as strings.
 * Everything downstream compares them with getTime(), which would silently
 * misbehave on a string — revive them here, once.
 */
export function deserialize(raw: string): Progress {
  const parsed = JSON.parse(raw) as Partial<Progress>;
  if (!parsed || typeof parsed !== 'object') return emptyProgress();
  const cards: Record<string, CardProgress> = {};
  for (const [id, value] of Object.entries(parsed.cards ?? {})) {
    const card = value as CardProgress;
    if (!card?.fsrs) continue;
    cards[id] = {
      ...card,
      fsrs: {
        ...card.fsrs,
        due: new Date(card.fsrs.due),
        last_review: card.fsrs.last_review ? new Date(card.fsrs.last_review) : undefined,
      },
    };
  }
  return {
    version: VERSION,
    cards,
    reviews: (parsed.reviews ?? []).slice(-MAX_REVIEWS),
    settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
  };
}

export function serialize(progress: Progress): string {
  return JSON.stringify(progress);
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * All progress lives in the browser. No account, no sync, no server — which
 * also means the user can lose it by clearing site data, so the dashboard
 * offers an export.
 */
export class ProgressStore {
  private data: Progress;

  constructor(private readonly storage: StorageLike | null = safeStorage()) {
    const raw = this.storage?.getItem(STORAGE_KEY) ?? null;
    try {
      this.data = raw === null ? emptyProgress() : deserialize(raw);
    } catch {
      // A corrupt blob must not brick the app; starting over beats a blank page.
      this.data = emptyProgress();
    }
  }

  get progress(): Progress {
    return this.data;
  }

  get settings(): Settings {
    return this.data.settings;
  }

  /** Existing progress for a card, or a fresh unseen one. */
  progressFor(id: string, now: Date): CardProgress {
    return this.data.cards[id] ?? newProgress(id, now);
  }

  saveSettings(settings: Settings): void {
    this.data = { ...this.data, settings };
    this.flush();
  }

  /** Record one answer: the updated card plus its line in the history. */
  record(progress: CardProgress, entry: ReviewEntry): void {
    this.data = {
      ...this.data,
      cards: { ...this.data.cards, [progress.id]: progress },
      reviews: [...this.data.reviews, entry].slice(-MAX_REVIEWS),
    };
    this.flush();
  }

  reset(): void {
    this.data = { ...emptyProgress(), settings: this.data.settings };
    this.flush();
  }

  import(raw: string): void {
    this.data = deserialize(raw);
    this.flush();
  }

  private flush(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, serialize(this.data));
    } catch {
      // Quota or a private window with storage disabled: the session still
      // works, it just will not be remembered. Not worth interrupting a drill.
    }
  }
}

function safeStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
