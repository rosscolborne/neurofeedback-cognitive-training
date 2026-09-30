import { afterAll, describe, expect, it } from 'vitest';
import { runSessionPipeline } from '../../src/pipeline';
import { processSession } from '../../src/processSession';
import { reconcileUser } from '../../src/redrive';
import { coreContext, minutesAgo, writeSession, type Written } from '../helpers/core';
import { content, CORE_PROJECT, emulatorFirestore, newUid, progressPath, readDoc, sessionPath, type Plan } from '../helpers/emulator';

// Out-of-order delivery and the start-level upgrade, against Firestore. The
// end state must not depend on the order sessions are processed in.

const { db, close } = emulatorFirestore(CORE_PROJECT);
const context = coreContext(db);
afterAll(close);

async function resultOf(uid: string, id: string) {
  return (await readDoc(db, sessionPath(uid, id)))?.result;
}

describe('out-of-order processing', () => {
  it('processes a truly pending earlier session first, so a session it unlocked is never flagged', async () => {
    const uid = newUid();
    // Two sessions queued offline, delivered together; the later one is processed first.
    const earlier = await writeSession(db, uid, { seed: 21, startLevel: 1, targetPeak: 5, endedAtMs: minutesAgo(20), order: 1 });
    const later = await writeSession(db, uid, { seed: 22, startLevel: 3, targetPeak: 6, endedAtMs: minutesAgo(10), order: 2 });

    const report = await runSessionPipeline(context, uid, later.id);

    expect(report.outcome).toMatchObject({ status: 'processed', validity: 'valid' });
    expect(report.outcome.status === 'processed' && report.outcome.predecessors.map(({ sessionId }) => sessionId)).toEqual([earlier.id]);
    expect(await resultOf(uid, later.id)).toMatchObject({ validity: 'valid', reasons: [], recordKey: 'timed-90:3' });
    expect(await resultOf(uid, earlier.id)).toMatchObject({ validity: 'valid', reasons: [] });
    // The earlier session's own delivery then finds it processed.
    expect((await runSessionPipeline(context, uid, earlier.id)).outcome.status).toBe('already-processed');
    expect(await readDoc(db, progressPath(uid))).toMatchObject({
      sessionsCompleted: 2, activeMs: 180_000, bestPeakLevel: { 'timed-90': 6 }, unlocked: { 'timed-90': 5 },
    });
  });

  it('upgrades a session flagged start-level-locked when a session it could not see unlocks its level (another device)', async () => {
    const uid = newUid();
    const later = await writeSession(db, uid, { seed: 23, startLevel: 3, targetPeak: 6, endedAtMs: minutesAgo(10), order: 2 });
    await runSessionPipeline(context, uid, later.id);
    const flagged = await resultOf(uid, later.id);
    expect(flagged).toMatchObject({ validity: 'flagged', reasons: ['start-level-locked'] });
    const flaggedProgress = await readDoc(db, progressPath(uid));

    // The earlier session arrives later, from another device's offline queue.
    const earlier = await writeSession(db, uid, { seed: 24, startLevel: 1, targetPeak: 5, endedAtMs: minutesAgo(20), order: 1 });
    const report = await runSessionPipeline(context, uid, earlier.id);

    expect(report.reconciled).toMatchObject([{ gameId: 'mental-math', modeId: 'timed-90', report: { upgraded: [later.id] } }]);
    const upgraded = await resultOf(uid, later.id);
    const { validity: _validity, reasons: _reasons, ...stored } = flagged;
    expect(upgraded).toMatchObject({
      ...stored, // processedAt, scoringVersion and every stored trusted value are unchanged
      validity: 'valid',
      reasons: ['start-level-unlocked-later'],
      recordKey: 'timed-90:3',
      personalBest: true,
    });
    const progress = await readDoc(db, progressPath(uid));
    // Totals were counted once, when the session was processed as flagged.
    expect(flaggedProgress).toMatchObject({ sessionsCompleted: 1, activeMs: 90_000 });
    expect(progress).toMatchObject({ sessionsCompleted: 2, activeMs: 180_000, bestPeakLevel: { 'timed-90': 6 }, unlocked: { 'timed-90': 5 } });
    expect(progress?.bests['timed-90:3'].score.sessionId).toBe(later.id);
    expect(progress?.bests['timed-90:1'].score.sessionId).toBe(earlier.id);
  });

  it('cascades: each upgrade can unlock the next', async () => {
    const uid = newUid();
    const c = await writeSession(db, uid, { seed: 25, startLevel: 5, targetPeak: 7, endedAtMs: minutesAgo(30), order: 1 });
    await runSessionPipeline(context, uid, c.id);
    const b = await writeSession(db, uid, { seed: 26, startLevel: 3, targetPeak: 6, endedAtMs: minutesAgo(20), order: 2 });
    await runSessionPipeline(context, uid, b.id);
    expect((await resultOf(uid, c.id)).validity).toBe('flagged');
    expect((await resultOf(uid, b.id)).validity).toBe('flagged');

    const a = await writeSession(db, uid, { seed: 27, startLevel: 1, targetPeak: 4, endedAtMs: minutesAgo(10), order: 3 });
    const report = await runSessionPipeline(context, uid, a.id);

    expect(report.reconciled[0]?.report.upgraded).toEqual([b.id, c.id]);
    for (const id of [a.id, b.id, c.id]) expect((await resultOf(uid, id)).validity).toBe('valid');
    expect(await readDoc(db, progressPath(uid))).toMatchObject({
      sessionsCompleted: 3, activeMs: 270_000, bestPeakLevel: { 'timed-90': 7 }, unlocked: { 'timed-90': 6 },
    });
  });

  it('never upgrades a session flagged for another reason as well', async () => {
    const uid = newUid();
    const fast = await writeSession(db, uid, { seed: 28, startLevel: 3, targetPeak: 5, rtMs: 200, endedAtMs: minutesAgo(10), order: 2 });
    await runSessionPipeline(context, uid, fast.id);
    const flagged = await resultOf(uid, fast.id);
    expect(flagged).toMatchObject({ validity: 'flagged', reasons: ['rt-below-floor', 'start-level-locked'] });

    const unlocking = await writeSession(db, uid, { seed: 29, startLevel: 1, targetPeak: 6, endedAtMs: minutesAgo(20), order: 1 });
    await runSessionPipeline(context, uid, unlocking.id);

    expect(await resultOf(uid, fast.id)).toEqual(flagged);
    expect((await readDoc(db, progressPath(uid)))?.bests['timed-90:3']).toBeUndefined();
  });

  it('never downgrades: replays and reconciles leave valid sessions and progress as they are', async () => {
    const uid = newUid();
    const later = await writeSession(db, uid, { seed: 30, startLevel: 2, targetPeak: 4, endedAtMs: minutesAgo(10), order: 2 });
    await runSessionPipeline(context, uid, later.id);
    const earlier = await writeSession(db, uid, { seed: 31, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(20), order: 1 });
    await runSessionPipeline(context, uid, earlier.id);
    expect((await resultOf(uid, later.id)).validity).toBe('valid');
    const progress = await readDoc(db, progressPath(uid));
    const results = [await resultOf(uid, earlier.id), await resultOf(uid, later.id)];

    await runSessionPipeline(context, uid, later.id);
    await runSessionPipeline(context, uid, earlier.id);
    await reconcileUser(context, uid);

    expect([await resultOf(uid, earlier.id), await resultOf(uid, later.id)]).toEqual(results);
    expect(await readDoc(db, progressPath(uid))).toEqual(progress);
  });
});

