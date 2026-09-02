import { describe, expect, it } from 'vitest';
import type { EEGDataPoint } from '../../../types';
import { getMandalaDegradation, getMandalaMetricTargets, hsvToCss, normalizeTotalPower } from '../eegMandalaMetrics';

function frame(overrides: Partial<EEGDataPoint> = {}): EEGDataPoint {
  return {
    timestamp: 1,
    rawSignal: 0,
    bands: { delta: 10, theta: 10, alpha: 12, smr: 7, beta: 9, gamma: 4 },
    bandAvailability: { delta: true, theta: true, alpha: true, smr: true, beta: true, gamma: true },
    bandRatios: {},
    thetaBetaRatio: 1.1,
    thetaBetaRatioAvailable: true,
    coherence: 70,
    coherenceAvailable: true,
    inZone: true,
    inZoneAvailable: true,
    zoneScore: 1,
    signalQuality: 'good',
    channelQuality: { tp9: 'good', af7: 'good', af8: 'good', tp10: 'good' },
    artifacts: { blink: false, clench: false },
    brainflowScores: { mindfulnessScore: 70, restfulnessScore: 60 },
    ...overrides,
  };
}

describe('EEG mandala mappings', () => {
  it('maps recent in-zone directly and continuously to quality', () => {
    expect(getMandalaMetricTargets(frame(), 100).quality).toBe(1);
    expect(getMandalaMetricTargets(frame(), 40).quality).toBeCloseTo(.4);
    expect(getMandalaMetricTargets(frame(), 0).quality).toBe(0);
  });

  it('makes every performance-induced error exactly zero at 100% and monotonic below it', () => {
    expect(getMandalaDegradation(1)).toBe(0);
    expect(getMandalaDegradation(.8)).toBeGreaterThan(.3);
    expect(getMandalaDegradation(.4)).toBeGreaterThan(getMandalaDegradation(.8));
    expect(getMandalaDegradation(0)).toBe(1);
  });

  it('lets focus and relaxation independently change hue', () => {
    const base = frame();
    const focusShift = frame({ brainflowScores: { mindfulnessScore: 90, restfulnessScore: 60 } });
    const relaxationShift = frame({ brainflowScores: { mindfulnessScore: 70, restfulnessScore: 90 } });
    expect(getMandalaMetricTargets(focusShift, 100).hue).not.toBe(getMandalaMetricTargets(base, 100).hue);
    expect(getMandalaMetricTargets(relaxationShift, 100).hue).not.toBe(getMandalaMetricTargets(base, 100).hue);
  });

  it('uses coherence as the primary saturation control while quality can only reduce it', () => {
    const low = frame({ coherence: 10 });
    const high = frame({ coherence: 90 });
    expect(getMandalaMetricTargets(high, 100).saturation).toBeGreaterThan(getMandalaMetricTargets(low, 100).saturation);
    expect(getMandalaMetricTargets(high, 0).saturation).toBeLessThan(getMandalaMetricTargets(high, 100).saturation);
  });

  it('normalizes theta by total available spectral power', () => {
    const lowTheta = frame({ bands: { delta: 10, theta: 4, alpha: 16, smr: 7, beta: 14, gamma: 5 } });
    const highTheta = frame({ bands: { delta: 10, theta: 18, alpha: 8, smr: 7, beta: 6, gamma: 4 } });
    expect(getMandalaMetricTargets(highTheta, 100).thetaCurvature).toBeGreaterThan(getMandalaMetricTargets(lowTheta, 100).thetaCurvature);
  });

  it('keeps adaptive power and HSV outputs bounded', () => {
    expect(normalizeTotalPower(65, 100)).toBe(0);
    expect(normalizeTotalPower(145, 100)).toBeCloseTo(1);
    expect(hsvToCss(360, 1, 1)).toBe('rgba(255, 0, 0, 1)');
  });
});
