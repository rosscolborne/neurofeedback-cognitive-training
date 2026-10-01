import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  value: { user: { uid: 'demo-clinician', displayName: 'Sample clinician' }, role: 'clinician', loading: false, isDemoWorkspace: true, logout: vi.fn() } as Record<string, unknown>,
}));
const storage = vi.hoisted(() => ({
  getBrandConfig: vi.fn(() => ({ clinicId: 'app', name: 'NFCT', logoUrl: '', primaryAccent: '#000', primaryHover: '#000', primarySubtle: '#fff', onPrimary: '#fff', patientBaseSurface: '#fff', clinicianBaseSurface: '#fff', typographyStyle: 'modern-sans', createdAt: '' })),
  getClients: vi.fn(), getPatientInvitationsForClinician: vi.fn(), getCurrentClient: vi.fn(),
  subscribeToClientRoster: vi.fn((_onChange: () => void, _onError: (error: Error) => void) => vi.fn()),
  getClinicBrandConfig: vi.fn(), createPatientInvitation: vi.fn(), cancelPatientInvitation: vi.fn(),
  saveClient: vi.fn(),
}));
const settings = vi.hoisted(() => ({ load: vi.fn() }));
const baselineEngine = vi.hoisted(() => ({ individualBaselineModel: null as unknown }));
const routeState = vi.hoisted(() => ({ pathname: '/' }));

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => authState.value }));
vi.mock('../services/storageEngine', () => ({ storageEngine: storage }));
vi.mock('../services/eegEngine', () => ({ eegEngine: baselineEngine }));
vi.mock('../services/brandEngine', () => ({
  applyBrandToDOM: vi.fn(),
  BRAND_PRESETS: [{ clinicId: 'app', name: 'NFCT', logoUrl: '', primaryAccent: '#000', primaryHover: '#000', primarySubtle: '#fff', onPrimary: '#fff', patientBaseSurface: '#fff', clinicianBaseSurface: '#fff', typographyStyle: 'modern-sans', createdAt: '' }],
}));
vi.mock('../services/clinicSettingsRepository', () => ({
  clinicSettingsRepository: settings,
}));
vi.mock('../components/clinician/ClinicianShell', () => ({ ClinicianShell: 'clinician-shell' }));
vi.mock('../components/patient/PatientShell', () => ({ PatientShell: 'patient-shell' }));
vi.mock('../components/brand/ClinicCustomizerModal', () => ({ ClinicCustomizerModal: 'brand-modal' }));
vi.mock('../components/brand/BrandLogo', () => ({ BrandLogo: 'brand-logo' }));
vi.mock('../components/account/UnsyncedSignOutDialog', () => ({ UnsyncedSignOutDialog: 'unsynced-dialog' }));
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
    useLocation: () => ({ pathname: routeState.pathname }), useNavigate: () => vi.fn(), useParams: () => ({}),
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
    storage.saveClient.mockResolvedValue(undefined);
    settings.load.mockResolvedValue({ clinicId: 'clinic-1', clinic: { id: 'clinic-1' }, practitioner: { id: 'clinician-1' }, brand: null });
    baselineEngine.individualBaselineModel = null;
    routeState.pathname = '/';
  });

  it('reloads the saved calibration after returning from hardware setup', async () => {
    const original = { alphaPeakHz: 9, oneOverFSlope: 1, lastCalibratedAt: '2026-09-27T08:00:00Z' };
    const recalibrated = { ...original, alphaPeakHz: 11 };
    authState.value = { user: { uid: 'patient-a' }, role: 'patient', loading: false, isDemoWorkspace: false, logout: vi.fn() };
    storage.getCurrentClient.mockResolvedValueOnce({ id: 'patient-a', individualBaselineModel: original });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<App />); await flush(); });
    routeState.pathname = '/hardware-setup';
    storage.getCurrentClient.mockResolvedValueOnce({ id: 'patient-a', individualBaselineModel: original });
    await act(async () => { renderer.update(<App />); await flush(); });
    expect(baselineEngine.individualBaselineModel).toBeNull();
    baselineEngine.individualBaselineModel = recalibrated;
    routeState.pathname = '/';
    storage.getCurrentClient.mockResolvedValueOnce({ id: 'patient-a', individualBaselineModel: recalibrated });
    await act(async () => { renderer.update(<App />); await flush(); });
    expect(baselineEngine.individualBaselineModel).toBe(recalibrated);
    expect(patientShell(renderer).props.client.individualBaselineModel).toBe(recalibrated);
    renderer.unmount();
  });

  it('initializes a signed-in patient profile on a direct hardware setup route without hydrating an old baseline', async () => {
    authState.value = { user: { uid: 'new-patient' }, role: 'patient', loading: false, isDemoWorkspace: false, logout: vi.fn() };
    routeState.pathname = '/hardware-setup';
    storage.getCurrentClient.mockResolvedValueOnce({ id: 'new-patient', individualBaselineModel: { alphaPeakHz: 9, oneOverFSlope: 1, lastCalibratedAt: '2026-09-27T08:00:00Z' } });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<App />); await flush(); });
    expect(storage.getCurrentClient).toHaveBeenCalledWith(authState.value.user);
    expect(baselineEngine.individualBaselineModel).toBeNull();
    renderer.unmount();
  });

  it('hydrates the current patient before shell mount and clears across sign-out, roles, and workspaces', async () => {
    const saved = { alphaPeakHz: 10, oneOverFSlope: 1, lastCalibratedAt: '2026-09-27T08:00:00Z', thetaMean: 3, betaMean: 5 };
    authState.value = { user: { uid: 'patient-a' }, role: 'patient', loading: false, isDemoWorkspace: true, logout: vi.fn() };
    storage.getCurrentClient.mockResolvedValueOnce({ id: 'patient-a', individualBaselineModel: saved });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<App />); await flush(); });
    expect(baselineEngine.individualBaselineModel).toBe(saved);
    expect(patientShell(renderer).props.client.individualBaselineModel).toBe(saved);

    const recalibrated = { ...saved, thetaMean: 8 };
    act(() => patientShell(renderer).props.onBaselinePersisted('patient-a', recalibrated));
    expect(patientShell(renderer).props.client.individualBaselineModel).toBe(recalibrated);
    const staleBaselineCallback = patientShell(renderer).props.onBaselinePersisted;

    authState.value = { user: null, role: null, loading: false, isDemoWorkspace: false, logout: vi.fn() };
    act(() => { renderer.update(<App />); });
    expect(baselineEngine.individualBaselineModel).toBeNull();

    authState.value = { user: { uid: 'patient-b' }, role: 'patient', loading: false, isDemoWorkspace: false, logout: vi.fn() };
    let resolveB!: (value: unknown) => void;
    storage.getCurrentClient.mockReturnValueOnce(new Promise((resolve) => { resolveB = resolve; }));
    act(() => { renderer.update(<App />); });
    expect(baselineEngine.individualBaselineModel).toBeNull();
    await act(async () => { resolveB({ id: 'patient-b' }); await flush(); });
    expect(baselineEngine.individualBaselineModel).toBeNull();
    act(() => staleBaselineCallback('patient-a', saved));
    expect(patientShell(renderer).props.client.individualBaselineModel).toBeUndefined();
    renderer.unmount();
  });

  it('rejects a late patient load after an account switch and isolates demo from production', async () => {
    const saved = { alphaPeakHz: 9, oneOverFSlope: 1, lastCalibratedAt: '2026-09-27T08:00:00Z' };
    let resolveDemo!: (value: unknown) => void;
    authState.value = { user: { uid: 'same-uid' }, role: 'patient', loading: false, isDemoWorkspace: true, logout: vi.fn() };
    storage.getCurrentClient.mockReturnValueOnce(new Promise((resolve) => { resolveDemo = resolve; }));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<App />); });
    authState.value = { user: { uid: 'same-uid' }, role: 'patient', loading: false, isDemoWorkspace: false, logout: vi.fn() };
    storage.getCurrentClient.mockResolvedValueOnce({ id: 'production', individualBaselineModel: saved });
    await act(async () => { renderer.update(<App />); await flush(); });
    expect(baselineEngine.individualBaselineModel).toBe(saved);
    await act(async () => { resolveDemo({ id: 'demo', individualBaselineModel: { ...saved, alphaPeakHz: 7 } }); await flush(); });
    expect(baselineEngine.individualBaselineModel).toBe(saved);
    expect(patientShell(renderer).props.client.id).toBe('production');
    renderer.unmount();
  });

  it('clears a production calibration before opening the sample workspace', async () => {
    const saved = { alphaPeakHz: 9.5, oneOverFSlope: 1.1, lastCalibratedAt: '2026-09-27T08:00:00Z' };
    authState.value = { user: { uid: 'same-uid' }, role: 'patient', loading: false, isDemoWorkspace: false, logout: vi.fn() };
    storage.getCurrentClient.mockResolvedValueOnce({ id: 'production', individualBaselineModel: saved });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<App />); await flush(); });
    expect(baselineEngine.individualBaselineModel).toBe(saved);

    authState.value = { user: { uid: 'same-uid' }, role: 'patient', loading: false, isDemoWorkspace: true, logout: vi.fn() };
    let resolveDemo!: (value: unknown) => void;
    storage.getCurrentClient.mockReturnValueOnce(new Promise((resolve) => { resolveDemo = resolve; }));
    act(() => { renderer.update(<App />); });
    expect(baselineEngine.individualBaselineModel).toBeNull();
    await act(async () => { resolveDemo({ id: 'demo' }); await flush(); });
    expect(patientShell(renderer).props.client.id).toBe('demo');
    expect(baselineEngine.individualBaselineModel).toBeNull();
    renderer.unmount();
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

  it('distinguishes pending, failed, retried and loaded-empty clinician rosters across accounts', async () => {
    authState.value = { user: { uid: 'clinician-one' }, role: 'clinician', loading: false, isDemoWorkspace: false, logout: vi.fn() };
    let rejectFirst!: (error: Error) => void;
    storage.getClients.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectFirst = reject; }));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<App />); });
    expect(shell(renderer).props.rosterStatus).toBe('loading');
    await act(async () => { rejectFirst(new Error('roster offline')); await flush(); });
    expect(shell(renderer).props.rosterStatus).toBe('error');

    let resolveRetry!: (clients: unknown[]) => void;
    storage.getClients.mockReturnValueOnce(new Promise((resolve) => { resolveRetry = resolve; }));
    const retry = renderer.root.findAllByType('button').find((item) => item.children.join('') === 'Retry')!;
    await act(async () => { retry.props.onClick(); });
    expect(shell(renderer).props.rosterStatus).toBe('loading');
    await act(async () => { resolveRetry([]); await flush(); });
    expect(shell(renderer).props.rosterStatus).toBe('ready');
    expect(shell(renderer).props.clients).toEqual([]);

    authState.value = { user: { uid: 'clinician-two' }, role: 'clinician', loading: false, isDemoWorkspace: false, logout: vi.fn() };
    let resolveSecond!: (clients: unknown[]) => void;
    storage.getClients.mockReturnValueOnce(new Promise((resolve) => { resolveSecond = resolve; }));
    await act(async () => { renderer.update(<App />); });
    expect(shell(renderer).props.rosterStatus).toBe('loading');
    await act(async () => { resolveSecond([]); await flush(); });
    expect(shell(renderer).props.rosterStatus).toBe('ready');
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

  it('refreshes an open roster, clears stale rows on error, and disposes account-scoped listeners', async () => {
    authState.value = { user: { uid: 'clinician-one' }, role: 'clinician', loading: false, isDemoWorkspace: false, logout: vi.fn() };
    let change!: () => void;
    let fail!: (error: Error) => void;
    const stop = vi.fn();
    storage.subscribeToClientRoster.mockImplementationOnce((onChange, onError) => {
      change = onChange; fail = onError; return stop;
    });
    storage.getClients.mockResolvedValueOnce([{ id: 'old-patient' }]);
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<App />); await flush(); });
    expect(shell(renderer).props.clients).toEqual([{ id: 'old-patient' }]);

    storage.getClients.mockResolvedValueOnce([]);
    await act(async () => { change(); await flush(); });
    expect(shell(renderer).props.clients).toEqual([]);
    await act(async () => { fail(new Error('roster listener offline')); await flush(); });
    expect(shell(renderer).props.rosterStatus).toBe('error');
    expect(shell(renderer).props.clients).toEqual([]);
    storage.getClients.mockResolvedValueOnce([{ id: 'new-patient' }]);
    await act(async () => { change(); await flush(); });
    expect(shell(renderer).props.rosterStatus).toBe('ready');
    expect(shell(renderer).props.clients).toEqual([{ id: 'new-patient' }]);

    authState.value = { user: { uid: 'clinician-two' }, role: 'clinician', loading: false, isDemoWorkspace: false, logout: vi.fn() };
    storage.getClients.mockResolvedValueOnce([]);
    await act(async () => { renderer.update(<App />); await flush(); });
    expect(stop).toHaveBeenCalledTimes(1);
    await act(async () => { change(); fail(new Error('stale listener')); await flush(); });
    expect(shell(renderer).props.clients).toEqual([]);
    expect(shell(renderer).props.rosterStatus).toBe('ready');
    renderer.unmount();
  });

  it('does not repopulate a roster from a read that completes after a listener error', async () => {
    authState.value = { user: { uid: 'clinician-one' }, role: 'clinician', loading: false, isDemoWorkspace: false, logout: vi.fn() };
    let fail!: (error: Error) => void;
    storage.subscribeToClientRoster.mockImplementationOnce((_change, onError) => {
      fail = onError; return vi.fn();
    });
    let resolveRoster!: (rows: unknown[]) => void;
    storage.getClients.mockReturnValueOnce(new Promise((resolve) => { resolveRoster = resolve; }));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<App />); });
    await act(async () => { fail(new Error('listener offline')); await flush(); });
    expect(shell(renderer).props.rosterStatus).toBe('error');
    await act(async () => { resolveRoster([{ id: 'stale-patient' }]); await flush(); });
    expect(shell(renderer).props.clients).toEqual([]);
    expect(shell(renderer).props.rosterStatus).toBe('error');
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
      await shell(renderer).props.onAddClient({ email: 'new@example.com', name: 'New Patient', condition: 'Peak Performance', assignedProtocol: 'theta-beta-ratio', prescribedSessionsPerWeek: 4 });
    });
    expect(storage.createPatientInvitation).toHaveBeenCalledWith(expect.objectContaining({ clinicId: 'clinic-one' }));
    renderer.unmount();
  });

  it('waits for clinic settings still loading instead of reporting a missing clinic', async () => {
    authState.value = { user: { uid: 'clinician-one' }, role: 'clinician', loading: false, isDemoWorkspace: false, logout: vi.fn() };
    let finishLoad!: (snapshot: unknown) => void;
    settings.load.mockReturnValueOnce(new Promise((resolve) => { finishLoad = resolve; }));
    storage.createPatientInvitation.mockResolvedValueOnce({ id: 'INVITE' });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<App />); await flush(); });

    let invited!: Promise<unknown>;
    act(() => {
      invited = shell(renderer).props.onAddClient({ email: 'new@example.com', name: 'New Patient', condition: 'Peak Performance', assignedProtocol: 'theta-beta-ratio', prescribedSessionsPerWeek: 4 });
    });
    await act(async () => {
      finishLoad({ clinicId: 'clinic-one', clinic: { id: 'clinic-one' }, practitioner: { id: 'clinician-one' }, brand: null });
      await invited;
    });

    expect(storage.createPatientInvitation).toHaveBeenCalledWith(expect.objectContaining({ clinicId: 'clinic-one' }));
    renderer.unmount();
  });

  it('can invite immediately after completing fresh clinic setup', async () => {
    authState.value = { user: { uid: 'new-clinician' }, role: 'clinician', loading: false, isDemoWorkspace: false, logout: vi.fn() };
    settings.load.mockResolvedValueOnce({ clinicId: 'new-clinician', clinic: null, practitioner: null, brand: null });
    storage.createPatientInvitation.mockResolvedValueOnce({ id: 'INVITE' });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<App />); await flush(); });

    await expect(shell(renderer).props.onAddClient({ email: 'new@example.com', name: 'New Patient', condition: 'Peak Performance', assignedProtocol: 'theta-beta-ratio', prescribedSessionsPerWeek: 4 }))
      .rejects.toThrow('Complete clinic setup');
    act(() => {
      shell(renderer).props.onClinicSettingsSaved({
        clinicId: 'clinic-new', clinic: { id: 'clinic-new' }, practitioner: { id: 'new-clinician' }, brand: null,
      });
    });
    await act(async () => {
      await shell(renderer).props.onAddClient({ email: 'new@example.com', name: 'New Patient', condition: 'Peak Performance', assignedProtocol: 'theta-beta-ratio', prescribedSessionsPerWeek: 4 });
    });
    expect(storage.createPatientInvitation).toHaveBeenCalledWith(expect.objectContaining({ clinicId: 'clinic-new' }));
    renderer.unmount();
  });

  it('does not expose a completed invitation or brand callback after the account changes', async () => {
    let resolveInvitation!: (value: { id: string }) => void;
    authState.value = { user: { uid: 'clinician-one' }, role: 'clinician', loading: false, isDemoWorkspace: false, logout: vi.fn() };
    settings.load.mockResolvedValueOnce({ clinicId: 'clinic-one', clinic: { id: 'clinic-one' }, practitioner: { id: 'clinician-one' }, brand: null });
    storage.createPatientInvitation.mockReturnValueOnce(new Promise((resolve) => { resolveInvitation = resolve; }));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<App />); await flush(); });
    let invitationPromise!: Promise<unknown>;
    act(() => {
      invitationPromise = shell(renderer).props.onAddClient({ email: 'private@example.com', name: 'Private Patient', condition: 'Peak Performance', assignedProtocol: 'theta-beta-ratio', prescribedSessionsPerWeek: 4 });
      shell(renderer).props.onOpenRebrand();
    });
    const staleBrandCallback = renderer.root.find((node) => (node.type as unknown) === 'brand-modal').props.onSave;

    authState.value = { user: { uid: 'clinician-two' }, role: 'clinician', loading: false, isDemoWorkspace: false, logout: vi.fn() };
    settings.load.mockResolvedValueOnce({ clinicId: 'clinic-two', clinic: { id: 'clinic-two' }, practitioner: { id: 'clinician-two' }, brand: null });
    storage.getClients.mockResolvedValueOnce([]);
    storage.getPatientInvitationsForClinician.mockResolvedValueOnce([]);
    await act(async () => { renderer.update(<App />); await flush(); });
    await act(async () => {
      resolveInvitation({ id: 'clinician-one-invitation' });
      await invitationPromise;
      staleBrandCallback({ ...storage.getBrandConfig(), clinicId: 'clinic-one', name: 'Clinic One' });
      await flush();
    });

    expect(shell(renderer).props.patientInvitations).toEqual([]);
    expect(shell(renderer).props.brand.name).toBe('NFCT');
    renderer.unmount();
  });

  it('shows a retryable patient-profile error instead of fabricated patient data', async () => {
    authState.value = { user: { uid: 'patient-one', email: 'patient@example.com' }, role: 'patient', loading: false, isDemoWorkspace: false, logout: vi.fn() };
    storage.getCurrentClient.mockRejectedValueOnce(new Error('profile offline'));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<App />); await flush(); });
    expect(JSON.stringify(renderer.toJSON())).toContain('profile offline');
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'patient-shell')).toHaveLength(0);

    storage.getCurrentClient.mockResolvedValueOnce({ id: 'patient-one', name: 'Patient One' });
    await act(async () => {
      renderer.root.findByType('button').props.onClick();
      await flush();
    });
    expect(patientShell(renderer).props.client).toMatchObject({ id: 'patient-one', name: 'Patient One' });
    renderer.unmount();
  });

  it('does not publish a failed patient update into the clinician roster', async () => {
    authState.value = { user: { uid: 'clinician-one' }, role: 'clinician', loading: false, isDemoWorkspace: false, logout: vi.fn() };
    const original = { id: 'patient-one', name: 'Original' };
    storage.getClients.mockResolvedValueOnce([original]);
    storage.saveClient.mockRejectedValueOnce(new Error('save offline'));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<App />); await flush(); });

    await expect(shell(renderer).props.onUpdateClient({ ...original, name: 'Unsaved' })).rejects.toThrow('save offline');
    expect(shell(renderer).props.clients).toEqual([original]);
    renderer.unmount();
  });

  it('shows and retries invitation-list load failures without publishing stale results', async () => {
    authState.value = { user: { uid: 'clinician-one' }, role: 'clinician', loading: false, isDemoWorkspace: false, logout: vi.fn() };
    storage.getClients.mockResolvedValue([]);
    storage.getPatientInvitationsForClinician.mockRejectedValueOnce(new Error('invitation query offline'));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<App />); await flush(); });
    expect(JSON.stringify(renderer.toJSON())).toContain('invitation query offline');

    storage.getPatientInvitationsForClinician.mockResolvedValueOnce([{ id: 'retry-invitation' }]);
    const retry = renderer.root.findAllByType('button').find((button) => button.children.join('') === 'Retry');
    expect(retry).toBeDefined();
    await act(async () => { retry!.props.onClick(); await flush(); });
    expect(shell(renderer).props.patientInvitations).toEqual([{ id: 'retry-invitation' }]);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('invitation query offline');
    renderer.unmount();
  });

  it('keeps a signed-in account whose role is unknown on the loading screen with a retry, never role selection (NFCT-44)', async () => {
    const retryRoleLookup = vi.fn();
    const logout = vi.fn().mockResolvedValueOnce('unsynced');
    const labels = (renderer: ReactTestRenderer) => renderer.root.findAllByType('button').map((button) => button.children.join(''));
    const rolePages = (renderer: ReactTestRenderer) => renderer.root.findAll((node) => (node.type as unknown) === 'role-page');
    // Still reading the role: the plain loading screen, nothing to act on.
    authState.value = { user: { uid: 'patient-a' }, role: null, loading: true, roleLookupFailed: false, retryRoleLookup, isDemoWorkspace: false, logout, cacheStatus: 'idle' };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<App />); await flush(); });
    expect(rolePages(renderer)).toHaveLength(0);
    expect(labels(renderer)).toEqual([]);

    authState.value = { ...authState.value, roleLookupFailed: true };
    await act(async () => { renderer.update(<App />); await flush(); });
    expect(rolePages(renderer)).toHaveLength(0);
    expect(renderer.root.findByProps({ role: 'alert' }).findByType('strong').children.join('')).toBe('Your account couldn’t be loaded.');
    expect(labels(renderer)).toEqual(['Try again', 'Sign out']);
    expect(storage.getCurrentClient).not.toHaveBeenCalled();

    const button = (label: string) => renderer.root.findAllByType('button').find((node) => node.children.join('') === label)!;
    await act(async () => { button('Try again').props.onClick(); });
    expect(retryRoleLookup).toHaveBeenCalledOnce();

    // Sign-out found unsynced writes and asks: a retry must not close that question.
    const unsyncedDialog = () => renderer.root.findAll((node) => (node.type as unknown) === 'unsynced-dialog');
    await act(async () => { button('Sign out').props.onClick(); await flush(); });
    expect(logout).toHaveBeenCalledOnce();
    expect(unsyncedDialog()).toHaveLength(1);
    expect(button('Try again').props.disabled).toBe(true);
    await act(async () => { unsyncedDialog()[0].props.onStaySignedIn(); });
    expect(unsyncedDialog()).toHaveLength(0);
    expect(button('Try again').props.disabled).toBe(false);

    // Nor while a sign-out runs.
    let finish!: (outcome: string) => void;
    logout.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await act(async () => { button('Sign out').props.onClick(); await flush(); });
    expect(button('Try again').props.disabled).toBe(true);
    expect(button('Sign out').props.disabled).toBe(true);
    await act(async () => { finish('signed-out'); await flush(); });
    expect(logout).toHaveBeenCalledTimes(2);
    expect(retryRoleLookup).toHaveBeenCalledOnce();
    renderer.unmount();
  });
});
