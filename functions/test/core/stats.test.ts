import { afterAll, describe, expect, it } from 'vitest';
import { localDateIn } from '@nfct/shared';
import { runRebuildProgress } from '../../scripts/cli';
import { handleSessionCreated, runSessionPipeline } from '../../src/pipeline';
import { processSession } from '../../src/processSession';
import { rebuildUserStats } from '../../src/stats';
import { coreContext, deliver, minutesAgo, withRedelivery, writeSession, writeSessionAt } from '../helpers/core';
import {
  achievementPath,
  CORE_PROJECT,
  dailyStatsPath,
  emulatorFirestore,
  newUid,
  progressPath,
  readDoc,
  sessionPath,
  statsContent,
  statsPath,
  ts,
  type Plan,
} from '../helpers/emulator';

// The cross-game aggregates (NFCT-13) against the Firestore emulator: stats,
// daily stats and achievements written in the processing transaction with
// the session's result and progress, exactly once and in any order, rebuilt
// from stored results when they are older or missing, never written over
// newer code's, and rebuilt by the admin script.

const { db, close } = emulatorFirestore(CORE_PROJECT);
const context = coreContext(db);
afterAll(close);

const DAY_MS = 86_400_000;
const ZONE = 'America/Toronto';
const dateOf = (ms: number) => localDateIn(ZONE, ms)!;
/**
 * A fixed server time, noon in Toronto on 2026-09-20, so tests that span
 * several local days never straddle midnight or a daylight-saving change.
 * The processing core trusts the stored createdAt, so sessions can be created
 * "then", and played five minutes earlier (writeSessionAt).
 */
const NOON = Date.UTC(2026, 8, 20, 16, 0);
/** Server time at noon `days` days before NOON. */
const daysAgo = (days: number) => NOON - days * DAY_MS;

