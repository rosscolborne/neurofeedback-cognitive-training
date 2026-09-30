import { afterAll, describe, expect, it } from 'vitest';
import { resolveTarget, runRebuildProgress, runRedriveSessions } from '../../scripts/cli';
import { runSessionPipeline } from '../../src/pipeline';
import { coreContext, minutesAgo, writeSession } from '../helpers/core';
import { content, CORE_PROJECT, emulatorFirestore, newUid, progressPath, readDoc, sessionPath, ts } from '../helpers/emulator';

// The admin scripts (functions/scripts), run in-process against the emulator.

const { db, close } = emulatorFirestore(CORE_PROJECT);
const context = coreContext(db);
afterAll(close);

const env = { FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST };
const lines: string[] = [];
const out = (line: string) => void lines.push(line);

describe('script safety', () => {
  it('has no default project and never reaches a real one by accident', () => {
    expect(() => resolveTarget(undefined, false, env)).toThrow(/--project is required/);
    expect(() => resolveTarget('nfct-dev', false, env)).toThrow(/demo-\*/);
    expect(() => resolveTarget('demo-nfct-functions-core', true, env)).toThrow(/--live/);
    expect(() => resolveTarget('nfct-dev', false, {})).toThrow(/without --live/);
    expect(() => resolveTarget('demo-nfct-functions-core', true, {})).toThrow(/only exists in the emulator/);
    expect(() => resolveTarget('Not A Project', true, {})).toThrow(/not a Firebase project ID/);
    expect(resolveTarget('demo-nfct-functions-core', false, env)).toEqual({ projectId: 'demo-nfct-functions-core', emulator: true });
    expect(resolveTarget('nfct-dev', true, {})).toEqual({ projectId: 'nfct-dev', emulator: false });
  });
});

describe('rebuild-progress', () => {
  it('replays stored results in play order to exactly the progress live processing built, upgrades included', async () => {
    const uid = newUid();
    // Live processing, out of order, so one session is flagged and later upgraded.
    const later = await writeSession(db, uid, { seed: 71, startLevel: 3, targetPeak: 6, endedAtMs: minutesAgo(10), order: 3 });
    await runSessionPipeline(context, uid, later.id);
    for (const [order, plan] of [
      [1, { seed: 72, startLevel: 1, targetPeak: 5, endedAtMs: minutesAgo(30) }],
      [2, { seed: 73, startLevel: 2, targetPeak: 4, endedAtMs: minutesAgo(20), status: 'abandoned' as const }],
      [4, { seed: 74, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(5), rtMs: 200 }],
    ] as const) {
      const { id } = await writeSession(db, uid, { ...plan, order });
      await runSessionPipeline(context, uid, id);
    }
    expect((await readDoc(db, sessionPath(uid, later.id)))?.result.reasons).toEqual(['start-level-unlocked-later']);
    const live = await readDoc(db, progressPath(uid));

    const reports = await runRebuildProgress(['--project', CORE_PROJECT, '--uid', uid], env, out);

    expect(reports).toMatchObject([{ gameId: 'mental-math', written: 'set' }]);
    const rebuilt = await readDoc(db, progressPath(uid));
    expect(content(rebuilt)).toEqual(content(live));
    expect(rebuilt?.updatedAt).not.toEqual(live?.updatedAt);
  });

  it('repairs corrupted progress, and is deterministic when re-run', async () => {
    const uid = newUid();
    const { id } = await writeSession(db, uid, { seed: 75, startLevel: 1, targetPeak: 4, endedAtMs: minutesAgo(10) });
    await runSessionPipeline(context, uid, id);
    const live = await readDoc(db, progressPath(uid));
    await db.doc(progressPath(uid)).update({ sessionsCompleted: 99, bestPeakLevel: { 'timed-90': 10 } });

    await runRebuildProgress(['--project', CORE_PROJECT, '--uid', uid, '--game', 'mental-math'], env, out);
    const once = await readDoc(db, progressPath(uid));
    await runRebuildProgress(['--project', CORE_PROJECT, '--uid', uid], env, out);

    expect(content(once)).toEqual(content(live));
    expect(content(await readDoc(db, progressPath(uid)))).toEqual(content(live));
  });

  it("finishes a start-level upgrade that an invocation's budget left, with no budget of its own", async () => {
    const uid = newUid();
    for (let index = 0; index < 3; index += 1) {
      const fast = await writeSession(db, uid, { seed: 80 + index, startLevel: 2, targetPeak: 3, rtMs: 200, endedAtMs: minutesAgo(60 - index), order: index });
      await runSessionPipeline(context, uid, fast.id);
    }
    const locked = await writeSession(db, uid, { seed: 84, startLevel: 2, targetPeak: 4, endedAtMs: minutesAgo(30), order: 9_999 });
    await runSessionPipeline(context, uid, locked.id);
    const unlocking = await writeSession(db, uid, { seed: 85, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(10), order: 9_000 });
    const starved = await runSessionPipeline(coreContext(db, { limits: { reconcileScanBudget: 1, scanPageSize: 1 } }), uid, unlocking.id);
    expect(starved.reconciled[0]?.report.stopped).toBe('budget');
    expect((await readDoc(db, sessionPath(uid, locked.id)))?.result.validity).toBe('flagged');

    await runRebuildProgress(['--project', CORE_PROJECT, '--uid', uid], env, out);

    expect((await readDoc(db, sessionPath(uid, locked.id)))?.result).toMatchObject({ validity: 'valid', reasons: ['start-level-unlocked-later'] });
    expect(await readDoc(db, progressPath(uid))).toMatchObject({ sessionsCompleted: 5, bestPeakLevel: { 'timed-90': 4 } });
  });

  it('refuses to overwrite progress from newer code', async () => {
    const uid = newUid();
    const newer = { schemaVersion: 1, aggregateVersion: 9, gameId: 'mental-math' };
    await db.doc(progressPath(uid)).set(newer);

    await expect(runRebuildProgress(['--project', CORE_PROJECT, '--uid', uid, '--game', 'mental-math'], env, out)).rejects.toThrow(/newer code/);
    expect(await readDoc(db, progressPath(uid))).toEqual(newer);
  });

  it('refuses to run outside the emulator without --live', async () => {
    await expect(runRebuildProgress(['--project', 'nfct-dev', '--uid', 'someone'], {}, out)).rejects.toThrow(/without --live/);
  });
});

