import type { EEGDataPoint } from '../../../types';
import type { SkyAtmosphere, SkylineLandmarkKind, SpiritCompanion } from './skylineTypes';

/**
 * Pure game state machine functions extracted from SkylineDriftCanvas.
 * All neurofeedback-driven flight mechanics live here so they can be
 * unit-tested without a Canvas or AudioContext.
 */

/** Maps protocol-generic zoneScore (0.0–1.0) to canvas Y elevation. */
export function computeTargetElevation(zoneScore: number): number {
  // 1.0 → 0.22 (stratosphere), 0.0 → 0.80 (valley floor)
  return 0.80 - zoneScore * 0.58;
}

/** Derives flow multiplier tier from current ring streak. */
export function calculateMultiplier(streak: number): 1 | 2 | 3 | 4 {
  if (streak >= 10) return 4;
  if (streak >= 5) return 3;
  if (streak >= 3) return 2;
  return 1;
}

/** Determines if gyroscopic autopilot should engage based on EEG artifacts. */
export function isAutopilotActive(eegData: EEGDataPoint | null): boolean {
  if (!eegData) return false;
  return Boolean(
    eegData.artifacts?.blink ||
    eegData.artifacts?.clench ||
    eegData.signalQuality === 'poor'
  );
}

export interface RingPassResult {
  newStreak: number;
  newMultiplier: 1 | 2 | 3 | 4;
  scoreAwarded: number;
  triggerHyperDrift: boolean;
}

/**
 * Process a successful ring pass-through. Returns the updated streak,
 * multiplier, score awarded, and whether to trigger Hyper-Drift.
 */
export function processRingPass(
  currentStreak: number,
  hyperDriftActive: boolean,
): RingPassResult {
  const newStreak = currentStreak + 1;
  const newMultiplier = calculateMultiplier(newStreak);
  const triggerHyperDrift = newStreak >= 10 && !hyperDriftActive;

  return {
    newStreak,
    newMultiplier,
    scoreAwarded: 100 * newMultiplier,
    triggerHyperDrift,
  };
}

export interface RingMissResult {
  newStreak: number;
  newMultiplier: 1 | 2 | 3 | 4;
}

/**
 * Process a ring miss (ring recycled without being passed through).
 * Resets streak and drops multiplier back to 1x — the operant
 * conditioning "risk" that makes maintaining a streak engaging.
 */
export function processRingMiss(): RingMissResult {
  return { newStreak: 0, newMultiplier: 1 };
}

export interface HyperDriftExpiryResult {
  newStreak: number;
  newMultiplier: 1 | 2 | 3 | 4;
  hyperDriftActive: false;
}

/**
 * Process Hyper-Drift timer expiry. Resets streak and multiplier
 * to create a clean new reward cycle rather than re-triggering
 * infinitely while streak remains >= 10.
 */
export function processHyperDriftExpiry(): HyperDriftExpiryResult {
  return {
    newStreak: 0,
    newMultiplier: 1,
    hyperDriftActive: false,
  };
}

/** Compute base flight speed from zoneScore and hyper-drift state. */
export function computeBaseSpeed(zoneScore: number, hyperDriftActive: boolean): number {
  const base = 0.85 + zoneScore * 0.85;
  return hyperDriftActive ? base * 1.4 : base;
}

/** Apply autopilot dampening to glider pitch (exponential decay). */
export function dampenPitch(currentPitch: number): number {
  return currentPitch * 0.88;
}

// ---------------------------------------------------------------------------
// Atmospheric Odyssey & Color Interpolation
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length === 3) {
    return [
      parseInt(clean[0] + clean[0], 16),
      parseInt(clean[1] + clean[1], 16),
      parseInt(clean[2] + clean[2], 16),
    ];
  }
  return [
    parseInt(clean.substring(0, 2), 16),
    parseInt(clean.substring(2, 4), 16),
    parseInt(clean.substring(4, 6), 16),
  ];
}

