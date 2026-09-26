import type { EEGDataPoint } from '../../types';
import type { ProtocolRuntimeConfig } from '../../services/adaptiveEngine';

export const DEFAULT_BETA_BAND_HZ = { demo: '15–30', brainflow: '13–30' } as const;

/** Display only the measurement that the engine selected for this feedback frame. */
export function describeActiveReward(config: ProtocolRuntimeConfig, sample: EEGDataPoint | null) {
  const source = sample?.activeRewardMetric?.source;
  const isBrainflow = source === 'brainflow';
  const label = config.rewardBand
    ? `REWARD (${config.rewardBand.freqMin}–${config.rewardBand.freqMax} Hz)`
    : config.protocol === 'theta-beta-ratio' ? 'THETA/BETA'
    : config.protocol === 'alpha-theta-crossover' ? 'THETA/ALPHA'
    : config.protocol === 'smr-enhancement' ? 'SMR (12–15 Hz)'
    : config.protocol === 'beta-downtraining' ? `BETA (${DEFAULT_BETA_BAND_HZ[isBrainflow ? 'brainflow' : 'demo']} Hz)`
    : `ALPHA (8–${isBrainflow ? '13' : '12'} Hz)`;

  const measured = sample?.activeRewardMetric?.value;
  if (!sample?.inZoneAvailable || measured == null || !Number.isFinite(measured)) {
    return { label, value: 'Unavailable' };
  }
  const isRatio = !config.rewardBand && (
    config.protocol === 'theta-beta-ratio' || config.protocol === 'alpha-theta-crossover'
  );
  const unit = isRatio ? '' : source === 'brainflow' ? ' µV²' : ' µV';
  return { label, value: `${measured.toFixed(isRatio ? 2 : 1)}${unit}` };
}

/** Live scores require BrainFlow; Demo scores are explicitly simulated. */
export function describeBrainFlowScore(
  sample: EEGDataPoint | null,
  metric: 'mindfulnessScore' | 'restfulnessScore',
  isDemo: boolean,
): string {
  const scores = sample?.brainflowScores;
  if (!scores || scores.method !== (isDemo ? 'demo' : 'brainflow_welch_psd')) return 'Unavailable';
  const value = scores[metric];
  return value != null && Number.isFinite(value) ? String(Math.round(value)) : 'Unavailable';
}
