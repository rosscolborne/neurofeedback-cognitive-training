import { z } from 'zod';
import { MAX_GAME_LEVEL } from '../games/definition';
import {
  documentIdSchema,
  localDateSchema,
  nonNegativeIntSchema,
  objectSchema,
  positiveIntSchema,
  slugIdSchema,
  timestampSchema,
  type SchemaMode,
} from '../primitives';
import { DomainReadError, readVersioned } from './read';

// The cross-game aggregates (NFCT-13), written only by trusted scoring in the
// same transaction as a session's `result` and progress/{gameId}:
//
// - users/{uid}/stats/summary: all-time totals, the streak and the IDs of the
//   achievements earned;
// - users/{uid}/dailyStats/{localDate}: one document per local date played;
// - users/{uid}/achievements/{achievementId}: one document per achievement
//   earned, created only if absent.
//
// Like progress, they are derived data: never migrated, only rebuilt from the
// sessions' stored trusted results. One `aggregateVersion` covers all three
// (the reducers in shared/stats/ and the achievement catalogue), so a change
// to any of them, including a new achievement, bumps STATS_AGGREGATE_VERSION
// and trusted scoring rebuilds the user's stats before applying a session.
// Reading accepts any aggregateVersion.

export const STATS_SUMMARY_SCHEMA_VERSION = 1;
export const DAILY_STATS_SCHEMA_VERSION = 1;
export const ACHIEVEMENT_SCHEMA_VERSION = 1;
/** The version of the stats reducers and the achievement catalogue. */
export const STATS_AGGREGATE_VERSION = 1;
/** The one document in users/{uid}/stats. */
export const STATS_SUMMARY_ID = 'summary';
/** The most achievement IDs a summary lists (design section G: achievements stay small). */
export const MAX_ACHIEVEMENTS = 200;

const levelSchema = z.int().min(1).max(MAX_GAME_LEVEL);

/** A stable kebab-case achievement ID: the document ID, never renamed or reused. */
export const achievementIdSchema = slugIdSchema;

