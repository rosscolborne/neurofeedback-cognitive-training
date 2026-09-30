import { z } from 'zod';
import { domainContributionsSchemaFor } from '../domains';
import {
  findMode,
  MAX_ACTIVE_DURATION_MS,
  MAX_GAME_LEVEL,
  MAX_TRIALS_PER_SESSION,
  maxLevelOf,
  recordKeySchema,
  recordMetricNameSchema,
  type GameDefinition,
} from '../games/definition';
import { sessionSeedSchema } from '../games/seed';
import {
  boundedTextSchema,
  compareTimestamps,
  fractionSchema,
  localDateSchema,
  nonNegativeIntSchema,
  objectSchema,
  positiveIntSchema,
  slugIdSchema,
  timestampSchema,
  uidSchema,
  type SchemaMode,
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
const reasonSchema = z.string().max(40).regex(/^[a-z][a-z0-9-]*$/);

function responseTimeSchemaFor(mode: SchemaMode) {
  return objectSchema(mode, { medianMs: z.number().min(0), meanMs: z.number().min(0), p90Ms: z.number().min(0) });
}

function serverResultSchemaFor(mode: SchemaMode) {
  // What every processed session carries, so trusted scoring can mark it done exactly once.
  const processing = {
    processedAt: timestampSchema,
    scoringVersion: positiveIntSchema,
  };
  // What the game's scoring derived from the trials. An invalid session has none of it.
  const scored = {
    score: z.number(),
    accuracy: fractionSchema.nullable(),
    responseTime: responseTimeSchemaFor(mode).nullable(),
    /** Replayed from the trials; the value progress uses. */
    peakLevel: levelSchema,
    /** The game's trusted metrics. */
    metrics: z.record(z.string(), z.unknown()),
    /** Null until a validated performanceIndex version exists; always null in Stage 1. */
    performanceIndex: z.number().nullable(),
    performanceIndexVersion: positiveIntSchema.nullable(),
    /** The catalogue weights applied to this session. */
    domainContributions: domainContributionsSchemaFor(mode),
  };
  const indexPaired = (result: { performanceIndex: number | null; performanceIndexVersion: number | null }) =>
    (result.performanceIndex === null) === (result.performanceIndexVersion === null);
  const indexPairedIssue = {
    path: ['performanceIndexVersion'],
    message: 'performanceIndex and performanceIndexVersion must both be set or both be null',
  };

  return z.discriminatedUnion('validity', [
    objectSchema(mode, {
      ...processing,
      validity: z.literal('valid'),
      reasons: z.array(reasonSchema).max(20),
      ...scored,
      /**
       * The record class and values this session competed with, fixed when it
       * was processed, so a rebuild never needs that version's definition.
       */
      recordKey: recordKeySchema,
      recordValues: z.record(recordMetricNameSchema, z.number())
        .refine((values) => Object.keys(values).length > 0, 'At least one record value is required'),
      personalBest: z.boolean(),
      unlocked: z.array(objectSchema(mode, { modeId: slugIdSchema, startLevel: levelSchema })).max(MAX_GAME_LEVEL),
    }).refine(indexPaired, indexPairedIssue),
    objectSchema(mode, {
      ...processing,
      validity: z.literal('flagged'),
      /** e.g. 'rt-below-floor', 'start-level-locked'. */
      reasons: z.array(reasonSchema).min(1).max(20),
      ...scored,
    }).refine(indexPaired, indexPairedIssue),
    objectSchema(mode, {
      ...processing,
      validity: z.literal('invalid'),
      /** e.g. 'schema-invalid', 'unknown-game-version'. */
      reasons: z.array(reasonSchema).min(1).max(20),
    }),
  ]);
}

export const serverResultWriteSchema = serverResultSchemaFor('write');
export type ServerResult = z.infer<typeof serverResultWriteSchema>;

function gameSessionSchemaWith<Trial extends z.ZodType, Metrics extends z.ZodType>(
  mode: SchemaMode,
  trials: z.ZodArray<Trial>,
  metrics: Metrics,
) {
  return objectSchema(mode, {
    schemaVersion: z.literal(1),
    /** Equals the path uid; keeps collection-group queries possible later. */
    userId: uidSchema,
    gameId: slugIdSchema,
    gameVersion: positiveIntSchema,
    modeId: slugIdSchema,
    /** The level the session began at. */
    startLevel: levelSchema,
    /**
     * Chosen by the client at game start and never changed; the game version
     * derives the session's content from it, so trusted scoring can reproduce
     * every recorded question. Forgeable: for reproducibility, not anti-cheat.
     */
    seed: sessionSeedSchema,
    /**
     * The highest level the client says it reached. An untrusted observation:
     * progress uses the peak replayed from the trials (`result.peakLevel`).
     */
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
    client: objectSchema(mode, {
      appVersion: boundedTextSchema(40),
      platform: z.enum(['ios', 'android', 'web']),
    }),
    /** Raw observations; the server rescores from these. */
    trials,
    /** Client-derived for immediate display; never trusted. */
    summary: objectSchema(mode, {
      score: z.number(),
      accuracy: fractionSchema.nullable(),
      trialsTotal: nonNegativeIntSchema,
      trialsCorrect: nonNegativeIntSchema.nullable(),
      responseTime: responseTimeSchemaFor(mode).nullable(),
      metrics,
    }),
    result: serverResultSchemaFor(mode).optional(),
  }).superRefine((session, ctx) => {
    if (session.peakLevel < session.startLevel) {
      ctx.addIssue({ code: 'custom', path: ['peakLevel'], message: 'peakLevel cannot be below startLevel' });
    }
    if (compareTimestamps(session.endedAt, session.startedAt) <= 0) {
      ctx.addIssue({ code: 'custom', path: ['endedAt'], message: 'endedAt must be after startedAt' });
    }
  });
}

function anyGameSessionSchema(mode: SchemaMode) {
  return gameSessionSchemaWith(
    mode,
    z.array(z.record(z.string(), z.unknown())).max(MAX_TRIALS_PER_SESSION),
    z.record(z.string(), z.unknown()),
  );
}

/** Any game's session, current schema, strict: what a client may write. */
export const gameSessionWriteSchema = anyGameSessionSchema('write');
/** Any game's session, tolerant of fields added by newer compatible writers. */
export const gameSessionReadSchema = anyGameSessionSchema('read');
export type GameSession = z.infer<typeof gameSessionWriteSchema>;

/**
 * A session of one game version, with trials and metrics checked by that
 * version's own schemas. It applies only to the definition's exact
 * `gameVersion`: sessions of earlier versions are read with `readGameSession`
 * and are never revalidated or rescored with a later definition.
 */
export function gameSessionSchemaFor<Trial, Metrics extends object>(
  definition: GameDefinition<Trial, Metrics>,
  mode: SchemaMode = 'write',
) {
  return gameSessionSchemaWith(
    mode,
    z.array(definition.trialSchema).max(definition.limits.maxTrials),
    definition.metricsSchema,
  ).superRefine((session, ctx) => {
    if (session.gameId !== definition.id) {
      ctx.addIssue({ code: 'custom', path: ['gameId'], message: `expected '${definition.id}'` });
    }
    if (session.gameVersion !== definition.gameVersion) {
      ctx.addIssue({
        code: 'custom',
        path: ['gameVersion'],
        message: `this definition validates gameVersion ${definition.gameVersion} only`,
      });
    }
    const gameMode = findMode(definition, session.modeId);
    if (!gameMode) {
      ctx.addIssue({ code: 'custom', path: ['modeId'], message: 'unknown mode' });
    } else if (session.peakLevel > maxLevelOf(gameMode)) {
      ctx.addIssue({ code: 'custom', path: ['peakLevel'], message: 'level is beyond the mode' });
    }
  });
}
export type GameSessionOf<Trial, Metrics extends object> =
  z.infer<ReturnType<typeof gameSessionSchemaFor<Trial, Metrics>>>;

export function readGameSession(raw: unknown): GameSession {
  return readVersioned('gameSessions', raw, { 1: gameSessionReadSchema });
}

export function readGameSessionFor<Trial, Metrics extends object>(
  definition: GameDefinition<Trial, Metrics>,
  raw: unknown,
): GameSessionOf<Trial, Metrics> {
  return readVersioned('gameSessions', raw, { 1: gameSessionSchemaFor(definition, 'read') });
}
