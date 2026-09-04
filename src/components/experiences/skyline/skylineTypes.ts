export type SkylineFlightMode = 'wind-stream' | 'spirit-flock' | 'living-canvas';

export type ParticleKind = 'cloud' | 'star' | 'speedline' | 'vapor-trail' | 'water-spray';

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

export interface DriftingPetal {
  x: number;
  y: number;
  z: number;
  size: number;
  color: string;
  rotation: number;
  collected: boolean;
}

export interface FlockBird {
  id: number;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  wingPhase: number;
  alpha: number;
  scale: number;
}

export interface BloomObject {
  id: number;
  x: number;
  y: number;
  z: number;
  type: 'flower' | 'lantern';
  scale: number;
  alpha: number;
  color: string;
  bloomed: boolean;
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

export interface SkyAtmosphere {
  skyTop: string;
  skyMid: string;
  skyBot: string;
  mountainFar: string;
  mountainMid: string;
  mountainNear: string;
  river: string;
  streamColor: string;
  name: string;
  sunPos: { x: number; y: number };
  isNight: boolean;
  ambientLight: number; // 0.2 (night) to 1.0 (noon)
}

export interface SkylineGameState {
  score: number;
  streak: number;
  maxStreak: number;
  multiplier: 1 | 2 | 3 | 4;
  inZoneContinuousSeconds: number;
  petalsCollected: number;
  flockCount: number;
  bloomsAwakened: number;
  hyperDriftActive: boolean;
  hyperDriftTimeLeft: number;
  gliderY: number;
  gliderTargetY: number;
  gliderPitch: number;
  gliderRoll: number;
  speed: number;
  autopilotActive: boolean;
  distanceTraveled: number;
  timeOfDay: number; // 0.0 (Dawn) -> 0.25 (Noon) -> 0.5 (Sunset) -> 0.75 (Twilight) -> 1.0 (Dawn)
  isSkimmingWater: boolean;
  flightMode: SkylineFlightMode;
}
