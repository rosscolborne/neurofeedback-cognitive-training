import { describe, expect, it } from 'vitest';
import {
  achievementIdSchema,
  achievementMet,
  ACHIEVEMENT_CATALOGUE,
  addDays,
  applyCountedSession,
  applyValidUpgrade,
  classifyAchievement,
  classifyDailyStats,
  classifyStatsSummary,
  DomainReadError,
  findAchievement,
  isTrainingDay,
  readAchievement,
  readDailyStats,
  readStatsSummary,
  rebuildStats,
  serverResultWriteSchema,
  statsSummaryWriteSchema,
  STATS_AGGREGATE_VERSION,
  type DailyStats,
  type ServerResult,
  type StatsSession,
  type StatsSummary,
} from '@nfct/shared';
import { at, sessionId } from './fixtures';

// The stats reducers (NFCT-13): stats/summary, dailyStats and achievements.

const T = at(0);

function result(validity: 'valid' | 'flagged', { peakLevel = 3, reasons = [] as string[], processedAt = T } = {}): ServerResult {
  const scored = {
    processedAt, scoringVersion: 1, score: 500, accuracy: 0.9, responseTime: null, peakLevel, metrics: {},
    performanceIndex: null, performanceIndexVersion: null, domainContributions: { math: 1 },
  };
  return serverResultWriteSchema.parse(validity === 'valid'
    ? { ...scored, validity, reasons, recordKey: 'timed-90:1', recordValues: { score: 500 }, personalBest: false, unlocked: [] }
    : { ...scored, validity, reasons: reasons.length > 0 ? reasons : ['rt-below-floor'] });
}

function session(localDate = '2026-09-30', overrides: Partial<StatsSession> = {}): StatsSession {
  return { gameId: 'mental-math', status: 'completed', activeDurationMs: 90_000, endedAt: at(1), localDate, ...overrides };
}

type Step = { session: StatsSession; result: ServerResult };

/** Folds sessions in as trusted scoring would, one processing at a time. */
function fold(steps: readonly Step[], start: StatsSummary | null = null) {
  let summary = start;
  const days = new Map<string, DailyStats>();
  const earned: { id: string; sessionId: string }[] = [];
  steps.forEach(({ session: s, result: r }, index) => {
    const update = applyCountedSession(summary, days.get(s.localDate) ?? null, { sessionId: sessionId(index), session: s, result: r, appliedAt: T });
    summary = update.summary;
    days.set(s.localDate, update.day);
    earned.push(...update.earned.map(({ achievementId, sessionId: earnedBy }) => ({ id: achievementId, sessionId: earnedBy })));
  });
  return { summary: summary!, days, earned };
}

const valid = (localDate?: string, overrides?: Partial<StatsSession>, options?: Parameters<typeof result>[1]): Step =>
  ({ session: session(localDate, overrides), result: result('valid', options) });
const flagged = (localDate?: string, overrides?: Partial<StatsSession>, options?: Parameters<typeof result>[1]): Step =>
  ({ session: session(localDate, overrides), result: result('flagged', options) });

