import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientProfile, ClinicBrandConfig } from '../../../types';

const state = vi.hoisted(() => ({
  muted: false,
  getSessions: vi.fn(),
  saveSession: vi.fn(),
  getClient: vi.fn(),
  ensureGarden: vi.fn(),
  exportCsv: vi.fn(),
  auth: { currentUser: null as null | { uid: string; email: string; delete: () => Promise<void> } },
  reauthenticate: vi.fn(),
  prepareDeletion: vi.fn(),
}));

vi.mock('../../../services/firebase', () => ({ auth: state.auth, db: {} }));
vi.mock('firebase/auth', () => ({ signOut: vi.fn(), reauthenticateWithCredential: state.reauthenticate,
  EmailAuthProvider: { credential: (email: string, password: string) => ({ email, password }) } }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), deleteDoc: vi.fn() }));
vi.mock('../../../services/audioEngine', () => ({ audioEngine: { getMuted: () => state.muted, setMuted: vi.fn() } }));
vi.mock('../../../services/storageEngine', () => ({ storageEngine: { getSessions: state.getSessions, saveSession: state.saveSession, getClient: state.getClient, ensureTidalGardenState: state.ensureGarden, preparePatientAccountDeletion: state.prepareDeletion } }));
vi.mock('../patientSessionCsv', () => ({ exportPatientSessionCsv: state.exportCsv }));
vi.mock('../HomeScreen', () => ({ HomeScreen: 'home-screen' }));
vi.mock('../ProgressHistory', () => ({ ProgressHistory: 'progress-history' }));
vi.mock('../SessionRunner', () => ({ SessionRunner: 'session-runner' }));
vi.mock('../PostSessionSummary', () => ({ PostSessionSummary: 'post-session-summary' }));
vi.mock('../ProtocolDetailsModal', () => ({ ProtocolDetailsModal: 'protocol-details' }));
vi.mock('../EducationHub', () => ({ EducationHub: 'education-hub' }));
vi.mock('../PatientMessagingView', () => ({ PatientMessagingView: 'patient-messages' }));
vi.mock('../PatientAppointmentsView', () => ({ PatientAppointmentsView: 'patient-appointments' }));
vi.mock('../../brand/BrandLogo', () => ({ BrandLogo: 'brand-logo' }));

import { PatientShell } from '../PatientShell';

const client: ClientProfile = {
  id: 'patient-1', name: 'Patient One', email: 'patient@example.com', status: 'active',
  allowedExperiences: ['tidal-garden'], brainMaps: [], badges: [], completedSessionsCount: 0, currentStreak: 0,
};
const brand = { name: 'Clinic', logoUrl: '' } as ClinicBrandConfig;

