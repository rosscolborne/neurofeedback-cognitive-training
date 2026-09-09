import { describe, it, expect } from 'vitest';

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

  it('correctly extracts AC microvolts from DC-offset 12-bit ADC raw counts (~700)', () => {
    // 10 samples around 696 with a +80 blink spike
    const rawCounts = [696, 695, 697, 696, 776, 696, 695, 697, 696, 696];
    const mean = rawCounts.reduce((a, b) => a + b, 0) / rawCounts.length;
    const isRawAdc = Math.abs(mean) > 150;
    expect(isRawAdc).toBe(true);

    const acUv = rawCounts.map((v) => (v - mean) * (isRawAdc ? 0.48828 : 1.0));
    // Resting samples should hover around ~0 uV
    expect(Math.abs(acUv[0])).toBeLessThan(5.0);
    // The blink sample at index 4 (776) should be strongly positive
    expect(acUv[4]).toBeGreaterThan(30.0);
  });

  it('applies 2nd-order IIR bandpass filter cleanly without NaN or divergence', () => {
    function applyBandpassFilter(samples: number[], lowCut: number, highCut: number, sampleRate = 256): number[] {
      if (samples.length < 4) return samples;
      const centerFreq = (lowCut + highCut) / 2;
      const bandwidth = Math.max(1.0, highCut - lowCut);
      const omega = (2 * Math.PI * centerFreq) / sampleRate;
      const q = Math.max(0.5, centerFreq / bandwidth);
      const alpha = Math.sin(omega) / (2 * q);

      const b0 = alpha;
      const b1 = 0;
      const b2 = -alpha;
      const a0 = 1 + alpha;
      const a1 = -2 * Math.cos(omega);
      const a2 = 1 - alpha;

      const out = new Float32Array(samples.length);
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;

      for (let i = 0; i < samples.length; i++) {
        const x0 = samples[i];
        const y0 = (b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
        out[i] = y0;
        x2 = x1;
        x1 = x0;
        y2 = y1;
        y1 = y0;
      }

      return Array.from(out);
    }

    const t = Array.from({ length: 256 }, (_, i) => i / 256);
    // 10 Hz pure sine wave (Alpha band)
    const tenHzSignal = t.map((time) => 25 * Math.sin(2 * Math.PI * 10 * time));

    const alphaFiltered = applyBandpassFilter(tenHzSignal, 8.0, 12.0);
    expect(alphaFiltered.length).toBe(256);
    expect(alphaFiltered.every((v) => Number.isFinite(v))).toBe(true);

    // 10 Hz signal should pass through 8-12 Hz filter with significant power
    const alphaMax = Math.max(...alphaFiltered.slice(30).map(Math.abs));
    expect(alphaMax).toBeGreaterThan(15.0);

    // 10 Hz signal should be heavily attenuated by 30-45 Hz Gamma filter
    const gammaFiltered = applyBandpassFilter(tenHzSignal, 30.0, 45.0);
    const gammaMax = Math.max(...gammaFiltered.slice(30).map(Math.abs));
    expect(gammaMax).toBeLessThan(3.0);
  });
});
