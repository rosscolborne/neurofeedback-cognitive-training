import { findMode, recordKeySchema, type GameDefinition, type ScoredResult } from '../games/definition';
import { compareTimestamps, documentIdSchema, type FirestoreTimestamp } from '../primitives';
import type { GameSession } from '../schemas/gameSession';
import {
  APPLIED_SESSION_LEDGER_SIZE,
  GAME_PROGRESS_SCHEMA_VERSION,
  PROGRESS_AGGREGATE_VERSION,
  type Bests,
  type GameProgress,
  type RecordEntry,
} from '../schemas/progress';
import { unlockedStartLevel } from './unlocks';

/** The session fields progress depends on. EEG is not among them. */
export type ProgressSession = Pick<
  GameSession,
  'gameId' | 'gameVersion' | 'modeId' | 'startLevel' | 'peakLevel' | 'status' | 'activeDurationMs' | 'endedAt'
>;

/**
 * Trusted server validation of one session. Only a valid session carries the
 * scored result, so a flagged session cannot set a record by construction.
 */
export type SessionOutcome<Metrics extends object> =
  | { readonly validity: 'invalid' }
  | { readonly validity: 'flagged' }
  | { readonly validity: 'valid'; readonly scored: ScoredResult<Metrics> };

export interface ApplySessionInput<Trial, Metrics extends object> {
  readonly definition: GameDefinition<Trial, Metrics>;
  readonly sessionId: string;
  readonly session: ProgressSession;
  readonly outcome: SessionOutcome<Metrics>;
  /** Becomes `updatedAt` when the session changes progress. */
  readonly appliedAt: FirestoreTimestamp;
}

/** The value of each of the game's record metrics for one valid session. */
export function recordValuesFor<Trial, Metrics extends object>(
  definition: GameDefinition<Trial, Metrics>,
  session: Pick<ProgressSession, 'peakLevel'>,
  scored: ScoredResult<Metrics>,
): Record<string, number> {
  const values: Record<string, number> = {};
  for (const metric of definition.recordMetrics) {
    const value = metric === 'score' ? scored.score
      : metric === 'peakLevel' ? session.peakLevel
        : (scored.metrics as Record<string, unknown>)[metric];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Record metric '${metric}' of '${definition.id}' is not a finite number`);
    }
    values[metric] = value;
  }
  return values;
}

function assertApplicable<Trial, Metrics extends object>(
  progress: GameProgress | null,
  { definition, sessionId, session }: ApplySessionInput<Trial, Metrics>,
): void {
  const problem = !documentIdSchema.safeParse(sessionId).success ? `invalid session ID '${sessionId}'`
    : session.gameId !== definition.id ? `session is for '${session.gameId}'`
      : !findMode(definition, session.modeId) ? `unknown mode '${session.modeId}'`
        : session.gameVersion > definition.gameVersion ? `unknown game version ${session.gameVersion}`
          : progress && progress.gameId !== definition.id ? `progress is for '${progress.gameId}'`
            : progress && progress.gameVersion > definition.gameVersion ? `progress is ahead of game version ${definition.gameVersion}`
              : progress && progress.aggregateVersion !== PROGRESS_AGGREGATE_VERSION
                ? `progress aggregateVersion ${progress.aggregateVersion} must be rebuilt from sessions`
                : null;
  // Validity is decided before this point; these are caller errors, not invalid sessions.
  if (problem) throw new Error(`Cannot apply session to '${definition.id}' progress: ${problem}`);
}

function emptyProgress(
  definition: Pick<GameDefinition<unknown, object>, 'id' | 'gameVersion'>,
  lastPlayedAt: FirestoreTimestamp,
  updatedAt: FirestoreTimestamp,
): GameProgress {
  return {
    schemaVersion: GAME_PROGRESS_SCHEMA_VERSION,
    aggregateVersion: PROGRESS_AGGREGATE_VERSION,
    updatedAt,
    gameId: definition.id,
    gameVersion: definition.gameVersion,
    sessionsCompleted: 0,
    activeMs: 0,
    lastPlayedAt,
    bestPeakLevel: {},
    unlocked: {},
    bests: {},
    bestsArchive: {},
    appliedSessionIds: [],
  };
}

/** A new gameVersion starts a new record set; the old one is archived. */
function withCurrentRecordSet(progress: GameProgress, gameVersion: number): GameProgress {
  if (progress.gameVersion === gameVersion) return progress;
  const bestsArchive = Object.keys(progress.bests).length === 0
    ? progress.bestsArchive
    : { ...progress.bestsArchive, [String(progress.gameVersion)]: progress.bests };
  return { ...progress, gameVersion, bests: {}, bestsArchive };
}

function withRecords(
  bests: Bests,
  key: string,
  values: Record<string, number>,
  entryFor: (value: number) => RecordEntry,
): Bests {
  const current = bests[key] ?? {};
  const next: Record<string, RecordEntry> = { ...current };
  for (const [metric, value] of Object.entries(values)) {
    const existing = current[metric];
    // Ties keep the earlier record.
    if (existing === undefined || value > existing.value) next[metric] = entryFor(value);
  }
  return { ...bests, [key]: next };
}

/**
 * Folds one processed session into a game's progress. Pure and deterministic:
 * it reads no clock and mutates nothing. Re-applying a session already in the
 * `appliedSessionIds` ledger returns the progress unchanged.
 *
 * - invalid: counts nowhere; progress is returned as given (null stays null).
 * - flagged: counts in totals; sets no records and no unlocks.
 * - valid: also sets records (keyed by the game's `recordKey`) and
 *   `bestPeakLevel` across all start levels, but only for a completed session
 *   of the current gameVersion.
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
  if (progress?.appliedSessionIds.includes(sessionId)) return progress;

  const base = progress === null
    ? emptyProgress(definition, session.endedAt, appliedAt)
    : withCurrentRecordSet(progress, definition.gameVersion);

  let { bests, bestPeakLevel, unlocked } = base;
  if (outcome.validity === 'valid' && session.status === 'completed'
    && session.gameVersion === definition.gameVersion) {
    const mode = findMode(definition, session.modeId)!;
    const key = definition.recordKey({ modeId: session.modeId, startLevel: session.startLevel });
    if (!recordKeySchema.safeParse(key).success) throw new Error(`Invalid record key '${key}'`);

    bests = withRecords(bests, key, recordValuesFor(definition, session, outcome.scored), (value) => ({
      value,
      sessionId,
      achievedAt: session.endedAt,
    }));
    bestPeakLevel = {
      ...bestPeakLevel,
      [mode.id]: Math.max(bestPeakLevel[mode.id] ?? session.peakLevel, session.peakLevel),
    };
    unlocked = { ...unlocked, [mode.id]: unlockedStartLevel(mode, { bestPeakLevel }) };
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
    appliedSessionIds: [...base.appliedSessionIds, sessionId].slice(-APPLIED_SESSION_LEDGER_SIZE),
  };
}
