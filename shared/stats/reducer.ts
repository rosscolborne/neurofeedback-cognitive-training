import { compareTimestamps, type FirestoreTimestamp } from '../primitives';
import type { GameSession, ServerResult } from '../schemas/gameSession';
import { DomainReadError } from '../schemas/read';
import {
  achievementWriteSchema,
  ACHIEVEMENT_SCHEMA_VERSION,
  dailyStatsWriteSchema,
  DAILY_STATS_SCHEMA_VERSION,
  readAchievement,
  readDailyStats,
  readStatsSummary,
  statsSummaryWriteSchema,
  STATS_AGGREGATE_VERSION,
  STATS_SUMMARY_SCHEMA_VERSION,
  type Achievement,
  type DailyStats,
  type StatsSummary,
} from '../schemas/stats';
import { newlyMetAchievements } from './achievements';
import { addTrainingDay, EMPTY_STREAK } from './streak';

// The stats reducers (NFCT-13): stats/summary, dailyStats/{localDate} and the
// achievements, from sessions' trusted results. Pure and deterministic: they
// read no clock and never mutate their inputs. Trusted scoring calls them in
// the same transaction that writes the session's result and its game's
// progress; the rebuild replays stored results through them. EEG is never an
// input, and nothing here reads a session's trials or client summary.
//
// Eligibility (design sections D and F, ADR-001 decision 6):
//
// | Session                         | Activity (totals, dailyStats) | Valid runs, peak level, streak, achievements |
// | ------------------------------- | ----------------------------- | -------------------------------------------- |
// | valid, completed                | counted                       | counted (streak: only with a verified date)  |
// | valid, abandoned                | counted                       | never                                        |
// | flagged (completed or abandoned)| counted                       | never (until upgraded to valid)              |
// | invalid                         | never                         | never                                        |
//
// A training day (what a streak counts) is the `localDate` of a valid
// completed session whose date the server could verify: its result carries
// neither 'local-date-mismatch' (localDate more than a day from the server's
// own clock, the anti-backfill check) nor 'unknown-timezone' (no check
// possible), nor 'reasons-truncated' (a cut list might have hidden either).
//
// Exactly once and order independence. Activity totals are sums applied once,
// when a session is first processed (the processing transaction skips a
// session that already has a result). Everything valid-only is applied once
// per session too: at processing when it is valid then, or when the
// start-level upgrade turns it from flagged to valid (a session is upgraded
// at most once), and it is a sum, a maximum or a set union. So the final
// summary is the same for every processing order, and equals a rebuild from
// the stored final results. Achievement criteria are monotone in it, so the
// achievements earned are the same too; which session earned each one is a
// point-in-time fact.

/** The session fields stats depend on. */
export type StatsSession = Pick<GameSession, 'gameId' | 'status' | 'activeDurationMs' | 'endedAt' | 'localDate'>;

/** Result reasons that mean the server could not verify the session's `localDate`. */
export const DATE_UNVERIFIED_REASONS: readonly string[] = Object.freeze(['local-date-mismatch', 'unknown-timezone', 'reasons-truncated']);

/** Valid or flagged: counted in activity totals. Invalid sessions count nowhere. */
export function countsInStats(result: Pick<ServerResult, 'validity'>): boolean {
  return result.validity === 'valid' || result.validity === 'flagged';
}

/** A valid completed session: a run that counts toward run milestones and peak levels. */
export function isValidRun(session: Pick<StatsSession, 'status'>, result: Pick<ServerResult, 'validity'>): boolean {
  return result.validity === 'valid' && session.status === 'completed';
}

/** Whether the session makes its `localDate` a training day (see the table above). */
export function isTrainingDay(session: Pick<StatsSession, 'status'>, result: Pick<ServerResult, 'validity' | 'reasons'>): boolean {
  return isValidRun(session, result) && !result.reasons.some((code) => DATE_UNVERIFIED_REASONS.includes(code));
}

