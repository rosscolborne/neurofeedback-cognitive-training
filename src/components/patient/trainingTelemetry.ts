import type { EEGDataPoint } from '../../types';
import type { ProtocolRuntimeConfig } from '../../services/adaptiveEngine';
import { getRuntimeRewardDefinition } from '../../services/rewardDefinition';

/** Display only the measurement that the engine selected for this feedback frame. */
export function describeActiveReward(config: ProtocolRuntimeConfig, sample: EEGDataPoint | null) {
  const definition = getRuntimeRewardDefinition(config);
  const label = definition?.label ?? 'REWARD';

  const measured = sample?.activeRewardMetric?.value;
  if (!sample?.inZoneAvailable || measured == null || !Number.isFinite(measured)) {
    return { label, value: 'Unavailable' };
  }
  return { label, value: `${measured.toFixed(definition?.kind === 'ratio' ? 2 : 1)}${definition?.unit ?? ''}` };
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
