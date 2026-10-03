import { describe, expect, it } from 'vitest';
import { neurofeedbackLevel } from '../neurofeedbackSignal';

describe('neurofeedbackLevel', () => {
  it('is unavailable without scores', () => {
    expect(neurofeedbackLevel(undefined)).toBeNull();
    expect(neurofeedbackLevel(null)).toBeNull();
    expect(neurofeedbackLevel({ mindfulnessScore: null, restfulnessScore: null })).toBeNull();
    expect(neurofeedbackLevel({ mindfulnessScore: Number.NaN, restfulnessScore: null })).toBeNull();
  });

  it('averages mindfulness and restfulness into a 0–1 level', () => {
    expect(neurofeedbackLevel({ mindfulnessScore: 80, restfulnessScore: 40 })).toBeCloseTo(0.6);
  });

  it('uses whichever score is available', () => {
    expect(neurofeedbackLevel({ mindfulnessScore: 70, restfulnessScore: null })).toBeCloseTo(0.7);
    expect(neurofeedbackLevel({ mindfulnessScore: null, restfulnessScore: 30 })).toBeCloseTo(0.3);
  });

  it('clamps out-of-range scores', () => {
    expect(neurofeedbackLevel({ mindfulnessScore: 140, restfulnessScore: 120 })).toBe(1);
    expect(neurofeedbackLevel({ mindfulnessScore: -20, restfulnessScore: null })).toBe(0);
  });
});
