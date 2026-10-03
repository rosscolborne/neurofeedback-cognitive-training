import {
  checkSession,
  createRng,
  discardTrial,
  isLegalSequence,
  isRunComplete,
  levelParams,
  LEVELS,
  MAX_LEVEL,
  MIN_LEVEL,
  MODE_ID,
  presentTrial,
  randomInt,
  recordedActiveMs,
  runPeakLevel,
  score,
  sequenceAt,
  startRun,
  tapTile,
  timeOutTrial,
  type Rng,
  type SequenceMemoryRun,
} from './v1/index';

// The Sequence Memory v1 simulation (NFCT-93): synthetic players run through
// the real run reducer, scoring and plausibility checks, to set the
// provisional parameters (run length, staircase, scoring) before any real
// play. Nothing here is gameplay; the frozen v1 module never imports it.
// `npx tsx shared/games/sequence-memory/simulate.ts` prints the report.

export type SimulationOptions = {
  /** Sequences generated per level for the generator report. */
  readonly generatorSequences: number;
  /** Runs per player profile and start level in the scoring report. */
  readonly scoringRuns: number;
  /** Seed of the simulation's own randomness (player behaviour and session seeds). */
  readonly seed: number;
};

export const DEFAULT_SIMULATION_OPTIONS: SimulationOptions = {
  generatorSequences: 5_000,
  scoringRuns: 200,
  seed: 20_261_003,
};

/** The feedback flash between trials, off the active clock: the client's FEEDBACK_MS. */
export const SIMULATED_FEEDBACK_MS = 700;

type Summary = { readonly min: number; readonly p10: number; readonly median: number; readonly p90: number; readonly max: number; readonly mean: number };

function summarize(values: readonly number[]): Summary {
  if (values.length === 0) return { min: 0, p10: 0, median: 0, p90: 0, max: 0, mean: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]!;
  return {
    min: sorted[0]!,
    p10: at(0.1),
    median: at(0.5),
    p90: at(0.9),
    max: sorted[sorted.length - 1]!,
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
  };
}

export type GeneratorLevelReport = {
  readonly level: number;
  readonly sequences: number;
  /** Sequences that are not legal for their level. Expected 0. */
  readonly illegal: number;
  /** Share of sequences that light some tile twice (not back to back). */
  readonly revisitRate: number;
  /** The least and most often drawn tile, as a share of the uniform rate. Near 1 for both. */
  readonly tileBalance: { readonly min: number; readonly max: number };
};

function generatorReport(level: number, options: SimulationOptions, seeds: Rng): GeneratorLevelReport {
  const { gridSize } = levelParams(level);
  const counts = new Array<number>(gridSize * gridSize).fill(0);
  let illegal = 0;
  let revisits = 0;
  let tiles = 0;
  for (let index = 0; index < options.generatorSequences; index += 1) {
    const sequence = sequenceAt(seeds.nextUint32(), index % 40, 0, level);
    if (!isLegalSequence(level, sequence)) illegal += 1;
    if (new Set(sequence).size < sequence.length) revisits += 1;
    for (const tile of sequence) {
      counts[tile] = (counts[tile] ?? 0) + 1;
      tiles += 1;
    }
  }
  const uniform = tiles / counts.length;
  return {
    level,
    sequences: options.generatorSequences,
    illegal,
    revisitRate: revisits / options.generatorSequences,
    tileBalance: { min: Math.min(...counts) / uniform, max: Math.max(...counts) / uniform },
  };
}

/**
 * A synthetic player. `span` is the sequence length they recall half the
 * time; each extra tile halves the odds. They tap the first tile after
 * `firstTapMs` and each next one after `tapMs` (each varied by ±50%).
 */
export type PlayerProfile = {
  readonly id: string;
  readonly span: number;
  readonly firstTapMs: number;
  readonly tapMs: number;
  /** Chance of pausing (and so discarding) each trial, during presentation or response. */
  readonly pauseChance: number;
};

export const PLAYER_PROFILES: readonly PlayerProfile[] = [
  { id: 'beginner', span: 4, firstTapMs: 900, tapMs: 600, pauseChance: 0.02 },
  { id: 'average', span: 5.5, firstTapMs: 700, tapMs: 450, pauseChance: 0.02 },
  { id: 'strong', span: 7, firstTapMs: 600, tapMs: 380, pauseChance: 0.02 },
  { id: 'expert', span: 8.5, firstTapMs: 500, tapMs: 320, pauseChance: 0.02 },
  { id: 'slow', span: 6, firstTapMs: 1_400, tapMs: 1_000, pauseChance: 0.02 },
];