describe('PatientShell persisted profile writes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.reauthenticate.mockReset();
    state.prepareDeletion.mockReset();
    state.getSessions.mockResolvedValue([]);
    state.auth.currentUser = null;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('does not delete a different account when Auth changes during password confirmation', async () => {
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { ...originalWindow, confirm: () => true } });
    const oldUser = { uid: client.id, email: client.email, delete: vi.fn(async () => {}) };
    state.auth.currentUser = oldUser;
    let finishReauth!: () => void;
    state.reauthenticate.mockReturnValueOnce(new Promise<void>((resolve) => { finishReauth = resolve; }));
    let renderer!: ReactTestRenderer;
    try {
      await act(async () => { renderer = create(<PatientShell brand={brand} client={client} onUpdateClient={vi.fn()} onClientPersistedElsewhere={vi.fn()} onOpenRebrand={vi.fn()} />); });
      const profile = renderer.root.findAllByType('button').find((button) => button.findAllByType('span').some((span) => span.children.join('') === 'Profile'))!;
      act(() => profile.props.onClick());
      act(() => renderer.root.findAllByType('button').find((button) => button.children.some((child) => typeof child === 'string' && child.includes('Delete Account')))!.props.onClick());
      act(() => renderer.root.findByProps({ id: 'account-deletion-password' }).props.onChange({ target: { value: 'secret' } }));
      await act(async () => {
        renderer.root.findAllByType('form').at(-1)!.props.onSubmit({ preventDefault: vi.fn() });
        await Promise.resolve();
      });
      state.auth.currentUser = { uid: 'other-patient', email: 'other@example.com', delete: vi.fn(async () => {}) };
      await act(async () => { finishReauth(); await Promise.resolve(); });
      expect(state.prepareDeletion).not.toHaveBeenCalled();
      expect(oldUser.delete).not.toHaveBeenCalled();
    } finally {
      renderer?.unmount();
      Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
    }
  });

  it('keeps deletion confirmation masked and disabled while pending, then shows reauthentication errors', async () => {
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { ...originalWindow, confirm: () => true } });
    const user = { uid: client.id, email: client.email, delete: vi.fn(async () => {}) };
    state.auth.currentUser = user;
    let rejectReauth!: (reason: Error) => void;
    state.reauthenticate.mockReturnValueOnce(new Promise<void>((_resolve, reject) => { rejectReauth = reject; }));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<PatientShell brand={brand} client={client} onUpdateClient={vi.fn()} onClientPersistedElsewhere={vi.fn()} onOpenRebrand={vi.fn()} />); });
    try {
      act(() => renderer.root.findAllByType('button').find((button) => button.findAllByType('span').some((span) => span.children.join('') === 'Profile'))!.props.onClick());
      act(() => renderer.root.findAllByType('button').find((button) => button.children.some((child) => typeof child === 'string' && child.includes('Delete Account')))!.props.onClick());
      const password = () => renderer.root.findByProps({ id: 'account-deletion-password' });
      const submit = () => renderer.root.findByProps({ className: 'btn account-deletion-submit' });
      expect(password().props.type).toBe('password');
      expect(password().props.autoComplete).toBe('current-password');
      expect(password().props.className).toBe('account-deletion-password');
      expect(submit().props.disabled).toBe(true);
      act(() => password().props.onChange({ target: { value: 'secret' } }));
      expect(submit().props.disabled).toBe(false);

      const form = () => renderer.root.findByProps({ className: 'account-deletion-confirmation' });
      await act(async () => { form().props.onSubmit({ preventDefault: vi.fn() }); await Promise.resolve(); });
      expect(form().props['aria-busy']).toBe(true);
      expect(password().props.disabled).toBe(true);
      expect(submit().children.join('')).toBe('Finishing…');
      expect(submit().props.disabled).toBe(true);

      await act(async () => { rejectReauth(new Error('Incorrect password')); await Promise.resolve(); });
      expect(form().props['aria-busy']).toBe(false);
      expect(password().props.value).toBe('');
      expect(password().props.disabled).toBe(false);
      expect(password().props['aria-invalid']).toBe(true);
      expect(password().props['aria-describedby']).toBe('account-deletion-error');
      expect(renderer.root.findByProps({ id: 'account-deletion-error' }).children.join('')).toBe('Incorrect password');
      expect(submit().props.disabled).toBe(true);
      expect(state.prepareDeletion).not.toHaveBeenCalled();
    } finally {
      await act(async () => { renderer.unmount(); });
      Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
    }
  });

  it('reloads the marked finish screen and retries after Auth deletion fails', async () => {
    const originalWindow = globalThis.window;
    const testWindow = { ...originalWindow, location: { href: '' } };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: testWindow });
    const user = { uid: client.id, email: client.email, delete: vi.fn()
      .mockRejectedValueOnce(new Error('Auth temporarily unavailable'))
      .mockResolvedValueOnce(undefined) };
    state.auth.currentUser = user;
    state.reauthenticate.mockResolvedValue(undefined);
    state.prepareDeletion.mockResolvedValue(undefined);
    const marked = { ...client, accountDeletionStartedAt: new Date(), clinicianId: undefined, clinicId: undefined };
    let renderer!: ReactTestRenderer;
    try {
      await act(async () => { renderer = create(<PatientShell brand={brand} client={marked} onUpdateClient={vi.fn()} onClientPersistedElsewhere={vi.fn()} onOpenRebrand={vi.fn()} />); });
      const submit = async () => {
        act(() => renderer.root.findAllByType('button').find((button) => button.children.join('') === 'Finish account deletion')!.props.onClick());
        act(() => renderer.root.findByProps({ id: 'account-deletion-password' }).props.onChange({ target: { value: 'secret' } }));
        await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }); await Promise.resolve(); await Promise.resolve(); });
      };
      await submit();
      expect(user.delete).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(renderer.toJSON())).toContain('Auth temporarily unavailable');
      await act(async () => { renderer.unmount(); });
      await act(async () => { renderer = create(<PatientShell brand={brand} client={marked} onUpdateClient={vi.fn()} onClientPersistedElsewhere={vi.fn()} onOpenRebrand={vi.fn()} />); });
      expect(JSON.stringify(renderer.toJSON())).toContain('Finish deleting your account');
      await submit();
      expect(user.delete).toHaveBeenCalledTimes(2);
      expect(testWindow.location.href).toBe('/welcome');
    } finally {
      renderer?.unmount();
      Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
    }
  });

  it('waits for legacy garden initialization, offers retry, then opens with saved state', async () => {
    state.ensureGarden.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ...client, tidalGardenState: { stage: 1, growthPoints: 0, plantsUnlocked: [], lastWatered: '' } });
    const onClientPersistedElsewhere = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<PatientShell brand={brand} client={client} onUpdateClient={vi.fn()} onClientPersistedElsewhere={onClientPersistedElsewhere} onOpenRebrand={vi.fn()} />); });
    await act(async () => { await renderer.root.find((node) => (node.type as unknown) === 'home-screen').props.onStartSession('tidal-garden'); });
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('offline');
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'session-runner')).toHaveLength(0);
    await act(async () => { await renderer.root.findAllByType('button').find((button) => button.children.join('') === 'Retry')!.props.onClick(); });
    expect(state.ensureGarden).toHaveBeenCalledTimes(2);
    expect(onClientPersistedElsewhere).toHaveBeenCalledWith(expect.objectContaining({ tidalGardenState: expect.objectContaining({ stage: 1 }) }));
    expect(renderer.root.find((node) => (node.type as unknown) === 'session-runner').props.client.tidalGardenState.stage).toBe(1);
    const savedSession = { id: 'garden-session', patientId: client.id, isDemo: true };
    const grown = { ...client, tidalGardenState: { stage: 1, growthPoints: 120, plantsUnlocked: [], lastWatered: '' } };
    state.saveSession.mockResolvedValueOnce(undefined);
    state.getClient.mockResolvedValueOnce(grown);
    await act(async () => { await renderer.root.find((node) => (node.type as unknown) === 'session-runner').props.onComplete(savedSession); });
    expect(state.saveSession).toHaveBeenCalledWith(savedSession);
    expect(state.getClient).toHaveBeenCalledWith(client.id);
    expect(onClientPersistedElsewhere).toHaveBeenLastCalledWith(grown);
    renderer.unmount();
  });

  it('discards an old account garden ensure after switching patients', async () => {
    let resolveEnsure!: (value: ClientProfile) => void;
    state.ensureGarden.mockReturnValueOnce(new Promise((resolve) => { resolveEnsure = resolve; }));
    const onClientPersistedElsewhere = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<PatientShell brand={brand} client={client} onUpdateClient={vi.fn()} onClientPersistedElsewhere={onClientPersistedElsewhere} onOpenRebrand={vi.fn()} />); });
    act(() => { void renderer.root.find((node) => (node.type as unknown) === 'home-screen').props.onStartSession('tidal-garden'); });
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'session-runner')).toHaveLength(0);
    const nextClient = { ...client, id: 'patient-2' };
    await act(async () => { renderer.update(<PatientShell brand={brand} client={nextClient} onUpdateClient={vi.fn()} onClientPersistedElsewhere={onClientPersistedElsewhere} onOpenRebrand={vi.fn()} />); });
    await act(async () => { resolveEnsure({ ...client, tidalGardenState: { stage: 1, growthPoints: 0, plantsUnlocked: [], lastWatered: '' } }); });
    expect(onClientPersistedElsewhere).not.toHaveBeenCalled();
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'session-runner')).toHaveLength(0);
    renderer.unmount();
  });

  it('does not open a garden whose assignment was removed while initialization was pending', async () => {
    let resolveEnsure!: (value: ClientProfile) => void;
    state.ensureGarden.mockReturnValueOnce(new Promise((resolve) => { resolveEnsure = resolve; }));
    const assigned = { ...client, allowedExperiences: ['tidal-garden' as const] };
    const onClientPersistedElsewhere = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<PatientShell brand={brand} client={assigned} onUpdateClient={vi.fn()} onClientPersistedElsewhere={onClientPersistedElsewhere} onOpenRebrand={vi.fn()} />); });
    act(() => { void renderer.root.find((node) => (node.type as unknown) === 'home-screen').props.onStartSession('tidal-garden'); });
    await act(async () => { renderer.update(<PatientShell brand={brand} client={{ ...assigned, allowedExperiences: ['skyline-drift'] }} onUpdateClient={vi.fn()} onClientPersistedElsewhere={onClientPersistedElsewhere} onOpenRebrand={vi.fn()} />); });
    await act(async () => { resolveEnsure({ ...assigned, tidalGardenState: { stage: 1, growthPoints: 0, plantsUnlocked: [], lastWatered: '' } }); });
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'session-runner')).toHaveLength(0);
    expect(onClientPersistedElsewhere).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('shows a retryable avatar persistence error and retries the same update', async () => {
    const onUpdateClient = vi.fn()
      .mockRejectedValueOnce(new Error('avatar save offline'))
      .mockResolvedValueOnce(undefined);
    const originalDocument = globalThis.document;
    const input = { type: '', accept: '', onchange: null as null | ((event: unknown) => void), click: vi.fn() };
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => input } });
    const OriginalReader = globalThis.FileReader;
    class Reader {
      result: string | ArrayBuffer | null = 'data:image/png;base64,abc';
      onloadend: null | (() => void) = null;
      readAsDataURL() { this.onloadend?.(); }
    }
    Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: Reader });

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<PatientShell brand={brand} client={client} onUpdateClient={onUpdateClient} onClientPersistedElsewhere={vi.fn()} onOpenRebrand={vi.fn()} />);
    });
    const profileTab = renderer.root.findAllByType('button').find((button) =>
      button.findAllByType('span').some((span) => span.children.join('') === 'Profile')
    )!;
    act(() => profileTab.props.onClick());
    act(() => renderer.root.findByProps({ 'aria-label': 'Upload profile photo' }).props.onClick());
    await act(async () => {
      input.onchange?.({ target: { files: [{ size: 100 }] } });
      await Promise.resolve();
    });

    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('avatar save offline');
    const refreshedClient = { ...client, completedSessionsCount: 3, badges: ['first-light'] };
    await act(async () => {
      renderer.update(<PatientShell brand={brand} client={refreshedClient} onUpdateClient={onUpdateClient} onClientPersistedElsewhere={vi.fn()} onOpenRebrand={vi.fn()} />);
    });
    const retry = renderer.root.findAllByType('button').find((button) => button.children.join('') === 'Retry')!;
    await act(async () => { await retry.props.onClick(); });
    expect(onUpdateClient).toHaveBeenCalledTimes(2);
    expect(onUpdateClient.mock.calls[1][0]).toMatchObject({
      avatarUrl: 'data:image/png;base64,abc',
      completedSessionsCount: 3,
      badges: ['first-light'],
    });

    renderer.unmount();
    Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
    Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: OriginalReader });
  });

  it('refreshes local profile state after the session transaction without resaving it', async () => {
    const assigned = { ...client, assignedProtocol: 'theta-beta-ratio' as const, allowedExperiences: ['skyline-drift' as const] };
    const refreshed = { ...assigned, completedSessionsCount: 1 };
    state.saveSession.mockResolvedValueOnce(undefined);
    state.getClient.mockResolvedValueOnce(refreshed);
    const onUpdateClient = vi.fn();
    const onClientPersistedElsewhere = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<PatientShell brand={brand} client={assigned} onUpdateClient={onUpdateClient} onClientPersistedElsewhere={onClientPersistedElsewhere} onOpenRebrand={vi.fn()} />);
    });
    act(() => renderer.root.find((node) => (node.type as unknown) === 'home-screen').props.onStartSession('skyline-drift'));
    const session = { id: 'session-1', patientId: client.id };
    await act(async () => {
      await renderer.root.find((node) => (node.type as unknown) === 'session-runner').props.onComplete(session);
    });

    expect(state.saveSession).toHaveBeenCalledWith(session);
    expect(state.getClient).toHaveBeenCalledWith(client.id);
    expect(onClientPersistedElsewhere).toHaveBeenCalledWith(refreshed);
    expect(onUpdateClient).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('exports every stored Profile row through the shared exporter, including demos and invalid timestamps', async () => {
    const allRows = [
      { id: 'demo', isDemo: true, timestamp: 0 },
      { id: 'legacy', timestamp: Date.parse('2026-09-27T12:00:00Z') },
    ];
    state.getSessions.mockResolvedValueOnce(allRows);
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<PatientShell brand={brand} client={client} onUpdateClient={vi.fn()} onClientPersistedElsewhere={vi.fn()} onOpenRebrand={vi.fn()} />);
    });
    act(() => renderer.root.findAllByType('button').find((button) =>
      button.findAllByType('span').some((span) => span.children.join('') === 'Profile')
    )!.props.onClick());
    await act(async () => {
      await renderer.root.findAllByType('button').find((button) => button.children.some((child) => child === 'Export Data (CSV)'))!.props.onClick();
    });
    expect(state.getSessions).toHaveBeenCalledWith(client.id);
    expect(state.exportCsv).toHaveBeenCalledTimes(1);
    expect(state.exportCsv.mock.calls[0][0]).toBe(allRows);
    renderer.unmount();
  });

  it('keeps Profile read-error and empty-result gates before export delivery', async () => {
    const originalAlert = globalThis.alert;
    const alert = vi.fn();
    Object.defineProperty(globalThis, 'alert', { configurable: true, value: alert });
    state.getSessions.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
    let renderer!: ReactTestRenderer;
    try {
      await act(async () => {
        renderer = create(<PatientShell brand={brand} client={client} onUpdateClient={vi.fn()} onClientPersistedElsewhere={vi.fn()} onOpenRebrand={vi.fn()} />);
      });
      act(() => renderer.root.findAllByType('button').find((button) =>
        button.findAllByType('span').some((span) => span.children.join('') === 'Profile')
      )!.props.onClick());
      const exportButton = () => renderer.root.findAllByType('button').find((button) => button.children.some((child) => child === 'Export Data (CSV)'))!;
      await act(async () => { await exportButton().props.onClick(); });
      await act(async () => { await exportButton().props.onClick(); });
      expect(alert.mock.calls.map(([message]) => message)).toEqual([
        'Session data is unavailable right now. Try again after the connection recovers.',
        'No session data to export.',
      ]);
      expect(state.exportCsv).not.toHaveBeenCalled();
      renderer.unmount();
    } finally {
      Object.defineProperty(globalThis, 'alert', { configurable: true, value: originalAlert });
    }
  });

  it('shows only saved Neural Imprint values and routes recalibration without a profile write', async () => {
    const onRecalibrate = vi.fn();
    const onUpdateClient = vi.fn();
    const model = { alphaPeakHz: 9.8, oneOverFSlope: 1.1, lastCalibratedAt: '2026-09-26T12:00:00Z' };
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<PatientShell brand={brand} client={{ ...client, individualBaselineModel: model }} onUpdateClient={onUpdateClient} onClientPersistedElsewhere={vi.fn()} onOpenRebrand={vi.fn()} onRecalibrate={onRecalibrate} />);
    });
    act(() => renderer.root.findAllByType('button').find((button) =>
      button.findAllByType('span').some((span) => span.children.join('') === 'Profile')
    )!.props.onClick());
    const textContent = (node: ReactTestInstance | string): string =>
      typeof node === 'string' ? node : node.children.map(textContent).join('');
    const summary = () => textContent(renderer.root.findByProps({ 'aria-label': 'Neural Imprint' }));
    expect(summary()).toContain('Current');
    expect(summary()).toContain('9.8 Hz');
    expect(summary()).not.toContain('Reactivity');
    expect(summary()).not.toContain('Purity');
    act(() => renderer.root.findAllByType('button').find((button) => button.children.join('') === 'Recalibrate')!.props.onClick());
    expect(onRecalibrate).toHaveBeenCalledTimes(1);
    expect(onUpdateClient).not.toHaveBeenCalled();

    await act(async () => { renderer.update(<PatientShell brand={brand} client={{ ...client, individualBaselineModel: { ...model, algorithmVersion: 'neurogambit-15s-v1', thetaMean: 2, betaMean: 4, alphaMean: 6 } }} onUpdateClient={onUpdateClient} onClientPersistedElsewhere={vi.fn()} onOpenRebrand={vi.fn()} />); });
    expect(summary()).toContain('Current');
    expect(summary()).not.toContain('9.8 Hz');
    await act(async () => { renderer.update(<PatientShell brand={brand} client={{ ...client, individualBaselineModel: { ...model, expiresAt: 0 } }} onUpdateClient={onUpdateClient} onClientPersistedElsewhere={vi.fn()} onOpenRebrand={vi.fn()} />); });
    expect(summary()).toContain('Expired');
    await act(async () => { renderer.update(<PatientShell brand={brand} client={client} onUpdateClient={onUpdateClient} onClientPersistedElsewhere={vi.fn()} onOpenRebrand={vi.fn()} />); });
    expect(summary()).toContain('Not calibrated');
    renderer.unmount();
  });
});

