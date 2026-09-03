import { describe, expect, it } from 'vitest';
import { calculateRecentInZonePercent } from '../inZoneMetric';

describe('calculateRecentInZonePercent', () => {
  it('weights each in-zone state by elapsed time rather than sample count', () => {
    const metric = calculateRecentInZonePercent([
      { timestamp: 0, inZone: true, available: true },
      { timestamp: 1_000, inZone: false, available: true },
      { timestamp: 9_000, inZone: true, available: true },
    ], 10_000, 10);

    expect(metric).toEqual({ percent: 20, measuredMilliseconds: 10_000 });
  });

  it('excludes unavailable EEG intervals from the denominator', () => {
    const metric = calculateRecentInZonePercent([
      { timestamp: 0, inZone: true, available: true },
      { timestamp: 4_000, inZone: false, available: false },
      { timestamp: 7_000, inZone: false, available: true },
    ], 10_000, 10);

    expect(metric).toEqual({ percent: 57, measuredMilliseconds: 7_000 });
  });

  it('uses only the trailing portion of a state that began before the window', () => {
    const metric = calculateRecentInZonePercent([
      { timestamp: 0, inZone: false, available: true },
      { timestamp: 8_000, inZone: true, available: true },
    ], 12_000, 5);

    expect(metric).toEqual({ percent: 80, measuredMilliseconds: 5_000 });
  });
});
