import { localDateIn, mentalMathV1 as mm, type FirestoreTimestamp } from '@nfct/shared';

// Realistic Mental Math v1 sessions for trusted-scoring tests (NFCT-19), played
// through NFCT-17's pure run reducer exactly as the game screen drives it:
// integer active clock, each question shown when the previous trial ended.
// Shared by the pure processing tests and the Functions emulator tests.

export type RunPlan = {
  readonly seed: number;
  readonly startLevel: number;
  /**
   * The highest level to reach: the player answers correctly below it and
   * misses at it, so the trusted peak is exactly max(startLevel, targetPeak).
   */
  readonly targetPeak: number;
  /** Response time of each answer (varied slightly per trial). Under 250 ms flags the session. */
  readonly rtMs?: number;
  /** Stop presenting questions at this much active time (an abandoned run). Default: play the whole 90 s. */
  readonly stopAtMs?: number;
};

/** Plays a run through the reducer and returns it. */
export function playRun({ seed, startLevel, targetPeak, rtMs = 1_400, stopAtMs = mm.RUN_DURATION_MS }: RunPlan): mm.MentalMathRun {
  const peak = Math.max(startLevel, targetPeak);
  let run = mm.startRun({ seed, startLevel });
  let clock = 0;
  for (let index = 0; clock < stopAtMs && !mm.isTrialCapReached(run); index += 1) {
    run = mm.presentQuestion(run, clock);
    const current = run.current!;
    const answerCorrectly = current.level < peak;
    const rt = rtMs + (index % 5) * 37;
    const answered = mm.answerQuestion(run, {
      questionId: current.id,
      response: answerCorrectly ? current.expected : current.expected + 1,
      rtMs: rt,
    });
    if (!answered.accepted) {
      // Expiry wins: the question on screen is discarded and the run ends.
      run = mm.discardQuestion(run);
      break;
    }
    run = answered.run;
    clock = answered.trial.shownAtMs + answered.trial.rtMs;
  }
  return run;
}

/** 'YYYY-MM-DD' of an instant in a known time zone. */
function localDateOf(timezone: string, ms: number): string {
  const date = localDateIn(timezone, ms);
  if (date === null) throw new Error(`unknown time zone ${timezone}`);
  return date;
}

export type SessionPlan = RunPlan & {
  readonly uid: string;
  /** Device clock: when the run ended. */
  readonly endedAtMs: number;
  readonly status?: 'completed' | 'abandoned';
  readonly timezone?: string;
  /** The value stored as createdAt; default: a timestamp one second after endedAt. */
  readonly createdAt?: unknown;
};

/**
 * A Mental Math v1 session document as a conforming client writes it, with
 * timestamps built by `timestamp` (the Admin SDK's Timestamp.fromMillis in
 * emulator tests, TestTimestamp in pure tests).
 */
export function mentalMathSession(
  plan: SessionPlan,
  timestamp: (ms: number) => FirestoreTimestamp,
): Record<string, unknown> {
  const status = plan.status ?? 'completed';
  const run = playRun(status === 'abandoned' ? { stopAtMs: 30_000, ...plan } : plan);
  const lastEnd = run.trials.reduce((end, trial) => Math.max(end, trial.shownAtMs + trial.rtMs), 0);
  const activeDurationMs = status === 'completed' ? mm.RUN_DURATION_MS : lastEnd;
  const timezone = plan.timezone ?? 'America/Toronto';
  const scored = mm.score(run.trials, { modeId: mm.MODE_ID, startLevel: plan.startLevel });
  return {
    schemaVersion: 1,
    userId: plan.uid,
    gameId: mm.GAME_ID,
    gameVersion: mm.GAME_VERSION,
    modeId: mm.MODE_ID,
    startLevel: plan.startLevel,
    seed: plan.seed,
    peakLevel: mm.runPeakLevel(run),
    status,
    // Pauses and feedback take wall-clock time, so the span exceeds the active time.
    startedAt: timestamp(plan.endedAtMs - activeDurationMs - 12_000),
    endedAt: timestamp(plan.endedAtMs),
    activeDurationMs,
    localDate: localDateOf(timezone, plan.endedAtMs),
    timezone,
    createdAt: plan.createdAt ?? timestamp(plan.endedAtMs + 1_000),
    client: { appVersion: '0.1.0', platform: 'web' },
    trials: run.trials,
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

type Trial = mm.MentalMathTrial;

/**
 * A forged session that raises every Mental Math v1 reason and every
 * trusted-scoring reason that can occur alongside them: the most reasons a
 * result can be asked to record.
 */
export function forgedEverything(timestamp: (ms: number) => FirestoreTimestamp, endedAtMs: number): Record<string, unknown> {
  const base = mentalMathSession({ uid: 'someone-else', seed: 2_024, startLevel: 1, targetPeak: 4, endedAtMs }, timestamp);
  const trials = (base.trials as Trial[]).map((trial) => ({ ...trial }));
  if (trials.length < 30) throw new Error('fixture needs at least 30 trials');
  const at = (index: number) => trials[index]!;
  // Arithmetic and flags.
  at(0).expected += 1; // expected-mismatch, correct-mismatch
  at(1).timedOut = !at(1).timedOut; // timed-out-mismatch
  at(2).rtMs = at(2).timeLimitMs; // rt-exceeds-limit (an answer at the deadline)
  Object.assign(at(3), { response: null, correct: false, timedOut: true, rtMs: at(3).timeLimitMs - 1 }); // timeout-rt-mismatch
  at(4).timeLimitMs += 1; // time-limit-mismatch
  Object.assign(at(5), { operands: [900, 900], operators: ['+'], grouped: false, expected: 1_800 }); // question-outside-level, question-not-from-seed
  at(6).level = at(6).level === 10 ? 9 : at(6).level + 1; // level-sequence-mismatch
  // Timing.
  const fast = Math.floor(trials.length / 5) + 1; // rt-below-floor: more than 20% of trials under 250 ms
  for (let index = 9; index < 9 + fast; index += 1) at(index).rtMs = 100;
  at(8).shownAtMs = at(7).shownAtMs; // trial-overlap
  const last = trials[trials.length - 1]!;
  last.shownAtMs = 89_900; // run-overrun
  return {
    ...base,
    trials,
    peakLevel: 10, // peak-level-mismatch
    activeDurationMs: 60_000, // active-duration-mismatch
    summary: { ...(base.summary as object), score: 1 }, // summary-mismatch
    startedAt: timestamp(endedAtMs - 10_000), // wall-clock-short
    createdAt: timestamp(endedAtMs - 2 * 60_000), // device-clock-ahead
    localDate: '2020-01-01', // local-date-mismatch
  };
}
