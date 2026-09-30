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
/** A stable kebab-case reason code, as stored in `result.reasons` and `processing.reason`. */
export const reasonCodeSchema = z.string().max(40).regex(/^[a-z][a-z0-9-]*$/);
const reasonSchema = reasonCodeSchema;
/** The most reasons one result may record. Trusted scoring bounds its list to fit (NFCT-19). */
export const MAX_RESULT_REASONS = 20;

/**
 * Why trusted scoring has not written a `result` yet, when it knows (NFCT-19).
 * Server-owned like `result`: rules forbid clients to write it, and only
 * trusted code sets or clears it. A session with neither is pending.
 *
 * - 'unsupported': this build has no frozen module for the session's
 *   `gameId`/`gameVersion` (or cannot read its `schemaVersion`). Not a
 *   judgement on the session: a later deploy that adds the module re-drives it.
 * - 'failed': processing kept failing past its retry window. Re-driven after
 *   the cause is fixed.
 *
 * Writes accept only these states. Reads accept any kebab-case state, so a
 * build keeps reading sessions a newer server annotated with a state it does
 * not know.
 */
export const SESSION_PROCESSING_STATES = ['failed', 'unsupported'] as const;
export type SessionProcessingState = (typeof SESSION_PROCESSING_STATES)[number];

const processingShape = {
  /** A reason code, e.g. 'unknown-game-version' or 'progress-newer-than-code'. */
  reason: reasonSchema,
  /** How many times trusted scoring has recorded a processing state for the session. */
  attempts: positiveIntSchema,
  /** Server clock: when the state was last recorded. */
  updatedAt: timestampSchema,
};
/** What trusted scoring writes. */
export const sessionProcessingWriteSchema = z.strictObject({ state: z.enum(SESSION_PROCESSING_STATES), ...processingShape });
const sessionProcessingReadSchema = z.object({ state: slugIdSchema, ...processingShape });

function sessionProcessingSchemaFor(mode: SchemaMode) {
  return mode === 'write' ? sessionProcessingWriteSchema : sessionProcessingReadSchema;
}

export type SessionProcessing = z.infer<typeof sessionProcessingWriteSchema>;

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
      reasons: z.array(reasonSchema).max(MAX_RESULT_REASONS),
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
      reasons: z.array(reasonSchema).min(1).max(MAX_RESULT_REASONS),
      ...scored,
    }).refine(indexPaired, indexPairedIssue),
    objectSchema(mode, {
      ...processing,
      validity: z.literal('invalid'),
      /** e.g. 'schema-invalid', 'question-not-from-seed'. */
      reasons: z.array(reasonSchema).min(1).max(MAX_RESULT_REASONS),
    }),
  ]);
}

export const serverResultWriteSchema = serverResultSchemaFor('write');
export const serverResultReadSchema = serverResultSchemaFor('read');
export type ServerResult = z.infer<typeof serverResultWriteSchema>;

/**
 * The client's display summary, checked by a game's own metrics schema. What
 * a client validates before it writes. Trusted scoring never trusts it: see
 * `sessionSummaryShapeSchema`.
 */
function sessionSummarySchemaWith<Metrics extends z.ZodType>(mode: SchemaMode, metrics: Metrics) {
  return objectSchema(mode, {
    score: z.number(),
    accuracy: fractionSchema.nullable(),
    trialsTotal: nonNegativeIntSchema,
    trialsCorrect: nonNegativeIntSchema.nullable(),
    responseTime: responseTimeSchemaFor(mode).nullable(),
    metrics,
  });
}

/** A game version's display summary, as its client should write it. */
export function sessionSummarySchemaFor<Trial, Metrics extends object>(definition: GameDefinition<Trial, Metrics>) {
  return sessionSummarySchemaWith('write', definition.metricsSchema);
}

/**
 * The summary's structure only, as the rules enforce it: exact keys, value
 * types and at most 32 metric keys. Trusted scoring parses the summary with
 * this, so a display bug or a forged summary can never make an otherwise
 * coherent session invalid; a summary that disagrees with trusted scoring, or
 * that the game's own summary schema rejects, is only the diagnostic
 * 'summary-mismatch'.
 */
export const sessionSummaryShapeSchema = z.strictObject({
  score: z.number(),
  accuracy: z.number().nullable(),
  trialsTotal: z.number(),
  trialsCorrect: z.number().nullable(),
  responseTime: z.strictObject({ medianMs: z.number(), meanMs: z.number(), p90Ms: z.number() }).nullable(),
  metrics: z.record(z.string(), z.unknown()).refine((metrics) => Object.keys(metrics).length <= 32, 'At most 32 metrics'),
});