const DAY_MS = 86_400_000;
function dayOrdinal(date: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

function streakSchemaFor(mode: SchemaMode) {
  const runSchema = objectSchema(mode, { start: localDateSchema, end: localDateSchema });
  return objectSchema(mode, {
    /**
     * Every training day, as maximal runs of consecutive local dates, oldest
     * first. Runs never overlap or touch (a gap of at least one day separates
     * them), so adding a day is a set union and the result never depends on
     * the order sessions are processed in.
     */
    runs: z.array(runSchema),
    /**
     * Days in the latest run, whether or not it is still alive: whether it is
     * depends on "today" in the player's zone, so it is decided when it is
     * read (streakStatus).
     */
    current: nonNegativeIntSchema,
    longest: nonNegativeIntSchema,
    /** The latest training day, or null before the first. */
    lastActiveDate: localDateSchema.nullable(),
  }).superRefine((streak, ctx) => {
    const ordered = streak.runs.every(({ start, end }) => start <= end)
      && streak.runs.every((run, index) => index === 0 || dayOrdinal(run.start) - dayOrdinal(streak.runs[index - 1]!.end) >= 2);
    if (!ordered) ctx.addIssue({ code: 'custom', path: ['runs'], message: 'runs must be ordered, disjoint and separated by a gap' });
    const lengths = streak.runs.map(({ start, end }) => dayOrdinal(end) - dayOrdinal(start) + 1);
    const last = streak.runs.at(-1);
    if (streak.current !== (lengths.at(-1) ?? 0) || streak.longest !== Math.max(0, ...lengths)
      || streak.lastActiveDate !== (last?.end ?? null)) {
      ctx.addIssue({ code: 'custom', path: ['current'], message: 'current, longest and lastActiveDate must match the runs' });
    }
  });
}

function statsSummarySchemaFor(mode: SchemaMode) {
  return objectSchema(mode, {
    schemaVersion: z.literal(1),
    aggregateVersion: positiveIntSchema,
    updatedAt: timestampSchema,
    // Activity: every counted session (valid or flagged), completed or abandoned.
    /** Counted sessions, completed and abandoned. */
    sessions: nonNegativeIntSchema,
    /** Counted sessions that were completed (flagged ones included). */
    sessionsCompleted: nonNegativeIntSchema,
    /** Active play time of every counted session. */
    activeMs: nonNegativeIntSchema,
    /** Device clock: the latest `endedAt` of a counted session. */
    lastPlayedAt: timestampSchema,
    // Progression: valid sessions only, so flagged play never earns an achievement.
    /** Valid completed sessions: what run milestones count. */
    validRuns: nonNegativeIntSchema,
    /** gameId -> the highest trusted peak level in a valid completed run of the game (any mode or version). */
    bestPeakLevel: z.record(slugIdSchema, levelSchema),
    streak: streakSchemaFor(mode),
    /** The IDs of the achievements documents trusted scoring has created, in the order they were earned. */
    achievements: z.array(achievementIdSchema).max(MAX_ACHIEVEMENTS),
  });
}

/** Current schema, strict: what trusted code may write. */
export const statsSummaryWriteSchema = statsSummarySchemaFor('write');
/** Tolerant of fields added by newer compatible writers. */
export const statsSummaryReadSchema = statsSummarySchemaFor('read');
export type StatsSummary = z.infer<typeof statsSummaryWriteSchema>;
export type StreakState = StatsSummary['streak'];
export type StreakRun = StreakState['runs'][number];

export function readStatsSummary(raw: unknown): StatsSummary {
  return readVersioned('stats', raw, { 1: statsSummaryReadSchema });
}

function dailyStatsSchemaFor(mode: SchemaMode) {
  const activity = {
    /** Counted sessions (valid or flagged), completed and abandoned. */
    sessions: nonNegativeIntSchema,
    /** Counted sessions that were completed. */
    sessionsCompleted: nonNegativeIntSchema,
    activeMs: nonNegativeIntSchema,
  };
  return objectSchema(mode, {
    schemaVersion: z.literal(1),
    aggregateVersion: positiveIntSchema,
    updatedAt: timestampSchema,
    /** The document ID: the sessions' own `localDate`, the day in the player's zone. Queried by range. */
    date: localDateSchema,
    ...activity,
    /** gameId -> the same counts for that game. */
    games: z.record(slugIdSchema, objectSchema(mode, activity)),
  });
}

export const dailyStatsWriteSchema = dailyStatsSchemaFor('write');
export const dailyStatsReadSchema = dailyStatsSchemaFor('read');
export type DailyStats = z.infer<typeof dailyStatsWriteSchema>;

export function readDailyStats(raw: unknown): DailyStats {
  return readVersioned('dailyStats', raw, { 1: dailyStatsReadSchema });
}

function achievementSchemaFor(mode: SchemaMode) {
  return objectSchema(mode, {
    schemaVersion: z.literal(1),
    /** The document ID; its title and description live in the code catalogue (ACHIEVEMENT_CATALOGUE). */
    achievementId: achievementIdSchema,
    /** Server clock: when trusted scoring first recorded it. */
    earnedAt: timestampSchema,
    /** The valid session whose processing (or start-level upgrade) earned it. */
    sessionId: documentIdSchema,
    gameId: slugIdSchema,
    /** That session's local date. */
    localDate: localDateSchema,
  });
}

export const achievementWriteSchema = achievementSchemaFor('write');
export const achievementReadSchema = achievementSchemaFor('read');
export type Achievement = z.infer<typeof achievementWriteSchema>;

/** Reads an achievement document; its `achievementId` must be its document ID when one is given. */
export function readAchievement(raw: unknown, documentId?: string): Achievement {
  const achievement = readVersioned('achievements', raw, { 1: achievementReadSchema });
  if (documentId !== undefined && achievement.achievementId !== documentId) {
    throw new DomainReadError('achievements', `achievementId '${achievement.achievementId}' is not the document ID '${documentId}'`);
  }
  return achievement;
}
