import type { ScoreContext, ScoredResult } from '../../definition';
import { isTapTooLate, judgeResponse, trialEndMs } from './limits';
import { levelParams, MAX_FAST_TAP_PERCENT, MIN_PLAUSIBLE_TAP_MS, MODE_ID, TIMING_TOLERANCE_MS, TRIALS_PER_RUN } from './params';
import type { SequenceMemoryMetrics, SequenceMemoryTrial } from './schemas';
import { isCorrectTrial, score } from './scoring';
import { isLegalSequence, SEQUENCE_VARIANTS, sameSequence, sequenceAt, tileCount } from './sequences';
import { initialStaircase, nextStaircaseState } from './staircase';

// Sequence Memory gameVersion 1: plausibility checks, as pure functions for
// trusted scoring to apply after the session passes
// gameSessionSchemaFor(definition). FROZEN with gameVersion 1, including each
// reason's outcome, so every v1 session is judged the same way forever. The
// pattern is Mental Math v1's:
//
// - 'invalid': a deterministic contract violation that a conforming v1 client
//   can never produce. Scored values are not trusted, and the session counts
//   nowhere.
// - 'flagged': a statistical or timing implausibility. Kept in history and
//   counted in totals, but sets no records and no unlocks.
// - 'diagnostic': recorded for debugging; validity is unchanged.
//
// Checks that need the device clock, the server clock or progress (localDate,
// createdAt, start-level unlocks) are trusted scoring's own.

export type CheckOutcome = 'invalid' | 'flagged' | 'diagnostic';

/** Every v1 reason code, its outcome, and (by key order) the canonical reporting order. */
export const REASON_OUTCOMES = Object.freeze({
  /** gridSize, presentationMs or responseLimitMs is not the trial level's. */
  'level-parameters-mismatch': 'invalid',
  /** The sequence's length, tiles or repeats do not belong to its level. */
  'sequence-outside-level': 'invalid',
  /** tapAtMs is not one non-decreasing time per response tile. */
  'malformed-taps': 'invalid',
  /** The response is longer than the sequence, taps a tile off the board, or goes on after a wrong tile. */
  'response-mismatch': 'invalid',
  /** A tap at or after responseLimitMs, or an rtMs above it. */
  'response-over-limit': 'invalid',
  /** correct is not the judged verdict 'correct'. */
  'correct-mismatch': 'invalid',
  /** timedOut is not the judged verdict 'timeout'. */
  'timed-out-mismatch': 'invalid',
  /** rtMs is not the last tap (an answer) or responseLimitMs (a timeout). */
  'rt-mismatch': 'invalid',
  /** The trial levels do not replay the 2-up/1-down staircase from startLevel. */
  'level-sequence-mismatch': 'invalid',
  /** The sequence cannot be reproduced from the session seed. */
  'sequence-not-from-seed': 'invalid',
  /** More than MAX_FAST_TAP_PERCENT of all taps come under MIN_PLAUSIBLE_TAP_MS after the one before. */
  'tap-below-floor': 'flagged',
  /** A trial starts before the previous one ended, beyond TIMING_TOLERANCE_MS. */
  'trial-overlap': 'flagged',
  /** A completed session without exactly TRIALS_PER_RUN trials, or an abandoned one with all of them. */
  'trial-count-mismatch': 'flagged',
  /** The session's activeDurationMs is not the end of its last trial, within TIMING_TOLERANCE_MS. */
  'active-duration-mismatch': 'flagged',
  /** The client-reported peakLevel is not the highest trial level. */
  'peak-level-mismatch': 'diagnostic',
  /** The client's display summary differs from trusted scoring. */
  'summary-mismatch': 'diagnostic',
} as const satisfies Record<string, CheckOutcome>);

export type SequenceMemoryReason = keyof typeof REASON_OUTCOMES;
const REASON_ORDER = Object.keys(REASON_OUTCOMES) as SequenceMemoryReason[];

export type PlausibilityIssue = {
  readonly code: SequenceMemoryReason;
  readonly outcome: CheckOutcome;
  /** The first trial concerned, or null for a session-level issue. */
  readonly trialIndex: number | null;
};

function issue(code: SequenceMemoryReason, trialIndex: number | null): PlausibilityIssue {
  return { code, outcome: REASON_OUTCOMES[code], trialIndex };
}

function perTrial(trials: readonly SequenceMemoryTrial[], code: SequenceMemoryReason, ok: (trial: SequenceMemoryTrial) => boolean) {
  return trials.flatMap((trial, index) => (ok(trial) ? [] : [issue(code, index)]));
}

/** Each trial's grid, presentation and response limit are its level's. */
export function checkLevelParameters(trials: readonly SequenceMemoryTrial[]): PlausibilityIssue[] {
  return perTrial(trials, 'level-parameters-mismatch', (trial) => {
    const params = levelParams(trial.level);
    return trial.gridSize === params.gridSize
      && trial.presentationMs === params.presentationMs
      && trial.responseLimitMs === params.responseLimitMs;
  });
}

