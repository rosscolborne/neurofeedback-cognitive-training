import { describe, expect, it } from 'vitest';
import { clinicianDemoEnabledForEnvironment } from '../clinicianDemoBoundary';

describe('clinician sample workspace deployment boundary', () => {
  it('is disabled by default for a production build', () => {
    expect(clinicianDemoEnabledForEnvironment(false)).toBe(false);
    expect(clinicianDemoEnabledForEnvironment(false, 'production')).toBe(false);
  });

  it('requires local development or an explicitly designated demo deployment', () => {
    expect(clinicianDemoEnabledForEnvironment(true)).toBe(true);
    expect(clinicianDemoEnabledForEnvironment(false, 'demo')).toBe(true);
  });
});
