import { describe, expect, it, vi } from 'vitest';
import type { BandPowers, ClientProfile, EEGDataPoint, MetricProvenance, ProtocolTemplate, ProtocolType } from '../../types';
import {
  AdaptiveDifficultyEngine,
  accumulateVerifiedBands,
  advanceSessionClock,
  assessSessionCompletionReadiness,
  createSessionCompletionId,
  createVerifiedBandAccumulator,
  evaluateProtocolFeedback,
  getCompletedSessionDuration,
  PROTOCOL_RUNTIME_LIMITATIONS,
  resolveProtocolRuntime,
  summarizeVerifiedBands,
} from '../adaptiveEngine';
import { EEGEngine } from '../eegEngine';
import { getClinicalProtocolTemplate } from '../clinicalProtocolTemplates';
import { calculateRewardAmplitudeUv } from '../rewardSpectrum';
import { DEFAULT_BETA_AMPLITUDE_REWARD_BAND, DEFAULT_PROTOCOL, resolvePatientProtocol } from '../protocols';

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
  it('rewards default beta values at or below 14 and rejects values above 14', () => {
    const resolved = resolveProtocolRuntime(client('beta-downtraining'));
    if (!resolved.ok) throw new Error(resolved.error);
    expect(resolved.config).toMatchObject({ initialThreshold: 14, lowerIsBetter: true });
    expect(resolved.config.rewardBand).toBeUndefined();
    for (const [beta, inZone] of [[13.9, true], [14, true], [14.1, false]] as const) {
      expect(evaluateProtocolFeedback('beta-downtraining', resolved.config.initialThreshold, bands, available, DEFAULT_BETA_AMPLITUDE_REWARD_BAND, beta, 5))
        .toMatchObject({ metric: beta, inZone, available: true });
    }
    expect(evaluateProtocolFeedback('beta-downtraining', 14, bands, available)).toMatchObject({ available: false });
  });

  it('uses raw 13–30 Hz amplitude for headset beta feedback even when backend band power disagrees', () => {
    const resolution = resolveProtocolRuntime(client('beta-downtraining'));
    if (!resolution.ok) throw new Error(resolution.error);
    const engine = new EEGEngine();
    engine.configureProtocol(resolution.config);
    engine.isHardwareConnected = true;
    const internal = engine as unknown as {
      rawBuffers: Record<'tp9' | 'af7' | 'af8' | 'tp10', number[]>;
      sourceFrameSequence: number;
      lastSourceFrameAtMs: number;
      latestServerBands: BandPowers;
      latestServerBandAvailability: typeof available;
      latestBandPowerProvenance: MetricProvenance;
      latestTrainingFeedback: { ratio: number; metric: number; inZone: boolean; zoneScore: number; source: 'brainflow' };
      generateSample: (dt: number) => EEGDataPoint;
    };
    const wave = (amplitude: number) => Array.from({ length: 512 }, (_, index) =>
      amplitude * Math.sin(2 * Math.PI * 17 * index / 256));
    internal.rawBuffers = { tp9: wave(12), af7: wave(12), af8: wave(12), tp10: wave(12) };
    internal.sourceFrameSequence = 1;
    internal.lastSourceFrameAtMs = Date.now();
    internal.latestServerBands = { ...bands, beta: 100 };
    internal.latestServerBandAvailability = available;
    internal.latestBandPowerProvenance = brainflowProvenance;
    internal.latestTrainingFeedback = { ratio: 0, metric: 100, inZone: false, zoneScore: 0, source: 'brainflow' };
    expect(internal.generateSample(0.1)).toMatchObject({
      inZoneAvailable: true, inZone: true,
      activeRewardMetric: { value: expect.closeTo(12, 0), source: 'browser-dsp' },
    });
    internal.rawBuffers = { tp9: wave(16), af7: wave(16), af8: wave(16), tp10: wave(16) };
    internal.sourceFrameSequence = 2;
    internal.lastSourceFrameAtMs = Date.now();
    internal.latestTrainingFeedback = { ratio: 0, metric: 0, inZone: true, zoneScore: 1, source: 'brainflow' };
    expect(internal.generateSample(0.1)).toMatchObject({
      inZoneAvailable: true, inZone: false,
      activeRewardMetric: { value: expect.closeTo(16, 0), source: 'browser-dsp' },
    });
  });

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

  it('uses selected raw EEG frequencies, condition, and threshold for feedback and adaptation', () => {
    const canonical = getClinicalProtocolTemplate('alpha-enhancement')!;
    const raw = Array.from({ length: 512 }, (_, index) => 12 * Math.sin(2 * Math.PI * 10 * index / 256));
    const check = (reward: Partial<ProtocolTemplate['rewardBand']>) => {
      const custom = identicalCustom('alpha-enhancement', {
        customRewardEnabled: true,
        rewardBand: { ...canonical.rewardBand, freqMin: 9, freqMax: 11, targetThreshold: 6, ...reward },
      });
      const resolved = resolveProtocolRuntime(client('alpha-enhancement', { customProtocolConfig: custom }));
      if (!resolved.ok) throw new Error(resolved.error);
      const measured = calculateRewardAmplitudeUv([raw, raw, raw, raw], 256, custom.rewardBand);
      const eeg = new EEGEngine();
      eeg.configureProtocol(resolved.config);
      return { result: eeg.evaluateFeedbackForBands(bands, available, measured), config: resolved.config };
    };
    expect(check({ freqMin: 9, freqMax: 11 }).result).toMatchObject({ available: true, inZone: true });
    expect(check({ freqMin: 16, freqMax: 18 }).result).toMatchObject({ available: true, inZone: false });
    expect(check({ targetCondition: 'below' }).result).toMatchObject({ available: true, inZone: false });
    expect(check({ targetThreshold: 13 }).result).toMatchObject({ available: true, inZone: false });
    const below = check({ targetCondition: 'below' }).config;
    expect(below).toMatchObject({ initialThreshold: 6, lowerIsBetter: true });
    const adaptive = new AdaptiveDifficultyEngine(below.protocol, below.initialThreshold, below);
    expect(samples(adaptive, true).log).toMatchObject({ direction: 'tightened', previousThreshold: 6, newThreshold: 5.4 });
  });

  it('publishes custom reward feedback instead of the server broad-mode decision', () => {
    const template = identicalCustom('alpha-enhancement', {
      customRewardEnabled: true,
      rewardBand: {
        ...getClinicalProtocolTemplate('alpha-enhancement')!.rewardBand,
        freqMin: 9, freqMax: 11, targetCondition: 'above', targetThreshold: 6,
      },
    });
    const resolution = resolveProtocolRuntime(client('alpha-enhancement', { customProtocolConfig: template }));
    if (!resolution.ok) throw new Error(resolution.error);
    const engine = new EEGEngine();
    engine.configureProtocol(resolution.config);
    engine.isHardwareConnected = true;
    const raw = Array.from({ length: 512 }, (_, index) => 12 * Math.sin(2 * Math.PI * 10 * index / 256));
    const internal = engine as unknown as {
      rawBuffers: Record<'tp9' | 'af7' | 'af8' | 'tp10', number[]>;
      sourceFrameSequence: number;
      lastSourceFrameAtMs: number;
      latestServerBands: BandPowers;
      latestServerBandAvailability: typeof available;
      latestBandPowerProvenance: MetricProvenance;
      latestTrainingFeedback: { ratio: number; inZone: boolean; zoneScore: number };
      generateSample: (dt: number) => EEGDataPoint;
    };
    internal.rawBuffers = { tp9: raw, af7: raw, af8: raw, tp10: raw };
    internal.sourceFrameSequence = 1;
    internal.lastSourceFrameAtMs = Date.now();
    internal.latestServerBands = bands;
    internal.latestServerBandAvailability = available;
    internal.latestBandPowerProvenance = brainflowProvenance;
    internal.latestTrainingFeedback = { ratio: 0, inZone: false, zoneScore: 0 };
    expect(internal.generateSample(0.1)).toMatchObject({
      inZoneAvailable: true, inZone: true,
      activeRewardMetric: { value: expect.closeTo(12, 0), source: 'custom-raw' },
    });
    internal.sourceFrameSequence = 2;
    internal.rawBuffers = Object.fromEntries(
      Object.keys(internal.rawBuffers).map(key => [key, raw.map(value => value / 4)]),
    ) as typeof internal.rawBuffers;
    internal.latestTrainingFeedback = { ratio: 0, inZone: true, zoneScore: 1 };
    expect(internal.generateSample(0.1)).toMatchObject({
      inZoneAvailable: true, inZone: false,
      activeRewardMetric: { value: expect.closeTo(3, 0), source: 'custom-raw' },
    });
  });

  it('publishes the server primary metric from the same feedback result, not a band approximation', () => {
    const resolved = resolveProtocolRuntime(client('alpha-enhancement'));
    if (!resolved.ok) throw new Error(resolved.error);
    const eeg = new EEGEngine();
    eeg.configureProtocol(resolved.config);
    eeg.isHardwareConnected = true;
    const internal = eeg as unknown as {
      latestServerBands: BandPowers;
      latestServerBandAvailability: typeof available;
      latestBandPowerProvenance: MetricProvenance;
      latestTrainingFeedback: {
        ratio: number; metric: number; inZone: boolean; zoneScore: number; source: 'brainflow';
      };
      generateSample: (dt: number) => EEGDataPoint;
    };
    internal.latestServerBands = { ...bands, alpha: 25 };
    internal.latestServerBandAvailability = available;
    internal.latestBandPowerProvenance = brainflowProvenance;
    internal.latestTrainingFeedback = { ratio: 0.6, metric: 12.34, inZone: true, zoneScore: 0.7, source: 'brainflow' };
    const sample = internal.generateSample(0.1);
    expect(sample).toMatchObject({
      inZone: true, inZoneAvailable: true, activeRewardMetric: { value: 12.34, source: 'brainflow' },
    });
    expect(sample.activeRewardMetric?.value).not.toBe(sample.bands.alpha);
  });

  it('does not fabricate classifier scores for browser DSP or replace a high BrainFlow score', () => {
    const eeg = new EEGEngine();
    const internal = eeg as unknown as {
      latestServerRatios: Record<string, number>;
      latestBrainFlowScores: EEGDataPoint['brainflowScores'];
      latestRawMetrics: Record<string, number>;
      latestServerBands: BandPowers;
      latestServerBandAvailability: typeof available;
      updateBrowserDerivedMetrics: () => void;
      generateSample: (dt: number) => EEGDataPoint;
    };
    internal.latestServerRatios = { valence: 1.2, arousal: 0.8 };
    internal.updateBrowserDerivedMetrics();
    expect(internal.latestBrainFlowScores).toMatchObject({
      method: 'browser_dsp', mindfulnessScore: null, restfulnessScore: null,
    });
    expect(internal.latestRawMetrics).not.toHaveProperty('mindfulness');
    expect(internal.latestRawMetrics).not.toHaveProperty('restfulness');

    eeg.isHardwareConnected = true;
    internal.latestServerBands = bands;
    internal.latestServerBandAvailability = available;
    internal.latestBrainFlowScores = {
      method: 'brainflow_welch_psd', mindfulnessScore: 99, restfulnessScore: null,
      valence: 0.5, arousal: 0.5,
    };
    expect(internal.generateSample(0.1).brainflowScores).toMatchObject({
      mindfulnessScore: 99, restfulnessScore: null,
    });
  });

  it('converts raw ADC-offset windows to µV before custom reward comparison', () => {
    const reward = { freqMin: 9, freqMax: 11 };
    const microvolts = Array.from({ length: 512 }, (_, index) => 12 * Math.sin(2 * Math.PI * 10 * index / 256));
    const adc = microvolts.map(value => 400 + value / 0.48828);
    expect(calculateRewardAmplitudeUv([adc], 256, reward)).toBeCloseTo(
      calculateRewardAmplitudeUv([microvolts], 256, reward)!, 4,
    );
  });

  it('rejects malformed persisted reward definitions and invalid explicit bounds', () => {
    const canonical = getClinicalProtocolTemplate('alpha-enhancement')!;
    for (const change of [
      { freqMin: 45, freqMax: 50 },
      { freqMin: 9, freqMax: 9 },
      { targetCondition: 'equal' },
      { targetThreshold: Number.NaN },
      { targetThreshold: 6.123 },
    ]) {
      const custom = identicalCustom('alpha-enhancement', {
        customRewardEnabled: true,
        rewardBand: { ...canonical.rewardBand, ...change } as ProtocolTemplate['rewardBand'],
      });
      expect(resolveProtocolRuntime(client('alpha-enhancement', { customProtocolConfig: custom }))).toMatchObject({ ok: false });
    }
    expect(resolveProtocolRuntime(client('alpha-enhancement', { customThresholdBounds: { min: 12, max: 10 } }))).toMatchObject({ ok: false });
    expect(resolveProtocolRuntime(client('alpha-enhancement', { customThresholdBounds: { min: 12, max: 13 } }))).toMatchObject({ ok: false });
  });

  it('resolves one default and lets an explicit custom assignment override it', () => {
    const blank = client('theta-beta-ratio', { assignedProtocol: undefined });
    expect(resolvePatientProtocol(blank)).toBe(DEFAULT_PROTOCOL);
    expect(resolveProtocolRuntime(blank)).toMatchObject({ ok: true, config: { protocol: DEFAULT_PROTOCOL } });
    const custom = identicalCustom('alpha-enhancement');
    const assigned = { ...blank, customProtocolConfig: custom };
    expect(resolvePatientProtocol(assigned)).toBe('alpha-enhancement');
    expect(resolveProtocolRuntime(assigned)).toMatchObject({ ok: true, config: { protocol: 'alpha-enhancement' } });
  });

  it('rejects sub-cent adaptive precision and accepts an exact 0.01 step without log divergence', () => {
    const tooFine = resolveProtocolRuntime(client('alpha-enhancement', {
      customProtocolConfig: identicalCustom('alpha-enhancement', { adaptiveStep: 0.004 }),
    }));
    expect(tooFine).toMatchObject({ ok: false, error: expect.stringContaining('0.01') });

    const accepted = resolveProtocolRuntime(client('alpha-enhancement', {
      customProtocolConfig: identicalCustom('alpha-enhancement', { adaptiveStep: 0.01 }),
    }));
    if (!accepted.ok) throw new Error(accepted.error);
    const engine = new AdaptiveDifficultyEngine(accepted.config.protocol, accepted.config.initialThreshold, accepted.config);
    const adjustment = samples(engine, true);
    expect(adjustment.log).toMatchObject({ previousThreshold: 11, newThreshold: 11.01 });
    expect(engine.getCurrentThreshold()).toBe(11.01);
  });

  it('discloses every valid-session limitation explicitly', () => {
    for (const term of ['reward frequency', 'inhibit bands', 'montage', 'device mapping', 'sensitivity', 'clinical notes', 'rationale', 'recommended experiences', 'custom alias']) {
      expect(PROTOCOL_RUNTIME_LIMITATIONS.toLowerCase()).toContain(term);
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
    expect(evaluateProtocolFeedback('alpha-enhancement', 0, bands, { ...available, alpha: false })).toMatchObject({ available: false, metric: null });
    const demoSample = (demo as unknown as { generateSample: (dt: number) => EEGDataPoint }).generateSample(0.1);
    const evaluated = demo.evaluateFeedbackForBands(demoSample.bands, demoSample.bandAvailability);
    expect(demoSample.activeRewardMetric).toEqual({ value: evaluated.metric, source: 'demo' });
    expect(demoSample.inZone).toBe(evaluated.inZone);
  });

  it('keeps missing production SMR unavailable without alpha/beta proxy reward or display', () => {
    const resolution = resolveProtocolRuntime(client('smr-enhancement'));
    if (!resolution.ok) throw new Error(resolution.error);
    const engine = new EEGEngine();
    engine.configureProtocol(resolution.config);
    engine.isHardwareConnected = true;
    const internal = engine as unknown as {
      latestServerBands: BandPowers;
      latestServerBandAvailability: Partial<Record<keyof BandPowers, boolean>>;
      latestTrainingFeedback: { ratio: number; inZone: boolean; zoneScore: number };
      generateSample: (dt: number) => { bands: BandPowers; bandAvailability: Partial<Record<keyof BandPowers, boolean>>; inZone: boolean; inZoneAvailable: boolean };
    };
    internal.latestServerBands = { ...bands, smr: 0 };
    internal.latestServerBandAvailability = { ...available, smr: false };
    internal.latestTrainingFeedback = { ratio: bands.theta / bands.beta, inZone: true, zoneScore: 1 };
    const sample = internal.generateSample(0.1);
    expect(sample.bands.smr).toBe(0);
    expect(sample.bandAvailability.smr).toBe(false);
    expect(sample.inZoneAvailable).toBe(false);
    expect(sample.inZone).toBe(false);
  });

  it('keeps missing non-Demo EEG visibly unavailable and never switches to synthetic acquisition', () => {
    const resolution = resolveProtocolRuntime(client('alpha-enhancement'));
    if (!resolution.ok) throw new Error(resolution.error);
    const engine = new EEGEngine();
    engine.configureProtocol(resolution.config);
    engine.isHardwareConnected = true;
    engine.isDemoMode = false;
    const sample = (engine as unknown as { generateSample: (dt: number) => {
      bands: BandPowers; bandAvailability: Partial<Record<keyof BandPowers, boolean>>;
      inZone: boolean; inZoneAvailable: boolean;
    } }).generateSample(0.1);

    expect(engine.isDemoMode).toBe(false);
    expect(sample.bandAvailability).toEqual({});
    expect(sample.bands).toEqual({ delta: 0, theta: 0, alpha: 0, smr: 0, beta: 0, gamma: 0 });
    expect(sample.inZoneAvailable).toBe(false);
    expect(sample.inZone).toBe(false);
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
    expect(summarizeVerifiedBands(missing)).toEqual({});
    const unproven = createVerifiedBandAccumulator();
    accumulateVerifiedBands(unproven, bands, available, null);
    expect(summarizeVerifiedBands(unproven).provenance).toBeUndefined();
    const mixed = createVerifiedBandAccumulator();
    accumulateVerifiedBands(mixed, bands, available, brainflowProvenance);
    accumulateVerifiedBands(mixed, bands, available, { algorithm: 'browser-band-dft', version: '1', source: 'browser-dsp' });
    expect(summarizeVerifiedBands(mixed).provenance).toBeUndefined();
  });

  it('requires secure stable completion IDs and adequate verified hardware coverage', () => {
    const id = createSessionCompletionId();
    expect(id).toMatch(/^sess-[0-9a-f-]{36}$/i);
    expect(assessSessionCompletionReadiness({
      isDemo: false, elapsedSeconds: 10, verifiedSeconds: 7, verifiedBandSamples: 70, hardwareConnected: true,
      sourceFresh: true,
    })).toMatchObject({ ok: false });
    expect(assessSessionCompletionReadiness({
      isDemo: false, elapsedSeconds: 10, verifiedSeconds: 8, verifiedBandSamples: 1, hardwareConnected: true,
      sourceFresh: true,
    })).toEqual({ ok: true });
    expect(assessSessionCompletionReadiness({
      isDemo: false, elapsedSeconds: 10, verifiedSeconds: 10, verifiedBandSamples: 10, hardwareConnected: false,
      sourceFresh: true,
    })).toMatchObject({ ok: false, error: expect.stringContaining('disconnected') });
    expect(assessSessionCompletionReadiness({
      isDemo: true, elapsedSeconds: 0, verifiedSeconds: 0, verifiedBandSamples: 0, hardwareConnected: false,
      sourceFresh: false,
    })).toEqual({ ok: true });
    expect(assessSessionCompletionReadiness({
      isDemo: false, elapsedSeconds: 10, verifiedSeconds: 10, verifiedBandSamples: 10, hardwareConnected: true,
      sourceFresh: false,
    })).toMatchObject({ ok: false, error: expect.stringContaining('stopped') });
  });

  it('exposes monotonic source-frame evidence independently of the UI publish timer', () => {
    vi.useFakeTimers();
    try {
      const engine = new EEGEngine();
      expect(engine.getHardwareSourceState()).toEqual({ sequence: 0, lastFrameAtMs: 0 });
      const stop = engine.simulateMuseBluetoothPackets(0);
      vi.advanceTimersByTime(47);
      const first = engine.getHardwareSourceState();
      expect(first.sequence).toBeGreaterThan(0);
      expect(first.lastFrameAtMs).toBe(Date.now());
      vi.advanceTimersByTime(47);
      expect(engine.getHardwareSourceState().sequence).toBeGreaterThan(first.sequence);
      stop();
    } finally {
      vi.useRealTimers();
    }
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
