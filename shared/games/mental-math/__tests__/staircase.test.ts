import { describe, expect, it } from 'vitest';
import { mentalMathV1 as mm } from '@nfct/shared';
import { correct, pause, play, timeout, wrong } from './helpers';

const C = true;
const W = false;

describe('3-up/1-down staircase replay', () => {
  it('starts at startLevel and moves up after three correct answers in a row', () => {
    expect(mm.replayLevels(4, [C, C, C, C, C, C, C])).toEqual([4, 4, 4, 5, 5, 5, 6]);
  });

  it('moves down one level on any miss and restarts the in-level streak', () => {
    expect(mm.replayLevels(5, [C, C, W, C, C, C, W, W])).toEqual([5, 5, 5, 4, 4, 4, 5, 4]);
  });

  it('restarts the in-level streak on every level change, so streaks never carry over', () => {
    // Two correct at level 5, a miss (to 4), two correct at 4, a miss (to 3): no rise.
    expect(mm.replayLevels(5, [C, C, W, C, C, W, C, C])).toEqual([5, 5, 5, 4, 4, 4, 3, 3]);
    // After rising to 6, only three more correct answers at 6 rise again.
    expect(mm.replayLevels(5, [C, C, C, C, C, C])).toEqual([5, 5, 5, 6, 6, 6]);
  });

  it('holds the level 1 floor: a miss at level 1 stays at level 1 and restarts the streak', () => {
    expect(mm.replayLevels(1, [W, W, C, C, W, C, C, C, C])).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 2]);
    expect(mm.nextStaircaseState({ level: 1, levelStreak: 2 }, false)).toEqual({ level: 1, levelStreak: 0 });
  });

  it('holds the level 10 ceiling: a third correct answer at 10 stays at 10 and restarts the streak', () => {
    expect(mm.replayLevels(9, [C, C, C, C, C, C, C, W])).toEqual([9, 9, 9, 10, 10, 10, 10, 10]);
    expect(mm.nextStaircaseState({ level: 10, levelStreak: 2 }, true)).toEqual({ level: 10, levelStreak: 0 });
    expect(mm.replayLevels(10, [C, C, C, W, C])).toEqual([10, 10, 10, 10, 9]);
  });

  it('refuses a start level outside 1-10', () => {
    for (const startLevel of [0, 11, 2.5]) expect(() => mm.replayLevels(startLevel, [])).toThrow(RangeError);
  });

  it('is what the run reducer follows, and pauses never move it', () => {
    const { run } = play(123, 2, [
      correct(), pause(), correct(), pause(300), pause(900), correct(), // up to 3
      timeout(), // down to 2
      correct(), correct(), pause(), wrong(), // still no rise: the miss restarts the streak
    ]);
    const outcomes = run.trials.map((trial) => trial.correct);

    expect(run.trials.map((trial) => trial.level)).toEqual(mm.replayLevels(2, outcomes));
    expect(run.trials.map((trial) => trial.level)).toEqual([2, 2, 2, 3, 2, 2, 2]);
    expect(run.staircase).toEqual({ level: 1, levelStreak: 0 });
  });
});