describe('eligibility', () => {
  it('counts a valid completed session everywhere: activity, a valid run, its peak level and a training day', () => {
    const { summary, days, earned } = fold([valid('2026-09-30', {}, { peakLevel: 5 })]);
    expect(summary).toMatchObject({
      schemaVersion: 1, aggregateVersion: STATS_AGGREGATE_VERSION, sessions: 1, sessionsCompleted: 1, activeMs: 90_000,
      validRuns: 1, bestPeakLevel: { 'mental-math': 5 },
      streak: { runs: [{ start: '2026-09-30', end: '2026-09-30' }], current: 1, longest: 1, lastActiveDate: '2026-09-30' },
      achievements: ['first-run', 'mental-math-level-5'],
    });
    expect(days.get('2026-09-30')).toMatchObject({
      date: '2026-09-30', sessions: 1, sessionsCompleted: 1, activeMs: 90_000,
      games: { 'mental-math': { sessions: 1, sessionsCompleted: 1, activeMs: 90_000 } },
    });
    expect(earned).toEqual([{ id: 'first-run', sessionId: sessionId(0) }, { id: 'mental-math-level-5', sessionId: sessionId(0) }]);
  });

  it('counts a flagged session toward time played only: no run, no peak level, no training day, no achievement', () => {
    const { summary, days, earned } = fold([flagged('2026-09-30', {}, { peakLevel: 10 }), flagged('2026-10-01', { status: 'abandoned', activeDurationMs: 30_000 })]);
    expect(summary).toMatchObject({
      sessions: 2, sessionsCompleted: 1, activeMs: 120_000, validRuns: 0, bestPeakLevel: {}, streak: { runs: [], current: 0 }, achievements: [],
    });
    expect(days.get('2026-10-01')).toMatchObject({ sessions: 1, sessionsCompleted: 0, activeMs: 30_000 });
    expect(earned).toEqual([]);
  });

  it('never makes an abandoned run a training day or a valid run, even when it is valid', () => {
    const { summary, earned } = fold([valid('2026-09-30', { status: 'abandoned', activeDurationMs: 40_000 }, { peakLevel: 6 })]);
    expect(summary).toMatchObject({ sessions: 1, sessionsCompleted: 0, activeMs: 40_000, validRuns: 0, bestPeakLevel: {}, streak: { current: 0 } });
    expect(earned).toEqual([]);
  });

  it('refuses an invalid session: it counts nowhere', () => {
    const invalid = serverResultWriteSchema.parse({ processedAt: T, scoringVersion: 1, validity: 'invalid', reasons: ['schema-invalid'] });
    expect(() => applyCountedSession(null, null, { sessionId: sessionId(1), session: session(), result: invalid, appliedAt: T })).toThrow(/invalid/);
  });

  it('makes a training day only of a date the server could verify (anti-backfill)', () => {
    for (const code of ['local-date-mismatch', 'unknown-timezone', 'reasons-truncated']) {
      const { summary } = fold([valid('2026-09-30', {}, { reasons: [code] })]);
      expect(summary, code).toMatchObject({ validRuns: 1, streak: { runs: [], current: 0 }, achievements: ['first-run'] });
      expect(isTrainingDay(session(), result('valid', { reasons: [code] })), code).toBe(false);
    }
    // Other diagnostics, including a device clock that disagrees with itself, leave the date verified.
    for (const code of ['local-date-inconsistent', 'late-upload', 'summary-mismatch', 'start-level-unlocked-later']) {
      expect(isTrainingDay(session(), result('valid', { reasons: [code] })), code).toBe(true);
    }
  });

  it('never reads EEG: the reducers take only the session fields and trusted result', () => {
    // A session carrying stray EEG-looking fields counts exactly like one without them.
    const plain = fold([valid('2026-09-30')]);
    const withNoise = fold([{ session: { ...session('2026-09-30'), eegLinked: true, focus: 99 } as StatsSession, result: result('valid') }]);
    expect(withNoise.summary).toEqual(plain.summary);
  });
});

