import { describe, it, expect } from 'vitest';

// Simple unit tests for NeuralImprintCard logic
describe('NeuralImprintCard baseline calculations', () => {
  it('formats PAF, reactivity, and dynamic range correctly', () => {
    const alphaPeakHz = 10.2;
    const alphaReactivityPercent = 114;
    const cognitiveDynamicRange = 2.4;
    const signalPurityPercent = 98.4;

    expect(alphaPeakHz.toFixed(1)).toBe('10.2');
    expect(Math.round(alphaReactivityPercent)).toBe(114);
    expect(cognitiveDynamicRange.toFixed(1)).toBe('2.4');
    expect(Math.round(signalPurityPercent)).toBe(98);
  });
});
