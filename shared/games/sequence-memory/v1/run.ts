import { isTapTooLate, judgeResponse, trialEndMs } from './limits';
import { levelParams, TRIALS_PER_RUN } from './params';
import type { SequenceMemoryTrial } from './schemas';
import { SEQUENCE_VARIANTS, sameSequence, sequenceAt, tileCount } from './sequences';
import { initialStaircase, nextStaircaseState, type StaircaseState } from './staircase';

// Sequence Memory gameVersion 1: the pure state of one run, for the game
// screen to drive. It owns the run rules trusted scoring later checks, so the
// client cannot drift from them: which sequence comes next, the staircase, the
// trial-ID guard against stale taps, "a tap at the limit is too late", and the
// fixed run length. It owns no clock, timer, feedback or UI: the caller passes
// integer active-clock readings.
//
// A run is TRIALS_PER_RUN recorded trials; isRunComplete then says so, and no
// further trial may be presented.
//
// Sequence order. The sequence at position p (the number of trials recorded so
// far) is sequenceAt(seed, p, variant, level). A new position starts at
// variant 0. Discarding the trial on screen (pause, backgrounding, quitting)
// keeps the position, and the replacement takes the next variant (wrapping
// after SEQUENCE_VARIANTS). A presentation skips a variant whose sequence
// repeats the one just discarded or the previous trial's, trying every variant
// at most once. Trusted scoring accepts any variant, so none of this needs
// recording. Discarding never changes the level or the streak.

export type PresentedTrial = {
  /** Unique within the run; taps must quote it (a tap meant for an earlier trial changes nothing). */
  readonly id: string;
  readonly position: number;
  readonly variant: number;
  readonly level: number;
  readonly gridSize: number;
  readonly sequence: readonly number[];
  readonly presentationMs: number;
  readonly responseLimitMs: number;
  /** Active run time when the board appeared. */
  readonly shownAtMs: number;
  /** The tiles tapped so far, all matching the sequence. */
  readonly response: readonly number[];
  readonly tapAtMs: readonly number[];
};

export type SequenceMemoryRun = {
  readonly seed: number;
  readonly startLevel: number;
  /** The level of the next trial and the in-level streak. */
  readonly staircase: StaircaseState;
  readonly trials: readonly SequenceMemoryTrial[];
  /** Trials presented so far, discarded ones included. */
  readonly presentedCount: number;
  /** The trial on screen, if any. */
  readonly current: PresentedTrial | null;
  /** The variant the next presentation at this position tries first. */
  readonly nextVariant: number;
  /** The sequence discarded at this position, which its replacement avoids repeating. */
  readonly discarded: readonly number[] | null;
};

export type TapResult =
  /** The tap matched and the sequence is not finished: the trial stays on screen. */
  | { readonly accepted: true; readonly run: SequenceMemoryRun; readonly trial: null }
  /** The tap finished the trial (all correct, or the first wrong tile), or came too late (a timeout). */
  | { readonly accepted: true; readonly run: SequenceMemoryRun; readonly trial: SequenceMemoryTrial }
  /** Nothing changed. 'no-trial': none is on screen. 'stale-trial': the tap quotes another trial. */
  | { readonly accepted: false; readonly run: SequenceMemoryRun; readonly reason: 'no-trial' | 'stale-trial' };

export function startRun({ seed, startLevel }: { readonly seed: number; readonly startLevel: number }): SequenceMemoryRun {
  sequenceAt(seed, 0, 0, startLevel); // validates the seed and the start level
  return {
    seed,
    startLevel,
    staircase: initialStaircase(startLevel),
    trials: [],
    presentedCount: 0,
    current: null,
    nextVariant: 0,
    discarded: null,
  };
}

/** Whether the run has all its trials; the caller then ends it as completed. */
export function isRunComplete(run: SequenceMemoryRun): boolean {
  return run.trials.length >= TRIALS_PER_RUN;
}

/** The highest level shown in a recorded trial, or the start level before any trial. */
export function runPeakLevel(run: SequenceMemoryRun): number {
  return run.trials.reduce((peak, trial) => Math.max(peak, trial.level), run.startLevel);
}

/** Active run time at the end of the last recorded trial (0 before any): where the next trial starts. */
export function recordedActiveMs(run: SequenceMemoryRun): number {
  const last = run.trials[run.trials.length - 1];
  return last === undefined ? 0 : trialEndMs(last);
}