describe('PatientShell Garden assignment races', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.getSessions.mockResolvedValue([]);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('keeps the newer patient Garden opening pending when the older patient ensure finishes', async () => {
    let resolveA!: (value: ClientProfile) => void;
    let resolveB!: (value: ClientProfile) => void;
    state.ensureGarden
      .mockReturnValueOnce(new Promise((resolve) => { resolveA = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveB = resolve; }));
    const a = { ...client, id: 'A', allowedExperiences: ['tidal-garden' as const] };
    const b = { ...client, id: 'B', allowedExperiences: ['tidal-garden' as const] };
    const props = (profile: ClientProfile) => <PatientShell brand={brand} client={profile} onUpdateClient={vi.fn()} onClientPersistedElsewhere={vi.fn()} onOpenRebrand={vi.fn()} />;
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(props(a)); });
    act(() => { void renderer.root.find((node) => (node.type as unknown) === 'home-screen').props.onStartSession('tidal-garden'); });
    await act(async () => { renderer.update(props(b)); });
    act(() => { void renderer.root.find((node) => (node.type as unknown) === 'home-screen').props.onStartSession('tidal-garden'); });
    expect(JSON.stringify(renderer.toJSON())).toContain('Opening Tidal Garden');
    await act(async () => { resolveA({ ...a, tidalGardenState: { stage: 1, growthPoints: 0, plantsUnlocked: [], lastWatered: '' } }); });
    expect(JSON.stringify(renderer.toJSON())).toContain('Opening Tidal Garden');
    await act(async () => { resolveB({ ...b, tidalGardenState: { stage: 1, growthPoints: 0, plantsUnlocked: [], lastWatered: '' } }); });
    expect(renderer.root.find((node) => (node.type as unknown) === 'session-runner').props.client.id).toBe('B');
    await act(async () => { renderer.unmount(); });
  });

  it('does not forward an old Garden ensure profile over a newer still-Garden assignment', async () => {
    let resolveEnsure!: (value: ClientProfile) => void;
    state.ensureGarden.mockReturnValueOnce(new Promise((resolve) => { resolveEnsure = resolve; }));
    const before = { ...client, allowedExperiences: ['tidal-garden' as const, 'skyline-drift' as const] };
    const after = { ...client, allowedExperiences: ['tidal-garden' as const, 'narrative-story' as const], prescribedSessionsPerWeek: 5 };
    const onClientPersistedElsewhere = vi.fn();
    const props = (profile: ClientProfile) => <PatientShell brand={brand} client={profile} onUpdateClient={vi.fn()} onClientPersistedElsewhere={onClientPersistedElsewhere} onOpenRebrand={vi.fn()} />;
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(props(before)); });
    act(() => { void renderer.root.find((node) => (node.type as unknown) === 'home-screen').props.onStartSession('tidal-garden'); });
    await act(async () => { renderer.update(props(after)); });
    await act(async () => { resolveEnsure({ ...before, tidalGardenState: { stage: 1, growthPoints: 0, plantsUnlocked: [], lastWatered: '' } }); });
    expect(onClientPersistedElsewhere).toHaveBeenCalledWith(expect.objectContaining({ allowedExperiences: after.allowedExperiences }));
    expect(onClientPersistedElsewhere).toHaveBeenCalledWith(expect.objectContaining({ prescribedSessionsPerWeek: 5, tidalGardenState: expect.objectContaining({ stage: 1 }) }));
    expect(renderer.root.find((node) => (node.type as unknown) === 'session-runner').props.client.allowedExperiences).toEqual(after.allowedExperiences);
    await act(async () => { renderer.unmount(); });
  });
});

