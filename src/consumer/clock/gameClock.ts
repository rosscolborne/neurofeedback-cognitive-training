// The one clock a game reads. Game timing (the active run clock, per-question
// deadlines, answer feedback and the HUD refresh) reads time and schedules work
// only through a GameClock, so tests can drive it deterministically: component
// tests inject a manual clock, and Playwright's page.clock fakes the browser
// functions the production clock is built on. Nothing here changes production
// timing.

export type GameTimerHandle = ReturnType<typeof setTimeout>;

export interface GameClock {
  /** Monotonic milliseconds (performance.now in production). Only differences are meaningful. */
  now(): number;
  /** Wall-clock milliseconds since the epoch (Date.now in production), for the session's device timestamps. */
  wallNow(): number;
  setTimeout(callback: () => void, ms: number): GameTimerHandle;
  clearTimeout(handle: GameTimerHandle): void;
}

/** Production: performance.now() and the standard timers, read at call time so page.clock can replace them. */
export const browserGameClock: GameClock = {
  now: () => performance.now(),
  wallNow: () => Date.now(),
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
};

/**
 * Active time: a stopwatch over a GameClock that only runs while the player is
 * actually playing. Readings are whole milliseconds; each clock reading is
 * rounded before it is subtracted, so consecutive trials meet exactly.
 */
export class ActiveStopwatch {
  private accumulatedMs = 0;
  private runningSince: number | null = null;

  constructor(private readonly clock: GameClock) {}

  get running(): boolean {
    return this.runningSince !== null;
  }

  /** Active milliseconds so far. */
  elapsed(): number {
    return this.runningSince === null
      ? this.accumulatedMs
      : this.accumulatedMs + Math.max(0, Math.round(this.clock.now()) - this.runningSince);
  }

  start(): void {
    if (this.runningSince === null) this.runningSince = Math.round(this.clock.now());
  }

  stop(): void {
    if (this.runningSince === null) return;
    this.accumulatedMs = this.elapsed();
    this.runningSince = null;
  }
}
