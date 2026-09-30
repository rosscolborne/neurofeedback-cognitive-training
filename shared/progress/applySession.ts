import {
  findMode,
  MAX_GAME_LEVEL,
  maxLevelOf,
  recordKeySchema,
  recordMetricNameSchema,
  type GameDefinition,
  type ScoreContext,
  type ScoredResult,
} from '../games/definition';
import { compareTimestamps, documentIdSchema, type FirestoreTimestamp } from '../primitives';
import type { GameSession, ServerResult } from '../schemas/gameSession';
import {
  GAME_PROGRESS_SCHEMA_VERSION,
  PROGRESS_AGGREGATE_VERSION,
  type Bests,
  type GameProgress,
  type RecordEntry,
} from '../schemas/progress';
import { unlockedStartLevel } from './unlocks';

/**
 * The session fields progress depends on. EEG is not among them, and neither
 * is the client-reported `peakLevel`: progress uses the trusted peak.
 */
export type ProgressSession = Pick<
  GameSession,
  'gameId' | 'gameVersion' | 'modeId' | 'startLevel' | 'status' | 'activeDurationMs' | 'endedAt'
>;

/**
 * Trusted server validation of one session. Only a valid session carries
 * trusted values, so a flagged session cannot set a record or unlock by
 * construction. The record key and values are fixed when the session is
 * processed, so a later rebuild never needs that version's definition.
 */
export type SessionOutcome =
  | { readonly validity: 'invalid' }
  | { readonly validity: 'flagged' }
  | {
    readonly validity: 'valid';
    /** Replayed from the trials by the game's scoring. */
    readonly peakLevel: number;
    readonly recordKey: string;
    readonly recordValues: Readonly<Record<string, number>>;
  };

export interface ApplySessionInput<Trial, Metrics extends object> {
  /** The current definition of the session's game. */
  readonly definition: GameDefinition<Trial, Metrics>;
  readonly sessionId: string;
  readonly session: ProgressSession;
  readonly outcome: SessionOutcome;
  /** Becomes `updatedAt`. */
  readonly appliedAt: FirestoreTimestamp;
}

