export type ExpeditionRegionId = 'alpine-glades' | 'great-canyon' | 'cloud-sea';

export interface ExpeditionRegion {
  id: ExpeditionRegionId;
  name: string;
  subtitle: string;
  skyTop: string;
  skyMid: string;
  skyBot: string;
  mountainFar: string;
  mountainMid: string;
  mountainNear: string;
  river: string;
  cloudSeaActive: boolean;
  mountainFreq: number;
}

export interface ExpeditionMilestone {
  id: string;
  title: string;
  distance: number;
  description: string;
}

export interface SkylineParticle {
  x: number;
  y: number;
  z: number;
  size: number;
  color: string;
  alpha: number;
}

export interface SkylineGameState {
  gliderY: number;
  gliderTargetY: number;
  gliderPitch: number;
  gliderRoll: number;
  verticalVelocity: number;
  speed: number;
  distanceTraveled: number;
  mistDensity: number; // 0.0 (crystal clear / radiant) to 1.0 (heavy watercolor fog)
  autopilotActive: boolean;
  activeRegion: ExpeditionRegionId;
  currentMilestone: ExpeditionMilestone | null;
  milestoneTimeLeft: number;
  inZone: boolean;
}
