import { z } from 'zod';
import { domainWeightsSchema, type DomainWeights } from '../domains';
import { slugIdSchema } from '../primitives';

// The code-owned game catalogue contract. Each game lives in
// shared/games/<gameId>/ and is imported by the app and by Cloud Functions.

/** The most trials any session may carry (the rules' list-size cap). */
export const MAX_TRIALS_PER_SESSION = 400;
/** The longest active duration any session may report. */
export const MAX_ACTIVE_DURATION_MS = 3_600_000;
/** The highest level any game may define (the rules' level bound). */
export const MAX_GAME_LEVEL = 50;

export interface LevelDefinition {
  readonly level: number;
  readonly label: string;
  /** Generator parameters (operators, operand range, time limit, ...). */
  readonly params: Readonly<Record<string, unknown>>;
}

export interface UnlockContext {
  /** The highest trusted peak level in any valid completed run of the mode, any start level. */
  readonly bestPeakLevel: number;
  /** The mode's highest level. `bestPeakLevel` can exceed it after a gameVersion removes levels. */
  readonly maxLevel: number;
}

export interface GameModeDefinition {
  readonly id: string;
  /** Levels 1..N, in order. */
  readonly levels: readonly LevelDefinition[];
  /** True when the level ramps inside a session. */
  readonly adaptive: boolean;
  /** The unlocked start level when there is no valid progress for this mode. */
  readonly initiallyUnlockedStartLevel: number;
  /**
   * The mode's own deterministic unlock rule: the highest start level earned
   * so far. It must return an integer; `unlockedStartLevel` clamps the result
   * to [initiallyUnlockedStartLevel, maxLevel].
   */
  unlockPolicy(ctx: UnlockContext): number;
}

export interface GameLimits {
  readonly maxTrials: number;
  readonly minActiveMs: number;
  readonly maxActiveMs: number;
  readonly minPlausibleRtMs: number;
}

export interface ScoreContext {
  readonly modeId: string;
  readonly startLevel: number;
}

export const responseTimeSummarySchema = z.strictObject({
  medianMs: z.number().min(0),
  meanMs: z.number().min(0),
  p90Ms: z.number().min(0),
});
export type ResponseTimeSummary = z.infer<typeof responseTimeSummarySchema>;

/** What a game's trusted scoring derives from the raw trials. */
export interface ScoredResult<Metrics extends object> {
  readonly score: number;
  /** 0-1; null for games without right or wrong answers. */
  readonly accuracy: number | null;
  readonly responseTime: ResponseTimeSummary | null;
  /**
   * The highest level reached, replayed from the trials. Progress, records and
   * unlocks use this value; the session's own `peakLevel` is only a client
   * observation to check it against.
   */
  readonly peakLevel: number;
  readonly metrics: Metrics;
}

type NumericKeys<T> = { [K in keyof T]-?: T[K] extends number ? K : never }[keyof T] & string;

/**
 * A metric a record is kept for; higher is better. 'score' and 'peakLevel' come
 * from the scored result, and any other name is a numeric field of the game's
 * metrics.
 */
export type RecordMetric<Metrics extends object> = 'score' | 'peakLevel' | NumericKeys<Metrics>;

/** A record metric's name, as stored in `progress.bests` and `result.recordValues`. */
export const recordMetricNameSchema = z.string().max(40).regex(/^[A-Za-z][A-Za-z0-9]*$/);

/** A versioned, validated performance index. No game defines one in Stage 1. */
export interface PerformanceIndexDefinition<Trial> {
  readonly version: number;
  compute(trials: readonly Trial[], ctx: ScoreContext): number;
}

export interface GameDefinition<Trial, Metrics extends object> {
  /** Stable kebab-case game ID; never renamed or reused. */
  readonly id: string;
  /** Comparability version: bump when old scores stop being comparable. */
  readonly gameVersion: number;
  /** Bump whenever `score()` changes. */
  readonly scoringVersion: number;
  /** Product taxonomy, not a measurement. */
  readonly domainWeights: DomainWeights;
  readonly modes: readonly GameModeDefinition[];
  /** Validates one raw trial as the client observed it. */
  readonly trialSchema: z.ZodType<Trial>;
  /** Validates the game-specific summary metrics. */
  readonly metricsSchema: z.ZodType<Metrics>;
  readonly limits: GameLimits;
  /**
   * Pure and deterministic: the same trials and context always give the same
   * result, including the replayed `peakLevel`.
   */
  score(trials: readonly Trial[], ctx: ScoreContext): ScoredResult<Metrics>;
  /** Which record class a session competes in (Mental Math: `${modeId}:${startLevel}`). */
  recordKey(ctx: ScoreContext): string;
  readonly recordMetrics: readonly RecordMetric<Metrics>[];
  /** Absent until a formula is validated on real gameplay data. */
  readonly performanceIndex?: PerformanceIndexDefinition<Trial>;
}

/** A map key for `progress.bests`, e.g. 'endless:3'. */
export const recordKeySchema = z.string().max(64).regex(/^[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)*$/);

export function maxLevelOf(mode: GameModeDefinition): number {
  return Math.max(...mode.levels.map((level) => level.level));
}

