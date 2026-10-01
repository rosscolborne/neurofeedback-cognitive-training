import { maxLevelOf, mentalMath, unlockedStartLevel, type GameProgress } from '@nfct/shared';
import type { GameSessionHistoryEntry } from '../../repositories/gameSessionRepository';
import { bestsFor, nextUnlock, type UnlockLine } from './runSummary';
import { timed90 } from './startLevel';

// Mental Math's per-game progress (NFCT-22), as pure view models: bests per
// start level (records are kept per mode + start level and never compared
// across start levels), unlocked start levels, per-game totals, and the rows of
// the run history. Only trusted values and gameplay; nothing about EEG.

export interface LevelBests {
  readonly startLevel: number;
  /** Null when no valid completed run from this start level has set a record yet. */
  readonly bests: { readonly score: number | null; readonly correct: number | null; readonly peakLevel: number | null } | null;
}

export interface GameOverview {
  readonly sessionsCompleted: number;
  readonly activeMs: number;
  /** The highest level reached in a valid completed run, at any start level. */
  readonly bestPeakLevel: number | null;
  readonly unlocked: number;
  readonly maxLevel: number;
  readonly unlock: UnlockLine;
  /** One row per unlocked start level, and any other level that holds records. */
  readonly levels: readonly LevelBests[];
}

export function gameOverview(progress: GameProgress | null): GameOverview {
  const mode = timed90();
  const maxLevel = maxLevelOf(mode);
  const unlocked = unlockedStartLevel(mode, progress);
  const levels: LevelBests[] = [];
  for (let startLevel = 1; startLevel <= maxLevel; startLevel += 1) {
    const bests = bestsFor(progress, startLevel);
    const hasRecords = Object.keys(bests).length > 0;
    if (startLevel > unlocked && !hasRecords) continue;
    levels.push({
      startLevel,
      bests: hasRecords
        ? { score: bests.score?.value ?? null, correct: bests.correct?.value ?? null, peakLevel: bests.peakLevel?.value ?? null }
        : null,
    });
  }
  return {
    sessionsCompleted: progress?.sessionsCompleted ?? 0,
    activeMs: progress?.activeMs ?? 0,
    bestPeakLevel: progress?.bestPeakLevel[mode.id] ?? null,
    unlocked,
    maxLevel,
    unlock: nextUnlock(progress),
    levels,
  };
}

export type HistoryState =
  | 'verified'
  | 'flagged'
  | 'invalid'
  /** Written on this device, waiting to upload. */
  | 'on-device'
  /** Uploaded, waiting for trusted scoring. */
  | 'checking'
  /** Trusted scoring could not process it yet (`processing` is recorded); it is retried later. */
  | 'delayed';

export interface HistoryRow {
  readonly id: string;
  readonly endedAtMs: number;
  readonly startLevel: number;
  readonly completed: boolean;
  readonly activeMs: number;
  readonly state: HistoryState;
  /** The trusted score, or null before trusted scoring has run, or when the run does not count. */
  readonly score: number | null;
  /** Set a personal best when it was processed (point-in-time: a later run may have beaten it since). */
  readonly personalBest: boolean;
}

export function historyRow(entry: GameSessionHistoryEntry): HistoryRow {
  const { session } = entry;
  const { result } = session;
  const state: HistoryState = result ? (result.validity === 'valid' ? 'verified' : result.validity)
    : entry.hasPendingWrites ? 'on-device'
      : session.processing ? 'delayed' : 'checking';
  return {
    id: entry.id,
    endedAtMs: session.endedAt.toMillis(),
    startLevel: session.startLevel,
    completed: session.status === 'completed',
    activeMs: session.activeDurationMs,
    state,
    score: result && result.validity !== 'invalid' ? result.score : null,
    personalBest: result?.validity === 'valid' && result.personalBest,
  };
}

/** Mental Math timed-90 rows only (the game's history query already filters the game). */
export function isTimed90(entry: GameSessionHistoryEntry): boolean {
  return entry.session.gameId === mentalMath.GAME_ID && entry.session.modeId === mentalMath.MODE_ID;
}

/**
 * Seconds under a minute, minutes and seconds under ten minutes, then whole
 * minutes, then hours and minutes. Each number stays with its unit.
 */
export function formatPlayTime(ms: number): string {
  const nbsp = '\u00A0';
  const seconds = Math.round(Math.max(0, ms) / 1000);
  if (seconds < 60) return `${seconds}${nbsp}s`;
  if (seconds < 600) {
    const rest = seconds % 60;
    const minutes = Math.floor(seconds / 60);
    return rest ? `${minutes}${nbsp}min ${rest}${nbsp}s` : `${minutes}${nbsp}min`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}${nbsp}min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}${nbsp}h ${rest}${nbsp}min` : `${hours}${nbsp}h`;
}
