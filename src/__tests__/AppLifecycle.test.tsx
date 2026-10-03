import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  value: { user: null, profile: null, loading: false, logout: vi.fn() } as Record<string, unknown>,
}));
const routes = vi.hoisted(() => ({ paths: [] as string[] }));

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => authState.value }));
vi.mock('../consumer/shell/AppShell', () => ({ AppShell: 'app-shell' }));
vi.mock('../components/brand/BrandLogo', () => ({ BrandLogo: 'brand-logo' }));
vi.mock('../components/account/UnsyncedSignOutDialog', () => ({ UnsyncedSignOutDialog: 'unsynced-dialog' }));
vi.mock('../pages/onboarding/Welcome', () => ({ Welcome: 'welcome-page' }));
vi.mock('../pages/onboarding/SignUp', () => ({ SignUp: 'signup-page' }));
vi.mock('../pages/onboarding/Login', () => ({ Login: 'login-page' }));
vi.mock('../pages/onboarding/HardwareSetup', () => ({ HardwareSetup: 'hardware-page' }));
vi.mock('../pages/legal/PrivacyPolicy', () => ({ PrivacyPolicy: 'privacy-page' }));
vi.mock('../pages/legal/TermsOfService', () => ({ TermsOfService: 'terms-page' }));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    Routes: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Route: ({ path, element }: { path: string; element: React.ReactNode }) => { routes.paths.push(path); return path === '/*' ? element : null; },
    Navigate: () => null,
    useNavigate: () => vi.fn(), useParams: () => ({}),
  };
});

import { App } from '../App';

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const appShells = (renderer: ReactTestRenderer): ReactTestInstance[] => renderer.root.findAll((node) => (node.type as unknown) === 'app-shell');
const appShell = (renderer: ReactTestRenderer): ReactTestInstance => appShells(renderer)[0];
const profileOf = (displayName: string) => ({ schemaVersion: 1, displayName });

describe('mounted App account lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    authState.value = { user: null, profile: null, loading: false, logout: vi.fn() };
    routes.paths = [];
  });

  it('opens the shell with the signed-in player and their profile, and follows sign-out and account changes', async () => {
    const playerA = { uid: 'player-a', email: 'a@example.com' };
    authState.value = { user: playerA, profile: profileOf('Player A'), loading: false, logout: vi.fn() };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<App />); await flush(); });
    expect(appShell(renderer).props.user).toBe(playerA);
    expect(appShell(renderer).props.profile).toEqual(profileOf('Player A'));
    // Headset setup is the only EEG action the shell is given; there is no calibration to persist.
    expect(appShell(renderer).props.onSetUpHeadset).toEqual(expect.any(Function));
    expect(appShell(renderer).props).not.toHaveProperty('onBaselinePersisted');

    authState.value = { user: null, profile: null, loading: false, logout: vi.fn() };
    act(() => { renderer.update(<App />); });
    expect(appShells(renderer)).toHaveLength(0);

    const playerB = { uid: 'player-b', email: 'b@example.com' };
    authState.value = { user: playerB, profile: profileOf('Player B'), loading: false, logout: vi.fn() };
    act(() => { renderer.update(<App />); });
    expect(appShell(renderer).props.user).toBe(playerB);
    expect(appShell(renderer).props.profile).toEqual(profileOf('Player B'));
    renderer.unmount();
  });

  it('shows a signed-in player nothing but the loading screen until their profile is loaded', async () => {
    authState.value = { user: { uid: 'player-a' }, profile: null, loading: false, profileLookupFailed: false, logout: vi.fn(), cacheStatus: 'idle' };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<App />); await flush(); });
    expect(appShells(renderer)).toHaveLength(0);
    expect(renderer.root.findAllByType('button')).toHaveLength(0);
    renderer.unmount();
  });

  it('has no role-selection route', async () => {
    authState.value = { user: { uid: 'player-a' }, profile: profileOf('Player A'), loading: false, logout: vi.fn() };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<App />); await flush(); });
    expect(routes.paths).toContain('/hardware-setup');
    expect(routes.paths).not.toContain('/role-selection');
    // Every other signed-in path, the tabs included, belongs to the one shell.
    expect(routes.paths.filter((path) => path.includes('*'))).toEqual(['/*']);
    renderer.unmount();
  });

  it('keeps a signed-in account whose profile is unknown on the loading screen with a retry (NFCT-44)', async () => {
    const retryProfileLookup = vi.fn();
    const logout = vi.fn().mockResolvedValueOnce('unsynced');
    const labels = (renderer: ReactTestRenderer) => renderer.root.findAllByType('button').map((button) => button.children.join(''));
    // Still loading the profile: the plain loading screen, nothing to act on.
    authState.value = { user: { uid: 'player-a' }, profile: null, loading: true, profileLookupFailed: false, retryProfileLookup, logout, cacheStatus: 'idle' };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<App />); await flush(); });
    expect(appShells(renderer)).toHaveLength(0);
    expect(labels(renderer)).toEqual([]);

    authState.value = { ...authState.value, profileLookupFailed: true };
    await act(async () => { renderer.update(<App />); await flush(); });
    expect(appShells(renderer)).toHaveLength(0);
    expect(renderer.root.findByProps({ role: 'alert' }).findByType('strong').children.join('')).toBe('Your account couldn’t be loaded.');
    expect(labels(renderer)).toEqual(['Try again', 'Sign out']);

    const button = (label: string) => renderer.root.findAllByType('button').find((node) => node.children.join('') === label)!;
    await act(async () => { button('Try again').props.onClick(); });
    expect(retryProfileLookup).toHaveBeenCalledOnce();

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
    expect(retryProfileLookup).toHaveBeenCalledOnce();
    renderer.unmount();
  });

  it('keeps the unsynced-writes question when the profile arrives while it is open (NFCT-44 automatic retry)', async () => {
    const logout = vi.fn().mockResolvedValueOnce('unsynced');
    const unsyncedDialog = (renderer: ReactTestRenderer) => renderer.root.findAll((node) => (node.type as unknown) === 'unsynced-dialog');
    authState.value = { user: { uid: 'player-a' }, profile: null, loading: true, profileLookupFailed: true, retryProfileLookup: vi.fn(), logout, cacheStatus: 'idle' };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<App />); await flush(); });
    const button = (label: string) => renderer.root.findAllByType('button').find((node) => node.children.join('') === label)!;
    await act(async () => { button('Sign out').props.onClick(); await flush(); });
    expect(unsyncedDialog(renderer)).toHaveLength(1);

    // The lookup retried by itself and loaded the profile.
    authState.value = { ...authState.value, profile: profileOf('Player A'), loading: false, profileLookupFailed: false };
    await act(async () => { renderer.update(<App />); await flush(); });
    expect(unsyncedDialog(renderer)).toHaveLength(1);
    expect(appShells(renderer)).toHaveLength(0);
    expect(button('Try again').props.disabled).toBe(true);

    // Staying signed in lets the app continue with the profile it now has.
    await act(async () => { unsyncedDialog(renderer)[0].props.onStaySignedIn(); await flush(); });
    expect(unsyncedDialog(renderer)).toHaveLength(0);
    expect(appShells(renderer)).toHaveLength(1);
    renderer.unmount();
  });
});
