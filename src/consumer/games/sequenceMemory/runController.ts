import { sequenceMemory } from '@nfct/shared';
import { ActiveStopwatch, type GameClock, type GameTimerHandle } from '../../clock/gameClock';

// The Sequence Memory run controller (NFCT-93): drives the shared v1 run
// reducer with one game clock, and owns everything the reducer deliberately
// does not: the presentation schedule (which tile is lit when), the response
// limit, the correct/wrong flash, pause and backgrounding, and ending the run
// exactly once.
//
// Timing rules:
// - Active time runs while a trial is on screen (presentation and response).
//   Feedback, pauses and backgrounding do not consume it.
// - Pausing or backgrounding discards the trial on screen, during
//   presentation or response; resuming presents a fresh sequence at the same
//   position and level. A discarded trial's time is not active time: the
//   next trial starts where the recorded trials end, so the session's
//   activeDurationMs is exactly the end of its last trial.
// - The run ends as 'completed' after TRIALS_PER_RUN trials, or as
//   'abandoned' on quit().
//
// It holds nothing outside memory and writes nothing: the finished run is
// handed to `onEnd` once, and the caller saves it. A run torn down before it
// ends (dispose) leaves no trace. EEG never reaches it.

type SequenceMemoryRun = sequenceMemory.SequenceMemoryRun;
type TapResult = sequenceMemory.TapResult;

/** The correct/wrong flash after each trial, off the active clock. */
export const FEEDBACK_MS = 700;
/** How often the response timer on screen is refreshed while the player responds. */
export const HUD_REFRESH_MS = 250;

export type RunPhase = 'ready' | 'presenting' | 'responding' | 'feedback' | 'paused' | 'ended';
export type PauseReason = 'player' | 'background';

export interface RunFeedback {
  readonly correct: boolean;
  readonly timedOut: boolean;
  /** The trial just recorded: its board, its sequence and what was tapped. */
  readonly gridSize: number;
  readonly sequence: readonly number[];
  readonly response: readonly number[];
}

export interface RunOutcome {
  readonly status: 'completed' | 'abandoned';
  readonly run: SequenceMemoryRun;
  /** Active run time: the end of the last recorded trial. */
  readonly activeDurationMs: number;
  /** Device wall clock. */
  readonly startedAtMs: number;
  readonly endedAtMs: number;
}

export interface TrialView {
  readonly id: string;
  readonly level: number;
  readonly gridSize: number;
  readonly span: number;
}

export interface RunSnapshot {
  readonly phase: RunPhase;
  readonly pauseReason: PauseReason | null;
  /** The trial on screen, during presentation and response. */
  readonly trial: TrialView | null;
  /** The lit tile during presentation, or null between tiles. */
  readonly litTile: number | null;
  /** Which step of the sequence is lit (0-based), so each lighting renders afresh. */
  readonly litStep: number | null;
  /** The tiles tapped so far in this trial, all correct. */
  readonly tapped: readonly number[];
  readonly feedback: RunFeedback | null;
  /** The level of the next trial. */
  readonly level: number;
  readonly score: number;
  readonly trialsRecorded: number;
  readonly trialsTotal: number;
  /** Response time left, while responding. */
  readonly responseRemainingMs: number | null;
  readonly responseLimitMs: number | null;
  readonly outcome: RunOutcome | null;
}

export interface RunControllerOptions {
  readonly seed: number;
  readonly startLevel: number;
  readonly clock: GameClock;
  /** Called exactly once, when the run ends. */
  readonly onEnd: (outcome: RunOutcome) => void;
}

/** Where a trial is at `ms` after its board appeared: a lit tile, the gap after it, or the response phase. */
export function presentationAt(trial: sequenceMemory.PresentedTrial, ms: number): { readonly step: number | null; readonly lit: boolean; readonly nextChangeMs: number } {
  const { litMs, gapMs } = sequenceMemory.levelParams(trial.level);
  const lead = sequenceMemory.LEAD_IN_MS;
  if (ms < lead) return { step: null, lit: false, nextChangeMs: lead };
  if (ms >= trial.presentationMs) return { step: null, lit: false, nextChangeMs: trial.presentationMs };
  const step = Math.floor((ms - lead) / (litMs + gapMs));
  const stepStart = lead + step * (litMs + gapMs);
  const lit = ms < stepStart + litMs;
  return { step, lit, nextChangeMs: lit ? stepStart + litMs : stepStart + litMs + gapMs };
}

