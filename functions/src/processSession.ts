import { FieldValue, Timestamp, type DocumentData } from 'firebase-admin/firestore';
import {
  compareTimestamps,
  decideSession,
  evaluateSession,
  findMode,
  processingRecord,
  sessionProcessingWriteSchema,
  unlockedStartLevel,
  type FirestoreTimestamp,
  type ProcessingReason,
  type SessionEvaluation,
  type SessionProcessingState,
} from '@nfct/shared';
import { progressRef, sessionRef, sessionsOf, type ProcessingContext } from './context';
import { describeError } from './errors';
import { applicableProgress, classifyProgress, rebuildInTransaction } from './progress';

// Processing one session (NFCT-19): the exactly-once transaction.
//
// One transaction: read the session and skip it if `result` exists (so a
// duplicate or concurrent delivery never applies it twice); evaluate exactly
// the document it read (pure: its version's schemas, rescoring, the version's
// checks, clock diagnostics); with no module for its version, record
// processing.state = 'unsupported' and stop; otherwise read progress, rebuild
// it if an older reducer maintained it, decide the start-level unlock against
// it, and write `result`, progress and the removal of any stale `processing`
// together.
//
// Out-of-order delivery: before a session would be flagged
// 'start-level-locked', its truly pending earlier sessions of the same game
// (no result and no processing) are processed first, each by this same
// function in its own transaction, so a session an earlier one unlocked is
// not flagged. Anything this cannot see (another device's session that
// arrives later, more than the scan budget) is repaired by the start-level
// upgrade in reconcile.ts.

/** Which (game, mode) may have start-level-locked sessions to upgrade after this run. */
export type ReconcileTarget = { readonly gameId: string; readonly modeId: string };

export type ProcessOutcome =
  | { readonly status: 'missing' }
  | { readonly status: 'already-processed'; readonly reconcile: ReconcileTarget | null }
  | { readonly status: 'unsupported'; readonly reason: ProcessingReason }
  | {
    readonly status: 'processed';
    readonly validity: 'valid' | 'flagged' | 'invalid';
    readonly reconcile: ReconcileTarget | null;
    /** Pending earlier sessions processed first (inline), and what each needs reconciled. */
    readonly predecessors: readonly { readonly sessionId: string; readonly outcome: ProcessOutcome }[];
  };

export type ProcessOptions = {
  /** Process truly pending earlier sessions first when this one would be start-level-locked. */
  readonly predecessors: boolean;
};

export async function processSession(
  context: ProcessingContext,
  uid: string,
  sessionId: string,
  options: ProcessOptions = { predecessors: true },
): Promise<ProcessOutcome> {
  const ref = sessionRef(context.db, uid, sessionId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return { status: 'missing' };
  const data = snapshot.data()!;
  if (data.result !== undefined) return { status: 'already-processed', reconcile: reconcileAfterRedelivery(data) };

  // A first evaluation decides only whether pending predecessors need processing first.
  const preview = evaluateSession(data, { uid, sessionId }, context.registry);
  const predecessors = options.predecessors && preview.kind === 'scored'
    ? await processPendingPredecessors(context, uid, sessionId, preview)
    : [];

  return context.db.runTransaction(async (transaction) => {
    const current = await transaction.get(ref);
    if (!current.exists) return { status: 'missing' } as const;
    const stored = current.data()!;
    if (stored.result !== undefined) {
      return { status: 'already-processed', reconcile: reconcileAfterRedelivery(stored) } as const;
    }
    // The decision is made on exactly the document this transaction read.
    const evaluation = evaluateSession(stored, { uid, sessionId }, context.registry);
    if (evaluation.kind === 'unsupported') {
      const processing = processingRecord(stored.processing, 'unsupported', evaluation.reason, context.now());
      transaction.update(ref, { processing: sessionProcessingWriteSchema.parse(processing) });
      return { status: 'unsupported', reason: evaluation.reason } as const;
    }
    const { gameId } = evaluation.module;
    const storedProgress = await transaction.get(progressRef(context.db, uid, gameId));
    const applicable = applicableProgress(classifyProgress(storedProgress.data(), gameId, context.registry), gameId);
    const rebuilt = applicable === 'rebuild';
    const progress = rebuilt ? await rebuildInTransaction(context, transaction, uid, gameId) : applicable;

    const decision = decideSession(evaluation, progress, {
      sessionId,
      processedAt: context.now(),
      registry: context.registry,
    });
    transaction.update(ref, { result: decision.result, processing: FieldValue.delete() });
    // An invalid session changes nothing, unless the progress it was checked against was just rebuilt.
    if (decision.result.validity !== 'invalid' || rebuilt) {
      if (decision.progress !== null) {
        transaction.set(progressRef(context.db, uid, gameId), decision.progress);
      } else if (storedProgress.exists) {
        // Only a rebuild can find that nothing counts any more.
        transaction.delete(progressRef(context.db, uid, gameId));
      }
    }
    const modeId = evaluation.kind === 'scored' ? evaluation.session.modeId : null;
    return {
      status: 'processed',
      validity: decision.result.validity,
      // A raised unlock may make start-level-locked sessions upgradable; so may a rebuild.
      reconcile: modeId !== null && (decision.unlockRaised || rebuilt) ? { gameId, modeId } : null,
      predecessors,
    } as const;
  });
}

/**
 * A redelivered session that is already valid reconciles its mode again, in
 * case the delivery that processed it failed after committing, before its
 * upgrades ran. Cheap when there is nothing to upgrade.
 */
function reconcileAfterRedelivery(data: DocumentData): ReconcileTarget | null {
  const { result, gameId, modeId } = data as { result?: { validity?: unknown }; gameId?: unknown; modeId?: unknown };
  return result?.validity === 'valid' && typeof gameId === 'string' && typeof modeId === 'string' ? { gameId, modeId } : null;
}

/**
 * Records why a session has no result, in a transaction that re-checks it has
 * none: processing metadata never coexists with, or replaces, a result. A
 * later successful processing deletes it in the same write that adds the
 * result.
 */
export async function recordProcessingState(
  context: ProcessingContext,
  uid: string,
  sessionId: string,
  state: SessionProcessingState,
  reason: ProcessingReason,
): Promise<'recorded' | 'already-processed' | 'missing'> {
  const ref = sessionRef(context.db, uid, sessionId);
  return context.db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return 'missing' as const;
    const data = snapshot.data()!;
    if (data.result !== undefined) return 'already-processed' as const;
    const processing = sessionProcessingWriteSchema.parse(processingRecord(data.processing, state, reason, context.now()));
    transaction.update(ref, { processing });
    return 'recorded' as const;
  });
}

