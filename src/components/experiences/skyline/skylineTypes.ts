export interface SkylineRing {
  x: number;
  y: number; // 0.18 to 0.82 normalized elevation
  z: number; // 30 to 1400 depth
  radius: number;
  passed: boolean;
  pulsePhase: number;
}

export interface ZenShard {
  x: number;
  y: number;
  z: number;
  collected: boolean;
  sparklePhase: number;
}

export type ParticleKind = 'star' | 'cloud' | 'speedline' | 'ring-burst' | 'shard-spark' | 'vapor-trail';

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

export interface BiomeTheme {
  id: string;
  label: string;
  skyTop: string;
  skyMid: string;
  skyBot: string;
  mountainBack: string;
  mountainMid: string;
  mountainFront: string;
  river: string;
  ringColor: string;
  ringGlow: string;
  shardColor: string;
  craftPalette: [string, string, string]; // Nose, Body, Tail
  starAlpha: number;
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
}
