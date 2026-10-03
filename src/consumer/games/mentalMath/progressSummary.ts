import { GAME_MODULE_REGISTRY, maxLevelOf, mentalMath, unlockedStartLevel, upgradeBlocker, type GameProgress } from '@nfct/shared';
import type { GameSessionHistoryEntry } from '../../repositories/gameSessionRepository';
import { bestsFor, nextUnlock, type UnlockLine } from './runSummaryModel';
import { timed90, type CurrentProgress } from './startLevel';

// Mental Math's per-game progress (NFCT-22), as pure view models: bests per
// start level (records are kept per mode + start level and never compared
// across start levels), unlocked start levels, per-game totals, and the rows of
// the run history. Only trusted values and gameplay; nothing about EEG.

export interface LevelBests {
  readonly startLevel: number;
  /** Null when no valid completed run from this start level has set a record yet. */
  readonly bests: { readonly score: number | null; readonly correct: number | null; readonly peakLevel: number | null } | null;
  /** One of these bests is held by a run trusted scoring has not checked yet (the client preview). */
  readonly provisional: boolean;
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

/**
 * `unchecked` names the sessions the client preview applied to `progress`
 * (startLevel's currentProgress); a best one of them holds is provisional.
 */
export function gameOverview(progress: GameProgress | null, unchecked: ReadonlySet<string> = new Set()): GameOverview {
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
      provisional: Object.values(bests).some((best) => unchecked.has(best.sessionId)),
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

/** The Progress tab's one-line summary of the game. */
export interface ProgressCardSummary {
  readonly sessionsCompleted: number;
  readonly unlocked: number;
  readonly maxLevel: number;
  /** The numbers count a run trusted scoring has not checked yet, so they are provisional. */
  readonly provisional: boolean;
}

export function progressCardSummary(current: CurrentProgress): ProgressCardSummary {
  const shown = gameOverview(current.progress);
  const checked = gameOverview(current.checked);
  return {
    sessionsCompleted: shown.sessionsCompleted,
    unlocked: shown.unlocked,
    maxLevel: shown.maxLevel,
    provisional: shown.sessionsCompleted !== checked.sessionsCompleted || shown.unlocked !== checked.unlocked,
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
  /**
   * Flagged only because its start level was not unlocked yet when it was scored
   * (`start-level-locked`, with at most diagnostic reasons beside it). Trusted
   * scoring upgrades it to valid once that level unlocks (ADR-001 decision 12),
   * so it reads as waiting, not flagged.
   */
  readonly awaitingUnlock: boolean;
}

/** The server's own upgrade test, against no progress: only the start level stands between the run and valid. */
function upgradableOnceUnlocked(session: GameSessionHistoryEntry['session']): boolean {
  const blocker = upgradeBlocker(session, null, GAME_MODULE_REGISTRY);
  return blocker === null || blocker === 'still-locked';
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
    awaitingUnlock: upgradableOnceUnlocked(session),
  };
}

/**
 * How a history row reads at a glance (NFCT-64), the same on Home and in the
 * game's history. The score slot holds the trusted score, or "Pending" until
 * there is one, or a dash for a run that does not count (its tag says so).
 * One tag at most, by priority: a run that does not count, then a run ended
 * early (finished runs are the norm, so only the exception is labelled), a
 * flagged run (or one waiting on its start level to unlock), one not uploaded
 * yet, and a new best.
 */
export type HistoryRowScore =
  /** The trusted score; `muted` for a run ended early, whose score counts toward totals but never sets a record. */
  | { readonly kind: 'score'; readonly value: number; readonly muted: boolean }
  /** No trusted result yet (on this device, or not scored yet). */
  | { readonly kind: 'pending' }
  /** The run does not count, so it has no score. */
  | { readonly kind: 'none' };

export type HistoryRowTag = 'not-counted' | 'ended-early' | 'flagged' | 'awaiting-unlock' | 'not-uploaded' | 'new-best';

export interface HistoryRowView {
  readonly score: HistoryRowScore;
  readonly tag: HistoryRowTag | null;
}

export function historyRowView(row: HistoryRow): HistoryRowView {
  const resolved = row.state === 'verified' || row.state === 'flagged' || row.state === 'invalid';
  const score: HistoryRowScore = !resolved ? { kind: 'pending' }
    : row.score === null ? { kind: 'none' }
      : { kind: 'score', value: row.score, muted: !row.completed };
  const tag: HistoryRowTag | null = row.state === 'invalid' ? 'not-counted'
    : !row.completed ? 'ended-early'
      : row.state === 'flagged' ? (row.awaitingUnlock ? 'awaiting-unlock' : 'flagged')
        : row.state === 'on-device' ? 'not-uploaded'
          // Point in time: the run set a best when it was scored; a later run may have beaten it since (ADR-001 decision 12).
          : row.state === 'verified' && row.personalBest ? 'new-best'
            : null;
  return { score, tag };
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
