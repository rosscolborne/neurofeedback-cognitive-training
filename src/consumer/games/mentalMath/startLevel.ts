import {
  applySession,
  canApplyToProgress,
  compareTimestamps,
  findMode,
  gameSessionSchemaFor,
  maxLevelOf,
  mentalMath,
  unlockedStartLevel,
  validOutcome,
  type GameModeDefinition,
  type GameProgress,
  type SessionOutcome,
} from '@nfct/shared';
import type { GameSessionRecord } from '../../repositories/gameSessionRepository';
import type { ProgressWithRecentSessions } from '../../repositories/progressRepository';

// The start-level picker's choices (design J, ADR-001 decision 9). The highest
// selectable level comes from the shared unlockedStartLevel, never from the
// cached `progress.unlocked`. Offline or before trusted scoring has run, the
// sessions still pending on this device are first applied to the cached
// progress with the same shared reducer and checks trusted scoring uses, so a
// run just played counts at once. Nothing new is stored: the default is the
// start level of the most recent cached or pending session.

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

function timed90(): GameModeDefinition {
  const mode = findMode(definition, mentalMath.MODE_ID);
  if (!mode) throw new Error('Mental Math has no timed-90 mode');
  return mode;
}

/** The outcome trusted scoring would give a pending session, from the shared checks only. */
function previewOutcome(progress: GameProgress | null, record: GameSessionRecord, mode: GameModeDefinition): SessionOutcome | null {
  const { session } = record;
  // Other versions and modes are scored by their own modules; they are not previewed.
  if (session.gameId !== definition.id || session.gameVersion !== definition.gameVersion || session.modeId !== mode.id) return null;
  const parsed = gameSessionSchemaFor(definition, 'read').safeParse(session);
  if (!parsed.success) return { validity: 'invalid' };
  const checked = parsed.data;
  const report = mentalMath.checkSession(checked);
  if (report.outcome === 'invalid') return { validity: 'invalid' };
  // Trusted scoring flags a run started above the level unlocked when it is processed.
  if (report.outcome === 'flagged' || checked.startLevel > unlockedStartLevel(mode, progress)) return { validity: 'flagged' };
  const ctx = { modeId: checked.modeId, startLevel: checked.startLevel };
  return validOutcome(definition, ctx, definition.score(checked.trials, ctx));
}

/** Cached progress with this device's pending sessions applied, oldest first. */
export function previewProgress(progress: GameProgress | null, pending: readonly GameSessionRecord[]): GameProgress | null {
  const mode = timed90();
  const ordered = [...pending].sort((a, b) => compareTimestamps(a.session.endedAt, b.session.endedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let preview = progress;
  for (const record of ordered) {
    try {
      const outcome = previewOutcome(preview, record, mode);
      if (outcome === null) continue;
      preview = applySession(preview, { definition, sessionId: record.id, session: record.session, outcome, appliedAt: record.session.endedAt });
    } catch {
      // The preview is a best effort; trusted scoring decides.
    }
  }
  return preview;
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
  const cached = state.progress.status === 'readable' ? state.progress.data : null;
  // Progress kept by another reducer or a newer game version is shown as the server left it.
  const previewed = canApplyToProgress(cached, definition) && state.pendingSessions.length > 0;
  const progress = previewed ? previewProgress(cached, state.pendingSessions) : cached;
  const unlocked = unlockedStartLevel(mode, progress);
  const last = state.recentSessions.find((record) => record.session.modeId === mode.id)?.session.startLevel ?? null;
  return { unlocked, maxLevel, defaultLevel: defaultStartLevel(unlocked, last), previewed };
}
