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

export const shouldOfferClinicianDemoWorkspace = (available = CLINICIAN_DEMO_AVAILABLE): boolean => available;

let clinicianDemoWorkspaceActive = false;

export const isClinicianDemoRestoreRequested = (available = CLINICIAN_DEMO_AVAILABLE): boolean =>
  available &&
  typeof localStorage !== 'undefined' &&
  localStorage.getItem(DEMO_AUTH_STORAGE_KEY) === 'clinician';

/** Repository authority is in-memory and can only be changed by AuthProvider. */
export const isClinicianDemoWorkspace = (): boolean =>
  CLINICIAN_DEMO_AVAILABLE && clinicianDemoWorkspaceActive;

export const activateClinicianDemoWorkspace = (): void => {
  if (!CLINICIAN_DEMO_AVAILABLE) throw new Error('The sample clinician workspace is not available in this deployment');
  clinicianDemoWorkspaceActive = true;
};

export const deactivateClinicianDemoWorkspace = (): void => {
  clinicianDemoWorkspaceActive = false;
};

export const rememberClinicianDemoWorkspace = (): void => {
  if (typeof localStorage !== 'undefined') localStorage.setItem(DEMO_AUTH_STORAGE_KEY, 'clinician');
};

export const forgetClinicianDemoWorkspace = (): void => {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(DEMO_AUTH_STORAGE_KEY);
};

export const clearUnavailableDemoMarker = (available = CLINICIAN_DEMO_AVAILABLE): void => {
  if (!available && typeof localStorage !== 'undefined') {
    forgetClinicianDemoWorkspace();
  }
};
