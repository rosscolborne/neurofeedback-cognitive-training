import type { ResponseTimeSummary, ScoreContext, ScoredResult } from '../../definition';
import { judgeResponse } from './limits';
import { levelParams, MAX_LEVEL, MIN_LEVEL, MODE_ID } from './params';
import type { SequenceMemoryMetrics, SequenceMemoryTrial } from './schemas';

// Sequence Memory scoringVersion 1 (constants provisional until simulation and
// playtesting; before the first external beta they may be tuned at version 1).
// Changing a constant or rule here after launch bumps scoringVersion: add a new
// scoring function beside this one rather than editing it.
//
// A correct trial at level L scores B(L) = 10 × (L + 1): 20 at level 1, 110 at
// level 10. Wrong and timed-out trials score 0. There is no speed bonus, no
// streak multiplier and no EEG input.

/** B(L) = 10 × (L + 1). */
export function pointsFor(level: number): number {
  if (!Number.isInteger(level) || level < MIN_LEVEL || level > MAX_LEVEL) {
    throw new RangeError(`Sequence Memory v1 has levels ${MIN_LEVEL}-${MAX_LEVEL}, got ${level}`);
  }
  return 10 * (level + 1);
}

/**
 * How trusted scoring judges a trial. It never trusts the client's `correct`,
 * `timedOut` or `responseLimitMs`: the response is judged against the trial's
 * sequence with the level's own limit. For a trial that passes the
 * consistency checks this agrees with the trial's flags.
 */
export function trustedVerdict(trial: SequenceMemoryTrial) {
  return judgeResponse(trial.sequence, trial.response, trial.tapAtMs, levelParams(trial.level).responseLimitMs);
}

export function isCorrectTrial(trial: SequenceMemoryTrial): boolean {
  return trustedVerdict(trial) === 'correct';
}

export function isTimeoutTrial(trial: SequenceMemoryTrial): boolean {
  return trustedVerdict(trial) === 'timeout';
}

/**
 * Response times over every trial, timeouts included at their limit. The
 * median of an even count is the mean of the two middle values; p90 is the
 * nearest rank, the ceil(0.9 × n)-th smallest; the mean is the plain sum
 * divided by n. Null when there are no trials.
 */
export function responseTimeSummary(trials: readonly SequenceMemoryTrial[]): ResponseTimeSummary | null {
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
export function score(trials: readonly SequenceMemoryTrial[], ctx: ScoreContext): ScoredResult<SequenceMemoryMetrics> {
  if (ctx.modeId !== MODE_ID) throw new Error(`Sequence Memory v1 has no mode '${ctx.modeId}'`);
  pointsFor(ctx.startLevel); // validates the start level

  let points = 0;
  let correct = 0;
  let timedOut = 0;
  let longestSpan = 0;
  let peakLevel = trials.length > 0 ? 0 : ctx.startLevel;
  for (const trial of trials) {
    peakLevel = Math.max(peakLevel, trial.level);
    const verdict = trustedVerdict(trial);
    if (verdict === 'timeout') timedOut += 1;
    if (verdict === 'correct') {
      correct += 1;
      points += pointsFor(trial.level);
      longestSpan = Math.max(longestSpan, levelParams(trial.level).span);
    }
  }

  const last = trials[trials.length - 1];
  return {
    score: points,
    accuracy: trials.length === 0 ? null : correct / trials.length,
    responseTime: responseTimeSummary(trials),
    peakLevel,
    metrics: {
      correct,
      attempted: trials.length,
      timedOut,
      finalLevel: last ? last.level : ctx.startLevel,
      longestSpan,
    },
  };
}
