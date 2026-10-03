import { afterAll, describe, expect, it } from 'vitest';
import { createGameModuleRegistry, defineGame, defineGameVersionModule, mentalMathV1 as mm, mentalMathV1Module } from '@nfct/shared';
import { SWEEP_POLICY } from '../../src/policy';
import { sweepSessions } from '../../src/sweep';
import { coreContext, writeSessionAt } from '../helpers/core';
import { CORE_PROJECT, emulatorFirestore, newUid, progressPath, readDoc, sessionPath, ts } from '../helpers/emulator';

// The scheduled sweep (sweep.ts), run through its handler core against the
// Firestore emulator. Each test writes its sessions at its own fixed server
// time, years in the past, and runs the sweep with a clock just after it, so
// a sweep window holds only that test's sessions.

const { db, close } = emulatorFirestore(CORE_PROJECT);
afterAll(close);

const HOUR = 60 * 60_000;
/** A distinct, fixed server time per test. */
const at = (test: number) => Date.UTC(2001, 0, 1) + test * 30 * 24 * HOUR;
const sweepAt = (ms: number, registry = createGameModuleRegistry([mentalMathV1Module])) =>
  sweepSessions(coreContext(db, { now: () => ts(ms), registry }));

describe('sweepUnprocessedSessions', () => {
  it('recovers a session whose trigger never ran, once it has settled, and applies it exactly once', async () => {
    const uid = newUid();
    const created = at(1);
    const missed = await writeSessionAt(db, uid, created, { seed: 500, startLevel: 1, targetPeak: 4, order: 1 });
    const sweepTime = created + 2 * HOUR;
    const minute = 60_000;
    // Just inside the settle cutoff at sweep time: may still have a live delivery.
    const recent = await writeSessionAt(db, uid, sweepTime - (SWEEP_POLICY.settleAfterMs - minute), { seed: 501, startLevel: 1, targetPeak: 3, order: 2 });
    // Just past it: settled.
    const settled = await writeSessionAt(db, uid, sweepTime - (SWEEP_POLICY.settleAfterMs + minute), { seed: 505, startLevel: 1, targetPeak: 2, order: 3 });

    const report = await sweepAt(sweepTime);

    // The recent one is left for a later run.
    expect(report.targets.map(({ sessionId }) => sessionId).sort()).toEqual([missed.id, settled.id].sort());
    expect(report.results.map(({ sessionId }) => sessionId).sort()).toEqual([missed.id, settled.id].sort());
    expect(report.results.every(({ state, now }) => state === 'pending' && now === 'valid')).toBe(true);
    expect((await readDoc(db, sessionPath(uid, recent.id)))?.result).toBeUndefined();
    expect(await readDoc(db, progressPath(uid))).toMatchObject({ sessionsCompleted: 2 });

    // A later run picks up the other one; nothing is counted twice.
    const later = await sweepAt(created + 3 * HOUR);
    expect(later.results).toMatchObject([{ sessionId: recent.id, now: 'valid' }]);
    expect((await sweepAt(created + 4 * HOUR)).targets).toEqual([]);
    expect(await readDoc(db, progressPath(uid))).toMatchObject({ sessionsCompleted: 3 });
  });

  it('re-drives failed sessions below the attempt cap and reports those at it for an operator', async () => {
    const created = at(2);
    const uid = newUid();
    const failed = (attempts: number) => ({ processing: { state: 'failed', reason: 'internal-error', attempts, updatedAt: ts(created) } });
    const retried = await writeSessionAt(db, uid, created, { seed: 502, startLevel: 1, targetPeak: 3, order: 1 }, failed(1));
    const capped = await writeSessionAt(db, uid, created, { seed: 503, startLevel: 1, targetPeak: 3, order: 2 }, failed(SWEEP_POLICY.maxAttempts));

    const report = await sweepAt(created + 2 * HOUR);

    expect(report.results).toMatchObject([{ sessionId: retried.id, state: 'failed', now: 'valid' }]);
    expect(report.capped).toMatchObject([{ sessionId: capped.id, state: 'failed', attempts: SWEEP_POLICY.maxAttempts }]);
    expect((await readDoc(db, sessionPath(uid, capped.id)))?.processing).toMatchObject({ state: 'failed', attempts: SWEEP_POLICY.maxAttempts });
    expect((await readDoc(db, sessionPath(uid, retried.id)))?.processing).toBeUndefined();
  });

  it('leaves an unsupported session alone until a build has its module, then processes it', async () => {
    const created = at(3);
    const uid = newUid();
    const { id } = await writeSessionAt(db, uid, created, { seed: 504, startLevel: 1, targetPeak: 3 }, {
      gameVersion: 3, processing: { state: 'unsupported', reason: 'unknown-game-version', attempts: 1, updatedAt: ts(created) },
    });

    const before = await sweepAt(created + 2 * HOUR);
    expect(before.targets).toEqual([]);
    // Not re-driven, so no attempt is spent on it.
    expect((await readDoc(db, sessionPath(uid, id)))?.processing).toMatchObject({ state: 'unsupported', attempts: 1 });

    const v3 = defineGameVersionModule({
      definition: defineGame({ ...mm.definition, gameVersion: 3 }),
      reasonOutcomes: mm.REASON_OUTCOMES,
      check: (session) => mm.checkSession(session),
    });
    const after = await sweepAt(created + 3 * HOUR, createGameModuleRegistry([mentalMathV1Module, v3]));

    expect(after.results).toMatchObject([{ sessionId: id, state: 'unsupported', now: 'valid' }]);
    const session = await readDoc(db, sessionPath(uid, id));
    expect(session?.processing).toBeUndefined();
    expect(session?.result.validity).toBe('valid');
  });

  it('is exported as a scheduled function whose handler runs the sweep', async () => {
    // index.ts initialises the default Admin app; the emulator guard above has already checked the environment.
    const { sweepUnprocessedSessions } = await import('../../src/index');
    expect(typeof sweepUnprocessedSessions.run).toBe('function');
    await expect(sweepUnprocessedSessions.run({ scheduleTime: new Date().toISOString() } as never)).resolves.toBeUndefined();
  });
});
