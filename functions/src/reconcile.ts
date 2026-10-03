import type { Query, QuerySnapshot, Transaction } from 'firebase-admin/firestore';
import {
  classifyProgress,
  readSessionAggregateFields,
  SESSION_AGGREGATE_FIELDS,
  upgradeBlocker,
  upgradeScanLevels,
  upgradeSession,
  type FirestoreTimestamp,
  type GameProgress,
  type ServerResult,
  type SessionAggregateFields,
} from '@nfct/shared';
import { accountDeleted, progressRef, sessionRef, sessionsOf, type ProcessingContext } from './context';
import { describeError } from './errors';
import { planStatsForUpgrades, writeStats, type StatsEvent } from './stats';

// The start-level upgrade (NFCT-19): once progress unlocks a start level, a
// session that was flagged only because that level was locked when it was
// processed becomes valid. It makes the final progress independent of the
// order sessions were processed in (offline queues, several devices).
//
// Where it runs:
// - inside the processing transaction whose commit raises the unlocked start
//   level (upgradeInTransaction): the session, progress and every session it
//   unlocks are written in one commit, so there is no window in which progress
//   unlocks a level while a session it unlocked is still flagged;
// - after that commit, only when the transaction's own bounded budget ran out
//   (reconcileUpgrades, the overflow), on redelivery of an already-valid
//   session, after an admin rebuild, and from the admin scripts with no budget.
//
// Each upgrade applies only the session's valid-only effects (records, best
// peak level, unlocks; and in the stats, NFCT-13: the valid run, peak level,
// training day and any achievement they earn), never its totals, and nothing
// ever downgrades a session. Upgrades are applied in scan order (start level,
// then session ID), never by a device clock; the final progress and stats do
// not depend on that order, only the point-in-time `personalBest` and
// `unlocked` of each upgraded result, and which session is credited with an
// achievement, do.

export type ReconcileTarget = { readonly gameId: string; readonly modeId: string };

export type ReconcileReport = {
  readonly upgraded: readonly string[];
  /** Why it stopped: nothing left, a budget, progress or stats it must not write, or a deleted account. */
  readonly stopped: 'fixpoint' | 'no-progress' | 'progress-not-current' | 'stats-not-current' | 'budget' | 'account-deleted';
};

/** A flagged session that may be upgradable: its ID and the fields the aggregates depend on (its stored result included). */
export type Candidate = { readonly id: string; readonly fields: SessionAggregateFields };

