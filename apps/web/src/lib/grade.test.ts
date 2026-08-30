import { describe, expect, test } from 'bun:test';
import { classify, factsFrom, type AnswerFacts } from './grade';
import { cardById } from './kana';
import { expectedFor, judge } from './match';
import type { CardOutcome } from './session';

function facts(over: Partial<AnswerFacts> = {}): AnswerFacts {
  return { status: 'timeout', onsetMs: 800, heard: [], soundHeard: false, repeated: false, ...over };
}

describe('classify', () => {
  test('an accepted answer is correct', () => {
    expect(classify(facts({ status: 'match' }))).toBe('correct');
  });

  test('an answer that arrived after the card closed still counts as correct', () => {
    expect(classify(facts({ status: 'late' }))).toBe('correct');
  });

  test('another existing mora is a reading error', () => {
    expect(classify(facts({ heard: ['ろ'], soundHeard: true }))).toBe('wrong');
  });

  test('a sound nothing could be made of is the decoder failing, not the learner', () => {
    // Only «[unk]» came back, which normalize() reduces to an empty string.
    expect(classify(facts({ heard: [], soundHeard: true }))).toBe('unplaced');
  });

  test('no decoder output and no speech at all means the glyph was not recalled', () => {
    expect(classify(facts({ soundHeard: false, onsetMs: null }))).toBe('silent');
  });

  test('speech the decoder never reported is the decoder missing it', () => {
    // The microphone's VAD heard the learner start speaking; the engine said
    // nothing. Blaming the learner here would punish them for our bug.
    expect(classify(facts({ soundHeard: false, onsetMs: 620 }))).toBe('unplaced');
  });

  test('giving up is its own outcome', () => {
    expect(classify(facts({ status: 'skipped' }))).toBe('skipped');
  });
});

describe('factsFrom', () => {
  const card = cardById('hira-きゃ')!;

  function outcome(over: Partial<CardOutcome>): CardOutcome {
    return {
      index: 0,
      card,
      onsetMs: 600,
      speechMs: 300,
      matchMs: null,
      asrLagMs: null,
      status: 'timeout',
      matchedTranscript: null,
      exact: null,
      matchedBy: null,
      lateMs: null,
      hypotheses: [],
      witnessHeard: [],
      ...over,
    };
  }

  function hypothesis(transcript: string) {
    return {
      transcript,
      atMs: 400,
      final: false,
      verdict: judge(transcript, expectedFor(card)),
    };
  }

  test('an unfinished prefix of the answer is not a different mora', () => {
    // «き» is where «きゃ» starts. Calling that a misreading would punish the
    // learner for the decoder reporting mid-word.
    const facts = factsFrom(outcome({ hypotheses: [hypothesis('き')] }));
    expect(facts.heard).toEqual([]);
    expect(classify(facts)).toBe('unplaced');
  });

  test('a genuinely different mora is reported', () => {
    const facts = factsFrom(outcome({ hypotheses: [hypothesis('しゃ')] }));
    expect(facts.heard).toEqual(['しゃ']);
    expect(classify(facts)).toBe('wrong');
  });

  test('the control decoder hearing the right mora is not a misreading', () => {
    const facts = factsFrom(outcome({ witnessHeard: ['きゃ'] }));
    expect(facts.heard).toEqual([]);
    expect(classify(facts)).toBe('unplaced');
  });

  test('the control decoder names the mora the card decoder refused', () => {
    const facts = factsFrom(outcome({ hypotheses: [hypothesis('[unk]')], witnessHeard: ['ちゃ'] }));
    expect(facts.heard).toEqual(['ちゃ']);
    expect(facts.repeated).toBe(true);
    expect(classify(facts)).toBe('wrong');
  });

  test('«[unk]» alone means the sound was heard but not placed', () => {
    const facts = factsFrom(outcome({ hypotheses: [hypothesis('[unk]')] }));
    expect(facts.heard).toEqual([]);
    expect(facts.soundHeard).toBe(true);
    expect(classify(facts)).toBe('unplaced');
  });
});
