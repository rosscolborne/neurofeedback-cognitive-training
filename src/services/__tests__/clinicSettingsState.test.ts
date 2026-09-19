import { describe, expect, it } from 'vitest';
import { createBrandPalette, getOnPrimaryColor, isValidHexColor } from '../brandEngine';
import { errorMessage, settingsNotice } from '../clinicSettingsState';

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
    expect(() => createBrandPalette('#D16D4D', ' ')).toThrow('Clinic display name');
    expect(getOnPrimaryColor('#FFFFFF')).toBe('#1A1A1A');
    expect(getOnPrimaryColor('#000000')).toBe('#FFFFFF');
  });
});
