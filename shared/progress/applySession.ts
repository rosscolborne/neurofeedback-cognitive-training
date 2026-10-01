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
  | ValidSessionOutcome;

export type ValidSessionOutcome = {
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

export interface ApplyValidEffectsInput<Trial, Metrics extends object> extends ApplySessionInput<Trial, Metrics> {
  readonly outcome: ValidSessionOutcome;
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
 * The additive part of one counted (valid or flagged) session: completed
 * sessions, active time and last played. Not idempotent. A session of a newer
 * game version also starts a new record set here, so a flagged session of the
 * new version archives the old bests just as a valid one would.
 */
function applyTotals<Trial, Metrics extends object>(
  progress: GameProgress | null,
  { definition, session, appliedAt }: ApplySessionInput<Trial, Metrics>,
): GameProgress {
  let base = progress ?? emptyProgress(definition.id, session.gameVersion, session.endedAt, appliedAt);
  if (session.gameVersion > base.gameVersion) base = startRecordSet(base, session.gameVersion);
  return {
    ...base,
    updatedAt: appliedAt,
    sessionsCompleted: base.sessionsCompleted + (session.status === 'completed' ? 1 : 0),
    activeMs: base.activeMs + session.activeDurationMs,
    lastPlayedAt: compareTimestamps(session.endedAt, base.lastPlayedAt) > 0 ? session.endedAt : base.lastPlayedAt,
  };
}

/**
 * The effects only a valid session has: records in the record set of the
 * session's own game version, the best trusted peak level, and the cached
 * unlocks derived from it. An abandoned session has none of them.
 *
 * Idempotent: every effect is a maximum with deterministic ties, so applying
 * the same session twice (with the same `appliedAt`) gives the same progress
 * as applying it once. It never touches the totals (completed sessions,
 * active time, last played), so it is safe for trusted scoring to use when it
 * upgrades a session it already counted as flagged (NFCT-19).
 *
 * Progress must already exist: the session's totals were counted when it was
 * first processed, which created it.
 */
export function applyValidEffects<Trial, Metrics extends object>(
  progress: GameProgress,
  input: ApplyValidEffectsInput<Trial, Metrics>,
): GameProgress {
  const { definition, sessionId, session, outcome, appliedAt } = input;
  if (outcome.validity !== 'valid') throw new Error(`applyValidEffects needs a valid outcome, got '${String(outcome.validity)}'`);
  assertApplicable(progress, input);

  let base = progress;
  if (session.gameVersion > base.gameVersion) base = startRecordSet(base, session.gameVersion);
  if (session.status !== 'completed') return { ...base, updatedAt: appliedAt };

  let { bests, bestsArchive } = base;
  const addTo = (set: Bests) => withRecords(set, outcome.recordKey, outcome.recordValues, sessionId, session.endedAt);
  if (session.gameVersion === base.gameVersion) {
    bests = addTo(bests);
  } else {
    const version = String(session.gameVersion);
    bestsArchive = { ...bestsArchive, [version]: addTo(bestsArchive[version] ?? {}) };
  }
  const bestPeakLevel = {
    ...base.bestPeakLevel,
    [session.modeId]: Math.max(base.bestPeakLevel[session.modeId] ?? outcome.peakLevel, outcome.peakLevel),
  };
  const mode = findMode(definition, session.modeId);
  const unlocked = mode ? { ...base.unlocked, [mode.id]: unlockedStartLevel(mode, { bestPeakLevel }) } : base.unlocked;

  return { ...base, updatedAt: appliedAt, bestPeakLevel, unlocked, bests, bestsArchive };
}

/**
 * Folds one processed session into a game's progress. Pure, deterministic and
 * non-mutating: it reads no clock and never changes its inputs. It is the
 * session's totals followed, for a valid session, by `applyValidEffects`.
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
  const { outcome } = input;
  if (outcome.validity === 'invalid') return progress;
  assertApplicable(progress, input);
  const counted = applyTotals(progress, input);
  return outcome.validity === 'valid' ? applyValidEffects(counted, { ...input, outcome }) : counted;
}

export interface StoredGameSession {
  readonly id: string;
  /**
   * A stored session, or only the fields progress depends on
   * (`readSessionProgressFields`): a rebuild never needs trials.
   */
  readonly session: ProgressSession & { readonly result?: ServerResult };
}

/**
 * Rebuilds one game's progress from its stored sessions. Each processed
 * session is replayed once from its stored trusted result, in session ID
 * order. That order only makes the replay deterministic, and it is never a
 * device clock: the result is the same for any order (totals are sums;
 * records, best peak level and unlocks are maxima, and `endedAt` only breaks
 * record ties as the earlier achievement). Nothing is revalidated or
 * rescored, so sessions of earlier game versions keep the outcome they were
 * given and their records stay in the archive. Sessions without a result are
 * skipped; trusted scoring applies them when it processes them.
 */
export function rebuildProgress<Trial, Metrics extends object>(
  definition: GameDefinition<Trial, Metrics>,
  sessions: readonly StoredGameSession[],
  appliedAt: FirestoreTimestamp,
): GameProgress | null {
  return sessions
    .filter(({ session }) => session.result !== undefined)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .reduce<GameProgress | null>((progress, { id, session }) => applySession(progress, {
      definition,
      sessionId: id,
      session,
      outcome: outcomeFromResult(session.result!),
      appliedAt,
    }), null);
}
