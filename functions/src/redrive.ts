import type { QueryDocumentSnapshot, Timestamp } from 'firebase-admin/firestore';
import { compareTimestamps, type FirestoreTimestamp } from '@nfct/shared';
import { sessionsOf, type ProcessingContext } from './context';
import { describeError, processingReasonOf } from './errors';
import { runSessionPipeline } from './pipeline';
import { recordProcessingState } from './processSession';
import { reconcileUpgrades, type ReconcileReport } from './reconcile';

// Re-driving sessions that have no result (NFCT-19): the admin path that
// finishes what the trigger could not.
//
// - pending (no result, no processing): the trigger never completed, for
//   example after the platform gave up retrying. Found with the collection
//   group createdAt index (the "pending sweep"); Firestore cannot query a
//   missing field, so every session in the createdAt range is read
//   (projected) and filtered.
// - failed / unsupported: found with the collection group
//   (processing.state, createdAt) index (the "processing sweep").
//
// Each one goes through the same pipeline as the trigger, in play order per
// user. A session still failing is marked failed at once (no retry window);
// one still unsupported gets another attempt counted. A future scheduled
// sweep can call redriveSessions as is.

export type RedriveState = 'pending' | 'failed' | 'unsupported';

export type RedriveOptions = {
  readonly states: readonly RedriveState[];
  /** Only sessions created before this; keeps clear of deliveries the platform may still be retrying. */
  readonly createdBefore: Timestamp;
  /** Only sessions created at or after this (bounds the pending scan). */
  readonly createdAfter: Timestamp;
  /** One user only (reads that user's sessions, projected, instead of the collection group). */
  readonly uid?: string;
  /** Most sessions to re-drive. */
  readonly limit: number;
  /** Most session documents the pending scan may read. */
  readonly scanBudget: number;
  /** List what would be re-driven, and change nothing. */
  readonly dryRun: boolean;
};

export type RedriveTarget = {
  readonly uid: string;
  readonly sessionId: string;
  readonly state: RedriveState;
  readonly endedAt: FirestoreTimestamp;
};

export type RedriveResult = RedriveTarget & {
  /** What the session is now: its result's validity, a processing state, or why nothing happened. */
  readonly now: 'valid' | 'flagged' | 'invalid' | 'unsupported' | 'failed' | 'already-processed' | 'missing';
  readonly error?: string;
};

const SELECTED = ['createdAt', 'endedAt', 'result.processedAt', 'processing.state'] as const;

function stateOf(document: QueryDocumentSnapshot): RedriveState | null {
  const data = document.data();
  if (data.result !== undefined) return null;
  const state = (data.processing as { state?: unknown } | undefined)?.state;
  if (state === undefined) return 'pending';
  return state === 'failed' || state === 'unsupported' ? state : null;
}

function targetOf(document: QueryDocumentSnapshot, wanted: ReadonlySet<RedriveState>): RedriveTarget | null {
  const state = stateOf(document);
  const uid = document.ref.parent.parent?.id;
  const endedAt = document.data().endedAt as FirestoreTimestamp | undefined;
  if (state === null || !wanted.has(state) || !uid || !endedAt || typeof endedAt.toMillis !== 'function') return null;
  return { uid, sessionId: document.id, state, endedAt };
}

/** Finds the sessions to re-drive, bounded by `limit` and `scanBudget`. */
export async function findRedriveTargets(context: ProcessingContext, options: RedriveOptions): Promise<RedriveTarget[]> {
  const wanted = new Set(options.states);
  const targets: RedriveTarget[] = [];
  const inRange = (document: QueryDocumentSnapshot) => {
    const createdAt = document.data().createdAt as FirestoreTimestamp | undefined;
    return createdAt !== undefined && compareTimestamps(createdAt, options.createdAfter) >= 0
      && compareTimestamps(createdAt, options.createdBefore) < 0;
  };

  if (options.uid !== undefined) {
    const snapshot = await sessionsOf(context.db, options.uid).select(...SELECTED).get();
    for (const document of snapshot.docs) {
      const target = inRange(document) ? targetOf(document, wanted) : null;
      if (target) targets.push(target);
    }
  } else {
    const group = context.db.collectionGroup('gameSessions');
    for (const state of ['failed', 'unsupported'] as const) {
      if (!wanted.has(state)) continue;
      const snapshot = await group
        .where('processing.state', '==', state)
        .where('createdAt', '>=', options.createdAfter)
        .where('createdAt', '<', options.createdBefore)
        .orderBy('createdAt')
        .select(...SELECTED)
        .limit(options.limit)
        .get();
      for (const document of snapshot.docs) {
        const target = targetOf(document, wanted);
        if (target) targets.push(target);
      }
    }
    if (wanted.has('pending')) {
      let query = group
        .where('createdAt', '>=', options.createdAfter)
        .where('createdAt', '<', options.createdBefore)
        .orderBy('createdAt')
        .select(...SELECTED);
      let read = 0;
      let pending = 0;
      while (read < options.scanBudget && pending < options.limit) {
        const pageLimit = Math.min(context.limits.scanPageSize, options.scanBudget - read);
        const page = await query.limit(pageLimit).get();
        read += page.size;
        for (const document of page.docs) {
          const target = stateOf(document) === 'pending' ? targetOf(document, wanted) : null;
          if (target) {
            targets.push(target);
            pending += 1;
          }
        }
        if (page.size < pageLimit) break;
        query = query.startAfter(page.docs[page.docs.length - 1]!);
      }
    }
  }
  // Play order per user, so an earlier session's unlock is in place for a later one.
  return targets
    .sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0)
      || compareTimestamps(a.endedAt, b.endedAt) || (a.sessionId < b.sessionId ? -1 : 1))
    .slice(0, options.limit);
}

/** Re-drives the targets through the trigger's pipeline. */
export async function redriveSessions(
  context: ProcessingContext,
  options: RedriveOptions,
): Promise<{ targets: RedriveTarget[]; results: RedriveResult[] }> {
  const targets = await findRedriveTargets(context, options);
  if (options.dryRun) return { targets, results: [] };
  const results: RedriveResult[] = [];
  for (const target of targets) {
    try {
      const { outcome } = await runSessionPipeline(context, target.uid, target.sessionId);
      const now = outcome.status === 'processed' ? outcome.validity : outcome.status;
      results.push({ ...target, now });
    } catch (error) {
      const recorded = await recordProcessingState(context, target.uid, target.sessionId, 'failed', processingReasonOf(error));
      results.push({ ...target, now: recorded === 'recorded' ? 'failed' : recorded, error: describeError(error) });
    }
  }
  return { targets, results };
}

/**
 * Runs the start-level upgrade for every registered game mode of one user:
 * finishes an upgrade a budget or a failure cut short.
 */
export async function reconcileUser(
  context: ProcessingContext,
  uid: string,
): Promise<{ gameId: string; modeId: string; report: ReconcileReport }[]> {
  const targets = new Map<string, { gameId: string; modeId: string }>();
  for (const module of context.registry.modules) {
    for (const mode of module.definition.modes) targets.set(`${module.gameId}/${mode.id}`, { gameId: module.gameId, modeId: mode.id });
  }
  const reports = [];
  for (const target of targets.values()) reports.push({ ...target, report: await reconcileUpgrades(context, uid, target) });
  return reports;
}
