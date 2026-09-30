import { z } from 'zod';
import { domainContributionsSchema } from '../domains';
import {
  findMode,
  MAX_ACTIVE_DURATION_MS,
  MAX_GAME_LEVEL,
  MAX_TRIALS_PER_SESSION,
  maxLevelOf,
  responseTimeSummarySchema,
  type GameDefinition,
} from '../games/definition';
import {
  boundedTextSchema,
  compareTimestamps,
  fractionSchema,
  localDateSchema,
  nonNegativeIntSchema,
  positiveIntSchema,
  slugIdSchema,
  timestampSchema,
  uidSchema,
} from '../primitives';
import { readVersioned } from './read';

// users/{uid}/gameSessions/{sessionId}: the primary record. The client
// generates the ID when the game starts and writes the document once, when it
// ends. `result` is written only by trusted server code.
//
// There is deliberately no EEG flag here: sessions are immutable but EEG
// recordings can be deleted, so the only link is eegRecordings.gameSessionId.

export const GAME_SESSION_SCHEMA_VERSION = 1;

export const sessionStatusSchema = z.enum(['completed', 'abandoned']);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

/**
 * valid: counts everywhere. flagged: kept in history and counted in totals,
 * but sets no records or unlocks. invalid: counts nowhere.
 */
export const sessionValiditySchema = z.enum(['valid', 'flagged', 'invalid']);
export type SessionValidity = z.infer<typeof sessionValiditySchema>;

const levelSchema = z.int().min(1).max(MAX_GAME_LEVEL);

export const serverResultSchema = z.strictObject({
  processedAt: timestampSchema,
  scoringVersion: positiveIntSchema,
  validity: sessionValiditySchema,
  /** e.g. 'rt-below-floor', 'summary-mismatch', 'start-level-locked'. */
  reasons: z.array(z.string().max(40).regex(/^[a-z][a-z0-9-]*$/)).max(20),
  /** Recomputed from trials: the value every screen uses. */
  score: z.number(),
  accuracy: fractionSchema.nullable(),
  responseTime: responseTimeSummarySchema.nullable(),
  /** Null until a validated performanceIndex version exists; always null in Stage 1. */
  performanceIndex: z.number().nullable(),
  performanceIndexVersion: positiveIntSchema.nullable(),
  /** The catalogue weights applied to this session. */
  domainContributions: domainContributionsSchema,
  personalBest: z.boolean(),
  unlocked: z.array(z.strictObject({ modeId: slugIdSchema, startLevel: levelSchema })).max(MAX_GAME_LEVEL),
}).refine((result) => (result.performanceIndex === null) === (result.performanceIndexVersion === null), {
  path: ['performanceIndexVersion'],
  message: 'performanceIndex and performanceIndexVersion must both be set or both be null',
});
export type ServerResult = z.infer<typeof serverResultSchema>;

function gameSessionSchemaWith<Trial extends z.ZodType, Metrics extends z.ZodType>(
  trials: z.ZodArray<Trial>,
  metrics: Metrics,
) {
  return z.strictObject({
    schemaVersion: z.literal(1),
    /** Equals the path uid; keeps collection-group queries possible later. */
    userId: uidSchema,
    gameId: slugIdSchema,
    gameVersion: positiveIntSchema,
    modeId: slugIdSchema,
    /** The level the session began at. */
    startLevel: levelSchema,
    /** The highest level reached; equals startLevel for fixed-level games. */
    peakLevel: levelSchema,
    status: sessionStatusSchema,
    /** Device clock. */
    startedAt: timestampSchema,
    /** Device clock. */
    endedAt: timestampSchema,
    /** Excludes pauses. */
    activeDurationMs: z.int().min(0).max(MAX_ACTIVE_DURATION_MS),
    /** The day this session counts toward, in `timezone`. */
    localDate: localDateSchema,
    timezone: boundedTextSchema(64),
    /** Server clock (rules force request.time). */
    createdAt: timestampSchema,
    client: z.strictObject({
      appVersion: boundedTextSchema(40),
      platform: z.enum(['ios', 'android', 'web']),
    }),
    /** Raw observations; the server rescores from these. */
    trials,
    /** Client-derived for immediate display; never trusted. */
    summary: z.strictObject({
      score: z.number(),
      accuracy: fractionSchema.nullable(),
      trialsTotal: nonNegativeIntSchema,
      trialsCorrect: nonNegativeIntSchema.nullable(),
      responseTime: responseTimeSummarySchema.nullable(),
      metrics,
    }),
    result: serverResultSchema.optional(),
  }).superRefine((session, ctx) => {
    if (session.peakLevel < session.startLevel) {
      ctx.addIssue({ code: 'custom', path: ['peakLevel'], message: 'peakLevel cannot be below startLevel' });
    }
    if (compareTimestamps(session.endedAt, session.startedAt) <= 0) {
      ctx.addIssue({ code: 'custom', path: ['endedAt'], message: 'endedAt must be after startedAt' });
    }
  });
}

/** Any game's session, with trials and metrics validated only as maps. */
export const gameSessionSchema = gameSessionSchemaWith(
  z.array(z.record(z.string(), z.unknown())).max(MAX_TRIALS_PER_SESSION),
  z.record(z.string(), z.unknown()),
);
export type GameSession = z.infer<typeof gameSessionSchema>;

/**
 * One game's session: trials and metrics validated with the game's own
 * schemas, and the game, version, mode and levels checked against its
 * definition.
 */
export function gameSessionSchemaFor<Trial, Metrics extends object>(definition: GameDefinition<Trial, Metrics>) {
  return gameSessionSchemaWith(
    z.array(definition.trialSchema).max(definition.limits.maxTrials),
    definition.metricsSchema,
  ).superRefine((session, ctx) => {
    if (session.gameId !== definition.id) {
      ctx.addIssue({ code: 'custom', path: ['gameId'], message: `expected '${definition.id}'` });
    }
    if (session.gameVersion > definition.gameVersion) {
      ctx.addIssue({ code: 'custom', path: ['gameVersion'], message: 'unknown game version' });
    }
    const mode = findMode(definition, session.modeId);
    if (!mode) {
      ctx.addIssue({ code: 'custom', path: ['modeId'], message: 'unknown mode' });
    } else if (session.peakLevel > maxLevelOf(mode)) {
      ctx.addIssue({ code: 'custom', path: ['peakLevel'], message: 'level is beyond the mode' });
    }
  });
}
export type GameSessionOf<Trial, Metrics extends object> =
  z.infer<ReturnType<typeof gameSessionSchemaFor<Trial, Metrics>>>;

export function readGameSession(raw: unknown): GameSession {
  return readVersioned('gameSessions', raw, { 1: gameSessionSchema });
}

export function readGameSessionFor<Trial, Metrics extends object>(
  definition: GameDefinition<Trial, Metrics>,
  raw: unknown,
): GameSessionOf<Trial, Metrics> {
  return readVersioned('gameSessions', raw, { 1: gameSessionSchemaFor(definition) });
}
