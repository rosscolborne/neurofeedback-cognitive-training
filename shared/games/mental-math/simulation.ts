import {
  answerQuestion,
  checkSession,
  createRng,
  discardQuestion,
  formatQuestion,
  intermediateOf,
  isLegalQuestion,
  LEVELS,
  MAX_LEVEL,
  MIN_LEVEL,
  MODE_ID,
  presentQuestion,
  questionAt,
  randomInt,
  RUN_DURATION_MS,
  runPeakLevel,
  sameQuestion,
  score,
  startRun,
  timeOutQuestion,
  trivialitiesOf,
  type MentalMathRun,
  type MentalMathTrial,
  type Question,
  type Rng,
} from './v1/index';

// The Mental Math v1 generator and scoring simulation (card NFCT-17), run
// before the provisional parameters are locked. Pure and deterministic: the
// same options always give the same report. Run it with
// `npm run simulate:mental-math`; the tests run a small version.
//
// It is tooling, not gameplay: it is not exported from @nfct/shared.

export type SimulationOptions = {
  /** Simulated sessions per level for the generator report. */
  readonly generatorRuns: number;
  /** Questions per simulated session in the generator report (about one 90 s run). */
  readonly questionsPerRun: number;
  /** Runs per player profile and start level in the scoring report. */
  readonly scoringRuns: number;
  /** Seed of the simulation's own randomness (player behaviour and session seeds). */
  readonly seed: number;
};

export const DEFAULT_SIMULATION_OPTIONS: SimulationOptions = {
  generatorRuns: 1_000,
  questionsPerRun: 40,
  scoringRuns: 200,
  seed: 20_260_930,
};

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

function shapeKind(question: Question): string {
  const [op1, op2] = question.operators;
  if (op2 === undefined) return `a ${op1} b`;
  return question.grouped ? `(a ${op1} b) ${op2} c` : `a ${op1} b ${op2} c`;
}

function key(question: Question): string {
  return formatQuestion(question);
}

export type GeneratorLevelReport = {
  readonly level: number;
  readonly questions: number;
  /** Share of questions per shape, e.g. '(a + b) × c'. */
  readonly shapes: Readonly<Record<string, number>>;
  /** Share of questions per template id. */
  readonly templates: Readonly<Record<string, number>>;
  readonly twoStepShare: number;
  readonly answers: Summary;
  readonly intermediates: Summary | null;
  /** Questions with any triviality (zero or ±0, ×1, ÷1, a − a, a ÷ a, a remainder, cancellation). Expected 0. */
  readonly trivial: number;
  /** Questions that are not legal for their level. Expected 0. */
  readonly illegal: number;
  /** Questions that fell back to the level's fixed question. */
  readonly fallbacks: number;
  /** Share of questions repeating an earlier question of the same session. */
  readonly repeatRate: number;
  /** Share of questions identical to the one just before (the run avoids showing these by taking the next variant). */
  readonly backToBackRate: number;
  readonly distinct: number;
};

function generatorReport(level: number, options: SimulationOptions, sessionSeeds: Rng): GeneratorLevelReport {
  const shapes: Record<string, number> = {};
  const templates: Record<string, number> = {};
  const answers: number[] = [];
  const intermediates: number[] = [];
  const distinct = new Set<string>();
  let trivial = 0;
  let illegal = 0;
  let fallbacks = 0;
  let repeats = 0;
  let backToBack = 0;
  let twoStep = 0;
  let total = 0;
  for (let run = 0; run < options.generatorRuns; run += 1) {
    const seed = sessionSeeds.nextUint32();
    const seen = new Set<string>();
    let previous: Question | null = null;
    for (let position = 0; position < options.questionsPerRun; position += 1) {
      const question = questionAt(seed, position, 0, level);
      const id = key(question);
      total += 1;
      shapes[shapeKind(question)] = (shapes[shapeKind(question)] ?? 0) + 1;
      templates[question.template] = (templates[question.template] ?? 0) + 1;
      answers.push(question.expected);
      const intermediate = intermediateOf(question);
      if (intermediate !== null) {
        intermediates.push(intermediate);
        twoStep += 1;
      }
      if (trivialitiesOf(question).length > 0) trivial += 1;
      if (!isLegalQuestion(level, question)) illegal += 1;
      if (question.template === 'fallback') fallbacks += 1;
      if (seen.has(id)) repeats += 1;
      if (previous && sameQuestion(previous, question)) backToBack += 1;
      seen.add(id);
      distinct.add(id);
      previous = question;
    }
  }
  const share = (counts: Record<string, number>) =>
    Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, count]) => [name, count / total]));
  return {
    level,
    questions: total,
    shapes: share(shapes),
    templates: share(templates),
    twoStepShare: twoStep / total,
    answers: summarize(answers),
    intermediates: intermediates.length > 0 ? summarize(intermediates) : null,
    trivial,
    illegal,
    fallbacks,
    repeatRate: repeats / total,
    backToBackRate: backToBack / total,
    distinct: distinct.size,
  };
}