type Scored = Extract<SessionEvaluation, { kind: 'scored' }>;

/**
 * Processes the session's truly pending earlier sessions of the same game
 * (no result, no processing), oldest in play order first, when the session
 * would otherwise be flagged start-level-locked under the progress stored
 * now. Bounded: it reads at most `predecessorScanBudget` recent sessions
 * (projected, newest first, created within `predecessorLookbackMs`; pending
 * sessions are recent by nature) and processes at most
 * `maxInlinePredecessors`, each with this same pipeline minus this step.
 * A predecessor that fails is left to its own trigger: the upgrade repairs
 * this session if the predecessor later unlocks it.
 */
async function processPendingPredecessors(
  context: ProcessingContext,
  uid: string,
  sessionId: string,
  evaluation: Scored,
): Promise<{ sessionId: string; outcome: ProcessOutcome }[]> {
  const { module, session } = evaluation;
  const mode = findMode(module.definition, session.modeId);
  const stored = await progressRef(context.db, uid, module.gameId).get();
  const state = classifyProgress(stored.data(), module.gameId, context.registry);
  const progress = state.kind === 'current' ? state.progress : null;
  // Only the start-level check depends on order; nothing to do if it passes (or cannot be judged yet).
  if (!mode || state.kind !== 'current' || session.startLevel <= unlockedStartLevel(mode, progress)) return [];

  const ids = await findPendingPredecessors(context, uid, sessionId, module.gameId, session.endedAt);
  const processed: { sessionId: string; outcome: ProcessOutcome }[] = [];
  for (const id of ids) {
    try {
      processed.push({ sessionId: id, outcome: await processSession(context, uid, id, { predecessors: false }) });
    } catch (error) {
      context.log.warn('pending predecessor not processed; its own trigger retries it', {
        uid, sessionId, predecessor: id, error: describeError(error),
      });
    }
  }
  return processed;
}

async function findPendingPredecessors(
  context: ProcessingContext,
  uid: string,
  sessionId: string,
  gameId: string,
  endedAt: FirestoreTimestamp,
): Promise<string[]> {
  const { limits } = context;
  const since = Timestamp.fromMillis(context.now().toMillis() - limits.predecessorLookbackMs);
  let query = sessionsOf(context.db, uid)
    .where('createdAt', '>=', since)
    .orderBy('createdAt', 'desc')
    .select('createdAt', 'gameId', 'endedAt', 'result.processedAt', 'processing.state');
  const pending: { id: string; endedAt: FirestoreTimestamp }[] = [];
  let read = 0;
  let exhausted = true;
  while (read < limits.predecessorScanBudget) {
    const pageLimit = Math.min(limits.scanPageSize, limits.predecessorScanBudget - read);
    const page = await query.limit(pageLimit).get();
    read += page.size;
    for (const document of page.docs) {
      const data = document.data();
      const candidateEnd = data.endedAt as FirestoreTimestamp | undefined;
      if (document.id === sessionId || data.gameId !== gameId || data.result !== undefined || data.processing !== undefined) continue;
      if (!candidateEnd || typeof candidateEnd.toMillis !== 'function') continue;
      const order = compareTimestamps(candidateEnd, endedAt) || (document.id < sessionId ? -1 : 1);
      if (order < 0) pending.push({ id: document.id, endedAt: candidateEnd });
    }
    if (page.size < pageLimit) {
      exhausted = false;
      break;
    }
    query = query.startAfter(page.docs[page.docs.length - 1]!);
  }
  if (exhausted) {
    context.log.warn('pending predecessor scan budget reached; the upgrade path covers the rest', { uid, sessionId, read });
  }
  return pending
    .sort((a, b) => compareTimestamps(a.endedAt, b.endedAt) || (a.id < b.id ? -1 : 1))
    .slice(0, limits.maxInlinePredecessors)
    .map(({ id }) => id);
}
