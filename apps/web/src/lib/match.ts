import { toHiragana } from 'wanakana';
import type { KanaCard } from './kana';
import { LEXICON_FORMS } from './lexicon';

export interface Expected {
  cardId: string;
  /** Accepted readings, any script — normalised before comparison. */
  accept: string[];
  /**
   * The spellings a grammar-restricted decoder may be given for this card.
   * Only words the model's lexicon actually has, and all of them the same
   * reading — あ, ア, あー, ああ are one mora, not four.
   */
  lexical: string[];
}

export function expectedFor(card: KanaCard, longForms = true): Expected {
  // A mora the model has no word for at all (びゃ, ぴゃ, ぴょ) has an empty
  // list. Fall back to the kana so nothing downstream sees an empty grammar
  // or a card with no accepted reading.
  const known = LEXICON_FORMS[card.kana];
  const forms = known && known.length > 0 ? known : [card.kana];
  // The bare mora is always first: it is what a decoder restricted to a single
  // word is given when the long variants are switched off.
  const lexical = longForms ? forms : forms.slice(0, 1);
  return {
    cardId: card.id,
    accept: [...lexical, card.romaji, ...(card.alt ?? [])],
    lexical,
  };
}

/** Flattened, de-duplicated grammar for a whole deck. */
export function grammarFor(cards: KanaCard[], longForms = true): string[] {
  const out = new Set<string>();
  for (const card of cards) {
    for (const form of expectedFor(card, longForms).lexical) out.add(form);
  }
  return [...out];
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
