import { defineGame, type GameModeDefinition, type UnlockContext } from '../../definition';
import { LEVELS, MAX_LEVEL, MAX_RUN_MS, MIN_LEVEL, MIN_PLAUSIBLE_TAP_MS, MODE_ID, TIMING_TOLERANCE_MS, TRIALS_PER_RUN } from './params';
import { metricsSchema, trialSchema, type SequenceMemoryMetrics, type SequenceMemoryTrial } from './schemas';
import { score } from './scoring';

// Sequence Memory, gameVersion 1 and scoringVersion 1: the catalogue entry
// (NFCT-93). The game ID and the domain weights are permanent.

export const GAME_ID = 'sequence-memory';
export const GAME_VERSION = 1;
export const SCORING_VERSION = 1;

/**
 * v1 unlock rule (Mental Math v1's shape): start levels up to
 * bestPeakLevel - 1, and the top level itself once it has actually been
 * reached. The shared unlockedStartLevel clamps the result and gives level 1
 * when there is no valid progress.
 */
export function unlockPolicy({ bestPeakLevel, maxLevel }: UnlockContext): number {
  return bestPeakLevel >= maxLevel ? maxLevel : bestPeakLevel - 1;
}

/** Sequence Memory's own invariants on its level data, checked when the module loads. */
function assertLevelParams(): void {
  const problems: string[] = [];
  if (LEVELS.length !== MAX_LEVEL - MIN_LEVEL + 1) problems.push(`expected ${MAX_LEVEL} levels`);
  LEVELS.forEach((params, index) => {
    const at = `level ${params.level}`;
    if (params.level !== index + 1) problems.push(`${at}: levels must be numbered 1..${MAX_LEVEL} in order`);
    if (params.span < 2 || params.span > params.gridSize * params.gridSize) problems.push(`${at}: span must fit the grid`);
    const previous = LEVELS[index - 1];
    if (previous && (params.span < previous.span || params.gridSize < previous.gridSize
      || params.span + params.gridSize <= previous.span + previous.gridSize)) {
      problems.push(`${at}: each level must be harder than the one before`);
    }
  });
  if (problems.length > 0) throw new Error(`Invalid Sequence Memory v1 levels:\n  ${problems.join('\n  ')}`);
}
assertLevelParams();

/** The one mode: forward recall, a fixed number of trials, no run clock. */
export const standard: GameModeDefinition = {
  id: MODE_ID,
  levels: LEVELS.map((params) => ({ level: params.level, label: `Level ${params.level}`, params })),
  adaptive: true,
  runDurationMs: null,
  maxRunDurationMs: MAX_RUN_MS,
  initiallyUnlockedStartLevel: 1,
  unlockPolicy,
};

export const definition = defineGame<SequenceMemoryTrial, SequenceMemoryMetrics>({
  id: GAME_ID,
  gameVersion: GAME_VERSION,
  scoringVersion: SCORING_VERSION,
  // Product taxonomy, not measurement (owner decision, NFCT-93).
  domainWeights: { memory: 0.6, spatial: 0.4 },
  modes: [standard],
  trialSchema,
  metricsSchema,
  limits: {
    maxTrials: TRIALS_PER_RUN,
    minActiveMs: 0,
    maxActiveMs: MAX_RUN_MS + TIMING_TOLERANCE_MS,
    minPlausibleRtMs: MIN_PLAUSIBLE_TAP_MS,
  },
  score,
  recordKey: ({ modeId, startLevel }) => `${modeId}:${startLevel}`,
  recordMetrics: ['score', 'longestSpan', 'peakLevel'],
  // No performanceIndex until a formula is validated on real gameplay data (NFCT-26).
});
