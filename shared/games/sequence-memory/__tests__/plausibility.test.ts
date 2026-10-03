import { describe, expect, it } from 'vitest';
import { sequenceMemoryV1 as sm } from '@nfct/shared';
import { correct, corrects, fullRun, play, reasonsOf, sessionOf, timeout, wrong } from './helpers';

type Trial = sm.SequenceMemoryTrial;

const SEED = 1234;
const honest = fullRun(SEED, 1);

/** The honest session with trial `index` replaced. */
function withTrial(index: number, change: (trial: Trial) => Partial<Trial>, run = honest): sm.CheckableSession {
  const trials = run.trials.map((trial, at) => (at === index ? { ...trial, ...change(trial) } : trial));
  return sessionOf(SEED, run, { trials, summary: undefined });
}

describe('Sequence Memory v1 plausibility', () => {
  it('finds nothing in an honest completed run with wrong, timed-out and discarded trials', () => {
    expect(honest.trials.some((trial) => trial.correct)).toBe(true);
    expect(honest.trials.some((trial) => !trial.correct && !trial.timedOut)).toBe(true);
    expect(honest.trials.some((trial) => trial.timedOut)).toBe(true);
    expect(honest.presentedCount).toBeGreaterThan(honest.trials.length);
    expect(sm.checkSession(sessionOf(SEED, honest))).toEqual({ outcome: 'valid', reasons: [], issues: [] });
  });

  it('finds nothing in an honest abandoned run, or one with no trials', () => {
    const abandoned = play(SEED, 3, [correct(), wrong(0), timeout(2)]);
    expect(reasonsOf(sessionOf(SEED, abandoned))).toEqual([]);
    const empty = play(SEED, 3, []);
    expect(reasonsOf(sessionOf(SEED, empty))).toEqual([]);
  });

  it('marks a forged sequence invalid: not from the seed', () => {
    // A legal level-1 sequence that none of position 0's variants produces (a small level can repeat by chance).
    const variants = Array.from({ length: sm.SEQUENCE_VARIANTS }, (_, variant) => sm.sequenceAt(SEED, 0, variant, 1));
    const candidates = Array.from({ length: 81 }, (_, index) => [Math.floor(index / 9), index % 9]).filter(([a, b]) => a !== b);
    const sequence = candidates.find((candidate) => !variants.some((variant) => sm.sameSequence(variant, candidate)))!;
    const forged = withTrial(0, () => ({ sequence, response: sequence }));
    expect(sm.checkSession(forged).outcome).toBe('invalid');
    expect(reasonsOf(forged)).toContain('sequence-not-from-seed');
  });

  it('marks an easier sequence invalid: outside its level', () => {
    const forged = withTrial(0, (trial) => ({ sequence: trial.sequence.slice(1), response: trial.sequence.slice(1), tapAtMs: trial.tapAtMs.slice(1) }));
    expect(reasonsOf(forged)).toEqual(expect.arrayContaining(['sequence-outside-level', 'sequence-not-from-seed']));
    expect(sm.checkSession(forged).outcome).toBe('invalid');
  });

  it('marks a forged level sequence invalid: the staircase does not replay', () => {
    const run = play(SEED, 1, corrects(3));
    const forged = sessionOf(SEED, run, {
      trials: run.trials.map((trial, index) => (index === 2 ? { ...trial, level: 3 } : trial)),
      summary: undefined,
    });
    expect(reasonsOf(forged)).toContain('level-sequence-mismatch');
    expect(sm.checkSession(forged).outcome).toBe('invalid');
  });

  it('marks a forged response invalid: a wrong trial claimed correct', () => {
    const wrongIndex = honest.trials.findIndex((trial) => !trial.correct && !trial.timedOut);
    const forged = withTrial(wrongIndex, () => ({ correct: true }));
    expect(reasonsOf(forged)).toContain('correct-mismatch');
    expect(sm.checkSession(forged).outcome).toBe('invalid');
  });

  it('marks a response that continues after the wrong tile invalid', () => {
    const index = honest.trials.findIndex((trial) => trial.correct && trial.sequence.length >= 2);
    const forged = withTrial(index, (trial) => ({
      response: [trial.sequence[0]! === 0 ? 1 : 0, ...trial.sequence.slice(1)],
      correct: false,
    }));
    expect(reasonsOf(forged)).toContain('response-mismatch');
  });

  it('marks timedOut, rtMs and tap inconsistencies invalid', () => {
    const correctIndex = honest.trials.findIndex((trial) => trial.correct);
    expect(reasonsOf(withTrial(correctIndex, () => ({ timedOut: true })))).toContain('timed-out-mismatch');
    expect(reasonsOf(withTrial(correctIndex, (trial) => ({ rtMs: trial.rtMs + 1 })))).toContain('rt-mismatch');
    expect(reasonsOf(withTrial(correctIndex, (trial) => ({ tapAtMs: trial.tapAtMs.slice(1) })))).toContain('malformed-taps');
    expect(reasonsOf(withTrial(correctIndex, (trial) => ({ tapAtMs: [...trial.tapAtMs].reverse() })))).toContain('malformed-taps');
  });

  it('marks a response over its limit invalid', () => {
    const index = honest.trials.findIndex((trial) => trial.correct);
    const late = withTrial(index, (trial) => {
      const tapAtMs = trial.tapAtMs.map((at, tap) => (tap === trial.tapAtMs.length - 1 ? trial.responseLimitMs : at));
      return { tapAtMs, rtMs: trial.responseLimitMs };
    });
    expect(reasonsOf(late)).toContain('response-over-limit');
    expect(sm.checkSession(late).outcome).toBe('invalid');
  });

  it('marks parameters that are not the level\'s invalid (a longer presentation or limit)', () => {
    for (const change of [{ presentationMs: 60_000 }, { responseLimitMs: 60_000 }, { gridSize: 2 }] as const) {
      const forged = withTrial(0, () => change);
      expect(reasonsOf(forged)).toContain('level-parameters-mismatch');
      expect(sm.checkSession(forged).outcome).toBe('invalid');
    }
  });

  it('flags a run with too many taps below the floor', () => {
    const fast = play(SEED, 1, corrects(sm.TRIALS_PER_RUN, 60));
    const report = sm.checkSession(sessionOf(SEED, fast));
    expect(report).toMatchObject({ outcome: 'flagged', reasons: ['tap-below-floor'] });
    // At the floor is fine.
    const quick = play(SEED, 1, corrects(sm.TRIALS_PER_RUN, sm.MIN_PLAUSIBLE_TAP_MS));
    expect(reasonsOf(sessionOf(SEED, quick))).toEqual([]);
  });

  it('flags overlapping trials and an active time that is not the trials\'', () => {
    const overlap = withTrial(1, (trial) => ({ shownAtMs: trial.shownAtMs - 500 }));
    expect(sm.checkSession(overlap)).toMatchObject({ outcome: 'flagged' });
    expect(reasonsOf(overlap)).toContain('trial-overlap');
    const longer = sessionOf(SEED, honest, { activeDurationMs: sm.recordedActiveMs(honest) + sm.TIMING_TOLERANCE_MS + 1 });
    expect(reasonsOf(longer)).toEqual(['active-duration-mismatch']);
    const withinTolerance = sessionOf(SEED, honest, { activeDurationMs: sm.recordedActiveMs(honest) + sm.TIMING_TOLERANCE_MS });
    expect(reasonsOf(withinTolerance)).toEqual([]);
  });

  it('flags a completed run without all its trials, and an abandoned one with all of them', () => {
    const short = play(SEED, 1, corrects(5));
    expect(reasonsOf(sessionOf(SEED, short, { status: 'completed' }))).toEqual(['trial-count-mismatch']);
    expect(reasonsOf(sessionOf(SEED, honest, { status: 'abandoned' }))).toEqual(['trial-count-mismatch']);
  });

  it('records peak-level and summary mismatches as diagnostics only', () => {
    const report = sm.checkSession(sessionOf(SEED, honest, {
      peakLevel: 10,
      summary: { score: 1, accuracy: 1, trialsTotal: 1, trialsCorrect: 1, responseTime: null, metrics: {} },
    }));
    expect(report).toMatchObject({ outcome: 'valid', reasons: ['peak-level-mismatch', 'summary-mismatch'] });
  });

  it('freezes every reason\'s outcome and refuses unknown codes', () => {
    expect(sm.REASON_OUTCOMES).toEqual({
      'level-parameters-mismatch': 'invalid',
      'sequence-outside-level': 'invalid',
      'malformed-taps': 'invalid',
      'response-mismatch': 'invalid',
      'response-over-limit': 'invalid',
      'correct-mismatch': 'invalid',
      'timed-out-mismatch': 'invalid',
      'rt-mismatch': 'invalid',
      'level-sequence-mismatch': 'invalid',
      'sequence-not-from-seed': 'invalid',
      'tap-below-floor': 'flagged',
      'trial-overlap': 'flagged',
      'trial-count-mismatch': 'flagged',
      'active-duration-mismatch': 'flagged',
      'peak-level-mismatch': 'diagnostic',
      'summary-mismatch': 'diagnostic',
    });
    expect(Object.isFrozen(sm.REASON_OUTCOMES)).toBe(true);
    expect(() => sm.reportOf([{ code: 'tap-below-floor', outcome: 'invalid', trialIndex: null }])).toThrow();
  });

  it('property: honest runs of many seeds and start levels are always valid', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const run = fullRun(seed * 104_729, 1 + (seed % 10));
      expect({ seed, reasons: reasonsOf(sessionOf(seed * 104_729, run)) }).toEqual({ seed, reasons: [] });
    }
  });
});
