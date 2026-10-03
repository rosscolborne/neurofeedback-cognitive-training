import { afterAll, describe, expect, it } from 'vitest';
import { runSessionPipeline } from '../../src/pipeline';
import { processSession } from '../../src/processSession';
import { reconcileUser } from '../../src/redrive';
import { coreContext, deliver, minutesAgo, writeSession, type Written } from '../helpers/core';
import { content, CORE_PROJECT, emulatorFirestore, newUid, progressPath, readDoc, sessionPath, type Plan } from '../helpers/emulator';

// Order-independent processing and the start-level upgrade, against
// Firestore. Sessions are processed independently, in whatever order they
// arrive; a session flagged only because its start level was still locked is
// upgraded once progress unlocks it, in the same commit as the unlock. The end
// state must not depend on the order, or on concurrency.

const { db, close } = emulatorFirestore(CORE_PROJECT);
const context = coreContext(db);
afterAll(close);

async function resultOf(uid: string, id: string) {
  return (await readDoc(db, sessionPath(uid, id)))?.result;
}

async function validitiesOf(uid: string, ids: readonly string[]) {
  const validities: string[] = [];
  for (const id of ids) validities.push((await resultOf(uid, id))?.validity);
  return validities;
}

/** Writes the plans for a fresh user (fixed session IDs, so records compare across users) and processes them in `order`. */
async function processedInOrder(plans: readonly Plan[], prefix: string, order: readonly number[]) {
  const uid = newUid();
  const ids = plans.map((_, index) => `${prefix}-${String(index).padStart(2, '0')}-session-document`);
  for (const index of order) {
    await writeSession(db, uid, { ...plans[index]!, id: ids[index] });
    await runSessionPipeline(context, uid, ids[index]!);
  }
  return { uid, ids, progress: content(await readDoc(db, progressPath(uid))), validities: await validitiesOf(uid, ids) };
}

/** Writes every plan for a fresh user, then delivers them all at once (redelivering any that fail, like the platform). */
async function processedConcurrently(plans: readonly Plan[], prefix: string) {
  const uid = newUid();
  const ids = plans.map((_, index) => `${prefix}-${String(index).padStart(2, '0')}-session-document`);
  await Promise.all(plans.map((plan, index) => writeSession(db, uid, { ...plan, id: ids[index] })));
  const deliveries = await Promise.all(ids.map((id) => deliver(context, uid, id)));
  return {
    uid,
    ids,
    progress: content(await readDoc(db, progressPath(uid))),
    validities: await validitiesOf(uid, ids),
    redeliveries: deliveries.reduce((sum, { redeliveries }) => sum + redeliveries, 0),
  };
}

