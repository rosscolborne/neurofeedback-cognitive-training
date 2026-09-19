import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/clinicSettingsRepository', () => ({
  clinicSettingsRepository: { load: vi.fn(() => new Promise(() => undefined)), saveSettings: vi.fn() },
}));

import { ClinicSettingsView } from '../ClinicSettingsView';

describe('ClinicSettingsView initial state', () => {
  it('renders loading/blank contracts without fabricated practitioner or hardware readiness', () => {
    const html = renderToStaticMarkup(<ClinicSettingsView
      brand={{ clinicId: 'app', name: 'Waveable', tagline: '', logoUrl: '/app-logo.png', primaryAccent: '#D16D4D', primaryHover: '#BA5B3D', primarySubtle: '#FBF2EE', onPrimary: '#FFFFFF', patientBaseSurface: '#F8F7F4', clinicianBaseSurface: '#FAFAFA', typographyStyle: 'editorial-serif', createdAt: '' }}
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
});
