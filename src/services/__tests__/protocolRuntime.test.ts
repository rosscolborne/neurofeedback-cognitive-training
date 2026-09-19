import { describe, expect, it } from 'vitest';
import type { BandPowers, ClientProfile, MetricProvenance, ProtocolTemplate, ProtocolType } from '../../types';
import {
  AdaptiveDifficultyEngine,
  accumulateVerifiedBands,
  advanceSessionClock,
  createVerifiedBandAccumulator,
  evaluateProtocolFeedback,
  getCompletedSessionDuration,
  PROTOCOL_RUNTIME_LIMITATIONS,
  resolveProtocolRuntime,
  summarizeVerifiedBands,
} from '../adaptiveEngine';
import { EEGEngine } from '../eegEngine';
import { getClinicalProtocolTemplate } from '../clinicalProtocolTemplates';

const client = (assignedProtocol: ProtocolType = 'alpha-enhancement', override: Partial<ClientProfile> = {}): ClientProfile => ({
  id: 'patient-1', name: 'Patient', email: 'patient@example.com', avatarUrl: '',
  condition: 'Peak Performance', status: 'active', assignedProtocol,
  brainMaps: [], allowedExperiences: ['tidal-garden'], prescribedSessionsPerWeek: 3,
  completedSessionsCount: 0, currentStreak: 0, streakFreezeRemaining: 0,
  brainCapacityScore: 0, lastSessionDate: '', nextSessionDate: '',
  tidalGardenState: { stage: 0, plantsUnlocked: [], growthPoints: 0, lastWatered: '' },
  skylineBiomesUnlocked: [], badges: [], ...override,
});

const identicalCustom = (protocol: ProtocolType, override: Partial<ProtocolTemplate> = {}): ProtocolTemplate => ({
  ...getClinicalProtocolTemplate(protocol)!, id: `custom-${protocol}`, alias: 'Display only', version: 'patient-v1', ...override,
});

const bands: BandPowers = { delta: 0, theta: 4, alpha: 12, smr: 8, beta: 6, gamma: 3 };
const available = { delta: true, theta: true, alpha: true, smr: true, beta: true, gamma: true };
const brainflowProvenance: MetricProvenance = { algorithm: 'welch-psd', version: 'brainflow-service-v0.5', source: 'brainflow' };

const samples = (engine: AdaptiveDifficultyEngine, inZone: boolean) => {
  let result = { adjusted: false } as ReturnType<typeof engine.addSample>;
  for (let index = 0; index < 900; index++) result = engine.addSample(inZone);
  return result;
};