export type StatsInput = {
  readonly sessionId: string;
  readonly session: StatsSession;
  /** The session's trusted result: as just decided, or as stored. */
  readonly result: ServerResult;
  /** Server clock: becomes `updatedAt`. */
  readonly appliedAt: FirestoreTimestamp;
  /** Server clock: becomes `earnedAt` of what this session earns. Default: `appliedAt`. */
  readonly earnedAt?: FirestoreTimestamp;
};

export type StatsUpdate = {
  readonly summary: StatsSummary;
  /** Achievement documents to create, if absent: what this session earned, in catalogue order. */
  readonly earned: Achievement[];
};

export type CountedStatsUpdate = StatsUpdate & { readonly day: DailyStats };

function emptySummary(lastPlayedAt: FirestoreTimestamp, updatedAt: FirestoreTimestamp): StatsSummary {
  return {
    schemaVersion: STATS_SUMMARY_SCHEMA_VERSION,
    aggregateVersion: STATS_AGGREGATE_VERSION,
    updatedAt,
    sessions: 0,
    sessionsCompleted: 0,
    activeMs: 0,
    lastPlayedAt,
    validRuns: 0,
    bestPeakLevel: {},
    streak: EMPTY_STREAK,
    achievements: [],
  };
}

function emptyDay(date: string, updatedAt: FirestoreTimestamp): DailyStats {
  return {
    schemaVersion: DAILY_STATS_SCHEMA_VERSION,
    aggregateVersion: STATS_AGGREGATE_VERSION,
    updatedAt,
    date,
    sessions: 0,
    sessionsCompleted: 0,
    activeMs: 0,
    games: {},
  };
}

function assertCurrent(summary: StatsSummary | null, day: DailyStats | null): void {
  if (summary !== null && summary.aggregateVersion !== STATS_AGGREGATE_VERSION) {
    throw new Error('stats were maintained by another reducer; rebuild them from sessions');
  }
  if (day !== null && day.aggregateVersion !== STATS_AGGREGATE_VERSION) {
    throw new Error(`dailyStats/${day.date} were maintained by another reducer; rebuild them from sessions`);
  }
}

/** The valid-only effects: one more run, the best peak level and the training day. Abandoned sessions have none. */
function withValidEffects(summary: StatsSummary, { session, result }: StatsInput): StatsSummary {
  if (result.validity !== 'valid' || !isValidRun(session, result)) return summary;
  const { gameId } = session;
  return {
    ...summary,
    validRuns: summary.validRuns + 1,
    bestPeakLevel: { ...summary.bestPeakLevel, [gameId]: Math.max(summary.bestPeakLevel[gameId] ?? 0, result.peakLevel) },
    streak: isTrainingDay(session, result) ? addTrainingDay(summary.streak, session.localDate) : summary.streak,
  };
}

/** Records every catalogue achievement the summary now meets for the first time, attributed to this session. */
function award(summary: StatsSummary, input: StatsInput): StatsUpdate {
  // Only a valid session changes what the criteria read, so only a valid session earns: a flagged one never does.
  if (input.result.validity !== 'valid') return { summary, earned: [] };
  const met = newlyMetAchievements(summary);
  if (met.length === 0) return { summary, earned: [] };
  const earned = met.map(({ id }) => achievementWriteSchema.parse({
    schemaVersion: ACHIEVEMENT_SCHEMA_VERSION,
    achievementId: id,
    earnedAt: input.earnedAt ?? input.appliedAt,
    sessionId: input.sessionId,
    gameId: input.session.gameId,
    localDate: input.session.localDate,
  }));
  return { summary: { ...summary, achievements: [...summary.achievements, ...met.map(({ id }) => id)] }, earned };
}

/**
 * Folds a session's first processing into the stats: its activity (summary
 * and its day) and, when it is valid, its valid-only effects; then records
 * what it earned. Not idempotent: exactly-once application is the caller's
 * job (trusted scoring skips a session that already has a result; a rebuild
 * replays each stored session once).
 *
 * `summary` null means no counted session yet; `day` null means none on the
 * session's localDate. A missing summary is created by the first counted
 * session. Invalid results are a caller error: they count nowhere.
 */