/** Presents the next trial at active time `shownAtMs`. Throws if a trial is on screen or the run is complete. */
export function presentTrial(run: SequenceMemoryRun, shownAtMs: number): SequenceMemoryRun {
  if (run.current !== null) throw new Error('A trial is already on screen; finish, time out or discard it first');
  if (isRunComplete(run)) throw new Error(`A run has ${TRIALS_PER_RUN} trials`);
  if (!Number.isInteger(shownAtMs) || shownAtMs < recordedActiveMs(run)) {
    throw new RangeError(`shownAtMs must be an integer at or after the previous trial's end, got ${shownAtMs}`);
  }
  const position = run.trials.length;
  const level = run.staircase.level;
  const last = run.trials[run.trials.length - 1];
  const avoid = [run.discarded, last?.sequence ?? null].filter((sequence): sequence is readonly number[] => sequence !== null);
  let variant = run.nextVariant;
  let sequence = sequenceAt(run.seed, position, variant, level);
  for (let tried = 1; tried < SEQUENCE_VARIANTS && avoid.some((other) => sameSequence(other, sequence)); tried += 1) {
    variant = (run.nextVariant + tried) % SEQUENCE_VARIANTS;
    sequence = sequenceAt(run.seed, position, variant, level);
  }
  if (avoid.some((other) => sameSequence(other, sequence))) {
    variant = run.nextVariant;
    sequence = sequenceAt(run.seed, position, variant, level);
  }
  const params = levelParams(level);
  const presentedCount = run.presentedCount + 1;
  return {
    ...run,
    presentedCount,
    current: {
      id: `t${presentedCount}`,
      position,
      variant,
      level,
      gridSize: params.gridSize,
      sequence,
      presentationMs: params.presentationMs,
      responseLimitMs: params.responseLimitMs,
      shownAtMs,
      response: [],
      tapAtMs: [],
    },
    nextVariant: (variant + 1) % SEQUENCE_VARIANTS,
  };
}

function record(run: SequenceMemoryRun, current: PresentedTrial, response: readonly number[], tapAtMs: readonly number[]): TapResult {
  const verdict = judgeResponse(current.sequence, response, tapAtMs, current.responseLimitMs);
  const correct = verdict === 'correct';
  const trial: SequenceMemoryTrial = {
    level: current.level,
    gridSize: current.gridSize,
    sequence: [...current.sequence],
    response: [...response],
    tapAtMs: [...tapAtMs],
    correct,
    timedOut: verdict === 'timeout',
    shownAtMs: current.shownAtMs,
    presentationMs: current.presentationMs,
    responseLimitMs: current.responseLimitMs,
    rtMs: verdict === 'timeout' ? current.responseLimitMs : tapAtMs[tapAtMs.length - 1]!,
  };
  return {
    accepted: true,
    trial,
    run: {
      ...run,
      staircase: nextStaircaseState(run.staircase, correct),
      trials: [...run.trials, trial],
      current: null,
      nextVariant: 0,
      discarded: null,
    },
  };
}

function check(run: SequenceMemoryRun, trialId: string): { readonly current: PresentedTrial } | Extract<TapResult, { accepted: false }> {
  const { current } = run;
  if (current === null) return { accepted: false, run, reason: 'no-trial' };
  if (current.id !== trialId) return { accepted: false, run, reason: 'stale-trial' };
  return { current };
}

/**
 * Records a tap on `tile`, `atMs` after the response phase began. A matching
 * tap that does not finish the sequence keeps the trial on screen. A wrong
 * tile ends it as wrong, the last matching tile as correct. A tap at or after
 * the limit is not recorded: the trial times out with the taps before it.
 */
export function tapTile(
  run: SequenceMemoryRun,
  { trialId, tile, atMs }: { readonly trialId: string; readonly tile: number; readonly atMs: number },
): TapResult {
  const checked = check(run, trialId);
  if (!('current' in checked)) return checked;
  const { current } = checked;
  const previous = current.tapAtMs[current.tapAtMs.length - 1] ?? 0;
  if (!Number.isInteger(atMs) || atMs < previous) {
    throw new RangeError(`atMs must be an integer at or after the previous tap (${previous}), got ${atMs}`);
  }
  if (!Number.isInteger(tile) || tile < 0 || tile >= tileCount(current.gridSize)) {
    throw new RangeError(`tile must be 0-${tileCount(current.gridSize) - 1}, got ${tile}`);
  }
  if (isTapTooLate(atMs, current.responseLimitMs)) return record(run, current, current.response, current.tapAtMs);
  const response = [...current.response, tile];
  const tapAtMs = [...current.tapAtMs, atMs];
  const finished = tile !== current.sequence[current.response.length] || response.length === current.sequence.length;
  if (finished) return record(run, current, response, tapAtMs);
  return { accepted: true, trial: null, run: { ...run, current: { ...current, response, tapAtMs } } };
}

/** Records a timeout for the trial on screen, with the taps made so far (rtMs = the response limit). */
export function timeOutTrial(run: SequenceMemoryRun, { trialId }: { readonly trialId: string }): TapResult {
  const checked = check(run, trialId);
  if (!('current' in checked)) return checked;
  return record(run, checked.current, checked.current.response, checked.current.tapAtMs);
}

/**
 * Discards the trial on screen without recording it: on pause, backgrounding
 * or quitting, during presentation or response. The level and streak are
 * unchanged; the next presentation shows a fresh sequence at the same level.
 */
export function discardTrial(run: SequenceMemoryRun): SequenceMemoryRun {
  const { current } = run;
  if (current === null) return run;
  return { ...run, current: null, discarded: current.sequence };
}
