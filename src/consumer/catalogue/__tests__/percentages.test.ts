import { describe, expect, it } from 'vitest';
import { largestRemainderPercentages } from '../percentages';

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

describe('largestRemainderPercentages', () => {
  it('keeps exact percentages as they are', () => {
    expect(largestRemainderPercentages([0.7, 0.2, 0.1])).toEqual([70, 20, 10]);
    expect(largestRemainderPercentages([1])).toEqual([100]);
    expect(largestRemainderPercentages([0.25, 0.25, 0.5])).toEqual([25, 25, 50]);
  });

  it('is not tipped by float noise', () => {
    // 0.29 * 100 is 28.999999999999996 in floating point.
    expect(largestRemainderPercentages([0.29, 0.71])).toEqual([29, 71]);
    expect(largestRemainderPercentages([0.57, 0.43])).toEqual([57, 43]);
  });

  it('gives leftover points to the largest remainders, so the result sums to 100', () => {
    // 41.6, 41.4, 17: the floors leave 1 point, for the .6.
    expect(largestRemainderPercentages([0.416, 0.414, 0.17])).toEqual([42, 41, 17]);
    // 34.6, 32.7, 32.7: the floors leave 2 points, for the two .7s, not the largest share.
    expect(largestRemainderPercentages([0.346, 0.327, 0.327])).toEqual([34, 33, 33]);
  });

  it('breaks equal remainders in favour of the earlier share', () => {
    expect(largestRemainderPercentages([1, 1, 1])).toEqual([34, 33, 33]);
    expect(largestRemainderPercentages([1, 1, 1, 1, 1, 1])).toEqual([17, 17, 17, 17, 16, 16]);
  });

  it('normalises shares that do not sum to 1', () => {
    expect(largestRemainderPercentages([3, 1])).toEqual([75, 25]);
    expect(largestRemainderPercentages([2, 0, 2])).toEqual([50, 0, 50]);
  });

  it('can round a tiny share down to 0', () => {
    expect(largestRemainderPercentages([0.996, 0.004])).toEqual([100, 0]);
  });

  it('always sums to 100 and stays within 1 of the exact percentage', () => {
    let state = 12345;
    const next = () => { state = (state * 1103515245 + 12345) % 2 ** 31; return state / 2 ** 31; };
    for (let run = 0; run < 500; run += 1) {
      const shares = Array.from({ length: 1 + Math.floor(next() * 6) }, () => Math.round(next() * 1000) / 1000);
      if (sum(shares) === 0) continue;
      const percentages = largestRemainderPercentages(shares);
      expect(sum(percentages)).toBe(100);
      percentages.forEach((percentage, index) => {
        expect(Number.isInteger(percentage)).toBe(true);
        expect(Math.abs(percentage - (shares[index]! / sum(shares)) * 100)).toBeLessThan(1);
      });
    }
  });

  it('returns zeros when there is nothing to share, and refuses invalid shares', () => {
    expect(largestRemainderPercentages([])).toEqual([]);
    expect(largestRemainderPercentages([0, 0])).toEqual([0, 0]);
    expect(() => largestRemainderPercentages([0.5, -0.1])).toThrow(RangeError);
    expect(() => largestRemainderPercentages([Number.NaN])).toThrow(RangeError);
    expect(() => largestRemainderPercentages([Number.POSITIVE_INFINITY])).toThrow(RangeError);
  });
});
