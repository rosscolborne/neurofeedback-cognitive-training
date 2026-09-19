import { describe, expect, it } from 'vitest';
import type { BandPowers, ClientProfile, ProtocolTemplate } from '../../types';
import {
  AdaptiveDifficultyEngine,
  calculateRewardBandMetric,
  getSessionPhaseAtElapsed,
  resolveProtocolRuntime,
} from '../adaptiveEngine';
import { EEGEngine } from '../eegEngine';
import { getClinicalProtocolTemplate } from '../clinicalProtocolTemplates';

const client = (override: Partial<ClientProfile> = {}): ClientProfile => ({
  id: 'patient-1', name: 'Patient', email: 'patient@example.com', avatarUrl: '',
  condition: 'Peak Performance', status: 'active', assignedProtocol: 'alpha-enhancement',
  brainMaps: [], allowedExperiences: ['tidal-garden'], prescribedSessionsPerWeek: 3,
  completedSessionsCount: 0, currentStreak: 0, streakFreezeRemaining: 0,
  brainCapacityScore: 0, lastSessionDate: '', nextSessionDate: '',
  tidalGardenState: { stage: 0, plantsUnlocked: [], growthPoints: 0, lastWatered: '' },
  skylineBiomesUnlocked: [], badges: [], ...override,
});

const custom = (override: Partial<ProtocolTemplate> = {}): ProtocolTemplate => ({
  ...getClinicalProtocolTemplate('alpha-enhancement')!,
  id: 'custom-1', alias: 'Display only', version: 'patient-v1',
  rewardBand: { name: 'Custom reward', freqMin: 8, freqMax: 12, targetCondition: 'above', targetThreshold: 10 },
  sessionDurationMinutes: 20,
  ...override,
});

const bands: BandPowers = { delta: 2, theta: 4, alpha: 12, smr: 8, beta: 6, gamma: 3 };
const available = { delta: true, theta: true, alpha: true, smr: true, beta: true, gamma: true };

describe('protocol runtime assignment', () => {
  it('uses canonical defaults only for a legacy assignment with no persisted custom settings', () => {
    expect(resolveProtocolRuntime(client())).toEqual({
      ok: true,
      config: {
        protocol: 'alpha-enhancement', durationSeconds: 1500, initialThreshold: 11,
        adaptiveStep: 0.6, source: 'canonical-default',
      },
    });
  });

  it('consumes persisted threshold and duration while ignoring the alias', () => {
    const first = resolveProtocolRuntime(client({ customProtocolConfig: custom({ alias: 'Calm label' }) }));
    const second = resolveProtocolRuntime(client({ customProtocolConfig: custom({ alias: 'Focus label' }) }));
    expect(first).toEqual(second);
    expect(first.ok && first.config.initialThreshold).toBe(10);
    expect(first.ok && first.config.durationSeconds).toBe(1200);
  });

  it.each([
    ['reversed frequencies', custom({ rewardBand: { name: 'bad', freqMin: 20, freqMax: 10, targetCondition: 'above', targetThreshold: 2 } })],
    ['non-finite threshold', custom({ rewardBand: { name: 'bad', freqMin: 8, freqMax: 12, targetCondition: 'above', targetThreshold: Number.NaN } })],
    ['unsupported duration', custom({ sessionDurationMinutes: 0 })],
  ])('fails safely for %s', (_label, config) => {
    expect(resolveProtocolRuntime(client({ customProtocolConfig: config }))).toMatchObject({ ok: false });
  });

  it('uses both reward range boundaries and requires source-band availability', () => {
    const alphaOnly = { freqMin: 8, freqMax: 12, targetCondition: 'above' as const, targetThreshold: 10 };
    const alphaAndSmr = { ...alphaOnly, freqMax: 15 };
    const thetaAndAlpha = { ...alphaOnly, freqMin: 4 };
    expect(calculateRewardBandMetric(bands, available, alphaOnly)).toBe(12);
    expect(calculateRewardBandMetric(bands, available, alphaAndSmr)).toBeCloseTo((12 * 4 + 8 * 3) / 7);
    expect(calculateRewardBandMetric(bands, available, thetaAndAlpha)).toBe(8);
    expect(calculateRewardBandMetric(bands, { ...available, alpha: false }, alphaOnly)).toBeNull();
  });

  it('applies the same custom reward calculation to configured engine feedback independent of transport', () => {
    const resolution = resolveProtocolRuntime(client({ customProtocolConfig: custom() }));
    if (!resolution.ok) throw new Error(resolution.error);
    const engine = new EEGEngine();
    engine.configureProtocol(resolution.config);
    const calculate = (engine as unknown as { calculateBrowserFeedback: Function }).calculateBrowserFeedback.bind(engine);
    expect(calculate(bands, bands.theta / bands.beta, available)).toMatchObject({ inZone: true, available: true });
    engine.setThreshold(13);
    expect(calculate(bands, bands.theta / bands.beta, available)).toMatchObject({ inZone: false, available: true });
  });

  it('uses persisted adaptive direction and step at the threshold boundary', () => {
    const resolution = resolveProtocolRuntime(client({ customProtocolConfig: custom({ adaptiveStep: 0.25 }) }));
    if (!resolution.ok) throw new Error(resolution.error);
    const engine = new AdaptiveDifficultyEngine(resolution.config.protocol, resolution.config.initialThreshold, resolution.config);
    let result = { adjusted: false } as ReturnType<typeof engine.addSample>;
    for (let index = 0; index < 900; index++) result = engine.addSample(true);
    expect(result.log).toMatchObject({ direction: 'tightened', previousThreshold: 10, newThreshold: 10.25 });
  });

  it('drives phase timing and completion from assigned duration for headset and Demo sessions', () => {
    expect(getSessionPhaseAtElapsed(59, 600, false)).toBe('warmup');
    expect(getSessionPhaseAtElapsed(527, 600, false)).toBe('training');
    expect(getSessionPhaseAtElapsed(528, 600, false)).toBe('cooldown');
    expect(getSessionPhaseAtElapsed(599, 600, false)).toBe('debrief');
    expect(getSessionPhaseAtElapsed(599, 600, true)).toBe('training');
    expect(getSessionPhaseAtElapsed(600, 600, false)).toBe('complete');
    expect(getSessionPhaseAtElapsed(600, 600, true)).toBe('complete');
  });
});
