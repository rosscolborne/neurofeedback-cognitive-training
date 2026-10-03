import { defineGame, type GameModeDefinition, type UnlockContext } from '../../definition';
import {
  LEVELS,
  MAX_LEVEL,
  MAX_TRIALS,
  MIN_LEVEL,
  MIN_PLAUSIBLE_RT_MS,
  MODE_ID,
  ONE_STEP_REVIEW_WEIGHT,
  TWO_STEP_WEIGHT,
  TYPICAL_RUN_MS,
} from './params';
import { ACTIVE_DURATION_TOLERANCE_MS } from './plausibility';
import { matchesTemplate } from './questions';
import { metricsSchema, trialSchema, type MentalMathMetrics, type MentalMathTrial } from './schemas';
import { score } from './scoring';
import { MAX_RUN_MS } from './timeBank';

// Mental Math, gameVersion 1 and scoringVersion 1: the catalogue entry.

export const GAME_ID = 'mental-math';
export const GAME_VERSION = 1;
export const SCORING_VERSION = 1;

/**
 * v1 unlock rule, owned by the mode (ADR-001 decision 9): start levels up to
 * bestPeakLevel - 1, and the top level itself once it has actually been
 * reached. The shared unlockedStartLevel clamps the result to 1-10 and gives
 * level 1 when there is no valid progress.
 */
export function unlockPolicy({ bestPeakLevel, maxLevel }: UnlockContext): number {
  return bestPeakLevel >= maxLevel ? maxLevel : bestPeakLevel - 1;
}

/** Mental Math's own invariants on its level data, checked when the module loads. */
function assertLevelParams(): void {
  const problems: string[] = [];
  if (LEVELS.length !== MAX_LEVEL - MIN_LEVEL + 1) problems.push(`expected ${MAX_LEVEL} levels`);
  LEVELS.forEach((params, index) => {
    const at = `level ${params.level}`;
    if (params.level !== index + 1) problems.push(`${at}: levels must be numbered 1..10 in order`);
    const ids = params.templates.map((template) => template.id);
    if (new Set(ids).size !== ids.length) problems.push(`${at}: template ids must be unique`);
    if (!params.templates.some((template) => matchesTemplate(params.fallback, template))) {
      problems.push(`${at}: the fallback question must be legal for the level`);
    }
    for (const template of params.templates) {
      if (template.operands.length !== template.operators.length + 1) problems.push(`${at}: ${template.id} operand count`);
      if (template.grouped && template.operands.length !== 3) problems.push(`${at}: ${template.id} cannot be grouped`);
      if ((template.intermediate === null) !== (template.operands.length === 2)) {
        problems.push(`${at}: ${template.id} needs an intermediate range exactly when it has three operands`);
      }
    }
    if (params.level >= 7) {
      const twoStep = params.templates.filter((template) => template.operators.length === 2)
        .reduce((sum, template) => sum + template.weight, 0);
      const oneStep = params.templates.filter((template) => template.operators.length === 1)
        .reduce((sum, template) => sum + template.weight, 0);
      if (twoStep !== TWO_STEP_WEIGHT || oneStep !== ONE_STEP_REVIEW_WEIGHT) {
        problems.push(`${at}: two-step templates must weigh ${TWO_STEP_WEIGHT} and review templates ${ONE_STEP_REVIEW_WEIGHT}`);
      }
    }
  });
  if (problems.length > 0) throw new Error(`Invalid Mental Math v1 levels:\n  ${problems.join('\n  ')}`);
}
assertLevelParams();

export const timed90: GameModeDefinition = {
  id: MODE_ID,
  levels: LEVELS.map((params) => ({ level: params.level, label: `Level ${params.level}`, params })),
  adaptive: true,
  // Shown by the catalogue only; the time bank decides each run's length.
  runDurationMs: TYPICAL_RUN_MS,
  initiallyUnlockedStartLevel: 1,
  unlockPolicy,
};

export const definition = defineGame<MentalMathTrial, MentalMathMetrics>({
  id: GAME_ID,
  gameVersion: GAME_VERSION,
  scoringVersion: SCORING_VERSION,
  // Product taxonomy, not measurement. The memory share assumes levels 7-10 stay mostly two-step.
  domainWeights: { math: 0.7, 'processing-speed': 0.2, memory: 0.1 },
  modes: [timed90],
  trialSchema,
  metricsSchema,
  limits: {
    maxTrials: MAX_TRIALS,
    minActiveMs: 0,
    maxActiveMs: MAX_RUN_MS + ACTIVE_DURATION_TOLERANCE_MS,
    minPlausibleRtMs: MIN_PLAUSIBLE_RT_MS,
  },
  score,
  recordKey: ({ modeId, startLevel }) => `${modeId}:${startLevel}`,
  recordMetrics: ['score', 'correct', 'peakLevel'],
  // No performanceIndex until a formula is validated on real gameplay data (NFCT-26).
});
