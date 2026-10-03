import type { ScoreContext, ScoredResult } from '../../definition';
import { isAnswerTimedOut, trialEndsWithinRun } from './limits';
import { levelParams, MIN_PLAUSIBLE_RT_MS, MODE_ID, RUN_DURATION_MS } from './params';
import { evaluate, isLegalQuestion, QUESTION_VARIANTS, questionAt, sameQuestion } from './questions';
import type { MentalMathMetrics, MentalMathTrial } from './schemas';
import { isCorrectTrial, score } from './scoring';
import { initialStaircase, nextStaircaseState } from './staircase';

// Mental Math gameVersion 1: plausibility checks, as pure functions for
// trusted scoring (NFCT-19) to apply after the session passes
// gameSessionSchemaFor(definition). FROZEN with gameVersion 1, including each
// reason's outcome, so every v1 session is judged the same way forever.
//
// Each check reports issues with a stable reason code and its outcome:
// - 'invalid': a deterministic contract violation that a conforming v1 client
//   can never produce (the trial is not a v1 trial). Scored values are not
//   trusted, and the session counts nowhere.
// - 'flagged': a statistical or timing implausibility. Kept in history and
//   counted in totals, but sets no records and no unlocks.
// - 'diagnostic': recorded for debugging; validity is unchanged.
//
// Design section F fixes only 'rt-below-floor' as flagged (and, outside this
// module, 'start-level-locked' as flagged and schema failure as invalid). The
// other outcomes are the Stage 1 orchestration default, listed for owner
// review in the NFCT-17 PR. Checks that need the device clock, the server
// clock or progress (localDate, createdAt, start-level unlocks) are NFCT-19's.

export type CheckOutcome = 'invalid' | 'flagged' | 'diagnostic';

/** Every v1 reason code, its outcome, and (by key order) the canonical reporting order. */
export const REASON_OUTCOMES = Object.freeze({
  /** expected is not the operands evaluated with their operators and grouping. */
  'expected-mismatch': 'invalid',
  /** correct is not (response === expected). */
  'correct-mismatch': 'invalid',
  /** timedOut is not (response === null). */
  'timed-out-mismatch': 'invalid',
  /** rtMs is above timeLimitMs, or an answer was recorded at or after the deadline. */
  'rt-exceeds-limit': 'invalid',
  /** A timeout whose rtMs is not timeLimitMs. */
  'timeout-rt-mismatch': 'invalid',
  /** timeLimitMs is not the trial level's limit. */
  'time-limit-mismatch': 'invalid',
  /** The question's operators, grouping, operand ranges or bounds do not belong to its level. */
  'question-outside-level': 'invalid',
  /** The trial levels do not replay the 3-up/1-down staircase from startLevel. */
  'level-sequence-mismatch': 'invalid',
  /** The question cannot be reproduced from the session seed. */
  'question-not-from-seed': 'invalid',
  /** More than MAX_FAST_RESPONSE_PERCENT of trials are under MIN_PLAUSIBLE_RT_MS (design F). */
  'rt-below-floor': 'flagged',
  /** A trial starts before the previous one ended, beyond TIMING_TOLERANCE_MS. */
  'trial-overlap': 'flagged',
  /** A trial ends after the 90 s run, beyond TIMING_TOLERANCE_MS. */
  'run-overrun': 'flagged',
  /**
   * A completed session's activeDurationMs is not within
   * ACTIVE_DURATION_TOLERANCE_MS of the run, or any session's trials end after
   * its activeDurationMs (beyond TIMING_TOLERANCE_MS), or it exceeds the run.
   */
  'active-duration-mismatch': 'flagged',
  /** The client-reported peakLevel is not the highest trial level. */
  'peak-level-mismatch': 'diagnostic',
  /** The client's display summary differs from trusted scoring. */
  'summary-mismatch': 'diagnostic',
} as const satisfies Record<string, CheckOutcome>);

export type MentalMathReason = keyof typeof REASON_OUTCOMES;
const REASON_ORDER = Object.keys(REASON_OUTCOMES) as MentalMathReason[];

/** A session is flagged when more than this share of its trials are faster than MIN_PLAUSIBLE_RT_MS. */
export const MAX_FAST_RESPONSE_PERCENT = 20;
/**
 * Slack for rounding in the client's active clock. A conforming client
 * records integer clock readings, so its trials meet exactly (the next
 * question appears at the previous shownAtMs + rtMs, because feedback does
 * not run the clock).
 */
export const TIMING_TOLERANCE_MS = 50;
/** How far a completed session's activeDurationMs may be from RUN_DURATION_MS. */
export const ACTIVE_DURATION_TOLERANCE_MS = 1_000;

export type PlausibilityIssue = {
  readonly code: MentalMathReason;
  readonly outcome: CheckOutcome;
  /** The first trial concerned, or null for a session-level issue. */
  readonly trialIndex: number | null;
};

function issue(code: MentalMathReason, trialIndex: number | null): PlausibilityIssue {
  return { code, outcome: REASON_OUTCOMES[code], trialIndex };
}

