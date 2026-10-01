import { FieldValue, type DocumentData, type DocumentSnapshot } from 'firebase-admin/firestore';
import {
  classifyProgress,
  decideSession,
  evaluateSession,
  processingRecord,
  sessionProcessingWriteSchema,
  type ProcessingReason,
  type ServerResult,
  type SessionProcessingState,
} from '@nfct/shared';
import { accountDeleted, progressRef, sessionRef, type ProcessingContext } from './context';
import { applicableProgress, rebuildInTransaction } from './progress';
import { upgradeInTransaction, type ReconcileTarget } from './reconcile';

// Processing one session (NFCT-19): the exactly-once transaction.
//
// Before the transaction, with no locks held and never repeated when the
// transaction retries on contention: resolve the session's frozen game-version
// module, parse its envelope and trials strictly and its display summary
// loosely, rescore it from its trials and run the version's plausibility
// checks and trusted scoring's own (evaluateSession: pure).
//
// Inside one transaction:
// 1. re-read the session and stop if it already has a result (so a duplicate
//    or concurrent delivery never applies it twice);
// 2. stop, writing nothing, if the user's deletion ledger exists;
// 3. use the evaluation only if the document is exactly the one evaluated
//    (same updateTime), otherwise evaluate what the transaction read;
// 4. unsupported: record processing.state = 'unsupported' and stop;
//    invalid: write the result alone (it counts nowhere, so progress is not
//    read);
// 5. otherwise classify progress (apply, rebuild an older aggregate inside
//    this transaction, or refuse progress from newer code), decide the
//    start-level unlock against it, and, when the decision raised the
//    unlocked start level (or progress was rebuilt), upgrade the
//    start-level-locked sessions it unlocks (upgradeInTransaction, bounded);
// 6. write the result, progress, the upgraded results and the removal of any
//    stale `processing` in one commit.
//
// Processing order never matters: each session is judged against the progress
// its transaction reads, a session flagged only because its start level was
// still locked is upgraded once progress unlocks it, and that is the only
// later change a result can undergo. Nothing here reads a device clock to
// decide what to process first.

export type ProcessOutcome =
  | { readonly status: 'missing' }
  /** The user's account is being deleted: nothing was written. */
  | { readonly status: 'account-deleted' }
  /** The session already has a result. `reconcile` is set when it is valid (see reconcileAfterRedelivery). */
  | { readonly status: 'already-processed'; readonly reconcile: ReconcileTarget | null }
  | { readonly status: 'unsupported'; readonly reason: ProcessingReason }
  | {
    readonly status: 'processed';
    readonly validity: ServerResult['validity'];
    /** Sessions upgraded from flagged to valid in the same commit. */
    readonly upgraded: readonly string[];
    /** Set when the commit's own upgrade budget ran out: the post-commit reconcile must finish it. */
    readonly reconcile: ReconcileTarget | null;
  };

/** Whether two snapshots are the same version of the document (nothing written in between). */
function sameVersion(a: DocumentSnapshot, b: DocumentSnapshot): boolean {
  return a.updateTime !== undefined && b.updateTime !== undefined && a.updateTime.isEqual(b.updateTime);
}

