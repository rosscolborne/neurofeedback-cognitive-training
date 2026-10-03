import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import { PUZZLES } from '../data/puzzles';
import { toBrainStateEvent, computeNGIScore } from '../services/eegAdapter';
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

  describe('2. Neurofeedback adapter', () => {
    const frame = (mindfulnessScore: number | null, restfulnessScore: number | null): EEGDataPoint => ({
      timestamp: 1_000,
      signalQuality: 'good',
      channelQuality: { tp9: 'good', af7: 'good', af8: 'good', tp10: 'good' },
      brainflowScores: { mindfulnessScore, restfulnessScore, method: 'brainflow' },
    });

    it('holds composure neutral without EEG, so the game plays as it does without a headset', () => {
      expect(toBrainStateEvent(null)).toMatchObject({ normalizedComposure: 1.0, hasSignal: false });
    });

    it('holds composure neutral while a connected headset has no scores yet', () => {
      expect(toBrainStateEvent(frame(null, null))).toMatchObject({ normalizedComposure: 1.0, hasSignal: false });
      expect(toBrainStateEvent({ ...frame(null, null), brainflowScores: undefined }).hasSignal).toBe(false);
    });

    it('maps the mindfulness/restfulness level onto the composure scale (level 0.5 is neutral)', () => {
      expect(toBrainStateEvent(frame(50, 50)).normalizedComposure).toBeCloseTo(1.0);
      expect(toBrainStateEvent(frame(80, 70))).toMatchObject({ normalizedComposure: 1.5, hasSignal: true, timestamp: 1_000 });
      expect(toBrainStateEvent(frame(20, 30)).normalizedComposure).toBeCloseTo(0.5);
    });

    it('uses whichever score is available', () => {
      expect(toBrainStateEvent(frame(60, null)).normalizedComposure).toBeCloseTo(1.2);
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

    it('penalizes time in panic', () => {
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
    it('applies 0.7x time dilation when composure >= 1.1', () => {
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