/**
 * A synthetic player: how often they answer correctly and how fast, by level.
 * Response times are the median fraction of the level's time limit, scaled by
 * a uniform factor in [0.5, 1.5); at or past the limit the question times out.
 */
export type PlayerProfile = {
  readonly id: string;
  readonly accuracy: (level: number) => number;
  readonly rtFraction: (level: number) => number;
  /** Chance of pausing (and so discarding) each question. */
  readonly pauseChance: number;
};

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export const PLAYER_PROFILES: readonly PlayerProfile[] = [
  { id: 'beginner', accuracy: (l) => clamp(0.92 - 0.07 * (l - 1), 0.05, 1), rtFraction: (l) => 0.45 + 0.03 * (l - 1), pauseChance: 0.02 },
  { id: 'average', accuracy: (l) => clamp(0.97 - 0.05 * (l - 1), 0.05, 1), rtFraction: (l) => 0.35 + 0.025 * (l - 1), pauseChance: 0.02 },
  { id: 'strong', accuracy: (l) => clamp(0.99 - 0.03 * (l - 1), 0.05, 1), rtFraction: (l) => 0.25 + 0.02 * (l - 1), pauseChance: 0.02 },
  { id: 'expert', accuracy: (l) => clamp(0.995 - 0.015 * (l - 1), 0.05, 1), rtFraction: (l) => 0.15 + 0.015 * (l - 1), pauseChance: 0.02 },
  { id: 'slow-accurate', accuracy: (l) => clamp(0.99 - 0.02 * (l - 1), 0.05, 1), rtFraction: (l) => 0.6 + 0.02 * (l - 1), pauseChance: 0.02 },
  { id: 'fast-guesser', accuracy: (l) => clamp(0.6 - 0.05 * (l - 1), 0.05, 1), rtFraction: () => 0.1, pauseChance: 0.02 },
];

/** A uniform number in [0, 1) from the simulation's own stream. */
function uniform(rng: Rng): number {
  return randomInt(rng, 0, 999_999) / 1_000_000;
}

export type SimulatedRun = { readonly run: MentalMathRun; readonly pauses: number };

/**
 * One completed 90 s run: questions appear back to back on the active clock
 * (feedback does not run it), a pause discards the question on screen after
 * part of its time, and the question on screen at expiry is discarded.
 */
export function simulateRun(profile: PlayerProfile, startLevel: number, seed: number, behaviour: Rng): SimulatedRun {
  let run = startRun({ seed, startLevel });
  let clock = 0;
  let pauses = 0;
  for (;;) {
    run = presentQuestion(run, clock);
    const current = run.current!;
    const rt = Math.round(profile.rtFraction(current.level) * current.timeLimitMs * (0.5 + uniform(behaviour)));
    const correct = uniform(behaviour) < profile.accuracy(current.level);
    if (uniform(behaviour) < profile.pauseChance) {
      const elapsed = Math.floor(uniform(behaviour) * Math.min(rt, current.timeLimitMs));
      run = discardQuestion(run);
      if (clock + elapsed >= RUN_DURATION_MS) break;
      clock += elapsed;
      pauses += 1;
      continue;
    }
    const used = Math.min(rt, current.timeLimitMs);
    if (clock + used >= RUN_DURATION_MS) {
      run = discardQuestion(run); // the clock expired with the question on screen
      break;
    }
    const result = rt >= current.timeLimitMs
      ? timeOutQuestion(run, { questionId: current.id })
      : answerQuestion(run, { questionId: current.id, response: correct ? current.expected : current.expected + 1, rtMs: rt });
    if (!result.accepted) throw new Error(`simulation: answer refused (${result.reason})`);
    run = result.run;
    clock += used;
  }
  return { run, pauses };
}

export type ScoringCell = {
  readonly profile: string;
  readonly startLevel: number;
  readonly runs: number;
  readonly trials: Summary;
  readonly accuracy: Summary;
  readonly difficultyPoints: Summary;
  readonly speedBonusPoints: Summary;
  readonly score: Summary;
  readonly finalLevel: Summary;
  readonly peakLevel: Summary;
  readonly pauses: Summary;
  /** Runs for which the plausibility checks reported anything. Expected 0 for these honest players. */
  readonly runsWithReasons: number;
  readonly reasons: readonly string[];
};

