import { Timestamp } from 'firebase/firestore';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyCountedSession,
  serverResultWriteSchema,
  streakStatus,
  weekContaining,
  weeklyGoalProgress,
  type Achievement,
  type DailyStats,
  type StatsSummary,
} from '@nfct/shared';
import type { DocumentRead } from '../../src/consumer/firestore/reads';
import type { AchievementsRead, DailyStatsRead } from '../../src/consumer/repositories/statsRepository';
import {
  closeDevices,
  closeEnvironment,
  eventually,
  expectDenied,
  newDevice,
  rawClientWrite,
  resetEmulators,
  serverWrite,
  signedInDevice,
} from './harness';

beforeEach(resetEmulators);
afterEach(closeDevices);
afterAll(closeEnvironment);

// The stats read repository (NFCT-13) against the emulators with the real
// rules: the summary, a bounded range of daily stats and the achievements, as
// trusted scoring writes them, read tolerantly. Documents are built with the
// shared reducers, exactly as trusted scoring builds them.

const validResult = (processedAt: Timestamp) => serverResultWriteSchema.parse({
  processedAt, scoringVersion: 1, validity: 'valid', reasons: [], score: 600, accuracy: 0.9, responseTime: null, peakLevel: 5,
  metrics: {}, performanceIndex: null, performanceIndexVersion: null, domainContributions: { math: 1 },
  recordKey: 'timed-90:1', recordValues: { score: 600 }, personalBest: true, unlocked: [],
});

/** What trusted scoring writes for valid completed runs on these local dates, in this order. */
function trustedStats(dates: readonly string[]) {
  let summary: StatsSummary | null = null;
  const days = new Map<string, DailyStats>();
  const achievements: Achievement[] = [];
  dates.forEach((localDate, index) => {
    const at = Timestamp.fromMillis(Date.UTC(2026, 8, 1) + index * 60_000);
    const update = applyCountedSession(summary, days.get(localDate) ?? null, {
      sessionId: `stats-session-${String(index).padStart(8, '0')}`,
      session: { gameId: 'mental-math', status: 'completed', activeDurationMs: 90_000, endedAt: at, localDate },
      result: validResult(at),
      appliedAt: at,
    });
    summary = update.summary;
    days.set(localDate, update.day);
    achievements.push(...update.earned);
  });
  return { summary: summary!, days: [...days.values()], achievements };
}

async function writeTrusted(uid: string, stats: ReturnType<typeof trustedStats>): Promise<void> {
  await serverWrite({
    [`users/${uid}/stats/summary`]: stats.summary,
    ...Object.fromEntries(stats.days.map((day) => [`users/${uid}/dailyStats/${day.date}`, day])),
    ...Object.fromEntries(stats.achievements.map((achievement) => [`users/${uid}/achievements/${achievement.achievementId}`, achievement])),
  });
}

describe('stats summary', () => {
  it('reports a missing summary for a player with no counted session', async () => {
    const device = await signedInDevice();

    expect(await device.stats.getSummary()).toMatchObject({ status: 'missing', id: 'summary' });
  });

  it('reads the trusted summary, whose streak liveness is decided for today', async () => {
    const device = await signedInDevice();
    await writeTrusted(device.player.uid, trustedStats(['2026-09-28', '2026-09-29', '2026-09-30']));

    const read = await device.stats.getSummary();

    expect(read).toMatchObject({
      status: 'readable',
      data: { sessions: 3, validRuns: 3, streak: { current: 3, longest: 3, lastActiveDate: '2026-09-30' }, achievements: ['first-run', 'mental-math-level-5', 'streak-3'] },
    });
    if (read.status !== 'readable') throw new Error('unreachable');
    expect(read.data.lastPlayedAt).toBeInstanceOf(Timestamp);
    expect(streakStatus(read.data.streak, '2026-10-01')).toMatchObject({ current: 3, alive: true, trainedToday: false });
    expect(streakStatus(read.data.streak, '2026-10-02')).toMatchObject({ current: 0, alive: false, longest: 3 });
  });

  it('reports a summary this build cannot read as unreadable instead of throwing', async () => {
    const device = await signedInDevice();
    await serverWrite({ [`users/${device.player.uid}/stats/summary`]: { schemaVersion: 2, sessions: 1 } });

    expect(await device.stats.getSummary()).toMatchObject({ status: 'unreadable' });
  });

  it('follows the summary as trusted scoring updates it', async () => {
    const device = await signedInDevice();
    const reads: DocumentRead<StatsSummary>[] = [];
    const stop = device.stats.subscribeToSummary((read) => reads.push(read), (error) => { throw error; });

    await eventually(() => expect(reads.at(-1)).toMatchObject({ status: 'missing', fromCache: false }));
    await writeTrusted(device.player.uid, trustedStats(['2026-09-30']));
    await eventually(() => expect(reads.at(-1)).toMatchObject({ status: 'readable', data: { validRuns: 1 } }));
    stop();
  });

  it('needs a signed-in player', async () => {
    await expect(newDevice().stats.getSummary()).rejects.toThrow(/Sign in/);
  });
});

