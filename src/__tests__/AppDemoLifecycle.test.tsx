import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  value: { user: { uid: 'demo-clinician', displayName: 'Sample clinician' }, role: 'clinician', loading: false, isDemoWorkspace: true, logout: vi.fn() } as Record<string, unknown>,
}));
const storage = vi.hoisted(() => ({
  getBrandConfig: vi.fn(() => ({ clinicId: 'app', name: 'Waveable', logoUrl: '', primaryAccent: '#000', primaryHover: '#000', primarySubtle: '#fff', onPrimary: '#fff', patientBaseSurface: '#fff', clinicianBaseSurface: '#fff', typographyStyle: 'modern-sans', createdAt: '' })),
  getClients: vi.fn(), getPatientInvitationsForClinician: vi.fn(), getCurrentClient: vi.fn(),
  getClinicBrandConfig: vi.fn(), createPatientInvitation: vi.fn(),
}));
const settings = vi.hoisted(() => ({ load: vi.fn() }));

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => authState.value }));
vi.mock('../services/storageEngine', () => ({ storageEngine: storage }));
vi.mock('../services/brandEngine', () => ({
  applyBrandToDOM: vi.fn(),
  BRAND_PRESETS: [{ clinicId: 'app', name: 'Waveable', logoUrl: '', primaryAccent: '#000', primaryHover: '#000', primarySubtle: '#fff', onPrimary: '#fff', patientBaseSurface: '#fff', clinicianBaseSurface: '#fff', typographyStyle: 'modern-sans', createdAt: '' }],
}));
vi.mock('../services/clinicSettingsRepository', () => ({
  clinicSettingsRepository: settings,
}));
vi.mock('../components/clinician/ClinicianShell', () => ({ ClinicianShell: 'clinician-shell' }));
vi.mock('../components/patient/PatientShell', () => ({ PatientShell: 'patient-shell' }));
vi.mock('../components/brand/ClinicCustomizerModal', () => ({ ClinicCustomizerModal: 'brand-modal' }));
vi.mock('../components/brand/BrandLogo', () => ({ BrandLogo: 'brand-logo' }));
vi.mock('../pages/onboarding/Welcome', () => ({ Welcome: 'welcome-page' }));
vi.mock('../pages/onboarding/SignUp', () => ({ SignUp: 'signup-page' }));
vi.mock('../pages/onboarding/Login', () => ({ Login: 'login-page' }));
vi.mock('../pages/onboarding/RoleSelection', () => ({ RoleSelection: 'role-page' }));
vi.mock('../pages/onboarding/HardwareSetup', () => ({ HardwareSetup: 'hardware-page' }));
vi.mock('../pages/legal/PrivacyPolicy', () => ({ PrivacyPolicy: 'privacy-page' }));
vi.mock('../pages/legal/TermsOfService', () => ({ TermsOfService: 'terms-page' }));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    Routes: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Route: ({ path, element }: { path: string; element: React.ReactNode }) => path === '/' ? element : null,
    Navigate: () => null,
    useLocation: () => ({ pathname: '/' }), useNavigate: () => vi.fn(), useParams: () => ({}),
  };
});

import { App } from '../App';

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const shell = (renderer: ReactTestRenderer): ReactTestInstance => renderer.root.find((node) => (node.type as unknown) === 'clinician-shell');
const patientShell = (renderer: ReactTestRenderer): ReactTestInstance => renderer.root.find((node) => (node.type as unknown) === 'patient-shell');

