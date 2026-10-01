import { afterAll, describe, expect, it } from 'vitest';
import { runSessionPipeline } from '../../src/pipeline';
import { processSession } from '../../src/processSession';
import { reconcileUpgrades } from '../../src/reconcile';
import { rebuildUserStats } from '../../src/stats';
import { coreContext, deliver, writeSessionAt } from '../helpers/core';
import { CORE_PROJECT, emulatorFirestore, newUid, readDoc, sessionPath, statsContent, statsPath, type Plan } from '../helpers/emulator';

// Users whose sessions were processed before stats existed (NFCT-19 only),
// whose first event after NFCT-13 involves a start-level upgrade, concurrent
// deliveries or an admin rebuild. Whatever path brings their stats into
// being, the end state must equal stats maintained all along. Adapted from
// the PR #19 review probe.

const { db, close } = emulatorFirestore(CORE_PROJECT);
const context = coreContext(db);
/** No upgrade budget in the processing transaction: the upgrade is left to the post-commit reconcile. */
const tight = coreContext(db, { limits: { transactionUpgradeScanBudget: 0, transactionUpgradeLimit: 0 } });
afterAll(close);

const DAY_MS = 86_400_000;
/** Noon in Toronto on 2026-09-20: a fixed time, so the local dates are fixed. */
const NOON = Date.UTC(2026, 8, 20, 16, 0);
const daysAgo = (days: number) => NOON - days * DAY_MS;
// The day before yesterday's run reaches level 5 and unlocks yesterday's level-3 start.
const plans: Plan[] = [
  { seed: 930, startLevel: 1, targetPeak: 5, endedAtMs: daysAgo(2) - 5 * 60_000 },
  { seed: 931, startLevel: 3, targetPeak: 6, endedAtMs: daysAgo(1) - 5 * 60_000 },
  { seed: 932, startLevel: 1, targetPeak: 2, endedAtMs: daysAgo(0) - 5 * 60_000 },
];
const LOCKED = 'legacy-upgrade-1-session-doc';
const write = (uid: string, index: number) => {
  const plan = plans[index]!;
  return writeSessionAt(db, uid, plan.endedAtMs + 5 * 60_000, { ...plan, id: `legacy-upgrade-${index}-session-doc` });
};

/** What NFCT-19 alone leaves: results and progress, and no stats documents at all. */
async function dropStats(uid: string): Promise<void> {
  await db.doc(statsPath(uid)).delete();
  for (const collection of ['dailyStats', 'achievements']) {
    for (const ref of await db.collection(`users/${uid}/${collection}`).listDocuments()) await ref.delete();
  }
}

/** Stats maintained all along, in play order. */
async function reference() {
  const uid = newUid();
  for (const index of [0, 1, 2]) await runSessionPipeline(context, uid, (await write(uid, index)).id);
  return statsContent(db, uid);
}

describe('users whose sessions predate stats', () => {
  it('rebuild the stats and upgrade a flagged session in the same commit', async () => {
    const expected = await reference();
    const uid = newUid();
    await runSessionPipeline(context, uid, (await write(uid, 1)).id);
    expect((await readDoc(db, sessionPath(uid, LOCKED)))?.result.validity).toBe('flagged');
    await dropStats(uid);

    expect(await processSession(context, uid, (await write(uid, 0)).id)).toMatchObject({ status: 'processed', upgraded: [LOCKED] });
    expect(await readDoc(db, statsPath(uid))).toMatchObject({ sessions: 2, validRuns: 2 });

    await runSessionPipeline(context, uid, (await write(uid, 2)).id);
    expect(await statsContent(db, uid)).toEqual(expected);
  });

  it('rebuild the stats in processing, then the post-commit reconcile adds the upgrade', async () => {
    const expected = await reference();
    const uid = newUid();
    await runSessionPipeline(context, uid, (await write(uid, 1)).id);
    await dropStats(uid);

    expect(await processSession(tight, uid, (await write(uid, 0)).id)).toMatchObject({
      status: 'processed', reconcile: { gameId: 'mental-math', modeId: 'timed-90' },
    });
    expect(await readDoc(db, statsPath(uid))).toMatchObject({ sessions: 2, validRuns: 1 });
    expect((await reconcileUpgrades(context, uid, { gameId: 'mental-math', modeId: 'timed-90' })).upgraded).toEqual([LOCKED]);
    expect(await readDoc(db, statsPath(uid))).toMatchObject({ sessions: 2, validRuns: 2 });

    await runSessionPipeline(context, uid, (await write(uid, 2)).id);
    expect(await statsContent(db, uid)).toEqual(expected);
  });

  it('let a reconcile upgrade without stats, then the next session rebuilds them, upgrade included', async () => {
    const expected = await reference();
    const uid = newUid();
    await runSessionPipeline(context, uid, (await write(uid, 1)).id);
    await processSession(tight, uid, (await write(uid, 0)).id);
    await dropStats(uid);

    expect((await reconcileUpgrades(context, uid, { gameId: 'mental-math', modeId: 'timed-90' })).upgraded).toEqual([LOCKED]);
    expect(await readDoc(db, statsPath(uid))).toBeUndefined();

    await runSessionPipeline(context, uid, (await write(uid, 2)).id);
    expect(await statsContent(db, uid)).toEqual(expected);
  });

  it('count each session once when new sessions are delivered at once', async () => {
    const expected = await reference();
    for (let round = 0; round < 3; round += 1) {
      const uid = newUid();
      await runSessionPipeline(context, uid, (await write(uid, 0)).id);
      await dropStats(uid);
      const written = await Promise.all([1, 2].map((index) => write(uid, index)));
      await Promise.all(written.map(({ id }) => deliver(context, uid, id)));
      expect(await statsContent(db, uid), `round ${round}`).toEqual(expected);
    }
  });

  it('get the same stats from the admin rebuild followed by live processing', async () => {
    const expected = await reference();
    const uid = newUid();
    for (const index of [0, 1]) await runSessionPipeline(context, uid, (await write(uid, index)).id);
    await dropStats(uid);

    expect(await rebuildUserStats(context, uid)).toMatchObject({ written: 'set' });
    await runSessionPipeline(context, uid, (await write(uid, 2)).id);
    expect(await statsContent(db, uid)).toEqual(expected);
  });
});
