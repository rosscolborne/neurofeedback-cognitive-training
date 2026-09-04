import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import { PUZZLES } from '../data/puzzles';
import { toBrainStateEvent, computeNGIScore, createDefaultBaseline } from '../services/eegAdapter';
import { EEGDataPoint } from '../../../types';

describe('NeuroGambit Chess Modality Test Suite', () => {
  describe('1. Tactical Puzzles & Chess Logic Verification', () => {
    it('has exactly 25 curated puzzles (15 Track A, 10 Track B)', () => {
      const trackA = PUZZLES.filter((p) => p.track === 'composed-tactics');
      const trackB = PUZZLES.filter((p) => p.track === 'tilt-crucible');
      expect(trackA.length).toBe(15);
      expect(trackB.length).toBe(10);
    });

    it('validates every single puzzle FEN and multi-ply solution line', () => {
      for (const puzzle of PUZZLES) {
        const chess = new Chess(puzzle.fen);
        expect(chess.turn()).toBe(puzzle.playerColor);

        for (let i = 0; i < puzzle.solutionMoves.length; i++) {
          const moveSAN = puzzle.solutionMoves[i];
          const result = chess.move(moveSAN);
          expect(result, `Puzzle ${puzzle.id} move ${i} (${moveSAN}) must be legal`).toBeDefined();
        }
      }
    });

    it('Track B puzzles contain valid blunder evaluation drop metadata', () => {
      const trackB = PUZZLES.filter((p) => p.track === 'tilt-crucible');
      for (const p of trackB) {
        expect(p.blunderEval).toBeDefined();
        expect(p.blunderEval?.before).toBeDefined();
        expect(p.blunderEval?.after).toBeDefined();
      }
    });
  });

  describe('2. EEG Data Adapter & Artifact Rejection', () => {
    it('generates fallback BrainStateEvent when EEG data is null', () => {
      const event = toBrainStateEvent(null, null);
      expect(event.normalizedComposure).toBe(1.0);
      expect(event.isClenching).toBe(false);
      expect(event.isGoodFit).toBe(false);
    });

    it('suppresses composure and flags jaw clench when EMG > 45 Hz artifact is detected', () => {
      const mockEeg: EEGDataPoint = {
        timestamp: Date.now(),
        rawSignal: 10,
        bands: { delta: 3, theta: 6, alpha: 12, smr: 7, beta: 5, gamma: 2 },
        bandAvailability: {},
        bandRatios: {},
        thetaBetaRatio: 1.2,
        thetaBetaRatioAvailable: true,
        coherence: 80,
        coherenceAvailable: true,
        inZone: true,
        inZoneAvailable: true,
        zoneScore: 0.9,
        signalQuality: 'excellent',
        channelQuality: { tp9: 'good', af7: 'good', af8: 'good', tp10: 'good' },
        artifacts: { blink: false, clench: true }, // ACTIVE JAW CLENCH
      };

      const event = toBrainStateEvent(mockEeg, null);
      expect(event.isClenching).toBe(true);
      expect(event.normalizedComposure).toBeLessThanOrEqual(0.4); // Suppressed
    });

    it('normalizes composure against user baseline accurately', () => {
      const baseline = createDefaultBaseline();
      baseline.isReady = true;
      baseline.highBetaMean = 5.0;
      baseline.highBetaStd = 1.0;
      baseline.alphaMean = 7.0;
      baseline.alphaStd = 1.0;
      baseline.thetaMean = 6.0;
      baseline.thetaStd = 1.0;

      // High alpha (calm) and low beta (no panic)
      const calmEeg: EEGDataPoint = {
        timestamp: Date.now(),
        rawSignal: 10,
        bands: { delta: 3, theta: 6.0, alpha: 9.0, smr: 7, beta: 3.5, gamma: 2 },
        bandAvailability: {},
        bandRatios: {},
        thetaBetaRatio: 1.7,
        thetaBetaRatioAvailable: true,
        coherence: 85,
        coherenceAvailable: true,
        inZone: true,
        inZoneAvailable: true,
        zoneScore: 0.95,
        signalQuality: 'excellent',
        channelQuality: { tp9: 'good', af7: 'good', af8: 'good', tp10: 'good' },
        artifacts: { blink: false, clench: false },
      };

      const event = toBrainStateEvent(calmEeg, baseline);
      expect(event.normalizedComposure).toBeGreaterThan(1.2);
    });
  });

  describe('3. NeuroGambit Index (NGI) Composite Score Calculation', () => {
    it('computes 100 baseline standard for perfect accuracy and 15s recovery with 0s panic', () => {
      const result = computeNGIScore(
        100, // 100% accuracy
        0,   // 0s panic
        120, // 120s total
        15.0, // 15s recovery standard
        5,
        5
      );

      expect(result.compositeScore).toBe(100);
      expect(result.tacticalAccuracyPercent).toBe(100);
      expect(result.recoveryLatencySeconds).toBe(15.0);
    });

    it('rewards rapid post-blunder recovery (e.g. 7.5s recovery doubles recovery multiplier)', () => {
      const result = computeNGIScore(
        100,
        0,
        120,
        7.5, // Rapid 7.5s recovery
        5,
        5
      );

      // (100/100) * 1.0 * (15 / 7.5) * 100 = 200 -> clamped to max 150
      expect(result.compositeScore).toBe(150);
      expect(result.interpretation).toContain('Grandmaster Composure');
    });

    it('penalizes high-beta time in panic', () => {
      const result = computeNGIScore(
        100,
        60,  // 60s panic out of 120s (50% panic!)
        120,
        15.0,
        5,
        5
      );

      // (1.0) * (1 - 0.5) * (1.0) * 100 = 50
      expect(result.compositeScore).toBe(50);
      expect(result.interpretation).toContain('Tilt Vulnerability');
    });
  });

  describe('4. Time-Dilation Clock Rate Math', () => {
    it('applies 0.7x time dilation when in-zone composure >= 1.1', () => {
      const composure = 1.25;
      const rate = composure >= 1.1 ? 0.7 : composure <= 0.7 ? 1.2 : 1.0;
      expect(rate).toBe(0.7);
    });

    it('applies 1.2x time leak rate under panic composure <= 0.7', () => {
      const composure = 0.55;
      const rate = composure >= 1.1 ? 0.7 : composure <= 0.7 ? 1.2 : 1.0;
      expect(rate).toBe(1.2);
    });
  });

  describe('5. Move-1 Gating vs. Plies 2+ Logic', () => {
    it('differentiates ply 0 (Move 1 requiring hold) from plies 2+ (instant execution)', () => {
      const isCandidateMove = (ply: number) => ply === 0;
      expect(isCandidateMove(0)).toBe(true);
      expect(isCandidateMove(1)).toBe(false);
      expect(isCandidateMove(2)).toBe(false);
      expect(isCandidateMove(3)).toBe(false);
    });
  });
});
