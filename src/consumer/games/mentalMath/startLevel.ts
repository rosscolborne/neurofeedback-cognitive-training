import {
  canApplyToProgress,
  compareTimestamps,
  decideSession,
  evaluateSession,
  findMode,
  GAME_MODULE_REGISTRY,
  maxLevelOf,
  mentalMath,
  unlockedStartLevel,
  type Decision,
  type FirestoreTimestamp,
  type GameModeDefinition,
  type GameProgress,
} from '@nfct/shared';
import type { GameSessionRecord } from '../../repositories/gameSessionRepository';
import type { ProgressWithRecentSessions } from '../../repositories/progressRepository';

// The client preview of trusted scoring (design J, ADR-001 decisions 6, 9 and
// 12). The highest selectable start level comes from the shared
// unlockedStartLevel, never from the cached `progress.unlocked`. Offline or
// before trusted scoring has run, the sessions still pending on this device are
// first applied to the cached progress with the same shared evaluateSession and
// decideSession the Cloud Function runs (NFCT-19), so a run just played counts
// at once and the preview cannot drift from trusted scoring. Nothing new is
// stored: the default is the start level of the most recent cached or pending
// session.

const { definition } = mentalMath;

export interface StartLevelChoices {
  /** The highest selectable start level; 1 with no progress. */
  readonly unlocked: number;
  /** The mode's highest level; levels above `unlocked` are shown locked. */
  readonly maxLevel: number;
  readonly defaultLevel: number;
  /** Pending sessions were applied to the cached progress. */
  readonly previewed: boolean;
}

/** Mental Math's one mode. */
export function timed90(): GameModeDefinition {
  const mode = findMode(definition, mentalMath.MODE_ID);
  if (!mode) throw new Error('Mental Math has no timed-90 mode');
  return mode;
}

/** A session document as its client wrote it: what trusted scoring evaluates. */
export type ClientSessionDocument = Readonly<Record<string, unknown>> & {
  readonly gameId: string;
  readonly userId: string;
  readonly endedAt: FirestoreTimestamp;
};

/**
 * What trusted scoring would write for a session it has not processed yet,
 * decided against `progress`: its `result` (score, validity and reasons, and
 * for a valid session `personalBest` and `unlocked`) and the progress after
 * it. Null when this build does not preview it (another game, or progress kept
 * by another reducer or a newer game version) or it cannot be decided. Best
 * effort: the trusted result replaces it when it arrives.
 */
export function previewDecision(progress: GameProgress | null, sessionId: string, session: ClientSessionDocument): Decision | null {
  if (session.gameId !== definition.id || !canApplyToProgress(progress, definition)) return null;
  try {
    // Sessions live under users/{userId} (the rules require it), so the path uid is the session's own.
    const evaluation = evaluateSession(session, { uid: session.userId, sessionId }, GAME_MODULE_REGISTRY);
    if (evaluation.kind === 'unsupported') return null;
    return decideSession(evaluation, progress, { sessionId, processedAt: session.endedAt, registry: GAME_MODULE_REGISTRY });
  } catch {
    return null;
  }
}

/** Cached progress with this device's pending sessions applied, oldest first. */
export function previewProgress(progress: GameProgress | null, pending: readonly GameSessionRecord[]): GameProgress | null {
  const ordered = [...pending].sort((a, b) => compareTimestamps(a.session.endedAt, b.session.endedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let preview = progress;
  for (const record of ordered) {
    const decision = previewDecision(preview, record.id, record.session);
    if (decision) preview = decision.progress ?? preview;
  }
  return preview;
}

export interface CurrentProgress {
  /** The cached progress, with this device's pending sessions applied when `previewed`. */
  readonly progress: GameProgress | null;
  /** Pending sessions were applied to the cached progress. */
  readonly previewed: boolean;
  /** The progress as trusted scoring last wrote it (cached), without any preview. */
  readonly checked: GameProgress | null;
  /** The sessions the preview applied: a record one of them holds is not checked yet. */
  readonly unchecked: ReadonlySet<string>;
}

/** The cached progress and the pending sessions applied to it, when this build may preview them. */
export function currentProgress(state: ProgressWithRecentSessions, exceptSessionId: string | null = null): CurrentProgress {
  const cached = state.progress.status === 'readable' ? state.progress.data : null;
  const pending = state.pendingSessions.filter((record) => record.id !== exceptSessionId);
  // Progress kept by another reducer or a newer game version is shown as the server left it.
  const previewed = canApplyToProgress(cached, definition) && pending.length > 0;
  return {
    progress: previewed ? previewProgress(cached, pending) : cached,
    previewed,
    checked: cached,
    unchecked: new Set(previewed ? pending.map((record) => record.id) : []),
  };
}

/** The last start level if it is still unlocked, otherwise the highest unlocked level. */
export function defaultStartLevel(unlocked: number, lastStartLevel: number | null): number {
  return lastStartLevel !== null && Number.isInteger(lastStartLevel) && lastStartLevel >= 1 && lastStartLevel <= unlocked
    ? lastStartLevel
    : unlocked;
}

/**
 * The picker's choices from cached progress and recent sessions. `state` is
 * null when neither could be read, which leaves only level 1.
 */
export function startLevelChoices(state: ProgressWithRecentSessions | null): StartLevelChoices {
  const mode = timed90();
  const maxLevel = maxLevelOf(mode);
  if (state === null) return { unlocked: mode.initiallyUnlockedStartLevel, maxLevel, defaultLevel: mode.initiallyUnlockedStartLevel, previewed: false };
  const { progress, previewed } = currentProgress(state);
  const unlocked = unlockedStartLevel(mode, progress);
  const last = state.recentSessions.find((record) => record.session.modeId === mode.id)?.session.startLevel ?? null;
  return { unlocked, maxLevel, defaultLevel: defaultStartLevel(unlocked, last), previewed };
}