describe('stats in the processing transaction', () => {
  it("writes the summary, the session's day and its first achievement in the same commit as its result and progress", async () => {
    const uid = newUid();
    const { id, doc } = await writeSession(db, uid, { seed: 301, startLevel: 1, targetPeak: 5, endedAtMs: minutesAgo(5) });

    await runSessionPipeline(context, uid, id);

    const { result } = (await readDoc(db, sessionPath(uid, id)))!;
    const localDate = doc.localDate as string;
    const summary = await readDoc(db, statsPath(uid));
    expect(summary).toMatchObject({
      schemaVersion: 1, aggregateVersion: 1, sessions: 1, sessionsCompleted: 1, activeMs: 90_000, validRuns: 1,
      bestPeakLevel: { 'mental-math': 5 },
      streak: { runs: [{ start: localDate, end: localDate }], current: 1, longest: 1, lastActiveDate: localDate },
      achievements: ['first-run', 'mental-math-level-5'],
    });
    expect(await readDoc(db, dailyStatsPath(uid, localDate))).toMatchObject({
      date: localDate, sessions: 1, sessionsCompleted: 1, activeMs: 90_000, games: { 'mental-math': { sessions: 1 } },
    });
    expect(await readDoc(db, achievementPath(uid, 'first-run'))).toEqual({
      schemaVersion: 1, achievementId: 'first-run', earnedAt: result.processedAt, sessionId: id, gameId: 'mental-math', localDate,
    });
    // One commit: every aggregate carries the result's processedAt.
    expect(summary?.updatedAt).toEqual(result.processedAt);
    expect((await readDoc(db, dailyStatsPath(uid, localDate)))?.updatedAt).toEqual(result.processedAt);
    expect((await readDoc(db, progressPath(uid)))?.updatedAt).toEqual(result.processedAt);
  });

  it('counts a redelivered session once, sequentially or racing', async () => {
    const uid = newUid();
    const { id } = await writeSession(db, uid, { seed: 302, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(5) });
    await runSessionPipeline(context, uid, id);
    const once = await statsContent(db, uid);

    expect((await runSessionPipeline(context, uid, id)).outcome.status).toBe('already-processed');
    expect(await statsContent(db, uid)).toEqual(once);

    const racing = newUid();
    const second = await writeSession(db, racing, { seed: 302, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(5), id });
    await Promise.all(Array.from({ length: 4 }, () => deliver(context, racing, second.id)));
    expect(await readDoc(db, statsPath(racing))).toMatchObject({ sessions: 1, validRuns: 1, activeMs: 90_000 });
  });

  it('counts a flagged session toward time played only, and an invalid one nowhere', async () => {
    const uid = newUid();
    const fast = await writeSession(db, uid, { seed: 303, startLevel: 1, targetPeak: 6, rtMs: 200, endedAtMs: minutesAgo(10), order: 1 });
    const tampered = await writeSession(db, uid, { seed: 304, startLevel: 1, targetPeak: 4, endedAtMs: minutesAgo(5), order: 2 });
    await db.doc(sessionPath(uid, tampered.id)).update({ seed: 305 });

    await runSessionPipeline(context, uid, fast.id);
    await runSessionPipeline(context, uid, tampered.id);

    expect((await readDoc(db, sessionPath(uid, fast.id)))?.result.validity).toBe('flagged');
    expect((await readDoc(db, sessionPath(uid, tampered.id)))?.result.validity).toBe('invalid');
    expect(await statsContent(db, uid)).toMatchObject({
      summary: { sessions: 1, sessionsCompleted: 1, activeMs: 90_000, validRuns: 0, bestPeakLevel: {}, streak: { runs: [] }, achievements: [] },
      achievements: [],
    });
  });

  it('keeps an invalid first session from creating any stats', async () => {
    const uid = newUid();
    const { id } = await writeSession(db, uid, { seed: 306, startLevel: 1, targetPeak: 4, endedAtMs: minutesAgo(5) });
    await db.doc(sessionPath(uid, id)).update({ seed: 307 });

    await runSessionPipeline(context, uid, id);

    expect(await statsContent(db, uid)).toEqual({ summary: null, days: {}, achievements: [] });
  });

  it('builds a streak over local dates and earns the 3-day streak on the session that completes it', async () => {
    const uid = newUid();
    const ids: string[] = [];
    for (const [order, days] of [[1, 2], [2, 1], [3, 0]] as const) {
      const { id } = await writeSessionAt(db, uid, daysAgo(days), { seed: 310 + order, startLevel: 1, targetPeak: 2, order });
      await runSessionPipeline(context, uid, id);
      ids.push(id);
    }

    expect(await readDoc(db, statsPath(uid))).toMatchObject({
      streak: { runs: [{ start: '2026-09-18', end: '2026-09-20' }], current: 3, longest: 3, lastActiveDate: '2026-09-20' }, validRuns: 3,
    });
    expect(await readDoc(db, achievementPath(uid, 'streak-3'))).toMatchObject({ sessionId: ids[2], localDate: '2026-09-20' });
  });

  it("buckets a session uploaded days later under the day it was played, but never makes that day a training day", async () => {
    const uid = newUid();
    const played = minutesAgo(3 * 24 * 60);
    const { id } = await writeSession(db, uid, { seed: 320, startLevel: 1, targetPeak: 3, endedAtMs: played });

    await runSessionPipeline(context, uid, id);

    expect((await readDoc(db, sessionPath(uid, id)))?.result).toMatchObject({ validity: 'valid', reasons: ['local-date-mismatch'] });
    expect(await readDoc(db, dailyStatsPath(uid, dateOf(played)))).toMatchObject({ sessions: 1 });
    expect(await readDoc(db, statsPath(uid))).toMatchObject({ validRuns: 1, streak: { runs: [], current: 0 }, achievements: ['first-run'] });
  });

  it('never overwrites an achievement that already exists: it is created only if absent', async () => {
    const uid = newUid();
    const existing = { schemaVersion: 1, achievementId: 'first-run', earnedAt: ts(0), sessionId: 'an-earlier-session-0001', gameId: 'mental-math', localDate: '2026-01-01' };
    await db.doc(achievementPath(uid, 'first-run')).set(existing);
    const { id } = await writeSession(db, uid, { seed: 321, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(5) });

    await runSessionPipeline(context, uid, id);

    expect(await readDoc(db, achievementPath(uid, 'first-run'))).toEqual(existing);
    expect((await readDoc(db, statsPath(uid)))?.achievements).toEqual(['first-run']);
  });

  it('writes nothing for a user whose account is being deleted', async () => {
    const uid = newUid();
    const { id } = await writeSession(db, uid, { seed: 322, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(5) });
    await db.doc(`accountDeletions/${uid}`).set({ status: 'requested' });

    expect((await runSessionPipeline(context, uid, id)).outcome.status).toBe('account-deleted');
    expect(await statsContent(db, uid)).toEqual({ summary: null, days: {}, achievements: [] });
  });
});

