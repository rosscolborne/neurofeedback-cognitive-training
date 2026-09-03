export interface InZoneObservation {
  timestamp: number;
  inZone: boolean;
  available: boolean;
}

export interface RecentInZoneMetric {
  percent: number | null;
  measuredMilliseconds: number;
}

/**
 * Calculates the percentage of valid, elapsed time spent in-zone during a
 * trailing window. Each observation's state applies until the next
 * observation, so this remains accurate when EEG updates are irregular.
 */
export function calculateRecentInZonePercent(
  observations: readonly InZoneObservation[],
  now: number,
  windowSeconds: number,
): RecentInZoneMetric {
  if (!Number.isFinite(now) || !Number.isFinite(windowSeconds) || windowSeconds <= 0) {
    return { percent: null, measuredMilliseconds: 0 };
  }

  const windowStart = now - windowSeconds * 1_000;
  const samples = observations
    .filter(sample => Number.isFinite(sample.timestamp) && sample.timestamp <= now)
    .sort((left, right) => left.timestamp - right.timestamp);

  let measuredMilliseconds = 0;
  let inZoneMilliseconds = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const intervalStart = Math.max(sample.timestamp, windowStart);
    const intervalEnd = Math.min(samples[index + 1]?.timestamp ?? now, now);
    const duration = Math.max(0, intervalEnd - intervalStart);
    if (sample.available && duration > 0) {
      measuredMilliseconds += duration;
      if (sample.inZone) inZoneMilliseconds += duration;
    }
  }

  return {
    percent: measuredMilliseconds > 0
      ? Math.round((inZoneMilliseconds / measuredMilliseconds) * 100)
      : null,
    measuredMilliseconds,
  };
}