describe('totals, days and streaks', () => {
  it('buckets sessions by their local date and keeps per-game counts', () => {
    const { summary, days } = fold([valid('2026-09-30'), valid('2026-09-30'), flagged('2026-09-30'), valid('2026-10-01')]);
    expect(summary).toMatchObject({ sessions: 4, sessionsCompleted: 4, activeMs: 360_000, validRuns: 3 });
    expect([...days.keys()]).toEqual(['2026-09-30', '2026-10-01']);
    expect(days.get('2026-09-30')).toMatchObject({ sessions: 3, games: { 'mental-math': { sessions: 3, sessionsCompleted: 3 } } });
  });

  it('keeps the latest device endedAt as last played, whatever order sessions are counted in', () => {
    const { summary } = fold([valid('2026-10-01', { endedAt: at(500) }), valid('2026-09-30', { endedAt: at(10) })]);
    expect(summary.lastPlayedAt).toEqual(at(500));
  });

  it('earns the 3-day streak on the session that completes it, across a month boundary', () => {
    const { summary, earned } = fold([valid('2026-09-29'), valid('2026-09-30'), flagged('2026-10-01'), valid('2026-10-01')]);
    expect(summary.streak).toMatchObject({ current: 3, longest: 3, lastActiveDate: '2026-10-01' });
    expect(earned).toContainEqual({ id: 'streak-3', sessionId: sessionId(3) });
  });

  it('earns run milestones from valid runs only', () => {
    const steps = Array.from({ length: 12 }, (_, index) => (index % 4 === 3 ? flagged('2026-09-30') : valid('2026-09-30')));
    const { summary, earned } = fold(steps);
    expect(summary.validRuns).toBe(9);
    expect(earned.map(({ id }) => id)).not.toContain('runs-10');
    const more = fold([valid('2026-09-30')], summary);
    expect(more.earned).toEqual([{ id: 'runs-10', sessionId: sessionId(0) }]);
  });
});

describe('the start-level upgrade', () => {
  it('adds only the valid-only effects of a session counted as flagged, and earns what they reach', () => {
    const before = fold([valid('2026-09-29'), flagged('2026-09-30', {}, { reasons: ['start-level-locked'], peakLevel: 5 })]).summary;
    expect(before).toMatchObject({ sessions: 2, validRuns: 1, streak: { current: 1 } });

    const upgraded = applyValidUpgrade(before, {
      sessionId: sessionId(7), session: session('2026-09-30'), result: result('valid', { reasons: ['start-level-unlocked-later'], peakLevel: 5 }), appliedAt: at(9),
    });

    expect(upgraded.summary).toMatchObject({
      sessions: 2, sessionsCompleted: 2, activeMs: 180_000, // activity was counted when it was processed
      validRuns: 2, bestPeakLevel: { 'mental-math': 5 }, streak: { current: 2, lastActiveDate: '2026-09-30' },
      achievements: ['first-run', 'mental-math-level-5'],
    });
    expect(upgraded.summary.updatedAt).toEqual(at(9));
    expect(upgraded.earned).toEqual([expect.objectContaining({
      achievementId: 'mental-math-level-5', sessionId: sessionId(7), earnedAt: at(9), localDate: '2026-09-30', gameId: 'mental-math',
    })]);
  });

  it('reaches the same summary as a session that was valid when it was processed', () => {
    const live = fold([valid('2026-09-29'), valid('2026-09-30', {}, { reasons: [], peakLevel: 5 })]).summary;
    const upgraded = applyValidUpgrade(fold([valid('2026-09-29'), flagged('2026-09-30', {}, { reasons: ['start-level-locked'], peakLevel: 5 })]).summary, {
      sessionId: sessionId(1), session: session('2026-09-30'), result: result('valid', { reasons: ['start-level-unlocked-later'], peakLevel: 5 }), appliedAt: T,
    }).summary;
    expect(upgraded).toEqual(live);
  });

  it('refuses to upgrade to anything but valid', () => {
    const { summary } = fold([valid()]);
    expect(() => applyValidUpgrade(summary, { sessionId: sessionId(1), session: session(), result: result('flagged'), appliedAt: T })).toThrow(/valid/);
  });
});

