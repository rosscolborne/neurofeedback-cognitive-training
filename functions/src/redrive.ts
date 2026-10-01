import type { Query, QueryDocumentSnapshot, Timestamp } from 'firebase-admin/firestore';
import { compareTimestamps, GAME_SESSION_SCHEMA_VERSION, type FirestoreTimestamp } from '@nfct/shared';
import { sessionsOf, type ProcessingContext } from './context';
import { EXHAUSTIVE_RECONCILE } from './policy';
import { describeError, processingReasonOf } from './errors';
import { runSessionPipeline } from './pipeline';
import { recordProcessingState } from './processSession';
import { reconcileUpgrades, type ReconcileReport } from './reconcile';

// Re-driving sessions that have no result (NFCT-19): what finishes the work a
// trigger could not. The scheduled sweep (sweep.ts) and the admin script
// (scripts/redrive-sessions.ts) both call redriveSessions.
//
// - pending (no result, no processing): the trigger never completed, for
//   example a delivery that never ran. Found with the collection group
//   createdAt index (the "pending sweep"); Firestore cannot query a missing
//   field, so every session in the createdAt range is read (projected) and
//   filtered.
// - failed / unsupported: found with the collection group
//   (processing.state, createdAt) index (the "processing sweep").
//
// Each one goes through the same pipeline as the trigger. Within a user they
// run in server arrival order (createdAt, then session ID); the order changes
// nothing in the final progress, so no device clock is consulted. A session
// still failing is marked failed at once (no retry window); one still
// unsupported gets another attempt counted.

export type RedriveState = 'pending' | 'failed' | 'unsupported';

export type RedriveOptions = {
  readonly states: readonly RedriveState[];
  /** Only sessions created before this; keeps clear of deliveries the platform may still be retrying. */
  readonly createdBefore: Timestamp;
  /** Only sessions created at or after this (bounds the scans). */
  readonly createdAfter: Timestamp;
  /** One user only (reads that user's sessions, projected, instead of the collection group). */
  readonly uid?: string;
  /** Most sessions to re-drive. */
  readonly limit: number;
  /** Most session documents the scans may read (per state). */
  readonly scanBudget: number;
  /** List what would be re-driven, and change nothing. */
  readonly dryRun: boolean;
  /**
   * Leave alone failed and unsupported sessions with at least this many
   * recorded attempts, and report them (`capped`). The sweep sets it; the
   * admin script does not.
   */
  readonly maxAttempts?: number;
  /**
   * Leave alone unsupported sessions whose schemaVersion, gameId or
   * gameVersion this build still has no module for: re-driving them could
   * only record another attempt. The sweep sets it.
   */
  readonly onlyProcessable?: boolean;
};

export type RedriveTarget = {
  readonly uid: string;
  readonly sessionId: string;
  readonly state: RedriveState;
  /** Server clock: the order sessions are re-driven in, per user. */
  readonly createdAt: FirestoreTimestamp;
  /** Recorded processing attempts (0 for a pending session). */
  readonly attempts: number;
};

export type RedriveResult = RedriveTarget & {
  /** What the session is now: its result's validity, a processing state, or why nothing happened. */
  readonly now: 'valid' | 'flagged' | 'invalid' | 'unsupported' | 'failed' | 'already-processed' | 'missing' | 'account-deleted';
  readonly error?: string;
};

export type RedriveReport = {
  readonly targets: RedriveTarget[];
  readonly results: RedriveResult[];
  /** Failed or unsupported sessions left alone at `maxAttempts`: an operator must look at them. */
  readonly capped: RedriveTarget[];
};

const SELECTED = [
  'createdAt', 'schemaVersion', 'gameId', 'gameVersion', 'result.processedAt', 'processing.state', 'processing.attempts',
] as const;

function stateOf(data: Record<string, unknown>): RedriveState | null {
  if (data.result !== undefined) return null;
  const state = (data.processing as { state?: unknown } | undefined)?.state;
  if (state === undefined) return 'pending';
  return state === 'failed' || state === 'unsupported' ? state : null;
}

type Classified = { readonly target: RedriveTarget; readonly capped: boolean } | null;

