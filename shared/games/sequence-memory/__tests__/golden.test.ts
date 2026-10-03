import { describe, expect, it } from 'vitest';
import { sequenceMemoryV1 as sm } from '@nfct/shared';

// Pins Sequence Memory gameVersion 1. A change here changes which sequences a
// stored session's seed produces, or how it is judged: before launch only as a
// deliberate tuning at version 1; after launch, a new gameVersion module.

describe('Sequence Memory v1 golden values', () => {
  it('pins the level table', () => {
    expect(sm.LEVELS.map(({ level, span, gridSize, presentationMs, responseLimitMs }) => [level, span, gridSize, presentationMs, responseLimitMs]))
      .toEqual([
        [1, 2, 3, 2_600, 4_000],
        [2, 3, 3, 3_600, 5_000],
        [3, 4, 3, 4_600, 6_000],
        [4, 4, 4, 4_000, 6_000],
        [5, 5, 4, 4_850, 7_000],
        [6, 6, 4, 5_700, 8_000],
        [7, 6, 5, 4_800, 8_000],
        [8, 7, 5, 5_500, 9_000],
        [9, 8, 5, 6_200, 10_000],
        [10, 9, 5, 6_900, 11_000],
      ]);
    expect(sm.TRIALS_PER_RUN).toBe(20);
    expect(sm.MAX_TRIAL_MS).toBe(17_900);
    expect(sm.MAX_RUN_MS).toBe(358_000);
  });

  it('pins sequences derived from seeds', () => {
    expect(sm.sequenceAt(0, 0, 0, 1)).toEqual([4, 2]);
    expect(sm.sequenceAt(1, 0, 0, 5)).toEqual([14, 10, 9, 15, 14]);
    expect(sm.sequenceAt(20_261_003, 3, 2, 10)).toEqual([15, 22, 2, 7, 2, 18, 24, 20, 13]);
    expect(sm.sequenceAt(0xffff_ffff, 19, 15, 7)).toEqual([12, 1, 0, 18, 2, 7]);
  });
});
