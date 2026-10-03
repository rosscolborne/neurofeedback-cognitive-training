import { describe, expect, it } from 'vitest';
import { mentalMathV1 as mm } from '@nfct/shared';
import { correct, fullRun, pause, play, sessionOf, timeout, wrong } from './helpers';

type Trial = mm.MentalMathTrial;
const SEED = 0x1234_5678;
const START = 3;

/** A conforming completed run: right and wrong answers, a timeout and pauses. */
function conforming() {
  const { run } = fullRun(SEED, START, [correct(1_800), correct(2_600), pause(700), correct(3_100), wrong(4_000), timeout(), correct(900)]);
  return { run, session: sessionOf(SEED, run) };
}

function withTrial(trials: readonly Trial[], index: number, change: Partial<Trial>): Trial[] {
  return trials.map((trial, at) => (at === index ? { ...trial, ...change } : trial));
}

const firstIndex = (trials: readonly Trial[], predicate: (trial: Trial) => boolean) => {
  const index = trials.findIndex(predicate);
  if (index === -1) throw new Error('fixture has no such trial');
  return index;
};

describe('Mental Math v1 plausibility: outcomes', () => {
  it('freezes each reason code\'s outcome with gameVersion 1', () => {
    expect(mm.REASON_OUTCOMES).toEqual({
      'expected-mismatch': 'invalid',
      'correct-mismatch': 'invalid',
      'timed-out-mismatch': 'invalid',
      'rt-exceeds-limit': 'invalid',
      'timeout-rt-mismatch': 'invalid',
      'time-limit-mismatch': 'invalid',
      'question-outside-level': 'invalid',
      'level-sequence-mismatch': 'invalid',
      'question-not-from-seed': 'invalid',
      'rt-below-floor': 'flagged',
      'trial-overlap': 'flagged',
      'run-overrun': 'flagged',
      'active-duration-mismatch': 'flagged',
      'peak-level-mismatch': 'diagnostic',
      'summary-mismatch': 'diagnostic',
    });
    expect(Object.isFrozen(mm.REASON_OUTCOMES)).toBe(true);
    // Every code fits the stored reason format (result.reasons).
    for (const code of Object.keys(mm.REASON_OUTCOMES)) expect(code).toMatch(/^[a-z][a-z0-9-]{0,39}$/);
  });

  it('finds nothing wrong with a conforming run, pauses and all', () => {
    const { run, session } = conforming();

    expect(run.trials.length).toBeGreaterThan(10);
    expect(run.trials.some((trial) => trial.timedOut)).toBe(true);
    expect(run.presentedCount).toBeGreaterThan(run.trials.length);
    expect(mm.checkSession(session)).toEqual({ outcome: 'valid', reasons: [], issues: [] });
  });

  it('treats empty sessions as valid: an abandoned run, or a completed one paused before every timeout', () => {
    const empty = { modeId: mm.MODE_ID, startLevel: 4, peakLevel: 4, seed: 9, trials: [] };

    expect(mm.checkSession({ ...empty, status: 'abandoned', activeDurationMs: 0 }).outcome).toBe('valid');
    // With no trials the bank never moved: the run ends when the starting bank runs out.
    expect(mm.checkSession({ ...empty, status: 'completed', activeDurationMs: mm.START_BANK_MS }).outcome).toBe('valid');
    expect(mm.checkSession({ ...empty, status: 'completed', activeDurationMs: 90_000 }).outcome).toBe('flagged');
    // A conforming client can produce the completed one: the clock only runs with a question on screen.
    const { run, clock } = play(9, 4, Array.from({ length: 6 }, () => pause(7_500)));
    expect(run.trials).toEqual([]);
    expect(clock).toBe(mm.START_BANK_MS);
    expect(run.endsAtMs).toBe(mm.START_BANK_MS);
  });

  it('combines outcomes: invalid beats flagged, and diagnostics never change validity', () => {
    const { session } = conforming();

    expect(mm.checkSession({ ...session, peakLevel: 1 })).toMatchObject({ outcome: 'valid', reasons: ['peak-level-mismatch'] });
    expect(mm.checkSession({ ...session, activeDurationMs: 60_000 })).toMatchObject({ outcome: 'flagged' });
    const both = mm.checkSession({ ...session, seed: SEED + 1, activeDurationMs: 60_000, peakLevel: 1 });
    expect(both.outcome).toBe('invalid');
    expect(both.reasons).toEqual(['question-not-from-seed', 'active-duration-mismatch', 'peak-level-mismatch']);
    expect(mm.reportOf([])).toEqual({ outcome: 'valid', reasons: [], issues: [] });
  });

  it('reports v1 reasons only: an unknown code or a changed outcome throws instead of being dropped', () => {
    const lockedStart = { code: 'start-level-locked', outcome: 'flagged', trialIndex: null } as unknown as mm.PlausibilityIssue;

    expect(() => mm.reportOf([lockedStart])).toThrow(/start-level-locked/);
    expect(() => mm.reportOf([{ code: 'rt-below-floor', outcome: 'diagnostic', trialIndex: null }])).toThrow(/rt-below-floor/);
    expect(mm.reportOf([{ code: 'trial-overlap', outcome: 'flagged', trialIndex: 3 }]))
      .toEqual({ outcome: 'flagged', reasons: ['trial-overlap'], issues: [{ code: 'trial-overlap', outcome: 'flagged', trialIndex: 3 }] });
  });

  it('refuses a session of another mode: validate with gameSessionSchemaFor first', () => {
    expect(() => mm.checkSession({ ...conforming().session, modeId: 'endless' })).toThrow(/mode/);
  });
});

