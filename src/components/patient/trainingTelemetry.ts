import type { EEGDataPoint } from '../../types';

/** Live scores require BrainFlow; Demo scores are explicitly simulated. */
export function describeBrainFlowScore(
  sample: EEGDataPoint | null,
  metric: 'mindfulnessScore' | 'restfulnessScore',
  isDemo: boolean,
): string {
  const scores = sample?.brainflowScores;
  if (!scores || scores.method !== (isDemo ? 'demo' : 'brainflow')) return 'Unavailable';
  const value = scores[metric];
  return value != null && Number.isFinite(value) ? String(Math.round(value)) : 'Unavailable';
}
