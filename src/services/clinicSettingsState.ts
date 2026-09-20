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

export const settingsNotice = (state: SettingsLoadState): string | null => {
  if (state.status === 'loading') return 'Loading clinic settings…';
  if (state.status === 'error') return state.message;
  if (state.snapshot.needsOnboarding) return 'Complete your clinic and practitioner profile to finish setup.';
  if (state.snapshot.brandSource === 'legacy-local') {
    return 'A matching local theme is available. Save it in the theme customizer to sync it to this clinic.';
  }
  return null;
};
