import type { ResponseTimeSummary, ScoreContext, ScoredResult } from '../../definition';
import { MAX_LEVEL, MIN_LEVEL, MODE_ID, timeLimitFor } from './params';
import { evaluate } from './questions';
import type { MentalMathMetrics, MentalMathTrial } from './schemas';

// Mental Math scoringVersion 1 (constants provisional until simulation and
// playtesting; before the first external beta they may be tuned at version 1).
// Changing a constant or rule here after launch bumps scoringVersion: add a
// new scoring function beside this one rather than editing it, so stored
// results can still be audited against the version that produced them.
//
// A correct trial at level L with response time rt scores
//
//   B(L) + round(0.5 × B(L) × max(0, 1 - rt / T(L))),   B(L) = 25 × (L + 1)
//
// where T(L) is the level's time limit. Wrong and timed-out trials score 0.
// There is no streak multiplier and no EEG input.
//
// Rounding: the bonus is computed in integers as B × (T - rt) / (2T) and
// rounded half up (an exact .5 goes up), which is Math.round for these
// non-negative values without floating-point error. For example level 2 at
// rt = 0: 0.5 × 75 = 37.5, so the bonus is 38.

/** B(L) = 25 × (L + 1): 50 at level 1, 275 at level 10. */
export function basePoints(level: number): number {
  if (!Number.isInteger(level) || level < MIN_LEVEL || level > MAX_LEVEL) {
    throw new RangeError(`Mental Math v1 has levels ${MIN_LEVEL}-${MAX_LEVEL}, got ${level}`);
  }
  return 25 * (level + 1);
}

/** round(x / y) for non-negative integers, halves rounded up, in exact integer arithmetic. */
function roundHalfUp(numerator: number, denominator: number): number {
  const doubled = 2 * numerator + denominator;
  const divisor = 2 * denominator;
  return (doubled - (doubled % divisor)) / divisor;
}

/** The speed bonus of a correct answer: 0 at or after the time limit, up to round(B / 2) at rt = 0. */
export function speedBonus(level: number, rtMs: number): number {
  const base = basePoints(level);
  const limit = timeLimitFor(level);
  if (!Number.isInteger(rtMs) || rtMs < 0) throw new RangeError(`rtMs must be a non-negative integer, got ${rtMs}`);
  if (rtMs >= limit) return 0;
  return roundHalfUp(base * (limit - rtMs), 2 * limit);
}

/** The points of one correct answer: base points plus the speed bonus. */
export function pointsFor(level: number, rtMs: number): number {
  return basePoints(level) + speedBonus(level, rtMs);
}

/**
 * Whether trusted scoring counts the trial as correct. It never trusts the
 * client's `correct`, `expected` or `timeLimitMs`: the response must be
 * submitted before the level's time limit (an answer at the deadline is a
 * timeout) and equal the operands evaluated with their operators. For a trial
 * that passes the consistency checks this equals `trial.correct`.
 */
export function isCorrectTrial(trial: MentalMathTrial): boolean {
  return trial.response !== null
    && trial.rtMs < timeLimitFor(trial.level)
    && trial.response === evaluate(trial);
}

/** Whether trusted scoring counts the trial as a timeout: no response, or one at or after the deadline. */
export function isTimeoutTrial(trial: MentalMathTrial): boolean {
  return trial.response === null || trial.rtMs >= timeLimitFor(trial.level);
}

/**
 * Response times over every trial, timeouts included at their limit (rtMs is
 * defined for every trial). The median of an even count is the mean of the
 * two middle values; p90 is the nearest rank, the ceil(0.9 × n)-th smallest;
 * the mean is the plain sum divided by n. Null when there are no trials.
 */
export function responseTimeSummary(trials: readonly MentalMathTrial[]): ResponseTimeSummary | null {
  const n = trials.length;
  if (n === 0) return null;
  const sorted = trials.map((trial) => trial.rtMs).sort((a, b) => a - b);
  const middle = Math.floor(n / 2);
  const medianMs = n % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  const p90Rank = Math.floor((9 * n + 9) / 10); // ceil(9n / 10) in integers
  const meanMs = sorted.reduce((sum, rt) => sum + rt, 0) / n;
  return { medianMs, meanMs, p90Ms: sorted[p90Rank - 1]! };
}

/**
 * Trusted scoring: pure and deterministic, from the trials and the context
 * only. The trusted peak level is the highest trial level (the start level
 * when there are no trials); the session's own `peakLevel` is never read.
 * Levels are taken from the trials as recorded: whether they follow the
 * staircase is a plausibility check.
 *
 * Callers must first validate the session with gameSessionSchemaFor(definition).
 */
export function score(trials: readonly MentalMathTrial[], ctx: ScoreContext): ScoredResult<MentalMathMetrics> {
  if (ctx.modeId !== MODE_ID) throw new Error(`Mental Math v1 has no mode '${ctx.modeId}'`);
  basePoints(ctx.startLevel); // validates the start level

  let correct = 0;
  let timedOut = 0;
  let streak = 0;
  let longestStreak = 0;
  let difficultyPoints = 0;
  let speedBonusPoints = 0;
  let peakLevel = trials.length > 0 ? 0 : ctx.startLevel;
  for (const trial of trials) {
    peakLevel = Math.max(peakLevel, trial.level);
    if (isTimeoutTrial(trial)) timedOut += 1;
    if (isCorrectTrial(trial)) {
      correct += 1;
      streak += 1;
      longestStreak = Math.max(longestStreak, streak);
      difficultyPoints += basePoints(trial.level);
      speedBonusPoints += speedBonus(trial.level, trial.rtMs);
    } else {
      streak = 0;
    }
  }

  const last = trials[trials.length - 1];
  return {
    score: difficultyPoints + speedBonusPoints,
    accuracy: trials.length === 0 ? null : correct / trials.length,
    responseTime: responseTimeSummary(trials),
    peakLevel,
    metrics: {
      correct,
      attempted: trials.length,
      timedOut,
      longestStreak,
      finalLevel: last ? last.level : ctx.startLevel,
      difficultyPoints,
      speedBonusPoints,
    },
  };
}