function lerpColor(c1: string, c2: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(c1);
  const [r2, g2, b2] = hexToRgb(c2);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

interface PaletteFrame {
  name: string;
  skyTop: string;
  skyMid: string;
  skyBot: string;
  mountainFar: string;
  mountainMid: string;
  mountainNear: string;
  river: string;
  ringColor: string;
  sunX: number;
  sunY: number;
  isNight: boolean;
  ambientLight: number;
}

const SKY_PHASES: PaletteFrame[] = [
  {
    // 0.00: Alpine Dawn (Soft Rose & Cream Mist)
    name: 'Alpine Dawn',
    skyTop: '#D4B2A7',
    skyMid: '#F5E4D7',
    skyBot: '#FAF7F2',
    mountainFar: '#D1BBB0',
    mountainMid: '#BFA498',
    mountainNear: '#A88D7F',
    river: 'rgba(232, 150, 122, 0.45)',
    ringColor: '#E8967A',
    sunX: 0.18,
    sunY: 0.55,
    isNight: false,
    ambientLight: 0.85,
  },
  {
    // 0.25: High Alpine Noon (Crisp Azure & Sunlit Peaks)
    name: 'Alpine Noon',
    skyTop: '#9FBCC8',
    skyMid: '#DEEBF0',
    skyBot: '#F8FAF9',
    mountainFar: '#9EB0B8',
    mountainMid: '#869CA5',
    mountainNear: '#6F858F',
    river: 'rgba(110, 172, 194, 0.55)',
    ringColor: '#6EACC2',
    sunX: 0.50,
    sunY: 0.18,
    isNight: false,
    ambientLight: 1.0,
  },
  {
    // 0.50: Golden Canyon Sunset (Amber & Terracotta)
    name: 'Golden Hour',
    skyTop: '#D97D64',
    skyMid: '#F4B886',
    skyBot: '#FFF2DF',
    mountainFar: '#C98570',
    mountainMid: '#B46C56',
    mountainNear: '#9B5441',
    river: 'rgba(240, 140, 90, 0.5)',
    ringColor: '#E27D60',
    sunX: 0.82,
    sunY: 0.58,
    isNight: false,
    ambientLight: 0.88,
  },
  {
    // 0.75: Twilight Starlight (Violet & Moonlit Snow)
    name: 'Violet Twilight',
    skyTop: '#2C2E43',
    skyMid: '#514D6B',
    skyBot: '#8B839E',
    mountainFar: '#3D3B54',
    mountainMid: '#312F44',
    mountainNear: '#222130',
    river: 'rgba(160, 180, 240, 0.35)',
    ringColor: '#9C98DC',
    sunX: 0.88,
    sunY: 0.22,
    isNight: true,
    ambientLight: 0.45,
  },
];

/**
 * Computes smooth atmospheric palette interpolated across continuous timeOfDay (0.0 to 1.0).
 */
export function computeSkyAtmosphere(timeOfDay: number): SkyAtmosphere {
  const normTime = ((timeOfDay % 1) + 1) % 1;
  const segment = normTime * 4;
  const idx1 = Math.floor(segment) % 4;
  const idx2 = (idx1 + 1) % 4;
  const t = segment - Math.floor(segment);

  const p1 = SKY_PHASES[idx1];
  const p2 = SKY_PHASES[idx2];

  return {
    name: t < 0.5 ? p1.name : p2.name,
    skyTop: lerpColor(p1.skyTop, p2.skyTop, t),
    skyMid: lerpColor(p1.skyMid, p2.skyMid, t),
    skyBot: lerpColor(p1.skyBot, p2.skyBot, t),
    mountainFar: lerpColor(p1.mountainFar, p2.mountainFar, t),
    mountainMid: lerpColor(p1.mountainMid, p2.mountainMid, t),
    mountainNear: lerpColor(p1.mountainNear, p2.mountainNear, t),
    river: p1.river, // Preserved alpha river string
    ringColor: lerpColor(p1.ringColor, p2.ringColor, t),
    sunPos: {
      x: p1.sunX + (p2.sunX - p1.sunX) * t,
      y: p1.sunY + (p2.sunY - p1.sunY) * t,
    },
    isNight: p1.isNight || p2.isNight,
    ambientLight: p1.ambientLight + (p2.ambientLight - p1.ambientLight) * t,
  };
}

// ---------------------------------------------------------------------------
// Procedural Landmarks & Milestones
// ---------------------------------------------------------------------------

/**
 * Determines landmark spawning cadence along flight distance.
 * Returns landmark kind if a landmark milestone threshold is crossed.
 */
export function spawnNextLandmark(distanceTraveled: number): SkylineLandmarkKind | null {
  const cycle = distanceTraveled % 1800;
  // Trigger landmark windows within +/- 8 meters of milestones
  if (cycle >= 400 && cycle < 415) return 'arch';
  if (cycle >= 1000 && cycle < 1015) return 'waterfall';
  if (cycle >= 1550 && cycle < 1565) return 'turbines';
  return null;
}

// ---------------------------------------------------------------------------
// Spirit Companion & Water Surface Physics
// ---------------------------------------------------------------------------

/**
 * Updates companion crane aerodynamics. Flies in formation during flow (inZone),
 * and leads ahead smoothly toward thermal lift when out of zone.
 */
export function updateCompanionDynamics(
  companion: SpiritCompanion,
  gliderPos: { x: number; y: number },
  inZone: boolean,
  dt: number,
): SpiritCompanion {
  const targetAlpha = inZone ? 0.92 : 0.40;
  const newAlpha = companion.alpha + (targetAlpha - companion.alpha) * Math.min(1, dt * 2.0);

  // When in-zone: tight formation just behind and above glider wingtip
  // When out-of-zone: glides ahead to lead the way to next thermal pocket
  const targetX = inZone ? gliderPos.x + 44 : gliderPos.x + 85;
  const targetY = inZone ? gliderPos.y - 0.05 : gliderPos.y - 0.12;

  const newX = companion.x + (targetX - companion.x) * Math.min(1, dt * 2.5);
  const newY = companion.y + (targetY - companion.y) * Math.min(1, dt * 2.0);

  // Breathing-cadence wing flap tempo (~0.16Hz = 6 second cycle)
  const newWingPhase = companion.wingPhase + dt * (inZone ? 1.6 : 1.0);

  return {
    ...companion,
    x: newX,
    y: newY,
    alpha: newAlpha,
    wingPhase: newWingPhase,
    active: true,
  };
}

/**
 * Detects if glider is skimming inches above the river surface.
 */
export function isWaterSkimming(gliderY: number): boolean {
  return gliderY >= 0.72;
}

/**
 * Applies thermal updraft lift to glider elevation when an updraft ring is cleared.
 */
export function processThermalUpdraft(currentY: number): number {
  // Boost glider toward 0.38 altitude
  return Math.max(0.24, currentY - 0.18);
}
