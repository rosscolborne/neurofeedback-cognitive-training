import type { EEGDataPoint } from '../../types';

export interface MandalaMetricTargets {
  focus: number;
  relaxation: number;
  coherence: number;
  thetaCurvature: number;
  totalPower: number;
  hue: number;
  saturation: number;
  value: number;
  quality: number;
}

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Perceptual degradation curve. It is exactly zero only at perfect quality,
 * while a modest sustained drop is visibly reflected in newly drawn artwork.
 */
export const getMandalaDegradation = (quality: number) => 1 - clamp01(quality) ** 1.6;

/**
 * Maps the app's existing, processed EEG fields into renderer-friendly targets.
 * This intentionally does not calculate a second focus, relaxation, coherence,
 * or in-zone metric.
 */
export function getMandalaMetricTargets(
  eegData: EEGDataPoint | null,
  recentInZonePercent: number | null,
): MandalaMetricTargets {
  const focus = clamp01((eegData?.brainflowScores?.mindfulnessScore ?? 55) / 100);
  const relaxation = clamp01((eegData?.brainflowScores?.restfulnessScore ?? 55) / 100);
  const coherence = eegData?.coherenceAvailable && eegData.coherence != null
    ? clamp01(eegData.coherence / 100)
    : 0.55;

  const availableBands = eegData
    ? (Object.keys(eegData.bands) as Array<keyof EEGDataPoint['bands']>)
      .filter((band) => eegData.bandAvailability[band])
    : [];
  const totalPower = availableBands.reduce((sum, band) => sum + Math.max(0, eegData?.bands[band] ?? 0), 0);
  const thetaFraction = totalPower > 0 && eegData?.bandAvailability.theta
    ? eegData.bands.theta / totalPower
    : 0.17;
  const thetaCurvature = clamp01((thetaFraction - 0.08) / 0.22);
  const quality = recentInZonePercent == null ? 0.65 : clamp01(recentInZonePercent / 100);

  // The two independently-derived 0–100 model outputs each traverse a
  // substantial part of the colour wheel instead of being collapsed into a
  // single focus-minus-relaxation axis.
  const hue = (20 + focus * 220 + relaxation * 120) % 360;
  const saturation = clamp01((0.28 + coherence * 0.68) * (0.55 + quality * 0.45));

  return {
    focus,
    relaxation,
    coherence,
    thetaCurvature,
    totalPower,
    hue,
    saturation,
    value: 0.9,
    quality,
  };
}

export function normalizeTotalPower(totalPower: number, rollingBaseline: number): number {
  if (!(totalPower > 0) || !(rollingBaseline > 0)) return 0.5;
  return clamp01((totalPower / rollingBaseline - 0.65) / 0.8);
}

export function hsvToCss(hue: number, saturation: number, value: number, alpha = 1): string {
  const h = ((hue % 360) + 360) % 360;
  const s = clamp01(saturation);
  const v = clamp01(value);
  const chroma = v * s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - chroma;
  let rgb: [number, number, number];
  if (h < 60) rgb = [chroma, x, 0];
  else if (h < 120) rgb = [x, chroma, 0];
  else if (h < 180) rgb = [0, chroma, x];
  else if (h < 240) rgb = [0, x, chroma];
  else if (h < 300) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];
  const [r, g, b] = rgb.map((channel) => Math.round((channel + m) * 255));
  return `rgba(${r}, ${g}, ${b}, ${clamp01(alpha)})`;
}
