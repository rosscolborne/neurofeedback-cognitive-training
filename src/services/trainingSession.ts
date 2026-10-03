// The headset session runner's clock and save rules. They concern only the
// session's integrity (one completion identity per run, and real-headset time
// backed by live headset data), never what the EEG measured.

/** NeuroGambit's session length, the length of its former default plan. */
export const NEUROGAMBIT_SESSION_SECONDS = 25 * 60;

export function advanceSessionClock(elapsedSeconds: number, durationSeconds: number) {
  const elapsed = elapsedSeconds + 1;
  return { elapsed, complete: elapsed >= durationSeconds };
}

export function getCompletedSessionDuration(completedDurationSeconds: number | undefined, elapsedSeconds: number): number {
  return completedDurationSeconds ?? elapsedSeconds;
}

/**
 * Completion identity is created once by the mounted runner and then reused for
 * every retry. There is deliberately no timestamp/random fallback: a weak or
 * changing identifier would make an ambiguous network result capable of
 * applying patient aggregates twice.
 */
export function createSessionCompletionId(): string {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error('Secure session completion IDs are unavailable in this browser.');
  }
  return `sess-${globalThis.crypto.randomUUID()}`;
}

export interface SessionMeasurementCoverage {
  isDemo: boolean;
  elapsedSeconds: number;
  /** Seconds in which new headset data arrived with the headset still connected. */
  measuredSeconds: number;
  hardwareConnected: boolean;
  sourceFresh: boolean;
}

export type SessionCompletionReadiness =
  | { ok: true }
  | { ok: false; error: string };

/**
 * A real-headset completion must be backed by live headset data for at least
 * 80% of the elapsed session clock. Demo sessions bypass this rule because
 * their simulated provenance is carried and presented explicitly.
 */
export function assessSessionCompletionReadiness(
  coverage: SessionMeasurementCoverage,
): SessionCompletionReadiness {
  if (coverage.isDemo) return { ok: true };
  if (!coverage.hardwareConnected) {
    return { ok: false, error: 'Your headset is disconnected. Reconnect it before saving this session.' };
  }
  if (!coverage.sourceFresh) {
    return { ok: false, error: 'Live EEG data has stopped. Resume only after new headset data is arriving.' };
  }
  if (coverage.elapsedSeconds < 1) {
    return { ok: false, error: 'No session time was recorded yet.' };
  }
  const requiredSeconds = Math.max(1, Math.ceil(coverage.elapsedSeconds * 0.8));
  if (coverage.measuredSeconds < requiredSeconds) {
    return {
      ok: false,
      error: `Headset data covered ${coverage.measuredSeconds} of ${coverage.elapsedSeconds} seconds. Resume with the headset connected before saving.`,
    };
  }
  return { ok: true };
}