describe('redrive-sessions', () => {
  it('lists with --dry-run, then re-drives, a user\'s pending sessions through the trigger pipeline', async () => {
    const uid = newUid();
    const { id } = await writeSession(db, uid, { seed: 76, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(10) });

    const dry = await runRedriveSessions(['--project', CORE_PROJECT, '--uid', uid, '--older-than-minutes', '0', '--dry-run'], env, out);
    expect(dry.targets.map(({ sessionId }) => sessionId)).toEqual([id]);
    expect((await readDoc(db, sessionPath(uid, id)))?.result).toBeUndefined();

    const report = await runRedriveSessions(['--project', CORE_PROJECT, '--uid', uid, '--older-than-minutes', '0'], env, out);
    expect(report.results).toMatchObject([{ sessionId: id, state: 'pending', now: 'valid' }]);
    expect((await readDoc(db, sessionPath(uid, id)))?.result.validity).toBe('valid');
  });

  it('finds failed and unsupported sessions across users with the processing sweep index', async () => {
    const uid = newUid();
    const failed = await writeSession(db, uid, { seed: 77, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(10), order: 1 });
    await db.doc(sessionPath(uid, failed.id)).update({ processing: { state: 'failed', reason: 'internal-error', attempts: 3, updatedAt: ts(Date.now()) } });

    const report = await runRedriveSessions(['--project', CORE_PROJECT, '--state', 'failed', '--older-than-minutes', '0', '--limit', '500'], env, out);

    expect(report.results).toContainEqual(expect.objectContaining({ uid, sessionId: failed.id, state: 'failed', now: 'valid' }));
    const session = await readDoc(db, sessionPath(uid, failed.id));
    expect(session?.processing).toBeUndefined();
    expect(session?.result.validity).toBe('valid');
  });

  it('rejects unknown states and bad numbers', async () => {
    await expect(runRedriveSessions(['--project', CORE_PROJECT, '--state', 'done'], env, out)).rejects.toThrow(/Unknown --state/);
    await expect(runRedriveSessions(['--project', CORE_PROJECT, '--limit', '0'], env, out)).rejects.toThrow(/--limit/);
  });
});
