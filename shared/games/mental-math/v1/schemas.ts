import { z } from 'zod';
import { MAX_LEVEL, MAX_RESPONSE, MAX_TRIALS, MIN_LEVEL, OPERATORS } from './params';

// Mental Math gameVersion 1: the trial and metrics schemas. FROZEN: a material
// change to the trial shape or its meaning is a new gameVersion.
//
// The schemas check shape and bounds. Whether a trial is consistent (its
// arithmetic, its flags, its timing, its level) is decided by the
// plausibility checks, which report stable reason codes instead of failing
// the whole document.

/**
 * Generous sanity bounds; each level's own ranges are checked by plausibility.
 * Literals, not shared constants, so a shared change cannot alter v1.
 */
const MAX_OPERAND = 9_999;
const MAX_EXPECTED = 999_999;
const MAX_TIME_LIMIT_MS = 60_000;
/** The longest active run time any trial may start at (the shared session maximum when v1 was frozen). */
const MAX_SHOWN_AT_MS = 3_600_000;

export const operatorSchema = z.enum(OPERATORS);

/**
 * One presented question that the player answered or let time out. Questions
 * discarded on pause or at expiry are never trials. All times are integer
 * milliseconds of active run time.
 */
export const trialSchema = z.strictObject({
  /** The level the question was shown at. */
  level: z.int().min(MIN_LEVEL).max(MAX_LEVEL),
  /** 2 or 3 positive integers. */
  operands: z.array(z.int().min(1).max(MAX_OPERAND)).min(2).max(3),
  /** One fewer than the operands. */
  operators: z.array(operatorSchema).min(1).max(2),
  /** true: (a op b) op c; false: standard precedence. Always false for two operands. */
  grouped: z.boolean(),
  /** The correct answer, a positive integer. */
  expected: z.int().min(1).max(MAX_EXPECTED),
  /** What the player submitted on the digit keypad, or null on a timeout. */
  response: z.int().min(0).max(MAX_RESPONSE).nullable(),
  /** response === expected. */
  correct: z.boolean(),
  /** response === null. */
  timedOut: z.boolean(),
  /** Active run time when the question appeared (pauses and feedback excluded). */
  shownAtMs: z.int().min(0).max(MAX_SHOWN_AT_MS),
  /** From presentation until Submit; equal to timeLimitMs on a timeout. */
  rtMs: z.int().min(0).max(MAX_TIME_LIMIT_MS),
  /** The level's per-question limit. */
  timeLimitMs: z.int().min(1).max(MAX_TIME_LIMIT_MS),
}).superRefine((trial, ctx) => {
  if (trial.operators.length !== trial.operands.length - 1) {
    ctx.addIssue({ code: 'custom', path: ['operators'], message: 'needs one operator fewer than the operands' });
  }
  if (trial.grouped && trial.operands.length === 2) {
    ctx.addIssue({ code: 'custom', path: ['grouped'], message: 'a two-operand question cannot be grouped' });
  }
});
export type MentalMathTrial = z.infer<typeof trialSchema>;

const MAX_POINTS_PER_TRIAL = 25 * (MAX_LEVEL + 1);
const countSchema = z.int().min(0).max(MAX_TRIALS);

/**
 * What trusted scoring derives from the trials, stored in result.metrics. The
 * client's summary.metrics is a display copy validated by the same schema, so
 * it checks types and bounds only: cross-field consistency is a plausibility
 * matter (summary-mismatch) and never makes the raw trials unwritable.
 */
export const metricsSchema = z.strictObject({
  /** Trials answered correctly. */
  correct: countSchema,
  /** Trials answered or timed out; discarded questions are not trials. */
  attempted: countSchema,
  /** Trials that timed out (or were answered at or after the deadline). */
  timedOut: countSchema,
  /** The longest run of consecutive correct trials, across level changes. Display only. */
  longestStreak: countSchema,
  /** The level of the last trial; the start level when there are no trials. */
  finalLevel: z.int().min(MIN_LEVEL).max(MAX_LEVEL),
  /** The base points of the correct trials. */
  difficultyPoints: z.int().min(0).max(MAX_TRIALS * MAX_POINTS_PER_TRIAL),
  /** Their speed bonuses. difficultyPoints + speedBonusPoints == score. */
  speedBonusPoints: z.int().min(0).max(MAX_TRIALS * MAX_POINTS_PER_TRIAL),
});
export type MentalMathMetrics = z.infer<typeof metricsSchema>;
