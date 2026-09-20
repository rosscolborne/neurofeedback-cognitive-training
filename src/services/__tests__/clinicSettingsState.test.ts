import { describe, expect, it } from 'vitest';
import { BRAND_COLOR_PRESETS, createBrandPalette, getOnPrimaryColor, getWorstBrandAccentContrast, isBrandAccentUsable, isValidHexColor } from '../brandEngine';
import { errorMessage, primaryLicenseIdentifier, settingsNotice, transitionSettingsSaveState } from '../clinicSettingsState';

describe('clinic settings display contracts', () => {
  it('distinguishes loading, onboarding, migration, and error copy', () => {
    expect(settingsNotice({ status: 'loading' })).toContain('Loading');
    expect(settingsNotice({ status: 'error', message: 'Permission denied' })).toBe('Permission denied');
    expect(settingsNotice({ status: 'ready', snapshot: { clinic: null, practitioner: null, brand: null, brandSource: 'default', clinicId: 'c', needsOnboarding: true } })).toContain('Complete');
    expect(settingsNotice({ status: 'ready', snapshot: { clinic: null, practitioner: null, brand: null, brandSource: 'legacy-local', clinicId: 'c', needsOnboarding: false } })).toContain('local theme');
  });

  it('keeps unknown errors honest and validates branding input', () => {
    expect(errorMessage('no details', 'Save failed')).toBe('Save failed');
    expect(isValidHexColor('#D16D4D')).toBe(true);
    expect(isValidHexColor('terracotta')).toBe(false);
    expect(() => createBrandPalette('terracotta', 'Clinic')).toThrow('six-digit');
    expect(() => createBrandPalette('#A8482F', ' ')).toThrow('Clinic display name');
    expect(() => createBrandPalette('#D16D4D', 'Clinic')).toThrow('4.5:1');
    expect(BRAND_COLOR_PRESETS.every((preset) => isBrandAccentUsable(preset.accent))).toBe(true);
    expect(isBrandAccentUsable('#767676')).toBe(false);
    expect(getWorstBrandAccentContrast('#767676').ratio).toBeLessThan(4.5);
    expect(getOnPrimaryColor('#FFFFFF')).toBe('#1A1A1A');
    expect(getOnPrimaryColor('#000000')).toBe('#FFFFFF');
  });

  it('resets a visible saved state as soon as a field is edited', () => {
    expect(transitionSettingsSaveState('saved', 'edit')).toBe('idle');
    expect(transitionSettingsSaveState('error', 'edit')).toBe('idle');
  });

  it('selects only the dedicated primary license credential', () => {
    expect(primaryLicenseIdentifier({
      id: 'p', userId: 'p', clinicId: 'c', displayName: 'Name',
      credentials: [
        { id: 'board', type: 'board-certification', label: 'Board', identifier: 'BOARD-1', status: 'verified' },
        { id: 'primary-license', type: 'other', label: 'Primary', identifier: 'PRIMARY-2', status: 'unverified' },
      ],
    })).toBe('PRIMARY-2');
    expect(primaryLicenseIdentifier({
      id: 'p', userId: 'p', clinicId: 'c', displayName: 'Name',
      credentials: [{ id: 'primary-license', type: 'other', label: 'Legacy', identifier: 42 as unknown as string, status: 'unverified' }],
    })).toBe('');
  });
});