export class SequenceMemoryRunController {
  private run: SequenceMemoryRun;
  private readonly clock: GameClock;
  /** The trial on screen's own clock: from its board appearing. Stopped by feedback and pauses, which discard or end the trial. */
  private trialClock: ActiveStopwatch;
  private readonly onEnd: (outcome: RunOutcome) => void;
  private phase: RunPhase = 'ready';
  private pauseReason: PauseReason | null = null;
  private feedback: RunFeedback | null = null;
  private outcome: RunOutcome | null = null;
  private score = 0;
  private startedAtMs = 0;
  private phaseTimer: GameTimerHandle | null = null;
  private hudTimer: GameTimerHandle | null = null;
  private disposed = false;
  private listeners = new Set<() => void>();
  private snapshot: RunSnapshot;

  constructor({ seed, startLevel, clock, onEnd }: RunControllerOptions) {
    this.run = sequenceMemory.startRun({ seed, startLevel });
    this.clock = clock;
    this.trialClock = new ActiveStopwatch(clock);
    this.onEnd = onEnd;
    this.snapshot = this.buildSnapshot();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = (): RunSnapshot => this.snapshot;

  /** Presents the first trial. */
  start(): void {
    if (this.phase !== 'ready' || this.disposed) return;
    this.startedAtMs = this.clock.wallNow();
    this.presentNext();
  }

  /**
   * A tap on `tile` of the trial the player saw (`trialId`). Ignored outside
   * the response phase or for any other trial, so a tap during the
   * presentation, the feedback flash or a later trial can never count.
   */
  tap(trialId: string, tile: number): void {
    const current = this.run.current;
    if (this.phase !== 'responding' || current === null || current.id !== trialId) return;
    const atMs = this.trialClock.elapsed() - current.presentationMs;
    this.handle(sequenceMemory.tapTile(this.run, { trialId, tile, atMs }));
  }

  /** Freezes the run and discards the trial on screen. Backgrounding uses reason 'background'. */
  pause(reason: PauseReason = 'player'): void {
    if (this.phase !== 'presenting' && this.phase !== 'responding' && this.phase !== 'feedback') return;
    this.run = sequenceMemory.discardTrial(this.run);
    this.clearTimers();
    this.trialClock.stop();
    this.phase = 'paused';
    this.pauseReason = reason;
    this.feedback = null;
    this.emit();
  }

  /** Presents a fresh trial at the same position and level. */
  resume(): void {
    if (this.phase !== 'paused' || this.disposed) return;
    this.pauseReason = null;
    this.presentNext();
  }

  /** Ends the run early as 'abandoned', unless all its trials are already recorded (a quit during the last flash). */
  quit(): void {
    if (this.phase === 'ready' || this.phase === 'ended' || this.disposed) return;
    this.run = sequenceMemory.discardTrial(this.run);
    this.end(sequenceMemory.isRunComplete(this.run) ? 'completed' : 'abandoned');
  }

  /** Stops every timer without ending the run: nothing is reported or kept. */
  dispose(): void {
    this.disposed = true;
    this.clearTimers();
    this.trialClock.stop();
    this.listeners.clear();
  }

  private presentNext(): void {
    if (sequenceMemory.isRunComplete(this.run)) {
      this.end('completed');
      return;
    }
    this.run = sequenceMemory.presentTrial(this.run, sequenceMemory.recordedActiveMs(this.run));
    this.trialClock = new ActiveStopwatch(this.clock);
    this.trialClock.start();
    this.feedback = null;
    this.phase = 'presenting';
    this.schedule();
    this.emit();
  }

  /** Moves the presentation on at its next change, then opens the response phase and its limit. */
  private schedule(): void {
    this.clearPhaseTimer();
    const current = this.run.current;
    if (current === null) return;
    const ms = this.trialClock.elapsed();
    if (ms < current.presentationMs) {
      this.phase = 'presenting';
      const { nextChangeMs } = presentationAt(current, ms);
      this.phaseTimer = this.clock.setTimeout(() => this.onPhaseTimer(), Math.max(0, nextChangeMs - ms));
      return;
    }
    if (this.phase !== 'responding') {
      this.phase = 'responding';
      this.scheduleHudRefresh();
    }
    const deadline = current.presentationMs + current.responseLimitMs;
    this.phaseTimer = this.clock.setTimeout(() => this.onPhaseTimer(), Math.max(0, deadline - ms));
  }

  private onPhaseTimer(): void {
    this.phaseTimer = null;
    const current = this.run.current;
    if (this.disposed || current === null || (this.phase !== 'presenting' && this.phase !== 'responding')) return;
    if (this.trialClock.elapsed() >= current.presentationMs + current.responseLimitMs) {
      this.handle(sequenceMemory.timeOutTrial(this.run, { trialId: current.id }));
      return;
    }
    this.schedule();
    this.emit();
  }

  private handle(result: TapResult): void {
    if (!result.accepted) return; // 'stale-trial' and 'no-trial' change nothing
    this.run = result.run;
    if (result.trial === null) {
      this.emit();
      return;
    }
    const { trial } = result;
    this.score = sequenceMemory.score(this.run.trials, { modeId: sequenceMemory.MODE_ID, startLevel: this.run.startLevel }).score;
    this.clearTimers();
    // Feedback does not consume active time.
    this.trialClock.stop();
    this.phase = 'feedback';
    this.feedback = { correct: trial.correct, timedOut: trial.timedOut, gridSize: trial.gridSize, sequence: trial.sequence, response: trial.response };
    this.phaseTimer = this.clock.setTimeout(() => {
      this.phaseTimer = null;
      if (this.disposed || this.phase !== 'feedback') return;
      this.presentNext();
    }, FEEDBACK_MS);
    this.emit();
  }

  private end(status: RunOutcome['status']): void {
    if (this.phase === 'ended') return;
    this.clearTimers();
    this.trialClock.stop();
    const endedAtMs = Math.max(this.clock.wallNow(), this.startedAtMs + 1);
    this.phase = 'ended';
    this.pauseReason = null;
    this.feedback = null;
    this.outcome = {
      status,
      run: this.run,
      activeDurationMs: sequenceMemory.recordedActiveMs(this.run),
      startedAtMs: this.startedAtMs,
      endedAtMs,
    };
    this.emit();
    this.onEnd(this.outcome);
  }

  private scheduleHudRefresh(): void {
    if (this.hudTimer !== null) this.clock.clearTimeout(this.hudTimer);
    this.hudTimer = this.clock.setTimeout(() => {
      this.hudTimer = null;
      if (this.disposed || this.phase !== 'responding') return;
      this.emit();
      this.scheduleHudRefresh();
    }, HUD_REFRESH_MS);
  }

  private clearPhaseTimer(): void {
    if (this.phaseTimer !== null) this.clock.clearTimeout(this.phaseTimer);
    this.phaseTimer = null;
  }

  private clearTimers(): void {
    this.clearPhaseTimer();
    if (this.hudTimer !== null) this.clock.clearTimeout(this.hudTimer);
    this.hudTimer = null;
  }

  private buildSnapshot(): RunSnapshot {
    const current = this.run.current;
    const ms = this.trialClock.elapsed();
    const showing = current !== null && (this.phase === 'presenting' || this.phase === 'responding');
    const at = showing && this.phase === 'presenting' ? presentationAt(current, ms) : null;
    return {
      phase: this.phase,
      pauseReason: this.pauseReason,
      trial: showing ? { id: current.id, level: current.level, gridSize: current.gridSize, span: current.sequence.length } : null,
      litTile: at?.lit && at.step !== null ? current!.sequence[at.step]! : null,
      litStep: at?.lit ? at.step : null,
      tapped: showing ? current.response : [],
      feedback: this.feedback,
      level: this.run.staircase.level,
      score: this.score,
      trialsRecorded: this.run.trials.length,
      trialsTotal: sequenceMemory.TRIALS_PER_RUN,
      responseRemainingMs: showing && this.phase === 'responding'
        ? Math.max(0, current.presentationMs + current.responseLimitMs - ms)
        : null,
      responseLimitMs: showing ? current.responseLimitMs : null,
      outcome: this.outcome,
    };
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of [...this.listeners]) listener();
  }
}
