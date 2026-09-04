import { describe, expect, it } from 'vitest';
import { audioEngine } from '../../../services/audioEngine';
import type { EEGDataPoint } from '../../../types';
import {
  computeTargetElevation,
  calculateMultiplier,
  isAutopilotActive,
  processRingPass,
  processRingMiss,
  processHyperDriftExpiry,
  computeBaseSpeed,
  dampenPitch,
} from '../skyline/skylineGameLogic';

function createMockEEGFrame(overrides: Partial<EEGDataPoint> = {}): EEGDataPoint {
  return {
    timestamp: Date.now(),
    rawSignal: 0,
    bands: { delta: 8, theta: 10, alpha: 15, smr: 9, beta: 11, gamma: 5 },
    bandAvailability: { delta: true, theta: true, alpha: true, smr: true, beta: true, gamma: true },
    bandRatios: { thetaBeta: 0.9 },
    thetaBetaRatio: 0.9,
    thetaBetaRatioAvailable: true,
    coherence: 80,
    coherenceAvailable: true,
    inZone: true,
    inZoneAvailable: true,
    zoneScore: 0.85,
    signalQuality: 'good',
    channelQuality: { tp9: 'good', af7: 'good', af8: 'good', tp10: 'good' },
    artifacts: { blink: false, clench: false },
    brainflowScores: { mindfulnessScore: 75, restfulnessScore: 80 },
    ...overrides,
  };
}