describe('rebuild', () => {
  it('replays stored results in endedAt order: the same stats, achievements credited in play order', () => {
    const steps: (Step & { id: string })[] = [
      { id: sessionId(3), ...valid('2026-10-01', { endedAt: at(3 * 1_440) }) },
      { id: sessionId(1), ...valid('2026-09-29', { endedAt: at(1_440) }, { processedAt: at(1_441) }) },
      { id: sessionId(2), ...valid('2026-09-30', { endedAt: at(2 * 1_440) }) },
      { id: sessionId(4), ...flagged('2026-10-01', { endedAt: at(3 * 1_440 + 5) }) },
    ];
    const live = fold(steps);
    const rebuilt = rebuildStats(steps.map(({ id, session: s, result: r }) => ({ id, session: { ...s, result: r } })), T);

    const { updatedAt: _a, ...liveContent } = live.summary;
    const { updatedAt: _b, ...rebuiltContent } = rebuilt.summary!;
    expect({ ...rebuiltContent, achievements: [...rebuiltContent.achievements].sort() }).toEqual({ ...liveContent, achievements: [...liveContent.achievements].sort() });
    expect(rebuilt.days.map(({ date, sessions }) => [date, sessions])).toEqual([['2026-09-29', 1], ['2026-09-30', 1], ['2026-10-01', 2]]);
    // Credited to the session that earned each one in play order, at the time that session was processed.
    expect(rebuilt.achievements.find(({ achievementId }) => achievementId === 'first-run')).toMatchObject({ sessionId: sessionId(1), earnedAt: at(1_441) });
    expect(rebuilt.achievements.find(({ achievementId }) => achievementId === 'streak-3')).toMatchObject({ sessionId: sessionId(3) });
  });

  it('skips unprocessed and invalid sessions, and has no summary when nothing counts', () => {
    const invalid = serverResultWriteSchema.parse({ processedAt: T, scoringVersion: 1, validity: 'invalid', reasons: ['schema-invalid'] });
    expect(rebuildStats([{ id: sessionId(1), session: session() }, { id: sessionId(2), session: { ...session(), result: invalid } }], T))
      .toEqual({ summary: null, days: [], achievements: [] });
  });
});