describe('daily stats', () => {
  it('reads one bounded range of days, by date, and nothing outside it', async () => {
    const device = await signedInDevice();
    await writeTrusted(device.player.uid, trustedStats(['2026-09-27', '2026-09-28', '2026-09-28', '2026-10-01', '2026-10-05']));

    const read = await device.stats.getDailyStats(weekContaining('2026-10-01'));

    expect(read.days.map(({ date, sessions }) => [date, sessions])).toEqual([['2026-09-28', 2], ['2026-10-01', 1]]);
    expect(read).toMatchObject({ range: { from: '2026-09-28', to: '2026-10-04' }, unreadable: [], fromCache: false });
    // The weekly goal is computed on read from the same documents and the profile's goal.
    expect(weeklyGoalProgress({ kind: 'activeDays', target: 3 }, read.days, read.range)).toMatchObject({ value: 2, met: false });
    expect(weeklyGoalProgress({ kind: 'minutes', target: 4 }, read.days, read.range)).toMatchObject({ value: 4, met: true });
  });

  it('reads a whole month, and refuses a range longer than 31 days or not made of real dates', async () => {
    const device = await signedInDevice();
    await writeTrusted(device.player.uid, trustedStats(['2026-10-01', '2026-10-31', '2026-11-01']));

    expect((await device.stats.getDailyStats({ from: '2026-10-01', to: '2026-10-31' })).days.map(({ date }) => date)).toEqual(['2026-10-01', '2026-10-31']);
    await expect(device.stats.getDailyStats({ from: '2026-10-01', to: '2026-11-01' })).rejects.toThrow(/1 to 31 days/);
    await expect(device.stats.getDailyStats({ from: '2026-10-02', to: '2026-10-01' })).rejects.toThrow(/1 to 31 days/);
    await expect(device.stats.getDailyStats({ from: '2026-10-01', to: '2026-10-1' })).rejects.toThrow(/Not a local date/);
  });

  it('skips and reports a day it cannot read, keeping the others', async () => {
    const device = await signedInDevice();
    const stats = trustedStats(['2026-09-29', '2026-09-30']);
    await writeTrusted(device.player.uid, stats);
    await serverWrite({
      [`users/${device.player.uid}/dailyStats/2026-10-01`]: { ...stats.days[0], date: '2026-10-01', schemaVersion: 2 },
      // Stored under the wrong date: never trusted for another day.
      [`users/${device.player.uid}/dailyStats/2026-10-02`]: { ...stats.days[0] },
    });

    const read = await device.stats.getDailyStats({ from: '2026-09-29', to: '2026-10-02' });

    expect(read.days.map(({ date }) => date)).toEqual(['2026-09-29', '2026-09-30']);
    expect(read.unreadable.map(({ id }) => id).sort()).toEqual(['2026-10-01', '2026-10-02']);
  });

  it('follows a range as trusted scoring adds a day', async () => {
    const device = await signedInDevice();
    const reads: DailyStatsRead[] = [];
    const stop = device.stats.subscribeToDailyStats({ from: '2026-09-28', to: '2026-10-04' }, (read) => reads.push(read), (error) => { throw error; });

    await eventually(() => expect(reads.at(-1)).toMatchObject({ days: [], fromCache: false }));
    await writeTrusted(device.player.uid, trustedStats(['2026-09-30']));
    await eventually(() => expect(reads.at(-1)?.days.map(({ date }) => date)).toEqual(['2026-09-30']));
    stop();
  });
});

describe('achievements', () => {
  it('lists the earned achievements in the order they were earned', async () => {
    const device = await signedInDevice();
    await writeTrusted(device.player.uid, trustedStats(['2026-09-28', '2026-09-29', '2026-09-30']));

    const read = await device.stats.getAchievements();

    expect(read.achievements.map(({ achievementId }) => achievementId)).toEqual(['first-run', 'mental-math-level-5', 'streak-3']);
    expect(read.achievements[2]).toMatchObject({ sessionId: 'stats-session-00000002', localDate: '2026-09-30', gameId: 'mental-math' });
    expect(read.unreadable).toEqual([]);
  });

  it('reports an achievement stored under another ID as unreadable', async () => {
    const device = await signedInDevice();
    const { achievements } = trustedStats(['2026-09-30']);
    await serverWrite({ [`users/${device.player.uid}/achievements/streak-30`]: achievements[0]! });

    const read = await device.stats.getAchievements();

    expect(read.achievements).toEqual([]);
    expect(read.unreadable.map(({ id }) => id)).toEqual(['streak-30']);
  });

  it('follows achievements as they are earned', async () => {
    const device = await signedInDevice();
    const reads: AchievementsRead[] = [];
    const stop = device.stats.subscribeToAchievements((read) => reads.push(read), (error) => { throw error; });

    await eventually(() => expect(reads.at(-1)).toMatchObject({ achievements: [], fromCache: false }));
    await writeTrusted(device.player.uid, trustedStats(['2026-09-30']));
    await eventually(() => expect(reads.at(-1)?.achievements.map(({ achievementId }) => achievementId)).toEqual(['first-run', 'mental-math-level-5']));
    stop();
  });
});

describe('client writes', () => {
  it('are refused for the summary, a day and an achievement, even with trusted-looking data', async () => {
    const device = await signedInDevice();
    const { uid } = device.player;
    const stats = trustedStats(['2026-09-28', '2026-09-29', '2026-09-30']);

    await expectDenied(rawClientWrite(device, `users/${uid}/stats/summary`, stats.summary));
    await expectDenied(rawClientWrite(device, `users/${uid}/dailyStats/2026-09-30`, stats.days[2]!));
    await expectDenied(rawClientWrite(device, `users/${uid}/achievements/streak-3`, stats.achievements[2]!));
  });
});
