import { afterAll, describe, expect, it, vi } from 'vitest';
import { decideSession, evaluateSession, GAME_MODULE_REGISTRY, PROGRESS_AGGREGATE_VERSION, type GameProgress } from '@nfct/shared';
import { handleSessionCreated, runSessionPipeline } from '../../src/pipeline';
import { rebuildUserProgress } from '../../src/rebuild';
import { reconcileUser } from '../../src/redrive';
import { coreContext, deliver, minutesAgo, writeSession } from '../helpers/core';
import { content, CORE_PROJECT, emulatorFirestore, newSessionId, newUid, progressPath, readDoc, sessionDoc, sessionPath, ts } from '../helpers/emulator';

// Aggregate compatibility. This file runs as a build whose progress reducer is
// aggregateVersion 2 (the shared constant is mocked), so progress written by
// aggregateVersion 1 is "older" and progress from aggregateVersion 3 "newer".
vi.mock('../../../shared/schemas/progress', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../shared/schemas/progress')>()),
  PROGRESS_AGGREGATE_VERSION: 2,
}));

const { db, close } = emulatorFirestore(CORE_PROJECT);
const context = coreContext(db);
afterAll(close);

/** A session processed by an earlier build: its stored result, as trusted scoring wrote it. */
async function storedProcessedSession(
  uid: string,
  plan: { seed: number; startLevel: number; targetPeak: number; endedAtMs: number; order: number; id?: string },
) {
  const id = plan.id ?? newSessionId(plan.order);
  const doc = sessionDoc(uid, { ...plan, createdAt: ts(Date.now()) });
  const evaluation = evaluateSession(doc, { uid, sessionId: id });
  if (evaluation.kind === 'unsupported') throw new Error('unexpected');
  const { result } = decideSession(evaluation, null, { sessionId: id, processedAt: ts(Date.now()), registry: GAME_MODULE_REGISTRY });
  await db.doc(sessionPath(uid, id)).set({ ...doc, result });
  return id;
}

