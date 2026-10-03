import { RUN_DURATION_MS } from './params';

// Mental Math gameVersion 1: the per-question deadline and run-end rules, as
// pure, integer-exact predicates. FROZEN. This is the only implementation of
// each rule: the run reducer, scoring and the plausibility checks all call
// these. All times are integer milliseconds of active run time.

/**
 * The per-question deadline: a response at or after the time limit counts as
 * a timeout. An answer must be submitted strictly before `timeLimitMs`.
 */
export function isAnswerTimedOut(rtMs: number, timeLimitMs: number): boolean {
  return rtMs >= timeLimitMs;
}

/** What a trial records for a submission (null for no submission). */
export type RecordedTiming = {
  /** The response, or null on a timeout. */
  readonly response: number | null;
  readonly timedOut: boolean;
  /** rtMs as submitted, or exactly timeLimitMs on a timeout. */
  readonly rtMs: number;
};

/**
 * Applies the deadline rule to a submission: no response, or one at or after
 * the limit, is recorded as a timeout with response null and rtMs equal to
 * the limit; otherwise the response and rtMs are kept.
 */
export function recordedTiming(response: number | null, rtMs: number, timeLimitMs: number): RecordedTiming {
  return response === null || isAnswerTimedOut(rtMs, timeLimitMs)
    ? { response: null, timedOut: true, rtMs: timeLimitMs }
    : { response, timedOut: false, rtMs };
}

/**
 * The run-end rule, judged on the recorded rtMs: a trial must end
 * (shownAtMs + rtMs) at or before the end of the run. A trial may end exactly
 * at `runDurationMs`.
 */
export function trialEndsWithinRun(shownAtMs: number, rtMs: number, runDurationMs: number = RUN_DURATION_MS): boolean {
  return shownAtMs + rtMs <= runDurationMs;
}

/** Whether a question may be presented at `shownAtMs`: strictly before the end of the run. */
export function canPresentAt(shownAtMs: number, runDurationMs: number = RUN_DURATION_MS): boolean {
  return shownAtMs < runDurationMs;
}
