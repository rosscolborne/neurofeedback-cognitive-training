import { describe, expect, it } from 'vitest';
import { mentalMath, mentalMathV1 as mm } from '@nfct/shared';

describe('Mental Math v1 question-limit predicates', () => {
  it('times out an answer at or after the per-question limit, not 1 ms before', () => {
    expect(mm.isAnswerTimedOut(7_999, 8_000)).toBe(false);
    expect(mm.isAnswerTimedOut(8_000, 8_000)).toBe(true);
    expect(mm.isAnswerTimedOut(8_001, 8_000)).toBe(true);
    expect(mm.isAnswerTimedOut(0, 8_000)).toBe(false);
  });

  it('records a submission at or after the limit, or no submission, as a timeout at exactly the limit', () => {
    expect(mm.recordedTiming(12, 7_999, 8_000)).toEqual({ response: 12, timedOut: false, rtMs: 7_999 });
    expect(mm.recordedTiming(12, 8_000, 8_000)).toEqual({ response: null, timedOut: true, rtMs: 8_000 });
    expect(mm.recordedTiming(12, 8_001, 8_000)).toEqual({ response: null, timedOut: true, rtMs: 8_000 });
    expect(mm.recordedTiming(null, 3_000, 8_000)).toEqual({ response: null, timedOut: true, rtMs: 8_000 });
    expect(mm.recordedTiming(0, 1, 8_000)).toEqual({ response: 0, timedOut: false, rtMs: 1 });
  });

  it('lets a trial end exactly at the run end (the time bank\'s end), and not 1 ms later', () => {
    expect(mm.trialEndsWithinRun(82_000, 7_999, 90_000)).toBe(true);
    expect(mm.trialEndsWithinRun(82_000, 8_000, 90_000)).toBe(true); // ends at exactly 90,000
    expect(mm.trialEndsWithinRun(82_000, 8_001, 90_000)).toBe(false);
    expect(mm.trialEndsWithinRun(44_999, 1, 45_000)).toBe(true);
    expect(mm.trialEndsWithinRun(44_999, 2, 45_000)).toBe(false);
    // An explicit end, as the plausibility check passes it with its tolerance.
    expect(mm.trialEndsWithinRun(90_000, 50, 90_050)).toBe(true);
    expect(mm.trialEndsWithinRun(90_000, 51, 90_050)).toBe(false);
  });

  it('presents questions only strictly before the run end', () => {
    expect(mm.canPresentAt(0, 45_000)).toBe(true);
    expect(mm.canPresentAt(44_999, 45_000)).toBe(true);
    expect(mm.canPresentAt(45_000, 45_000)).toBe(false);
    expect(mm.canPresentAt(45_001, 45_000)).toBe(false);
  });

  it('is the one rule the run reducer, scoring and plausibility share', () => {
    const run = mm.presentQuestion(mm.startRun({ seed: 5, startLevel: 1 }), mm.START_BANK_MS - 8_000);
    const { expected, id } = run.current!;
    const atLimit = mm.answerQuestion(run, { questionId: id, response: expected, rtMs: 8_000 });
    if (!atLimit.accepted) throw new Error('refused');

    expect(atLimit.trial).toMatchObject(mm.recordedTiming(expected, 8_000, 8_000));
    expect(mm.isCorrectTrial(atLimit.trial)).toBe(false);
    expect(mm.isTimeoutTrial(atLimit.trial)).toBe(true);
    expect(mm.speedBonus(1, 8_000)).toBe(0);
    expect(mm.checkResponseTimeLimits([atLimit.trial])).toEqual([]);
    expect(mm.checkResponseTimeLimits([{ ...atLimit.trial, response: expected, timedOut: false }]))
      .toEqual([{ code: 'rt-exceeds-limit', outcome: 'invalid', trialIndex: 0 }]);
    expect(mentalMath.isAnswerTimedOut).toBe(mm.isAnswerTimedOut);
    expect(mentalMath.trialEndsWithinRun).toBe(mm.trialEndsWithinRun);
  });
});
