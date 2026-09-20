import type { ClinicSettingsSnapshot } from './clinicSettingsRepository';
import type { PractitionerProfile } from '../types';

export type SettingsLoadState =
  | { status: 'loading' }
  | { status: 'ready'; snapshot: ClinicSettingsSnapshot }
  | { status: 'error'; message: string };

export type SettingsSaveState = 'idle' | 'saving' | 'saved' | 'error';
export type SettingsSaveEvent = 'edit' | 'submit' | 'success' | 'failure';

export const transitionSettingsSaveState = (_current: SettingsSaveState, event: SettingsSaveEvent): SettingsSaveState => ({
  edit: 'idle',
  submit: 'saving',
  success: 'saved',
  failure: 'error',
})[event] as SettingsSaveState;

export const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.trim() ? error.message : fallback;

export const primaryLicenseIdentifier = (practitioner: PractitionerProfile | null): string => {
  const identifier = practitioner?.credentials.find((credential) => credential.id === 'primary-license')?.identifier;
  return typeof identifier === 'string' ? identifier : '';
};

export interface PrimaryLicensePresentation {
  persistedStatusLabel: string | null;
  guidance: string;
  identifierChanged: boolean;
}

const credentialStatusLabel = (status: PractitionerProfile['credentials'][number]['status']): string => ({
  verified: 'Verified',
  pending: 'Pending verification',
  unverified: 'Unverified',
  expired: 'Expired',
  revoked: 'Revoked',
})[status] ?? 'Unverified';

/** Describes the persisted primary credential separately from the effect of the current draft. */
export const primaryLicensePresentation = (
  practitioner: PractitionerProfile | null,
  draftIdentifier: string,
): PrimaryLicensePresentation => {
  const credential = practitioner?.credentials.find((candidate) => candidate.id === 'primary-license');
  if (!credential) {
    return {
      persistedStatusLabel: null,
      identifierChanged: draftIdentifier.trim().length > 0,
      guidance: draftIdentifier.trim()
        ? 'This new identifier will be saved as Unverified. Verification is a separate process.'
        : 'New identifiers are saved as Unverified. Verification is a separate process.',
    };
  }

  const persistedIdentifier = typeof credential.identifier === 'string' ? credential.identifier.trim() : '';
  const identifierChanged = draftIdentifier.trim() !== persistedIdentifier;
  const persistedStatusLabel = credentialStatusLabel(credential.status);

  if (identifierChanged) {
    return {
      persistedStatusLabel,
      identifierChanged,
      guidance: 'Changing or clearing the identifier will save the replacement as Unverified. The existing verification metadata is preserved only when the identifier is unchanged.',
    };
  }

  return {
    persistedStatusLabel,
    identifierChanged,
    guidance: credential.status === 'verified'
      ? 'Saving this identifier unchanged preserves its Verified status and verification metadata.'
      : `Saving this identifier unchanged preserves its current ${persistedStatusLabel} status.`,
  };
};

export const settingsNotice = (state: SettingsLoadState): string | null => {
  if (state.status === 'loading') return 'Loading clinic settings…';
  if (state.status === 'error') return state.message;
  if (state.snapshot.needsOnboarding) return 'Complete your clinic and practitioner profile to finish setup.';
  if (state.snapshot.brandSource === 'legacy-local') {
    return 'A matching local theme is available. Save it in the theme customizer to sync it to this clinic.';
  }
  return null;
};