function classify(
  context: ProcessingContext,
  document: QueryDocumentSnapshot,
  options: RedriveOptions,
  wanted: ReadonlySet<RedriveState>,
): Classified {
  const data = document.data();
  const state = stateOf(data);
  const uid = document.ref.parent.parent?.id;
  const createdAt = data.createdAt as FirestoreTimestamp | undefined;
  if (state === null || !wanted.has(state) || !uid || !createdAt || typeof createdAt.toMillis !== 'function') return null;
  if (compareTimestamps(createdAt, options.createdAfter) < 0 || compareTimestamps(createdAt, options.createdBefore) >= 0) return null;
  const recorded = (data.processing as { attempts?: unknown } | undefined)?.attempts;
  const attempts = typeof recorded === 'number' && Number.isInteger(recorded) && recorded > 0 ? recorded : 0;
  if (state === 'unsupported' && options.onlyProcessable) {
    const { schemaVersion, gameId, gameVersion } = data as { schemaVersion?: unknown; gameId?: unknown; gameVersion?: unknown };
    const processable = schemaVersion === GAME_SESSION_SCHEMA_VERSION && typeof gameId === 'string'
      && typeof gameVersion === 'number' && context.registry.find(gameId, gameVersion) !== undefined;
    if (!processable) return null;
  }
  const target = { uid, sessionId: document.id, state, createdAt, attempts };
  return { target, capped: state !== 'pending' && options.maxAttempts !== undefined && attempts >= options.maxAttempts };
}

/** Finds the sessions to re-drive, bounded by `limit` and `scanBudget`. */
export async function findRedriveTargets(
  context: ProcessingContext,
  options: RedriveOptions,
): Promise<{ targets: RedriveTarget[]; capped: RedriveTarget[] }> {
  const wanted = new Set(options.states);
  const targets: RedriveTarget[] = [];
  const capped: RedriveTarget[] = [];
  /** Takes a session found by a scan for `only` (each session is found by the scan for its own state, once). */
  const take = (document: QueryDocumentSnapshot, only?: RedriveState) => {
    const classified = classify(context, document, options, wanted);
    if (classified === null || (only !== undefined && classified.target.state !== only)) return;
    (classified.capped ? capped : targets).push(classified.target);
  };
  /** Pages through the scan for `state` until `limit` targets are found or `scanBudget` documents are read. */
  const scan = async (state: RedriveState, base: Query) => {
    let query = base;
    let read = 0;
    while (read < options.scanBudget && targets.length < options.limit) {
      const pageLimit = Math.min(context.limits.scanPageSize, options.scanBudget - read);
      const page = await query.limit(pageLimit).get();
      read += page.size;
      for (const document of page.docs) take(document, state);
      if (page.size < pageLimit) break;
      query = query.startAfter(page.docs[page.docs.length - 1]!);
    }
  };

  if (options.uid !== undefined) {
    const snapshot = await sessionsOf(context.db, options.uid).select(...SELECTED).get();
    for (const document of snapshot.docs) take(document);
  } else {
    const group = context.db.collectionGroup('gameSessions');
    // Missed triggers first: a pending session has never been looked at.
    if (wanted.has('pending')) {
      await scan('pending', group
        .where('createdAt', '>=', options.createdAfter)
        .where('createdAt', '<', options.createdBefore)
        .orderBy('createdAt')
        .select(...SELECTED));
    }
    for (const state of ['failed', 'unsupported'] as const) {
      if (!wanted.has(state)) continue;
      await scan(state, group
        .where('processing.state', '==', state)
        .where('createdAt', '>=', options.createdAfter)
        .where('createdAt', '<', options.createdBefore)
        .orderBy('createdAt')
        .select(...SELECTED));
    }
  }
  const byArrival = (a: RedriveTarget, b: RedriveTarget) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0)
    || compareTimestamps(a.createdAt, b.createdAt) || (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0);
  return { targets: targets.sort(byArrival).slice(0, options.limit), capped: capped.sort(byArrival) };
}

/** Re-drives the targets through the trigger's pipeline. */
export async function redriveSessions(context: ProcessingContext, options: RedriveOptions): Promise<RedriveReport> {
  const { targets, capped } = await findRedriveTargets(context, options);
  if (options.dryRun) return { targets, results: [], capped };
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
  return { targets, results, capped };
}

/**
 * Runs the start-level upgrade for every registered game mode of one user
 * with no budget (EXHAUSTIVE_RECONCILE): every flagged session at every
 * unlocked start level is examined, so it completes any reconcile that an
 * invocation's budget, or a failure, cut short. Admin only.
 */
export async function reconcileUser(
  context: ProcessingContext,
  uid: string,
): Promise<{ gameId: string; modeId: string; report: ReconcileReport }[]> {
  const exhaustive: ProcessingContext = { ...context, limits: { ...context.limits, ...EXHAUSTIVE_RECONCILE } };
  const targets = new Map<string, { gameId: string; modeId: string }>();
  for (const module of context.registry.modules) {
    for (const mode of module.definition.modes) targets.set(`${module.gameId}/${mode.id}`, { gameId: module.gameId, modeId: mode.id });
  }
  const reports = [];
  for (const target of targets.values()) reports.push({ ...target, report: await reconcileUpgrades(exhaustive, uid, target) });
  return reports;
}