function scoringCell(profile: PlayerProfile, startLevel: number, options: SimulationOptions, rng: Rng): ScoringCell {
  const rows: { trials: number; accuracy: number; difficulty: number; bonus: number; score: number; final: number; peak: number; pauses: number }[] = [];
  const reasons = new Set<string>();
  let runsWithReasons = 0;
  for (let index = 0; index < options.scoringRuns; index += 1) {
    const seed = rng.nextUint32();
    const { run, pauses } = simulateRun(profile, startLevel, seed, rng);
    const trials: readonly MentalMathTrial[] = run.trials;
    const scored = score(trials, { modeId: MODE_ID, startLevel });
    const report = checkSession({
      modeId: MODE_ID,
      startLevel,
      peakLevel: runPeakLevel(run),
      status: 'completed',
      activeDurationMs: RUN_DURATION_MS,
      seed,
      trials,
    });
    if (report.reasons.length > 0) runsWithReasons += 1;
    report.reasons.forEach((reason) => reasons.add(reason));
    rows.push({
      trials: trials.length,
      accuracy: scored.accuracy ?? 0,
      difficulty: scored.metrics.difficultyPoints,
      bonus: scored.metrics.speedBonusPoints,
      score: scored.score,
      final: scored.metrics.finalLevel,
      peak: scored.peakLevel,
      pauses,
    });
  }
  const of = (pick: (row: (typeof rows)[number]) => number) => summarize(rows.map(pick));
  return {
    profile: profile.id,
    startLevel,
    runs: rows.length,
    trials: of((row) => row.trials),
    accuracy: of((row) => row.accuracy),
    difficultyPoints: of((row) => row.difficulty),
    speedBonusPoints: of((row) => row.bonus),
    score: of((row) => row.score),
    finalLevel: of((row) => row.final),
    peakLevel: of((row) => row.peak),
    pauses: of((row) => row.pauses),
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
  const sessionSeeds = createRng(options.seed);
  const generator = LEVELS.map(({ level }) => generatorReport(level, options, sessionSeeds));
  const behaviour = createRng((options.seed ^ 0x5bd1e995) >>> 0);
  const scoring: ScoringCell[] = [];
  for (const profile of PLAYER_PROFILES) {
    for (let startLevel = MIN_LEVEL; startLevel <= MAX_LEVEL; startLevel += 1) {
      scoring.push(scoringCell(profile, startLevel, options, behaviour));
    }
  }
  return { options, generator, scoring };
}

const percent = (value: number) => `${(100 * value).toFixed(1)}%`;
const span = (summary: Summary) => `${summary.min}–${summary.max}`;

/** The report as Markdown tables, for the PR and for review. */
export function formatSimulationReport(report: SimulationReport): string {
  const { options } = report;
  const lines: string[] = [
    '# Mental Math v1 simulation',
    '',
    `Options: ${options.generatorRuns} sessions × ${options.questionsPerRun} questions per level; `
      + `${options.scoringRuns} runs per profile and start level; simulation seed ${options.seed}.`,
    '',
    '## Generator, per level',
    '',
    '| Level | Questions | Two-step | Answers min–max (median) | Intermediates min–max | Trivial | Illegal | Fallbacks | Repeat in session | Back-to-back | Distinct |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const level of report.generator) {
    lines.push(`| ${level.level} | ${level.questions} | ${percent(level.twoStepShare)} | ${span(level.answers)} (${level.answers.median}) | `
      + `${level.intermediates ? span(level.intermediates) : '—'} | ${level.trivial} | ${level.illegal} | ${level.fallbacks} | `
      + `${percent(level.repeatRate)} | ${percent(level.backToBackRate)} | ${level.distinct} |`);
  }
  lines.push('', '### Operator and step mix', '', '| Level | Shapes |', '| --- | --- |');
  for (const level of report.generator) {
    const shapes = Object.entries(level.shapes).map(([shape, value]) => `${shape} ${percent(value)}`).join(', ');
    lines.push(`| ${level.level} | ${shapes} |`);
  }
  lines.push(
    '',
    '## Scoring: synthetic players (completed 90 s runs; medians, with p10–p90 for the score)',
    '',
    '| Profile | Start | Trials | Accuracy | Difficulty points | Speed bonus | Score median (p10–p90) | Final level | Peak level (max) | Runs with reasons |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const cell of report.scoring) {
    lines.push(`| ${cell.profile} | ${cell.startLevel} | ${cell.trials.median} | ${percent(cell.accuracy.median)} | `
      + `${cell.difficultyPoints.median} | ${cell.speedBonusPoints.median} | ${cell.score.median} (${cell.score.p10}–${cell.score.p90}) | `
      + `${cell.finalLevel.median} | ${cell.peakLevel.median} (${cell.peakLevel.max}) | `
      + `${cell.runsWithReasons}${cell.reasons.length > 0 ? ` (${cell.reasons.join(', ')})` : ''} |`);
  }
  return lines.join('\n');
}