export function applyCountedSession(
  summary: StatsSummary | null,
  day: DailyStats | null,
  input: StatsInput,
): CountedStatsUpdate {
  const { session, result, appliedAt } = input;
  if (!countsInStats(result)) throw new Error(`Cannot count a '${result.validity}' session in stats`);
  if (day !== null && day.date !== session.localDate) throw new Error(`dailyStats/${day.date} is not the session's day ${session.localDate}`);
  assertCurrent(summary, day);

  const completed = session.status === 'completed' ? 1 : 0;
  const base = summary ?? emptySummary(session.endedAt, appliedAt);
  const counted: StatsSummary = {
    ...base,
    updatedAt: appliedAt,
    sessions: base.sessions + 1,
    sessionsCompleted: base.sessionsCompleted + completed,
    activeMs: base.activeMs + session.activeDurationMs,
    lastPlayedAt: compareTimestamps(session.endedAt, base.lastPlayedAt) > 0 ? session.endedAt : base.lastPlayedAt,
  };
  const dayBase = day ?? emptyDay(session.localDate, appliedAt);
  const game = dayBase.games[session.gameId] ?? { sessions: 0, sessionsCompleted: 0, activeMs: 0 };
  const nextDay: DailyStats = {
    ...dayBase,
    updatedAt: appliedAt,
    sessions: dayBase.sessions + 1,
    sessionsCompleted: dayBase.sessionsCompleted + completed,
    activeMs: dayBase.activeMs + session.activeDurationMs,
    games: {
      ...dayBase.games,
      [session.gameId]: {
        sessions: game.sessions + 1,
        sessionsCompleted: game.sessionsCompleted + completed,
        activeMs: game.activeMs + session.activeDurationMs,
      },
    },
  };
  const { summary: awarded, earned } = award(withValidEffects(counted, input), input);
  // Fails closed: trusted code never writes a document its own schemas reject.
  return { summary: statsSummaryWriteSchema.parse(awarded), day: dailyStatsWriteSchema.parse(nextDay), earned };
}

/**
 * Folds the start-level upgrade of a session (flagged when it was processed,
 * valid now) into the stats: only its valid-only effects, because its
 * activity was counted when it was processed. A session is upgraded at most
 * once, so these effects are applied at most once.
 */
export function applyValidUpgrade(summary: StatsSummary, input: StatsInput): StatsUpdate {
  if (input.result.validity !== 'valid') throw new Error(`An upgrade makes a session valid, not '${input.result.validity}'`);
  assertCurrent(summary, null);
  const { summary: awarded, earned } = award({ ...withValidEffects(summary, input), updatedAt: input.appliedAt }, input);
  return { summary: statsSummaryWriteSchema.parse(awarded), earned };
}

export interface StoredStatsSession {
  readonly id: string;
  readonly session: StatsSession & { readonly result?: ServerResult };
}

export type RebuiltStats = {
  /** Null when no session counts. */
  readonly summary: StatsSummary | null;
  /** One per local date with a counted session, in date order. */
  readonly days: DailyStats[];
  /** Every achievement the sessions earn, in the order the replay earned them. */
  readonly achievements: Achievement[];
};

/**
 * Rebuilds the stats from stored sessions (design section F): replays each
 * counted session once from its stored trusted result, in `endedAt` order
 * (then session ID), through the same reducer. Nothing is rescored. The
 * summary, the days and the set of achievements do not depend on the order;
 * the order only decides which session is credited with each achievement,
 * and `earnedAt` is that session's `processedAt`. Sessions without a result
 * are skipped (trusted scoring applies them when it processes them), and so
 * are invalid ones.
 */
