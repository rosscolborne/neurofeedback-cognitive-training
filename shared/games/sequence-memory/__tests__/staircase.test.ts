import { describe, expect, it } from 'vitest';
import { sequenceMemoryV1 as sm } from '@nfct/shared';

describe('Sequence Memory v1 staircase', () => {
  it('is 2-up/1-down over levels 1-10', () => {
    expect(sm.STAIRCASE).toEqual({ minLevel: 1, maxLevel: 10, levelUpStreak: 2 });
    expect(sm.replayLevels(3, [true, true, true, false, false, true])).toEqual([3, 3, 4, 4, 3, 2]);
  });

  it('stays within the bounds', () => {
    expect(sm.replayLevels(10, [true, true, true])).toEqual([10, 10, 10]);
    expect(sm.replayLevels(1, [false, false, true])).toEqual([1, 1, 1]);
  });

  it('takes k as a parameter', () => {
    const threeUp = { ...sm.STAIRCASE, levelUpStreak: 3 };
    expect(sm.replayLevels(1, [true, true, true, true], threeUp)).toEqual([1, 1, 1, 2]);
  });

  it('refuses a start level outside the rule', () => {
    expect(() => sm.initialStaircase(0)).toThrow(RangeError);
    expect(() => sm.initialStaircase(11)).toThrow(RangeError);
  });
});
