import { describe, expect, it } from 'vitest';
import { unlockedStartLevel, type GameModeDefinition, type GameProgress } from '@nfct/shared';
import { endless, levels, sprint } from './fixtures';

function withBestPeak(bestPeakLevel: Record<string, number>): Pick<GameProgress, 'bestPeakLevel' | 'unlocked'> {
  return { bestPeakLevel, unlocked: {} };
}

describe('unlockedStartLevel', () => {
  it('returns the initially unlocked level when there is no progress document', () => {
    expect(unlockedStartLevel(endless, null)).toBe(1);
    expect(unlockedStartLevel(sprint, null)).toBe(2);
  });

  it('returns the initially unlocked level when progress has no entry for the mode', () => {
    const progress = withBestPeak({ sprint: 3 });

    expect(unlockedStartLevel(endless, progress)).toBe(1);
    expect(unlockedStartLevel(sprint, progress)).toBe(3);
  });

  it('applies the mode\'s own unlock policy', () => {
    // endless: one below the best peak, or the top level once it is reached.
    expect([1, 2, 3, 6, 7, 8].map((best) => unlockedStartLevel(endless, withBestPeak({ endless: best }))))
      .toEqual([1, 1, 2, 5, 6, 8]);
    // sprint: every level reached.
    expect([2, 3].map((best) => unlockedStartLevel(sprint, withBestPeak({ sprint: best })))).toEqual([2, 3]);
  });

  it('caps the unlocked level at the mode\'s highest level', () => {
    expect(unlockedStartLevel(endless, withBestPeak({ endless: 20 }))).toBe(8);
    expect(unlockedStartLevel(sprint, withBestPeak({ sprint: 50 }))).toBe(3);
  });

  it('never unlocks below the initially unlocked level', () => {
    expect(unlockedStartLevel(sprint, withBestPeak({ sprint: 1 }))).toBe(2);
  });

  it('clamps whatever a policy returns to the mode\'s bounds', () => {
    const mode = (earned: number): GameModeDefinition => ({
      id: 'clamped',
      adaptive: false,
      initiallyUnlockedStartLevel: 2,
      levels: levels(4),
      unlockPolicy: () => earned,
    });

    expect(unlockedStartLevel(mode(-5), withBestPeak({ clamped: 4 }))).toBe(2);
    expect(unlockedStartLevel(mode(99), withBestPeak({ clamped: 1 }))).toBe(4);
  });

  it('derives the level from trusted progress, not the cached unlocked value', () => {
    const forged = { ...withBestPeak({ endless: 2 }), unlocked: { endless: 8 } };

    expect(unlockedStartLevel(endless, forged)).toBe(1);
  });
});
