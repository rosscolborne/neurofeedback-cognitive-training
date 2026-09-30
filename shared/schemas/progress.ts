import { z } from 'zod';
import { MAX_GAME_LEVEL, recordKeySchema, recordMetricNameSchema } from '../games/definition';
import {
  documentIdSchema,
  nonNegativeIntSchema,
  objectSchema,
  positiveIntSchema,
  slugIdSchema,
  timestampSchema,
  type SchemaMode,
} from '../primitives';
import { readVersioned } from './read';

// users/{uid}/progress/{gameId}: trusted, server-maintained per-game progress.
// Stage 1 holds only personal bests, best peak level, unlocks and totals.
// Derived data is never migrated: an aggregateVersion bump rebuilds it from
// the user's sessions. Reading accepts any aggregateVersion; only applying a
// session requires the version this build's reducer maintains.

export const GAME_PROGRESS_SCHEMA_VERSION = 1;
export const PROGRESS_AGGREGATE_VERSION = 1;

const levelSchema = z.int().min(1).max(MAX_GAME_LEVEL);

function gameProgressSchemaFor(mode: SchemaMode) {
  const recordEntrySchema = objectSchema(mode, {
    value: z.number(),
    sessionId: documentIdSchema,
    achievedAt: timestampSchema,
  });
  /** recordKey ('endless:3') -> record metric ('score') -> entry. */
  const bestsSchema = z.record(recordKeySchema, z.record(recordMetricNameSchema, recordEntrySchema));

  return objectSchema(mode, {
    schemaVersion: z.literal(1),
    aggregateVersion: positiveIntSchema,
    updatedAt: timestampSchema,
    gameId: slugIdSchema,
    /** The latest game version played: the record set `bests` belongs to. */
    gameVersion: positiveIntSchema,
    /** Completed sessions at every start level, flagged ones included. */
    sessionsCompleted: nonNegativeIntSchema,
    activeMs: nonNegativeIntSchema,
    lastPlayedAt: timestampSchema,
    /**
     * modeId -> highest trusted peak level in any valid completed run, any
     * start level and any game version, so earned unlocks survive a version bump.
     */
    bestPeakLevel: z.record(slugIdSchema, levelSchema),
    /** modeId -> cached unlockedStartLevel(mode, this). For display only; never read for validation. */
    unlocked: z.record(slugIdSchema, levelSchema),
    bests: bestsSchema,
    /** Earlier gameVersion -> the bests recorded under it. */
    bestsArchive: z.record(z.string().regex(/^[1-9][0-9]*$/), bestsSchema),
  });
}

/** Current schema, strict: what trusted code may write. */
export const gameProgressWriteSchema = gameProgressSchemaFor('write');
/** Tolerant of fields added by newer compatible writers. */
export const gameProgressReadSchema = gameProgressSchemaFor('read');
export type GameProgress = z.infer<typeof gameProgressWriteSchema>;
export type Bests = GameProgress['bests'];
export type RecordEntry = NonNullable<NonNullable<Bests[string]>[string]>;

export function readGameProgress(raw: unknown): GameProgress {
  return readVersioned('progress', raw, { 1: gameProgressReadSchema });
}
