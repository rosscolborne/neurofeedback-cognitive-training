import { Timestamp } from 'firebase/firestore';
import { localDateIn, mentalMath } from '@nfct/shared';
import type { GameSessionDraft } from '../../repositories/gameSessionRepository';
import type { RunOutcome } from './runController';

// The finished run as the session the repository writes once. The summary is
// the shared scoring's client-side view for immediate display; trusted scoring
// recomputes everything from the trials.

export type MentalMathSessionDraft = GameSessionDraft<mentalMath.MentalMathTrial, mentalMath.MentalMathMetrics>;

export interface SessionEnvironment {
  /** IANA time zone of the device. */
  readonly timezone: string;
  readonly appVersion: string;
  readonly platform: 'ios' | 'android' | 'web';
}

/** The web app has no release versioning yet; this is package.json's version. */
export const APP_VERSION = '0.0.0';

export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function buildSessionDraft(outcome: RunOutcome, environment: SessionEnvironment): MentalMathSessionDraft {
  const { run } = outcome;
  const scored = mentalMath.score(run.trials, { modeId: mentalMath.MODE_ID, startLevel: run.startLevel });
  // The same calendar date the server derives for the session.
  const localDate = localDateIn(environment.timezone, outcome.endedAtMs);
  if (localDate === null) throw new RangeError(`Unknown time zone: ${environment.timezone}`);
  return {
    gameId: mentalMath.GAME_ID,
    gameVersion: mentalMath.GAME_VERSION,
    modeId: mentalMath.MODE_ID,
    startLevel: run.startLevel,
    peakLevel: mentalMath.runPeakLevel(run),
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
