import { defineGame, type GameModeDefinition } from '../../definition';
import { definition as v1, timed90 as v1Mode } from '../v1/definition';
import { MAX_TRIALS, MIN_PLAUSIBLE_RT_MS } from '../v1/params';
import { ACTIVE_DURATION_TOLERANCE_MS } from '../v1/plausibility';
import { metricsSchema, trialSchema, type MentalMathMetrics, type MentalMathTrial } from '../v1/schemas';
import { score } from '../v1/scoring';
import { MAX_RUN_MS } from './timeBank';

// Mental Math, gameVersion 2 (NFCT-60): the time-bank run. Everything but the
// run's length is gameVersion 1's: the levels, questions, staircase, trial and
// metrics shape, scoring (scoringVersion 1), the record classes and the unlock
// rule. The mode keeps the id 'timed-90', so unlocked start levels and records
// carry over from gameVersion 1 runs.

export const GAME_ID = v1.id;
export const GAME_VERSION = 2;
export const SCORING_VERSION = 1;
export { unlockPolicy } from '../v1/definition';

/** The one mode: no fixed length; a run ends when its time bank runs out, within MAX_RUN_MS. */
export const timeBankMode: GameModeDefinition = {
  ...v1Mode,
  runDurationMs: null,
  maxRunDurationMs: MAX_RUN_MS,
};

export const definition = defineGame<MentalMathTrial, MentalMathMetrics>({
  id: GAME_ID,
  gameVersion: GAME_VERSION,
  scoringVersion: SCORING_VERSION,
  domainWeights: v1.domainWeights,
  modes: [timeBankMode],
  trialSchema,
  metricsSchema,
  limits: {
    maxTrials: MAX_TRIALS,
    minActiveMs: 0,
    maxActiveMs: MAX_RUN_MS + ACTIVE_DURATION_TOLERANCE_MS,
    minPlausibleRtMs: MIN_PLAUSIBLE_RT_MS,
  },
  score,
  recordKey: v1.recordKey,
  recordMetrics: v1.recordMetrics,
});
