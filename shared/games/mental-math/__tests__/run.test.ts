import { describe, expect, it } from 'vitest';
import { mentalMathV1 as mm } from '@nfct/shared';
import { correct, pause, play, timeout, wrong } from './helpers';

const SEED = 0xc0ff_ee00;

function shape(question: mm.QuestionShape): mm.QuestionShape {
  return { operands: question.operands, operators: question.operators, grouped: question.grouped };
}

describe('run reducer: seed reproduction, including discarded questions', () => {
  it('reproduces every recorded question from the seed, whatever was discarded in between', () => {
    const { run } = play(SEED, 5, [
      correct(), pause(), pause(), correct(), wrong(), pause(1_200), timeout(),
      ...Array.from({ length: 20 }, () => pause(10)), // more discards than there are variants
      correct(), correct(), correct(), correct(),
    ]);
    const validation = mm.validateTrialsAgainstSeed(SEED, run.trials);

    expect(run.trials).toHaveLength(8);
    expect(validation.issues).toEqual([]);
    expect(validation.variants.every((variant) => variant !== null && variant < mm.QUESTION_VARIANTS)).toBe(true);
    expect(validation.variants[0]).toBe(0);
    expect(validation.variants[1]).not.toBe(0); // two discards at position 1 moved its variant on
  });

  it('shows a fresh question after a pause, at the same level, and never repeats it back to back', () => {
    let run = mm.presentQuestion(mm.startRun({ seed: SEED, startLevel: 1 }), 0);
    const levelBefore = run.staircase;
    for (let pauses = 0; pauses < 40; pauses += 1) {
      const discarded = shape(run.current!);
      run = mm.presentQuestion(mm.discardQuestion(run), 100 * (pauses + 1));
      expect(mm.sameQuestion(run.current!, discarded)).toBe(false);
      expect(run.current!.level).toBe(1);
      expect(run.current!.position).toBe(0);
      expect(run.staircase).toEqual(levelBefore);
    }
    const trialQuestion = shape(run.current!);
    const answered = mm.answerQuestion(run, { questionId: run.current!.id, response: run.current!.expected, rtMs: 1_000 });
    if (!answered.accepted) throw new Error('refused');
    const next = mm.presentQuestion(answered.run, 5_000);
    expect(mm.sameQuestion(next.current!, trialQuestion)).toBe(false);
    expect(next.current!.position).toBe(1);
  });

  it('never lets a discard change the level, the in-level streak or the answer streak', () => {
    const { run: before } = play(SEED, 4, [correct(), correct()]);
    const after = mm.discardQuestion(mm.presentQuestion(before, 4_000));

    expect(after.staircase).toEqual(before.staircase);
    expect(after.answerStreak).toBe(before.answerStreak);
    expect(after.trials).toEqual(before.trials);
    expect(after.presentedCount).toBe(before.presentedCount + 1);
  });

  it('fails reproduction when a recorded question was edited or the seed differs', () => {
    const { run } = play(SEED, 2, [correct(), correct(), wrong(), correct()]);
    const edited = run.trials.map((trial, index) => (index === 2 ? { ...trial, operands: [trial.operands[0]! + 1, ...trial.operands.slice(1)] } : trial));

    expect(mm.validateTrialsAgainstSeed(SEED, edited).issues).toEqual([{ code: 'question-not-from-seed', outcome: 'invalid', trialIndex: 2 }]);
    expect(mm.validateTrialsAgainstSeed(SEED + 1, run.trials).variants.every((variant) => variant === null)).toBe(true);
    // Recorded trials cannot be reordered either: each position has its own questions.
    const swapped = [run.trials[1]!, run.trials[0]!, ...run.trials.slice(2)];
    expect(mm.validateTrialsAgainstSeed(SEED, swapped).issues.map(({ trialIndex }) => trialIndex)).toEqual([0, 1]);
  });

  it('plays identically from the same seed and inputs (no clock, no module state)', () => {
    const steps = [correct(900), pause(300), wrong(2_000), correct(1_500), timeout(), correct(4_000)];

    expect(play(SEED, 6, steps).run).toEqual(play(SEED, 6, steps).run);
    expect(play(SEED + 1, 6, steps).run.trials).not.toEqual(play(SEED, 6, steps).run.trials);
  });
});