export async function processSession(context: ProcessingContext, uid: string, sessionId: string): Promise<ProcessOutcome> {
  const ref = sessionRef(context.db, uid, sessionId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return { status: 'missing' };
  const data = snapshot.data()!;
  if (data.result !== undefined) return { status: 'already-processed', reconcile: reconcileAfterRedelivery(data) };
  const evaluation = evaluateSession(data, { uid, sessionId }, context.registry);

  return context.db.runTransaction<ProcessOutcome>(async (transaction) => {
    const current = await transaction.get(ref);
    if (!current.exists) return { status: 'missing' };
    const stored = current.data()!;
    if (stored.result !== undefined) return { status: 'already-processed', reconcile: reconcileAfterRedelivery(stored) };
    if (await accountDeleted(transaction, context.db, uid)) return { status: 'account-deleted' };
    // The decision is made on exactly the document this transaction read.
    const judged = sameVersion(current, snapshot) ? evaluation : evaluateSession(stored, { uid, sessionId }, context.registry);

    if (judged.kind === 'unsupported') {
      const processing = processingRecord(stored.processing, 'unsupported', judged.reason, context.now());
      transaction.update(ref, { processing: sessionProcessingWriteSchema.parse(processing) });
      return { status: 'unsupported', reason: judged.reason };
    }
    const processedAt = context.now();
    const decisionContext = { sessionId, processedAt, registry: context.registry };
    if (judged.kind === 'invalid') {
      // Counts nowhere, so it needs no progress, whatever state progress is in.
      const { result } = decideSession(judged, null, decisionContext);
      transaction.update(ref, { result, processing: FieldValue.delete() });
      return { status: 'processed', validity: 'invalid', upgraded: [], reconcile: null };
    }

    const { gameId } = judged.module;
    const target = { gameId, modeId: judged.session.modeId };
    const storedProgress = await transaction.get(progressRef(context.db, uid, gameId));
    const applicable = applicableProgress(classifyProgress(storedProgress.data(), gameId, context.registry), gameId);
    const rebuilt = applicable === 'rebuild';
    const base = rebuilt ? await rebuildInTransaction(context, transaction, uid, gameId) : applicable;
    const decision = decideSession(judged, base, decisionContext);
    // A valid or flagged session counts in totals, so progress exists after it.
    if (decision.progress === null) throw new Error('A counted session must leave progress');

    // A raised unlock can make stored start-level-locked sessions upgradable; so can a rebuild.
    const planned = decision.unlockRaised || rebuilt
      ? await upgradeInTransaction(context, transaction, uid, target, decision.progress, processedAt)
      : { progress: decision.progress, upgrades: [], complete: true };

    // Every read is done; write the session, progress and the upgrades together.
    transaction.update(ref, { result: decision.result, processing: FieldValue.delete() });
    transaction.set(progressRef(context.db, uid, gameId), planned.progress);
    for (const { sessionId: upgradedId, result } of planned.upgrades) {
      transaction.update(sessionRef(context.db, uid, upgradedId), { result });
    }
    return {
      status: 'processed',
      validity: decision.result.validity,
      upgraded: planned.upgrades.map(({ sessionId: upgradedId }) => upgradedId),
      reconcile: planned.complete ? null : target,
    };
  });
}

/**
 * A redelivered session that is already valid reconciles its mode again, in
 * case the delivery that processed it ran out of its in-transaction upgrade
 * budget and failed after committing, before its post-commit reconcile ran.
 * Cheap when there is nothing to upgrade.
 */
function reconcileAfterRedelivery(data: DocumentData): ReconcileTarget | null {
  const { result, gameId, modeId } = data as { result?: { validity?: unknown }; gameId?: unknown; modeId?: unknown };
  return result?.validity === 'valid' && typeof gameId === 'string' && typeof modeId === 'string' ? { gameId, modeId } : null;
}

/**
 * Records why a session has no result, in a transaction that re-checks it has
 * none and that the account is not being deleted: processing metadata never
 * coexists with, or replaces, a result. It is not a terminal state: a later
 * successful processing deletes it in the same write that adds the result.
 */
export async function recordProcessingState(
  context: ProcessingContext,
  uid: string,
  sessionId: string,
  state: SessionProcessingState,
  reason: ProcessingReason,
): Promise<'recorded' | 'already-processed' | 'missing' | 'account-deleted'> {
  const ref = sessionRef(context.db, uid, sessionId);
  return context.db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return 'missing' as const;
    const data = snapshot.data()!;
    if (data.result !== undefined) return 'already-processed' as const;
    if (await accountDeleted(transaction, context.db, uid)) return 'account-deleted' as const;
    const processing = sessionProcessingWriteSchema.parse(processingRecord(data.processing, state, reason, context.now()));
    transaction.update(ref, { processing });
    return 'recorded' as const;
  });
}
