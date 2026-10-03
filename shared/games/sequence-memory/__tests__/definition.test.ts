import { describe, expect, it } from 'vitest';
import {
  defineGame,
  gameSessionSchemaFor,
  GAME_MODULE_REGISTRY,
  sequenceMemory,
  sequenceMemoryV1 as sm,
  sequenceMemoryV1Module,
  unlockedStartLevel,
} from '@nfct/shared';
import { fullRun } from './helpers';

describe('Sequence Memory v1 definition', () => {
  it('is accepted by defineGame with its permanent id and domain weights', () => {
    expect(defineGame(sm.definition)).toBe(sm.definition);
    expect(sm.definition).toMatchObject({
      id: 'sequence-memory',
      gameVersion: 1,
      scoringVersion: 1,
      domainWeights: { memory: 0.6, spatial: 0.4 },
      recordMetrics: ['score', 'longestSpan', 'peakLevel'],
    });
    expect(sm.definition.performanceIndex).toBeUndefined();
    expect(sequenceMemory.definition).toBe(sm.definition);
  });

  it('has one forward-recall mode with a fixed trial count and no run clock', () => {
    expect(sm.definition.modes).toHaveLength(1);
    const [mode] = sm.definition.modes;
    expect(mode).toMatchObject({ id: 'standard', adaptive: true, runDurationMs: null, initiallyUnlockedStartLevel: 1 });
    expect(mode!.maxRunDurationMs).toBe(sm.TRIALS_PER_RUN * sm.MAX_TRIAL_MS);
    expect(mode!.levels.map((level) => level.level)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(sm.definition.limits.maxTrials).toBe(sm.TRIALS_PER_RUN);
    expect(sm.definition.recordKey({ modeId: 'standard', startLevel: 4 })).toBe('standard:4');
  });

  it('unlocks start levels up to the best peak minus one, and the top once reached', () => {
    const [mode] = sm.definition.modes;
    const unlocked = (peak: number) => unlockedStartLevel(mode!, { bestPeakLevel: { standard: peak } });
    expect([1, 2, 5, 9, 10].map(unlocked)).toEqual([1, 1, 4, 8, 10]);
    expect(unlockedStartLevel(mode!, null)).toBe(1);
  });

  it('keeps every response within the trial schema bounds and a run within the shared caps', () => {
    for (const params of sm.LEVELS) {
      expect(params.presentationMs).toBeLessThanOrEqual(60_000);
      expect(params.responseLimitMs).toBeLessThanOrEqual(60_000);
      expect(params.gridSize).toBeLessThanOrEqual(8);
      expect(params.span).toBeLessThanOrEqual(16);
    }
    expect(sm.MAX_RUN_MS).toBeLessThan(3_600_000);
    expect(sm.TRIALS_PER_RUN).toBeLessThanOrEqual(400);
  });

  it('accepts an honest session through its session schema and the registry', () => {
    const run = fullRun();
    const trials = gameSessionSchemaFor(sm.definition).shape;
    expect(trials).toBeDefined();
    expect(GAME_MODULE_REGISTRY.find('sequence-memory', 1)).toBe(sequenceMemoryV1Module);
    expect(GAME_MODULE_REGISTRY.current('sequence-memory')).toBe(sequenceMemoryV1Module);
    expect(sm.trialSchema.array().safeParse(run.trials).success).toBe(true);
  });

  it('rejects unknown trial fields (the frozen v1 trial is strict)', () => {
    const [trial] = fullRun().trials;
    expect(sm.trialSchema.safeParse({ ...trial, eeg: 1 }).success).toBe(false);
  });
});
