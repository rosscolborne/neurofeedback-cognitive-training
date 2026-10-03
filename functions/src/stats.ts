import type { CollectionReference, DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';
import {
  applyCountedSession,
  applyValidUpgrade,
  classifyAchievement,
  classifyDailyStats,
  classifyStatsSummary,
  DomainReadError,
  findAchievement,
  PROCESSING_REASONS,
  readSessionAggregateFields,
  rebuildStats,
  SESSION_AGGREGATE_FIELDS,
  STATS_SUMMARY_ID,
  type Achievement,
  type DailyStats,
  type FirestoreTimestamp,
  type ServerResult,
  type StatsDocumentState,
  type StatsSession,
  type StatsSummary,
  type StoredStatsSession,
} from '@nfct/shared';
import { accountDeleted, sessionsOf, type ProcessingContext } from './context';
import { ProcessingError } from './errors';

// The cross-game aggregates (NFCT-13): users/{uid}/stats/summary,
// dailyStats/{localDate} and achievements/{id}. Trusted scoring updates them
// in the same transaction as the session's `result` and its game's progress,
// with the same guarantees (ADR-001 decisions 6 and 12):
//
// - exactly once: the processing transaction skips a session that already
//   has a result, so a redelivery never counts it twice; a start-level
//   upgrade adds only the session's valid-only effects, at most once;
// - order independent: activity is sums, the valid-only parts are sums,
//   maxima and a set union of training days, and achievement criteria are
//   monotone in them, so the end state is the same for every processing
//   order and equals a rebuild from the stored results;
// - compatibility: stats written by an older reducer (aggregateVersion) are
//   rebuilt inside the transaction from the stored results, never rescoring;
//   stats written by newer code are never written (the session is retried,
//   then marked failed, for newer code to re-drive); unreadable stats fail
//   the session until the admin rebuild repairs them;
// - account deletion: every transaction that writes them has read the
//   deletion ledger first (the callers do it) and writes nothing once it
//   exists.
//
// The pure reducers are in shared/stats/; this file only reads and writes
// documents. It never reads eegRecordings.

export function statsSummaryRef(db: Firestore, uid: string): DocumentReference {
  return db.collection('users').doc(uid).collection('stats').doc(STATS_SUMMARY_ID);
}

export function dailyStatsCollection(db: Firestore, uid: string): CollectionReference {
  return db.collection('users').doc(uid).collection('dailyStats');
}

export function achievementsCollection(db: Firestore, uid: string): CollectionReference {
  return db.collection('users').doc(uid).collection('achievements');
}

/**
 * What one commit does to the stats: the session it processes ('counted':
 * activity, plus valid-only effects when its result is valid) and the
 * sessions it upgrades from flagged to valid ('upgraded': valid-only effects
 * only, because their activity was counted when they were processed).
 */
export type StatsEvent = {
  readonly kind: 'counted' | 'upgraded';
  readonly sessionId: string;
  readonly session: StatsSession;
  /** The result the commit writes for the session. */
  readonly result: ServerResult;
};

/** The stats documents one transaction writes. */
export type StatsWrite = {
  /** Null only for an admin rebuild of a user with no counted session: the summary is deleted. */
  readonly summary: StatsSummary | null;
  readonly days: readonly DailyStats[];
  readonly deleteDays: readonly string[];
  /** Created only where no document exists (or, in a rebuild, where the existing one cannot be read). */
  readonly createAchievements: readonly Achievement[];
  readonly deleteAchievements: readonly string[];
  /** The stats were rebuilt from the stored results in this transaction. */
  readonly rebuilt: boolean;
};

/** Refuses stats that this build must not write: newer code's, or unreadable ones. */
function usable<T>(state: StatsDocumentState<T>, path: string): StatsDocumentState<T> {
  if (state.kind === 'newer') throw new ProcessingError(PROCESSING_REASONS.statsNewerThanCode, `${path} was written by newer code`);
  if (state.kind === 'unreadable') throw new ProcessingError(PROCESSING_REASONS.statsUnreadable, `${path} cannot be read: ${state.detail}`);
  return state;
}

type Rebuilt = {
  readonly summary: StatsSummary | null;
  readonly days: Map<string, DailyStats>;
  readonly achievements: Achievement[];
  /** Dates of the dailyStats documents that exist. */
  readonly existingDays: readonly string[];
  /** IDs of the achievement documents that exist, and whether this build can read each. */
  readonly existingAchievements: ReadonlyMap<string, 'readable' | 'unreadable'>;
};

/**
 * Rebuilds the user's stats inside `transaction` from every stored trusted
 * result (shared rebuildStats: replayed in endedAt order through the same
 * reducer, never rescoring; sessions without a result are skipped). It reads
 * every session through a projection without trials (about 1 KB each), and
 * every dailyStats and achievement document, so no session can be processed
 * concurrently with it. Stats documents written by newer code are refused.
 *
 * Limit: like the progress rebuild, the read grows with the user's history.
 * It runs only for an aggregateVersion change, or from the admin rebuild.
 */
async function rebuildInTransaction(
  context: ProcessingContext,
  transaction: Transaction,
  uid: string,
  appliedAt: FirestoreTimestamp,
): Promise<Rebuilt> {
  const { db } = context;
  const sessions = await transaction.get(sessionsOf(db, uid).select(...SESSION_AGGREGATE_FIELDS));
  const stored: StoredStatsSession[] = [];
  for (const document of sessions.docs) {
    const data = document.data();
    if (data.result === undefined) continue;
    try {
      stored.push({ id: document.id, session: readSessionAggregateFields(data) });
    } catch (error) {
      // An invalid session counts nowhere, so its envelope does not matter.
      if (error instanceof DomainReadError && (data.result as { validity?: unknown }).validity === 'invalid') continue;
      throw new ProcessingError(PROCESSING_REASONS.sessionUnreadable, `session ${document.id} cannot be read for a stats rebuild`);
    }
  }
  const days = await transaction.get(dailyStatsCollection(db, uid));
  for (const document of days.docs) {
    if (classifyDailyStats(document.data(), document.id).kind === 'newer') {
      throw new ProcessingError(PROCESSING_REASONS.statsNewerThanCode, `dailyStats/${document.id} was written by newer code`);
    }
  }
  const achievements = await transaction.get(achievementsCollection(db, uid));
  const existingAchievements = new Map<string, 'readable' | 'unreadable'>();
  for (const document of achievements.docs) {
    const state = classifyAchievement(document.data(), document.id);
    if (state.kind === 'newer') {
      throw new ProcessingError(PROCESSING_REASONS.statsNewerThanCode, `achievements/${document.id} was written by newer code`);
    }
    existingAchievements.set(document.id, state.kind === 'current' ? 'readable' : 'unreadable');
  }
  const rebuilt = rebuildStats(stored, appliedAt);
  return {
    summary: rebuilt.summary,
    days: new Map(rebuilt.days.map((day) => [day.date, day])),
    achievements: rebuilt.achievements,
    existingDays: days.docs.map((document) => document.id),
    existingAchievements,
  };
}

type Applied = {
  readonly summary: StatsSummary | null;
  /** The days the events touched (all of them, after a rebuild). */
  readonly days: Map<string, DailyStats>;
  readonly earned: Achievement[];
};

function applyEvents(
  summary: StatsSummary | null,
  days: Map<string, DailyStats | null>,
  events: readonly StatsEvent[],
  appliedAt: FirestoreTimestamp,
): Applied {
  let current = summary;
  const touched = new Map<string, DailyStats>();
  const earned: Achievement[] = [];
  for (const event of events) {
    const input = { sessionId: event.sessionId, session: event.session, result: event.result, appliedAt };
    if (event.kind === 'counted') {
      const date = event.session.localDate;
      const update = applyCountedSession(current, touched.get(date) ?? days.get(date) ?? null, input);
      current = update.summary;
      touched.set(date, update.day);
      earned.push(...update.earned);
    } else {
      // The caller loads stats before upgrading; a counted session created them, so they exist.
      if (current === null) throw new Error('Cannot upgrade a session in stats that do not exist');
      const update = applyValidUpgrade(current, input);
      current = update.summary;
      earned.push(...update.earned);
    }
  }
  return { summary: current, days: touched, earned };
}

/** The writes after a rebuild: every rebuilt day and achievement, with the events applied on top. */
function rebuiltWrite(rebuilt: Rebuilt, applied: Applied): StatsWrite {
  const days = new Map(rebuilt.days);
  for (const [date, day] of applied.days) days.set(date, day);
  const achievements = [...rebuilt.achievements, ...applied.earned];
  const earnedIds = new Set(achievements.map(({ achievementId }) => achievementId));
  return {
    summary: applied.summary,
    days: [...days.values()],
    deleteDays: rebuilt.existingDays.filter((date) => !days.has(date)),
    // An existing readable document keeps its original attribution: a rebuild never rewrites history the player has seen.
    createAchievements: achievements.filter(({ achievementId }) => rebuilt.existingAchievements.get(achievementId) !== 'readable'),
    // Only this build's catalogue: an ID it does not know is left alone.
    deleteAchievements: [...rebuilt.existingAchievements.keys()].filter((id) => !earnedIds.has(id) && findAchievement(id) !== undefined),
    rebuilt: true,
  };
}

/** Keeps only the earned achievements that have no document yet: each is created only if absent. */
async function absentAchievements(transaction: Transaction, db: Firestore, uid: string, earned: readonly Achievement[]) {
  if (earned.length === 0) return [];
  const snapshots = await transaction.getAll(...earned.map(({ achievementId }) => achievementsCollection(db, uid).doc(achievementId)));
  return earned.filter((_, index) => !snapshots[index]!.exists);
}

/**
 * Plans the stats writes of a processing transaction (reads only; call it
 * after every other read and before any write). `events` start with the
 * processed session ('counted'), then the sessions its commit upgrades.
 *
 * - Current stats (or none, for a new player): apply the events. Every
 *   counted session writes stats in its own processing transaction, so no
 *   stats means no session counts yet.
 * - Stats from an older aggregateVersion: rebuild from the stored results,
 *   then apply the events.
 * - Newer or unreadable stats: a ProcessingError, so nothing is written and
 *   the session is retried, then marked failed.
 */
export async function planStatsForProcessing(
  context: ProcessingContext,
  transaction: Transaction,
  uid: string,
  events: readonly StatsEvent[],
  appliedAt: FirestoreTimestamp,
): Promise<StatsWrite> {
  const { db } = context;
  const summaryState = usable(classifyStatsSummary((await transaction.get(statsSummaryRef(db, uid))).data()), 'stats/summary');
  const dates = [...new Set(events.filter(({ kind }) => kind === 'counted').map(({ session }) => session.localDate))];
  const snapshots = dates.length === 0 ? [] : await transaction.getAll(...dates.map((date) => dailyStatsCollection(db, uid).doc(date)));
  const dayStates = snapshots.map((snapshot, index) => usable(classifyDailyStats(snapshot.data(), dates[index]!), `dailyStats/${dates[index]}`));

  const rebuild = summaryState.kind === 'older' || dayStates.some(({ kind }) => kind === 'older');
  if (rebuild) {
    const rebuilt = await rebuildInTransaction(context, transaction, uid, appliedAt);
    return rebuiltWrite(rebuilt, applyEvents(rebuilt.summary, rebuilt.days, events, appliedAt));
  }

  const days = new Map(dates.map((date, index) => {
    const state = dayStates[index]!;
    return [date, state.kind === 'current' ? state.value : null] as const;
  }));
  const applied = applyEvents(summaryState.kind === 'current' ? summaryState.value : null, days, events, appliedAt);
  return {
    summary: applied.summary,
    days: [...applied.days.values()],
    deleteDays: [],
    createAchievements: await absentAchievements(transaction, db, uid, applied.earned),
    deleteAchievements: [],
    rebuilt: false,
  };
}

/**
 * Plans the stats writes of a post-commit upgrade batch (reads only): the
 * valid-only effects of each upgraded session.
 *
 * - 'skip': there are no current stats to update: an older
 *   aggregateVersion, or none (not expected, since the upgraded session
 *   already counts and counted sessions write stats). Nothing is lost: the
 *   next processing transaction (for older stats) or the admin rebuild
 *   rebuilds them from the stored results, which then include these upgrades.
 * - 'not-current': newer or unreadable stats, which this build must not
 *   write; the batch then upgrades nothing, just as it does for progress
 *   that is not current.
 */
export async function planStatsForUpgrades(
  context: ProcessingContext,
  transaction: Transaction,
  uid: string,
  events: readonly StatsEvent[],
  appliedAt: FirestoreTimestamp,
): Promise<StatsWrite | 'skip' | 'not-current'> {
  const { db } = context;
  const state = classifyStatsSummary((await transaction.get(statsSummaryRef(db, uid))).data());
  if (state.kind === 'newer' || state.kind === 'unreadable') return 'not-current';
  if (state.kind !== 'current') return 'skip';
  const applied = applyEvents(state.value, new Map(), events, appliedAt);
  return {
    summary: applied.summary,
    days: [],
    deleteDays: [],
    createAchievements: await absentAchievements(transaction, db, uid, applied.earned),
    deleteAchievements: [],
    rebuilt: false,
  };
}

/** Writes a planned StatsWrite in `transaction` (after every read). */
export function writeStats(transaction: Transaction, db: Firestore, uid: string, write: StatsWrite): void {
  if (write.summary === null) transaction.delete(statsSummaryRef(db, uid));
  else transaction.set(statsSummaryRef(db, uid), write.summary);
  for (const day of write.days) transaction.set(dailyStatsCollection(db, uid).doc(day.date), day);
  for (const date of write.deleteDays) transaction.delete(dailyStatsCollection(db, uid).doc(date));
  for (const achievement of write.createAchievements) transaction.set(achievementsCollection(db, uid).doc(achievement.achievementId), achievement);
  for (const id of write.deleteAchievements) transaction.delete(achievementsCollection(db, uid).doc(id));
}

export type StatsRebuildReport = {
  readonly summary: StatsSummary | null;
  readonly days: number;
  readonly achievements: readonly string[];
  /** 'account-deleted': the user's deletion ledger exists, so nothing was written. */
  readonly written: 'set' | 'deleted' | 'unchanged' | 'account-deleted';
};

/**
 * The admin rebuild of one user's stats (design section F,
 * `rebuildUserAggregates`), in one transaction: replays every stored trusted
 * result in endedAt order and overwrites the summary and every dailyStats
 * document. Achievements the replay earns are created where missing (an
 * existing one keeps its original attribution), and achievements of this
 * build's catalogue that the replay does not earn are deleted. Stats written
 * by newer code are refused, never overwritten; unreadable ones are replaced
 * (a repair). A user whose deletion ledger exists is left alone.
 * Deterministic, so it can be re-run.
 */
export async function rebuildUserStats(context: ProcessingContext, uid: string): Promise<StatsRebuildReport> {
  const { db } = context;
  return db.runTransaction(async (transaction) => {
    if (await accountDeleted(transaction, db, uid)) return { summary: null, days: 0, achievements: [], written: 'account-deleted' as const };
    const stored = await transaction.get(statsSummaryRef(db, uid));
    if (classifyStatsSummary(stored.data()).kind === 'newer') {
      throw new ProcessingError(PROCESSING_REASONS.statsNewerThanCode, 'stats/summary was written by newer code');
    }
    const appliedAt = context.now();
    const rebuilt = await rebuildInTransaction(context, transaction, uid, appliedAt);
    const write = rebuiltWrite(rebuilt, { summary: rebuilt.summary, days: new Map(), earned: [] });
    const removed = stored.exists || write.deleteDays.length > 0 || write.deleteAchievements.length > 0;
    if (write.summary === null && !removed) return { summary: null, days: 0, achievements: [], written: 'unchanged' as const };
    // With nothing counted, the summary (if any), every day and every catalogue achievement are deleted.
    writeStats(transaction, db, uid, write);
    return {
      summary: write.summary,
      days: write.days.length,
      achievements: write.summary?.achievements ?? [],
      written: write.summary !== null ? 'set' as const : 'deleted' as const,
    };
  });
}
