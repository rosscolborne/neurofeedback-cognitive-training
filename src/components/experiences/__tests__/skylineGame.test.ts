import { describe, expect, it } from 'vitest';
import { audioEngine } from '../../../services/audioEngine';
import type { EEGDataPoint } from '../../../types';
import {
  computeTargetElevation,
  isAutopilotActive,
  computeBaseSpeed,
  dampenPitch,
  updateFlowProgression,
  computeSkyAtmosphere,
  spawnNextLandmark,
  isWaterSkimming,
  calculateFlockOffsets,
  computeStreamNodes,
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

describe('Skyline Drift Meditative Flight Mechanics', () => {
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

  // ─── Continuous Flow Progression (Replaces Circle Rings) ───────────
  describe('updateFlowProgression', () => {
    it('starts at 1x multiplier for < 3 seconds in-zone', () => {
      const result = updateFlowProgression(0, 1.0, true, false);
      expect(result.multiplier).toBe(1);
      expect(result.newInZoneSeconds).toBe(1.0);
      expect(result.triggerHyperDrift).toBe(false);
    });

    it('reaches 2x multiplier at 3 seconds in-zone', () => {
      const result = updateFlowProgression(2.5, 0.6, true, false);
      expect(result.multiplier).toBe(2);
      expect(result.newInZoneSeconds).toBeCloseTo(3.1);
    });

    it('reaches 3x multiplier at 7 seconds in-zone', () => {
      const result = updateFlowProgression(6.8, 0.5, true, false);
      expect(result.multiplier).toBe(3);
    });

    it('reaches 4x Flow State (Hyper-Drift) at 12 seconds in-zone', () => {
      const result = updateFlowProgression(11.8, 0.3, true, false);
      expect(result.multiplier).toBe(4);
      expect(result.triggerHyperDrift).toBe(true);
    });

    it('gracefully decays in-zone seconds when out of zone without dropping to zero instantly', () => {
      const result = updateFlowProgression(5.0, 1.0, false, false);
      expect(result.newInZoneSeconds).toBeCloseTo(3.8); // 5.0 - 1.2
      expect(result.multiplier).toBe(2); // Still in 2x, gentle transition
    });
  });

  // ─── Autopilot / Gyroscopic Stabilization ─────────────────────────
  describe('isAutopilotActive', () => {
    it('returns false for clean signal without artifacts', () => {
      const clean = createMockEEGFrame();
      expect(isAutopilotActive(clean)).toBe(false);
    });

    it('engages autopilot on blink artifact', () => {
      const blink = createMockEEGFrame({ artifacts: { blink: true, clench: false } });
      expect(isAutopilotActive(blink)).toBe(true);
    });

    it('engages autopilot on jaw clench', () => {
      const clench = createMockEEGFrame({ artifacts: { blink: false, clench: true } });
      expect(isAutopilotActive(clench)).toBe(true);
    });
  });

  // ─── Flight Speed & Dampening ─────────────────────────────────────
  describe('computeBaseSpeed', () => {
    it('scales monotonically with zoneScore', () => {
      const low = computeBaseSpeed(0.0, false);
      const high = computeBaseSpeed(1.0, false);
      expect(high).toBeGreaterThan(low);
    });

    it('boosts speed during Hyper-Drift', () => {
      const normal = computeBaseSpeed(0.5, false);
      const hyper = computeBaseSpeed(0.5, true);
      expect(hyper).toBeCloseTo(normal * 1.4);
    });
  });

  describe('dampenPitch', () => {
    it('decays pitch by 12% per tick', () => {
      expect(dampenPitch(1.0)).toBeCloseTo(0.88);
    });
  });

  // ─── Spirit Flock Geometry ─────────────────────────────────────────
  describe('calculateFlockOffsets', () => {
    it('returns 1 bird for flockCount=1', () => {
      const birds = calculateFlockOffsets(1);
      expect(birds.length).toBe(1);
      expect(birds[0].offsetX).toBeLessThan(0); // Left wing
    });

    it('returns 3 birds for flockCount=3 in delta formation', () => {
      const birds = calculateFlockOffsets(3);
      expect(birds.length).toBe(3);
      expect(birds[0].offsetX).toBe(-42);
      expect(birds[1].offsetX).toBe(42);
    });

    it('returns up to 7 birds in full V-formation', () => {
      const birds = calculateFlockOffsets(7);
      expect(birds.length).toBe(7);
    });
  });

  // ─── Wind Stream Nodes ─────────────────────────────────────────────
  describe('computeStreamNodes', () => {
    it('generates 10 3D nodes progressing in depth', () => {
      const nodes = computeStreamNodes(1000, 0.5);
      expect(nodes.length).toBe(10);
      expect(nodes[0].z).toBeLessThan(nodes[9].z);
    });
  });

  // ─── Atmospheric Odyssey ──────────────────────────────────────────
  describe('computeSkyAtmosphere', () => {
    it('returns Alpine Dawn at time 0.0', () => {
      const atmo = computeSkyAtmosphere(0.0);
      expect(atmo.name).toBe('Alpine Dawn');
      expect(atmo.isNight).toBe(false);
    });

    it('returns Alpine Noon at time 0.25', () => {
      const atmo = computeSkyAtmosphere(0.25);
      expect(atmo.name).toBe('Alpine Noon');
    });

    it('returns Violet Twilight with night mode at time 0.75', () => {
      const atmo = computeSkyAtmosphere(0.75);
      expect(atmo.name).toBe('Violet Twilight');
      expect(atmo.isNight).toBe(true);
    });
  });

  // ─── Procedural Landmarks ─────────────────────────────────────────
  describe('spawnNextLandmark', () => {
    it('spawns an ancient arch around 405m', () => {
      expect(spawnNextLandmark(405)).toBe('arch');
    });

    it('spawns a waterfall around 1005m', () => {
      expect(spawnNextLandmark(1005)).toBe('waterfall');
    });
  });

  // ─── Water Physics ────────────────────────────────────────────────
  describe('isWaterSkimming', () => {
    it('detects river skimming when elevation >= 0.72', () => {
      expect(isWaterSkimming(0.75)).toBe(true);
      expect(isWaterSkimming(0.50)).toBe(false);
    });
  });

  // ─── Audio Engine Smoke Tests ─────────────────────────────────────
  describe('AudioEngine (headless SSR safety)', () => {
    it('exposes all audio methods without throwing in Node', () => {
      expect(typeof audioEngine.updateAmbientFlowLayers).toBe('function');
      expect(typeof audioEngine.updateWaterSkimSound).toBe('function');
      expect(typeof audioEngine.playUpdraftWhoosh).toBe('function');
      expect(() => audioEngine.updateAmbientFlowLayers(2, true)).not.toThrow();
      expect(() => audioEngine.updateWaterSkimSound(true)).not.toThrow();
      expect(() => audioEngine.playUpdraftWhoosh()).not.toThrow();
    });
  });
});