describe('bounded work', () => {
  it('stops looking for pending predecessors at its read budget; the upgrade repairs what it missed', async () => {
    const uid = newUid();
    const pending = await writeSession(db, uid, { seed: 40, startLevel: 1, targetPeak: 5, endedAtMs: minutesAgo(60), order: 0 });
    for (let index = 1; index <= 4; index += 1) {
      const other = await writeSession(db, uid, { seed: 40 + index, startLevel: 1, targetPeak: 2, endedAtMs: minutesAgo(50 - index), order: index });
      await runSessionPipeline(context, uid, other.id);
    }
    const locked = await writeSession(db, uid, { seed: 49, startLevel: 3, targetPeak: 4, endedAtMs: minutesAgo(5), order: 9 });

    const tight = coreContext(db, { limits: { predecessorScanBudget: 3, scanPageSize: 2 } });
    const outcome = await processSession(tight, uid, locked.id);
    expect(outcome).toMatchObject({ status: 'processed', validity: 'flagged', predecessors: [] });

    await runSessionPipeline(context, uid, pending.id);
    expect(await resultOf(uid, locked.id)).toMatchObject({ validity: 'valid', reasons: ['start-level-unlocked-later'] });
    expect(await readDoc(db, progressPath(uid))).toMatchObject({ sessionsCompleted: 6 });
  });

  it('pages past sessions flagged for other reasons at the same start level, so none can hide an upgradable one', async () => {
    const uid = newUid();
    // More sessions flagged for another reason at level 2 than the old per-level cap (20), all sorting first.
    for (let index = 0; index < 22; index += 1) {
      const fast = await writeSession(db, uid, { seed: 300 + index, startLevel: 2, targetPeak: 3, rtMs: 200, endedAtMs: minutesAgo(90 - index), order: index });
      await runSessionPipeline(context, uid, fast.id);
    }
    const locked = await writeSession(db, uid, { seed: 330, startLevel: 2, targetPeak: 4, endedAtMs: minutesAgo(30), order: 9_999 });
    await runSessionPipeline(context, uid, locked.id);
    const unlocking = await writeSession(db, uid, { seed: 331, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(10), order: 9_000 });

    const paged = coreContext(db, { limits: { scanPageSize: 5 } });
    const report = await runSessionPipeline(paged, uid, unlocking.id);

    expect(report.reconciled[0]?.report).toEqual({ upgraded: [locked.id], stopped: 'fixpoint' });
    expect(await resultOf(uid, locked.id)).toMatchObject({ validity: 'valid', reasons: ['start-level-unlocked-later'] });
    expect(await readDoc(db, progressPath(uid))).toMatchObject({ sessionsCompleted: 24, bestPeakLevel: { 'timed-90': 4 } });
  });

  it("stops at an invocation's scan budget and says so; the admin reconcile, which has no budget, finishes it", async () => {
    const uid = newUid();
    for (let index = 0; index < 5; index += 1) {
      const fast = await writeSession(db, uid, { seed: 340 + index, startLevel: 2, targetPeak: 3, rtMs: 200, endedAtMs: minutesAgo(60 - index), order: index });
      await runSessionPipeline(context, uid, fast.id);
    }
    const locked = await writeSession(db, uid, { seed: 350, startLevel: 2, targetPeak: 4, endedAtMs: minutesAgo(30), order: 9_999 });
    await runSessionPipeline(context, uid, locked.id);
    const unlocking = await writeSession(db, uid, { seed: 351, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(10), order: 9_000 });

    const tight = coreContext(db, { limits: { reconcileScanBudget: 3, scanPageSize: 2 } });
    const report = await runSessionPipeline(tight, uid, unlocking.id);
    expect(report.reconciled[0]?.report).toEqual({ upgraded: [], stopped: 'budget' });
    expect((await resultOf(uid, locked.id)).validity).toBe('flagged');

    // The admin reconcile ignores the tight limits it is given.
    const [admin] = await reconcileUser(tight, uid);
    expect(admin?.report).toEqual({ upgraded: [locked.id], stopped: 'fixpoint' });
    expect((await resultOf(uid, locked.id)).validity).toBe('valid');
  });

  it('reconciles again when an already-valid session is redelivered (a reconcile lost after its commit)', async () => {
    const uid = newUid();
    const locked = await writeSession(db, uid, { seed: 360, startLevel: 2, targetPeak: 3, endedAtMs: minutesAgo(20), order: 1 });
    await runSessionPipeline(context, uid, locked.id);
    const unlocking = await writeSession(db, uid, { seed: 361, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(10), order: 2 });
    // The first delivery commits, then dies before its reconcile.
    expect(await processSession(context, uid, unlocking.id)).toMatchObject({ status: 'processed', validity: 'valid' });
    expect((await resultOf(uid, locked.id)).validity).toBe('flagged');

    const redelivery = await runSessionPipeline(context, uid, unlocking.id);

    expect(redelivery.outcome.status).toBe('already-processed');
    expect(redelivery.reconciled[0]?.report.upgraded).toEqual([locked.id]);
    expect((await resultOf(uid, locked.id)).validity).toBe('valid');
  });

  it('caps upgrades per reconcile; the next reconcile finishes them', async () => {
    const uid = newUid();
    const locked: Written[] = [];
    for (let index = 0; index < 3; index += 1) {
      const session = await writeSession(db, uid, { seed: 50 + index, startLevel: 2, targetPeak: 3, endedAtMs: minutesAgo(30 - index), order: index });
      await runSessionPipeline(context, uid, session.id);
      locked.push(session);
    }
    const unlocking = await writeSession(db, uid, { seed: 59, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(5), order: 9 });

    const tight = coreContext(db, { limits: { maxUpgradesPerReconcile: 1, upgradeBatchSize: 1 } });
    const report = await runSessionPipeline(tight, uid, unlocking.id);
    expect(report.reconciled[0]?.report).toEqual({ upgraded: [locked[0]!.id], stopped: 'budget' });

    await reconcileUser(context, uid);
    for (const { id } of locked) expect((await resultOf(uid, id)).validity).toBe('valid');
    expect(await readDoc(db, progressPath(uid))).toMatchObject({ sessionsCompleted: 4, activeMs: 360_000 });
  });
});

