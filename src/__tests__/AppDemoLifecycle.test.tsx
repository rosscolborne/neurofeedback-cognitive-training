import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  value: { user: { uid: 'demo-clinician', displayName: 'Sample clinician' }, role: 'clinician', loading: false, isDemoWorkspace: true, logout: vi.fn() } as Record<string, unknown>,
}));
const storage = vi.hoisted(() => ({
  getBrandConfig: vi.fn(() => ({ clinicId: 'app', name: 'Waveable', logoUrl: '', primaryAccent: '#000', primaryHover: '#000', primarySubtle: '#fff', onPrimary: '#fff', patientBaseSurface: '#fff', clinicianBaseSurface: '#fff', typographyStyle: 'modern-sans', createdAt: '' })),
  getClients: vi.fn(), getPatientInvitationsForClinician: vi.fn(), getAppointments: vi.fn(),
  getCurrentClient: vi.fn(), subscribeToMessages: vi.fn((_callback: (threads: unknown[]) => void, _role?: unknown) => vi.fn()),
}));
const hooks = vi.hoisted(() => {
  let states: unknown[] = [], refs: Array<{ current: unknown }> = [], dependencies: Array<unknown[] | undefined> = [];
  let cleanups: Array<void | (() => void)> = [], pending: Array<{ index: number; effect: () => void | (() => void) }> = [];
  let stateCursor = 0, refCursor = 0, effectCursor = 0;
  const same = (a?: unknown[], b?: unknown[]) => Boolean(a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index])));
  return {
    reset() { states = []; refs = []; dependencies = []; cleanups = []; pending = []; },
    begin() { stateCursor = 0; refCursor = 0; effectCursor = 0; },
    useState(initial: unknown) {
      const index = stateCursor++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [states[index], (next: unknown) => { states[index] = typeof next === 'function' ? (next as (current: unknown) => unknown)(states[index]) : next; }];
    },
    useRef(initial: unknown) { const index = refCursor++; return refs[index] ?? (refs[index] = { current: initial }); },
    useEffect(effect: () => void | (() => void), deps?: unknown[]) {
      const index = effectCursor++;
      if (!same(dependencies[index], deps)) {
        cleanups[index]?.();
        dependencies[index] = deps;
        pending.push({ index, effect });
      }
    },
    runEffects() { const work = pending; pending = []; work.forEach(({ index, effect }) => { cleanups[index] = effect(); }); },
  };
});

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal<typeof import('react')>()), useState: hooks.useState, useRef: hooks.useRef, useEffect: hooks.useEffect }));
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
  return { ...actual, Routes: 'routes', Route: 'route', Navigate: 'navigate', useLocation: () => ({ pathname: '/' }), useNavigate: () => vi.fn(), useParams: () => ({}) };
});

import { App } from '../App';

type Node = ReactElement<Record<string, unknown>>;
const findType = (value: unknown, type: string): Node | null => {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) return value.map((entry) => findType(entry, type)).find(Boolean) ?? null;
  const node = value as Node;
  if (node.type === type) return node;
  for (const child of Object.values(node.props ?? {})) {
    const found = findType(child, type);
    if (found) return found;
  }
  return null;
};

const mountApp = () => {
  hooks.reset();
  let tree: ReactElement;
  const render = () => { hooks.begin(); tree = App(); };
  render(); hooks.runEffects();
  return {
    shell: () => findType(tree, 'clinician-shell')!,
    render,
    async settle() { for (let index = 0; index < 8; index += 1) { await Promise.resolve(); render(); hooks.runEffects(); } },
  };
};

describe('App account/workspace lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.value = { user: { uid: 'demo-clinician', displayName: 'Sample clinician' }, role: 'clinician', loading: false, isDemoWorkspace: true, logout: vi.fn() };
    storage.getClients.mockResolvedValue([{ id: 'sample-patient', name: 'Sample' }]);
    storage.getPatientInvitationsForClinician.mockResolvedValue([]);
    storage.getAppointments.mockResolvedValue([]);
    storage.subscribeToMessages.mockImplementation((callback: (threads: unknown[]) => void) => { callback([{ clientId: 'sample-patient' }]); return vi.fn(); });
  });

  it('clears demo state synchronously and keeps independent successful loads when a real-account read fails', async () => {
    const mounted = mountApp();
    await mounted.settle();
    expect(mounted.shell().props.isDemoWorkspace).toBe(true);
    expect(mounted.shell().props.clients).toEqual([{ id: 'sample-patient', name: 'Sample' }]);

    authState.value = { user: { uid: 'real-clinician', displayName: 'Real clinician' }, role: 'clinician', loading: false, isDemoWorkspace: false, logout: vi.fn() };
    storage.getClients.mockRejectedValueOnce(new Error('roster offline'));
    storage.getPatientInvitationsForClinician.mockResolvedValueOnce([{ id: 'real-invitation' }]);
    storage.getAppointments.mockResolvedValueOnce([{ id: 'real-appointment' }]);
    storage.subscribeToMessages.mockImplementationOnce((callback: (threads: unknown[]) => void) => { callback([]); return vi.fn(); });

    mounted.render();
    expect(mounted.shell().props.isDemoWorkspace).toBe(false);
    expect(mounted.shell().props.clients).toEqual([]);
    expect(mounted.shell().props.messages).toEqual([]);
    hooks.runEffects();
    await mounted.settle();
    expect(mounted.shell().props.clients).toEqual([]);
    expect(mounted.shell().props.patientInvitations).toEqual([{ id: 'real-invitation' }]);
    expect(mounted.shell().props.appointments).toEqual([{ id: 'real-appointment' }]);
  });

  it('rejects stale async and subscription results from the prior workspace generation', async () => {
    let resolveDemoRoster!: (value: unknown[]) => void;
    let staleMessageCallback!: (threads: unknown[]) => void;
    storage.getClients.mockReturnValueOnce(new Promise((resolve) => { resolveDemoRoster = resolve; }));
    storage.subscribeToMessages.mockImplementationOnce((callback: (threads: unknown[]) => void) => {
      staleMessageCallback = callback;
      return vi.fn();
    });
    const mounted = mountApp();

    authState.value = { user: { uid: 'real-clinician' }, role: 'clinician', loading: false, isDemoWorkspace: false, logout: vi.fn() };
    storage.getClients.mockResolvedValueOnce([]);
    storage.getPatientInvitationsForClinician.mockResolvedValueOnce([]);
    storage.getAppointments.mockResolvedValueOnce([]);
    storage.subscribeToMessages.mockImplementationOnce((callback: (threads: unknown[]) => void) => { callback([]); return vi.fn(); });
    mounted.render();
    hooks.runEffects();

    resolveDemoRoster([{ id: 'late-sample-patient' }]);
    staleMessageCallback([{ clientId: 'late-sample-patient' }]);
    await mounted.settle();
    expect(mounted.shell().props.isDemoWorkspace).toBe(false);
    expect(mounted.shell().props.clients).toEqual([]);
    expect(mounted.shell().props.messages).toEqual([]);
  });
});