describe('order independence', () => {
  // Played on three days. "later" starts at level 3, which "earlier" unlocks (peak 5).
  const plans: Plan[] = [
    { seed: 330, startLevel: 1, targetPeak: 5, endedAtMs: daysAgo(2) - 5 * 60_000 },
    { seed: 331, startLevel: 3, targetPeak: 6, endedAtMs: daysAgo(1) - 5 * 60_000 },
    { seed: 332, startLevel: 1, targetPeak: 2, endedAtMs: daysAgo(0) - 5 * 60_000 },
  ];
  const write = async (uid: string, index: number) => {
    const plan = plans[index]!;
    return writeSessionAt(db, uid, plan.endedAtMs + 5 * 60_000, { ...plan, id: `stats-order-${index}-session-doc` });
  };

  async function inOrder(order: readonly number[], options: { tight?: boolean } = {}) {
    const uid = newUid();
    const tight = coreContext(db, { limits: { transactionUpgradeScanBudget: 0, transactionUpgradeLimit: 0 } });
    for (const index of order) {
      const { id } = await write(uid, index);
      await runSessionPipeline(options.tight ? tight : context, uid, id);
    }
    return uid;
  }

  it('reaches the same stats, achievements included, whatever order the sessions are processed in', async () => {
    const reference = await statsContent(db, await inOrder([0, 1, 2]));
    expect(reference.summary).toMatchObject({ sessions: 3, validRuns: 3, bestPeakLevel: { 'mental-math': 6 }, streak: { current: 3, longest: 3 } });
    expect(reference.achievements).toEqual(['first-run', 'mental-math-level-5', 'streak-3']);

    // The level-3 session first: flagged start-level-locked, counted in activity only; then upgraded in the
    // commit of the session that unlocks it, which adds its valid run, peak level and training day.
    const reversed = await inOrder([1, 2, 0]);
    expect((await readDoc(db, sessionPath(reversed, 'stats-order-1-session-doc')))?.result.reasons).toEqual(['start-level-unlocked-later']);
    expect(await statsContent(db, reversed)).toEqual(reference);

    // The same, with the upgrade left to the post-commit reconcile (its own commit, its own stats update).
    expect(await statsContent(db, await inOrder([1, 0, 2], { tight: true }))).toEqual(reference);
  });

  it('credits the upgrade with what it earns: the 3-day streak, completed by the upgraded session', async () => {
    const uid = newUid();
    // Today's session (start level 1, peak 2), then yesterday's level-3 session, still locked: flagged, no training day.
    for (const index of [2, 1]) await runSessionPipeline(context, uid, (await write(uid, index)).id);
    expect((await readDoc(db, sessionPath(uid, 'stats-order-1-session-doc')))?.result.validity).toBe('flagged');
    expect(await readDoc(db, statsPath(uid))).toMatchObject({ sessions: 2, validRuns: 1, streak: { longest: 1 } });

    // The day before yesterday's session reaches level 5 and unlocks level 3. Its own commit counts it (two
    // separate training days so far), then upgrades yesterday's session, which joins all three days.
    const outcome = await processSession(context, uid, (await write(uid, 0)).id);

    expect(outcome).toMatchObject({ status: 'processed', validity: 'valid', upgraded: ['stats-order-1-session-doc'] });
    expect(await readDoc(db, statsPath(uid))).toMatchObject({
      sessions: 3, validRuns: 3, streak: { runs: [{ start: '2026-09-18', end: '2026-09-20' }], current: 3, longest: 3 },
    });
    expect(await readDoc(db, achievementPath(uid, 'streak-3'))).toMatchObject({ sessionId: 'stats-order-1-session-doc', localDate: '2026-09-19' });
    expect(await readDoc(db, achievementPath(uid, 'mental-math-level-5'))).toMatchObject({ sessionId: 'stats-order-0-session-doc' });
  });

  it('loses no update when sessions of different days are delivered at once', async () => {
    const reference = await statsContent(db, await inOrder([0, 1, 2]));
    for (let round = 0; round < 3; round += 1) {
      const uid = newUid();
      const written = await Promise.all(plans.map((_, index) => write(uid, index)));
      await Promise.all(written.map(({ id }) => deliver(context, uid, id)));
      expect(await statsContent(db, uid), `round ${round}`).toEqual(reference);
    }
  });
});