export function rebuildStats(sessions: readonly StoredStatsSession[], appliedAt: FirestoreTimestamp): RebuiltStats {
  const counted = sessions
    .filter(({ session }) => session.result !== undefined && countsInStats(session.result))
    .sort((a, b) => compareTimestamps(a.session.endedAt, b.session.endedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let summary: StatsSummary | null = null;
  const days = new Map<string, DailyStats>();
  const achievements: Achievement[] = [];
  for (const { id, session } of counted) {
    const result = session.result!;
    const update = applyCountedSession(summary, days.get(session.localDate) ?? null, {
      sessionId: id,
      session,
      result,
      appliedAt,
      earnedAt: result.processedAt,
    });
    summary = update.summary;
    days.set(session.localDate, update.day);
    achievements.push(...update.earned);
  }
  return { summary, days: [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1)), achievements };
}

/**
 * Whether this build may apply sessions to a stored stats document:
 *
 * - 'missing': no document;
 * - 'current': this build's schema and aggregate version, and readable;
 * - 'older': an older aggregateVersion or schemaVersion: rebuild from the
 *   stored results. Decided from the versions alone, before the shape is
 *   read, because a version bump may change the shape this build reads
 *   (derived data is never upcast, only rebuilt);
 * - 'newer': a newer schemaVersion or aggregateVersion, written by newer
 *   code (a rollback or a mixed deploy): never written by this build;
 * - 'unreadable': this build's versions (or versions it cannot make sense
 *   of), but not readable.
 */
export type StatsDocumentState<T> =
  | { readonly kind: 'missing' }
  | { readonly kind: 'current'; readonly value: T }
  | { readonly kind: 'older' }
  | { readonly kind: 'newer' }
  | { readonly kind: 'unreadable'; readonly detail: string };

function classifyVersioned<T>(
  raw: unknown,
  schemaVersion: number,
  aggregateVersion: number | null,
  read: (raw: unknown) => T,
): StatsDocumentState<T> {
  if (raw === undefined) return { kind: 'missing' };
  // The versions are read tolerantly, before the shape: newer first (never written), then older (rebuilt).
  const versions = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const newer = (value: unknown, known: number) => typeof value === 'number' && value > known;
  const older = (value: unknown, known: number) => Number.isInteger(value) && (value as number) >= 1 && (value as number) < known;
  if (newer(versions.schemaVersion, schemaVersion) || (aggregateVersion !== null && newer(versions.aggregateVersion, aggregateVersion))) {
    return { kind: 'newer' };
  }
  if (older(versions.schemaVersion, schemaVersion) || (aggregateVersion !== null && older(versions.aggregateVersion, aggregateVersion))) {
    return { kind: 'older' };
  }
  try {
    return { kind: 'current', value: read(raw) };
  } catch (error) {
    if (error instanceof DomainReadError) return { kind: 'unreadable', detail: error.message };
    throw error;
  }
}

/** Classifies stored stats/summary data (`undefined` when there is no document). */
export function classifyStatsSummary(raw: unknown): StatsDocumentState<StatsSummary> {
  return classifyVersioned(raw, STATS_SUMMARY_SCHEMA_VERSION, STATS_AGGREGATE_VERSION, readStatsSummary);
}

/** Classifies stored dailyStats/{date} data; a document for another date is unreadable. */
export function classifyDailyStats(raw: unknown, date: string): StatsDocumentState<DailyStats> {
  return classifyVersioned(raw, DAILY_STATS_SCHEMA_VERSION, STATS_AGGREGATE_VERSION, (data) => {
    const day = readDailyStats(data);
    if (day.date !== date) throw new DomainReadError('dailyStats', `date '${day.date}' is not the document ID '${date}'`);
    return day;
  });
}

/** Classifies a stored achievement document. */
export function classifyAchievement(raw: unknown, achievementId: string): StatsDocumentState<Achievement> {
  return classifyVersioned(raw, ACHIEVEMENT_SCHEMA_VERSION, null, (data) => readAchievement(data, achievementId));
}
