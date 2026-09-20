import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  value: { user: { uid: 'demo-clinician', displayName: 'Sample clinician' }, role: 'clinician', loading: false, isDemoWorkspace: true, logout: vi.fn() } as Record<string, unknown>,
}));
const storage = vi.hoisted(() => ({
  getBrandConfig: vi.fn(() => ({ clinicId: 'app', name: 'Waveable', logoUrl: '', primaryAccent: '#000', primaryHover: '#000', primarySubtle: '#fff', onPrimary: '#fff', patientBaseSurface: '#fff', clinicianBaseSurface: '#fff', typographyStyle: 'modern-sans', createdAt: '' })),
  getClients: vi.fn(), getPatientInvitationsForClinician: vi.fn(), getAppointments: vi.fn(),
  getCurrentClient: vi.fn(), subscribeToMessages: vi.fn((_callback: (threads: unknown[]) => void, _role?: unknown) => vi.fn()),
}));

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => authState.value }));
vi.mock('../services/storageEngine', () => ({ storageEngine: storage }));
vi.mock('../services/brandEngine', () => ({ applyBrandToDOM: vi.fn() }));
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

describe('mounted App account/workspace lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    authState.value = { user: { uid: 'demo-clinician', displayName: 'Sample clinician' }, role: 'clinician', loading: false, isDemoWorkspace: true, logout: vi.fn() };
    storage.getClients.mockResolvedValue([{ id: 'sample-patient', name: 'Sample' }]);
    storage.getPatientInvitationsForClinician.mockResolvedValue([]);
    storage.getAppointments.mockResolvedValue([]);
    storage.subscribeToMessages.mockImplementation((callback: (threads: unknown[]) => void) => { callback([{ clientId: 'sample-patient' }]); return vi.fn(); });
  });

  it('clears demo state immediately and keeps independent successful loads after a real-account read fails', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<App />); await flush(); });
    expect(shell(renderer).props.isDemoWorkspace).toBe(true);
    expect(shell(renderer).props.clients).toEqual([{ id: 'sample-patient', name: 'Sample' }]);

    authState.value = { user: { uid: 'real-clinician', displayName: 'Real clinician' }, role: 'clinician', loading: false, isDemoWorkspace: false, logout: vi.fn() };
    storage.getClients.mockRejectedValueOnce(new Error('roster offline'));
    storage.getPatientInvitationsForClinician.mockResolvedValueOnce([{ id: 'real-invitation' }]);
    storage.getAppointments.mockResolvedValueOnce([{ id: 'real-appointment' }]);
    storage.subscribeToMessages.mockImplementationOnce((callback: (threads: unknown[]) => void) => { callback([]); return vi.fn(); });

    act(() => { renderer.update(<App />); });
    expect(shell(renderer).props.isDemoWorkspace).toBe(false);
    expect(shell(renderer).props.clients).toEqual([]);
    expect(shell(renderer).props.messages).toEqual([]);
    await act(flush);
    expect(shell(renderer).props.clients).toEqual([]);
    expect(shell(renderer).props.patientInvitations).toEqual([{ id: 'real-invitation' }]);
    expect(shell(renderer).props.appointments).toEqual([{ id: 'real-appointment' }]);
    renderer.unmount();
  });

  it('rejects stale async and subscription results from the prior workspace generation', async () => {
    let resolveDemoRoster!: (value: unknown[]) => void;
    let staleMessageCallback!: (threads: unknown[]) => void;
    storage.getClients.mockReturnValueOnce(new Promise((resolve) => { resolveDemoRoster = resolve; }));
    storage.subscribeToMessages.mockImplementationOnce((callback: (threads: unknown[]) => void) => { staleMessageCallback = callback; return vi.fn(); });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<App />); });

    authState.value = { user: { uid: 'real-clinician' }, role: 'clinician', loading: false, isDemoWorkspace: false, logout: vi.fn() };
    storage.getClients.mockResolvedValueOnce([]);
    storage.getPatientInvitationsForClinician.mockResolvedValueOnce([]);
    storage.getAppointments.mockResolvedValueOnce([]);
    storage.subscribeToMessages.mockImplementationOnce((callback: (threads: unknown[]) => void) => { callback([]); return vi.fn(); });
    act(() => { renderer.update(<App />); });
    await act(async () => { resolveDemoRoster([{ id: 'late-sample-patient' }]); staleMessageCallback([{ clientId: 'late-sample-patient' }]); await flush(); });
    expect(shell(renderer).props.clients).toEqual([]);
    expect(shell(renderer).props.messages).toEqual([]);
    renderer.unmount();
  });
});