/** Each sequence has its level's span, tiles of its level's grid, and no tile right after itself. */
export function checkSequences(trials: readonly SequenceMemoryTrial[]): PlausibilityIssue[] {
  return perTrial(trials, 'sequence-outside-level', (trial) => isLegalSequence(trial.level, trial.sequence));
}

/** One tap time per response tile, never decreasing. */
export function checkTaps(trials: readonly SequenceMemoryTrial[]): PlausibilityIssue[] {
  return perTrial(trials, 'malformed-taps', (trial) => trial.tapAtMs.length === trial.response.length
    && trial.tapAtMs.every((at, index) => index === 0 || at >= trial.tapAtMs[index - 1]!));
}

/**
 * The response is at most the sequence's length, taps tiles of the level's
 * grid, and stops at the first wrong tile: only its last tile may differ from
 * the sequence.
 */
export function checkResponses(trials: readonly SequenceMemoryTrial[]): PlausibilityIssue[] {
  return perTrial(trials, 'response-mismatch', (trial) => {
    const tiles = tileCount(levelParams(trial.level).gridSize);
    return trial.response.length <= trial.sequence.length
      && trial.response.every((tile, index) => tile < tiles && (tile === trial.sequence[index] || index === trial.response.length - 1));
  });
}

/** Every tap comes strictly before the trial's response limit, and rtMs is at most the limit. */
export function checkResponseLimits(trials: readonly SequenceMemoryTrial[]): PlausibilityIssue[] {
  return perTrial(trials, 'response-over-limit', (trial) => trial.rtMs <= trial.responseLimitMs
    && trial.tapAtMs.every((at) => !isTapTooLate(at, trial.responseLimitMs)));
}

/**
 * The flags and rtMs agree with the response, judged with the trial's own
 * limit: correct is the verdict 'correct', timedOut the verdict 'timeout', and
 * rtMs is the last tap for an answer or the limit for a timeout.
 */
export function checkVerdicts(trials: readonly SequenceMemoryTrial[]): PlausibilityIssue[] {
  return trials.flatMap((trial, index) => {
    const verdict = judgeResponse(trial.sequence, trial.response, trial.tapAtMs, trial.responseLimitMs);
    const expectedRt = verdict === 'timeout' ? trial.responseLimitMs : trial.tapAtMs[trial.tapAtMs.length - 1];
    return [
      ...(trial.correct === (verdict === 'correct') ? [] : [issue('correct-mismatch', index)]),
      ...(trial.timedOut === (verdict === 'timeout') ? [] : [issue('timed-out-mismatch', index)]),
      ...(trial.rtMs === expectedRt ? [] : [issue('rt-mismatch', index)]),
    ];
  });
}

/**
 * The trial levels replay the staircase from startLevel, using trusted
 * correctness (isCorrectTrial). Reports the first trial that departs from it.
 */
export function checkStaircase(trials: readonly SequenceMemoryTrial[], startLevel: number): PlausibilityIssue[] {
  let state = initialStaircase(startLevel);
  for (const [index, trial] of trials.entries()) {
    if (trial.level !== state.level) return [issue('level-sequence-mismatch', index)];
    state = nextStaircaseState(state, isCorrectTrial(trial));
  }
  return [];
}

export type SeedValidation = {
  readonly issues: PlausibilityIssue[];
  /** The variant each trial's sequence was reproduced from, or null when none matched. */
  readonly variants: (number | null)[];
};

/**
 * Reproduces every recorded sequence from the session seed. Trial i is at
 * position i (the trials recorded before it); its sequence must equal
 * sequenceAt(seed, i, v, trial.level) for some variant v below
 * SEQUENCE_VARIANTS. Discarded trials left no trial and need no record: they
 * only advanced the variant. Bounded work: at most SEQUENCE_VARIANTS
 * generations per trial. Nothing the client counted is trusted.
 */
export function validateTrialsAgainstSeed(seed: number, trials: readonly SequenceMemoryTrial[]): SeedValidation {
  const issues: PlausibilityIssue[] = [];
  const variants = trials.map((trial, position) => {
    for (let variant = 0; variant < SEQUENCE_VARIANTS; variant += 1) {
      if (sameSequence(sequenceAt(seed, position, variant, trial.level), trial.sequence)) return variant;
    }
    issues.push(issue('sequence-not-from-seed', position));
    return null;
  });
  return { issues, variants };
}

/**
 * Every tap's interval: from the start of the response phase for the first
 * tap, from the previous tap for the rest. More than MAX_FAST_TAP_PERCENT of
 * all the session's taps under MIN_PLAUSIBLE_TAP_MS flags the session.
 */
export function checkTapFloor(trials: readonly SequenceMemoryTrial[]): PlausibilityIssue[] {
  let taps = 0;
  let fast = 0;
  for (const trial of trials) {
    trial.tapAtMs.forEach((at, index) => {
      taps += 1;
      if (at - (index === 0 ? 0 : trial.tapAtMs[index - 1]!) < MIN_PLAUSIBLE_TAP_MS) fast += 1;
    });
  }
  return fast * 100 > taps * MAX_FAST_TAP_PERCENT ? [issue('tap-below-floor', null)] : [];
}

