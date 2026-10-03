import { describe, expect, it, vi } from 'vitest';
import { classifyProgress, GAME_MODULE_REGISTRY, PROGRESS_AGGREGATE_VERSION } from '@nfct/shared';
import { TestTimestamp } from './fixtures';

// Aggregate compatibility (NFCT-19), pure. This file runs as a build whose
// progress reducer is aggregateVersion 2 (the shared constant is mocked), so
// aggregateVersion 1 is "older" and 3 is "newer".
vi.mock('../schemas/progress', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../schemas/progress')>()),
  PROGRESS_AGGREGATE_VERSION: 2,
}));

const at = new TestTimestamp(1_790_000_000, 0);
const progress = (change: Record<string, unknown> = {}) => ({
  schemaVersion: 1, aggregateVersion: 2, updatedAt: at, gameId: 'mental-math', gameVersion: 1,
  sessionsCompleted: 1, activeMs: 90_000, lastPlayedAt: at, bestPeakLevel: {}, unlocked: {}, bests: {}, bestsArchive: {},
  ...change,
});
const kind = (raw: unknown, gameId = 'mental-math') => classifyProgress(raw, gameId, GAME_MODULE_REGISTRY).kind;

describe('classifyProgress', () => {
  it('runs as aggregateVersion 2 in this file', () => {
    expect(PROGRESS_AGGREGATE_VERSION).toBe(2);
  });

  it('applies to missing progress and to progress of the same aggregate version', () => {
    expect(classifyProgress(undefined, 'mental-math', GAME_MODULE_REGISTRY)).toEqual({ kind: 'current', progress: null });
    expect(kind(progress())).toBe('current');
  });

  it('rebuilds progress from an older aggregate version', () => {
    expect(kind(progress({ aggregateVersion: 1 }))).toBe('older');
  });

  it('never applies to progress written by newer code, even in a shape it cannot read', () => {
    expect(kind(progress({ aggregateVersion: 3 }))).toBe('newer');
    expect(kind(progress({ gameVersion: 3 }))).toBe('newer');
    expect(kind(progress({ schemaVersion: 2 }))).toBe('newer');
    expect(kind({ schemaVersion: 1, aggregateVersion: 3, gameId: 'mental-math' })).toBe('newer');
  });

  it('calls anything else unreadable, never repairable in place', () => {
    expect(kind({ schemaVersion: 1, aggregateVersion: 2, gameId: 'mental-math' })).toBe('unreadable');
    expect(kind(progress({ gameId: 'other-game' }))).toBe('unreadable');
    expect(kind(progress(), 'unknown-game')).toBe('unreadable');
  });
});
