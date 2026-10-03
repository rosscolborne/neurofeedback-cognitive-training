import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  value: { user: null, role: null, loading: false, logout: vi.fn() } as Record<string, unknown>,
}));
const defaultBrand = vi.hoisted(() => ({ clinicId: 'app', name: 'NFCT', logoUrl: '', primaryAccent: '#000', primaryHover: '#000', primarySubtle: '#fff', onPrimary: '#fff', patientBaseSurface: '#fff', clinicianBaseSurface: '#fff', typographyStyle: 'modern-sans', createdAt: '' }));
const storage = vi.hoisted(() => ({
  getCurrentClient: vi.fn(), getClinicBrandConfig: vi.fn(), saveClient: vi.fn(),
}));
const baselineEngine = vi.hoisted(() => ({ individualBaselineModel: null as unknown }));
const routeState = vi.hoisted(() => ({ pathname: '/' }));

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => authState.value }));
vi.mock('../services/storageEngine', () => ({ storageEngine: storage }));
vi.mock('../services/eegEngine', () => ({ eegEngine: baselineEngine }));
vi.mock('../services/brandEngine', () => ({ applyBrandToDOM: vi.fn(), BRAND_PRESETS: [defaultBrand] }));
vi.mock('../components/patient/PatientShell', () => ({ PatientShell: 'patient-shell' }));
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
const patientShell = (renderer: ReactTestRenderer): ReactTestInstance => renderer.root.find((node) => (node.type as unknown) === 'patient-shell');

