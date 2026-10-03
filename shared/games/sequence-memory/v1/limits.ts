// Sequence Memory gameVersion 1: how a response is judged, as pure,
// integer-exact rules. FROZEN. This is the only implementation of each rule:
// the run reducer, scoring and the plausibility checks all call these. Tap
// times are integer milliseconds from the start of the response phase.

/** A tap at or after the response limit is too late: the trial has already timed out. */
export function isTapTooLate(tapAtMs: number, responseLimitMs: number): boolean {
  return tapAtMs >= responseLimitMs;
}

export type ResponseVerdict = 'correct' | 'wrong' | 'timeout';

/**
 * Judges a response against its sequence. Only taps strictly before the limit
 * count. The first counted tap that differs from the sequence makes the trial
 * wrong; all `sequence.length` taps matching makes it correct; anything else
 * (the player had not finished when the limit came) is a timeout.
 */
export function judgeResponse(
  sequence: readonly number[],
  response: readonly number[],
  tapAtMs: readonly number[],
  responseLimitMs: number,
): ResponseVerdict {
  for (let index = 0; index < response.length; index += 1) {
    const at = tapAtMs[index];
    if (at === undefined || isTapTooLate(at, responseLimitMs)) return 'timeout';
    if (response[index] !== sequence[index]) return 'wrong';
    if (index + 1 === sequence.length) return 'correct';
  }
  return 'timeout';
}

/** When a trial ends, in active run time: presentation, then the response (rtMs). */
export function trialEndMs(trial: { readonly shownAtMs: number; readonly presentationMs: number; readonly rtMs: number }): number {
  return trial.shownAtMs + trial.presentationMs + trial.rtMs;
}
