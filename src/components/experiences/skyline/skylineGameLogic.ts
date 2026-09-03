import type { EEGDataPoint } from '../../../types';
import type { ExpeditionRegion, ExpeditionMilestone, ExpeditionRegionId } from './skylineTypes';

/**
 * Pure game & aerodynamic physics functions for Skyline Drift Kinetic Soaring.
 * Implements real aerodynamic lift/dive kinematics, atmospheric mist parting,
 * and procedural scenic expedition regions.
 */

/** Maps protocol-generic zoneScore (0.0–1.0) to canvas normalized Y elevation. */
export function computeTargetElevation(zoneScore: number): number {
  // 1.0 (calm flow) → 0.20 (high stratosphere), 0.0 (tension/drift) → 0.80 (valley floor)
  return 0.80 - zoneScore * 0.60;
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

/** Apply autopilot dampening to glider pitch (exponential decay). */
export function dampenPitch(currentPitch: number): number {
  return currentPitch * 0.88;
}

export interface AerodynamicState {
  gliderY: number;
  pitch: number;
  roll: number;
  speed: number;
  verticalVelocity: number;
}

/**
 * Computes aerodynamic gliding physics. Glider responds naturally to thermal lift:
 * - Climbing (calm/in-zone): nose pitches upward, smooth buoyant ascent.
 * - Diving (descending): nose pitches forward, picks up forward velocity and wind rush.
 * - Dynamic banking roll reflects flight momentum.
 */
export function computeAerodynamics(
  current: AerodynamicState,
  targetElevation: number,
  baseZoneSpeed: number,
  autopilotActive: boolean,
  dt: number,
  timeMs: number,
): AerodynamicState {
  if (autopilotActive) {
    return {
      gliderY: current.gliderY,
      pitch: dampenPitch(current.pitch),
      roll: current.roll * 0.90,
      speed: 1.0,
      verticalVelocity: 0,
    };
  }

  const dy = targetElevation - current.gliderY;
  // Natural aerodynamic spring-damping
  const liftForce = dy * 3.5;
  const newVerticalVelocity = (current.verticalVelocity + liftForce * dt) * 0.92;
  const newY = Math.max(0.18, Math.min(0.85, current.gliderY + newVerticalVelocity * dt));

  // Aerodynamic pitch: tilting with climb and dive
  const targetPitch = dy > 0
    ? Math.min(0.48, dy * 1.8)  // Diving forward
    : Math.max(-0.42, dy * 2.0); // Climbing on thermal lift
  const newPitch = current.pitch + (targetPitch - current.pitch) * Math.min(1, dt * 4.0);

  // Speed momentum: diving converts potential energy into kinetic airspeed
  const speedBoost = dy > 0.05 ? dy * 0.65 : 0;
  const targetSpeed = baseZoneSpeed + speedBoost;
  const newSpeed = current.speed + (targetSpeed - current.speed) * Math.min(1, dt * 3.0);

  // Gentle banking roll based on turn and aerodynamic roll
  const aerodynamicRoll = Math.sin(timeMs * 0.0018) * 0.08 + dy * 0.25;
  const newRoll = current.roll + (aerodynamicRoll - current.roll) * Math.min(1, dt * 3.5);

  return {
    gliderY: newY,
    pitch: newPitch,
    roll: newRoll,
    speed: newSpeed,
    verticalVelocity: newVerticalVelocity,
  };
}

// ---------------------------------------------------------------------------
// Atmospheric Mist Parting (The Clinical Neurofeedback Feedback Loop)
// ---------------------------------------------------------------------------

/**
 * Updates atmospheric mist density based on in-zone status.
 * - In-Zone: mist dissolves toward 0.0 (revealing brilliant golden sunlight).
 * - Out-of-Zone: gentle watercolor mist rolls in toward 0.65 (softly blurring horizon).
 */
export function updateAtmosphericMist(
  currentDensity: number,
  inZone: boolean,
  dt: number,
): number {
  const target = inZone ? 0.0 : 0.65;
  const speed = inZone ? 0.55 : 0.35; // Dissolves quickly, rolls in gently
  return currentDensity + (target - currentDensity) * Math.min(1, dt * speed);
}

// ---------------------------------------------------------------------------
// Procedural Scenic Expedition Regions
// ---------------------------------------------------------------------------

const REGIONS: Record<ExpeditionRegionId, ExpeditionRegion> = {
  'alpine-glades': {
    id: 'alpine-glades',
    name: 'The Alpine Glades',
    subtitle: 'Morning mist drifting over winding river foothills',
    skyTop: '#D4B2A7',
    skyMid: '#F5E4D7',
    skyBot: '#FAF7F2',
    mountainFar: '#D1BBB0',
    mountainMid: '#BFA498',
    mountainNear: '#A88D7F',
    river: 'rgba(232, 150, 122, 0.45)',
    cloudSeaActive: false,
    mountainFreq: 0.003,
  },
  'great-canyon': {
    id: 'great-canyon',
    name: 'The Great Canyon',
    subtitle: 'Warm amber sun striking towering clay chasms',
    skyTop: '#D97D64',
    skyMid: '#F4B886',
    skyBot: '#FFF2DF',
    mountainFar: '#C98570',
    mountainMid: '#B46C56',
    mountainNear: '#9B5441',
    river: 'rgba(240, 140, 90, 0.50)',
    cloudSeaActive: false,
    mountainFreq: 0.005,
  },
  'cloud-sea': {
    id: 'cloud-sea',
    name: 'The Sunlit Cloud Sea',
    subtitle: 'Soaring high above the endless golden cloud deck',
    skyTop: '#92B4D0',
    skyMid: '#DCE8F0',
    skyBot: '#FFFDF5',
    mountainFar: '#A8C0D0',
    mountainMid: '#F0EBE0',
    mountainNear: '#FAF6EE',
    river: 'rgba(255, 255, 255, 0.65)',
    cloudSeaActive: true,
    mountainFreq: 0.002,
  },
};

export function getExpeditionRegion(distanceTraveled: number): ExpeditionRegion {
  if (distanceTraveled >= 1800) return REGIONS['cloud-sea'];
  if (distanceTraveled >= 600) return REGIONS['great-canyon'];
  return REGIONS['alpine-glades'];
}

// ---------------------------------------------------------------------------
// Expedition Milestones
// ---------------------------------------------------------------------------

export const EXPEDITION_MILESTONES: ExpeditionMilestone[] = [
  {
    id: 'pine-pass',
    title: 'Whispering Pines Cleared',
    distance: 300,
    description: 'Cruising past the lower pine valley with steady focus.',
  },
  {
    id: 'alpine-ridge',
    title: 'Alpine Ridge Surmounted',
    distance: 600,
    description: 'Crossing into the vast expanse of the Great Canyon.',
  },
  {
    id: 'canyon-chasm',
    title: 'Great Canyon Chasm Crossed',
    distance: 1200,
    description: 'Soaring through towering terracotta spires.',
  },
  {
    id: 'cloud-sea-entry',
    title: 'Breaking Above the Cloud Sea',
    distance: 1800,
    description: 'Mountains drop beneath as you enter the golden stratosphere.',
  },
  {
    id: 'stratosphere-zenith',
    title: 'Stratosphere Zenith',
    distance: 2500,
    description: 'Pure effortless flight in sustained neural harmony.',
  },
];

export function checkExpeditionMilestone(
  distanceTraveled: number,
  achievedIds: Set<string>,
): ExpeditionMilestone | null {
  for (const m of EXPEDITION_MILESTONES) {
    if (!achievedIds.has(m.id) && distanceTraveled >= m.distance) {
      return m;
    }
  }
  return null;
}