describe('Mental Math v1 plausibility: one failing case per check', () => {
  it('flags more than 20% of response times under 250 ms (design F), and not exactly 20%', () => {
    const { run } = play(SEED, 1, Array.from({ length: 10 }, (_, index) => correct(index < 3 ? 249 : 2_000)));
    const atFloor = withTrial(run.trials, 2, { rtMs: 250 });

    expect(mm.checkResponseTimeFloor(atFloor)).toEqual([]); // 2 of 10: exactly 20%
    expect(mm.checkResponseTimeFloor(run.trials)).toEqual([{ code: 'rt-below-floor', outcome: 'flagged', trialIndex: null }]);
    expect(mm.checkResponseTimeFloor([])).toEqual([]);
    const { session } = conforming();
    const fast = session.trials.map((trial) => ({ ...trial, rtMs: Math.min(trial.rtMs, 200) }));
    expect(mm.checkSession({ ...session, trials: fast }).reasons).toContain('rt-below-floor');
  });

  it('expected-mismatch: expected is not the operands evaluated with their operators and grouping', () => {
    const { session } = conforming();
    const index = firstIndex(session.trials, (trial) => !trial.correct && !trial.timedOut);
    const trials = withTrial(session.trials, index, { expected: session.trials[index]!.expected + 2 });

    expect(mm.checkArithmetic(trials)).toEqual([{ code: 'expected-mismatch', outcome: 'invalid', trialIndex: index }]);
    expect(mm.checkSession({ ...session, trials })).toMatchObject({ outcome: 'invalid', reasons: ['expected-mismatch'] });
  });

  it('correct-mismatch: correct is not (response == expected)', () => {
    const { session } = conforming();
    const index = firstIndex(session.trials, (trial) => !trial.correct && !trial.timedOut);
    const trials = withTrial(session.trials, index, { correct: true });

    expect(mm.checkTrialFlags(trials)).toEqual([{ code: 'correct-mismatch', outcome: 'invalid', trialIndex: index }]);
    expect(mm.checkSession({ ...session, trials })).toMatchObject({ outcome: 'invalid', reasons: ['correct-mismatch'] });
  });

  it('timed-out-mismatch: timedOut is not (response == null)', () => {
    const { session } = conforming();
    const index = firstIndex(session.trials, (trial) => !trial.timedOut);
    const trials = withTrial(session.trials, index, { timedOut: true });

    expect(mm.checkTrialFlags(trials)).toEqual([{ code: 'timed-out-mismatch', outcome: 'invalid', trialIndex: index }]);
    expect(mm.checkSession({ ...session, trials })).toMatchObject({ outcome: 'invalid', reasons: ['timed-out-mismatch'] });
  });

  it('rt-exceeds-limit: an answer at or after the deadline, or rtMs above the limit', () => {
    const { session } = conforming();
    const index = firstIndex(session.trials, (trial) => !trial.timedOut);
    const limit = session.trials[index]!.timeLimitMs;

    for (const rtMs of [limit, limit + 1]) {
      const trials = withTrial(session.trials, index, { rtMs });
      expect(mm.checkResponseTimeLimits(trials)).toEqual([{ code: 'rt-exceeds-limit', outcome: 'invalid', trialIndex: index }]);
      expect(mm.checkSession({ ...session, trials }).reasons).toContain('rt-exceeds-limit');
    }
    expect(mm.checkResponseTimeLimits(withTrial(session.trials, index, { rtMs: limit - 1 }))).toEqual([]);
  });

  it('timeout-rt-mismatch: a timeout whose rtMs is not the limit', () => {
    const { session } = conforming();
    const index = firstIndex(session.trials, (trial) => trial.timedOut);
    const trials = withTrial(session.trials, index, { rtMs: session.trials[index]!.timeLimitMs - 1 });

    expect(mm.checkResponseTimeLimits(trials)).toEqual([{ code: 'timeout-rt-mismatch', outcome: 'invalid', trialIndex: index }]);
    expect(mm.checkSession({ ...session, trials }).reasons).toContain('timeout-rt-mismatch');
  });

  it('time-limit-mismatch: timeLimitMs is not the trial level\'s', () => {
    const { session } = conforming();
    const trials = withTrial(session.trials, 0, { timeLimitMs: session.trials[0]!.timeLimitMs + 1_000 });

    expect(mm.checkLevelParameters(trials)).toEqual([{ code: 'time-limit-mismatch', outcome: 'invalid', trialIndex: 0 }]);
    expect(mm.checkSession({ ...session, trials }).reasons).toContain('time-limit-mismatch');
  });

  it('question-outside-level: operators, grouping or operand ranges that are not the level\'s', () => {
    const { session } = conforming();
    const first = session.trials[0]!; // level 3: + or - of two two-digit numbers
    const outside: Partial<Trial>[] = [
      { operands: [7, 8], operators: ['×'], expected: 56 },
      { operands: [first.operands[0]!, 5], expected: mm.evaluate({ ...first, operands: [first.operands[0]!, 5] })! },
    ];
    for (const change of outside) {
      const trials = withTrial(session.trials, 0, { ...change, response: change.expected!, correct: true });
      expect(mm.checkLevelParameters(trials)).toEqual([{ code: 'question-outside-level', outcome: 'invalid', trialIndex: 0 }]);
      expect(mm.checkSession({ ...session, trials }).reasons).toContain('question-outside-level');
    }
  });

  it('level-sequence-mismatch: levels that do not replay the staircase from startLevel', () => {
    const { session } = conforming();

    expect(mm.checkStaircase(session.trials, START + 1)).toEqual([{ code: 'level-sequence-mismatch', outcome: 'invalid', trialIndex: 0 }]);
    const index = firstIndex(session.trials, (trial) => trial.level !== START);
    const trials = withTrial(session.trials, index, { level: START });
    expect(mm.checkStaircase(trials, START)).toEqual([{ code: 'level-sequence-mismatch', outcome: 'invalid', trialIndex: index }]);
    expect(mm.checkSession({ ...session, trials }).reasons).toContain('level-sequence-mismatch');
    // A client that lies about correctness cannot climb: the replay uses trusted correctness.
    const lying = session.trials.map((trial) => ({ ...trial, correct: true }));
    expect(mm.checkStaircase(lying, START)).toEqual([]);
  });

  it('question-not-from-seed: questions the session seed cannot reproduce', () => {
    const { session } = conforming();

    expect(mm.checkSession({ ...session, seed: SEED ^ 1 })).toMatchObject({ outcome: 'invalid', reasons: ['question-not-from-seed'] });
  });

  it('trial-overlap: a trial shown before the previous one ended, or not after it', () => {
    const { session } = conforming();
    const previous = session.trials[0]!;
    const end = previous.shownAtMs + previous.rtMs;

    expect(mm.checkTiming(withTrial(session.trials, 1, { shownAtMs: end - mm.TIMING_TOLERANCE_MS }), session)).toEqual([]);
    const overlapping = withTrial(session.trials, 1, { shownAtMs: end - mm.TIMING_TOLERANCE_MS - 1 });
    expect(mm.checkTiming(overlapping, session)).toEqual([{ code: 'trial-overlap', outcome: 'flagged', trialIndex: 1 }]);
    expect(mm.checkTiming(withTrial(session.trials, 1, { shownAtMs: previous.shownAtMs }), session)[0]?.code).toBe('trial-overlap');
    expect(mm.checkSession({ ...session, trials: overlapping })).toMatchObject({ outcome: 'flagged', reasons: ['trial-overlap'] });
  });

  it('trial-overlap: shownAtMs must strictly increase, even when the previous trial was within the tolerance', () => {
    const { session } = conforming();
    const quick = withTrial(session.trials, 0, { rtMs: 30 }); // ends 30 ms after it appeared
    const shownAt = quick[0]!.shownAtMs;

    expect(mm.checkTiming(withTrial(quick, 1, { shownAtMs: shownAt + 1 }), session)).toEqual([]); // 29 ms overlap: tolerated
    expect(mm.checkTiming(withTrial(quick, 1, { shownAtMs: shownAt }), session))
      .toEqual([{ code: 'trial-overlap', outcome: 'flagged', trialIndex: 1 }]);
  });

  it('run-overrun: a trial that ends after the time bank in force when it was shown', () => {
    const { session } = conforming();
    const last = session.trials.length - 1;
    const lastTrial = session.trials[last]!;
    const bankEnd = mm.bankEnds(session.trials).before[last]!;
    const within = withTrial(session.trials, last, { shownAtMs: bankEnd + mm.TIMING_TOLERANCE_MS - lastTrial.rtMs });
    const trials = withTrial(session.trials, last, { shownAtMs: bankEnd + mm.TIMING_TOLERANCE_MS + 1 - lastTrial.rtMs });
    const final = (list: typeof trials) => mm.bankEnds(list).final;

    expect(mm.checkTiming(within, { status: 'completed', activeDurationMs: final(within) })).toEqual([]);
    expect(mm.checkTiming(trials, { status: 'completed', activeDurationMs: final(trials) })).toEqual([
      { code: 'run-overrun', outcome: 'flagged', trialIndex: last },
    ]);
    expect(mm.checkSession({ ...session, trials, activeDurationMs: final(trials) })).toMatchObject({ outcome: 'flagged', reasons: ['run-overrun'] });
  });

  it('active-duration-mismatch: a completed run far from when its time bank ran out, or trials outside the active time', () => {
    const { session } = conforming();
    const end = mm.bankEnds(session.trials).final;
    expect(session.activeDurationMs).toBe(end);
    const timing = (status: 'completed' | 'abandoned', activeDurationMs: number) =>
      mm.checkTiming(session.trials, { status, activeDurationMs }).map(({ code }) => code);
    const lastEnd = Math.max(...session.trials.map((trial) => trial.shownAtMs + trial.rtMs));

    expect(timing('completed', end - 1_000)).toEqual([]);
    expect(timing('completed', end + 1_000)).toEqual([]);
    expect(timing('completed', end - 1_001)).toEqual(['active-duration-mismatch']);
    expect(timing('completed', end + 1_001)).toEqual(['active-duration-mismatch']);
    // A fixed 90 s run is no longer what "completed" means: the bank decides.
    if (Math.abs(end - 90_000) > 1_000) expect(timing('completed', 90_000)).toEqual(['active-duration-mismatch']);
    expect(timing('abandoned', lastEnd)).toEqual([]);
    expect(timing('abandoned', lastEnd - mm.TIMING_TOLERANCE_MS - 1)).toEqual(['active-duration-mismatch']);
    expect(timing('abandoned', end + 1_001)).toEqual(['active-duration-mismatch']);
    expect(mm.checkSession({ ...session, status: 'abandoned', activeDurationMs: 10_000 }).reasons).toEqual(['active-duration-mismatch']);
  });

  it('peak-level-mismatch: a client peakLevel that is not the highest trial level (diagnostic only)', () => {
    const { session } = conforming();
    const trusted = Math.max(...session.trials.map((trial) => trial.level));

    expect(mm.checkPeakLevel(session.trials, START, trusted)).toEqual([]);
    expect(mm.checkPeakLevel(session.trials, START, 10)).toEqual([{ code: 'peak-level-mismatch', outcome: 'diagnostic', trialIndex: null }]);
    expect(mm.checkPeakLevel([], 4, 4)).toEqual([]);
    expect(mm.checkSession({ ...session, peakLevel: 10 })).toMatchObject({ outcome: 'valid', reasons: ['peak-level-mismatch'] });
  });

  it('summary-mismatch: a display summary that differs from trusted scoring (diagnostic only)', () => {
    const { session } = conforming();
    const summary = session.summary!;
    const changed = [
      { ...summary, score: summary.score + 1 },
      { ...summary, trialsTotal: summary.trialsTotal - 1 },
      { ...summary, metrics: { ...summary.metrics, longestStreak: 99 } },
      { ...summary, responseTime: null },
    ];
    for (const odd of changed) {
      expect(mm.checkSession({ ...session, summary: odd })).toMatchObject({ outcome: 'valid', reasons: ['summary-mismatch'] });
    }
  });
});