describe('mounted App account/workspace lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    authState.value = { user: { uid: 'demo-clinician', displayName: 'Sample clinician' }, role: 'clinician', loading: false, isDemoWorkspace: true, logout: vi.fn() };
    storage.getClients.mockResolvedValue([{ id: 'sample-patient', name: 'Sample' }]);
    storage.getPatientInvitationsForClinician.mockResolvedValue([]);
    settings.load.mockResolvedValue({ clinicId: 'clinic-1', clinic: { id: 'clinic-1' }, practitioner: { id: 'clinician-1' }, brand: null });
  });

  it('clears demo state immediately and keeps independent successful loads after a real-account read fails', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<App />); await flush(); });
    expect(shell(renderer).props.isDemoWorkspace).toBe(true);
    expect(shell(renderer).props.clients).toEqual([{ id: 'sample-patient', name: 'Sample' }]);

    authState.value = { user: { uid: 'real-clinician', displayName: 'Real clinician' }, role: 'clinician', loading: false, isDemoWorkspace: false, logout: vi.fn() };
    storage.getClients.mockRejectedValueOnce(new Error('roster offline'));
    storage.getPatientInvitationsForClinician.mockResolvedValueOnce([{ id: 'real-invitation' }]);

    act(() => { renderer.update(<App />); });
    expect(shell(renderer).props.isDemoWorkspace).toBe(false);
    expect(shell(renderer).props.clients).toEqual([]);
    await act(flush);
    expect(shell(renderer).props.clients).toEqual([]);
    expect(shell(renderer).props.patientInvitations).toEqual([{ id: 'real-invitation' }]);
    renderer.unmount();
  });

  it('rejects stale async and subscription results from the prior workspace generation', async () => {
    let resolveDemoRoster!: (value: unknown[]) => void;
    storage.getClients.mockReturnValueOnce(new Promise((resolve) => { resolveDemoRoster = resolve; }));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<App />); });

    authState.value = { user: { uid: 'real-clinician' }, role: 'clinician', loading: false, isDemoWorkspace: false, logout: vi.fn() };
    storage.getClients.mockResolvedValueOnce([]);
    storage.getPatientInvitationsForClinician.mockResolvedValueOnce([]);
    act(() => { renderer.update(<App />); });
    await act(async () => { resolveDemoRoster([{ id: 'late-sample-patient' }]); await flush(); });
    expect(shell(renderer).props.clients).toEqual([]);
    renderer.unmount();
  });

  it('hydrates branding per account and ignores a late brand from the previous account', async () => {
    let resolveFirst!: (value: unknown) => void;
    authState.value = { user: { uid: 'clinician-one' }, role: 'clinician', loading: false, isDemoWorkspace: false, logout: vi.fn() };
    settings.load.mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<App />); });

    const secondBrand = { ...storage.getBrandConfig(), clinicId: 'clinic-two', name: 'Clinic Two' };
    authState.value = { user: { uid: 'clinician-two' }, role: 'clinician', loading: false, isDemoWorkspace: false, logout: vi.fn() };
    settings.load.mockResolvedValueOnce({ clinicId: 'clinic-two', clinic: { id: 'clinic-two' }, practitioner: { id: 'clinician-two' }, brand: secondBrand });
    await act(async () => { renderer.update(<App />); await flush(); });
    expect(shell(renderer).props.brand).toMatchObject({ clinicId: 'clinic-two', name: 'Clinic Two' });

    await act(async () => {
      resolveFirst({ clinicId: 'clinic-one', clinic: { id: 'clinic-one' }, practitioner: { id: 'clinician-one' }, brand: { ...secondBrand, clinicId: 'clinic-one', name: 'Clinic One' } });
      await flush();
    });
    expect(shell(renderer).props.brand).toMatchObject({ clinicId: 'clinic-two', name: 'Clinic Two' });
    renderer.unmount();
  });

  it('loads the linked patient clinic brand and uses the clinician clinic on new invitations', async () => {
    const patientBrand = { ...storage.getBrandConfig(), clinicId: 'patient-clinic', name: 'Patient Clinic' };
    authState.value = { user: { uid: 'patient-one', email: 'patient@example.com' }, role: 'patient', loading: false, isDemoWorkspace: false, logout: vi.fn() };
    storage.getCurrentClient.mockResolvedValueOnce({ id: 'patient-one', clinicId: 'patient-clinic' });
    storage.getClinicBrandConfig.mockResolvedValueOnce(patientBrand);
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<App />); await flush(); await flush(); });
    expect(patientShell(renderer).props.brand).toMatchObject({ clinicId: 'patient-clinic', name: 'Patient Clinic' });
    expect(storage.getClinicBrandConfig).toHaveBeenCalledWith('patient-clinic');
    renderer.unmount();

    authState.value = { user: { uid: 'clinician-one' }, role: 'clinician', loading: false, isDemoWorkspace: false, logout: vi.fn() };
    settings.load.mockResolvedValueOnce({ clinicId: 'clinic-one', clinic: { id: 'clinic-one' }, practitioner: { id: 'clinician-one' }, brand: null });
    storage.createPatientInvitation.mockResolvedValueOnce({ id: 'INVITE' });
    await act(async () => { renderer = create(<App />); await flush(); });
    await act(async () => {
      await shell(renderer).props.onAddClient({ email: 'new@example.com', name: 'New Patient' });
    });
    expect(storage.createPatientInvitation).toHaveBeenCalledWith(expect.objectContaining({ clinicId: 'clinic-one' }));
    renderer.unmount();
  });
});
