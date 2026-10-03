import { Timestamp } from 'firebase/firestore';
import { GAME_SESSION_SCHEMA_VERSION, localDateIn, sequenceMemory } from '@nfct/shared';
import type { GameSessionDraft } from '../../repositories/gameSessionRepository';
import type { RunIdentity } from '../common/runSummaryModel';
import type { SessionEnvironment } from '../common/sessionEnvironment';
import type { ClientSessionDocument } from '../common/startLevel';
import type { RunOutcome } from './runController';

// The finished run as the session the repository writes once. The summary is
// the shared scoring's client-side view for immediate display; trusted scoring
// recomputes everything from the trials. No EEG field: this game captures none.

export type SequenceMemorySessionDraft = GameSessionDraft<sequenceMemory.SequenceMemoryTrial, sequenceMemory.SequenceMemoryMetrics>;

export function buildSessionDraft(outcome: RunOutcome, environment: SessionEnvironment): SequenceMemorySessionDraft {
  const { run } = outcome;
  const scored = sequenceMemory.score(run.trials, { modeId: sequenceMemory.MODE_ID, startLevel: run.startLevel });
  // The same calendar date the server derives for the session.
  const localDate = localDateIn(environment.timezone, outcome.endedAtMs);
  if (localDate === null) throw new RangeError(`Unknown time zone: ${environment.timezone}`);
  return {
    gameId: sequenceMemory.GAME_ID,
    gameVersion: sequenceMemory.GAME_VERSION,
    modeId: sequenceMemory.MODE_ID,
    startLevel: run.startLevel,
    peakLevel: sequenceMemory.runPeakLevel(run),
    status: outcome.status,
    startedAt: Timestamp.fromMillis(outcome.startedAtMs),
    endedAt: Timestamp.fromMillis(outcome.endedAtMs),
    activeDurationMs: outcome.activeDurationMs,
    localDate,
    timezone: environment.timezone,
    client: { appVersion: environment.appVersion, platform: environment.platform },
    trials: [...run.trials],
    summary: {
      score: scored.score,
      accuracy: scored.accuracy,
      trialsTotal: run.trials.length,
      trialsCorrect: scored.metrics.correct,
      responseTime: scored.responseTime,
      metrics: scored.metrics,
    },
  };
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