/** More than 20% of trials under 250 ms flags the session (design F). */
export function checkResponseTimeFloor(trials: readonly MentalMathTrial[]): PlausibilityIssue[] {
  const fast = trials.filter((trial) => trial.rtMs < MIN_PLAUSIBLE_RT_MS).length;
  return fast * 100 > trials.length * MAX_FAST_RESPONSE_PERCENT ? [issue('rt-below-floor', null)] : [];
}

/** expected equals the operands evaluated with their operators and grouping. */
export function checkArithmetic(trials: readonly MentalMathTrial[]): PlausibilityIssue[] {
  return trials.flatMap((trial, index) => (evaluate(trial) === trial.expected ? [] : [issue('expected-mismatch', index)]));
}

/** correct == (response == expected) and timedOut == (response == null). */
export function checkTrialFlags(trials: readonly MentalMathTrial[]): PlausibilityIssue[] {
  return trials.flatMap((trial, index) => [
    ...(trial.correct === (trial.response === trial.expected) ? [] : [issue('correct-mismatch', index)]),
    ...(trial.timedOut === (trial.response === null) ? [] : [issue('timed-out-mismatch', index)]),
  ]);
}

/**
 * rtMs <= timeLimitMs, equal to it on a timeout, and strictly below it for an
 * answer: an answer at the deadline counts as a timeout.
 */
export function checkResponseTimeLimits(trials: readonly MentalMathTrial[]): PlausibilityIssue[] {
  return trials.flatMap((trial, index) => {
    if (trial.response === null) return trial.rtMs === trial.timeLimitMs ? [] : [issue('timeout-rt-mismatch', index)];
    return isAnswerTimedOut(trial.rtMs, trial.timeLimitMs) ? [issue('rt-exceeds-limit', index)] : [];
  });
}

/** Each trial's time limit, operators, grouping and operand ranges belong to its level. */
export function checkLevelParameters(trials: readonly MentalMathTrial[]): PlausibilityIssue[] {
  return trials.flatMap((trial, index) => [
    ...(trial.timeLimitMs === levelParams(trial.level).timeLimitMs ? [] : [issue('time-limit-mismatch', index)]),
    ...(isLegalQuestion(trial.level, trial) ? [] : [issue('question-outside-level', index)]),
  ]);
}

/**
 * The trial levels replay the staircase from startLevel, using trusted
 * correctness (isCorrectTrial). Reports the first trial that departs from it.
 */
export function checkStaircase(trials: readonly MentalMathTrial[], startLevel: number): PlausibilityIssue[] {
  let state = initialStaircase(startLevel);
  for (const [index, trial] of trials.entries()) {
    if (trial.level !== state.level) return [issue('level-sequence-mismatch', index)];
    state = nextStaircaseState(state, isCorrectTrial(trial));
  }
  return [];
}

/** The client's peakLevel equals the trusted peak: the highest trial level, or startLevel without trials. */
export function checkPeakLevel(trials: readonly MentalMathTrial[], startLevel: number, peakLevel: number): PlausibilityIssue[] {
  const trusted = trials.reduce((peak, trial) => Math.max(peak, trial.level), trials.length > 0 ? 0 : startLevel);
  return peakLevel === trusted ? [] : [issue('peak-level-mismatch', null)];
}

export type TimingContext = {
  readonly status: 'completed' | 'abandoned';
  readonly activeDurationMs: number;
};

/**
 * shownAtMs increases with no overlap between trials, the last trial ends
 * within the run, and the session's activeDurationMs fits its trials (a
 * completed session's is within tolerance of 90 s).
 */
export function checkTiming(trials: readonly MentalMathTrial[], { status, activeDurationMs }: TimingContext): PlausibilityIssue[] {
  const issues: PlausibilityIssue[] = [];
  const overlap = trials.findIndex((trial, index) => {
    const previous = trials[index - 1];
    return previous !== undefined && (trial.shownAtMs <= previous.shownAtMs
      || trial.shownAtMs + TIMING_TOLERANCE_MS < previous.shownAtMs + previous.rtMs);
  });
  if (overlap !== -1) issues.push(issue('trial-overlap', overlap));

  const overrun = trials.findIndex((trial) => !trialEndsWithinRun(trial.shownAtMs, trial.rtMs, RUN_DURATION_MS + TIMING_TOLERANCE_MS));
  if (overrun !== -1) issues.push(issue('run-overrun', overrun));

  const lastEnd = trials.reduce((end, trial) => Math.max(end, trial.shownAtMs + trial.rtMs), 0);
  const durationMismatch = status === 'completed'
    ? Math.abs(activeDurationMs - RUN_DURATION_MS) > ACTIVE_DURATION_TOLERANCE_MS
    : activeDurationMs > RUN_DURATION_MS + ACTIVE_DURATION_TOLERANCE_MS;
  if (durationMismatch || lastEnd > activeDurationMs + TIMING_TOLERANCE_MS) {
    issues.push(issue('active-duration-mismatch', null));
  }
  return issues;
}