/** Scan order: start level, then session ID. Never a device clock. */
function byScanOrder(a: Candidate, b: Candidate): number {
  return a.fields.startLevel - b.fields.startLevel || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
type QueryRunner = (query: Query) => Promise<QuerySnapshot>;

/**
 * Finds upgradable sessions of one game and mode at start levels
 * `from`..`to`: one query per level on the merged "upgrade scan" index
 * (gameId, modeId, result.validity == 'flagged', startLevel == level),
 * through a projection without trials, paged with cursors to the end of each
 * level, so sessions flagged for other reasons cannot hide an upgradable one;
 * the pure upgradeBlocker decides each. Candidates come back in scan order
 * (start level, then document ID). `budget` bounds the documents read over
 * all levels; running out of it is reported, never silent.
 *
 * `run` executes each page: inside a transaction (transaction.get, so every
 * document read is part of that transaction) or outside one (query.get).
 *
 * Versions of a game that share a mode ID share its unlock rule (a version
 * whose levels change meaning uses a new mode ID, ADR-001 decision 8), so the
 * levels up to the highest unlocked one hold every upgradable session.
 */
async function scanUpgradable(
  context: ProcessingContext,
  run: QueryRunner,
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
      .select(...SESSION_AGGREGATE_FIELDS);
    for (;;) {
      const pageLimit = Math.min(context.limits.scanPageSize, budget - read);
      if (pageLimit <= 0) return { candidates, read, exhausted: true };
      const page = await run(query.limit(pageLimit));
      read += page.size;
      for (const document of page.docs) {
        let fields: SessionAggregateFields;
        try {
          fields = readSessionAggregateFields(document.data());
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

export type TransactionUpgrade = {
  /** Progress after every upgrade made. */
  readonly progress: GameProgress;
  /** The sessions to rewrite as valid, in the order they were upgraded, with the fields the stats need. */
  readonly upgrades: readonly { readonly sessionId: string; readonly fields: SessionAggregateFields; readonly result: ServerResult }[];
  /** False when a budget stopped it: the post-commit reconcile must finish the work. */
  readonly complete: boolean;
};

/**
 * Plans the upgrades a processing transaction makes in its own commit, after
 * its decision raised the unlocked start level (or rebuilt progress). It only
 * reads, through `transaction`, so every flagged session it judges is read in
 * the same transaction as the progress it is judged against; the caller then
 * writes the returned results and progress with its own. Repeats for newly
 * unlocked levels while its own upgrades raise the unlocked level, to a
 * fixpoint, within `transactionUpgradeScanBudget` documents read and
 * `transactionUpgradeLimit` upgrades.
 *
 * Every level from the lowest lockable one up to the unlocked bound is read,
 * not only the newly unlocked ones, so a session an earlier, interrupted
 * reconcile left flagged is found too.
 *
 * `pending` holds sessions this same transaction has just decided but not yet
 * written (the session being processed, when it was flagged
 * start-level-locked against progress this transaction rebuilt). A query
 * cannot see them, so they join the candidates of the round whose newly
 * unlocked levels reach them, exactly as if they were already stored: the
 * cascade that their own transaction unlocks upgrades them too. Their totals
 * were applied once by their decision; an upgrade adds only valid-only
 * effects.
 */
export async function upgradeInTransaction(
  context: ProcessingContext,
  transaction: Transaction,
  uid: string,
  target: ReconcileTarget,
  progress: GameProgress,
  /** The commit's own time (its result's processedAt): the upgrades land in the same commit. */
  upgradedAt: FirestoreTimestamp,
  pending: readonly Candidate[] = [],
): Promise<TransactionUpgrade> {
  const { limits, registry } = context;
  const upgrades: { sessionId: string; fields: SessionAggregateFields; result: ServerResult }[] = [];
  let current = progress;
  let scannedUpTo = upgradeScanLevels(registry, target.gameId, target.modeId, null).from - 1;
  let read = 0;
  for (;;) {
    const { to } = upgradeScanLevels(registry, target.gameId, target.modeId, current);
    if (to <= scannedUpTo) return { progress: current, upgrades, complete: true };
    const scan = await scanUpgradable(
      context, (query) => transaction.get(query), uid, target, current,
      { from: scannedUpTo + 1, to }, limits.transactionUpgradeScanBudget - read,
    );
    read += scan.read;
    const reached = pending.filter(({ fields }) => fields.startLevel > scannedUpTo && fields.startLevel <= to
      && upgradeBlocker(fields, current, registry) === null);
    scannedUpTo = to;
    for (const candidate of [...scan.candidates, ...reached].sort(byScanOrder)) {
      if (upgrades.length >= limits.transactionUpgradeLimit) return { progress: current, upgrades, complete: false };
      const decision = upgradeSession(candidate.fields, current, { sessionId: candidate.id, upgradedAt, registry });
      if (decision === null) continue;
      upgrades.push({ sessionId: candidate.id, fields: candidate.fields, result: decision.result });
      current = decision.progress!;
    }
    if (scan.exhausted) return { progress: current, upgrades, complete: false };
  }
}

/**
 * Upgrades one batch in one transaction. It checks the deletion ledger,
 * re-reads progress and each session, and re-checks each with upgradeSession,
 * so a session upgraded concurrently (or no longer upgradable) is skipped; the
 * results, progress and the stats (planStatsForUpgrades) are written
 * together. Stats this build must not write stop the batch before anything
 * is written, just as progress that is not current does.
 */
async function upgradeBatch(
  context: ProcessingContext,
  uid: string,
  gameId: string,
  batch: readonly Candidate[],
): Promise<string[] | 'progress-not-current' | 'stats-not-current' | 'account-deleted'> {
  return context.db.runTransaction(async (transaction) => {
    if (await accountDeleted(transaction, context.db, uid)) return 'account-deleted' as const;
    const storedProgress = await transaction.get(progressRef(context.db, uid, gameId));
    const state = classifyProgress(storedProgress.data(), gameId, context.registry);
    if (state.kind !== 'current' || state.progress === null) return 'progress-not-current' as const;
    const refs = batch.map(({ id }) => sessionRef(context.db, uid, id));
    const snapshots = await transaction.getAll(...refs, { fieldMask: [...SESSION_AGGREGATE_FIELDS] });
    let progress = state.progress;
    const upgraded: { ref: typeof refs[number]; event: StatsEvent }[] = [];
    const upgradedAt = context.now();
    for (const snapshot of snapshots) {
      if (!snapshot.exists) continue;
      const fields = readSessionAggregateFields(snapshot.data());
      const decision = upgradeSession(fields, progress, {
        sessionId: snapshot.id,
        upgradedAt,
        registry: context.registry,
      });
      if (decision === null) continue;
      progress = decision.progress!;
      upgraded.push({ ref: snapshot.ref, event: { kind: 'upgraded', sessionId: snapshot.id, session: fields, result: decision.result } });
    }
    if (upgraded.length === 0) return [];
    const stats = await planStatsForUpgrades(context, transaction, uid, upgraded.map(({ event }) => event), upgradedAt);
    if (stats === 'not-current') return 'stats-not-current' as const;

    // Every read is done.
    for (const { ref, event } of upgraded) transaction.update(ref, { result: event.result });
    transaction.set(progressRef(context.db, uid, gameId), progress);
    if (stats !== 'skip') writeStats(transaction, context.db, uid, stats);
    return upgraded.map(({ event }) => event.sessionId);
  });
}

/**
 * The post-commit reconcile: upgrades every start-level-locked session of one
 * game and mode that the user's progress now unlocks, to a fixpoint, in
 * transactions of `upgradeBatchSize`. It runs only when a processing
 * transaction's own upgrade budget ran out, on redelivery of an already-valid
 * session, and from the admin scripts. Each round scans only the start levels
 * the previous rounds had not reached (to the end of each level), so every
 * flagged session is read at most once per call; a new round only follows a
 * raised unlock.
 *
 * Bounded per call by `reconcileScanBudget` documents read,
 * `maxUpgradesPerReconcile` upgrades and `maxReconcileRounds`. A call that
 * runs out stops with 'budget' and logs it; nothing is lost, but only another
 * reconcile finishes the work: the admin scripts reconcile with no budget
 * (EXHAUSTIVE_RECONCILE).
 */
export async function reconcileUpgrades(
  context: ProcessingContext,
  uid: string,
  target: ReconcileTarget,
): Promise<ReconcileReport> {
  const { limits, registry } = context;
  const upgraded: string[] = [];
  let scannedUpTo = upgradeScanLevels(registry, target.gameId, target.modeId, null).from - 1;
  let read = 0;
  for (let round = 0; round < limits.maxReconcileRounds; round += 1) {
    const stored = await progressRef(context.db, uid, target.gameId).get();
    const state = classifyProgress(stored.data(), target.gameId, registry);
    if (state.kind !== 'current') return { upgraded, stopped: 'progress-not-current' };
    if (state.progress === null) return { upgraded, stopped: 'no-progress' };
    const { to } = upgradeScanLevels(registry, target.gameId, target.modeId, state.progress);
    if (to <= scannedUpTo) return { upgraded, stopped: 'fixpoint' };

    const scan = await scanUpgradable(
      context, (query) => query.get(), uid, target, state.progress,
      { from: scannedUpTo + 1, to }, limits.reconcileScanBudget - read,
    );
    read += scan.read;
    scannedUpTo = to;
    for (let index = 0; index < scan.candidates.length;) {
      const remaining = limits.maxUpgradesPerReconcile - upgraded.length;
      if (remaining <= 0) return stoppedByBudget(context, uid, target, upgraded, 'upgrades');
      const batch = scan.candidates.slice(index, index + Math.min(limits.upgradeBatchSize, remaining));
      index += batch.length;
      const done = await upgradeBatch(context, uid, target.gameId, batch);
      if (done === 'progress-not-current' || done === 'stats-not-current' || done === 'account-deleted') return { upgraded, stopped: done };
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
