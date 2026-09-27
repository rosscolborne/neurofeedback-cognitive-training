import { describe, expect, it } from 'vitest';
import type { EEGDataPoint } from '../../types';
import { EEGEngine } from '../eegEngine';
import { calculateRecentInZonePercent } from '../inZoneMetric';

const sample = (engine: EEGEngine): EEGDataPoint =>
  (engine as unknown as { generateSample: (dt: number) => EEGDataPoint }).generateSample(0.1);

describe('Demo protocol feedback and recent in-zone time', () => {
  it('keeps simulated mindfulness and restfulness moving within each manual state and after switches', () => {
    const engine = new EEGEngine();
    engine.isDemoMode = true;
    const averages: Record<string, { mindfulness: number; restfulness: number }> = {};
    for (const state of ['focus', 'drift', 'recovery', 'calm'] as const) {
      engine.setSimulatedState(state);
      const frames = Array.from({ length: 120 }, () => sample(engine));
      const mindfulness = frames.map(frame => frame.brainflowScores?.mindfulnessScore ?? NaN);
      const restfulness = frames.map(frame => frame.brainflowScores?.restfulnessScore ?? NaN);
      expect(frames.every(frame => frame.brainflowScores?.method === 'demo')).toBe(true);
      expect(mindfulness.every(Number.isFinite)).toBe(true);
      expect(restfulness.every(Number.isFinite)).toBe(true);
      expect(new Set(mindfulness).size).toBeGreaterThan(2);
      expect(new Set(restfulness).size).toBeGreaterThan(2);
      for (const frame of frames) {
        const scores = frame.brainflowScores!;
        expect(scores.restfulnessScore).toBeCloseTo(50 + scores.valence! * 50, 0);
        expect(scores.mindfulnessScore).toBeCloseTo(50 + (scores.arousal! + scores.valence!) * 25, 0);
      }
      averages[state] = {
        mindfulness: mindfulness.reduce((sum, value) => sum + value, 0) / frames.length,
        restfulness: restfulness.reduce((sum, value) => sum + value, 0) / frames.length,
      };
    }
    expect(averages.focus.mindfulness).toBeGreaterThan(averages.drift.mindfulness);
    expect(averages.calm.restfulness).toBeGreaterThan(averages.focus.restfulness);
  });

  it('weights the last ten seconds of beta feedback rather than interpreting the latest value as the whole window', () => {
    const beta = new EEGEngine();
    beta.setProtocol('beta-downtraining');
    beta.isDemoMode = true;
    beta.setSimulatedState('drift');
    const driftBeta = sample(beta);
    beta.setSimulatedState('focus');
    const focusedBeta = sample(beta);
    expect(driftBeta.activeRewardMetric?.value).toBeLessThan(beta.getThreshold());
    expect(driftBeta.inZone).toBe(true);
    expect(focusedBeta.activeRewardMetric?.value).toBeGreaterThan(beta.getThreshold());
    expect(focusedBeta.inZone).toBe(false);
    expect(calculateRecentInZonePercent([
      { timestamp: 0, inZone: driftBeta.inZone, available: driftBeta.inZoneAvailable },
      { timestamp: 5_900, inZone: focusedBeta.inZone, available: focusedBeta.inZoneAvailable },
    ], 10_000, 10).percent).toBe(59);
  });

  it('crosses the default beta threshold during the automatic Demo cycle', () => {
    const engine = new EEGEngine();
    engine.setProtocol('beta-downtraining');
    engine.isDemoMode = true;
    const frames = Array.from({ length: 120 }, () => sample(engine));
    expect(frames.some(frame => frame.inZone)).toBe(true);
    expect(frames.some(frame => !frame.inZone)).toBe(true);
  });
});
