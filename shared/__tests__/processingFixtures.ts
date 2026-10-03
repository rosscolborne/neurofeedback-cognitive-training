import { localDateIn, mentalMathV1 as mm, mentalMathV2, sequenceMemoryV1 as sm, type FirestoreTimestamp } from '@nfct/shared';

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

/**
 * Plays a gameVersion 2 (time bank, NFCT-60) run through the v2 reducer: the
 * same player as playRun, until the bank runs out or `stopAtMs`.
 */
export function playTimeBankRun({ seed, startLevel, targetPeak, rtMs = 1_400, stopAtMs = Number.POSITIVE_INFINITY }: RunPlan): mentalMathV2.MentalMathRun {
  const peak = Math.max(startLevel, targetPeak);
  let run = mentalMathV2.startRun({ seed, startLevel });
  let clock = 0;
  for (let index = 0; clock < Math.min(stopAtMs, run.endsAtMs) && !mentalMathV2.isTrialCapReached(run); index += 1) {
    run = mentalMathV2.presentQuestion(run, clock);
    const current = run.current!;
    const answered = mentalMathV2.answerQuestion(run, {
      questionId: current.id,
      response: current.level < peak ? current.expected : current.expected + 1,
      rtMs: rtMs + (index % 5) * 37,
    });
    if (!answered.accepted) {
      run = mentalMathV2.discardQuestion(run);
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
  /** 1 (default): the fixed 90 s run. 2: the time-bank run (NFCT-60), completed when its bank runs out. */
  readonly gameVersion?: 1 | 2;
};

/**
 * A Mental Math session document (gameVersion 1 by default, or 2) as a conforming client writes it, with
 * timestamps built by `timestamp` (the Admin SDK's Timestamp.fromMillis in
 * emulator tests, TestTimestamp in pure tests).
 */
export function mentalMathSession(
  plan: SessionPlan,
  timestamp: (ms: number) => FirestoreTimestamp,
): Record<string, unknown> {
  const status = plan.status ?? 'completed';
  const runPlan = status === 'abandoned' ? { stopAtMs: 30_000, ...plan } : plan;
  const timeBank = plan.gameVersion === 2;
  const run = timeBank ? playTimeBankRun(runPlan) : playRun(runPlan);
  const lastEnd = run.trials.reduce((end, trial) => Math.max(end, trial.shownAtMs + trial.rtMs), 0);
  const completedMs = timeBank ? (run as mentalMathV2.MentalMathRun).endsAtMs : mm.RUN_DURATION_MS;
  const activeDurationMs = status === 'completed' ? completedMs : lastEnd;
  const timezone = plan.timezone ?? 'America/Toronto';
  const scored = mm.score(run.trials, { modeId: mm.MODE_ID, startLevel: plan.startLevel });
  return {
    schemaVersion: 1,
    userId: plan.uid,
    gameId: mm.GAME_ID,
    gameVersion: timeBank ? mentalMathV2.GAME_VERSION : mm.GAME_VERSION,
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

// ---- Sequence Memory v1 (NFCT-93) ----

export type SequenceMemoryPlan = {
  readonly uid: string;
  readonly seed: number;
  readonly startLevel: number;
  /** The highest level to reach: correct below it, a wrong tile at it, so the trusted peak is max(startLevel, targetPeak). */
  readonly targetPeak: number;
  /** Time between taps. Under 100 ms flags the session. Default 450. */
  readonly tapMs?: number;
  /** Device clock: when the run ended. */
  readonly endedAtMs: number;
  /** 'abandoned' stops after half the trials. Default 'completed'. */
  readonly status?: 'completed' | 'abandoned';
  readonly timezone?: string;
  /** The value stored as createdAt; default: a timestamp one second after endedAt. */
  readonly createdAt?: unknown;
};

/** Plays a Sequence Memory v1 run through the reducer, as the run controller drives it. */
export function playSequenceMemoryRun({ seed, startLevel, targetPeak, tapMs = 450, status = 'completed' }: Omit<SequenceMemoryPlan, 'uid' | 'endedAtMs'>): sm.SequenceMemoryRun {
  const peak = Math.max(startLevel, targetPeak);
  const trials = status === 'completed' ? sm.TRIALS_PER_RUN : Math.floor(sm.TRIALS_PER_RUN / 2);
  let run = sm.startRun({ seed, startLevel });
  while (run.trials.length < trials) {
    run = sm.presentTrial(run, sm.recordedActiveMs(run));
    const current = run.current!;
    const recalls = current.level < peak;
    for (let index = 0; run.current !== null; index += 1) {
      const right = current.sequence[index]!;
      const tile = recalls || index < current.sequence.length - 1 ? right : (right + 1) % sm.tileCount(current.gridSize);
      const tapped = sm.tapTile(run, { trialId: current.id, tile, atMs: (index + 1) * (tapMs + (run.trials.length % 3) * 11) });
      if (!tapped.accepted) throw new Error(`tap refused: ${tapped.reason}`);
      run = tapped.run;
    }
  }
  return run;
}

/** A Sequence Memory v1 session document as a conforming client writes it. */
export function sequenceMemorySession(
  plan: SequenceMemoryPlan,
  timestamp: (ms: number) => FirestoreTimestamp,
): Record<string, unknown> {
  const status = plan.status ?? 'completed';
  const run = playSequenceMemoryRun({ ...plan, status });
  const activeDurationMs = sm.recordedActiveMs(run);
  const timezone = plan.timezone ?? 'America/Toronto';
  const scored = sm.score(run.trials, { modeId: sm.MODE_ID, startLevel: plan.startLevel });
  return {
    schemaVersion: 1,
    userId: plan.uid,
    gameId: sm.GAME_ID,
    gameVersion: sm.GAME_VERSION,
    modeId: sm.MODE_ID,
    startLevel: plan.startLevel,
    seed: plan.seed,
    peakLevel: sm.runPeakLevel(run),
    status,
    // Feedback between trials takes wall-clock time, so the span exceeds the active time.
    startedAt: timestamp(plan.endedAtMs - activeDurationMs - 15_000),
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

export type SequenceMemoryForgery = 'sequence' | 'level-sequence' | 'response' | 'fast-taps';

/**
 * An honest Sequence Memory session with one forgery: a sequence the seed
 * cannot produce (an easier one), a level the staircase cannot reach, a
 * response that does not match the trial's verdict, or every tap too fast to
 * be plausible.
 */
export function forgedSequenceMemory(session: Record<string, unknown>, forgery: SequenceMemoryForgery): Record<string, unknown> {
  const trials = (session.trials as sm.SequenceMemoryTrial[]).map((trial) => ({ ...trial }));
  const first = trials[0]!;
  switch (forgery) {
    case 'sequence': {
      // The same tiles, shortened by one: easier to recall, and not from the seed.
      const sequence = first.sequence.slice(0, -1);
      Object.assign(first, { sequence, response: sequence, tapAtMs: first.tapAtMs.slice(0, sequence.length), rtMs: first.tapAtMs[sequence.length - 1] });
      break;
    }
    case 'level-sequence':
      for (const trial of trials) trial.level = Math.min(sm.MAX_LEVEL, trial.level + 1);
      break;
    case 'response': {
      const wrong = trials.find((trial) => !trial.correct && !trial.timedOut);
      if (!wrong) throw new Error('fixture needs a wrong trial');
      // The full sequence as the response, while the trial still says it was wrong.
      wrong.response = [...wrong.sequence];
      break;
    }
    case 'fast-taps':
      return sequenceMemorySessionWithTaps(session, 40);
  }
  return { ...session, trials };
}

function sequenceMemorySessionWithTaps(session: Record<string, unknown>, tapMs: number): Record<string, unknown> {
  const plan = {
    seed: session.seed as number,
    startLevel: session.startLevel as number,
    targetPeak: session.peakLevel as number,
    status: session.status as 'completed' | 'abandoned',
    tapMs,
  };
  const run = playSequenceMemoryRun(plan);
  const scored = sm.score(run.trials, { modeId: sm.MODE_ID, startLevel: plan.startLevel });
  return {
    ...session,
    trials: run.trials,
    peakLevel: sm.runPeakLevel(run),
    activeDurationMs: sm.recordedActiveMs(run),
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