describe('run reducer: submissions', () => {
  function onScreen(startLevel = 3) {
    return mm.presentQuestion(mm.startRun({ seed: SEED, startLevel }), 0);
  }

  it('records a correct answer as a trial with every field the schema needs', () => {
    const run = onScreen();
    const question = run.current!;
    const result = mm.answerQuestion(run, { questionId: question.id, response: question.expected, rtMs: 2_345 });
    if (!result.accepted) throw new Error('refused');

    expect(result.trial).toEqual({
      level: 3,
      operands: question.operands,
      operators: question.operators,
      grouped: question.grouped,
      expected: question.expected,
      response: question.expected,
      correct: true,
      timedOut: false,
      shownAtMs: 0,
      rtMs: 2_345,
      timeLimitMs: 10_000,
    });
    expect(mm.trialSchema.parse(result.trial)).toEqual(result.trial);
    expect(result.run.current).toBeNull();
  });

  it('resolves each question once: a double submission is refused and changes nothing', () => {
    const run = onScreen();
    const id = run.current!.id;
    const first = mm.answerQuestion(run, { questionId: id, response: 1, rtMs: 1_000 });
    if (!first.accepted) throw new Error('refused');
    const second = mm.answerQuestion(first.run, { questionId: id, response: 1, rtMs: 1_010 });

    expect(second).toEqual({ accepted: false, run: first.run, reason: 'no-question' });
    const next = mm.presentQuestion(first.run, 1_000);
    const stale = mm.answerQuestion(next, { questionId: id, response: 1, rtMs: 5 });
    expect(stale).toEqual({ accepted: false, run: next, reason: 'stale-question' });
    expect(mm.timeOutQuestion(next, { questionId: id })).toMatchObject({ accepted: false, reason: 'stale-question' });
    expect(next.current!.id).not.toBe(id);
  });

  it('counts an answer at the deadline as a timeout', () => {
    const run = onScreen();
    const question = run.current!;
    for (const rtMs of [question.timeLimitMs, question.timeLimitMs + 250]) {
      const result = mm.answerQuestion(run, { questionId: question.id, response: question.expected, rtMs });
      if (!result.accepted) throw new Error('refused');
      expect(result.trial).toMatchObject({ response: null, correct: false, timedOut: true, rtMs: question.timeLimitMs });
      expect(result.run.staircase.level).toBe(2);
    }
    const inTime = mm.answerQuestion(run, { questionId: question.id, response: question.expected, rtMs: question.timeLimitMs - 1 });
    expect(inTime).toMatchObject({ accepted: true, trial: { correct: true, timedOut: false } });
  });

  it('records a timeout with response null and rtMs equal to the level limit', () => {
    const run = onScreen(8);
    const result = mm.timeOutQuestion(run, { questionId: run.current!.id });

    expect(result).toMatchObject({ accepted: true, trial: { response: null, correct: false, timedOut: true, rtMs: 15_000, timeLimitMs: 15_000 } });
  });

  it('guards its inputs against runner bugs', () => {
    const run = onScreen();
    const id = run.current!.id;

    expect(() => mm.presentQuestion(run, 10)).toThrow(/already on screen/);
    expect(() => mm.answerQuestion(run, { questionId: id, response: -1, rtMs: 10 })).toThrow(RangeError);
    expect(() => mm.answerQuestion(run, { questionId: id, response: 1.5, rtMs: 10 })).toThrow(RangeError);
    expect(() => mm.answerQuestion(run, { questionId: id, response: mm.MAX_RESPONSE + 1, rtMs: 10 })).toThrow(RangeError);
    expect(() => mm.answerQuestion(run, { questionId: id, response: 1, rtMs: 10.5 })).toThrow(RangeError);
    expect(mm.answerQuestion(mm.startRun({ seed: SEED, startLevel: 1 }), { questionId: 'q1', response: 1, rtMs: 1 }))
      .toMatchObject({ accepted: false, reason: 'no-question' });
    const answered = mm.answerQuestion(run, { questionId: id, response: 1, rtMs: 3_000 });
    if (!answered.accepted) throw new Error('refused');
    expect(() => mm.presentQuestion(answered.run, 2_999)).toThrow(RangeError); // before the previous trial ended
    expect(() => mm.startRun({ seed: -1, startLevel: 1 })).toThrow(RangeError);
    expect(() => mm.startRun({ seed: 1, startLevel: 11 })).toThrow(RangeError);
    expect(mm.discardQuestion(answered.run)).toBe(answered.run);
  });

  it('reports the peak level and stops at the trial cap', () => {
    const { run } = play(SEED, 1, Array.from({ length: 9 }, () => correct(1_000)));

    expect(mm.runPeakLevel(run)).toBe(3);
    expect(mm.runPeakLevel(mm.startRun({ seed: SEED, startLevel: 7 }))).toBe(7);
    const full = { ...run, trials: Array.from({ length: mm.MAX_TRIALS }, () => run.trials[0]!) };
    expect(mm.isTrialCapReached(full)).toBe(true);
    expect(() => mm.presentQuestion(full, 0)).toThrow(/at most 400/);
  });
});