export function findMode<Trial, Metrics extends object>(
  definition: GameDefinition<Trial, Metrics>,
  modeId: string,
): GameModeDefinition | undefined {
  return definition.modes.find((mode) => mode.id === modeId);
}

function isPositiveInt(value: number): boolean {
  return Number.isInteger(value) && value >= 1;
}

function modeProblems(mode: GameModeDefinition): string[] {
  const problems: string[] = [];
  if (!slugIdSchema.safeParse(mode.id).success) problems.push(`mode '${mode.id}': id must be kebab-case`);
  if (mode.levels.length === 0 || mode.levels.length > MAX_GAME_LEVEL) {
    problems.push(`mode '${mode.id}': must define 1-${MAX_GAME_LEVEL} levels`);
    return problems;
  }
  mode.levels.forEach((level, index) => {
    if (level.level !== index + 1) problems.push(`mode '${mode.id}': levels must be numbered 1..N in order`);
    if (level.label.trim().length === 0) problems.push(`mode '${mode.id}': level ${level.level} needs a label`);
  });
  const { initiallyUnlockedStartLevel: initial } = mode;
  if (!Number.isInteger(initial) || initial < 1 || initial > mode.levels.length) {
    problems.push(`mode '${mode.id}': initiallyUnlockedStartLevel must be a level of the mode`);
  }
  if (typeof mode.unlockPolicy !== 'function') {
    problems.push(`mode '${mode.id}': unlockPolicy is required`);
    return problems;
  }
  const maxLevel = mode.levels.length;
  for (let bestPeakLevel = 1; bestPeakLevel <= MAX_GAME_LEVEL; bestPeakLevel += 1) {
    const unlocked = mode.unlockPolicy({ bestPeakLevel, maxLevel });
    if (!Number.isInteger(unlocked) || mode.unlockPolicy({ bestPeakLevel, maxLevel }) !== unlocked) {
      problems.push(`mode '${mode.id}': unlockPolicy must return the same integer for bestPeakLevel ${bestPeakLevel}`);
      break;
    }
  }
  return problems;
}

/**
 * Checks a game definition's invariants and returns it unchanged. Every game
 * module exports `defineGame({...})`, so a broken catalogue fails at import
 * time rather than while scoring a session.
 */
export function defineGame<Trial, Metrics extends object>(
  definition: GameDefinition<Trial, Metrics>,
): GameDefinition<Trial, Metrics> {
  const problems: string[] = [];
  if (!slugIdSchema.safeParse(definition.id).success) problems.push('id must be kebab-case');
  if (!isPositiveInt(definition.gameVersion)) problems.push('gameVersion must be a positive integer');
  if (!isPositiveInt(definition.scoringVersion)) problems.push('scoringVersion must be a positive integer');

  const weights = domainWeightsSchema.safeParse(definition.domainWeights);
  if (!weights.success) problems.push(`domainWeights: ${z.prettifyError(weights.error)}`);

  if (definition.modes.length === 0) problems.push('at least one mode is required');
  const modeIds = definition.modes.map((mode) => mode.id);
  if (new Set(modeIds).size !== modeIds.length) problems.push('mode ids must be unique');
  for (const mode of definition.modes) problems.push(...modeProblems(mode));

  const { maxTrials, minActiveMs, maxActiveMs, minPlausibleRtMs } = definition.limits;
  if (!isPositiveInt(maxTrials) || maxTrials > MAX_TRIALS_PER_SESSION) {
    problems.push(`limits.maxTrials must be 1-${MAX_TRIALS_PER_SESSION}`);
  }
  if (!Number.isInteger(minActiveMs) || minActiveMs < 0 || !Number.isInteger(maxActiveMs)
    || maxActiveMs < minActiveMs || maxActiveMs > MAX_ACTIVE_DURATION_MS) {
    problems.push(`limits must satisfy 0 <= minActiveMs <= maxActiveMs <= ${MAX_ACTIVE_DURATION_MS}`);
  }
  if (!Number.isInteger(minPlausibleRtMs) || minPlausibleRtMs < 0) {
    problems.push('limits.minPlausibleRtMs must be a non-negative integer');
  }

  if (definition.recordMetrics.length === 0) problems.push('at least one record metric is required');
  if (new Set(definition.recordMetrics).size !== definition.recordMetrics.length) {
    problems.push('record metrics must be unique');
  }
  for (const metric of definition.recordMetrics) {
    if (!recordMetricNameSchema.safeParse(metric).success) {
      problems.push(`record metric '${metric}' must be letters and digits, starting with a letter (max 40)`);
    }
  }
  if (problems.length === 0) {
    for (const mode of definition.modes) {
      for (const { level } of mode.levels) {
        const key = definition.recordKey({ modeId: mode.id, startLevel: level });
        if (!recordKeySchema.safeParse(key).success) {
          problems.push(`recordKey for ${mode.id} at level ${level} is not a valid key: '${key}'`);
        }
      }
    }
  }

  if (definition.performanceIndex && !isPositiveInt(definition.performanceIndex.version)) {
    problems.push('performanceIndex.version must be a positive integer');
  }

  if (problems.length > 0) {
    throw new Error(`Invalid game definition '${definition.id}':\n  ${problems.join('\n  ')}`);
  }
  return definition;
}