describe('protocol runtime assignment', () => {
  it.each<ProtocolType>(['theta-beta-ratio', 'alpha-theta-crossover', 'beta-downtraining'])(
    'keeps canonical and alias-only identical custom %s assignments semantically equivalent',
    protocol => {
      const canonical = resolveProtocolRuntime(client(protocol));
      const saved = resolveProtocolRuntime(client(protocol, { customProtocolConfig: identicalCustom(protocol, { alias: 'Renamed only' }) }));
      expect(canonical.ok && canonical.config).toMatchObject({ protocol, source: 'canonical-default' });
      expect(saved.ok && saved.config).toMatchObject({
        protocol,
        initialThreshold: canonical.ok ? canonical.config.initialThreshold : -1,
        durationSeconds: canonical.ok ? canonical.config.durationSeconds : -1,
        adaptiveStep: canonical.ok ? canonical.config.adaptiveStep : -1,
      });
    },
  );

  it('consumes canonical and persisted adaptive step, duration, and explicit threshold bounds', () => {
    const canonical = resolveProtocolRuntime(client('alpha-enhancement'));
    expect(canonical.ok && canonical.config).toMatchObject({
      initialThreshold: 11, adaptiveStep: 0.6, durationSeconds: 1500, thresholdBounds: { min: 0, max: 1000 },
    });
    const persisted = resolveProtocolRuntime(client('alpha-enhancement', {
      customProtocolConfig: identicalCustom('alpha-enhancement', { adaptiveStep: 0.25, sessionDurationMinutes: 20 }),
      customThresholdBounds: { min: 10, max: 12 },
    }));
    expect(persisted.ok && persisted.config).toMatchObject({
      initialThreshold: 11, adaptiveStep: 0.25, durationSeconds: 1200, thresholdBounds: { min: 10, max: 12 },
    });
  });

  it.each([
    ['sub-bin frequency edit', { freqMin: 9, freqMax: 11 }],
    ['overlap frequency edit', { freqMin: 8, freqMax: 15 }],
    ['unavailable 45-50 range', { freqMin: 45, freqMax: 50 }],
  ])('blocks unsupported %s instead of approximating PSD', (_label, range) => {
    const canonical = getClinicalProtocolTemplate('alpha-enhancement')!;
    const custom = identicalCustom('alpha-enhancement', { rewardBand: { ...canonical.rewardBand, ...range } });
    expect(resolveProtocolRuntime(client('alpha-enhancement', { customProtocolConfig: custom }))).toMatchObject({
      ok: false, error: expect.stringContaining('not supported'),
    });
  });

  it('blocks reward threshold/condition edits and invalid explicit bounds', () => {
    const canonical = getClinicalProtocolTemplate('alpha-enhancement')!;
    const changedThreshold = identicalCustom('alpha-enhancement', {
      rewardBand: { ...canonical.rewardBand, targetThreshold: canonical.rewardBand.targetThreshold + 1 },
    });
    expect(resolveProtocolRuntime(client('alpha-enhancement', { customProtocolConfig: changedThreshold }))).toMatchObject({ ok: false });
    expect(resolveProtocolRuntime(client('alpha-enhancement', { customThresholdBounds: { min: 12, max: 10 } }))).toMatchObject({ ok: false });
    expect(resolveProtocolRuntime(client('alpha-enhancement', { customThresholdBounds: { min: 12, max: 13 } }))).toMatchObject({ ok: false });
  });

  it('discloses every valid-session limitation explicitly', () => {
    for (const term of ['Reward-band', 'inhibit bands', 'montage', 'device mapping', 'sensitivity', 'clinical notes', 'rationale', 'recommended experiences', 'custom alias', 'unsupported']) {
      expect(PROTOCOL_RUNTIME_LIMITATIONS).toContain(term);
    }
  });

  it('uses one canonical evaluator for Demo and headset paths and preserves measured zero', () => {
    const config = resolveProtocolRuntime(client('theta-beta-ratio'));
    if (!config.ok) throw new Error(config.error);
    const demo = new EEGEngine();
    demo.configureProtocol(config.config);
    demo.isDemoMode = true;
    const headset = new EEGEngine();
    headset.configureProtocol(config.config);
    headset.isHardwareConnected = true;
    expect(demo.evaluateFeedbackForBands(bands, available)).toEqual(headset.evaluateFeedbackForBands(bands, available));
    expect(demo.evaluateFeedbackForBands(bands, available)).toEqual(evaluateProtocolFeedback('theta-beta-ratio', 1.85, bands, available));
    expect(evaluateProtocolFeedback('alpha-enhancement', 0, bands, available)).toMatchObject({ available: true, inZone: true });
    expect(evaluateProtocolFeedback('alpha-enhancement', 0, bands, { ...available, alpha: false })).toMatchObject({ available: false });
  });

  it('applies canonical step, lower/higher directions, easing, and explicit bounds in absolute units', () => {
    const alphaResolution = resolveProtocolRuntime(client('alpha-enhancement'));
    if (!alphaResolution.ok) throw new Error(alphaResolution.error);
    const alpha = new AdaptiveDifficultyEngine(alphaResolution.config.protocol, alphaResolution.config.initialThreshold, alphaResolution.config);
    expect(samples(alpha, true).log).toMatchObject({ direction: 'tightened', previousThreshold: 11, newThreshold: 11.6 });

    const tbrResolution = resolveProtocolRuntime(client('theta-beta-ratio', { customThresholdBounds: { min: 1.8, max: 1.9 } }));
    if (!tbrResolution.ok) throw new Error(tbrResolution.error);
    const tbrHarder = new AdaptiveDifficultyEngine(tbrResolution.config.protocol, tbrResolution.config.initialThreshold, tbrResolution.config);
    const tightened = samples(tbrHarder, true);
    expect(tightened.log).toMatchObject({ direction: 'tightened', previousThreshold: 1.85, newThreshold: 1.8 });
    expect(tightened.log?.reason).toContain('0.05 absolute units');
    const tbrEasier = new AdaptiveDifficultyEngine(tbrResolution.config.protocol, tbrResolution.config.initialThreshold, tbrResolution.config);
    expect(samples(tbrEasier, false).log).toMatchObject({ direction: 'eased', previousThreshold: 1.85, newThreshold: 1.9 });
  });

  it('records provenance only when every sample is complete, real, and consistent', () => {
    const valid = createVerifiedBandAccumulator();
    accumulateVerifiedBands(valid, bands, available, brainflowProvenance);
    expect(summarizeVerifiedBands(valid)).toEqual({ bands, provenance: brainflowProvenance });
    const missing = createVerifiedBandAccumulator();
    accumulateVerifiedBands(missing, bands, { ...available, smr: false }, brainflowProvenance);
    expect(summarizeVerifiedBands(missing).provenance).toBeUndefined();
    const unproven = createVerifiedBandAccumulator();
    accumulateVerifiedBands(unproven, bands, available, null);
    expect(summarizeVerifiedBands(unproven).provenance).toBeUndefined();
    const mixed = createVerifiedBandAccumulator();
    accumulateVerifiedBands(mixed, bands, available, brainflowProvenance);
    accumulateVerifiedBands(mixed, bands, available, { algorithm: 'browser-band-dft', version: '1', source: 'browser-dsp' });
    expect(summarizeVerifiedBands(mixed).provenance).toBeUndefined();
  });

  it('completes a one-minute session on tick 60 with an exact 60-second saved duration', () => {
    let elapsed = 0;
    let phase: ReturnType<typeof advanceSessionClock>['phase'] = 'training';
    while (phase !== 'complete') ({ elapsed, phase } = advanceSessionClock(elapsed, 60, true));
    expect(elapsed).toBe(60);
    expect(phase).toBe('complete');
    expect(getCompletedSessionDuration(elapsed, 59)).toBe(60);
  });
});
