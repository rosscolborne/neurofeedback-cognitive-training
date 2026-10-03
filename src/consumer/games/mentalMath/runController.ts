import { mentalMath } from '@nfct/shared';
import { ActiveStopwatch, type GameClock, type GameTimerHandle } from '../../clock/gameClock';

// The Mental Math GameSessionRunner: drives NFCT-17's pure run reducer with
// one game clock, and owns everything the reducer deliberately does not: the
// active clock that drains the time bank, per-question deadlines, the
// answer-feedback flash and the brief time-bank change beside the timer,
// pause and backgrounding, the digit entry, and ending the run exactly once.
//
// Timing rules (design J):
// - Active time runs only while a question is on screen. Answer feedback,
//   pauses and backgrounding do not consume it.
// - The run ends when the time bank runs out (the reducer's endsAtMs, which
//   each recorded answer moves; NFCT-60). That end is 'completed'.
// - Expiry always wins. No question is presented at or after the bank's end,
//   and the question on screen at expiry is discarded, never recorded. A late
//   answer the reducer refuses as 'run-over' is treated the same way.
// - Pausing or backgrounding discards the question on screen; resuming
//   presents a fresh one at the same level. Pauses are unlimited.
// - Only quit() ends a run early, as 'abandoned'.
//
// It holds nothing outside memory and writes nothing: the finished run is
// handed to `onEnd` once, and the caller saves it. A run that is torn down
// before it ends (dispose) leaves no trace.

type MentalMathRun = mentalMath.MentalMathRun;
type AnswerResult = mentalMath.AnswerResult;

/** The correct/wrong flash after each answer, off the active clock. */
export const FEEDBACK_MS = 400;
/** How often the remaining time on screen is refreshed while the clock runs. */
export const HUD_REFRESH_MS = 250;
/** How long the time-bank change ("+3s", "−5s") stays beside the timer, in wall time. */
export const BANK_CHANGE_SHOW_MS = 1_200;
/** Responses have at most this many digits (NFCT-17's response bound). */
export const MAX_ENTRY_DIGITS = String(mentalMath.MAX_RESPONSE).length;

export type RunPhase = 'ready' | 'question' | 'feedback' | 'paused' | 'waiting' | 'ended';
export type PauseReason = 'player' | 'background';

export interface RunFeedback {
  /** The question just answered, still shown during the flash. */
  readonly questionText: string;
  readonly correct: boolean;
  readonly timedOut: boolean;
  readonly expected: number;
}

/** The time bank change of the last answer, shown briefly beside the timer. */
export interface BankChange {
  /** Applied change in ms (after the bank cap and run limit), never 0. */
  readonly ms: number;
  /** The trial it came from (its 1-based count), so each change renders as its own flash. */
  readonly trial: number;
}

export interface RunOutcome {
  readonly status: 'completed' | 'abandoned';
  readonly run: MentalMathRun;
  /** Active run time: pauses and feedback excluded, at most the time bank's end. */
  readonly activeDurationMs: number;
  /** Device wall clock. */
  readonly startedAtMs: number;
  readonly endedAtMs: number;
}

export interface RunSnapshot {
  readonly phase: RunPhase;
  readonly pauseReason: PauseReason | null;
  readonly question: { readonly id: string; readonly text: string; readonly level: number } | null;
  /** The digits typed so far. */
  readonly entry: string;
  readonly feedback: RunFeedback | null;
  /** The level of the next question. */
  readonly level: number;
  readonly score: number;
  /** Correct answers in a row. */
  readonly streak: number;
  /** Active time left in the time bank. */
  readonly remainingMs: number;
  /** The last answer's change to the time bank, while it is on screen. */
  readonly bankChange: BankChange | null;
  readonly trialsRecorded: number;
  readonly outcome: RunOutcome | null;
}

export interface RunControllerOptions {
  readonly seed: number;
  readonly startLevel: number;
  readonly clock: GameClock;
  /** Called exactly once, when the run ends. */
  readonly onEnd: (outcome: RunOutcome) => void;
}

