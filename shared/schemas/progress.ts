import { z } from 'zod';
import { MAX_GAME_LEVEL, recordKeySchema } from '../games/definition';
import {
  documentIdSchema,
  nonNegativeIntSchema,
  positiveIntSchema,
  slugIdSchema,
  timestampSchema,
} from '../primitives';
import { readVersioned } from './read';

// users/{uid}/progress/{gameId}: trusted, server-maintained per-game progress.
// Stage 1 holds only personal bests, best peak level, unlocks and totals.
// Derived data is never migrated: an aggregateVersion bump rebuilds it from
// the user's sessions.

export const GAME_PROGRESS_SCHEMA_VERSION = 1;
export const PROGRESS_AGGREGATE_VERSION = 1;
/** How many recently applied session IDs progress remembers, so re-applying one is a no-op. */
export const APPLIED_SESSION_LEDGER_SIZE = 100;

export const recordEntrySchema = z.strictObject({
  value: z.number(),
  sessionId: documentIdSchema,
  achievedAt: timestampSchema,
});
export type RecordEntry = z.infer<typeof recordEntrySchema>;

const metricNameSchema = z.string().max(40).regex(/^[A-Za-z][A-Za-z0-9]*$/);

/** recordKey ('endless:3') -> record metric ('score') -> entry. */
export const bestsSchema = z.record(recordKeySchema, z.record(metricNameSchema, recordEntrySchema));
export type Bests = z.infer<typeof bestsSchema>;

const levelSchema = z.int().min(1).max(MAX_GAME_LEVEL);

const gameProgressV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  aggregateVersion: positiveIntSchema,
  updatedAt: timestampSchema,
  gameId: slugIdSchema,
  /** The game version these bests belong to. */
  gameVersion: positiveIntSchema,
  /** Completed sessions at every start level, flagged ones included. */
  sessionsCompleted: nonNegativeIntSchema,
  activeMs: nonNegativeIntSchema,
  lastPlayedAt: timestampSchema,
  /** modeId -> highest peakLevel in any valid completed run, any start level. */
  bestPeakLevel: z.record(slugIdSchema, levelSchema),
  /** modeId -> cached unlockedStartLevel(mode, this). For display only; never read for validation. */
  unlocked: z.record(slugIdSchema, levelSchema),
  bests: bestsSchema,
  /** Earlier gameVersion -> the bests recorded under it. */
  bestsArchive: z.record(z.string().regex(/^[1-9][0-9]*$/), bestsSchema),
  /** Most recently applied session IDs, oldest first. */
  appliedSessionIds: z.array(documentIdSchema).max(APPLIED_SESSION_LEDGER_SIZE),
});

export const gameProgressSchema = gameProgressV1Schema;
export type GameProgress = z.infer<typeof gameProgressSchema>;

export function readGameProgress(raw: unknown): GameProgress {
  return readVersioned('progress', raw, { 1: gameProgressV1Schema });
}
