import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type CollectionReference,
  type DocumentReference,
  type Firestore,
  type Query,
  type QuerySnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  assertDailyStatsRange,
  DomainReadError,
  MAX_ACHIEVEMENTS,
  MAX_DAILY_STATS_RANGE_DAYS,
  readAchievement,
  readDailyStats,
  readStatsSummary,
  STATS_SUMMARY_ID,
  type Achievement,
  type DailyStats,
  type LocalDateRange,
  type StatsSummary,
} from '@nfct/shared';
import { signedInUid, USERS, type ConsumerFirestoreContext } from '../firestore/context';
import { readDocument, readDocuments, type DocumentRead, type UnreadableDocument } from '../firestore/reads';

// The cross-game aggregates (NFCT-13), written only by trusted scoring in the
// same commit as a session's result and progress, and read here:
//
// - users/{uid}/stats/summary: all-time totals, the streak and the earned
//   achievement IDs (one document read);
// - users/{uid}/dailyStats/{localDate}: a range of at most 31 days, for the
//   week, month and weekly-goal views (shared/stats/views.ts computes them on
//   read, with the profile's weeklyGoal);
// - users/{uid}/achievements: the earned achievements (small; titles and
//   descriptions come from the code catalogue, ACHIEVEMENT_CATALOGUE).
//
// Reads are tolerant: a document this build cannot read is reported as
// unreadable, never thrown. A missing summary is normal: no session has
// counted yet. Whether the streak is still alive depends on today's date in
// the player's zone: streakStatus(summary.streak, localDateIn(timezone, now)).
// The client never writes any of these; the rules refuse it.

export const STATS = 'stats';
export const DAILY_STATS = 'dailyStats';
export const ACHIEVEMENTS = 'achievements';

function statsSummaryRef(firestore: Firestore, uid: string): DocumentReference {
  return doc(firestore, USERS, uid, STATS, STATS_SUMMARY_ID);
}

function dailyStatsRef(firestore: Firestore, uid: string): CollectionReference {
  return collection(firestore, USERS, uid, DAILY_STATS);
}

function achievementsRef(firestore: Firestore, uid: string): CollectionReference {
  return collection(firestore, USERS, uid, ACHIEVEMENTS);
}

/** A day's document, which must be stored under its own date. */
function dailyStatsRecord(raw: Record<string, unknown>, id: string): DailyStats {
  const day = readDailyStats(raw);
  if (day.date !== id) throw new DomainReadError('dailyStats', `date '${day.date}' is not the document ID '${id}'`);
  return day;
}

export interface DailyStatsRead {
  readonly range: LocalDateRange;
  /** The documents in the range, by date. A date with no document had no counted session. */
  readonly days: DailyStats[];
  readonly unreadable: UnreadableDocument[];
  /** Served from the local cache (offline, or before the server answered). */
  readonly fromCache: boolean;
}

export interface AchievementsRead {
  /**
   * In the order they were earned (`earnedAt`). Achievements earned in the
   * same commit share `earnedAt` and come back in document-ID order;
   * `summary.achievements` keeps the exact order they were earned in.
   */
  readonly achievements: Achievement[];
  readonly unreadable: UnreadableDocument[];
  readonly fromCache: boolean;
}

export interface StatsRepository {
  getSummary(): Promise<DocumentRead<StatsSummary>>;
  subscribeToSummary(onNext: (summary: DocumentRead<StatsSummary>) => void, onError: (error: Error) => void): Unsubscribe;
  /**
   * The daily stats of an inclusive range of local dates, at most
   * MAX_DAILY_STATS_RANGE_DAYS (31) days. Rejects a range that is not ordered,
   * too long or not made of real dates (a caller error).
   */
  getDailyStats(range: LocalDateRange): Promise<DailyStatsRead>;
  /**
   * Follows the daily stats of a range. Like the other subscriptions with a
   * missing sign-in, a caller error (a range getDailyStats would reject)
   * throws synchronously instead of reaching `onError`, which reports
   * Firestore errors.
   */
  subscribeToDailyStats(
    range: LocalDateRange,
    onNext: (days: DailyStatsRead) => void,
    onError: (error: Error) => void,
  ): Unsubscribe;
  getAchievements(): Promise<AchievementsRead>;
  subscribeToAchievements(onNext: (achievements: AchievementsRead) => void, onError: (error: Error) => void): Unsubscribe;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function createStatsRepository(context: ConsumerFirestoreContext): StatsRepository {
  const { firestore } = context;

    const dailyQuery = (uid: string, range: LocalDateRange): Query => {
    const { from, to } = assertDailyStatsRange(range);
    return query(dailyStatsRef(firestore, uid), where('date', '>=', from), where('date', '<=', to), orderBy('date'), limit(MAX_DAILY_STATS_RANGE_DAYS));
  };
  const daysOf = (range: LocalDateRange, snapshot: QuerySnapshot): DailyStatsRead => {
    const { readable, unreadable } = readDocuments('dailyStats', snapshot.docs, (raw, item) => dailyStatsRecord(raw, item.id));
    return { range, days: readable, unreadable, fromCache: snapshot.metadata.fromCache };
  };
  const achievementsQuery = (uid: string): Query => query(achievementsRef(firestore, uid), orderBy('earnedAt'), limit(MAX_ACHIEVEMENTS));
  const achievementsOf = (snapshot: QuerySnapshot): AchievementsRead => {
    const { readable, unreadable } = readDocuments('achievements', snapshot.docs, (raw, item) => readAchievement(raw, item.id));
    return { achievements: readable, unreadable, fromCache: snapshot.metadata.fromCache };
  };

  return {
    async getSummary() {
      const snapshot = await getDoc(statsSummaryRef(firestore, signedInUid(context)));
      return readDocument('stats', snapshot, (raw) => readStatsSummary(raw));
    },

    subscribeToSummary(onNext, onError) {
      return onSnapshot(statsSummaryRef(firestore, signedInUid(context)), { includeMetadataChanges: true }, (snapshot) => {
        onNext(readDocument('stats', snapshot, (raw) => readStatsSummary(raw)));
      }, (error) => onError(asError(error)));
    },

    async getDailyStats(range) {
      return daysOf(range, await getDocs(dailyQuery(signedInUid(context), range)));
    },

    subscribeToDailyStats(range, onNext, onError) {
      const daily = dailyQuery(signedInUid(context), range);
      return onSnapshot(daily, { includeMetadataChanges: true }, (snapshot) => onNext(daysOf(range, snapshot)), (error) => onError(asError(error)));
    },

    async getAchievements() {
      return achievementsOf(await getDocs(achievementsQuery(signedInUid(context))));
    },

    subscribeToAchievements(onNext, onError) {
      return onSnapshot(achievementsQuery(signedInUid(context)), { includeMetadataChanges: true },
        (snapshot) => onNext(achievementsOf(snapshot)), (error) => onError(asError(error)));
    },
  };
}