describe('compatibility', () => {
  it.each([
    ['a newer aggregateVersion', { aggregateVersion: 2 }],
    ['a newer schemaVersion', { schemaVersion: 2 }],
  ])('never writes stats with %s: retried, then failed safely, with nothing written', async (_label, change) => {
    const uid = newUid();
    const newer = { schemaVersion: 1, aggregateVersion: 1, sessions: 7, ...change };
    await db.doc(statsPath(uid)).set(newer);
    const { id } = await writeSession(db, uid, { seed: 350, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(10) });
    const event = (ageMs: number) => ({ params: { uid, sessionId: id }, time: new Date(Date.now() - ageMs).toISOString() });

    await expect(handleSessionCreated(context, event(0))).rejects.toThrow(/newer code/);
    await handleSessionCreated(context, event(context.limits.retryWindowMs + 1_000));

    const session = await readDoc(db, sessionPath(uid, id));
    expect(session?.result).toBeUndefined();
    expect(session?.processing).toMatchObject({ state: 'failed', reason: 'stats-newer-than-code' });
    expect(await readDoc(db, statsPath(uid))).toEqual(newer);
    expect(await readDoc(db, progressPath(uid))).toBeUndefined();
  });

  it("never writes over a newer day's document", async () => {
    const uid = newUid();
    const { id, doc } = await writeSession(db, uid, { seed: 351, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(10) });
    const newerDay = { schemaVersion: 1, aggregateVersion: 2, date: doc.localDate };
    await db.doc(dailyStatsPath(uid, doc.localDate as string)).set(newerDay);

    await handleSessionCreated(context, { params: { uid, sessionId: id }, time: new Date(0).toISOString() });

    expect((await readDoc(db, sessionPath(uid, id)))?.processing).toMatchObject({ state: 'failed', reason: 'stats-newer-than-code' });
    expect(await readDoc(db, dailyStatsPath(uid, doc.localDate as string))).toEqual(newerDay);
  });

  it('refuses unreadable stats rather than guess, and the admin rebuild repairs them', async () => {
    const uid = newUid();
    await db.doc(statsPath(uid)).set({ schemaVersion: 1, aggregateVersion: 1, sessions: 'many' });
    const { id } = await writeSession(db, uid, { seed: 352, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(10) });

    await handleSessionCreated(context, { params: { uid, sessionId: id }, time: new Date(0).toISOString() });
    expect((await readDoc(db, sessionPath(uid, id)))?.processing).toMatchObject({ state: 'failed', reason: 'stats-unreadable' });

    expect(await rebuildUserStats(context, uid)).toMatchObject({ written: 'deleted' });
    await runSessionPipeline(context, uid, id);
    expect(await readDoc(db, statsPath(uid))).toMatchObject({ sessions: 1, validRuns: 1 });
  });
});

