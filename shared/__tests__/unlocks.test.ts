import { describe, expect, it } from 'vitest';
import { applySession, unlockedStartLevel, type GameProgress } from '@nfct/shared';
import { at, endless, fixtureGame, progressSession, sessionId, sprint, valid } from './fixtures';

function progressWithBestPeak(bestPeakLevel: Record<string, number>): GameProgress {
  return { ...applySession(null, {
    definition: fixtureGame,
    sessionId: sessionId(1),
    session: progressSession(),
    outcome: valid(10),
    appliedAt: at(0),
  })!, bestPeakLevel };
}

describe('unlockedStartLevel', () => {
  it('returns the initially unlocked level when there is no progress document', () => {
    expect(unlockedStartLevel(endless, null)).toBe(1);
    expect(unlockedStartLevel(sprint, null)).toBe(2);
  });

  it('returns the initially unlocked level when progress has no entry for the mode', () => {
    const progress = progressWithBestPeak({ sprint: 3 });

    expect(unlockedStartLevel(endless, progress)).toBe(1);
    expect(unlockedStartLevel(sprint, progress)).toBe(2);
  });

  it('unlocks one level below the best peak level', () => {
    expect([1, 2, 3, 6, 8].map((best) => unlockedStartLevel(endless, progressWithBestPeak({ endless: best }))))
      .toEqual([1, 1, 2, 5, 7]);
  });

  it('caps the unlocked level at the mode\'s highest level', () => {
    expect(unlockedStartLevel(endless, progressWithBestPeak({ endless: 20 }))).toBe(8);
    expect(unlockedStartLevel(sprint, progressWithBestPeak({ sprint: 50 }))).toBe(3);
  });

  it('never unlocks below the initially unlocked level', () => {
    expect(unlockedStartLevel(sprint, progressWithBestPeak({ sprint: 2 }))).toBe(2);
    expect(unlockedStartLevel(sprint, progressWithBestPeak({ sprint: 1 }))).toBe(2);
  });

  it('derives the level from trusted progress, not the cached unlocked value', () => {
    const forged = { ...progressWithBestPeak({ endless: 2 }), unlocked: { endless: 8 } };

    expect(unlockedStartLevel(endless, forged)).toBe(1);
  });
});
