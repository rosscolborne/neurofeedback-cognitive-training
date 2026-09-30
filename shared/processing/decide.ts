import { findMode, type GameModeDefinition } from '../games/definition';
import type { FirestoreTimestamp } from '../primitives';
import {
  applySession,
  applyValidEffects,
  canApplyToProgress,
  validOutcome,
  type ProgressSession,
  type ValidSessionOutcome,
} from '../progress/applySession';
import { unlockedStartLevel } from '../progress/unlocks';
import {
  serverResultWriteSchema,
  type ServerResult,
  type SessionProcessing,
  type SessionProcessingState,
  type SessionProgressFields,
} from '../schemas/gameSession';
import { gameProgressWriteSchema, type GameProgress } from '../schemas/progress';
import type { SessionEvaluation } from './evaluate';
import { mergeReasons, serverReason, type ProcessingReason, type ReasonEntry } from './reasons';
import { reasonOutcomeFor, type GameModuleRegistry, type GameVersionModule } from './registry';

// Trusted scoring's decisions (NFCT-19), as pure functions of a session's
// evaluation, its stored fields and the game's progress. The Cloud Function
// only reads documents, calls these inside a transaction and writes what they
// return. EEG is never an input.

export type Decision = {
  /** What the session's `result` becomes (validated with the strict write schema). */
  readonly result: ServerResult;
  /** The game's progress afterwards. Null only while no session has counted. */
  readonly progress: GameProgress | null;
  /** Whether the session raised unlockedStartLevel for its mode, so start-level-locked sessions may now be upgradable. */
  readonly unlockRaised: boolean;
};

type Scored = Extract<SessionEvaluation, { kind: 'scored' }>;
type Judged = Exclude<SessionEvaluation, { kind: 'unsupported' }>;

function modeOf(module: GameVersionModule, modeId: string): GameModeDefinition {
  const mode = findMode(module.definition, modeId);
  // The version's schema accepted the session, so its mode exists.
  if (!mode) throw new Error(`${module.gameId} v${module.gameVersion} has no mode '${modeId}'`);
  return mode;
}

/** The start levels of `mode` that became available between two progress states. */
function newlyUnlocked(mode: GameModeDefinition, before: GameProgress | null, after: GameProgress | null) {
  const from = unlockedStartLevel(mode, before);
  const to = unlockedStartLevel(mode, after);
  return Array.from({ length: Math.max(0, to - from) }, (_, index) => ({ modeId: mode.id, startLevel: from + index + 1 }));
}

/** Whether the session holds at least one record in its own game version's record set. */
function holdsRecord(progress: GameProgress, session: ProgressSession, sessionId: string, recordKey: string): boolean {
  const set = session.gameVersion === progress.gameVersion
    ? progress.bests
    : progress.bestsArchive[String(session.gameVersion)];
  return Object.values(set?.[recordKey] ?? {}).some((entry) => entry.sessionId === sessionId);
}

/** Fails closed: trusted code never writes a document its own schemas reject. */
function checked(result: ServerResult, progress: GameProgress | null) {
  return {
    result: serverResultWriteSchema.parse(result),
    progress: progress === null ? null : gameProgressWriteSchema.parse(progress),
  };
}

export type DecisionContext = {
  readonly sessionId: string;
  /** Server clock: becomes `result.processedAt` and `progress.updatedAt`. */
  readonly processedAt: FirestoreTimestamp;
  readonly registry: GameModuleRegistry;
};

/**
 * Decides a session's result and applies it to the game's progress, exactly
 * as the processing transaction commits them. `progress` is what the
 * transaction read (already rebuilt if it was maintained by an older
 * reducer); the caller guarantees the session has no result yet.
 *
 * - invalid: the result records only the reasons; progress is unchanged.
 * - otherwise the start level must be unlocked: `startLevel` above
 *   `unlockedStartLevel(mode, progress | null)` adds the flag
 *   'start-level-locked'. A flagged session counts in totals only; a valid
 *   one also sets records and raises the best peak level (`applySession`).
 */