describe('two queued sessions processed out of order are not wrongly flagged (end state)', () => {
  const earlierPlan: Plan = { seed: 21, startLevel: 1, targetPeak: 5, endedAtMs: minutesAgo(20) };
  const laterPlan: Plan = { seed: 22, startLevel: 3, targetPeak: 6, endedAtMs: minutesAgo(10) };

  it('flags the later session while its level is locked, then upgrades it in the commit of the session that unlocks it', async () => {
    const uid = newUid();
    const later = await writeSession(db, uid, { ...laterPlan, id: 'queued-later-session' });
    await runSessionPipeline(context, uid, later.id);
    const flagged = await resultOf(uid, later.id);
    expect(flagged).toMatchObject({ validity: 'flagged', reasons: ['start-level-locked'] });
    const flaggedProgress = await readDoc(db, progressPath(uid));

    const earlier = await writeSession(db, uid, { ...earlierPlan, id: 'queued-earlier-session' });
    // The processing transaction alone, with no post-commit step: the upgrade is part of its commit.
    const outcome = await processSession(context, uid, earlier.id);

    expect(outcome).toEqual({ status: 'processed', validity: 'valid', upgraded: [later.id], reconcile: null });
    const upgraded = await resultOf(uid, later.id);
    const { validity: _validity, reasons: _reasons, ...stored } = flagged;
    expect(upgraded).toMatchObject({
      ...stored, // processedAt, scoringVersion and every stored trusted value are unchanged
      validity: 'valid',
      reasons: ['start-level-unlocked-later'],
      recordKey: 'timed-90:3',
      personalBest: true,
    });
    expect(upgraded.processedAt).toEqual(flagged.processedAt);
    // Totals were counted once, when the session was processed as flagged.
    expect(flaggedProgress).toMatchObject({ sessionsCompleted: 1, activeMs: 90_000 });
    const progress = await readDoc(db, progressPath(uid));
    expect(progress).toMatchObject({ sessionsCompleted: 2, activeMs: 180_000, bestPeakLevel: { 'timed-90': 6 }, unlocked: { 'timed-90': 5 } });
    expect(progress?.bests['timed-90:3'].score.sessionId).toBe(later.id);
    expect(progress?.bests['timed-90:1'].score.sessionId).toBe(earlier.id);
    // One commit: the unlocking result, the upgrade and progress share one write time.
    expect((await resultOf(uid, earlier.id)).processedAt).toEqual(progress?.updatedAt);

    // The same end state as processing them in play order.
    const inOrder = await processedInOrder([earlierPlan, laterPlan], 'queued', [0, 1]);
    const reversed = await processedInOrder([earlierPlan, laterPlan], 'queued', [1, 0]);
    expect(reversed.progress).toEqual(inOrder.progress);
    expect(reversed.validities).toEqual(['valid', 'valid']);
    expect(inOrder.validities).toEqual(['valid', 'valid']);
  });

  it('cascades in one commit: each upgrade can unlock the next', async () => {
    const uid = newUid();
    const c = await writeSession(db, uid, { seed: 25, startLevel: 5, targetPeak: 7, endedAtMs: minutesAgo(30), order: 1 });
    await runSessionPipeline(context, uid, c.id);
    const b = await writeSession(db, uid, { seed: 26, startLevel: 3, targetPeak: 6, endedAtMs: minutesAgo(20), order: 2 });
    await runSessionPipeline(context, uid, b.id);
    expect(await validitiesOf(uid, [c.id, b.id])).toEqual(['flagged', 'flagged']);

    const a = await writeSession(db, uid, { seed: 27, startLevel: 1, targetPeak: 4, endedAtMs: minutesAgo(10), order: 3 });
    const report = await runSessionPipeline(context, uid, a.id);

    // Scan order: start level, then session ID (never a device clock).
    expect(report.outcome).toMatchObject({ status: 'processed', validity: 'valid', upgraded: [b.id, c.id], reconcile: null });
    expect(report.reconciled).toEqual([]);
    expect(await validitiesOf(uid, [a.id, b.id, c.id])).toEqual(['valid', 'valid', 'valid']);
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
    await reconcileUser(context, uid);

    expect(await resultOf(uid, fast.id)).toEqual(flagged);
    expect((await readDoc(db, progressPath(uid)))?.bests['timed-90:3']).toBeUndefined();
  });

  it('upgrades a session whose other reasons are only diagnostics, keeping them: the same end state as play order', async () => {
    // A disagreeing client summary and peak are diagnostics. They never decide validity, so they must not block the upgrade.
    const noisy = { 'summary.score': 1, peakLevel: 9 };
    const lockedPlan: Plan = { seed: 30, startLevel: 2, targetPeak: 4, endedAtMs: minutesAgo(10) };
    const unlockingPlan: Plan = { seed: 31, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(20) };
    const run = async (order: readonly ('locked' | 'unlocking')[]) => {
      const uid = newUid();
      for (const which of order) {
        const plan = which === 'locked' ? lockedPlan : unlockingPlan;
        const { id } = await writeSession(db, uid, { ...plan, id: `noisy-${which}-session` });
        if (which === 'locked') await db.doc(sessionPath(uid, id)).update(noisy);
        await runSessionPipeline(context, uid, id);
      }
      return { uid, result: await resultOf(uid, 'noisy-locked-session'), progress: content(await readDoc(db, progressPath(uid))) };
    };

    const lockedFirst = await run(['locked', 'unlocking']);
    const inPlayOrder = await run(['unlocking', 'locked']);

    expect(inPlayOrder.result).toMatchObject({ validity: 'valid', reasons: ['peak-level-mismatch', 'summary-mismatch'] });
    expect(lockedFirst.result).toMatchObject({ validity: 'valid', reasons: ['peak-level-mismatch', 'summary-mismatch', 'start-level-unlocked-later'] });
    expect(lockedFirst.progress).toEqual(inPlayOrder.progress);
  });

  it('never downgrades: replays and reconciles leave valid sessions and progress as they are', async () => {
    const uid = newUid();
    const later = await writeSession(db, uid, { seed: 32, startLevel: 2, targetPeak: 4, endedAtMs: minutesAgo(10), order: 2 });
    await runSessionPipeline(context, uid, later.id);
    const earlier = await writeSession(db, uid, { seed: 33, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(20), order: 1 });
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

describe('mutually locked sessions', () => {
  // A (start 3, peak 6) would unlock B; B (start 5, peak 7) would unlock A. Neither may bootstrap the other.
  const a: Plan = { seed: 34, startLevel: 3, targetPeak: 6, endedAtMs: minutesAgo(30) };
  const b: Plan = { seed: 35, startLevel: 5, targetPeak: 7, endedAtMs: minutesAgo(20) };
  // C (start 1, peak 4) legitimately unlocks A, and A then unlocks B.
  const c: Plan = { seed: 36, startLevel: 1, targetPeak: 4, endedAtMs: minutesAgo(10) };

  it('stay flagged in every order and concurrently, whatever reconcile runs', async () => {
    for (const run of [
      await processedInOrder([a, b], 'pair', [0, 1]),
      await processedInOrder([a, b], 'pair', [1, 0]),
      await processedConcurrently([a, b], 'pair'),
    ]) {
      await reconcileUser(context, run.uid);
      expect(await validitiesOf(run.uid, run.ids)).toEqual(['flagged', 'flagged']);
      expect(await readDoc(db, progressPath(run.uid))).toMatchObject({ sessionsCompleted: 2, bestPeakLevel: {}, bests: {}, unlocked: {} });
    }
  });

  it('are both upgraded once a third session unlocks one of them, and repeating the upgrade changes nothing', async () => {
    const run = await processedInOrder([a, b, c], 'unlocked-pair', [0, 1, 2]);
    expect(run.validities).toEqual(['valid', 'valid', 'valid']);
    const sessions = [];
    for (const id of run.ids) sessions.push(await readDoc(db, sessionPath(run.uid, id)));
    const progress = await readDoc(db, progressPath(run.uid));
    expect(progress).toMatchObject({ sessionsCompleted: 3, activeMs: 270_000, bestPeakLevel: { 'timed-90': 7 }, unlocked: { 'timed-90': 6 } });

    // Redeliveries and admin reconciles find nothing left to do.
    for (const id of run.ids) expect((await runSessionPipeline(context, run.uid, id)).outcome.status).toBe('already-processed');
    // Every registered game's modes are reconciled; this player has only Mental Math progress (NFCT-93 added Sequence Memory).
    expect(await reconcileUser(context, run.uid)).toEqual([
      { gameId: 'mental-math', modeId: 'timed-90', report: { upgraded: [], stopped: 'fixpoint' } },
      { gameId: 'sequence-memory', modeId: 'standard', report: { upgraded: [], stopped: 'no-progress' } },
    ]);

    const after = [];
    for (const id of run.ids) after.push(await readDoc(db, sessionPath(run.uid, id)));
    expect(after).toEqual(sessions);
    expect(await readDoc(db, progressPath(run.uid))).toEqual(progress);
    // Every processing order reaches the same end state.
    expect((await processedInOrder([a, b, c], 'unlocked-pair', [2, 1, 0])).progress).toEqual(run.progress);
    expect((await processedInOrder([a, b, c], 'unlocked-pair', [1, 2, 0])).progress).toEqual(run.progress);
  });
});

describe('concurrent processing', () => {
  it('reaches the sequential end state when a session and the session it unlocks are processed at once', async () => {
    const earlier: Plan = { seed: 37, startLevel: 1, targetPeak: 5, endedAtMs: minutesAgo(20) };
    const later: Plan = { seed: 38, startLevel: 3, targetPeak: 6, endedAtMs: minutesAgo(10) };
    const sequential = await processedInOrder([earlier, later], 'ab', [0, 1]);
    for (let round = 0; round < 5; round += 1) {
      const concurrent = await processedConcurrently([earlier, later], 'ab');
      expect(concurrent.validities, `round ${round}`).toEqual(['valid', 'valid']);
      expect(concurrent.progress, `round ${round}`).toEqual(sequential.progress);
      // Whichever transaction committed first decides only the point-in-time note.
      expect([[], ['start-level-unlocked-later']]).toContainEqual((await resultOf(concurrent.uid, concurrent.ids[1]!)).reasons);
    }
  });

  it('converges, counting totals once, when a chain of unlocking sessions and a locked pair are created at the same moment', async () => {
    const plans: Plan[] = [
      // A chain: each session unlocks the next one's start level.
      { seed: 60, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(50) },
      { seed: 61, startLevel: 2, targetPeak: 4, endedAtMs: minutesAgo(40) },
      { seed: 62, startLevel: 3, targetPeak: 6, endedAtMs: minutesAgo(30) },
      { seed: 63, startLevel: 5, targetPeak: 7, endedAtMs: minutesAgo(20) },
      { seed: 64, startLevel: 6, targetPeak: 8, endedAtMs: minutesAgo(10) },
      // A pair that only unlock each other, above what the chain unlocks (7).
      { seed: 65, startLevel: 8, targetPeak: 10, endedAtMs: minutesAgo(45) },
      { seed: 66, startLevel: 9, targetPeak: 10, endedAtMs: minutesAgo(5) },
    ];
    const sequential = await processedInOrder(plans, 'chain', plans.map((_, index) => index));
    expect(sequential.validities).toEqual(['valid', 'valid', 'valid', 'valid', 'valid', 'flagged', 'flagged']);
    expect(sequential.progress).toMatchObject({ sessionsCompleted: 7, activeMs: 630_000, bestPeakLevel: { 'timed-90': 8 }, unlocked: { 'timed-90': 7 } });
    const reverse = await processedInOrder(plans, 'chain', plans.map((_, index) => plans.length - 1 - index));
    expect(reverse.progress).toEqual(sequential.progress);
    expect(reverse.validities).toEqual(sequential.validities);

    for (let round = 0; round < 3; round += 1) {
      const concurrent = await processedConcurrently(plans, 'chain');
      // Contention is resolved by transaction retries (and, past them, redelivery), never by losing an update.
      expect(concurrent.validities, `round ${round} (${concurrent.redeliveries} redeliveries)`).toEqual(sequential.validities);
      expect(concurrent.progress, `round ${round} (${concurrent.redeliveries} redeliveries)`).toEqual(sequential.progress);
    }
  });
});

describe('bounded work', () => {
  it('pages past sessions flagged for other reasons at the same start level, inside the processing transaction', async () => {
    const uid = newUid();
    // More sessions flagged for another reason at level 2 than one page, all sorting first.
    for (let index = 0; index < 22; index += 1) {
      const fast = await writeSession(db, uid, { seed: 300 + index, startLevel: 2, targetPeak: 3, rtMs: 200, endedAtMs: minutesAgo(90 - index), order: index });
      await runSessionPipeline(context, uid, fast.id);
    }
    const locked = await writeSession(db, uid, { seed: 330, startLevel: 2, targetPeak: 4, endedAtMs: minutesAgo(30), order: 9_999 });
    await runSessionPipeline(context, uid, locked.id);
    const unlocking = await writeSession(db, uid, { seed: 331, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(10), order: 9_000 });

    const paged = coreContext(db, { limits: { scanPageSize: 5 } });
    const report = await runSessionPipeline(paged, uid, unlocking.id);

    expect(report.outcome).toMatchObject({ status: 'processed', upgraded: [locked.id], reconcile: null });
    expect(report.reconciled).toEqual([]);
    expect(await resultOf(uid, locked.id)).toMatchObject({ validity: 'valid', reasons: ['start-level-unlocked-later'] });
    expect(await readDoc(db, progressPath(uid))).toMatchObject({ sessionsCompleted: 24, bestPeakLevel: { 'timed-90': 4 } });
  });

  it("leaves what the transaction's own budget cannot reach to the post-commit reconcile", async () => {
    const uid = newUid();
    for (let index = 0; index < 5; index += 1) {
      const fast = await writeSession(db, uid, { seed: 340 + index, startLevel: 2, targetPeak: 3, rtMs: 200, endedAtMs: minutesAgo(60 - index), order: index });
      await runSessionPipeline(context, uid, fast.id);
    }
    const locked = await writeSession(db, uid, { seed: 350, startLevel: 2, targetPeak: 4, endedAtMs: minutesAgo(30), order: 9_999 });
    await runSessionPipeline(context, uid, locked.id);
    const unlocking = await writeSession(db, uid, { seed: 351, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(10), order: 9_000 });

    const tight = coreContext(db, { limits: { transactionUpgradeScanBudget: 3, scanPageSize: 2 } });
    const report = await runSessionPipeline(tight, uid, unlocking.id);

    expect(report.outcome).toMatchObject({ status: 'processed', upgraded: [], reconcile: { gameId: 'mental-math', modeId: 'timed-90' } });
    expect(report.reconciled).toMatchObject([{ report: { upgraded: [locked.id], stopped: 'fixpoint' } }]);
    expect((await resultOf(uid, locked.id)).validity).toBe('valid');
  });

  it("stops at an invocation's budgets and says so; the admin reconcile, which has no budget, finishes it", async () => {
    const uid = newUid();
    for (let index = 0; index < 5; index += 1) {
      const fast = await writeSession(db, uid, { seed: 360 + index, startLevel: 2, targetPeak: 3, rtMs: 200, endedAtMs: minutesAgo(60 - index), order: index });
      await runSessionPipeline(context, uid, fast.id);
    }
    const locked = await writeSession(db, uid, { seed: 370, startLevel: 2, targetPeak: 4, endedAtMs: minutesAgo(30), order: 9_999 });
    await runSessionPipeline(context, uid, locked.id);
    const unlocking = await writeSession(db, uid, { seed: 371, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(10), order: 9_000 });

    const tight = coreContext(db, { limits: { transactionUpgradeScanBudget: 3, reconcileScanBudget: 3, scanPageSize: 2 } });
    const report = await runSessionPipeline(tight, uid, unlocking.id);
    expect(report.reconciled[0]?.report).toEqual({ upgraded: [], stopped: 'budget' });
    expect((await resultOf(uid, locked.id)).validity).toBe('flagged');

    // The admin reconcile ignores the tight limits it is given.
    const [admin] = await reconcileUser(tight, uid);
    expect(admin?.report).toEqual({ upgraded: [locked.id], stopped: 'fixpoint' });
    expect((await resultOf(uid, locked.id)).validity).toBe('valid');
  });

  it('loses no upgrade when a delivery dies between its commit and its post-commit reconcile: the redelivery finishes it', async () => {
    const uid = newUid();
    const locked = await writeSession(db, uid, { seed: 380, startLevel: 2, targetPeak: 3, endedAtMs: minutesAgo(20), order: 1 });
    await runSessionPipeline(context, uid, locked.id);
    const unlocking = await writeSession(db, uid, { seed: 381, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(10), order: 2 });
    // A transaction budget of nothing forces the overflow; the delivery commits, then dies before its reconcile.
    const starved = coreContext(db, { limits: { transactionUpgradeScanBudget: 0 } });
    expect(await processSession(starved, uid, unlocking.id)).toMatchObject({ status: 'processed', validity: 'valid', upgraded: [] });
    expect((await resultOf(uid, locked.id)).validity).toBe('flagged');

    const redelivery = await runSessionPipeline(context, uid, unlocking.id);

    expect(redelivery.outcome.status).toBe('already-processed');
    expect(redelivery.reconciled[0]?.report.upgraded).toEqual([locked.id]);
    expect((await resultOf(uid, locked.id)).validity).toBe('valid');
    expect(await readDoc(db, progressPath(uid))).toMatchObject({ sessionsCompleted: 2, bestPeakLevel: { 'timed-90': 3 } });
  });

  it('caps upgrades per transaction and per reconcile; the admin reconcile finishes them', async () => {
    const uid = newUid();
    const locked: Written[] = [];
    for (let index = 0; index < 3; index += 1) {
      const session = await writeSession(db, uid, { seed: 50 + index, startLevel: 2, targetPeak: 3, endedAtMs: minutesAgo(30 - index), order: index });
      await runSessionPipeline(context, uid, session.id);
      locked.push(session);
    }
    const unlocking = await writeSession(db, uid, { seed: 59, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(5), order: 9 });

    const tight = coreContext(db, { limits: { transactionUpgradeLimit: 1, maxUpgradesPerReconcile: 1, upgradeBatchSize: 1 } });
    const report = await runSessionPipeline(tight, uid, unlocking.id);
    expect(report.outcome).toMatchObject({ upgraded: [locked[0]!.id] });
    expect(report.reconciled[0]?.report).toEqual({ upgraded: [locked[1]!.id], stopped: 'budget' });

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
  it('reaches the same progress and validities for random session sets in random orders, and concurrently', async () => {
    const random = prng(0x19_2026);
    for (let run = 0; run < 5; run += 1) {
      const plans: Plan[] = Array.from({ length: random.int(3, 5) }, (_, index) => {
        const startLevel = random.next() < 0.4 ? 1 : random.int(1, 4);
        return {
          seed: random.int(0, 0xffff_ffff),
          startLevel,
          targetPeak: random.int(startLevel, startLevel + 4),
          rtMs: random.next() < 0.15 ? 200 : 1_300,
          endedAtMs: minutesAgo(60 - index * 5),
        };
      });
      const indices = plans.map((_, index) => index);
      // Each session is written just before it is processed, as if it arrived from another device then.
      const reference = await processedInOrder(plans, `random-${run}`, indices);
      for (const order of [random.shuffle(indices), random.shuffle(indices)]) {
        const shuffled = await processedInOrder(plans, `random-${run}`, order);
        expect(shuffled.progress, `run ${run} order ${order.join(',')}`).toEqual(reference.progress);
        expect(shuffled.validities, `run ${run} order ${order.join(',')}`).toEqual(reference.validities);
      }
      const concurrent = await processedConcurrently(plans, `random-${run}`);
      expect(concurrent.progress, `run ${run} concurrent`).toEqual(reference.progress);
      expect(concurrent.validities, `run ${run} concurrent`).toEqual(reference.validities);
    }
  });
});
