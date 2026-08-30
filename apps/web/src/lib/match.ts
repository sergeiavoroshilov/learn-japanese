import { toHiragana } from 'wanakana';
import type { KanaCard } from './kana';

export interface Expected {
  cardId: string;
  /** Accepted readings, any script — normalised before comparison. */
  accept: string[];
}

export function expectedFor(card: KanaCard): Expected {
  return {
    cardId: card.id,
    accept: [card.kana, card.romaji, ...(card.alt ?? [])],
  };
}

const NOISE = /[\s　。、．，,.!?！？・…「」『』ー～]/g;

/**
 * Vosk's placeholder for "a sound I have no word for". The user never said it,
 * so it must not take part in matching — left in, «[unk] り» fails a strict
 * comparison against «り» and the answer looks wrong when it was right.
 */
const UNKNOWN_TOKEN = /\[unk\]/g;

/**
 * Fold whatever the engine returned into plain hiragana: katakana and romaji
 * both collapse onto the same representation, so く / ク / ku compare equal.
 */
export function normalize(raw: string): string {
  const stripped = raw.replace(UNKNOWN_TOKEN, ' ').replace(NOISE, '').toLowerCase();
  return toHiragana(stripped, { passRomaji: false });
}

export interface MatchVerdict {
  /** Normalised transcript equals an accepted reading exactly. */
  exact: boolean;
  /** Normalised transcript merely contains an accepted reading. */
  contains: boolean;
  /**
   * Transcript is an unfinished beginning of an accepted reading — an interim
   * result still arriving, not the engine hearing something else. Keeps the
   * "engine went off-target" count honest.
   */
  partial: boolean;
  normalized: string;
}

export function judge(transcript: string, expected: Expected): MatchVerdict {
  const normalized = normalize(transcript);
  const raw = transcript.replace(UNKNOWN_TOKEN, ' ').replace(NOISE, '').toLowerCase();
  const targets = expected.accept.map(normalize).filter((t) => t.length > 0);
  const contains = targets.some((t) => normalized.includes(t));

  return {
    exact: targets.some((t) => t === normalized),
    contains,
    // Checked in both scripts: 's' is a prefix of romaji 'se', 'きゃ' of 'きゃく'.
    partial:
      !contains &&
      normalized.length > 0 &&
      (targets.some((t) => t.startsWith(normalized)) ||
        expected.accept.some((a) => raw.length > 0 && a.toLowerCase().startsWith(raw))),
    normalized,
  };
}
