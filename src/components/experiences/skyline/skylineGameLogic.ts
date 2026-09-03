import type { EEGDataPoint } from '../../../types';
import type { SkyAtmosphere, SkylineLandmarkKind, FlockBird } from './skylineTypes';

/**
 * Pure game state machine functions for Skyline Drift.
 * Manages neurofeedback elevation mapping, continuous flow progression,
 * atmospheric day/night interpolation, and modality dynamics.
 */

/** Maps protocol-generic zoneScore (0.0–1.0) to canvas Y elevation. */
export function computeTargetElevation(zoneScore: number): number {
  // 1.0 → 0.22 (stratosphere), 0.0 → 0.80 (valley floor)
  return 0.80 - zoneScore * 0.58;
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
// Continuous Flow & Multiplier State Machine (Replaces Circle Rings)
// ---------------------------------------------------------------------------

export interface FlowProgressionResult {
  newInZoneSeconds: number;
  multiplier: 1 | 2 | 3 | 4;
  triggerHyperDrift: boolean;
  scoreGained: number;
}

/**
 * Updates continuous time-in-zone. Replaces artificial rings with
 * organic, meditative flow progression. Sustaining focus smoothly
 * elevates flow multiplier (1x -> 2x -> 3x -> 4x).
 */
export function updateFlowProgression(
  currentInZoneSeconds: number,
  dt: number,
  inZone: boolean,
  hyperDriftActive: boolean,
): FlowProgressionResult {
  let newInZoneSeconds = currentInZoneSeconds;
  let triggerHyperDrift = false;

  if (inZone) {
    newInZoneSeconds += dt;
    if (newInZoneSeconds >= 12 && !hyperDriftActive) {
      triggerHyperDrift = true;
    }
  } else {
    // Gentle decay when out of zone — never abrupt or jarring
    newInZoneSeconds = Math.max(0, newInZoneSeconds - dt * 1.2);
  }

  let multiplier: 1 | 2 | 3 | 4 = 1;
  if (hyperDriftActive || newInZoneSeconds >= 12) {
    multiplier = 4;
  } else if (newInZoneSeconds >= 7) {
    multiplier = 3;
  } else if (newInZoneSeconds >= 3) {
    multiplier = 2;
  }

  const scoreGained = inZone ? Math.round(dt * 50 * multiplier) : 0;

  return {
    newInZoneSeconds,
    multiplier,
    triggerHyperDrift,
    scoreGained,
  };
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
  streamColor: string;
  sunX: number;
  sunY: number;
  isNight: boolean;
  ambientLight: number;
}

const SKY_PHASES: PaletteFrame[] = [
  {
    name: 'Alpine Dawn',
    skyTop: '#D4B2A7',
    skyMid: '#F5E4D7',
    skyBot: '#FAF7F2',
    mountainFar: '#D1BBB0',
    mountainMid: '#BFA498',
    mountainNear: '#A88D7F',
    river: 'rgba(232, 150, 122, 0.45)',
    streamColor: 'rgba(232, 150, 122, 0.45)',
    sunX: 0.18,
    sunY: 0.55,
    isNight: false,
    ambientLight: 0.85,
  },
  {
    name: 'Alpine Noon',
    skyTop: '#9FBCC8',
    skyMid: '#DEEBF0',
    skyBot: '#F8FAF9',
    mountainFar: '#9EB0B8',
    mountainMid: '#869CA5',
    mountainNear: '#6F858F',
    river: 'rgba(110, 172, 194, 0.55)',
    streamColor: 'rgba(110, 172, 194, 0.50)',
    sunX: 0.50,
    sunY: 0.18,
    isNight: false,
    ambientLight: 1.0,
  },
  {
    name: 'Golden Hour',
    skyTop: '#D97D64',
    skyMid: '#F4B886',
    skyBot: '#FFF2DF',
    mountainFar: '#C98570',
    mountainMid: '#B46C56',
    mountainNear: '#9B5441',
    river: 'rgba(240, 140, 90, 0.5)',
    streamColor: 'rgba(240, 140, 90, 0.55)',
    sunX: 0.82,
    sunY: 0.58,
    isNight: false,
    ambientLight: 0.88,
  },
  {
    name: 'Violet Twilight',
    skyTop: '#2C2E43',
    skyMid: '#514D6B',
    skyBot: '#8B839E',
    mountainFar: '#3D3B54',
    mountainMid: '#312F44',
    mountainNear: '#222130',
    river: 'rgba(160, 180, 240, 0.35)',
    streamColor: 'rgba(180, 175, 235, 0.45)',
    sunX: 0.88,
    sunY: 0.22,
    isNight: true,
    ambientLight: 0.45,
  },
];

/**
 * Computes smooth atmospheric palette across continuous timeOfDay (0.0 to 1.0).
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
    river: p1.river,
    streamColor: p1.streamColor,
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

export function spawnNextLandmark(distanceTraveled: number): SkylineLandmarkKind | null {
  const cycle = distanceTraveled % 1800;
  if (cycle >= 400 && cycle < 415) return 'arch';
  if (cycle >= 1000 && cycle < 1015) return 'waterfall';
  if (cycle >= 1550 && cycle < 1565) return 'turbines';
  return null;
}

export function isWaterSkimming(gliderY: number): boolean {
  return gliderY >= 0.72;
}

// ---------------------------------------------------------------------------
// Spirit Flock Geometry (Mode 2)
// ---------------------------------------------------------------------------

/**
 * Calculates V-formation flock offsets based on active flock count (1 to 7 birds).
 */
export function calculateFlockOffsets(flockCount: number): FlockBird[] {
  const formationOffsets = [
    { offsetX: -42, offsetY: -14, offsetZ: 35, scale: 0.85 },  // Left wing 1
    { offsetX: 42, offsetY: -14, offsetZ: 35, scale: 0.85 },   // Right wing 1
    { offsetX: -82, offsetY: -28, offsetZ: 75, scale: 0.75 },  // Left wing 2
    { offsetX: 82, offsetY: -28, offsetZ: 75, scale: 0.75 },   // Right wing 2
    { offsetX: -120, offsetY: -42, offsetZ: 115, scale: 0.65 }, // Left wing 3
    { offsetX: 120, offsetY: -42, offsetZ: 115, scale: 0.65 },  // Right wing 3
    { offsetX: 0, offsetY: -52, offsetZ: 135, scale: 0.60 },    // Rear apex
  ];

  return formationOffsets.slice(0, Math.min(flockCount, formationOffsets.length)).map((f, i) => ({
    id: i,
    offsetX: f.offsetX,
    offsetY: f.offsetY,
    offsetZ: f.offsetZ,
    wingPhase: (i * 0.45) % (Math.PI * 2),
    alpha: 0.9,
    scale: f.scale,
  }));
}

// ---------------------------------------------------------------------------
// Wind Stream Ribbon Geometry (Mode 1)
// ---------------------------------------------------------------------------

export interface StreamNode {
  x: number;
  y: number;
  z: number;
}

/**
 * Computes flowing thermal wind stream spine coordinates in 3D.
 */
export function computeStreamNodes(time: number, targetY: number): StreamNode[] {
  const nodes: StreamNode[] = [];
  const count = 10;
  for (let i = 0; i < count; i++) {
    const z = 80 + i * 140;
    const waveX = Math.sin(time * 0.0018 + i * 0.5) * 65;
    const waveY = targetY + Math.cos(time * 0.0014 + i * 0.4) * 0.06;
    nodes.push({ x: waveX, y: waveY, z });
  }
  return nodes;
}
