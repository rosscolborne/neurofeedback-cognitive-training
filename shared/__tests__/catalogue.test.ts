import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  DOMAIN_CATALOG,
  defineGame,
  domainContributionsSchemaFor,
  domainWeightsSchema,
  domainWeightsSchemaFor,
  MAX_TRIALS_PER_SESSION,
  type GameDefinition,
} from '@nfct/shared';
import { fixtureGame, type FixtureMetrics } from './fixtures';

type FixtureDefinition = GameDefinition<{ level: number; correct: boolean; rtMs: number }, FixtureMetrics>;

describe('domain catalogue', () => {
  it('is version 1 with the six v1 domains', () => {
    expect(DOMAIN_CATALOG).toEqual({
      version: 1,
      domains: ['math', 'reasoning', 'memory', 'verbal', 'spatial', 'processing-speed'],
    });
  });

  it('files a game fractionally under several domains', () => {
    expect(domainWeightsSchema.safeParse({ math: 0.7, 'processing-speed': 0.2, memory: 0.1 }).success).toBe(true);
    expect(domainWeightsSchema.safeParse({ spatial: 1 }).success).toBe(true);
  });

  it('rejects weights that do not form a whole or name an unknown domain', () => {
    for (const weights of [{}, { math: 0.5 }, { math: 0.7, memory: 0.7 }, { math: 1.2, memory: -0.2 }, { attention: 1 }]) {
      expect(domainWeightsSchema.safeParse(weights).success).toBe(false);
    }
  });

  it('extends additively: v1 weights stay valid under a later catalogue', () => {
    const v2 = { version: 2, domains: [...DOMAIN_CATALOG.domains, 'attention'] } as const;
    const v2Weights = domainWeightsSchemaFor(v2);

    expect(v2Weights.safeParse({ math: 0.7, 'processing-speed': 0.2, memory: 0.1 }).success).toBe(true);
    expect(v2Weights.safeParse({ attention: 0.5, reasoning: 0.5 }).success).toBe(true);
  });

  it('lets an older build read contributions that name a domain it does not know', () => {
    const newer = { math: 0.5, attention: 0.3, memory: 0.2 };

    expect(domainContributionsSchemaFor('read').parse(newer)).toEqual({ math: 0.5, memory: 0.2 });
    expect(domainContributionsSchemaFor('write').safeParse(newer).success).toBe(false);
  });
});

describe('defineGame', () => {
  function variant(overrides: Partial<FixtureDefinition>): FixtureDefinition {
    return { ...fixtureGame, ...overrides };
  }

  it('accepts a well-formed definition without a performance index', () => {
    expect(defineGame(variant({}))).toBeDefined();
    expect(fixtureGame.performanceIndex).toBeUndefined();
    expect(fixtureGame.recordKey({ modeId: 'endless', startLevel: 3 })).toBe('endless:3');
  });

  it('accepts a versioned performance index', () => {
    expect(() => defineGame(variant({ performanceIndex: { version: 1, compute: () => 0 } }))).not.toThrow();
    expect(() => defineGame(variant({ performanceIndex: { version: 0, compute: () => 0 } }))).toThrow(/performanceIndex/);
  });

  it('rejects invalid taxonomy weights', () => {
    expect(() => defineGame(variant({ domainWeights: { math: 0.5 } }))).toThrow(/domainWeights/);
  });

  it('rejects levels that are not 1..N and unlock levels outside the mode', () => {
    const [endlessMode] = fixtureGame.modes;
    const gapped = { ...endlessMode!, levels: endlessMode!.levels.filter((level) => level.level !== 4) };

    expect(() => defineGame(variant({ modes: [gapped] }))).toThrow(/1\.\.N/);
    expect(() => defineGame(variant({ modes: [{ ...endlessMode!, initiallyUnlockedStartLevel: 9 }] })))
      .toThrow(/initiallyUnlockedStartLevel/);
    expect(() => defineGame(variant({ modes: [endlessMode!, endlessMode!] }))).toThrow(/unique/);
  });

  it('rejects limits beyond the envelope and malformed record keys', () => {
    expect(() => defineGame(variant({ limits: { ...fixtureGame.limits, maxTrials: MAX_TRIALS_PER_SESSION + 1 } })))
      .toThrow(/maxTrials/);
    expect(() => defineGame(variant({ recordKey: ({ modeId, startLevel }) => `${modeId} ${startLevel}` })))
      .toThrow(/recordKey/);
    expect(() => defineGame(variant({ recordMetrics: [] }))).toThrow(/record metric/);
  });

  it('rejects record metric names that progress cannot store', () => {
    const metricsSchema = z.strictObject({ correct_answers: z.int().min(0) });

    expect(() => defineGame({
      ...fixtureGame,
      metricsSchema,
      score: () => ({ score: 0, accuracy: null, responseTime: null, peakLevel: 1, metrics: { correct_answers: 0 } }),
      recordMetrics: ['score', 'correct_answers'],
    })).toThrow(/record metric 'correct_answers'/);
  });

  it('requires each mode\'s unlock policy to return an integer', () => {
    const [endlessMode] = fixtureGame.modes;

    expect(() => defineGame(variant({ modes: [{ ...endlessMode!, unlockPolicy: ({ bestPeakLevel }) => bestPeakLevel / 2 }] })))
      .toThrow(/unlockPolicy/);
  });

  it('accepts an optional run duration: absent or null for untimed modes, else a positive bounded integer', () => {
    const [endlessMode] = fixtureGame.modes;

    for (const runDurationMs of [undefined, null, 90_000, 3_600_000]) {
      expect(() => defineGame(variant({ modes: [{ ...endlessMode!, runDurationMs }] }))).not.toThrow();
    }
    for (const runDurationMs of [0, -1, 1.5, 3_600_001]) {
      expect(() => defineGame(variant({ modes: [{ ...endlessMode!, runDurationMs }] }))).toThrow(/runDurationMs/);
    }
  });
});
