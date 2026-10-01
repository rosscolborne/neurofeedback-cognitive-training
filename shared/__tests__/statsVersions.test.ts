import { describe, expect, it, vi } from 'vitest';
import {
  applyCountedSession,
  classifyAchievement,
  classifyDailyStats,
  classifyStatsSummary,
  serverResultWriteSchema,
  STATS_AGGREGATE_VERSION,
} from '@nfct/shared';
import { at, sessionId } from './fixtures';

// Stats version classification after a reducer change (NFCT-13). This file
// runs as a build whose stats reducer is aggregateVersion 2 (the shared
// constant is mocked). A version bump may change the shape of the summary or
// a day, so a document from an older version must be classified 'older' (and
// rebuilt) from its versions alone, never 'unreadable' because its old shape
// fails this build's reader.
vi.mock('../schemas/stats', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../schemas/stats')>()),
  STATS_AGGREGATE_VERSION: 2,
}));

const T = at(0);
const result = serverResultWriteSchema.parse({
  processedAt: T, scoringVersion: 1, validity: 'valid', reasons: [], score: 500, accuracy: 0.9, responseTime: null, peakLevel: 3,
  metrics: {}, performanceIndex: null, performanceIndexVersion: null, domainContributions: { math: 1 },
  recordKey: 'timed-90:1', recordValues: { score: 500 }, personalBest: false, unlocked: [],
});
const current = applyCountedSession(null, null, {
  sessionId: sessionId(1),
  session: { gameId: 'mental-math', status: 'completed', activeDurationMs: 90_000, endedAt: T, localDate: '2026-09-30' },
  result,
  appliedAt: T,
});

describe('stats version classification after a reducer change', () => {
  it('runs as aggregateVersion 2 in this file, and writes it', () => {
    expect(STATS_AGGREGATE_VERSION).toBe(2);
    expect(current.summary.aggregateVersion).toBe(2);
    expect(current.day.aggregateVersion).toBe(2);
  });

  it('classifies an older version by its versions alone, whatever shape it had', () => {
    // An aggregateVersion 1 summary and day whose shape this build no longer reads.
    expect(classifyStatsSummary({ schemaVersion: 1, aggregateVersion: 1, totals: { runs: 3 }, streak: 4 })).toEqual({ kind: 'older' });
    expect(classifyStatsSummary({ schemaVersion: 1, aggregateVersion: 1 })).toEqual({ kind: 'older' });
    expect(classifyDailyStats({ schemaVersion: 1, aggregateVersion: 1, day: '2026-09-30', count: 2 }, '2026-09-30')).toEqual({ kind: 'older' });
  });

  it('still refuses newer versions, and reads this version strictly', () => {
    expect(classifyStatsSummary({ ...current.summary, aggregateVersion: 3 })).toEqual({ kind: 'newer' });
    expect(classifyStatsSummary({ ...current.summary, schemaVersion: 2, aggregateVersion: 1 })).toEqual({ kind: 'newer' });
    expect(classifyStatsSummary(current.summary)).toEqual({ kind: 'current', value: current.summary });
    expect(classifyDailyStats(current.day, '2026-09-30')).toEqual({ kind: 'current', value: current.day });
    expect(classifyStatsSummary({ ...current.summary, validRuns: 'three' })).toMatchObject({ kind: 'unreadable' });
  });

  it('calls versions it cannot make sense of unreadable, never older', () => {
    for (const aggregateVersion of [0, -1, 1.5, '1', null]) {
      expect(classifyStatsSummary({ ...current.summary, aggregateVersion }), String(aggregateVersion)).toMatchObject({ kind: 'unreadable' });
    }
    expect(classifyStatsSummary({ aggregateVersion: 2 })).toMatchObject({ kind: 'unreadable' });
    expect(classifyAchievement({ schemaVersion: 0, achievementId: 'first-run' }, 'first-run')).toMatchObject({ kind: 'unreadable' });
  });
});
