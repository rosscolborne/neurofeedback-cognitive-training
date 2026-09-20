export const DEMO_CLINICIAN_ID = 'demo-clinician';
export const DEMO_AUTH_STORAGE_KEY = 'neura_demo_auth';

export const clinicianDemoEnabledForEnvironment = (
  isDevelopment: boolean,
  deploymentMode?: string,
): boolean => isDevelopment || deploymentMode === 'demo';

/**
 * The sample clinician workspace is available in local development or in a
 * build explicitly configured as a demo deployment. Production builds default
 * to false, even if an old demo marker remains in browser storage.
 */
export const CLINICIAN_DEMO_AVAILABLE = clinicianDemoEnabledForEnvironment(
  import.meta.env.DEV,
  import.meta.env.VITE_DEPLOYMENT_MODE,
);

const hasDemoMarker = (): boolean =>
  typeof localStorage !== 'undefined' &&
  localStorage.getItem(DEMO_AUTH_STORAGE_KEY) === 'clinician';

export const isClinicianDemoWorkspace = (authenticatedUid?: string | null): boolean =>
  CLINICIAN_DEMO_AVAILABLE &&
  (authenticatedUid === DEMO_CLINICIAN_ID || hasDemoMarker());

export const clearUnavailableDemoMarker = (): void => {
  if (!CLINICIAN_DEMO_AVAILABLE && typeof localStorage !== 'undefined') {
    localStorage.removeItem(DEMO_AUTH_STORAGE_KEY);
  }
};
