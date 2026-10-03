import { describe, expect, it } from 'vitest';
import type { BrainFlowScores, EEGDataPoint } from '../../../types';
import { describeBrainFlowScore } from '../trainingTelemetry';

const sample = (brainflowScores?: BrainFlowScores): EEGDataPoint => ({
  timestamp: 1,
  signalQuality: 'good',
  channelQuality: { tp9: 'good', af7: 'good', af8: 'good', tp10: 'good' },
  brainflowScores,
});

describe('training telemetry', () => {
  const scores: BrainFlowScores = { mindfulnessScore: 76.2, restfulnessScore: 80.6, method: 'brainflow' };

  it('shows BrainFlow mindfulness and restfulness for a headset session', () => {
    expect(describeBrainFlowScore(sample(scores), 'mindfulnessScore', false)).toBe('76');
    expect(describeBrainFlowScore(sample(scores), 'restfulnessScore', false)).toBe('81');
  });

  it('shows simulated scores only in a Demo session, and never presents them as measured', () => {
    expect(describeBrainFlowScore(sample({ ...scores, method: 'demo' }), 'mindfulnessScore', true)).toBe('76');
    expect(describeBrainFlowScore(sample(scores), 'mindfulnessScore', true)).toBe('Unavailable');
    expect(describeBrainFlowScore(sample({ ...scores, method: 'demo' }), 'mindfulnessScore', false)).toBe('Unavailable');
  });

  it('shows explicit unavailability without fabricating scores', () => {
    expect(describeBrainFlowScore(null, 'mindfulnessScore', false)).toBe('Unavailable');
    expect(describeBrainFlowScore(sample(), 'restfulnessScore', false)).toBe('Unavailable');
    expect(describeBrainFlowScore(sample({ ...scores, mindfulnessScore: null }), 'mindfulnessScore', false)).toBe('Unavailable');
  });
});
