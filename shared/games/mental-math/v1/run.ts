import { canPresentAt, recordedTiming, trialEndsWithinRun } from './limits';
import { MAX_RESPONSE, MAX_TRIALS, levelParams, type QuestionShape } from './params';
import { QUESTION_VARIANTS, questionAt, sameQuestion, type Question } from './questions';
import type { MentalMathTrial } from './schemas';
import { initialStaircase, nextStaircaseState, type StaircaseState } from './staircase';
import { nextBankEnd, START_BANK_MS, timeBankChange } from './timeBank';

// Mental Math gameVersion 1: the pure state of one run, for the game screen
// (NFCT-21) to drive. It owns the run rules that trusted scoring later checks,
// so the client cannot drift from them: which question comes next, the
// staircase, the question-ID guard against double submission, "an answer at
// the deadline counts as a timeout", and "expiry always wins". It owns no
// clock, timer, feedback or UI: the caller passes integer active-clock
// readings (round clock readings, then subtract, so trials meet exactly).
//
// Expiry always wins. The run ends when the time bank runs out, at
// `endsAtMs` of active time (timeBank.ts); each recorded trial moves that end.
// A question cannot be presented at or after it (presentQuestion throws), and
// an answer or timeout that would end after it is refused with reason
// 'run-over' and changes nothing: the question was still on screen at expiry,
// so the caller discards it (discardQuestion) and ends the run. A trial may
// end exactly at `endsAtMs`. So a run the reducer accepted never ends a trial
// after the bank's end (run-overrun), and its activeDurationMs is the final
// `endsAtMs` (active-duration-mismatch).
//
// Question order. The question at position p (the number of trials recorded
// so far) is questionAt(seed, p, variant, level). A new position starts at
// variant 0. Discarding the question on screen (pause, backgrounding, expiry,
// quitting) keeps the position, and the replacement takes the next variant
// (wrapping after QUESTION_VARIANTS). A presentation skips a variant whose
// question repeats the one just discarded or the previous trial's, trying
// every variant at most once. Trusted scoring accepts any variant, so none of
// this needs recording.
//
// Discarding never changes the level, the in-level streak or the answer streak.

export type PresentedQuestion = Question & {
  /** Unique within the run; answers must quote it (double-submission guard). */
  readonly id: string;
  readonly position: number;
  readonly variant: number;
  readonly level: number;
  readonly timeLimitMs: number;
  readonly shownAtMs: number;
};

export type MentalMathRun = {
  readonly seed: number;
  readonly startLevel: number;
  /** The level of the next question and the in-level streak. */
  readonly staircase: StaircaseState;
  /** Correct answers in a row, across level changes (what longestStreak measures). */
  readonly answerStreak: number;
  readonly trials: readonly MentalMathTrial[];
  /** Questions presented so far, discarded ones included. */
  readonly presentedCount: number;
  /** The question on screen, if any. */
  readonly current: PresentedQuestion | null;
  /** The variant the next presentation at this position tries first. */
  readonly nextVariant: number;
  /** The question discarded at this position, which its replacement avoids repeating. */
  readonly discarded: QuestionShape | null;
  /** The active time at which the time bank runs out and the run ends. */
  readonly endsAtMs: number;
};

export type AnswerResult =
  | {
    readonly accepted: true;
    readonly run: MentalMathRun;
    readonly trial: MentalMathTrial;
    /** How far the trial moved the bank's end, after the cap and run limit: what the HUD shows. */
    readonly bankChangeMs: number;
  }
  /**
   * Nothing changed. 'no-question': none is on screen. 'stale-question': the
   * answer quotes another question (a double submission). 'run-over': the
   * trial would end after the run; discard the question and end the run.
   */
  | { readonly accepted: false; readonly run: MentalMathRun; readonly reason: 'no-question' | 'stale-question' | 'run-over' };

export function startRun({ seed, startLevel }: { readonly seed: number; readonly startLevel: number }): MentalMathRun {
  questionAt(seed, 0, 0, startLevel); // validates the seed and the start level
  return {
    seed,
    startLevel,
    staircase: initialStaircase(startLevel),
    answerStreak: 0,
    trials: [],
    presentedCount: 0,
    current: null,
    nextVariant: 0,
    discarded: null,
    endsAtMs: START_BANK_MS,
  };
}

/** Active time left in the bank at active time `nowMs`. */
export function bankRemainingMs(run: MentalMathRun, nowMs: number): number {
  return Math.max(0, run.endsAtMs - nowMs);
}

function trialEnd(trial: MentalMathTrial): number {
  return trial.shownAtMs + trial.rtMs;
}

/** Whether the run holds the most trials a session may carry; the caller must then stop presenting. */
export function isTrialCapReached(run: MentalMathRun): boolean {
  return run.trials.length >= MAX_TRIALS;
}

/** The highest level shown in a recorded trial, or the start level before any trial. */
export function runPeakLevel(run: MentalMathRun): number {
  return run.trials.reduce((peak, trial) => Math.max(peak, trial.level), run.startLevel);
}

