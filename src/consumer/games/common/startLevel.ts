import {
  canApplyToProgress,
  compareTimestamps,
  decideSession,
  evaluateSession,
  findMode,
  GAME_MODULE_REGISTRY,
  maxLevelOf,
  unlockedStartLevel,
  type AnyGameDefinition,
  type Decision,
  type FirestoreTimestamp,
  type GameModeDefinition,
  type GameProgress,
} from '@nfct/shared';
import type { GameSessionRecord } from '../../repositories/gameSessionRepository';
import type { ProgressWithRecentSessions } from '../../repositories/progressRepository';

// The client preview of trusted scoring for one game mode (design J, ADR-001
// decisions 6, 9 and 12), for every game. The highest selectable start level
// comes from the shared unlockedStartLevel, never from the cached
// `progress.unlocked`. Offline or before trusted scoring has run, the sessions
// still pending on this device are first applied to the cached progress with
// the same shared evaluateSession and decideSession the Cloud Function runs
// (NFCT-19), so a run just played counts at once and the preview cannot drift
// from trusted scoring. Nothing new is stored: the default is the start level
// of the most recent cached or pending session.

/** The game version a preview judges new sessions with: the current definition and the mode played. */
export interface PreviewGame {
  readonly definition: AnyGameDefinition;
  readonly modeId: string;
}

export interface StartLevelChoices {
  /** The highest selectable start level; 1 with no progress. */
  readonly unlocked: number;
  /** The mode's highest level; levels above `unlocked` are shown locked. */
  readonly maxLevel: number;
  readonly defaultLevel: number;
  /** Pending sessions were applied to the cached progress. */
  readonly previewed: boolean;
}

/** The game's mode. */
export function previewMode(game: PreviewGame): GameModeDefinition {
  const mode = findMode(game.definition, game.modeId);
  if (!mode) throw new Error(`${game.definition.id} has no mode '${game.modeId}'`);
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
export function previewDecision(game: PreviewGame, progress: GameProgress | null, sessionId: string, session: ClientSessionDocument): Decision | null {
  const { definition } = game;
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
export function previewProgress(game: PreviewGame, progress: GameProgress | null, pending: readonly GameSessionRecord[]): GameProgress | null {
  const ordered = [...pending].sort((a, b) => compareTimestamps(a.session.endedAt, b.session.endedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let preview = progress;
  for (const record of ordered) {
    const decision = previewDecision(game, preview, record.id, record.session);
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
export function currentProgress(game: PreviewGame, state: ProgressWithRecentSessions, exceptSessionId: string | null = null): CurrentProgress {
  const cached = state.progress.status === 'readable' ? state.progress.data : null;
  const pending = state.pendingSessions.filter((record) => record.id !== exceptSessionId);
  // Progress kept by another reducer or a newer game version is shown as the server left it.
  const previewed = canApplyToProgress(cached, game.definition) && pending.length > 0;
  return {
    progress: previewed ? previewProgress(game, cached, pending) : cached,
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
 * null when neither could be read, which leaves only the first start level.
 */
export function startLevelChoices(game: PreviewGame, state: ProgressWithRecentSessions | null): StartLevelChoices {
  const mode = previewMode(game);
  const maxLevel = maxLevelOf(mode);
  if (state === null) return { unlocked: mode.initiallyUnlockedStartLevel, maxLevel, defaultLevel: mode.initiallyUnlockedStartLevel, previewed: false };
  const { progress, previewed } = currentProgress(game, state);
  const unlocked = unlockedStartLevel(mode, progress);
  const last = state.recentSessions.find((record) => record.session.modeId === mode.id)?.session.startLevel ?? null;
  return { unlocked, maxLevel, defaultLevel: defaultStartLevel(unlocked, last), previewed };
}