describe('PatientShell returned Garden assignment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.getSessions.mockResolvedValue([]);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });
  it('does not open Garden when ensure returns a newer profile excluding Garden', async () => {
    const assigned = { ...client, allowedExperiences: ['tidal-garden' as const] };
    const returned = { ...assigned, allowedExperiences: ['skyline-drift' as const], tidalGardenState: { stage: 1, growthPoints: 0, plantsUnlocked: [], lastWatered: '' } };
    state.ensureGarden.mockResolvedValueOnce(returned);
    const onClientPersistedElsewhere = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<PatientShell brand={brand} client={assigned} onUpdateClient={vi.fn()} onClientPersistedElsewhere={onClientPersistedElsewhere} onOpenRebrand={vi.fn()} />); });
    await act(async () => { await renderer.root.find((node) => (node.type as unknown) === 'home-screen').props.onStartSession('tidal-garden'); });
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'session-runner')).toHaveLength(0);
    expect(onClientPersistedElsewhere).toHaveBeenCalledWith(expect.objectContaining({ allowedExperiences: returned.allowedExperiences, tidalGardenState: expect.objectContaining({ stage: 1 }) }));
    await act(async () => { renderer.unmount(); });
  });
});

describe('PatientShell Garden profile freshness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.getSessions.mockResolvedValue([]);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('keeps a returned assignment change after an unrelated mounted profile refresh', async () => {
    let resolveEnsure!: (value: ClientProfile) => void;
    state.ensureGarden.mockReturnValueOnce(new Promise((resolve) => { resolveEnsure = resolve; }));
    const before = { ...client, allowedExperiences: ['tidal-garden' as const] };
    const refreshed = { ...before, name: 'Current Name' };
    const returned = { ...before, allowedExperiences: ['skyline-drift' as const], tidalGardenState: { stage: 1, growthPoints: 0, plantsUnlocked: [], lastWatered: '' } };
    const onClientPersistedElsewhere = vi.fn();
    const props = (profile: ClientProfile) => <PatientShell brand={brand} client={profile} onUpdateClient={vi.fn()} onClientPersistedElsewhere={onClientPersistedElsewhere} onOpenRebrand={vi.fn()} />;
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(props(before)); });
    act(() => { void renderer.root.find((node) => (node.type as unknown) === 'home-screen').props.onStartSession('tidal-garden'); });
    await act(async () => { renderer.update(props(refreshed)); });
    await act(async () => { resolveEnsure(returned); });
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'session-runner')).toHaveLength(0);
    expect(onClientPersistedElsewhere).toHaveBeenCalledWith(expect.objectContaining({ name: 'Current Name', allowedExperiences: returned.allowedExperiences }));
    await act(async () => { renderer.unmount(); });
  });

  it('does not replace newer mounted Garden growth with an older ensure result', async () => {
    let resolveEnsure!: (value: ClientProfile) => void;
    state.ensureGarden.mockReturnValueOnce(new Promise((resolve) => { resolveEnsure = resolve; }));
    const before = { ...client, allowedExperiences: ['tidal-garden' as const] };
    const growth = { stage: 3, growthPoints: 350, plantsUnlocked: [], lastWatered: '' };
    const refreshed = { ...before, tidalGardenState: growth };
    const returned = { ...before, tidalGardenState: { stage: 1, growthPoints: 0, plantsUnlocked: [], lastWatered: '' } };
    const onClientPersistedElsewhere = vi.fn();
    const props = (profile: ClientProfile) => <PatientShell brand={brand} client={profile} onUpdateClient={vi.fn()} onClientPersistedElsewhere={onClientPersistedElsewhere} onOpenRebrand={vi.fn()} />;
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(props(before)); });
    act(() => { void renderer.root.find((node) => (node.type as unknown) === 'home-screen').props.onStartSession('tidal-garden'); });
    await act(async () => { renderer.update(props(refreshed)); });
    await act(async () => { resolveEnsure(returned); });
    expect(onClientPersistedElsewhere).toHaveBeenCalledWith(expect.objectContaining({ tidalGardenState: growth }));
    expect(renderer.root.find((node) => (node.type as unknown) === 'session-runner').props.client.tidalGardenState).toBe(growth);
    await act(async () => { renderer.unmount(); });
  });
});

