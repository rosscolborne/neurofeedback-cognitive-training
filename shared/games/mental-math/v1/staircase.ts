import { LEVEL_UP_STREAK, MAX_LEVEL, MIN_LEVEL } from './params';

// Mental Math gameVersion 1: the pure 3-up/1-down staircase. FROZEN.
//
// - The first trial is at startLevel.
// - A correct answer adds one to the in-level streak. The third correct answer
//   in a row at the current level moves up one level and restarts the streak.
// - Any wrong answer or timeout moves down one level and restarts the streak.
// - Levels stay within 1-10:
//   - at level 10, a third correct answer in a row keeps level 10 and restarts
//     the in-level streak (this is invisible in the level sequence);
//   - at level 1, a miss keeps level 1 and restarts the streak.
// - The in-level streak restarts on every level change.
// - Only recorded trials move the staircase. A question discarded by a pause,
//   at expiry or on quitting changes neither the level nor any streak, so
//   trusted scoring can replay the levels from the trials alone.

export type StaircaseState = {
  /** The level the next question is shown at. */
  readonly level: number;
  /** Correct answers in a row at `level`: 0 to LEVEL_UP_STREAK - 1. */
  readonly levelStreak: number;
};

export function initialStaircase(startLevel: number): StaircaseState {
  if (!Number.isInteger(startLevel) || startLevel < MIN_LEVEL || startLevel > MAX_LEVEL) {
    throw new RangeError(`startLevel must be ${MIN_LEVEL}-${MAX_LEVEL}, got ${startLevel}`);
  }
  return { level: startLevel, levelStreak: 0 };
}

/** The staircase after one recorded trial. `correct` is false for a wrong answer or a timeout. */
export function nextStaircaseState(state: StaircaseState, correct: boolean): StaircaseState {
  if (!correct) return { level: Math.max(MIN_LEVEL, state.level - 1), levelStreak: 0 };
  const levelStreak = state.levelStreak + 1;
  if (levelStreak < LEVEL_UP_STREAK) return { level: state.level, levelStreak };
  return { level: Math.min(MAX_LEVEL, state.level + 1), levelStreak: 0 };
}

/** The level each trial must be shown at, given each trial's outcome in order. */
export function replayLevels(startLevel: number, outcomes: readonly boolean[]): number[] {
  const levels: number[] = [];
  let state = initialStaircase(startLevel);
  for (const correct of outcomes) {
    levels.push(state.level);
    state = nextStaircaseState(state, correct);
  }
  return levels;
}
