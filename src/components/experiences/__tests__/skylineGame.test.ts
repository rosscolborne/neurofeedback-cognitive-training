import { describe, expect, it } from 'vitest';
import { audioEngine } from '../../../services/audioEngine';
import type { EEGDataPoint } from '../../../types';
import {
  computeTargetElevation,
  isAutopilotActive,
  dampenPitch,
  computeAerodynamics,
  updateAtmosphericMist,
  getExpeditionRegion,
  checkExpeditionMilestone,
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

describe('Skyline Drift Kinetic Soaring Mechanics', () => {
  // ─── Altitude Mapping ──────────────────────────────────────────────
  describe('computeTargetElevation', () => {
    it('maps zoneScore=0 to valley floor (0.80)', () => {
      expect(computeTargetElevation(0.0)).toBeCloseTo(0.80);
    });

    it('maps zoneScore=1 to high stratosphere (0.20)', () => {
      expect(computeTargetElevation(1.0)).toBeCloseTo(0.20);
    });

    it('is strictly monotonic: higher focus = higher altitude (lower Y)', () => {
      const scores = [0.0, 0.25, 0.5, 0.75, 1.0];
      const elevations = scores.map(computeTargetElevation);
      for (let i = 1; i < elevations.length; i++) {
        expect(elevations[i]).toBeLessThan(elevations[i - 1]);
      }
    });
  });

  // ─── Aerodynamic Gliding Physics ──────────────────────────────────
  describe('computeAerodynamics', () => {
    const initialState = {
      gliderY: 0.60,
      pitch: 0,
      roll: 0,
      speed: 1.0,
      verticalVelocity: 0,
    };

    it('climbs and pitches upward when target elevation is higher', () => {
      // targetElevation = 0.30 (higher altitude than 0.60)
      const state = computeAerodynamics(initialState, 0.30, 1.0, false, 0.05, 1000);
      expect(state.pitch).toBeLessThan(0); // Pitched upward
      expect(state.verticalVelocity).toBeLessThan(0); // Upward vertical velocity
    });

    it('dives and gains airspeed momentum when descending', () => {
      // targetElevation = 0.80 (lower altitude than 0.60)
      const state = computeAerodynamics(initialState, 0.80, 1.0, false, 0.05, 1000);
      expect(state.pitch).toBeGreaterThan(0); // Pitched forward/down
      expect(state.speed).toBeGreaterThan(1.0); // Speed momentum boost
    });

    it('dampens pitch and roll when autopilot engages', () => {
      const activeState = { ...initialState, pitch: 0.40, roll: 0.30 };
      const state = computeAerodynamics(activeState, 0.50, 1.0, true, 0.05, 1000);
      expect(state.pitch).toBeCloseTo(0.40 * 0.88);
      expect(state.speed).toBe(1.0);
    });
  });

  // ─── Atmospheric Mist Parting (Clinical Biofeedback) ───────────────
  describe('updateAtmosphericMist', () => {
    it('dissolves mist toward 0.0 when in-zone (revealing sunlight)', () => {
      const mist = updateAtmosphericMist(0.50, true, 0.1);
      expect(mist).toBeLessThan(0.50);
    });

    it('converges to near 0 under sustained in-zone regulation', () => {
      let mist = 0.65;
      for (let i = 0; i < 60; i++) mist = updateAtmosphericMist(mist, true, 0.1);
      expect(mist).toBeLessThan(0.05);
    });

    it('rolls mist in gently when out-of-zone', () => {
      const mist = updateAtmosphericMist(0.10, false, 0.1);
      expect(mist).toBeGreaterThan(0.10);
    });
  });

  // ─── Procedural Scenic Regions ────────────────────────────────────
  describe('getExpeditionRegion', () => {
    it('starts in The Alpine Glades under 600m', () => {
      const r = getExpeditionRegion(250);
      expect(r.id).toBe('alpine-glades');
      expect(r.cloudSeaActive).toBe(false);
    });

    it('transitions to The Great Canyon at 600m', () => {
      const r = getExpeditionRegion(850);
      expect(r.id).toBe('great-canyon');
    });

    it('breaks into The Sunlit Cloud Sea at 1800m', () => {
      const r = getExpeditionRegion(2100);
      expect(r.id).toBe('cloud-sea');
      expect(r.cloudSeaActive).toBe(true);
    });
  });

  // ─── Expedition Milestones ─────────────────────────────────────────
  describe('checkExpeditionMilestone', () => {
    it('triggers the 300m milestone when reached', () => {
      const achieved = new Set<string>();
      const m = checkExpeditionMilestone(320, achieved);
      expect(m).not.toBeNull();
      expect(m?.id).toBe('pine-pass');
    });

    it('does not re-trigger an already achieved milestone', () => {
      const achieved = new Set<string>(['pine-pass']);
      const m = checkExpeditionMilestone(320, achieved);
      expect(m).toBeNull();
    });

    it('triggers subsequent 600m milestone', () => {
      const achieved = new Set<string>(['pine-pass']);
      const m = checkExpeditionMilestone(620, achieved);
      expect(m?.id).toBe('alpine-ridge');
    });
  });

  // ─── Autopilot / Gyroscopic Artifact Detection ────────────────────
  describe('isAutopilotActive', () => {
    it('returns false for clean artifact-free signal', () => {
      const clean = createMockEEGFrame();
      expect(isAutopilotActive(clean)).toBe(false);
    });

    it('engages on blink artifact', () => {
      const blink = createMockEEGFrame({ artifacts: { blink: true, clench: false } });
      expect(isAutopilotActive(blink)).toBe(true);
    });

    it('engages on clench artifact', () => {
      const clench = createMockEEGFrame({ artifacts: { blink: false, clench: true } });
      expect(isAutopilotActive(clench)).toBe(true);
    });
  });

  describe('dampenPitch', () => {
    it('decays pitch by 12% per tick', () => {
      expect(dampenPitch(1.0)).toBeCloseTo(0.88);
    });
  });

  // ─── AudioEngine Smoke Tests ───────────────────────────────────────
  describe('AudioEngine', () => {
    it('exposes methods without throwing in Node', () => {
      expect(typeof audioEngine.updateNeuroFeedback).toBe('function');
      expect(typeof audioEngine.updateFlightWind).toBe('function');
      expect(() => audioEngine.updateNeuroFeedback(true, 1.0)).not.toThrow();
      expect(() => audioEngine.updateFlightWind(1.2, true)).not.toThrow();
    });
  });
});