describe('PatientShell Garden return-to-catalogue retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.getSessions.mockResolvedValue([]);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });
  it('does not fast-path launch Garden after a returned revocation is published following a name refresh', async () => {
    let resolveEnsure!: (value: ClientProfile) => void;
    state.ensureGarden.mockReturnValueOnce(new Promise((resolve) => { resolveEnsure = resolve; }));
    const before = { ...client, allowedExperiences: ['tidal-garden' as const] };
    const refreshed = { ...before, name: 'Current Name' };
    let published: ClientProfile | undefined;
    const onClientPersistedElsewhere = vi.fn((profile: ClientProfile) => { published = profile; });
    const props = (profile: ClientProfile) => <PatientShell brand={brand} client={profile} onUpdateClient={vi.fn()} onClientPersistedElsewhere={onClientPersistedElsewhere} onOpenRebrand={vi.fn()} />;
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(props(before)); });
    act(() => { void renderer.root.find((node) => (node.type as unknown) === 'home-screen').props.onStartSession('tidal-garden'); });
    await act(async () => { renderer.update(props(refreshed)); });
    await act(async () => { resolveEnsure({ ...before, allowedExperiences: ['skyline-drift'], tidalGardenState: { stage: 1, growthPoints: 0, plantsUnlocked: [], lastWatered: '' } }); });
    expect(published).toBeDefined();
    await act(async () => { renderer.update(props(published!)); });
    act(() => { void renderer.root.find((node) => (node.type as unknown) === 'home-screen').props.onStartSession('tidal-garden'); });
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'session-runner')).toHaveLength(0);
    await act(async () => { renderer.unmount(); });
  });
});