export type SeedValidation = {
  readonly issues: PlausibilityIssue[];
  /** The variant each trial's question was reproduced from, or null when none matched. */
  readonly variants: (number | null)[];
};

/**
 * Reproduces every recorded question from the session seed. Trial i is at
 * position i (the trials recorded before it); its question must equal
 * questionAt(seed, i, v, trial.level) for some variant v below
 * QUESTION_VARIANTS. Discarded questions left no trial and need no record:
 * they only advanced the variant. Bounded work: at most QUESTION_VARIANTS
 * generations per trial. Nothing the client counted is trusted.
 */
export function validateTrialsAgainstSeed(seed: number, trials: readonly MentalMathTrial[]): SeedValidation {
  const issues: PlausibilityIssue[] = [];
  const variants = trials.map((trial, position) => {
    for (let variant = 0; variant < QUESTION_VARIANTS; variant += 1) {
      if (sameQuestion(questionAt(seed, position, variant, trial.level), trial)) return variant;
    }
    issues.push(issue('question-not-from-seed', position));
    return null;
  });
  return { issues, variants };
}

export type SummaryLike = {
  readonly score: number;
  readonly accuracy: number | null;
  readonly trialsTotal: number;
  readonly trialsCorrect: number | null;
  readonly responseTime: { readonly medianMs: number; readonly meanMs: number; readonly p90Ms: number } | null;
  readonly metrics: Readonly<Record<string, unknown>>;
};

function sameRecord(a: Readonly<Record<string, unknown>> | null, b: Readonly<Record<string, unknown>> | null): boolean {
  if (a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key]));
}

/** The client's display summary equals what trusted scoring derived. A mismatch is diagnostic only. */
export function checkSummary(summary: SummaryLike, scored: ScoredResult<MentalMathMetrics>): PlausibilityIssue[] {
  const matches = summary.score === scored.score
    && summary.accuracy === scored.accuracy
    && summary.trialsTotal === scored.metrics.attempted
    && summary.trialsCorrect === scored.metrics.correct
    && sameRecord(summary.responseTime, scored.responseTime)
    && sameRecord(summary.metrics, scored.metrics);
  return matches ? [] : [issue('summary-mismatch', null)];
}

export type CheckableSession = ScoreContext & TimingContext & {
  readonly peakLevel: number;
  readonly seed: number;
  readonly trials: readonly MentalMathTrial[];
  /** The client's display summary, when it should be compared. */
  readonly summary?: SummaryLike;
};

export type PlausibilityReport = {
  /** The worst non-diagnostic outcome: invalid, then flagged, else valid. */
  readonly outcome: 'valid' | 'flagged' | 'invalid';
  /** Each reason once, in canonical order: what result.reasons records. */
  readonly reasons: MentalMathReason[];
  /** Every issue found, in the order the checks run. */
  readonly issues: PlausibilityIssue[];
};

/**
 * Combines Mental Math v1 issues into a report. It handles v1 reason codes
 * only, with the outcomes REASON_OUTCOMES freezes: an unknown code, or an
 * issue whose outcome disagrees with the table, throws rather than being
 * dropped, so a non-valid outcome always comes with at least one reason.
 * Trusted scoring merges its own reasons (schema-invalid, start-level-locked,
 * envelope and clock checks) separately, not through this function.
 */
export function reportOf(issues: readonly PlausibilityIssue[]): PlausibilityReport {
  for (const { code, outcome } of issues) {
    if (!Object.hasOwn(REASON_OUTCOMES, code) || REASON_OUTCOMES[code] !== outcome) {
      throw new Error(`Not a Mental Math v1 reason and outcome: '${String(code)}' (${String(outcome)})`);
    }
  }
  const found = new Set(issues.map(({ code }) => code));
  const outcomes = new Set(issues.map(({ outcome }) => outcome));
  return {
    outcome: outcomes.has('invalid') ? 'invalid' : outcomes.has('flagged') ? 'flagged' : 'valid',
    reasons: REASON_ORDER.filter((code) => found.has(code)),
    issues: [...issues],
  };
}

/**
 * Runs every v1 plausibility check on a session that already passed
 * gameSessionSchemaFor(definition). Pure and deterministic.
 */
export function checkSession(session: CheckableSession): PlausibilityReport {
  const { trials, startLevel } = session;
  if (session.modeId !== MODE_ID) throw new Error(`Mental Math v1 has no mode '${session.modeId}'`);
  const ctx: ScoreContext = { modeId: session.modeId, startLevel };
  const issues = [
    ...checkArithmetic(trials),
    ...checkTrialFlags(trials),
    ...checkResponseTimeLimits(trials),
    ...checkLevelParameters(trials),
    ...checkStaircase(trials, startLevel),
    ...validateTrialsAgainstSeed(session.seed, trials).issues,
    ...checkResponseTimeFloor(trials),
    ...checkTiming(trials, session),
    ...checkPeakLevel(trials, startLevel, session.peakLevel),
    ...(session.summary ? checkSummary(session.summary, score(trials, ctx)) : []),
  ];
  return reportOf(issues);
}
