import { describe, expect, it } from 'vitest';
import type { EEGDataPoint, ProtocolType } from '../../../types';
import type { ProtocolRuntimeConfig } from '../../../services/adaptiveEngine';
import { describeActiveReward, describeBrainFlowScore } from '../trainingTelemetry';

const config = (protocol: ProtocolType, rewardBand?: ProtocolRuntimeConfig['rewardBand']): ProtocolRuntimeConfig => ({
  protocol, rewardBand, durationSeconds: 600, initialThreshold: 11, adaptiveStep: 0.5,
  lowerIsBetter: false, thresholdBounds: { min: 0, max: 1000 }, source: 'patient-override',
});
const sample = (
  value: number | null,
  source: NonNullable<EEGDataPoint['activeRewardMetric']>['source'],
  extra: Partial<EEGDataPoint> = {},
): EEGDataPoint => ({
  activeRewardMetric: { value, source }, inZoneAvailable: true, ...extra,
} as EEGDataPoint);

describe('training telemetry', () => {
  it('labels the runtime reward mode and formats the exact selected measurement in its actual units', () => {
    expect(describeActiveReward(config('theta-beta-ratio'), sample(0.36, 'brainflow')))
      .toEqual({ label: 'THETA/BETA', value: '0.36' });
    expect(describeActiveReward(config('smr-enhancement'), sample(12, 'brainflow')))
      .toEqual({ label: 'SMR (12–15 Hz)', value: '12.0 µV²' });
    expect(describeActiveReward(config('alpha-enhancement'), sample(12.2, 'browser-dsp')))
      .toEqual({ label: 'ALPHA (8–12 Hz)', value: '12.2 µV' });
    expect(describeActiveReward(config('alpha-enhancement'), sample(12.2, 'brainflow')))
      .toEqual({ label: 'ALPHA (8–13 Hz)', value: '12.2 µV²' });
    expect(describeActiveReward(config('beta-downtraining'), sample(13.5, 'demo')))
      .toEqual({ label: 'BETA (15–30 Hz)', value: '13.5 µV' });
    expect(describeActiveReward(config('beta-downtraining'), sample(13.5, 'brainflow')))
      .toEqual({ label: 'BETA (13–30 Hz)', value: '13.5 µV²' });
  });

  it('uses a clinician custom reward range and the emitted feedback metric, never the legacy band value', () => {
    const rewardBand = { name: 'Custom Reward', freqMin: 9, freqMax: 11, targetCondition: 'above' as const, targetThreshold: 6 };
    const data = sample(7.25, 'custom-raw', {
      bands: { delta: 1, theta: 2, alpha: 99, smr: 8, beta: 4, gamma: 1 },
      thetaBetaRatio: 0.5,
    });
    expect(describeActiveReward(config('alpha-enhancement', rewardBand), data))
      .toEqual({ label: 'REWARD (9–11 Hz)', value: '7.3 µV' });
    expect(describeActiveReward(config('alpha-enhancement', { ...rewardBand, freqMin: 16, freqMax: 18 }), sample(0.8, 'custom-raw')))
      .toEqual({ label: 'REWARD (16–18 Hz)', value: '0.8 µV' });
  });

  it('shows explicit unavailability without fabricating reward or classifier scores', () => {
    expect(describeActiveReward(config('smr-enhancement'), sample(null, 'brainflow')))
      .toEqual({ label: 'SMR (12–15 Hz)', value: 'Unavailable' });
    expect(describeActiveReward(config('alpha-enhancement'), sample(0, 'demo', { inZoneAvailable: false })).value)
      .toBe('Unavailable');
    const scores = { mindfulnessScore: 76, restfulnessScore: 81, method: 'brainflow_welch_psd' as const };
    expect(describeBrainFlowScore(sample(1, 'brainflow', { brainflowScores: scores }), 'mindfulnessScore', false)).toBe('76');
    expect(describeBrainFlowScore(sample(1, 'brainflow', { brainflowScores: scores }), 'restfulnessScore', false)).toBe('81');
    expect(describeBrainFlowScore(sample(1, 'demo', { brainflowScores: { ...scores, method: 'demo' } }), 'mindfulnessScore', true)).toBe('76');
    expect(describeBrainFlowScore(sample(1, 'demo', { brainflowScores: scores }), 'mindfulnessScore', true)).toBe('Unavailable');
    expect(describeBrainFlowScore(sample(1, 'browser-dsp', { brainflowScores: { ...scores, method: 'browser_dsp' } }), 'restfulnessScore', false)).toBe('Unavailable');
    expect(describeBrainFlowScore(sample(1, 'brainflow', { brainflowScores: { ...scores, mindfulnessScore: null } }), 'mindfulnessScore', false)).toBe('Unavailable');
  });
});