export function decideSession(evaluation: Judged, progress: GameProgress | null, context: DecisionContext): Decision {
  const { module } = evaluation;
  const processing = { processedAt: context.processedAt, scoringVersion: module.definition.scoringVersion };
  if (evaluation.kind === 'invalid') {
    return { ...checked({ ...processing, validity: 'invalid', reasons: evaluation.reasons }, progress), unlockRaised: false };
  }
  return decideScored(evaluation, progress, context, processing);
}

function decideScored(
  { module, session, scored, entries }: Scored,
  progress: GameProgress | null,
  context: DecisionContext,
  processing: { processedAt: FirestoreTimestamp; scoringVersion: number },
): Decision {
  const current = context.registry.current(module.gameId);
  if (!current) throw new Error(`No current module for '${module.gameId}'`);
  if (!canApplyToProgress(progress, current.definition)) {
    throw new Error(`Progress for '${module.gameId}' must be rebuilt or left alone before a session is applied`);
  }
  const mode = modeOf(module, session.modeId);
  const locked = session.startLevel > unlockedStartLevel(mode, progress);
  const { validity, reasons } = mergeReasons([...entries, ...(locked ? [serverReason('start-level-locked')] : [])]);
  if (validity === 'invalid') throw new Error('A scored evaluation cannot carry an invalid reason');

  const ctx = { modeId: session.modeId, startLevel: session.startLevel };
  const outcome = validity === 'valid' ? validOutcome(module.definition, ctx, scored) : { validity };
  const next = applySession(progress, {
    definition: current.definition,
    sessionId: context.sessionId,
    session,
    outcome,
    appliedAt: context.processedAt,
  });
  const scoredValues = {
    score: scored.score,
    accuracy: scored.accuracy,
    responseTime: scored.responseTime,
    peakLevel: scored.peakLevel,
    metrics: scored.metrics,
    performanceIndex: null,
    performanceIndexVersion: null,
    domainContributions: module.definition.domainWeights,
  };
  const unlocked = newlyUnlocked(mode, progress, next);
  if (outcome.validity !== 'valid') {
    return { ...checked({ ...processing, validity: 'flagged', reasons, ...scoredValues }, next), unlockRaised: unlocked.length > 0 };
  }
  return {
    ...checked({
      ...processing,
      validity: 'valid',
      reasons,
      ...scoredValues,
      recordKey: outcome.recordKey,
      recordValues: { ...outcome.recordValues },
      personalBest: session.status === 'completed' && holdsRecord(next!, session, context.sessionId, outcome.recordKey),
      unlocked,
    }, next),
    unlockRaised: unlocked.length > 0,
  };
}

export type UpgradeBlocker =
  | 'not-flagged'
  | 'unknown-game-version'
  | 'scoring-version-changed'
  | 'not-start-level-locked'
  | 'flagged-for-another-reason'
  | 'still-locked';

/**
 * Why a stored session cannot be upgraded from flagged to valid under
 * `progress`, or null when it can. Upgradable means all of:
 *
 * - its stored result is flagged, and 'start-level-locked' is among the
 *   reasons;
 * - every other reason is a diagnostic of its own game version or of trusted
 *   scoring ('reasons-truncated' is not accepted: a cut list might have hidden
 *   a flag);
 * - its own game version's module is registered, and the stored result was
 *   written with that module's scoringVersion, so the module vouches for the
 *   stored values (after a scoringVersion bump, older flagged sessions stay
 *   flagged until a deliberate rescoring job);
 * - its start level is now at or below unlockedStartLevel(its mode, progress).
 */
export function upgradeBlocker(
  stored: SessionProgressFields,
  progress: GameProgress | null,
  registry: GameModuleRegistry,
): UpgradeBlocker | null {
  const { result } = stored;
  if (result?.validity !== 'flagged') return 'not-flagged';
  const module = registry.find(stored.gameId, stored.gameVersion);
  const mode = module ? findMode(module.definition, stored.modeId) : undefined;
  if (!module || !mode) return 'unknown-game-version';
  if (result.scoringVersion !== module.definition.scoringVersion) return 'scoring-version-changed';
  if (!result.reasons.includes('start-level-locked')) return 'not-start-level-locked';
  const onlyDiagnostics = result.reasons.every((code) => code === 'start-level-locked'
    || (code !== 'reasons-truncated' && reasonOutcomeFor(module, code) === 'diagnostic'));
  if (!onlyDiagnostics) return 'flagged-for-another-reason';
  if (stored.startLevel > unlockedStartLevel(mode, progress)) return 'still-locked';
  return null;
}