describe('stats documents', () => {
  const { summary, days } = fold([valid('2026-09-29'), valid('2026-09-30')]);
  const day = days.get('2026-09-30')!;

  it('writes strictly and reads tolerantly', () => {
    expect(() => statsSummaryWriteSchema.parse({ ...summary, extra: 1 })).toThrow();
    expect(readStatsSummary({ ...summary, addedLater: true })).toEqual(summary);
    expect(readDailyStats({ ...day, addedLater: true })).toEqual(day);
    expect(() => readStatsSummary({ ...summary, schemaVersion: 2 })).toThrow(DomainReadError);
  });

  it('refuses a streak whose runs overlap, touch or disagree with its derived fields', () => {
    const streak = summary.streak;
    expect(() => statsSummaryWriteSchema.parse({ ...summary, streak: { ...streak, current: 5 } })).toThrow(/match the runs/);
    expect(() => statsSummaryWriteSchema.parse({
      ...summary, streak: { runs: [{ start: '2026-09-29', end: '2026-09-29' }, { start: '2026-09-30', end: '2026-09-30' }], current: 1, longest: 1, lastActiveDate: '2026-09-30' },
    })).toThrow(/separated by a gap/);
    expect(() => readStatsSummary({ ...summary, streak: { ...streak, runs: [{ start: '2026-09-30', end: '2026-09-29' }] } })).toThrow(DomainReadError);
  });

  it('reads an achievement only under its own ID', () => {
    const achievement = { schemaVersion: 1, achievementId: 'first-run', earnedAt: T, sessionId: sessionId(1), gameId: 'mental-math', localDate: '2026-09-30' };
    expect(readAchievement(achievement, 'first-run')).toEqual(achievement);
    expect(() => readAchievement(achievement, 'streak-3')).toThrow(DomainReadError);
  });

  it('classifies stored stats before applying a session', () => {
    expect(classifyStatsSummary(undefined)).toEqual({ kind: 'missing' });
    expect(classifyStatsSummary(summary)).toEqual({ kind: 'current', value: summary });
    expect(classifyStatsSummary({ ...summary, aggregateVersion: STATS_AGGREGATE_VERSION + 1 })).toEqual({ kind: 'newer' });
    expect(classifyStatsSummary({ schemaVersion: 2 })).toEqual({ kind: 'newer' });
    expect(classifyStatsSummary({ schemaVersion: 1, aggregateVersion: 1 })).toMatchObject({ kind: 'unreadable' });
    expect(classifyDailyStats(day, '2026-09-30')).toEqual({ kind: 'current', value: day });
    expect(classifyDailyStats(day, '2026-09-29')).toMatchObject({ kind: 'unreadable' });
    expect(classifyAchievement({ schemaVersion: 2 }, 'first-run')).toEqual({ kind: 'newer' });
  });

  it('refuses to apply a session to stats from another reducer version, or to the wrong day', () => {
    const other = { ...summary, aggregateVersion: STATS_AGGREGATE_VERSION + 1 };
    expect(() => applyCountedSession(other, null, { sessionId: sessionId(5), session: session(), result: result('valid'), appliedAt: T })).toThrow(/rebuild/);
    expect(() => applyCountedSession(summary, day, { sessionId: sessionId(5), session: session('2026-10-01'), result: result('valid'), appliedAt: T })).toThrow(/not the session's day/);
  });
});

describe('achievement catalogue v1', () => {
  it('has a handful of stable, unique, well-formed IDs', () => {
    const ids = ACHIEVEMENT_CATALOGUE.map(({ id }) => id);
    expect(ids.length).toBeGreaterThanOrEqual(6);
    expect(ids.length).toBeLessThanOrEqual(10);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(achievementIdSchema.safeParse(id).success, id).toBe(true);
    expect(findAchievement('first-run')?.title).toBe('First run');
    expect(findAchievement('not-in-this-build')).toBeUndefined();
  });

  it('is gameplay-only: no EEG input and no cognitive or clinical claim in its copy', () => {
    for (const { title, description, criterion } of ACHIEVEMENT_CATALOGUE) {
      expect(['valid-runs', 'streak', 'peak-level']).toContain(criterion.kind);
      expect(`${title} ${description}`).not.toMatch(/eeg|brain|neuro|focus|calm|mind|cognit|memory|iq|intellig|clinic|therap|improv|smarter|sharper|health/i);
    }
  });

  it('only reads valid-session parts of the summary, and every criterion is monotone in them', () => {
    const base = fold([flagged('2026-09-30', {}, { peakLevel: 10 })]).summary;
    // However much flagged play there is, no criterion is met.
    for (const { id, criterion } of ACHIEVEMENT_CATALOGUE) expect(achievementMet(criterion, base), id).toBe(false);
    const met = (summary: Pick<StatsSummary, 'validRuns' | 'streak' | 'bestPeakLevel'>) =>
      ACHIEVEMENT_CATALOGUE.filter(({ criterion }) => achievementMet(criterion, summary)).map(({ id }) => id);
    let summary: StatsSummary | null = null;
    let previous: string[] = [];
    for (let index = 0; index < 120; index += 1) {
      const date = addDays('2026-01-01', index);
      summary = applyCountedSession(summary, null, {
        sessionId: sessionId(index), session: session(date), result: result('valid', { peakLevel: Math.min(10, 1 + Math.floor(index / 10)) }), appliedAt: T,
      }).summary;
      const now = met(summary);
      expect(now).toEqual(expect.arrayContaining(previous));
      previous = now;
    }
    expect(previous.sort()).toEqual(ACHIEVEMENT_CATALOGUE.map(({ id }) => id).sort());
  });

  it('awards each achievement once, recorded in the summary', () => {
    const steps = Array.from({ length: 40 }, (_, index) => valid(addDays('2026-01-01', index), {}, { peakLevel: 10 }));
    const { summary, earned } = fold(steps);
    expect(new Set(earned.map(({ id }) => id)).size).toBe(earned.length);
    expect([...summary.achievements].sort()).toEqual(earned.map(({ id }) => id).sort());
    expect(summary.achievements).toEqual(['first-run', 'mental-math-level-5', 'mental-math-level-10', 'streak-3', 'streak-7', 'runs-10', 'streak-30']);
  });
});
