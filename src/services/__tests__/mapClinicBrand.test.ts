import { describe, expect, it } from 'vitest';
import type { ClinicBrandConfig } from '../../types';
import { mapClinicBrand } from '../brandEngine';

const brand: ClinicBrandConfig = {
  clinicId: 'clinic-1', name: 'North Clinic', tagline: 'Training', logoUrl: '/app-logo.png',
  primaryAccent: '#A8482F', primaryHover: '#8F3D28', primarySubtle: '#FBF2EE', onPrimary: '#FFFFFF',
  patientBaseSurface: '#F8F7F4', clinicianBaseSurface: '#FAFAFA', typographyStyle: 'editorial-serif',
  createdAt: '2026-01-01T00:00:00Z',
};

describe('mapClinicBrand (a linked patient\'s clinic branding)', () => {
  it('does not expose malformed, low-contrast or another clinic\'s branding', () => {
    expect(mapClinicBrand({ ...brand, primaryAccent: 'not-a-color' }, 'clinic-1')).toBeNull();
    expect(mapClinicBrand({ ...brand, primaryAccent: '#D16D4D' }, 'clinic-1')).toBeNull();
    expect(mapClinicBrand(brand, 'clinic-2')).toBeNull();
    expect(mapClinicBrand({ ...brand, primaryHover: 'bad', onPrimary: 'bad', logoUrl: 'javascript:alert(1)' }, 'clinic-1')).toMatchObject({
      primaryHover: '#8f3d28', onPrimary: '#FFFFFF', logoUrl: '/app-logo.png',
    });
  });
});
