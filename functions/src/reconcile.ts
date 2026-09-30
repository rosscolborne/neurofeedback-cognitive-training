import {
  compareTimestamps,
  findMode,
  readSessionProgressFields,
  SESSION_PROGRESS_FIELDS,
  unlockedStartLevel,
  upgradeBlocker,
  upgradeSession,
  type GameProgress,
  type SessionProgressFields,
} from '@nfct/shared';
import { progressRef, sessionRef, sessionsOf, type ProcessingContext } from './context';
import { describeError } from './errors';
import { classifyProgress } from './progress';
import type { ReconcileTarget } from './processSession';

// The start-level upgrade (NFCT-19): once progress unlocks a start level, a
// session that was flagged only because that level was locked when it was
// processed becomes valid. It makes the final progress independent of the
// order sessions were processed in (offline queues, several devices).
//
// It runs after a processing transaction raised the unlocked start level (the
// only thing that can make a stored session upgradable), and loops while its
// own upgrades raise it further, to a fixpoint. Each upgrade applies only the
// session's valid-only effects (records, best peak level, unlocks), never its
// totals, and nothing ever downgrades a session.

export type ReconcileReport = {
  readonly upgraded: readonly string[];
  /** Why it stopped: nothing left, a budget, or progress it must not write. */
  readonly stopped: 'fixpoint' | 'no-progress' | 'progress-not-current' | 'budget';
};

/** The highest unlocked start level of `modeId` over every registered version of the game. */
function unlockBound(context: ProcessingContext, gameId: string, modeId: string, progress: GameProgress): number {
  return context.registry.modules
    .filter((module) => module.gameId === gameId)
    .map((module) => findMode(module.definition, modeId))
    .reduce((bound, mode) => (mode ? Math.max(bound, unlockedStartLevel(mode, progress)) : bound), 0);
}

type Candidate = { readonly id: string; readonly fields: SessionProgressFields };

/**
 * Finds upgradable sessions of one game and mode at start levels
 * `fromLevel`..`toLevel`: one query per level on the merged "upgrade scan"
 * index (gameId, modeId, result.validity == 'flagged', startLevel == level),
 * through a projection without trials, paged with cursors to the end of each
 * level, so sessions flagged for other reasons cannot hide an upgradable one;
 * the pure upgradeBlocker decides each. `budget` bounds the documents read
 * over all levels; running out of it is reported, never silent.
 */
async function findCandidates(
  context: ProcessingContext,
  uid: string,
  target: ReconcileTarget,
  progress: GameProgress,
  levels: { readonly from: number; readonly to: number },
  budget: number,
): Promise<{ candidates: Candidate[]; read: number; exhausted: boolean }> {
  const candidates: Candidate[] = [];
  let read = 0;
  for (let level = levels.from; level <= levels.to; level += 1) {
    let query = sessionsOf(context.db, uid)
      .where('gameId', '==', target.gameId)
      .where('modeId', '==', target.modeId)
      .where('result.validity', '==', 'flagged')
      .where('startLevel', '==', level)
      .select(...SESSION_PROGRESS_FIELDS);
    for (;;) {
      const pageLimit = Math.min(context.limits.scanPageSize, budget - read);
      if (pageLimit <= 0) return { candidates, read, exhausted: true };
      const page = await query.limit(pageLimit).get();
      read += page.size;
      for (const document of page.docs) {
        let fields: SessionProgressFields;
        try {
          fields = readSessionProgressFields(document.data());
        } catch (error) {
          context.log.warn('flagged session unreadable; not upgraded', { uid, sessionId: document.id, error: describeError(error) });
          continue;
        }
        if (upgradeBlocker(fields, progress, context.registry) === null) candidates.push({ id: document.id, fields });
      }
      if (page.size < pageLimit) break;
      query = query.startAfter(page.docs[page.docs.length - 1]!);
    }
  }
  return { candidates, read, exhausted: false };
}

/**
 * Upgrades one batch in one transaction. It re-reads progress and each
 * session, and re-checks each with upgradeBlocker, so a session upgraded
 * concurrently (or no longer upgradable) is skipped; the result and progress
 * are written together.
 */