describe('admin rebuild', () => {
  it('rebuilds exactly the stats live processing built, keeps earned achievements as they were, and is deterministic', async () => {
    const uid = newUid();
    // Out of order, so one session is flagged and later upgraded; one is too fast (flagged for good); one abandoned.
    const order: [number, number, Omit<Plan, 'endedAtMs'>][] = [
      [3, 1, { seed: 360, startLevel: 3, targetPeak: 6 }],
      [1, 3, { seed: 361, startLevel: 1, targetPeak: 5 }],
      [2, 2, { seed: 362, startLevel: 1, targetPeak: 4, status: 'abandoned' }],
      [4, 0, { seed: 363, startLevel: 1, targetPeak: 3, rtMs: 200 }],
    ];
    for (const [index, days, plan] of order) {
      const { id } = await writeSessionAt(db, uid, daysAgo(days), { ...plan, order: index });
      await runSessionPipeline(context, uid, id);
    }
    const live = await statsContent(db, uid);
    const liveFirstRun = await readDoc(db, achievementPath(uid, 'first-run'));
    expect(live.summary).toMatchObject({ sessions: 4, sessionsCompleted: 3, validRuns: 2 });

    // Corrupt it: inflate the summary, forge a day and an achievement the sessions never earned, lose a real day.
    await db.doc(statsPath(uid)).update({ validRuns: 99, sessions: 99 });
    await db.doc(dailyStatsPath(uid, '2020-01-01')).set({ schemaVersion: 1, aggregateVersion: 1, date: '2020-01-01', sessions: 5 });
    await db.doc(achievementPath(uid, 'runs-100')).set({ schemaVersion: 1, achievementId: 'runs-100' });
    await db.doc(dailyStatsPath(uid, Object.keys(live.days)[0]!)).delete();

    const lines: string[] = [];
    const report = await runRebuildProgress(['--project', CORE_PROJECT, '--uid', uid], { FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST }, (line) => void lines.push(line));

    expect(report.stats).toMatchObject({ written: 'set', days: Object.keys(live.days).length });
    expect(lines.some((line) => line.includes(`users/${uid}/stats: set`))).toBe(true);
    expect(await statsContent(db, uid)).toEqual(live);
    expect(await readDoc(db, achievementPath(uid, 'first-run'))).toEqual(liveFirstRun);
    await rebuildUserStats(context, uid);
    expect(await statsContent(db, uid)).toEqual(live);
  });

  it('loses no update when it races live processing of the same user', async () => {
    for (let round = 0; round < 2; round += 1) {
      const uid = newUid();
      for (const days of [3, 2]) {
        const { id } = await writeSessionAt(db, uid, daysAgo(days), { seed: 370 + 10 * round + days, startLevel: 1, targetPeak: 3, order: 10 - days });
        await runSessionPipeline(context, uid, id);
      }
      const pending = await Promise.all([1, 0].map((days) =>
        writeSessionAt(db, uid, daysAgo(days), { seed: 370 + 10 * round + days, startLevel: 1, targetPeak: 3, order: 10 - days })));

      await Promise.all([
        withRedelivery(() => rebuildUserStats(context, uid)),
        ...pending.map(({ id }) => deliver(context, uid, id)),
        withRedelivery(() => rebuildUserStats(context, uid)),
      ]);

      const raced = await statsContent(db, uid);
      expect(raced.summary, `round ${round}`).toMatchObject({ sessions: 4, validRuns: 4, streak: { current: 4 } });
      await rebuildUserStats(context, uid);
      expect(await statsContent(db, uid), `round ${round}`).toEqual(raced);
    }
  });

  it('refuses to overwrite stats from newer code', async () => {
    const uid = newUid();
    const newer = { schemaVersion: 1, aggregateVersion: 9 };
    await db.doc(statsPath(uid)).set(newer);

    await expect(rebuildUserStats(context, uid)).rejects.toThrow(/newer code/);
    expect(await readDoc(db, statsPath(uid))).toEqual(newer);
  });

  it('leaves a user whose account is being deleted alone', async () => {
    const uid = newUid();
    await db.doc(`accountDeletions/${uid}`).set({ status: 'requested' });
    await db.doc(statsPath(uid)).set({ schemaVersion: 1, aggregateVersion: 1, sessions: 1 });

    expect(await rebuildUserStats(context, uid)).toMatchObject({ written: 'account-deleted' });
    expect(await readDoc(db, statsPath(uid))).toEqual({ schemaVersion: 1, aggregateVersion: 1, sessions: 1 });
  });
});