/** The chance a player with capacity `capacity` recalls a sequence of length `span`. */
export function recallChance(capacity: number, span: number): number {
  return 1 / (1 + 2 ** (span - capacity));
}

/** A uniform number in [0, 1) from the simulation's own stream. */
function uniform(rng: Rng): number {
  return randomInt(rng, 0, 999_999) / 1_000_000;
}

function varied(ms: number, rng: Rng): number {
  return Math.max(1, Math.round(ms * (0.5 + uniform(rng))));
}

export type SimulatedRun = {
  readonly run: SequenceMemoryRun;
  readonly pauses: number;
  /** Active time: the end of the last recorded trial (time on discarded trials is not active time). */
  readonly activeMs: number;
  /** What the player sat through: active time, the feedback flashes and the discarded trials. */
  readonly elapsedMs: number;
};

/**
 * Plays one honest run through the real reducer, as the run controller does:
 * active time is the end of the recorded trials, a pause discards the trial on
 * screen and the run resumes at the same active time with a fresh variant.
 */
export function simulateRun(profile: PlayerProfile, startLevel: number, seed: number, behaviour: Rng): SimulatedRun {
  let run = startRun({ seed, startLevel });
  let pauses = 0;
  let elapsedMs = 0;
  while (!isRunComplete(run)) {
    run = presentTrial(run, recordedActiveMs(run));
    const current = run.current!;
    if (uniform(behaviour) < profile.pauseChance) {
      elapsedMs += Math.floor(uniform(behaviour) * (current.presentationMs + current.responseLimitMs));
      run = discardTrial(run);
      pauses += 1;
      continue;
    }
    const recalls = uniform(behaviour) < recallChance(profile.span, current.sequence.length);
    // A miss goes wrong at a random tile; the player taps a neighbouring tile there.
    const wrongAt = recalls ? -1 : randomInt(behaviour, 0, current.sequence.length - 1);
    let atMs = 0;
    let trialDone = false;
    for (let index = 0; index < current.sequence.length && !trialDone; index += 1) {
      atMs += varied(index === 0 ? profile.firstTapMs : profile.tapMs, behaviour);
      const tiles = current.gridSize * current.gridSize;
      const tile = index === wrongAt ? (current.sequence[index]! + 1) % tiles : current.sequence[index]!;
      const result = tapTile(run, { trialId: current.id, tile, atMs });
      if (!result.accepted) throw new Error(`simulation: tap refused (${result.reason})`);
      run = result.run;
      trialDone = result.trial !== null;
    }
    if (!trialDone) {
      const result = timeOutTrial(run, { trialId: current.id });
      if (!result.accepted) throw new Error(`simulation: timeout refused (${result.reason})`);
      run = result.run;
    }
    elapsedMs += SIMULATED_FEEDBACK_MS;
  }
  const activeMs = recordedActiveMs(run);
  return { run, pauses, activeMs, elapsedMs: elapsedMs + activeMs };
}

export type ScoringCell = {
  readonly profile: string;
  readonly startLevel: number;
  readonly runs: number;
  readonly accuracy: Summary;
  readonly score: Summary;
  readonly finalLevel: Summary;
  readonly peakLevel: Summary;
  readonly longestSpan: Summary;
  readonly timedOut: Summary;
  readonly pauses: Summary;
  /** Active run length, ms. */
  readonly activeMs: Summary;
  /** Wall-clock length with feedback and discarded trials, ms. */
  readonly elapsedMs: Summary;
  /** Runs for which the plausibility checks reported anything. Expected 0 for these honest players. */
  readonly runsWithReasons: number;
  readonly reasons: readonly string[];
};

