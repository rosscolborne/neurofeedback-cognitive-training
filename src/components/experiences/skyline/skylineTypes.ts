export interface SkylineRing {
  x: number;
  y: number; // 0.18 to 0.82 normalized elevation
  z: number; // 30 to 1400 depth
  radius: number;
  passed: boolean;
  pulsePhase: number;
  isUpdraft?: boolean; // Thermal updraft ring in low valley
}

export interface ZenShard {
  x: number;
  y: number;
  z: number;
  collected: boolean;
  sparklePhase: number;
}

export type ParticleKind =
  | 'star'
  | 'cloud'
  | 'speedline'
  | 'ring-burst'
  | 'shard-spark'
  | 'vapor-trail'
  | 'water-spray'
  | 'thermal-vapor';

export interface SkylineParticle {
  x: number;
  y: number;
  z: number;
  size: number;
  vx: number;
  vy: number;
  vz: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
  kind: ParticleKind;
}

export interface WaterRipple {
  x: number;
  y: number;
  z: number;
  radius: number;
  maxRadius: number;
  alpha: number;
}

export type SkylineLandmarkKind = 'arch' | 'waterfall' | 'turbines';

export interface SkylineLandmark {
  kind: SkylineLandmarkKind;
  x: number;
  y: number;
  z: number;
  scale: number;
  passed: boolean;
  rotation?: number;
}

export interface SpiritCompanion {
  active: boolean;
  x: number;
  y: number;
  z: number;
  targetX: number;
  targetY: number;
  wingPhase: number;
  alpha: number;
  leadDistance: number;
}

export interface SkyAtmosphere {
  skyTop: string;
  skyMid: string;
  skyBot: string;
  mountainFar: string;
  mountainMid: string;
  mountainNear: string;
  river: string;
  ringColor: string;
  name: string;
  sunPos: { x: number; y: number };
  isNight: boolean;
  ambientLight: number; // 0.2 (night) to 1.0 (noon)
}

export interface BiomeTheme {
  id: string;
  label: string;
  skyTop: string;
  skyMid: string;
  skyBot: string;
  mountain: string;
  river: string;
  ringColor: string;
  craftPalette: [string, string, string]; // Nose, Body, Tail
  particleColor: string;
}

export interface SkylineGameState {
  score: number;
  streak: number;
  maxStreak: number;
  multiplier: 1 | 2 | 3 | 4;
  ringsCleared: number;
  shardsCollected: number;
  hyperDriftActive: boolean;
  hyperDriftTimeLeft: number;
  gliderY: number;
  gliderTargetY: number;
  gliderPitch: number;
  gliderRoll: number;
  speed: number;
  shockwaveRadius: number | null;
  autopilotActive: boolean;
  distanceTraveled: number;
  timeOfDay: number; // 0.0 (Dawn) -> 0.25 (Noon) -> 0.5 (Sunset) -> 0.75 (Twilight) -> 1.0 (Dawn)
  isSkimmingWater: boolean;
}
