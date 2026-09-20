import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/clinicSettingsRepository', () => ({
  clinicSettingsRepository: { load: vi.fn(() => new Promise(() => undefined)), saveSettings: vi.fn(), saveBrand: vi.fn() },
}));

import { ClinicSettingsView } from '../ClinicSettingsView';
import { ClinicCustomizerModal } from '../../brand/ClinicCustomizerModal';

const safeBrand = { clinicId: 'app', name: 'Waveable', tagline: '', logoUrl: '/app-logo.png', primaryAccent: '#A8482F', primaryHover: '#8F3D28', primarySubtle: '#FBF2EE', onPrimary: '#FFFFFF', patientBaseSurface: '#F8F7F4', clinicianBaseSurface: '#FAFAFA', typographyStyle: 'editorial-serif' as const, createdAt: '' };

describe('ClinicSettingsView initial state', () => {
  it('renders loading/blank contracts without fabricated practitioner or hardware readiness', () => {
    const html = renderToStaticMarkup(<ClinicSettingsView
      brand={safeBrand}
      onOpenRebrand={() => undefined}
      onClearDemoData={() => undefined}
      onResetDemoData={() => undefined}
    />);

    expect(html).toContain('Loading clinic settings');
    expect(html).toContain('not a live device or patient assignment status');
    expect(html).not.toContain('Dr. Vance');
    expect(html).not.toContain('Driver Ready');
    expect(html).not.toContain('Wipe Sample Demo Data');
  });

  it('locks modal close, form, color, logo, and save controls while remote branding loads', () => {
    const html = renderToStaticMarkup(<ClinicCustomizerModal currentBrand={safeBrand} onSave={() => undefined} onClose={() => undefined} />);
    expect(html).toMatch(/<button disabled=""[^>]*aria-label="Close clinic branding customizer"/);
    expect(html).toMatch(/<input type="file"[^>]*disabled=""/);
    expect(html).toMatch(/<input type="color" disabled=""[^>]*value="#A8482F"/);
    expect((html.match(/disabled=""/g) || []).length).toBeGreaterThanOrEqual(10);
  });
});