function gameSessionSchemaWith<Trial extends z.ZodType, Summary extends z.ZodType>(
  mode: SchemaMode,
  trials: z.ZodArray<Trial>,
  summary: Summary,
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
     * The highest level the client says it reached. An untrusted observation,
     * bounded like the rules bound it and nothing more: progress uses the peak
     * replayed from the trials (`result.peakLevel`), and a client peak that
     * disagrees, even one below startLevel or beyond the mode, is only the
     * game's 'peak-level-mismatch' diagnostic.
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
    summary,
    /** Server-owned: written only by trusted scoring (NFCT-19). */
    result: serverResultSchemaFor(mode).optional(),
    /** Server-owned: why trusted scoring has not written `result` yet (NFCT-19). */
    processing: sessionProcessingSchemaFor(mode).optional(),
  }).superRefine((session, ctx) => {
    if (compareTimestamps(session.endedAt, session.startedAt) <= 0) {
      ctx.addIssue({ code: 'custom', path: ['endedAt'], message: 'endedAt must be after startedAt' });
    }
    // Trusted scoring clears `processing` in the same write that adds `result`.
    if (mode === 'write' && session.result !== undefined && session.processing !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['processing'], message: 'a processed session has no processing state' });
    }
  });
}

function anyGameSessionSchema(mode: SchemaMode) {
  return gameSessionSchemaWith(
    mode,
    z.array(z.record(z.string(), z.unknown())).max(MAX_TRIALS_PER_SESSION),
    sessionSummarySchemaWith(mode, z.record(z.string(), z.unknown())),
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
  return withDefinitionChecks(definition, gameSessionSchemaWith(
    mode,
    z.array(definition.trialSchema).max(definition.limits.maxTrials),
    sessionSummarySchemaWith(mode, definition.metricsSchema),
  ));
}
export type GameSessionOf<Trial, Metrics extends object> =
  z.infer<ReturnType<typeof gameSessionSchemaFor<Trial, Metrics>>>;

/**
 * What trusted scoring (NFCT-19) validates a client-written session of one
 * game version with: strict, with trials checked by the version's own trial
 * schema, but the display summary checked only for the structure the rules
 * enforce (`sessionSummaryShapeSchema`). Nothing in the summary or the client
 * `peakLevel` can make a session invalid.
 */
export function trustedGameSessionSchemaFor<Trial, Metrics extends object>(definition: GameDefinition<Trial, Metrics>) {
  return withDefinitionChecks(definition, gameSessionSchemaWith(
    'write',
    z.array(definition.trialSchema).max(definition.limits.maxTrials),
    sessionSummaryShapeSchema,
  ));
}
export type TrustedGameSessionOf<Trial, Metrics extends object> =
  z.infer<ReturnType<typeof trustedGameSessionSchemaFor<Trial, Metrics>>>;

/**
 * The checks every game version applies to the envelope: its own game and
 * version, a mode of the version, and a start level of that mode (the start
 * level is the context scoring and the staircase run from).
 */
function withDefinitionChecks<Trial, Metrics extends object, S extends z.ZodType<{
  gameId: string;
  gameVersion: number;
  modeId: string;
  startLevel: number;
}>>(definition: GameDefinition<Trial, Metrics>, schema: S) {
  return schema.superRefine((session, ctx) => {
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
    } else if (session.startLevel > maxLevelOf(gameMode)) {
      ctx.addIssue({ code: 'custom', path: ['startLevel'], message: 'level is beyond the mode' });
    }
  });
}

/**
 * The session fields progress depends on, and nothing else: no trials, no
 * summary, no client `peakLevel` and nothing about EEG. Rebuilds and upgrade
 * scans read sessions through a projection of these fields
 * (`SESSION_PROGRESS_FIELDS`), so they never load trials.
 */
const sessionProgressFieldsReadSchema = z.object({
  schemaVersion: z.literal(1),
  gameId: slugIdSchema,
  gameVersion: positiveIntSchema,
  modeId: slugIdSchema,
  startLevel: levelSchema,
  status: sessionStatusSchema,
  activeDurationMs: z.int().min(0).max(MAX_ACTIVE_DURATION_MS),
  endedAt: timestampSchema,
  result: serverResultSchemaFor('read').optional(),
  processing: sessionProcessingReadSchema.optional(),
});
export type SessionProgressFields = z.infer<typeof sessionProgressFieldsReadSchema>;
/** The document fields `readSessionProgressFields` needs, for a Firestore projection. */
export const SESSION_PROGRESS_FIELDS = Object.freeze(Object.keys(sessionProgressFieldsReadSchema.shape));

/** Reads only the fields progress depends on (tolerant, like every reader). */
export function readSessionProgressFields(raw: unknown): SessionProgressFields {
  return readVersioned('gameSessions', raw, { 1: sessionProgressFieldsReadSchema });
}

export function readGameSession(raw: unknown): GameSession {
  return readVersioned('gameSessions', raw, { 1: gameSessionReadSchema });
}

export function readGameSessionFor<Trial, Metrics extends object>(
  definition: GameDefinition<Trial, Metrics>,
  raw: unknown,
): GameSessionOf<Trial, Metrics> {
  return readVersioned('gameSessions', raw, { 1: gameSessionSchemaFor(definition, 'read') });
}