/** Presents the next question at active time `shownAtMs`. Throws if a question is already on screen. */
export function presentQuestion(run: MentalMathRun, shownAtMs: number): MentalMathRun {
  if (run.current !== null) throw new Error('A question is already on screen; answer, time out or discard it first');
  if (isTrialCapReached(run)) throw new Error(`A run holds at most ${MAX_TRIALS} trials`);
  const last = run.trials[run.trials.length - 1];
  if (!Number.isInteger(shownAtMs) || shownAtMs < 0 || (last !== undefined && shownAtMs < trialEnd(last))) {
    throw new RangeError(`shownAtMs must be an integer at or after the previous trial's end, got ${shownAtMs}`);
  }
  if (!canPresentAt(shownAtMs, run.endsAtMs)) {
    throw new RangeError(`The run ends at ${run.endsAtMs} ms of active time; cannot present at ${shownAtMs}`);
  }
  const position = run.trials.length;
  const level = run.staircase.level;
  const avoid = [run.discarded, last ?? null].filter((shape): shape is QuestionShape => shape !== null);
  let variant = run.nextVariant;
  let question = questionAt(run.seed, position, variant, level);
  for (let tried = 1; tried < QUESTION_VARIANTS && avoid.some((shape) => sameQuestion(shape, question)); tried += 1) {
    variant = (run.nextVariant + tried) % QUESTION_VARIANTS;
    question = questionAt(run.seed, position, variant, level);
  }
  if (avoid.some((shape) => sameQuestion(shape, question))) {
    variant = run.nextVariant;
    question = questionAt(run.seed, position, variant, level);
  }
  const presentedCount = run.presentedCount + 1;
  return {
    ...run,
    presentedCount,
    current: {
      ...question,
      id: `q${presentedCount}`,
      position,
      variant,
      level,
      timeLimitMs: levelParams(level).timeLimitMs,
      shownAtMs,
    },
    nextVariant: (variant + 1) % QUESTION_VARIANTS,
  };
}

function resolve(run: MentalMathRun, questionId: string, response: number | null, rtMs: number): AnswerResult {
  const { current } = run;
  if (current === null) return { accepted: false, run, reason: 'no-question' };
  if (current.id !== questionId) return { accepted: false, run, reason: 'stale-question' };
  if (!Number.isInteger(rtMs) || rtMs < 0) throw new RangeError(`rtMs must be a non-negative integer, got ${rtMs}`);
  if (response !== null && (!Number.isInteger(response) || response < 0 || response > MAX_RESPONSE)) {
    throw new RangeError(`response must be an integer 0-${MAX_RESPONSE}, got ${response}`);
  }
  // An answer at or after the deadline counts as a timeout.
  const recorded = recordedTiming(response, rtMs, current.timeLimitMs);
  // Expiry always wins: a trial may not end after the run (judged on the recorded rtMs).
  if (!trialEndsWithinRun(current.shownAtMs, recorded.rtMs, run.endsAtMs)) return { accepted: false, run, reason: 'run-over' };
  const correct = recorded.response !== null && recorded.response === current.expected;
  const trial: MentalMathTrial = {
    level: current.level,
    operands: [...current.operands],
    operators: [...current.operators],
    grouped: current.grouped,
    expected: current.expected,
    response: recorded.response,
    correct,
    timedOut: recorded.timedOut,
    shownAtMs: current.shownAtMs,
    rtMs: recorded.rtMs,
    timeLimitMs: current.timeLimitMs,
  };
  const outcome = recorded.timedOut ? 'timeout' : correct ? 'correct' : 'wrong';
  const endsAtMs = nextBankEnd(run.endsAtMs, current.shownAtMs + recorded.rtMs, timeBankChange(current.level, outcome, recorded.rtMs));
  return {
    accepted: true,
    trial,
    bankChangeMs: endsAtMs - run.endsAtMs,
    run: {
      ...run,
      staircase: nextStaircaseState(run.staircase, correct),
      answerStreak: correct ? run.answerStreak + 1 : 0,
      trials: [...run.trials, trial],
      current: null,
      nextVariant: 0,
      discarded: null,
      endsAtMs,
    },
  };
}

/**
 * Submits a response to the question on screen, `rtMs` after it appeared. A
 * second submission for the same question, or one quoting an older question,
 * is refused and changes nothing. A response at or after the time limit is
 * recorded as a timeout. One that would end after the run is refused
 * ('run-over'): expiry wins.
 */
export function answerQuestion(
  run: MentalMathRun,
  { questionId, response, rtMs }: { readonly questionId: string; readonly response: number; readonly rtMs: number },
): AnswerResult {
  return resolve(run, questionId, response, rtMs);
}

/**
 * Records a timeout for the question on screen (response null, rtMs = the
 * level's limit). Refused ('run-over') when the limit falls after the run.
 */
export function timeOutQuestion(run: MentalMathRun, { questionId }: { readonly questionId: string }): AnswerResult {
  const limit = run.current?.timeLimitMs ?? 0;
  return resolve(run, questionId, null, limit);
}

/**
 * Discards the question on screen without recording it: on pause,
 * backgrounding, expiry of the run clock or quitting. The level and streaks
 * are unchanged; the next presentation shows a fresh question at the same level.
 */
export function discardQuestion(run: MentalMathRun): MentalMathRun {
  const { current } = run;
  if (current === null) return run;
  return {
    ...run,
    current: null,
    discarded: { operands: current.operands, operators: current.operators, grouped: current.grouped },
  };
}
