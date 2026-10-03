import type { ScoreContext } from '../../definition';
import { trialEndsWithinRun } from '../v1/limits';
import { MODE_ID } from '../v1/params';
import {
  ACTIVE_DURATION_TOLERANCE_MS,
  checkArithmetic,
  checkLevelParameters,
  checkPeakLevel,
  checkResponseTimeFloor,
  checkResponseTimeLimits,
  checkStaircase,
  checkSummary,
  checkTrialFlags,
  reportOf,
  TIMING_TOLERANCE_MS,
  validateTrialsAgainstSeed,
  type CheckableSession,
  type PlausibilityIssue,
  type PlausibilityReport,
  type TimingContext,
} from '../v1/plausibility';
import type { MentalMathTrial } from '../v1/schemas';
import { score } from '../v1/scoring';
import { bankEnds } from './timeBank';

// Mental Math gameVersion 2: plausibility checks. FROZEN with gameVersion 2.
// The same reason codes, outcomes and checks as gameVersion 1, except the
// timing checks, which judge each run by its time bank (timeBank.ts) instead
// of a fixed 90 s:
// - 'run-overrun': a trial ends after the bank's end in force when it was
//   shown, beyond TIMING_TOLERANCE_MS;
// - 'active-duration-mismatch': a completed session's activeDurationMs is not
//   within ACTIVE_DURATION_TOLERANCE_MS of the bank's final end (the run ran
//   out of time), or any session's trials end after its activeDurationMs, or
//   it exceeds the bank's final end.

export {
  ACTIVE_DURATION_TOLERANCE_MS,
  checkArithmetic,
  checkLevelParameters,
  checkPeakLevel,
  checkResponseTimeFloor,
  checkResponseTimeLimits,
  checkStaircase,
  checkSummary,
  checkTrialFlags,
  MAX_FAST_RESPONSE_PERCENT,
  REASON_OUTCOMES,
  reportOf,
  TIMING_TOLERANCE_MS,
  validateTrialsAgainstSeed,
  type CheckableSession,
  type CheckOutcome,
  type MentalMathReason,
  type PlausibilityIssue,
  type PlausibilityReport,
  type SeedValidation,
  type SummaryLike,
  type TimingContext,
} from '../v1/plausibility';

function issue(code: 'run-overrun' | 'active-duration-mismatch' | 'trial-overlap', trialIndex: number | null): PlausibilityIssue {
  return { code, outcome: 'flagged', trialIndex };
}

/**
 * shownAtMs increases with no overlap between trials, each trial ends within
 * the time bank in force when it was shown, and the session's activeDurationMs
 * fits its trials (a completed session's is within tolerance of the bank's
 * final end: a run that ran out of time, as opposed to one the player quit).
 */
export function checkTiming(trials: readonly MentalMathTrial[], { status, activeDurationMs }: TimingContext): PlausibilityIssue[] {
  const issues: PlausibilityIssue[] = [];
  const overlap = trials.findIndex((trial, index) => {
    const previous = trials[index - 1];
    return previous !== undefined && (trial.shownAtMs <= previous.shownAtMs
      || trial.shownAtMs + TIMING_TOLERANCE_MS < previous.shownAtMs + previous.rtMs);
  });
  if (overlap !== -1) issues.push(issue('trial-overlap', overlap));

  const bank = bankEnds(trials);
  const overrun = trials.findIndex((trial, index) =>
    !trialEndsWithinRun(trial.shownAtMs, trial.rtMs, bank.before[index]! + TIMING_TOLERANCE_MS));
  if (overrun !== -1) issues.push(issue('run-overrun', overrun));

  const lastEnd = trials.reduce((end, trial) => Math.max(end, trial.shownAtMs + trial.rtMs), 0);
  const durationMismatch = status === 'completed'
    ? Math.abs(activeDurationMs - bank.final) > ACTIVE_DURATION_TOLERANCE_MS
    : activeDurationMs > bank.final + ACTIVE_DURATION_TOLERANCE_MS;
  if (durationMismatch || lastEnd > activeDurationMs + TIMING_TOLERANCE_MS) {
    issues.push(issue('active-duration-mismatch', null));
  }
  return issues;
}

/**
 * Runs every v2 plausibility check on a session that already passed
 * gameSessionSchemaFor(definition). Pure and deterministic.
 */
export function checkSession(session: CheckableSession): PlausibilityReport {
  const { trials, startLevel } = session;
  if (session.modeId !== MODE_ID) throw new Error(`Mental Math v2 has no mode '${session.modeId}'`);
  const ctx: ScoreContext = { modeId: session.modeId, startLevel };
  return reportOf([
    ...checkArithmetic(trials),
    ...checkTrialFlags(trials),
    ...checkResponseTimeLimits(trials),
    ...checkLevelParameters(trials),
    ...checkStaircase(trials, startLevel),
    ...validateTrialsAgainstSeed(session.seed, trials).issues,
    ...checkResponseTimeFloor(trials),
    ...checkTiming(trials, session),
    ...checkPeakLevel(trials, startLevel, session.peakLevel),
    ...(session.summary ? checkSummary(session.summary, score(trials, ctx)) : []),
  ]);
}
