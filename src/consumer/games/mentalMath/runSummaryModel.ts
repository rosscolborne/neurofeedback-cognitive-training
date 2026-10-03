import { Timestamp } from 'firebase/firestore';
import { GAME_SESSION_SCHEMA_VERSION, mentalMath, type GameProgress } from '@nfct/shared';
import type { ProgressWithRecentSessions } from '../../repositories/progressRepository';
import * as common from '../common/runSummaryModel';
import type { RecordLine as CommonRecordLine, RunIdentity, SaveStatus, Totals, UnlockLine, Verification } from '../common/runSummaryModel';
import type { SessionEnvironment } from '../common/sessionEnvironment';
import type { PreviewGame } from '../common/startLevel';
import type { RunOutcome } from './runController';
import { buildSessionDraft } from './sessionDraft';
import { timed90, type ClientSessionDocument } from './startLevel';

// Mental Math's post-session summary (NFCT-22): the games' common summary
// (common/runSummaryModel.ts) bound to the current Mental Math definition, plus
// its own score breakdown and run statistics. Nothing here reads or reports
// anything about EEG.

export type { RunIdentity, SaveStatus, Totals, UnlockLine, Verification } from '../common/runSummaryModel';

const game: PreviewGame & { readonly recordMetrics: readonly RecordMetric[] } = {
  definition: mentalMath.definition,
  modeId: mentalMath.MODE_ID,
  recordMetrics: ['score', 'correct', 'peakLevel'],
};

export type RecordMetric = 'score' | 'correct' | 'peakLevel';

export type RecordLine = CommonRecordLine<RecordMetric>;

export interface RunStats {
  readonly correct: number;
  readonly attempted: number;
  readonly accuracy: number | null;
  readonly peakLevel: number;
  readonly longestStreak: number;
}

export interface RunSummaryModel {
  readonly status: RunOutcome['status'];
  readonly startLevel: number;
  readonly verification: Verification;
  /** Null when the run does not count (trusted scoring found it invalid). */
  readonly score: number | null;
  /** How the score adds up: difficulty points plus speed bonus. */
  readonly breakdown: { readonly difficultyPoints: number; readonly speedBonusPoints: number } | null;
  readonly stats: RunStats;
  readonly record: RecordLine;
  readonly unlock: UnlockLine;
  /** Per-game totals; null until progress is loaded. */
  readonly totals: Totals | null;
}

/** The session exactly as this device writes it, with the server clock estimated as the run's end. */
export function clientSessionDocument(outcome: RunOutcome, environment: SessionEnvironment, run: RunIdentity): ClientSessionDocument {
  return {
    ...buildSessionDraft(outcome, environment),
    schemaVersion: GAME_SESSION_SCHEMA_VERSION,
    userId: run.userId,
    seed: run.seed,
    createdAt: Timestamp.fromMillis(outcome.endedAtMs),
  };
}

/** What unlocks next, from progress: the lowest peak level that raises the unlocked start level. */
export function nextUnlock(progress: Pick<GameProgress, 'bestPeakLevel'> | null): UnlockLine {
  return common.nextUnlock(timed90(), progress);
}

/** This record class's bests, in the current game version's record set. */
export function bestsFor(progress: GameProgress | null, startLevel: number): Partial<Record<RecordMetric, { value: number; sessionId: string }>> {
  return common.bestsFor(game, progress, startLevel);
}

export interface RunSummaryInput {
  readonly outcome: RunOutcome;
  readonly environment: SessionEnvironment;
  readonly run: RunIdentity;
  readonly save: SaveStatus;
  /** The game's cached progress and recent sessions, or null until they load (or when they cannot be read). */
  readonly state: ProgressWithRecentSessions | null;
}

export function runSummary({ outcome, environment, run, save, state }: RunSummaryInput): RunSummaryModel {
  const { startLevel } = outcome.run;
  const local = mentalMath.score(outcome.run.trials, { modeId: mentalMath.MODE_ID, startLevel });
  const core = common.runSummaryCore(game, {
    status: outcome.status,
    startLevel,
    local,
    document: () => clientSessionDocument(outcome, environment, run),
    run,
    save,
    state,
  });
  const { metrics } = core;
  const breakdown = core.invalid || metrics === null ? null : { difficultyPoints: metrics.difficultyPoints, speedBonusPoints: metrics.speedBonusPoints };
  const stats: RunStats = {
    correct: metrics?.correct ?? local.metrics.correct,
    attempted: metrics?.attempted ?? local.metrics.attempted,
    accuracy: core.accuracy,
    peakLevel: core.peakLevel,
    longestStreak: metrics?.longestStreak ?? local.metrics.longestStreak,
  };
  return {
    status: outcome.status,
    startLevel,
    verification: core.verification,
    score: core.score,
    breakdown,
    stats,
    record: core.record as RecordLine,
    unlock: core.unlock,
    totals: core.totals,
  };
}
