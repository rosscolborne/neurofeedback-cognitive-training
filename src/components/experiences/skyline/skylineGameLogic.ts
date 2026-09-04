import type { EEGDataPoint } from '../../../types';

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
