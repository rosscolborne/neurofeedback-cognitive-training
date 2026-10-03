import { sequenceMemory, type GameProgress } from '@nfct/shared';
import type { ProgressWithRecentSessions } from '../../repositories/progressRepository';
import * as common from '../common/runSummaryModel';
import type { RecordLine as CommonRecordLine, RunIdentity, SaveStatus, Totals, UnlockLine, Verification } from '../common/runSummaryModel';
import type { SessionEnvironment } from '../common/sessionEnvironment';
import * as preview from '../common/startLevel';
import type { CurrentProgress, PreviewGame, StartLevelChoices } from '../common/startLevel';
import type { RunOutcome } from './runController';
import { clientSessionDocument } from './sessionDraft';

// Sequence Memory's progress preview and post-session summary (NFCT-93): the
// games' common preview and summary bound to the current Sequence Memory
// definition and its one mode, plus its own run statistics. Nothing here
// reads or reports anything about EEG.

export type RecordMetric = 'score' | 'longestSpan' | 'peakLevel';
export type RecordLine = CommonRecordLine<RecordMetric>;

export const SEQUENCE_MEMORY: PreviewGame & { readonly recordMetrics: readonly RecordMetric[] } = {
  definition: sequenceMemory.definition,
  modeId: sequenceMemory.MODE_ID,
  recordMetrics: ['score', 'longestSpan', 'peakLevel'],
};

export function currentProgress(state: ProgressWithRecentSessions, exceptSessionId: string | null = null): CurrentProgress {
  return preview.currentProgress(SEQUENCE_MEMORY, state, exceptSessionId);
}

export function startLevelChoices(state: ProgressWithRecentSessions | null): StartLevelChoices {
  return preview.startLevelChoices(SEQUENCE_MEMORY, state);
}

export function bestsFor(progress: GameProgress | null, startLevel: number): Partial<Record<RecordMetric, { value: number; sessionId: string }>> {
  return common.bestsFor(SEQUENCE_MEMORY, progress, startLevel);
}

export interface RunStats {
  readonly correct: number;
  readonly attempted: number;
  readonly accuracy: number | null;
  readonly peakLevel: number;
  /** The longest sequence recalled correctly; 0 when none was. */
  readonly longestSpan: number;
}

export interface RunSummaryModel {
  readonly status: RunOutcome['status'];
  readonly startLevel: number;
  readonly verification: Verification;
  /** Null when the run does not count (trusted scoring found it invalid). */
  readonly score: number | null;
  readonly stats: RunStats;
  readonly record: RecordLine;
  readonly unlock: UnlockLine;
  /** Per-game totals; null until progress is loaded. */
  readonly totals: Totals | null;
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
  const local = sequenceMemory.score(outcome.run.trials, { modeId: sequenceMemory.MODE_ID, startLevel });
  const core = common.runSummaryCore(SEQUENCE_MEMORY, {
    status: outcome.status,
    startLevel,
    local,
    document: () => clientSessionDocument(outcome, environment, run),
    run,
    save,
    state,
  });
  const metrics = core.metrics ?? local.metrics;
  return {
    status: outcome.status,
    startLevel,
    verification: core.verification,
    score: core.score,
    stats: {
      correct: metrics.correct,
      attempted: metrics.attempted,
      accuracy: core.accuracy,
      peakLevel: core.peakLevel,
      longestSpan: metrics.longestSpan,
    },
    record: core.record as RecordLine,
    unlock: core.unlock,
    totals: core.totals,
  };
}