async function upgradeBatch(
  context: ProcessingContext,
  uid: string,
  gameId: string,
  batch: readonly Candidate[],
): Promise<string[] | 'progress-not-current'> {
  return context.db.runTransaction(async (transaction) => {
    const storedProgress = await transaction.get(progressRef(context.db, uid, gameId));
    const state = classifyProgress(storedProgress.data(), gameId, context.registry);
    if (state.kind !== 'current' || state.progress === null) return 'progress-not-current' as const;
    const refs = batch.map(({ id }) => sessionRef(context.db, uid, id));
    const snapshots = await transaction.getAll(...refs, { fieldMask: [...SESSION_PROGRESS_FIELDS] });
    let progress = state.progress;
    const upgraded: string[] = [];
    const upgradedAt = context.now();
    for (const snapshot of snapshots) {
      if (!snapshot.exists) continue;
      const decision = upgradeSession(readSessionProgressFields(snapshot.data()), progress, {
        sessionId: snapshot.id,
        upgradedAt,
        registry: context.registry,
      });
      if (decision === null) continue;
      transaction.update(snapshot.ref, { result: decision.result });
      progress = decision.progress!;
      upgraded.push(snapshot.id);
    }
    if (upgraded.length > 0) transaction.set(progressRef(context.db, uid, gameId), progress);
    return upgraded;
  });
}

/**
 * Upgrades every start-level-locked session of one game and mode that the
 * user's progress now unlocks, to a fixpoint. Each round scans only the start
 * levels the previous rounds had not reached (to the end of each level), so
 * every flagged session is read at most once per call; a new round only
 * follows a raised unlock.
 *
 * Bounded per call by `reconcileScanBudget` documents read,
 * `maxUpgradesPerReconcile` upgrades (in transactions of `upgradeBatchSize`)
 * and `maxReconcileRounds`. A call that runs out stops with 'budget' and logs
 * it; nothing is lost, but only another reconcile finishes the work: the
 * admin scripts reconcile with no budget (EXHAUSTIVE_RECONCILE), while a
 * trigger reconciles again only when an unlock rises or a valid session is
 * redelivered.
 */
export async function reconcileUpgrades(
  context: ProcessingContext,
  uid: string,
  target: ReconcileTarget,
): Promise<ReconcileReport> {
  const { limits } = context;
  const upgraded: string[] = [];
  let scannedUpTo = 0;
  let read = 0;
  for (let round = 0; round < limits.maxReconcileRounds; round += 1) {
    const stored = await progressRef(context.db, uid, target.gameId).get();
    const state = classifyProgress(stored.data(), target.gameId, context.registry);
    if (state.kind !== 'current') return { upgraded, stopped: 'progress-not-current' };
    if (state.progress === null) return { upgraded, stopped: 'no-progress' };
    const bound = unlockBound(context, target.gameId, target.modeId, state.progress);
    if (bound <= scannedUpTo) return { upgraded, stopped: 'fixpoint' };

    const scan = await findCandidates(
      context, uid, target, state.progress, { from: scannedUpTo + 1, to: bound }, limits.reconcileScanBudget - read,
    );
    read += scan.read;
    scannedUpTo = bound;
    const ordered = scan.candidates.sort((a, b) => compareTimestamps(a.fields.endedAt, b.fields.endedAt) || (a.id < b.id ? -1 : 1));
    for (let index = 0; index < ordered.length;) {
      const remaining = limits.maxUpgradesPerReconcile - upgraded.length;
      if (remaining <= 0) return stoppedByBudget(context, uid, target, upgraded, 'upgrades');
      const batch = ordered.slice(index, index + Math.min(limits.upgradeBatchSize, remaining));
      index += batch.length;
      const done = await upgradeBatch(context, uid, target.gameId, batch);
      if (done === 'progress-not-current') return { upgraded, stopped: 'progress-not-current' };
      upgraded.push(...done);
    }
    if (scan.exhausted) return stoppedByBudget(context, uid, target, upgraded, 'scan');
  }
  return stoppedByBudget(context, uid, target, upgraded, 'rounds');
}

function stoppedByBudget(
  context: ProcessingContext,
  uid: string,
  target: ReconcileTarget,
  upgraded: string[],
  budget: 'scan' | 'upgrades' | 'rounds',
): ReconcileReport {
  context.log.warn('reconcile stopped at its budget; run the admin reconcile (redrive-sessions --uid) to finish it', {
    uid, ...target, budget, upgraded: upgraded.length,
  });
  return { upgraded, stopped: 'budget' };
}
