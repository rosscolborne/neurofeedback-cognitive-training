import { describe, expect, it, vi } from 'vitest';
import { mentalMath } from '@nfct/shared';
import { FEEDBACK_MS, MAX_ENTRY_DIGITS, MentalMathRunController, type RunOutcome } from '../runController';
import { answerOf } from './fixtures';
import { ManualClock } from './manualClock';

const SEED = 1234;
const LEVEL_1_LIMIT_MS = mentalMath.LEVELS[0]!.timeLimitMs;

function setup(startLevel = 1) {
  const clock = new ManualClock();
  const onEnd = vi.fn<(outcome: RunOutcome) => void>();
  const controller = new MentalMathRunController({ seed: SEED, startLevel, clock, onEnd });
  return { clock, onEnd, controller };
}

function current(controller: MentalMathRunController) {
  const question = controller.getSnapshot().question;
  if (!question) throw new Error('no question on screen');
  return question;
}

function type(controller: MentalMathRunController, value: number) {
  for (const digit of String(value)) controller.pressDigit(Number(digit));
}

function outcomeOf(onEnd: ReturnType<typeof setup>['onEnd']): RunOutcome {
  expect(onEnd).toHaveBeenCalledTimes(1);
  return onEnd.mock.calls[0]![0];
}

describe('MentalMathRunController', () => {
  it('ends the run as completed at exactly 90 s of active time, discarding the question on screen', () => {
    const { clock, onEnd, controller } = setup();
    controller.start();
    // Never answering: each level-1 question times out at 8 s, with a feedback flash off the clock.
    const timeouts = Math.floor(mentalMath.RUN_DURATION_MS / LEVEL_1_LIMIT_MS);
    clock.advance(mentalMath.RUN_DURATION_MS + timeouts * FEEDBACK_MS - 1);
    expect(controller.getSnapshot().phase).toBe('question');
    expect(controller.getSnapshot().remainingMs).toBeGreaterThan(0);
    expect(onEnd).not.toHaveBeenCalled();

    clock.advance(1);
    const outcome = outcomeOf(onEnd);
    expect(outcome.status).toBe('completed');
    expect(outcome.activeDurationMs).toBe(mentalMath.RUN_DURATION_MS);
    // The question shown at 88 s was discarded at expiry, not recorded.
    expect(outcome.run.trials).toHaveLength(timeouts);
    expect(outcome.run.trials.every((trial) => trial.timedOut && trial.rtMs === LEVEL_1_LIMIT_MS)).toBe(true);
    expect(outcome.run.current).toBeNull();
    expect(controller.getSnapshot().phase).toBe('ended');
    expect(clock.pendingTimers).toBe(0);
    // The session the reducer built passes trusted plausibility.
    expect(mentalMath.checkSession({ modeId: mentalMath.MODE_ID, startLevel: 1, peakLevel: 1, status: 'completed', activeDurationMs: outcome.activeDurationMs, seed: SEED, trials: [...outcome.run.trials] }).outcome).toBe('valid');
  });

  it('does not consume active time during the feedback flash', () => {
    const { clock, controller } = setup();
    controller.start();
    clock.advance(1_500);
    const question = current(controller);
    type(controller, answerOf(question.text));
    controller.submit(question.id);
    expect(controller.getSnapshot().phase).toBe('feedback');
    const remaining = controller.getSnapshot().remainingMs;
    expect(remaining).toBe(mentalMath.RUN_DURATION_MS - 1_500);

    clock.advance(FEEDBACK_MS - 1);
    expect(controller.getSnapshot().phase).toBe('feedback');
    expect(controller.getSnapshot().remainingMs).toBe(remaining);
    clock.advance(1);
    expect(controller.getSnapshot().phase).toBe('question');
    expect(controller.getSnapshot().remainingMs).toBe(remaining);
    // The next question appears exactly where the last trial ended.
    clock.advance(700);
    const next = current(controller);
    type(controller, 1);
    controller.submit(next.id);
    clock.advance(FEEDBACK_MS);
    controller.quit();
  });

  it('freezes the clock while paused, records no trial for the discarded question, and resumes with a fresh one', () => {
    const { clock, onEnd, controller } = setup();
    controller.start();
    clock.advance(2_000);
    const before = current(controller);
    controller.pressDigit(4);
    controller.pause();
    expect(controller.getSnapshot()).toMatchObject({ phase: 'paused', pauseReason: 'player', question: null, entry: '', trialsRecorded: 0 });
    const frozen = controller.getSnapshot().remainingMs;
    expect(frozen).toBe(mentalMath.RUN_DURATION_MS - 2_000);

    clock.advance(10 * 60_000);
    expect(controller.getSnapshot().remainingMs).toBe(frozen);
    expect(clock.pendingTimers).toBe(0);

    controller.resume();
    const after = current(controller);
    expect(after.id).not.toBe(before.id);
    expect(after.text).not.toBe(before.text);
    expect(after.level).toBe(before.level);
    clock.advance(1_000);
    type(controller, answerOf(after.text));
    controller.submit(after.id);
    controller.quit();
    const [trial] = outcomeOf(onEnd).run.trials;
    // Only the answered question is a trial, shown at the active time of the pause.
    expect(outcomeOf(onEnd).run.trials).toHaveLength(1);
    expect(trial).toMatchObject({ shownAtMs: 2_000, rtMs: 1_000, correct: true });
  });

  it('pauses on backgrounding the same way, and never ends the run', () => {
    const { clock, onEnd, controller } = setup();
    controller.start();
    clock.advance(3_000);
    controller.pause('background');
    expect(controller.getSnapshot()).toMatchObject({ phase: 'paused', pauseReason: 'background', trialsRecorded: 0 });
    clock.advance(24 * 60 * 60_000);
    expect(onEnd).not.toHaveBeenCalled();
    expect(controller.getSnapshot().remainingMs).toBe(mentalMath.RUN_DURATION_MS - 3_000);
    // Pauses are unlimited.
    for (let i = 0; i < 25; i += 1) {
      controller.resume();
      clock.advance(10);
      controller.pause('player');
    }
    expect(controller.getSnapshot().trialsRecorded).toBe(0);
    expect(controller.getSnapshot().remainingMs).toBe(mentalMath.RUN_DURATION_MS - 3_250);
  });

  it('pausing during feedback keeps the recorded trial and loses no active time', () => {
    const { clock, controller } = setup();
    controller.start();
    clock.advance(1_000);
    const question = current(controller);
    type(controller, answerOf(question.text));
    controller.submit(question.id);
    controller.pause();
    clock.advance(5_000);
    expect(controller.getSnapshot()).toMatchObject({ phase: 'paused', trialsRecorded: 1, remainingMs: mentalMath.RUN_DURATION_MS - 1_000 });
    controller.resume();
    expect(controller.getSnapshot().phase).toBe('question');
  });

  it('requires Submit: a complete answer is never submitted on its own', () => {
    const { clock, controller } = setup();
    controller.start();
    clock.advance(500);
    const question = current(controller);
    const answer = answerOf(question.text);
    type(controller, answer);
    expect(controller.getSnapshot().entry).toBe(String(answer));
    clock.advance(LEVEL_1_LIMIT_MS - 501);
    expect(controller.getSnapshot()).toMatchObject({ phase: 'question', trialsRecorded: 0 });
    controller.submit(question.id);
    expect(controller.getSnapshot()).toMatchObject({ phase: 'feedback', trialsRecorded: 1 });
    expect(controller.getSnapshot().feedback).toMatchObject({ correct: true, timedOut: false, expected: answer });
  });

  it('ignores Submit with nothing typed', () => {
    const { clock, controller } = setup();
    controller.start();
    clock.advance(500);
    controller.submit(current(controller).id);
    expect(controller.getSnapshot()).toMatchObject({ phase: 'question', trialsRecorded: 0 });
  });

  it('measures rtMs from presentation to Submit, and records a timeout at the limit', () => {
    const { clock, onEnd, controller } = setup();
    controller.start();
    clock.advance(1_234);
    const first = current(controller);
    type(controller, answerOf(first.text) + 1);
    controller.submit(first.id);
    clock.advance(FEEDBACK_MS);
    // Time spent paused before a question does not count toward its rtMs either.
    controller.pause();
    clock.advance(3_000);
    controller.resume();
    clock.advance(2_345);
    const second = current(controller);
    type(controller, answerOf(second.text));
    controller.submit(second.id);
    clock.advance(FEEDBACK_MS + LEVEL_1_LIMIT_MS);
    controller.quit();
    const { trials } = outcomeOf(onEnd).run;
    expect(trials.map((trial) => [trial.shownAtMs, trial.rtMs, trial.correct, trial.timedOut])).toEqual([
      [0, 1_234, false, false],
      [1_234, 2_345, true, false],
      [3_579, LEVEL_1_LIMIT_MS, false, true],
    ]);
    expect(trials[2]!.response).toBeNull();
  });

  it('accepts one submission per question: a double tap and a stale question are both ignored', () => {
    const { clock, onEnd, controller } = setup();
    controller.start();
    clock.advance(800);
    const question = current(controller);
    type(controller, answerOf(question.text));
    controller.submit(question.id);
    controller.submit(question.id);
    clock.advance(FEEDBACK_MS);
    const next = current(controller);
    controller.pressDigit(7);
    // A late tap quoting the previous question cannot answer the new one.
    controller.submit(question.id);
    expect(controller.getSnapshot()).toMatchObject({ phase: 'question', trialsRecorded: 1 });
    expect(controller.getSnapshot().question?.id).toBe(next.id);
    controller.quit();
    expect(outcomeOf(onEnd).run.trials).toHaveLength(1);
  });

  it('caps the entry at six digits with no leading zeros', () => {
    const { controller } = setup();
    controller.start();
    controller.pressDigit(0);
    controller.pressDigit(0);
    expect(controller.getSnapshot().entry).toBe('0');
    controller.pressDigit(5);
    expect(controller.getSnapshot().entry).toBe('5');
    for (let i = 0; i < 10; i += 1) controller.pressDigit(9);
    expect(controller.getSnapshot().entry).toHaveLength(MAX_ENTRY_DIGITS);
    controller.deleteDigit();
    expect(controller.getSnapshot().entry).toBe('59999');
  });

  it('ends early only on quit, as abandoned, once', () => {
    const { clock, onEnd, controller } = setup();
    controller.start();
    clock.advance(5_000);
    controller.quit();
    controller.quit();
    const outcome = outcomeOf(onEnd);
    expect(outcome).toMatchObject({ status: 'abandoned', activeDurationMs: 5_000 });
    expect(outcome.run.trials).toHaveLength(0);
    expect(outcome.endedAtMs).toBeGreaterThan(outcome.startedAtMs);
    clock.advance(mentalMath.RUN_DURATION_MS);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('shows no question at or after 90 s and discards an answer the run cannot hold', () => {
    const { clock, onEnd, controller } = setup();
    controller.start();
    // Answer quickly and correctly until the end: every presentation is before 90 s.
    while (controller.getSnapshot().phase !== 'ended') {
      clock.advance(900);
      const snapshot = controller.getSnapshot();
      if (snapshot.phase === 'question' && snapshot.question) {
        type(controller, answerOf(snapshot.question.text));
        controller.submit(snapshot.question.id);
      }
      clock.advance(FEEDBACK_MS);
    }
    const outcome = outcomeOf(onEnd);
    const last = outcome.run.trials.at(-1)!;
    expect(last.shownAtMs + last.rtMs).toBeLessThanOrEqual(mentalMath.RUN_DURATION_MS);
    expect(outcome.run.trials.every((trial) => trial.shownAtMs < mentalMath.RUN_DURATION_MS)).toBe(true);
    expect(outcome.activeDurationMs).toBe(mentalMath.RUN_DURATION_MS);
    expect(mentalMath.runPeakLevel(outcome.run)).toBeGreaterThan(1);
  });

  it('keeps nothing after dispose: no timers, no outcome', () => {
    const { clock, onEnd, controller } = setup();
    controller.start();
    clock.advance(1_000);
    controller.dispose();
    expect(clock.pendingTimers).toBe(0);
    clock.advance(mentalMath.RUN_DURATION_MS * 2);
    expect(onEnd).not.toHaveBeenCalled();
  });
});