export type UpgradeContext = {
  readonly sessionId: string;
  /** Server clock: becomes `progress.updatedAt`. The result keeps its original processedAt. */
  readonly upgradedAt: FirestoreTimestamp;
  readonly registry: GameModuleRegistry;
};

/**
 * Upgrades a flagged start-level-locked session to valid, once progress
 * unlocks its start level. Returns null when `upgradeBlocker` says it cannot
 * be upgraded, or its stored metrics are not its version's.
 *
 * What changes: `validity` becomes 'valid'; 'start-level-locked' leaves the
 * reasons and the diagnostic 'start-level-unlocked-later' joins them; the
 * valid-only fields are added (`recordKey` and `recordValues` from the
 * session's own game version's module applied to the STORED trusted values,
 * never rescoring; `personalBest` and `unlocked` as of the upgrade); progress
 * gains only the session's valid-only effects (`applyValidEffects`: records,
 * best peak level, unlocks).
 *
 * What never changes: `processedAt`, `scoringVersion`, the stored scored
 * values (score, accuracy, response times, trusted peak, metrics,
 * performance index, domain contributions) and the progress totals, which
 * were counted once when the session was processed as flagged.
 */
export function upgradeSession(
  stored: SessionProgressFields,
  progress: GameProgress,
  context: UpgradeContext,
): Decision | null {
  if (upgradeBlocker(stored, progress, context.registry) !== null) return null;
  const result = stored.result as Extract<ServerResult, { validity: 'flagged' }>;
  const module = context.registry.find(stored.gameId, stored.gameVersion)!;
  const current = context.registry.current(stored.gameId)!;
  if (!canApplyToProgress(progress, current.definition)) {
    throw new Error(`Progress for '${stored.gameId}' must be rebuilt or left alone before an upgrade`);
  }
  const recordValues = module.recordValuesFromStored(result);
  if (recordValues === null) return null;
  const mode = modeOf(module, stored.modeId);
  const outcome: ValidSessionOutcome = {
    validity: 'valid',
    peakLevel: result.peakLevel,
    recordKey: module.definition.recordKey({ modeId: stored.modeId, startLevel: stored.startLevel }),
    recordValues,
  };
  const next = applyValidEffects(progress, {
    definition: current.definition,
    sessionId: context.sessionId,
    session: stored,
    outcome,
    appliedAt: context.upgradedAt,
  });
  const entries: ReasonEntry[] = [
    ...result.reasons
      .filter((code) => code !== 'start-level-locked')
      .map((code) => ({ code, outcome: reasonOutcomeFor(module, code)! })),
    serverReason('start-level-unlocked-later'),
  ];
  const unlocked = newlyUnlocked(mode, progress, next);
  return {
    ...checked({
      processedAt: result.processedAt,
      scoringVersion: result.scoringVersion,
      validity: 'valid',
      reasons: mergeReasons(entries).reasons,
      score: result.score,
      accuracy: result.accuracy,
      responseTime: result.responseTime,
      peakLevel: result.peakLevel,
      metrics: result.metrics,
      performanceIndex: result.performanceIndex,
      performanceIndexVersion: result.performanceIndexVersion,
      domainContributions: result.domainContributions,
      recordKey: outcome.recordKey,
      recordValues,
      personalBest: stored.status === 'completed' && holdsRecord(next, stored, context.sessionId, outcome.recordKey),
      unlocked,
    }, next),
    unlockRaised: unlocked.length > 0,
  };
}

/**
 * The `processing` metadata to record for a session that has no result: the
 * state and reason now, one more attempt than before.
 */
export function processingRecord(
  previous: { readonly attempts?: unknown } | undefined,
  state: SessionProcessingState,
  reason: ProcessingReason,
  updatedAt: FirestoreTimestamp,
): SessionProcessing {
  const attempts = typeof previous?.attempts === 'number' && Number.isInteger(previous.attempts) && previous.attempts > 0
    ? previous.attempts + 1
    : 1;
  return { state, reason, attempts, updatedAt };
}