describe('mounted App account lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    authState.value = { user: null, role: null, loading: false, logout: vi.fn() };
    storage.saveClient.mockResolvedValue(undefined);
    baselineEngine.individualBaselineModel = null;
    routeState.pathname = '/';
  });

  it('reloads the saved calibration after returning from hardware setup', async () => {
    const original = { alphaPeakHz: 9, oneOverFSlope: 1, lastCalibratedAt: '2026-09-27T08:00:00Z' };
    const recalibrated = { ...original, alphaPeakHz: 11 };
    authState.value = { user: { uid: 'patient-a' }, role: 'patient', loading: false, logout: vi.fn() };
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
    authState.value = { user: { uid: 'new-patient' }, role: 'patient', loading: false, logout: vi.fn() };
    routeState.pathname = '/hardware-setup';
    storage.getCurrentClient.mockResolvedValueOnce({ id: 'new-patient', individualBaselineModel: { alphaPeakHz: 9, oneOverFSlope: 1, lastCalibratedAt: '2026-09-27T08:00:00Z' } });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<App />); await flush(); });
    expect(storage.getCurrentClient).toHaveBeenCalledWith(authState.value.user);
    expect(baselineEngine.individualBaselineModel).toBeNull();
    renderer.unmount();
  });

  it('hydrates the current patient before shell mount and clears across sign-out and account changes', async () => {
    const saved = { alphaPeakHz: 10, oneOverFSlope: 1, lastCalibratedAt: '2026-09-27T08:00:00Z', thetaMean: 3, betaMean: 5 };
    authState.value = { user: { uid: 'patient-a' }, role: 'patient', loading: false, logout: vi.fn() };
    storage.getCurrentClient.mockResolvedValueOnce({ id: 'patient-a', individualBaselineModel: saved });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<App />); await flush(); });
    expect(baselineEngine.individualBaselineModel).toBe(saved);
    expect(patientShell(renderer).props.client.individualBaselineModel).toBe(saved);

    const recalibrated = { ...saved, thetaMean: 8 };
    act(() => patientShell(renderer).props.onBaselinePersisted('patient-a', recalibrated));
    expect(patientShell(renderer).props.client.individualBaselineModel).toBe(recalibrated);
    const staleBaselineCallback = patientShell(renderer).props.onBaselinePersisted;

    authState.value = { user: null, role: null, loading: false, logout: vi.fn() };
    act(() => { renderer.update(<App />); });
    expect(baselineEngine.individualBaselineModel).toBeNull();

    authState.value = { user: { uid: 'patient-b' }, role: 'patient', loading: false, logout: vi.fn() };
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

  it('rejects a late patient load after an account switch', async () => {
    const saved = { alphaPeakHz: 9, oneOverFSlope: 1, lastCalibratedAt: '2026-09-27T08:00:00Z' };
    let resolveFirst!: (value: unknown) => void;
    authState.value = { user: { uid: 'patient-a' }, role: 'patient', loading: false, logout: vi.fn() };
    storage.getCurrentClient.mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<App />); });
    authState.value = { user: { uid: 'patient-b' }, role: 'patient', loading: false, logout: vi.fn() };
    storage.getCurrentClient.mockResolvedValueOnce({ id: 'patient-b', individualBaselineModel: saved });
    await act(async () => { renderer.update(<App />); await flush(); });
    expect(baselineEngine.individualBaselineModel).toBe(saved);
    await act(async () => { resolveFirst({ id: 'patient-a', individualBaselineModel: { ...saved, alphaPeakHz: 7 } }); await flush(); });
    expect(baselineEngine.individualBaselineModel).toBe(saved);
    expect(patientShell(renderer).props.client.id).toBe('patient-b');
    renderer.unmount();
  });

  it('loads a linked patient clinic brand per account and ignores a late brand from the previous account', async () => {
    let resolveFirst!: (value: unknown) => void;
    authState.value = { user: { uid: 'patient-one' }, role: 'patient', loading: false, logout: vi.fn() };
    storage.getCurrentClient.mockResolvedValueOnce({ id: 'patient-one', clinicId: 'clinic-one' });
    storage.getClinicBrandConfig.mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<App />); await flush(); await flush(); });
    expect(storage.getClinicBrandConfig).toHaveBeenCalledWith('clinic-one');

    authState.value = { user: { uid: 'patient-two' }, role: 'patient', loading: false, logout: vi.fn() };
    storage.getCurrentClient.mockResolvedValueOnce({ id: 'patient-two', clinicId: 'clinic-two' });
    storage.getClinicBrandConfig.mockResolvedValueOnce({ ...defaultBrand, clinicId: 'clinic-two', name: 'Clinic Two' });
    await act(async () => { renderer.update(<App />); await flush(); await flush(); });
    expect(patientShell(renderer).props.brand).toMatchObject({ clinicId: 'clinic-two', name: 'Clinic Two' });

    await act(async () => { resolveFirst({ ...defaultBrand, clinicId: 'clinic-one', name: 'Clinic One' }); await flush(); });
    expect(patientShell(renderer).props.brand).toMatchObject({ clinicId: 'clinic-two', name: 'Clinic Two' });
    renderer.unmount();
  });

  it('shows a practitioner account a sign-out screen without loading any patient data', async () => {
    const logout = vi.fn().mockResolvedValueOnce('unsynced');
    authState.value = { user: { uid: 'clinician-one' }, role: 'clinician', loading: false, logout };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<App />); await flush(); });
    expect(JSON.stringify(renderer.toJSON())).toContain('Practitioner accounts aren’t supported');
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'patient-shell')).toHaveLength(0);
    expect(storage.getCurrentClient).not.toHaveBeenCalled();
    expect(storage.getClinicBrandConfig).not.toHaveBeenCalled();

    // Sign-out asks before discarding writes that have not uploaded.
    await act(async () => { renderer.root.findByType('button').props.onClick(); await flush(); });
    expect(logout).toHaveBeenCalledOnce();
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'unsynced-dialog')).toHaveLength(1);
    renderer.unmount();
  });

  it('shows a retryable patient-profile error instead of fabricated patient data', async () => {
    authState.value = { user: { uid: 'patient-one', email: 'patient@example.com' }, role: 'patient', loading: false, logout: vi.fn() };
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

  it('keeps a signed-in account whose role is unknown on the loading screen with a retry, never role selection (NFCT-44)', async () => {
    const retryRoleLookup = vi.fn();
    const logout = vi.fn().mockResolvedValueOnce('unsynced');
    const labels = (renderer: ReactTestRenderer) => renderer.root.findAllByType('button').map((button) => button.children.join(''));
    const rolePages = (renderer: ReactTestRenderer) => renderer.root.findAll((node) => (node.type as unknown) === 'role-page');
    // Still reading the role: the plain loading screen, nothing to act on.
    authState.value = { user: { uid: 'patient-a' }, role: null, loading: true, roleLookupFailed: false, retryRoleLookup, logout, cacheStatus: 'idle' };
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

  it('keeps the unsynced-writes question when the role arrives while it is open (NFCT-44 automatic retry)', async () => {
    const logout = vi.fn().mockResolvedValueOnce('unsynced');
    const rolePages = (renderer: ReactTestRenderer) => renderer.root.findAll((node) => (node.type as unknown) === 'role-page');
    const unsyncedDialog = (renderer: ReactTestRenderer) => renderer.root.findAll((node) => (node.type as unknown) === 'unsynced-dialog');
    authState.value = { user: { uid: 'patient-a' }, role: null, loading: true, roleLookupFailed: true, retryRoleLookup: vi.fn(), logout, cacheStatus: 'idle' };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<App />); await flush(); });
    const button = (label: string) => renderer.root.findAllByType('button').find((node) => node.children.join('') === label)!;
    await act(async () => { button('Sign out').props.onClick(); await flush(); });
    expect(unsyncedDialog(renderer)).toHaveLength(1);

    // The lookup retried by itself and the server confirmed a new account: no role.
    authState.value = { ...authState.value, loading: false, roleLookupFailed: false };
    await act(async () => { renderer.update(<App />); await flush(); });
    expect(unsyncedDialog(renderer)).toHaveLength(1);
    expect(rolePages(renderer)).toHaveLength(0);
    expect(button('Try again').props.disabled).toBe(true);

    // Staying signed in lets the app continue with the role it now has.
    await act(async () => { unsyncedDialog(renderer)[0].props.onStaySignedIn(); await flush(); });
    expect(unsyncedDialog(renderer)).toHaveLength(0);
    expect(renderer.root.findAllByType('button').map((node) => node.children.join(''))).not.toContain('Try again');
    renderer.unmount();
  });
});
