import { levelParams } from './params';
import type { MentalMathTrial } from './schemas';
import { isCorrectTrial, isTimeoutTrial } from './scoring';

// Mental Math gameVersion 1: the time bank (NFCT-60). Pure and integer-exact.
//
// A run no longer lasts a fixed 90 s. It starts with a small bank of active
// time that drains while a question is on screen, and each recorded trial
// adjusts it when the trial ends:
//
// - a correct answer in under a third of the level's per-question limit: +3 s;
// - a correct answer in under two thirds of the limit: +2 s;
// - a slower correct answer: nothing;
// - a wrong answer: -5 s (more than a lucky guess earns, so guessing fast
//   drains the bank);
// - a timeout: nothing more (the limit already drained from the bank).
//
// Speed is judged against the level's own limit, so a fast answer earns the
// same time at every level. Two bounds keep the bonus meaningful but finite:
//
// - the bank never holds more than BANK_CAP_MS (no stockpiling), and
// - the run never lasts more than MAX_RUN_MS of active time in total: near
//   that point gains are clipped, so every run ends.
//
// The run ends when the bank is empty: the bank's end, `endsAtMs`, is the
// active time at which it runs out. A trial must end at or before the end in
// force when it was shown; a wrong answer can empty the bank, and then the
// run ends as the trial ends.
//
// Starting-level fairness: every run starts with the same bank whatever its
// start level, and time is earned only by answering quickly for the level, so
// a higher start level never brings more time. Starting low is not a
// handicap either: the early levels are quick to answer, so a player who
// outclasses them banks time while the staircase climbs (3 correct answers per
// level), and reaches their own level with more time than a run started there.
// Scoring is unchanged (points per correct answer weighted by level, plus a
// speed bonus): the time bank alone removes the fresh-timer advantage, and the
// simulation tests check that a higher start level gives no longer runs and no
// meaningfully higher scores than starting at level 1.
//
// Everything here is replayed from the trials alone, so trusted scoring checks
// a run's length exactly (plausibility.ts) and the client cannot drift.

/** The bank every run starts with, whatever its start level. */
export const START_BANK_MS = 45_000;
/** The most the bank can hold. */
export const BANK_CAP_MS = 60_000;
/** The longest a run can last, in active time. */
export const MAX_RUN_MS = 180_000;
/** Earned by a correct answer in under a third of the level's limit. */
export const FAST_GAIN_MS = 3_000;
/** Earned by a correct answer in under two thirds of the level's limit. */
export const STEADY_GAIN_MS = 2_000;
/** Lost on a wrong answer. */
export const WRONG_PENALTY_MS = 5_000;

/** What one trial does to the bank, before the cap and the run limit apply. */
export type TimeBankOutcome = 'correct' | 'wrong' | 'timeout';

/** The bank change a trial earns, in ms: positive for a gain, negative for the penalty. */
export function timeBankChange(level: number, outcome: TimeBankOutcome, rtMs: number): number {
  if (outcome === 'wrong') return -WRONG_PENALTY_MS;
  if (outcome === 'timeout') return 0;
  const limit = levelParams(level).timeLimitMs;
  if (3 * rtMs < limit) return FAST_GAIN_MS;
  if (3 * rtMs < 2 * limit) return STEADY_GAIN_MS;
  return 0;
}

/**
 * The bank's end after a trial that ended at `trialEndMs`: the time left
 * (endsAtMs - trialEndMs) changes by `changeMs`, then is held within
 * 0..BANK_CAP_MS, and the end never passes MAX_RUN_MS.
 */
export function nextBankEnd(endsAtMs: number, trialEndMs: number, changeMs: number): number {
  const left = Math.min(BANK_CAP_MS, Math.max(0, endsAtMs - trialEndMs + changeMs));
  return Math.min(MAX_RUN_MS, trialEndMs + left);
}

/** The trusted outcome of a recorded trial (correctness is never taken from the client). */
export function timeBankOutcomeOf(trial: MentalMathTrial): TimeBankOutcome {
  if (isTimeoutTrial(trial)) return 'timeout';
  return isCorrectTrial(trial) ? 'correct' : 'wrong';
}

/**
 * The bank's end before each trial (the end each trial had to fit within)
 * and after the last one (when the run itself ends), replayed from the trials.
 */
export function bankEnds(trials: readonly MentalMathTrial[]): { readonly before: number[]; readonly final: number } {
  const before: number[] = [];
  let endsAtMs = START_BANK_MS;
  for (const trial of trials) {
    before.push(endsAtMs);
    const change = timeBankChange(trial.level, timeBankOutcomeOf(trial), trial.rtMs);
    endsAtMs = nextBankEnd(endsAtMs, trial.shownAtMs + trial.rtMs, change);
  }
  return { before, final: endsAtMs };
}