export class MentalMathRunController {
  private run: MentalMathRun;
  private readonly clock: GameClock;
  private readonly stopwatch: ActiveStopwatch;
  private readonly onEnd: (outcome: RunOutcome) => void;
  private phase: RunPhase = 'ready';
  private pauseReason: PauseReason | null = null;
  private entry = '';
  private feedback: RunFeedback | null = null;
  private outcome: RunOutcome | null = null;
  private score = 0;
  private startedAtMs = 0;
  private deadlineTimer: GameTimerHandle | null = null;
  private feedbackTimer: GameTimerHandle | null = null;
  private hudTimer: GameTimerHandle | null = null;
  private bankChangeTimer: GameTimerHandle | null = null;
  private bankChange: BankChange | null = null;
  private disposed = false;
  private listeners = new Set<() => void>();
  private snapshot: RunSnapshot;

  constructor({ seed, startLevel, clock, onEnd }: RunControllerOptions) {
    this.run = mentalMath.startRun({ seed, startLevel });
    this.clock = clock;
    this.stopwatch = new ActiveStopwatch(clock);
    this.onEnd = onEnd;
    this.snapshot = this.buildSnapshot();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = (): RunSnapshot => this.snapshot;

  /** Starts the run clock and presents the first question. */
  start(): void {
    if (this.phase !== 'ready' || this.disposed) return;
    this.startedAtMs = this.clock.wallNow();
    this.stopwatch.start();
    this.presentNext();
  }

  pressDigit(digit: number): void {
    if (this.phase !== 'question' || !Number.isInteger(digit) || digit < 0 || digit > 9) return;
    if (this.entry.length >= MAX_ENTRY_DIGITS) return;
    // No leading zeros: a lone 0 is replaced by the next digit.
    this.entry = this.entry === '0' ? String(digit) : this.entry + String(digit);
    this.emit();
  }

  deleteDigit(): void {
    if (this.phase !== 'question' || this.entry === '') return;
    this.entry = this.entry.slice(0, -1);
    this.emit();
  }

  /**
   * Submits the typed answer to the question the player saw (`questionId`).
   * Ignored with nothing typed, outside a question, or for any other question:
   * a second tap of the same Submit can never resolve a question twice.
   */
  submit(questionId: string): void {
    const current = this.run.current;
    if (this.phase !== 'question' || current === null || current.id !== questionId || this.entry === '') return;
    const rtMs = this.stopwatch.elapsed() - current.shownAtMs;
    this.handleResult(mentalMath.answerQuestion(this.run, { questionId, response: Number(this.entry), rtMs }));
  }

  /** Freezes the clock and discards the question on screen. Backgrounding uses reason 'background'. */
  pause(reason: PauseReason = 'player'): void {
    if (this.phase !== 'question' && this.phase !== 'feedback' && this.phase !== 'waiting') return;
    this.run = mentalMath.discardQuestion(this.run);
    this.clearTimers();
    this.stopwatch.stop();
    this.phase = 'paused';
    this.pauseReason = reason;
    this.entry = '';
    this.feedback = null;
    this.bankChange = null;
    this.emit();
  }

  /** Restarts the clock with a fresh question at the same level. */
  resume(): void {
    if (this.phase !== 'paused' || this.disposed) return;
    this.pauseReason = null;
    this.stopwatch.start();
    this.presentNext();
  }

  /** Ends the run early as 'abandoned'. */
  quit(): void {
    if (this.phase === 'ready' || this.phase === 'ended' || this.disposed) return;
    this.run = mentalMath.discardQuestion(this.run);
    this.end('abandoned');
  }

  /** Stops every timer without ending the run: nothing is reported or kept. */
  dispose(): void {
    this.disposed = true;
    this.clearTimers();
    this.stopwatch.stop();
    this.listeners.clear();
  }

  private presentNext(): void {
    const now = this.stopwatch.elapsed();
    if (now >= this.run.endsAtMs) {
      this.end('completed');
      return;
    }
    if (mentalMath.isTrialCapReached(this.run)) {
      // The session holds no more trials: let the clock run out with no question.
      this.phase = 'waiting';
    } else {
      this.run = mentalMath.presentQuestion(this.run, now);
      this.phase = 'question';
    }
    this.entry = '';
    this.feedback = null;
    this.scheduleDeadline();
    this.scheduleHudRefresh();
    this.emit();
  }

  private scheduleDeadline(): void {
    if (this.deadlineTimer !== null) this.clock.clearTimeout(this.deadlineTimer);
    const current = this.run.current;
    const target = current === null
      ? this.run.endsAtMs
      : Math.min(current.shownAtMs + current.timeLimitMs, this.run.endsAtMs);
    this.deadlineTimer = this.clock.setTimeout(() => this.onDeadline(), Math.max(0, target - this.stopwatch.elapsed()));
  }

  private onDeadline(): void {
    this.deadlineTimer = null;
    if (this.disposed || (this.phase !== 'question' && this.phase !== 'waiting')) return;
    const now = this.stopwatch.elapsed();
    const current = this.run.current;
    if (current !== null && now >= current.shownAtMs + current.timeLimitMs) {
      this.handleResult(mentalMath.timeOutQuestion(this.run, { questionId: current.id }));
      return;
    }
    if (now >= this.run.endsAtMs) {
      this.expire();
      return;
    }
    this.scheduleDeadline();
  }

  private handleResult(result: AnswerResult): void {
    if (result.accepted) {
      this.record(result);
    } else if (result.reason === 'run-over') {
      // The run ended while this question was on screen: expiry wins.
      this.expire();
    }
    // 'stale-question' and 'no-question' change nothing.
  }

  private record(result: Extract<AnswerResult, { accepted: true }>): void {
    this.run = result.run;
    this.score = mentalMath.score(this.run.trials, { modeId: mentalMath.MODE_ID, startLevel: this.run.startLevel }).score;
    this.clearTimers();
    // Feedback does not consume the run clock.
    this.stopwatch.stop();
    this.phase = 'feedback';
    const { trial } = result;
    this.showBankChange(result.bankChangeMs);
    this.feedback = { questionText: mentalMath.formatQuestion(trial), correct: trial.correct, timedOut: trial.timedOut, expected: trial.expected };
    this.feedbackTimer = this.clock.setTimeout(() => {
      this.feedbackTimer = null;
      if (this.disposed || this.phase !== 'feedback') return;
      this.stopwatch.start();
      this.presentNext();
    }, FEEDBACK_MS);
    this.emit();
  }

  /**
   * Shows a non-zero bank change beside the timer for BANK_CHANGE_SHOW_MS of
   * wall time, through the feedback flash and into the next question.
   */
  private showBankChange(ms: number): void {
    if (this.bankChangeTimer !== null) this.clock.clearTimeout(this.bankChangeTimer);
    this.bankChangeTimer = null;
    this.bankChange = ms === 0 ? null : { ms, trial: this.run.trials.length };
    if (this.bankChange === null) return;
    this.bankChangeTimer = this.clock.setTimeout(() => {
      this.bankChangeTimer = null;
      if (this.disposed) return;
      this.bankChange = null;
      this.emit();
    }, BANK_CHANGE_SHOW_MS);
  }

  private expire(): void {
    this.run = mentalMath.discardQuestion(this.run);
    this.end('completed');
  }

  private end(status: RunOutcome['status']): void {
    if (this.phase === 'ended') return;
    this.clearTimers();
    this.stopwatch.stop();
    const endedAtMs = Math.max(this.clock.wallNow(), this.startedAtMs + 1);
    this.phase = 'ended';
    this.pauseReason = null;
    this.entry = '';
    this.feedback = null;
    this.bankChange = null;
    this.outcome = {
      status,
      run: this.run,
      activeDurationMs: Math.min(this.stopwatch.elapsed(), this.run.endsAtMs),
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
      if (this.disposed || !this.stopwatch.running) return;
      this.emit();
      this.scheduleHudRefresh();
    }, HUD_REFRESH_MS);
  }

  private clearTimers(): void {
    for (const timer of [this.deadlineTimer, this.feedbackTimer, this.hudTimer, this.bankChangeTimer]) {
      if (timer !== null) this.clock.clearTimeout(timer);
    }
    this.deadlineTimer = null;
    this.feedbackTimer = null;
    this.hudTimer = null;
    this.bankChangeTimer = null;
  }

  private buildSnapshot(): RunSnapshot {
    const current = this.run.current;
    return {
      phase: this.phase,
      pauseReason: this.pauseReason,
      question: current === null ? null : { id: current.id, text: mentalMath.formatQuestion(current), level: current.level },
      entry: this.entry,
      feedback: this.feedback,
      level: this.run.staircase.level,
      score: this.score,
      streak: this.run.answerStreak,
      remainingMs: mentalMath.bankRemainingMs(this.run, this.stopwatch.elapsed()),
      bankChange: this.bankChange,
      trialsRecorded: this.run.trials.length,
      outcome: this.outcome,
    };
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of [...this.listeners]) listener();
  }
}
