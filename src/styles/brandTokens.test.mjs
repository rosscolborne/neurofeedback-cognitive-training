import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The accent used to be applied at runtime from a contrast-checked brand
// preset; it now lives only in the stylesheet, so its contrast is checked here.
const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8');
const token = (name) => css.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6});`))?.[1];

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('brand tokens', () => {
  it('keeps the accent readable as text on every light surface, and text on the accent readable', () => {
    const accent = token('brand-primary');
    expect(accent).toBeDefined();
    for (const surface of ['#FFFFFF', token('surface-patient-base'), token('surface-patient-card')]) {
      expect(surface).toBeDefined();
      expect(contrast(accent, surface)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(token('brand-on-primary'), accent)).toBeGreaterThanOrEqual(4.5);
  });
});
