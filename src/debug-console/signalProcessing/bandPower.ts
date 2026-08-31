import type { SignalFrame } from "../domain/eeg";

export interface FrequencyBand {
  id: string;
  label: string;
  lowHz: number;
  highHz: number;
}

export interface BandPowerResult {
  channelCount: number;
  sampleCount: number;
  sampleRateHz: number;
  powers: Record<string, number>;
}

export const defaultAttentionBands = {
  theta: { id: "theta", label: "Theta", lowHz: 4, highHz: 8 },
  alpha: { id: "alpha", label: "Alpha", lowHz: 8, highHz: 13 },
  beta: { id: "beta", label: "Beta", lowHz: 13, highHz: 30 },
} satisfies Record<string, FrequencyBand>;

export function computeBandPowers(
  frame: SignalFrame,
  bands: FrequencyBand[],
): BandPowerResult | null {
  if (frame.sensor !== "eeg" || !frame.sampleRateHz || frame.samples.length < 16) {
    return null;
  }

  const channelCount = frame.channels.length;
  if (channelCount === 0) return null;

  const channelSamples = Array.from({ length: channelCount }, () => [] as number[]);

  for (const row of frame.samples) {
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const value = row[channelIndex];
      if (Number.isFinite(value)) {
        channelSamples[channelIndex].push(value);
      }
    }
  }

  const powers: Record<string, number> = {};
  for (const band of bands) {
    const channelPowers = channelSamples
      .filter((samples) => samples.length >= 16)
      .map((samples) => bandPower(samples, frame.sampleRateHz ?? 256, band));

    powers[band.id] =
      channelPowers.reduce((total, power) => total + power, 0) /
      Math.max(1, channelPowers.length);
  }

  return {
    channelCount,
    sampleCount: frame.samples.length,
    sampleRateHz: frame.sampleRateHz,
    powers,
  };
}

function bandPower(samples: number[], sampleRateHz: number, band: FrequencyBand) {
  const centered = removeMean(samples);
  const startBin = Math.max(1, Math.ceil((band.lowHz * centered.length) / sampleRateHz));
  const endBin = Math.min(
    Math.floor((band.highHz * centered.length) / sampleRateHz),
    Math.floor(centered.length / 2),
  );

  if (endBin < startBin) return 0;

  let totalPower = 0;
  let binCount = 0;

  for (let bin = startBin; bin <= endBin; bin += 1) {
    const power = goertzelPower(centered, bin);
    totalPower += power;
    binCount += 1;
  }

  return totalPower / Math.max(1, binCount);
}

function removeMean(samples: number[]) {
  const mean = samples.reduce((total, value) => total + value, 0) / samples.length;
  return samples.map((value) => value - mean);
}

function goertzelPower(samples: number[], bin: number) {
  const omega = (2 * Math.PI * bin) / samples.length;
  const coefficient = 2 * Math.cos(omega);
  let previous = 0;
  let previous2 = 0;

  for (const sample of samples) {
    const current = sample + coefficient * previous - previous2;
    previous2 = previous;
    previous = current;
  }

  return previous2 * previous2 + previous * previous - coefficient * previous * previous2;
}

