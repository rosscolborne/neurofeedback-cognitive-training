import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activateClinicianDemoWorkspace,
  clearUnavailableDemoMarker,
  clinicianDemoEnabledForEnvironment,
  DEMO_AUTH_STORAGE_KEY,
  deactivateClinicianDemoWorkspace,
  isClinicianDemoWorkspace,
  shouldOfferClinicianDemoWorkspace,
} from '../clinicianDemoBoundary';

describe('clinician sample workspace deployment boundary', () => {
  afterEach(() => {
    deactivateClinicianDemoWorkspace();
    vi.unstubAllGlobals();
  });
  it('is disabled by default for a production build', () => {
    expect(clinicianDemoEnabledForEnvironment(false)).toBe(false);
    expect(clinicianDemoEnabledForEnvironment(false, 'production')).toBe(false);
    expect(shouldOfferClinicianDemoWorkspace(false)).toBe(false);
  });

  it('requires local development or an explicitly designated demo deployment', () => {
    expect(clinicianDemoEnabledForEnvironment(true)).toBe(true);
    expect(clinicianDemoEnabledForEnvironment(false, 'demo')).toBe(true);
  });

  it('clears a stale or tampered marker when the deployment is not demo-enabled', () => {
    const values = new Map([[DEMO_AUTH_STORAGE_KEY, 'clinician']]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    clearUnavailableDemoMarker(false);
    expect(localStorage.getItem(DEMO_AUTH_STORAGE_KEY)).toBeNull();
  });

  it('grants repository authority only after explicit in-memory activation', () => {
    deactivateClinicianDemoWorkspace();
    expect(isClinicianDemoWorkspace()).toBe(false);
    activateClinicianDemoWorkspace();
    expect(isClinicianDemoWorkspace()).toBe(true);
    deactivateClinicianDemoWorkspace();
  });
});
