import { afterAll, describe, expect, it, vi } from 'vitest';
import { STATS_AGGREGATE_VERSION } from '@nfct/shared';
import { runSessionPipeline } from '../../src/pipeline';
import { processSession } from '../../src/processSession';
import { reconcileUpgrades } from '../../src/reconcile';
import { coreContext, writeSessionAt } from '../helpers/core';
import {
  achievementPath,
  CORE_PROJECT,
  dailyStatsPath,
  emulatorFirestore,
  newUid,
  readDoc,
  sessionPath,
  statsContent,
  statsPath,
  ts,
  type Plan,
} from '../helpers/emulator';

// Stats compatibility (NFCT-13). This file runs as a build whose stats
// reducer is aggregateVersion 2 (the shared constant is mocked), so stats
// written by aggregateVersion 1 are "older" and stats from aggregateVersion 3
// "newer".
vi.mock('../../../shared/schemas/stats', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../shared/schemas/stats')>()),
  STATS_AGGREGATE_VERSION: 2,
}));

const { db, close } = emulatorFirestore(CORE_PROJECT);
const context = coreContext(db);
afterAll(close);

const DAY_MS = 86_400_000;
/** Noon in Toronto on 2026-09-10: a fixed time, so the local dates are fixed. */
const NOON = Date.UTC(2026, 8, 10, 16, 0);
const daysAgo = (days: number) => NOON - days * DAY_MS;

/** Stats as an aggregateVersion 1 build left them: readable, older, and wrong. */
const olderSummary = {
  schemaVersion: 1, aggregateVersion: 1, updatedAt: ts(0), sessions: 99, sessionsCompleted: 99, activeMs: 1, lastPlayedAt: ts(0),
  validRuns: 99, bestPeakLevel: {}, streak: { runs: [], current: 0, longest: 0, lastActiveDate: null }, achievements: ['runs-100'],
};

const plans: (Omit<Plan, 'endedAtMs'> & { days: number })[] = [
  { seed: 601, startLevel: 1, targetPeak: 5, days: 2 },
  { seed: 602, startLevel: 3, targetPeak: 6, days: 1 },
  { seed: 603, startLevel: 1, targetPeak: 2, days: 0 },
];
const write = (uid: string, index: number) => {
  const { days, ...plan } = plans[index]!;
  return writeSessionAt(db, uid, daysAgo(days), { ...plan, id: `compat-${index}-session-document` });
};

async function reference(): Promise<Awaited<ReturnType<typeof statsContent>>> {
  const uid = newUid();
  for (const index of [0, 1, 2]) await runSessionPipeline(context, uid, (await write(uid, index)).id);
  return statsContent(db, uid);
}

