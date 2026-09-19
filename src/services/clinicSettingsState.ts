import type { ClinicSettingsSnapshot } from './clinicSettingsRepository';

export type SettingsLoadState =
  | { status: 'loading' }
  | { status: 'ready'; snapshot: ClinicSettingsSnapshot }
  | { status: 'error'; message: string };

export const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.trim() ? error.message : fallback;

export const settingsNotice = (state: SettingsLoadState): string | null => {
  if (state.status === 'loading') return 'Loading clinic settings…';
  if (state.status === 'error') return state.message;
  if (state.snapshot.needsOnboarding) return 'Complete your clinic and practitioner profile to finish setup.';
  if (state.snapshot.brandSource === 'legacy-local') {
    return 'A matching local theme is available. Save it in the theme customizer to sync it to this clinic.';
  }
  return null;
};
