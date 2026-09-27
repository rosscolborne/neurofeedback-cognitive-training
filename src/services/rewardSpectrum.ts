import type { BandPowers, ProtocolTemplate } from '../types';

/** Peak spectral amplitude (µV) inside the selected band from a two-second raw EEG window. */
export function calculateRewardAmplitudeUv(
  channels: readonly (readonly number[])[],
  sampleRateHz: number,
  reward: Pick<ProtocolTemplate['rewardBand'], 'freqMin' | 'freqMax'>,
): number | null {
  const sampleCount = Math.round(sampleRateHz * 2);
  if (!channels.length || !Number.isFinite(sampleRateHz) || sampleRateHz < 90
    || !Number.isFinite(reward.freqMin) || !Number.isFinite(reward.freqMax)
    || reward.freqMin >= reward.freqMax || channels.some(channel => channel.length < sampleCount)) return null;

  const weights = Array.from({ length: sampleCount }, (_, index) =>
    0.5 * (1 - Math.cos((2 * Math.PI * index) / (sampleCount - 1))));
  const coherentGain = weights.reduce((sum, weight) => sum + weight, 0);
  const firstBin = Math.max(1, Math.ceil(reward.freqMin * sampleCount / sampleRateHz));
  const lastBin = Math.min(Math.floor(sampleCount / 2) - 1,
    Math.ceil(reward.freqMax * sampleCount / sampleRateHz) - 1);
  if (firstBin > lastBin) return null;

  let channelTotal = 0;
  for (const channel of channels) {
    const window = channel.slice(-sampleCount);
    if (window.some(value => !Number.isFinite(value))) return null;
    const mean = window.reduce((sum, value) => sum + value, 0) / sampleCount;
    // Hosted Bluetooth analysis applies this same raw ADC conversion before
    // sending the window to BrainFlow. Keep the reward threshold in µV too.
    const scale = Math.abs(mean) > 150 ? 0.48828 : 1;
    let peak = 0;
    for (let bin = firstBin; bin <= lastBin; bin++) {
      let real = 0;
      let imaginary = 0;
      for (let index = 0; index < sampleCount; index++) {
        const angle = 2 * Math.PI * bin * index / sampleCount;
        const weighted = (window[index] - mean) * scale * weights[index];
        real += weighted * Math.cos(angle);
        imaginary -= weighted * Math.sin(angle);
      }
      peak = Math.max(peak, 2 * Math.hypot(real, imaginary) / coherentGain);
    }
    channelTotal += peak;
  }
  return channelTotal / channels.length;
}

/** Demo-only synthetic EEG, used to exercise the same reward evaluator without hardware. */
export function calculateDemoRewardAmplitudeUv(
  bands: BandPowers,
  reward: Pick<ProtocolTemplate['rewardBand'], 'freqMin' | 'freqMax'>,
): number | null {
  return calculateRewardAmplitudeUv([syntheticDemoSignal(bands)], 256, reward);
}

function syntheticDemoSignal(bands: BandPowers): number[] {
  const frequencies: Array<[keyof BandPowers, number]> = [
    ['delta', 2], ['theta', 6], ['alpha', 10], ['smr', 13.5], ['beta', 17], ['gamma', 35],
  ];
  const sampleRateHz = 256;
  const samples = Array.from({ length: sampleRateHz * 2 }, (_, index) =>
    frequencies.reduce((value, [band, frequency]) =>
      value + bands[band] * Math.sin(2 * Math.PI * frequency * index / sampleRateHz), 0));
  return samples;
}

/** Mean channel spectral band power, used as a unitless numerator/denominator ratio. */
export function calculateRewardBandPowerUv2(
  channels: readonly (readonly number[])[],
  sampleRateHz: number,
  band: { freqMin: number; freqMax: number },
): number | null {
  const count = Math.round(sampleRateHz * 2);
  if (!channels.length || !Number.isFinite(sampleRateHz) || sampleRateHz < 90
    || !Number.isFinite(band.freqMin) || !Number.isFinite(band.freqMax)
    || band.freqMin >= band.freqMax || channels.some(channel => channel.length < count)) return null;
  const weights = Array.from({ length: count }, (_, index) =>
    0.5 * (1 - Math.cos((2 * Math.PI * index) / (count - 1))));
  const gain = weights.reduce((sum, weight) => sum + weight, 0);
  const firstBin = Math.max(1, Math.ceil(band.freqMin * count / sampleRateHz));
  const lastBin = Math.min(Math.floor(count / 2) - 1, Math.ceil(band.freqMax * count / sampleRateHz) - 1);
  if (firstBin > lastBin) return null;
  let total = 0;
  for (const channel of channels) {
    const window = channel.slice(-count);
    if (window.some(value => !Number.isFinite(value))) return null;
    const mean = window.reduce((sum, value) => sum + value, 0) / count;
    const scale = Math.abs(mean) > 150 ? 0.48828 : 1;
    let power = 0;
    for (let bin = firstBin; bin <= lastBin; bin++) {
      let real = 0;
      let imaginary = 0;
      for (let index = 0; index < count; index++) {
        const angle = 2 * Math.PI * bin * index / count;
        const weighted = (window[index] - mean) * scale * weights[index];
        real += weighted * Math.cos(angle);
        imaginary -= weighted * Math.sin(angle);
      }
      const amplitude = 2 * Math.hypot(real, imaginary) / gain;
      power += amplitude * amplitude / 2;
    }
    total += power;
  }
  return total / channels.length;
}

export function calculateRewardPowerRatio(
  channels: readonly (readonly number[])[], sampleRateHz: number,
  bands: { numerator: { freqMin: number; freqMax: number }; denominator: { freqMin: number; freqMax: number } },
): number | null {
  const numerator = calculateRewardBandPowerUv2(channels, sampleRateHz, bands.numerator);
  const denominator = calculateRewardBandPowerUv2(channels, sampleRateHz, bands.denominator);
  return numerator === null || denominator === null || denominator <= 1e-9 ? null : numerator / denominator;
}

export function calculateDemoRewardPowerRatio(
  bands: BandPowers,
  ratio: { numerator: { freqMin: number; freqMax: number }; denominator: { freqMin: number; freqMax: number } },
): number | null {
  return calculateRewardPowerRatio([syntheticDemoSignal(bands)], 256, ratio);
}