export type RunContext = {
  readonly status: 'completed' | 'abandoned';
  readonly activeDurationMs: number;
};

/**
 * Trials follow one another without overlap, and the session's active time is
 * exactly its trials': time on a discarded trial is not active time, so a
 * conforming client's activeDurationMs is the end of its last trial (0 with
 * no trials), within TIMING_TOLERANCE_MS.
 */
export function checkTiming(trials: readonly SequenceMemoryTrial[], { activeDurationMs }: RunContext): PlausibilityIssue[] {
  const issues: PlausibilityIssue[] = [];
  const overlap = trials.findIndex((trial, index) => {
    const previous = trials[index - 1];
    return previous !== undefined && (trial.shownAtMs <= previous.shownAtMs
      || trial.shownAtMs + TIMING_TOLERANCE_MS < trialEndMs(previous));
  });
  if (overlap !== -1) issues.push(issue('trial-overlap', overlap));
  const last = trials[trials.length - 1];
  const lastEnd = last === undefined ? 0 : trialEndMs(last);
  if (Math.abs(activeDurationMs - lastEnd) > TIMING_TOLERANCE_MS) issues.push(issue('active-duration-mismatch', null));
  return issues;
}

/** A completed run has exactly TRIALS_PER_RUN trials; an abandoned one has fewer. */
export function checkTrialCount(trials: readonly SequenceMemoryTrial[], { status }: RunContext): PlausibilityIssue[] {
  const ok = status === 'completed' ? trials.length === TRIALS_PER_RUN : trials.length < TRIALS_PER_RUN;
  return ok ? [] : [issue('trial-count-mismatch', null)];
}

/** The client's peakLevel equals the trusted peak: the highest trial level, or startLevel without trials. */
export function checkPeakLevel(trials: readonly SequenceMemoryTrial[], startLevel: number, peakLevel: number): PlausibilityIssue[] {
  const trusted = trials.reduce((peak, trial) => Math.max(peak, trial.level), trials.length > 0 ? 0 : startLevel);
  return peakLevel === trusted ? [] : [issue('peak-level-mismatch', null)];
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
export function checkSummary(summary: SummaryLike, scored: ScoredResult<SequenceMemoryMetrics>): PlausibilityIssue[] {
  const matches = summary.score === scored.score
    && summary.accuracy === scored.accuracy
    && summary.trialsTotal === scored.metrics.attempted
    && summary.trialsCorrect === scored.metrics.correct
    && sameRecord(summary.responseTime, scored.responseTime)
    && sameRecord(summary.metrics, scored.metrics);
  return matches ? [] : [issue('summary-mismatch', null)];
}

export type CheckableSession = ScoreContext & RunContext & {
  readonly peakLevel: number;
  readonly seed: number;
  readonly trials: readonly SequenceMemoryTrial[];
  /** The client's display summary, when it should be compared. */
  readonly summary?: SummaryLike;
};

export type PlausibilityReport = {
  /** The worst non-diagnostic outcome: invalid, then flagged, else valid. */
  readonly outcome: 'valid' | 'flagged' | 'invalid';
  /** Each reason once, in canonical order: what result.reasons records. */
  readonly reasons: SequenceMemoryReason[];
  /** Every issue found, in the order the checks run. */
  readonly issues: PlausibilityIssue[];
};

/**
 * Combines Sequence Memory v1 issues into a report. An unknown code, or an
 * issue whose outcome disagrees with REASON_OUTCOMES, throws rather than
 * being dropped, so a non-valid outcome always comes with at least one reason.
 */
export function reportOf(issues: readonly PlausibilityIssue[]): PlausibilityReport {
  for (const { code, outcome } of issues) {
    if (!Object.hasOwn(REASON_OUTCOMES, code) || REASON_OUTCOMES[code] !== outcome) {
      throw new Error(`Not a Sequence Memory v1 reason and outcome: '${String(code)}' (${String(outcome)})`);
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
  if (session.modeId !== MODE_ID) throw new Error(`Sequence Memory v1 has no mode '${session.modeId}'`);
  const ctx: ScoreContext = { modeId: session.modeId, startLevel };
  const issues = [
    ...checkLevelParameters(trials),
    ...checkSequences(trials),
    ...checkTaps(trials),
    ...checkResponses(trials),
    ...checkResponseLimits(trials),
    ...checkVerdicts(trials),
    ...checkStaircase(trials, startLevel),
    ...validateTrialsAgainstSeed(session.seed, trials).issues,
    ...checkTapFloor(trials),
    ...checkTiming(trials, session),
    ...checkTrialCount(trials, session),
    ...checkPeakLevel(trials, startLevel, session.peakLevel),
    ...(session.summary ? checkSummary(session.summary, score(trials, ctx)) : []),
  ];
  return reportOf(issues);
}