/** The value of each of the game's record metrics for one scored session. */
export function recordValuesFor<Trial, Metrics extends object>(
  definition: GameDefinition<Trial, Metrics>,
  scored: ScoredResult<Metrics>,
): Record<string, number> {
  const values: Record<string, number> = {};
  for (const metric of definition.recordMetrics) {
    const value = metric === 'score' ? scored.score
      : metric === 'peakLevel' ? scored.peakLevel
        : (scored.metrics as Record<string, unknown>)[metric];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Record metric '${metric}' of '${definition.id}' is not a finite number`);
    }
    values[metric] = value;
  }
  return values;
}

/** The outcome of a session the current definition just scored as valid. */
export function validOutcome<Trial, Metrics extends object>(
  definition: GameDefinition<Trial, Metrics>,
  ctx: ScoreContext,
  scored: ScoredResult<Metrics>,
): SessionOutcome {
  return {
    validity: 'valid',
    peakLevel: scored.peakLevel,
    recordKey: definition.recordKey(ctx),
    recordValues: recordValuesFor(definition, scored),
  };
}

/** The outcome recorded in a stored trusted result, as a rebuild replays it. */
export function outcomeFromResult(result: ServerResult): SessionOutcome {
  switch (result.validity) {
    case 'valid':
      return {
        validity: 'valid',
        peakLevel: result.peakLevel,
        recordKey: result.recordKey,
        recordValues: result.recordValues,
      };
    case 'flagged':
    case 'invalid':
      return { validity: result.validity };
  }
}

/**
 * Whether this build's reducer may apply sessions to `progress`. It may not
 * when progress was maintained by a different reducer (`aggregateVersion`) or
 * by a newer game version. Trusted scoring then rebuilds first; a client
 * preview declines to preview and shows the trusted server state as it is.
 */
export function canApplyToProgress<Trial, Metrics extends object>(
  progress: GameProgress | null,
  definition: GameDefinition<Trial, Metrics>,
): boolean {
  return progress === null || (
    progress.gameId === definition.id
    && progress.aggregateVersion === PROGRESS_AGGREGATE_VERSION
    && progress.gameVersion <= definition.gameVersion
  );
}

function outcomeProblem(outcome: SessionOutcome, session: ProgressSession, maxLevel: number): string | null {
  if (outcome.validity !== 'valid') return null;
  if (!recordKeySchema.safeParse(outcome.recordKey).success) return `invalid record key '${outcome.recordKey}'`;
  const metrics = Object.entries(outcome.recordValues);
  if (metrics.length === 0) return 'a valid outcome needs record values';
  for (const [metric, value] of metrics) {
    if (!recordMetricNameSchema.safeParse(metric).success || !Number.isFinite(value)) {
      return `invalid record value '${metric}'`;
    }
  }
  if (!Number.isInteger(outcome.peakLevel) || outcome.peakLevel < session.startLevel || outcome.peakLevel > maxLevel) {
    return `trusted peak level ${outcome.peakLevel} is outside ${session.startLevel}-${maxLevel}`;
  }
  return null;
}

function assertApplicable<Trial, Metrics extends object>(
  progress: GameProgress | null,
  { definition, sessionId, session, outcome }: ApplySessionInput<Trial, Metrics>,
): void {
  const isCurrentVersion = session.gameVersion === definition.gameVersion;
  const mode = findMode(definition, session.modeId);
  // Earlier versions may have had modes and levels the current definition lacks.
  const maxLevel = isCurrentVersion && mode ? maxLevelOf(mode) : MAX_GAME_LEVEL;
  const problem = !documentIdSchema.safeParse(sessionId).success ? `invalid session ID '${sessionId}'`
    : session.gameId !== definition.id ? `session is for '${session.gameId}'`
      : session.gameVersion > definition.gameVersion ? `unknown game version ${session.gameVersion}`
        : isCurrentVersion && !mode ? `unknown mode '${session.modeId}'`
          : !canApplyToProgress(progress, definition)
            ? 'progress was maintained by another reducer or a newer game version; rebuild it from sessions'
            : outcomeProblem(outcome, session, maxLevel);
  // Validity is decided before this point; these are caller errors, not invalid sessions.
  if (problem) throw new Error(`Cannot apply session to '${definition.id}' progress: ${problem}`);
}

function emptyProgress(
  gameId: string,
  gameVersion: number,
  lastPlayedAt: FirestoreTimestamp,
  updatedAt: FirestoreTimestamp,
): GameProgress {
  return {
    schemaVersion: GAME_PROGRESS_SCHEMA_VERSION,
    aggregateVersion: PROGRESS_AGGREGATE_VERSION,
    updatedAt,
    gameId,
    gameVersion,
    sessionsCompleted: 0,
    activeMs: 0,
    lastPlayedAt,
    bestPeakLevel: {},
    unlocked: {},
    bests: {},
    bestsArchive: {},
  };
}

/** A session of a newer game version starts a new record set; the current one is archived. */
function startRecordSet(progress: GameProgress, gameVersion: number): GameProgress {
  const bestsArchive = Object.keys(progress.bests).length === 0
    ? progress.bestsArchive
    : { ...progress.bestsArchive, [String(progress.gameVersion)]: progress.bests };
  return { ...progress, gameVersion, bests: {}, bestsArchive };
}

/**
 * Whether `candidate` takes a record from `existing`: a higher value wins; on
 * a tie the earlier achievement wins, then the lower session ID. The result
 * never depends on the order sessions are applied in.
 */
function outranks(candidate: RecordEntry, existing: RecordEntry | undefined): boolean {
  if (existing === undefined) return true;
  if (candidate.value !== existing.value) return candidate.value > existing.value;
  const byTime = compareTimestamps(candidate.achievedAt, existing.achievedAt);
  if (byTime !== 0) return byTime < 0;
  return candidate.sessionId < existing.sessionId;
}

function withRecords(
  bests: Bests,
  key: string,
  values: Readonly<Record<string, number>>,
  sessionId: string,
  achievedAt: FirestoreTimestamp,
): Bests {
  const current = bests[key] ?? {};
  const next: Record<string, RecordEntry> = { ...current };
  for (const [metric, value] of Object.entries(values)) {
    const candidate = { value, sessionId, achievedAt };
    if (outranks(candidate, current[metric])) next[metric] = candidate;
  }
  return { ...bests, [key]: next };
}

/**
 * Folds one processed session into a game's progress. Pure, deterministic and
 * non-mutating: it reads no clock and never changes its inputs.
 *
 * It is not idempotent: applying the same session twice adds its totals twice.
 * Exactly-once application is the caller's job. Trusted scoring (NFCT-19)
 * checks `result.processedAt` in the same transaction; a rebuild replays each
 * stored session once; a client preview applies only sessions still pending.
 *
 * - invalid: counts nowhere; progress is returned as given (null stays null).
 * - flagged: counts in totals; sets no records and no unlocks.
 * - valid and completed: also sets records in its own game version's record
 *   set (current or archived) and raises `bestPeakLevel` with the trusted peak.
 *
 * Abandoned sessions add active time but never count as completed.
 */
export function applySession<Trial, Metrics extends object>(
  progress: GameProgress | null,
  input: ApplySessionInput<Trial, Metrics>,
): GameProgress | null {
  const { definition, sessionId, session, outcome, appliedAt } = input;
  if (outcome.validity === 'invalid') return progress;
  assertApplicable(progress, input);

  let base = progress ?? emptyProgress(definition.id, session.gameVersion, session.endedAt, appliedAt);
  if (session.gameVersion > base.gameVersion) base = startRecordSet(base, session.gameVersion);

  let { bests, bestsArchive, bestPeakLevel, unlocked } = base;
  if (outcome.validity === 'valid' && session.status === 'completed') {
    const addTo = (set: Bests) => withRecords(set, outcome.recordKey, outcome.recordValues, sessionId, session.endedAt);
    if (session.gameVersion === base.gameVersion) {
      bests = addTo(bests);
    } else {
      const version = String(session.gameVersion);
      bestsArchive = { ...bestsArchive, [version]: addTo(bestsArchive[version] ?? {}) };
    }
    bestPeakLevel = {
      ...bestPeakLevel,
      [session.modeId]: Math.max(bestPeakLevel[session.modeId] ?? outcome.peakLevel, outcome.peakLevel),
    };
    const mode = findMode(definition, session.modeId);
    if (mode) unlocked = { ...unlocked, [mode.id]: unlockedStartLevel(mode, { bestPeakLevel }) };
  }

  return {
    ...base,
    updatedAt: appliedAt,
    sessionsCompleted: base.sessionsCompleted + (session.status === 'completed' ? 1 : 0),
    activeMs: base.activeMs + session.activeDurationMs,
    lastPlayedAt: compareTimestamps(session.endedAt, base.lastPlayedAt) > 0 ? session.endedAt : base.lastPlayedAt,
    bestPeakLevel,
    unlocked,
    bests,
    bestsArchive,
  };
}

export interface StoredGameSession {
  readonly id: string;
  readonly session: GameSession;
}

/**
 * Rebuilds one game's progress from its stored sessions. Each processed
 * session is replayed once, in play order (endedAt, then ID), from its stored
 * trusted result: nothing is revalidated or rescored, so sessions of earlier
 * game versions keep the outcome they were given and their records stay in
 * the archive. Sessions without a result are skipped; trusted scoring applies
 * them when it processes them.
 */
export function rebuildProgress<Trial, Metrics extends object>(
  definition: GameDefinition<Trial, Metrics>,
  sessions: readonly StoredGameSession[],
  appliedAt: FirestoreTimestamp,
): GameProgress | null {
  return sessions
    .filter(({ session }) => session.result !== undefined)
    .sort((a, b) => compareTimestamps(a.session.endedAt, b.session.endedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .reduce<GameProgress | null>((progress, { id, session }) => applySession(progress, {
      definition,
      sessionId: id,
      session,
      outcome: outcomeFromResult(session.result!),
      appliedAt,
    }), null);
}
