import { describe, expect, it } from 'vitest';
import type { EEGDataPoint } from '../../types';
import { EEGEngine } from '../eegEngine';
import { calculateRecentInZonePercent } from '../inZoneMetric';

const sample = (engine: EEGEngine): EEGDataPoint =>
  (engine as unknown as { generateSample: (dt: number) => EEGDataPoint }).generateSample(0.1);

describe('Demo protocol feedback and recent in-zone time', () => {
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