describe('stats compatibility', () => {
  it('runs as aggregateVersion 2 in this file', () => {
    expect(STATS_AGGREGATE_VERSION).toBe(2);
  });

  it('rebuilds stats maintained by an older reducer from the stored results, then applies the session', async () => {
    const expected = await reference();
    const uid = newUid();
    for (const index of [0, 1]) await runSessionPipeline(context, uid, (await write(uid, index)).id);
    // An older build's stats: a wrong summary, a day no session was played on, an achievement no session earned.
    await db.doc(statsPath(uid)).set(olderSummary);
    await db.doc(dailyStatsPath(uid, '2020-01-01')).set({ schemaVersion: 1, aggregateVersion: 1, date: '2020-01-01', sessions: 3 });
    await db.doc(achievementPath(uid, 'runs-100')).set({
      schemaVersion: 1, achievementId: 'runs-100', earnedAt: ts(0), sessionId: 'compat-0-session-document', gameId: 'mental-math', localDate: '2020-01-01',
    });

    await runSessionPipeline(context, uid, (await write(uid, 2)).id);

    const rebuilt = await statsContent(db, uid);
    expect(rebuilt.summary).toMatchObject({ aggregateVersion: 2, sessions: 3, validRuns: 3, streak: { current: 3 } });
    expect(rebuilt).toEqual(expected);
    expect(await readDoc(db, dailyStatsPath(uid, '2020-01-01'))).toBeUndefined();
    expect(await readDoc(db, achievementPath(uid, 'runs-100'))).toBeUndefined();
  });

  it('rebuilds, rather than failing every session, when the version bump also changed the shape', async () => {
    const expected = await reference();
    const uid = newUid();
    for (const index of [0, 1]) await runSessionPipeline(context, uid, (await write(uid, index)).id);
    const today = Object.keys(expected.days).sort().at(-1)!;
    // What an aggregateVersion 1 build with another shape left: this build's reader rejects both documents.
    await db.doc(statsPath(uid)).set({ schemaVersion: 1, aggregateVersion: 1, totals: { runs: 2 }, streak: 2, badges: ['first-run'] });
    await db.doc(dailyStatsPath(uid, today)).set({ schemaVersion: 1, aggregateVersion: 1, day: today, count: 7 });

    await runSessionPipeline(context, uid, (await write(uid, 2)).id);

    expect((await readDoc(db, sessionPath(uid, 'compat-2-session-document')))?.processing).toBeUndefined();
    expect(await statsContent(db, uid)).toEqual(expected);
  });

  it("rebuilds when only the session's day is from an older reducer", async () => {
    const expected = await reference();
    const uid = newUid();
    for (const index of [0, 1]) await runSessionPipeline(context, uid, (await write(uid, index)).id);
    const today = Object.keys(expected.days).sort().at(-1)!;
    await db.doc(dailyStatsPath(uid, today)).set({
      schemaVersion: 1, aggregateVersion: 1, updatedAt: ts(0), date: today, sessions: 40, sessionsCompleted: 40, activeMs: 1, games: {},
    });

    await runSessionPipeline(context, uid, (await write(uid, 2)).id);

    expect(await statsContent(db, uid)).toEqual(expected);
  });

  it('leaves older stats to the next rebuild when a post-commit upgrade runs, and loses nothing', async () => {
    const expected = await reference();
    const uid = newUid();
    // Yesterday's level-3 session first (flagged), then the day before's, which unlocks it, with no budget for
    // the upgrade in its own transaction: it is left to the post-commit reconcile.
    await runSessionPipeline(context, uid, (await write(uid, 1)).id);
    const tight = coreContext(db, { limits: { transactionUpgradeScanBudget: 0, transactionUpgradeLimit: 0 } });
    const outcome = await processSession(tight, uid, (await write(uid, 0)).id);
    expect(outcome).toMatchObject({ status: 'processed', reconcile: { gameId: 'mental-math', modeId: 'timed-90' } });
    await db.doc(statsPath(uid)).set(olderSummary);

    const report = await reconcileUpgrades(context, uid, { gameId: 'mental-math', modeId: 'timed-90' });

    // The upgrade lands on the session and progress; the older stats are not touched.
    expect(report.upgraded).toEqual(['compat-1-session-document']);
    expect((await readDoc(db, sessionPath(uid, 'compat-1-session-document')))?.result.validity).toBe('valid');
    expect(await readDoc(db, statsPath(uid))).toEqual(olderSummary);
    // The next processing rebuilds them from the stored results, upgrade included.
    await runSessionPipeline(context, uid, (await write(uid, 2)).id);
    expect(await statsContent(db, uid)).toEqual(expected);
  });

  it('upgrades nothing while the stats are from newer code', async () => {
    const uid = newUid();
    await runSessionPipeline(context, uid, (await write(uid, 1)).id);
    const tight = coreContext(db, { limits: { transactionUpgradeScanBudget: 0, transactionUpgradeLimit: 0 } });
    await processSession(tight, uid, (await write(uid, 0)).id);
    const newer = { ...olderSummary, aggregateVersion: 3 };
    await db.doc(statsPath(uid)).set(newer);

    const report = await reconcileUpgrades(context, uid, { gameId: 'mental-math', modeId: 'timed-90' });

    expect(report).toEqual({ upgraded: [], stopped: 'stats-not-current' });
    expect((await readDoc(db, sessionPath(uid, 'compat-1-session-document')))?.result.validity).toBe('flagged');
    expect(await readDoc(db, statsPath(uid))).toEqual(newer);
  });
});