/** mulberry32, so every run tests the same cases. */
function prng(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const shuffle = <T>(items: readonly T[]) => {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(next() * (index + 1));
      [copy[index], copy[swap]] = [copy[swap]!, copy[index]!];
    }
    return copy;
  };
  return { next, int, shuffle };
}

describe('order independence against Firestore', () => {
  it('reaches the same progress and validities for random session sets in random orders', async () => {
    const random = prng(0x19_2026);
    for (let run = 0; run < 5; run += 1) {
      const plans: (Plan & { order: number })[] = Array.from({ length: random.int(3, 5) }, (_, index) => {
        const startLevel = random.next() < 0.4 ? 1 : random.int(1, 4);
        return {
          seed: random.int(0, 0xffff_ffff),
          startLevel,
          targetPeak: random.int(startLevel, startLevel + 4),
          rtMs: random.next() < 0.15 ? 200 : 1_300,
          endedAtMs: minutesAgo(60 - index * 5),
          order: index,
        };
      });
      const outcomes = [];
      for (const order of [plans.map((_, index) => index), random.shuffle(plans.map((_, index) => index)), random.shuffle(plans.map((_, index) => index))]) {
        const uid = newUid();
        const ids: string[] = [];
        // Each session is written just before it is processed, as if it arrived from another device then.
        for (const index of order) {
          const { id } = await writeSession(db, uid, { ...plans[index]!, id: `session-${run}-${index}-order` });
          ids[index] = id;
          await runSessionPipeline(context, uid, id);
        }
        const validities = [];
        for (const id of ids) validities.push((await resultOf(uid, id)).validity);
        outcomes.push({ progress: content(await readDoc(db, progressPath(uid))), validities });
      }
      expect(outcomes[1], `run ${run}`).toEqual(outcomes[0]);
      expect(outcomes[2], `run ${run}`).toEqual(outcomes[0]);
    }
  });
});