describe('Skyline Drift Game Logic (extracted state machine)', () => {
  // ─── Altitude Mapping ──────────────────────────────────────────────
  describe('computeTargetElevation', () => {
    it('maps zoneScore=0 to valley floor (0.80)', () => {
      expect(computeTargetElevation(0.0)).toBeCloseTo(0.80);
    });

    it('maps zoneScore=1 to stratosphere (0.22)', () => {
      expect(computeTargetElevation(1.0)).toBeCloseTo(0.22);
    });

    it('is monotonically decreasing (higher focus = lower canvas Y = higher altitude)', () => {
      const scores = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0];
      const elevations = scores.map(computeTargetElevation);
      for (let i = 1; i < elevations.length; i++) {
        expect(elevations[i]).toBeLessThan(elevations[i - 1]);
      }
    });
  });

  // ─── Multiplier Tiers ──────────────────────────────────────────────
  describe('calculateMultiplier', () => {
    it('returns 1x for streaks 0–2', () => {
      expect(calculateMultiplier(0)).toBe(1);
      expect(calculateMultiplier(1)).toBe(1);
      expect(calculateMultiplier(2)).toBe(1);
    });

    it('returns 2x for streaks 3–4', () => {
      expect(calculateMultiplier(3)).toBe(2);
      expect(calculateMultiplier(4)).toBe(2);
    });

    it('returns 3x for streaks 5–9', () => {
      expect(calculateMultiplier(5)).toBe(3);
      expect(calculateMultiplier(9)).toBe(3);
    });

    it('returns 4x for streaks >= 10', () => {
      expect(calculateMultiplier(10)).toBe(4);
      expect(calculateMultiplier(25)).toBe(4);
    });
  });

  // ─── Autopilot Detection ──────────────────────────────────────────
  describe('isAutopilotActive', () => {
    it('returns false for null eegData', () => {
      expect(isAutopilotActive(null)).toBe(false);
    });

    it('returns false for clean signal with no artifacts', () => {
      expect(isAutopilotActive(createMockEEGFrame())).toBe(false);
    });

    it('returns true on blink artifact', () => {
      expect(isAutopilotActive(
        createMockEEGFrame({ artifacts: { blink: true, clench: false } })
      )).toBe(true);
    });

    it('returns true on clench artifact', () => {
      expect(isAutopilotActive(
        createMockEEGFrame({ artifacts: { blink: false, clench: true } })
      )).toBe(true);
    });

    it('returns true on poor signal quality', () => {
      expect(isAutopilotActive(
        createMockEEGFrame({ signalQuality: 'poor' })
      )).toBe(true);
    });
  });

  // ─── Ring Pass State Transitions ──────────────────────────────────
  describe('processRingPass', () => {
    it('increments streak by 1', () => {
      const result = processRingPass(0, false);
      expect(result.newStreak).toBe(1);
    });

    it('awards 100 * multiplier points', () => {
      // Streak 0 → 1 (1x)
      expect(processRingPass(0, false).scoreAwarded).toBe(100);
      // Streak 2 → 3 (2x)
      expect(processRingPass(2, false).scoreAwarded).toBe(200);
      // Streak 4 → 5 (3x)
      expect(processRingPass(4, false).scoreAwarded).toBe(300);
      // Streak 9 → 10 (4x)
      expect(processRingPass(9, false).scoreAwarded).toBe(400);
    });

    it('triggers Hyper-Drift when streak reaches 10 and not already active', () => {
      const result = processRingPass(9, false);
      expect(result.triggerHyperDrift).toBe(true);
      expect(result.newMultiplier).toBe(4);
    });

    it('does NOT re-trigger Hyper-Drift when already active', () => {
      const result = processRingPass(9, true);
      expect(result.triggerHyperDrift).toBe(false);
    });

    it('builds correct multiplier progression over a 12-ring streak', () => {
      let streak = 0;
      const multipliers: number[] = [];
      for (let i = 0; i < 12; i++) {
        const result = processRingPass(streak, false);
        streak = result.newStreak;
        multipliers.push(result.newMultiplier);
      }
      // rings 1-2: 1x, rings 3-4: 2x, rings 5-9: 3x, rings 10-12: 4x
      expect(multipliers).toEqual([1, 1, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4]);
    });
  });

  // ─── Ring Miss ────────────────────────────────────────────────────
  describe('processRingMiss', () => {
    it('resets streak to 0', () => {
      expect(processRingMiss().newStreak).toBe(0);
    });

    it('drops multiplier to 1x', () => {
      expect(processRingMiss().newMultiplier).toBe(1);
    });
  });

  // ─── Hyper-Drift Expiry ───────────────────────────────────────────
  describe('processHyperDriftExpiry', () => {
    it('resets streak to 0 to prevent infinite re-trigger', () => {
      const result = processHyperDriftExpiry();
      expect(result.newStreak).toBe(0);
    });

    it('drops multiplier to 1x', () => {
      expect(processHyperDriftExpiry().newMultiplier).toBe(1);
    });

    it('returns hyperDriftActive = false', () => {
      expect(processHyperDriftExpiry().hyperDriftActive).toBe(false);
    });

    it('prevents immediate Hyper-Drift re-entry on next ring pass', () => {
      const expiry = processHyperDriftExpiry();
      // After expiry, streak is 0. Next ring pass → streak 1. Not enough for Hyper-Drift.
      const nextPass = processRingPass(expiry.newStreak, expiry.hyperDriftActive);
      expect(nextPass.triggerHyperDrift).toBe(false);
      expect(nextPass.newMultiplier).toBe(1);
    });
  });

  // ─── Full Gameplay Cycle ──────────────────────────────────────────
  describe('full gameplay cycle: build → hyper-drift → expiry → rebuild', () => {
    it('simulates a realistic session loop', () => {
      let streak = 0;
      let multiplier: 1 | 2 | 3 | 4 = 1;
      let hyperDriftActive = false;
      let score = 0;

      // Phase 1: Build streak to 10
      for (let i = 0; i < 10; i++) {
        const result = processRingPass(streak, hyperDriftActive);
        streak = result.newStreak;
        multiplier = result.newMultiplier;
        score += result.scoreAwarded;
        if (result.triggerHyperDrift) hyperDriftActive = true;
      }

      expect(streak).toBe(10);
      expect(multiplier).toBe(4);
      expect(hyperDriftActive).toBe(true);
      // Score: 1*100 + 1*100 + 2*100 + 2*100 + 3*100 + 3*100 + 3*100 + 3*100 + 3*100 + 4*100
      expect(score).toBe(2500);

      // Phase 2: Hyper-Drift expires
      const expiry = processHyperDriftExpiry();
      streak = expiry.newStreak;
      multiplier = expiry.newMultiplier;
      hyperDriftActive = expiry.hyperDriftActive;

      expect(streak).toBe(0);
      expect(multiplier).toBe(1);
      expect(hyperDriftActive).toBe(false);

      // Phase 3: Miss a ring
      const miss = processRingMiss();
      streak = miss.newStreak;
      multiplier = miss.newMultiplier;

      expect(streak).toBe(0);

      // Phase 4: Start rebuilding
      const rebuild = processRingPass(streak, hyperDriftActive);
      expect(rebuild.newStreak).toBe(1);
      expect(rebuild.newMultiplier).toBe(1);
      expect(rebuild.scoreAwarded).toBe(100);
    });
  });

  // ─── Speed & Dampening ────────────────────────────────────────────
  describe('computeBaseSpeed', () => {
    it('returns higher speed for higher zoneScore', () => {
      expect(computeBaseSpeed(1.0, false)).toBeGreaterThan(computeBaseSpeed(0.0, false));
    });

    it('applies 1.4x multiplier during Hyper-Drift', () => {
      const normal = computeBaseSpeed(0.5, false);
      const hyper = computeBaseSpeed(0.5, true);
      expect(hyper).toBeCloseTo(normal * 1.4);
    });
  });

  describe('dampenPitch', () => {
    it('decays pitch by 12% per tick', () => {
      expect(dampenPitch(1.0)).toBeCloseTo(0.88);
      expect(dampenPitch(0.5)).toBeCloseTo(0.44);
    });

    it('converges toward zero over repeated applications', () => {
      let pitch = 1.0;
      for (let i = 0; i < 30; i++) pitch = dampenPitch(pitch);
      expect(pitch).toBeLessThan(0.025); // 0.88^30 ≈ 0.0216
    });
  });

  // ─── AudioEngine Skyline Extensions (Smoke Tests) ─────────────────
  describe('AudioEngine Skyline extensions (headless SSR safety)', () => {
    it('exposes all Skyline methods without throwing in Node', () => {
      expect(typeof audioEngine.playPentatonicRingArpeggio).toBe('function');
      expect(typeof audioEngine.playShardCollect).toBe('function');
      expect(typeof audioEngine.playHyperDriftStinger).toBe('function');
      expect(typeof audioEngine.updateFlightWind).toBe('function');
      expect(typeof audioEngine.stopFlightWind).toBe('function');

      expect(() => audioEngine.playPentatonicRingArpeggio(5)).not.toThrow();
      expect(() => audioEngine.playShardCollect()).not.toThrow();
      expect(() => audioEngine.playHyperDriftStinger()).not.toThrow();
      expect(() => audioEngine.updateFlightWind(1.2, true)).not.toThrow();
      expect(() => audioEngine.stopFlightWind()).not.toThrow();
    });
  });
});
