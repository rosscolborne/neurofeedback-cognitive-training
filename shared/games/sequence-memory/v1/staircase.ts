import { LEVEL_UP_STREAK, MAX_LEVEL, MIN_LEVEL } from './params';

// Sequence Memory gameVersion 1: the pure k-up/1-down staircase. FROZEN, with
// v1's rule (k = LEVEL_UP_STREAK, levels 1-10); the rule is a parameter so the
// simulation can compare alternatives.
//
// - The first trial is at startLevel.
// - A correct trial adds one to the in-level streak. The k-th correct trial
//   in a row at the current level moves up one level and restarts the streak.
// - A wrong trial or a timeout moves down one level and restarts the streak.
// - Levels stay within the rule's bounds: at the top, the k-th correct trial
//   keeps the level and restarts the streak; at the bottom, a miss keeps it.
// - Only recorded trials move the staircase. A trial discarded by a pause,
//   backgrounding or quitting changes neither the level nor the streak, so
//   trusted scoring can replay the levels from the trials alone.

export type StaircaseRule = {
  readonly minLevel: number;
  readonly maxLevel: number;
  /** k: correct trials in a row at a level that move up one level. */
  readonly levelUpStreak: number;
};

export const STAIRCASE: StaircaseRule = Object.freeze({ minLevel: MIN_LEVEL, maxLevel: MAX_LEVEL, levelUpStreak: LEVEL_UP_STREAK });

export type StaircaseState = {
  /** The level the next trial is shown at. */
  readonly level: number;
  /** Correct trials in a row at `level`: 0 to levelUpStreak - 1. */
  readonly levelStreak: number;
};

export function initialStaircase(startLevel: number, rule: StaircaseRule = STAIRCASE): StaircaseState {
  if (!Number.isInteger(startLevel) || startLevel < rule.minLevel || startLevel > rule.maxLevel) {
    throw new RangeError(`startLevel must be ${rule.minLevel}-${rule.maxLevel}, got ${startLevel}`);
  }
  return { level: startLevel, levelStreak: 0 };
}

/** The staircase after one recorded trial. `correct` is false for a wrong trial or a timeout. */
export function nextStaircaseState(state: StaircaseState, correct: boolean, rule: StaircaseRule = STAIRCASE): StaircaseState {
  if (!correct) return { level: Math.max(rule.minLevel, state.level - 1), levelStreak: 0 };
  const levelStreak = state.levelStreak + 1;
  if (levelStreak < rule.levelUpStreak) return { level: state.level, levelStreak };
  return { level: Math.min(rule.maxLevel, state.level + 1), levelStreak: 0 };
}

/** The level each trial must be shown at, given each trial's outcome in order. */
export function replayLevels(startLevel: number, outcomes: readonly boolean[], rule: StaircaseRule = STAIRCASE): number[] {
  const levels: number[] = [];
  let state = initialStaircase(startLevel, rule);
  for (const correct of outcomes) {
    levels.push(state.level);
    state = nextStaircaseState(state, correct, rule);
  }
  return levels;
}