describe('aggregate compatibility', () => {
  it('runs as aggregateVersion 2 in this file', () => {
    expect(PROGRESS_AGGREGATE_VERSION).toBe(2);
  });

  it('rebuilds progress maintained by an older reducer from the stored results, then applies the session', async () => {
    const uid = newUid();
    const first = await storedProcessedSession(uid, { seed: 61, startLevel: 1, targetPeak: 4, endedAtMs: minutesAgo(40), order: 1 });
    await storedProcessedSession(uid, { seed: 62, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(30), order: 2 });
    // What the aggregateVersion 1 reducer left behind: nothing of it is trusted.
    await db.doc(progressPath(uid)).set({
      schemaVersion: 1, aggregateVersion: 1, updatedAt: ts(0), gameId: 'mental-math', gameVersion: 1,
      sessionsCompleted: 99, activeMs: 1, lastPlayedAt: ts(0), bestPeakLevel: { 'timed-90': 9 }, unlocked: { 'timed-90': 8 },
      bests: {}, bestsArchive: {},
    });
    const { id } = await writeSession(db, uid, { seed: 63, startLevel: 3, targetPeak: 5, endedAtMs: minutesAgo(10), order: 3 });

    const report = await runSessionPipeline(context, uid, id);

    // Rebuilt from the two stored results: best peak 4 unlocks level 3, so the new session is valid.
    expect(report.outcome).toMatchObject({ status: 'processed', validity: 'valid' });
    const progress = (await readDoc(db, progressPath(uid))) as GameProgress;
    expect(progress).toMatchObject({
      aggregateVersion: 2, sessionsCompleted: 3, activeMs: 270_000, bestPeakLevel: { 'timed-90': 5 }, unlocked: { 'timed-90': 4 },
    });
    expect(progress.bests['timed-90:1']?.peakLevel?.sessionId).toBe(first);
    expect(progress.bests['timed-90:3']?.score?.sessionId).toBe(id);
  });

  it('rebuilds older progress exactly once when several sessions race to apply to it', async () => {
    const uid = newUid();
    await storedProcessedSession(uid, { seed: 66, startLevel: 1, targetPeak: 4, endedAtMs: minutesAgo(50), order: 1 });
    await db.doc(progressPath(uid)).set({
      schemaVersion: 1, aggregateVersion: 1, updatedAt: ts(0), gameId: 'mental-math', gameVersion: 1,
      sessionsCompleted: 99, activeMs: 1, lastPlayedAt: ts(0), bestPeakLevel: {}, unlocked: {}, bests: {}, bestsArchive: {},
    });
    const racing = await Promise.all([2, 3, 4].map((order) =>
      writeSession(db, uid, { seed: 66 + order, startLevel: order === 4 ? 3 : 1, targetPeak: order + 1, endedAtMs: minutesAgo(50 - order), order })));

    await Promise.all(racing.map(({ id }) => deliver(context, uid, id)));

    // One rebuild (from the one stored result), then each racing session applied once on top of it.
    expect(await readDoc(db, progressPath(uid))).toMatchObject({
      aggregateVersion: 2, sessionsCompleted: 4, activeMs: 360_000, bestPeakLevel: { 'timed-90': 5 },
    });
    for (const { id } of racing) expect((await readDoc(db, sessionPath(uid, id)))?.result.validity).toBe('valid');
  });

  it('upgrades a session flagged against rebuilt progress when the same commit\'s cascade unlocks it: the same end state in either order', async () => {
    // Stored by an earlier build: U valid (peak 3, unlocks 2); L flagged start-level-locked at 2 (peak 6),
    // whose upgrade never ran. S (start 4) arrives when progress is from an older aggregate version.
    const endedAt = { u: minutesAgo(50), l: minutesAgo(40), s: minutesAgo(10) };
    const setUp = async () => {
      const uid = newUid();
      await storedProcessedSession(uid, { seed: 70, startLevel: 1, targetPeak: 3, endedAtMs: endedAt.u, order: 1, id: 'rebuilt-u-session-doc' });
      await storedProcessedSession(uid, { seed: 71, startLevel: 2, targetPeak: 6, endedAtMs: endedAt.l, order: 2, id: 'rebuilt-l-session-doc' });
      expect((await readDoc(db, sessionPath(uid, 'rebuilt-l-session-doc')))?.result).toMatchObject({ validity: 'flagged', reasons: ['start-level-locked'] });
      await db.doc(progressPath(uid)).set({
        schemaVersion: 1, aggregateVersion: 1, updatedAt: ts(0), gameId: 'mental-math', gameVersion: 1,
        sessionsCompleted: 99, activeMs: 1, lastPlayedAt: ts(0), bestPeakLevel: {}, unlocked: {}, bests: {}, bestsArchive: {},
      });
      return uid;
    };
    const finalState = async (uid: string) => ({
      validities: await Promise.all(['rebuilt-u-session-doc', 'rebuilt-l-session-doc', 'rebuilt-s-session-doc']
        .map(async (id) => (await readDoc(db, sessionPath(uid, id)))?.result?.validity)),
      progress: content(await readDoc(db, progressPath(uid))),
    });

    // S processed first: its own transaction rebuilds progress (unlocked 2), decides S flagged, then the cascade
    // upgrades L (unlocked 5), which reaches S in the same commit.
    const first = await setUp();
    await writeSession(db, first, { seed: 72, startLevel: 4, targetPeak: 5, endedAtMs: endedAt.s, id: 'rebuilt-s-session-doc' });
    const report = await runSessionPipeline(context, first, 'rebuilt-s-session-doc');
    expect(report.outcome).toMatchObject({ status: 'processed', validity: 'valid', upgraded: ['rebuilt-l-session-doc'], reconcile: null });
    expect((await readDoc(db, sessionPath(first, 'rebuilt-s-session-doc')))?.result).toMatchObject({
      validity: 'valid', reasons: ['start-level-unlocked-later'], recordKey: 'timed-90:4',
    });

    // The other order: the rebuild and its upgrade run first (admin), then S is processed against current progress.
    const second = await setUp();
    await rebuildUserProgress(context, second, 'mental-math');
    await reconcileUser(context, second);
    await writeSession(db, second, { seed: 72, startLevel: 4, targetPeak: 5, endedAtMs: endedAt.s, id: 'rebuilt-s-session-doc' });
    await runSessionPipeline(context, second, 'rebuilt-s-session-doc');
    expect((await readDoc(db, sessionPath(second, 'rebuilt-s-session-doc')))?.result).toMatchObject({ validity: 'valid', reasons: [] });

    const [a, b] = [await finalState(first), await finalState(second)];
    expect(a.validities).toEqual(['valid', 'valid', 'valid']);
    expect(a).toEqual(b);
    // Totals were counted once each: S's when it was decided, not again by its upgrade.
    expect(a.progress).toMatchObject({ aggregateVersion: 2, sessionsCompleted: 3, activeMs: 270_000, bestPeakLevel: { 'timed-90': 6 }, unlocked: { 'timed-90': 5 } });
    // A redelivery changes nothing.
    const before = await readDoc(db, progressPath(first));
    expect((await runSessionPipeline(context, first, 'rebuilt-s-session-doc')).outcome.status).toBe('already-processed');
    expect(await readDoc(db, progressPath(first))).toEqual(before);
  });

  it.each([
    ['a newer aggregateVersion', { aggregateVersion: 3 }],
    ['a newer gameVersion than any registered module', { gameVersion: 2 }],
    ['a newer schemaVersion', { schemaVersion: 2 }],
  ])('never writes progress with %s: retried, then failed safely', async (_label, change) => {
    const uid = newUid();
    const newer = {
      schemaVersion: 1, aggregateVersion: 2, updatedAt: ts(0), gameId: 'mental-math', gameVersion: 1,
      sessionsCompleted: 5, activeMs: 450_000, lastPlayedAt: ts(0), bestPeakLevel: {}, unlocked: {}, bests: {}, bestsArchive: {},
      ...change,
    };
    await db.doc(progressPath(uid)).set(newer);
    const { id } = await writeSession(db, uid, { seed: 64, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(10) });
    const event = (ageMs: number) => ({ params: { uid, sessionId: id }, time: new Date(Date.now() - ageMs).toISOString() });

    await expect(handleSessionCreated(context, event(0))).rejects.toThrow(/newer code/);
    await handleSessionCreated(context, event(context.limits.retryWindowMs + 1_000));

    const session = await readDoc(db, sessionPath(uid, id));
    expect(session?.result).toBeUndefined();
    expect(session?.processing).toMatchObject({ state: 'failed', reason: 'progress-newer-than-code', attempts: 1 });
    expect(await readDoc(db, progressPath(uid))).toEqual(newer);
  });

  it('refuses unreadable progress rather than guess, and records why', async () => {
    const uid = newUid();
    await db.doc(progressPath(uid)).set({ schemaVersion: 1, aggregateVersion: 2, gameId: 'mental-math' });
    const { id } = await writeSession(db, uid, { seed: 65, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(10) });

    await handleSessionCreated(context, { params: { uid, sessionId: id }, time: new Date(0).toISOString() });

    expect((await readDoc(db, sessionPath(uid, id)))?.processing).toMatchObject({ state: 'failed', reason: 'progress-unreadable' });
  });
});