function scoringCell(profile: PlayerProfile, startLevel: number, options: SimulationOptions, rng: Rng): ScoringCell {
  const rows: { accuracy: number; score: number; final: number; peak: number; span: number; timedOut: number; pauses: number; active: number; elapsed: number }[] = [];
  const reasons = new Set<string>();
  let runsWithReasons = 0;
  for (let index = 0; index < options.scoringRuns; index += 1) {
    const seed = rng.nextUint32();
    const { run, pauses, activeMs, elapsedMs } = simulateRun(profile, startLevel, seed, rng);
    const scored = score(run.trials, { modeId: MODE_ID, startLevel });
    const report = checkSession({
      modeId: MODE_ID,
      startLevel,
      peakLevel: runPeakLevel(run),
      status: 'completed',
      activeDurationMs: activeMs,
      seed,
      trials: run.trials,
    });
    if (report.reasons.length > 0) runsWithReasons += 1;
    report.reasons.forEach((reason) => reasons.add(reason));
    rows.push({
      accuracy: scored.accuracy ?? 0,
      score: scored.score,
      final: scored.metrics.finalLevel,
      peak: scored.peakLevel,
      span: scored.metrics.longestSpan,
      timedOut: scored.metrics.timedOut,
      pauses,
      active: activeMs,
      elapsed: elapsedMs,
    });
  }
  const of = (pick: (row: (typeof rows)[number]) => number) => summarize(rows.map(pick));
  return {
    profile: profile.id,
    startLevel,
    runs: rows.length,
    accuracy: of((row) => row.accuracy),
    score: of((row) => row.score),
    finalLevel: of((row) => row.final),
    peakLevel: of((row) => row.peak),
    longestSpan: of((row) => row.span),
    timedOut: of((row) => row.timedOut),
    pauses: of((row) => row.pauses),
    activeMs: of((row) => row.active),
    elapsedMs: of((row) => row.elapsed),
    runsWithReasons,
    reasons: [...reasons].sort(),
  };
}

export type SimulationReport = {
  readonly options: SimulationOptions;
  readonly generator: readonly GeneratorLevelReport[];
  readonly scoring: readonly ScoringCell[];
};

export function runSimulation(options: SimulationOptions = DEFAULT_SIMULATION_OPTIONS): SimulationReport {
  const rng = createRng(options.seed);
  const generator = LEVELS.map((params) => generatorReport(params.level, options, rng));
  const scoring: ScoringCell[] = [];
  for (const profile of PLAYER_PROFILES) {
    for (let startLevel = MIN_LEVEL; startLevel <= MAX_LEVEL; startLevel += 1) {
      scoring.push(scoringCell(profile, startLevel, options, rng));
    }
  }
  return { options, generator, scoring };
}

const fixed = (value: number, digits = 0) => value.toFixed(digits);
const seconds = (ms: number) => `${fixed(ms / 1000)} s`;

export function formatSimulationReport(report: SimulationReport): string {
  const lines: string[] = [];
  lines.push('# Sequence Memory v1 simulation', '');
  lines.push(`Options: ${JSON.stringify(report.options)}`, '');
  lines.push('## Generator, per level', '');
  lines.push('| Level | Span | Grid | Presentation | Limit | Sequences | Illegal | Revisit rate | Tile balance |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const level of report.generator) {
    const params = levelParams(level.level);
    lines.push(`| ${level.level} | ${params.span} | ${params.gridSize}×${params.gridSize} | ${params.presentationMs} ms | ${params.responseLimitMs} ms | ${level.sequences} | ${level.illegal} | ${fixed(level.revisitRate * 100)}% | ${fixed(level.tileBalance.min, 2)}–${fixed(level.tileBalance.max, 2)} |`);
  }
  lines.push('', '## Scoring: synthetic players (medians, p10–p90 where shown)', '');
  lines.push('| Profile | Start | Score | Accuracy | Peak | Final | Longest span | Timeouts | Active | Elapsed (p10–p90) | Runs with reasons |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const cell of report.scoring) {
    lines.push(`| ${cell.profile} | ${cell.startLevel} | ${cell.score.median} (${cell.score.p10}–${cell.score.p90}) | ${fixed(cell.accuracy.median * 100)}% | ${cell.peakLevel.median} | ${cell.finalLevel.median} | ${cell.longestSpan.median} | ${cell.timedOut.median} | ${seconds(cell.activeMs.median)} | ${seconds(cell.elapsedMs.median)} (${seconds(cell.elapsedMs.p10)}–${seconds(cell.elapsedMs.p90)}) | ${cell.runsWithReasons}${cell.reasons.length ? ` (${cell.reasons.join(', ')})` : ''} |`);
  }
  return lines.join('\n');
}
