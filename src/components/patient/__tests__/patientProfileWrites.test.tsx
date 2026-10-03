import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientProfile, ClinicBrandConfig } from '../../../types';

const state = vi.hoisted(() => ({
  muted: false,
  getSessions: vi.fn(),
  saveSession: vi.fn(),
  getClient: vi.fn(),
  exportCsv: vi.fn(),
  auth: { currentUser: null as null | { uid: string; email: string; delete: () => Promise<void> } },
  reauthenticate: vi.fn(),
  prepareDeletion: vi.fn(),
  // The cache lifecycle (firestoreCacheLifecycle.test.ts) runs `before` (the
  // Auth deletion) and, only if it succeeds, clears and navigates.
  endSession: vi.fn(async ({ before, destination }: { before?: () => Promise<void>; destination: string | null }) => {
    await before?.();
    (globalThis as { window?: { location: { href: string } } }).window!.location.href = destination ?? '';
  }),
}));

vi.mock('../../../services/firebase', () => ({ auth: state.auth, db: {}, firestoreCache: { endSession: state.endSession } }));
vi.mock('firebase/auth', () => ({ signOut: vi.fn(), reauthenticateWithCredential: state.reauthenticate,
  EmailAuthProvider: { credential: (email: string, password: string) => ({ email, password }) } }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), deleteDoc: vi.fn() }));
vi.mock('../../../services/audioEngine', () => ({ audioEngine: { getMuted: () => state.muted, setMuted: vi.fn() } }));
vi.mock('../../../services/storageEngine', () => ({ storageEngine: { getSessions: state.getSessions, saveSession: state.saveSession, getClient: state.getClient, preparePatientAccountDeletion: state.prepareDeletion, hasPendingInvitationNotice: async () => false } }));
vi.mock('../patientSessionCsv', () => ({ exportPatientSessionCsv: state.exportCsv }));
vi.mock('../HomeScreen', () => ({ HomeScreen: 'home-screen' }));
vi.mock('../ProgressHistory', () => ({ ProgressHistory: 'progress-history' }));
vi.mock('../SessionRunner', () => ({ SessionRunner: 'session-runner' }));
vi.mock('../PostSessionSummary', () => ({ PostSessionSummary: 'post-session-summary' }));
vi.mock('../ProtocolDetailsModal', () => ({ ProtocolDetailsModal: 'protocol-details' }));
vi.mock('../PatientMessagingView', () => ({ PatientMessagingView: 'patient-messages' }));
vi.mock('../PatientAppointmentsView', () => ({ PatientAppointmentsView: 'patient-appointments' }));
vi.mock('../../brand/BrandLogo', () => ({ BrandLogo: 'brand-logo' }));

import { PatientShell } from '../PatientShell';

const client: ClientProfile = {
  id: 'patient-1', name: 'Patient One', email: 'patient@example.com', status: 'active',
  allowedExperiences: ['neuro-gambit'], brainMaps: [], badges: [], completedSessionsCount: 0, currentStreak: 0,
};
const brand = { name: 'Clinic', logoUrl: '' } as ClinicBrandConfig;

// Firebase Auth and Firestore throw an Error carrying a string code.
const firebaseError = (code: string) =>
  Object.assign(new Error(`Firebase: Error (${code}).`), { name: 'FirebaseError', code });
const deactivated: ClientProfile = { ...client, accountDeletionStartedAt: new Date(), clinicianId: undefined, clinicId: undefined };
const flush = () => new Promise<void>((resolve) => { setTimeout(resolve, 0); });

const stubWindow = (overrides: Record<string, unknown>) => {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { ...originalWindow, ...overrides } });
  return () => Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
};

/** Mirrors App: a profile persisted elsewhere replaces the mounted client. */
const StatefulShell: React.FC<{ initial: ClientProfile; onPersisted: (updated: ClientProfile) => void }> = ({ initial, onPersisted }) => {
  const [current, setCurrent] = React.useState(initial);
  return <PatientShell brand={brand} client={current} onUpdateClient={vi.fn()} onClientPersistedElsewhere={(updated) => { onPersisted(updated); setCurrent(updated); }} />;
};

const rendered = (renderer: ReactTestRenderer) => JSON.stringify(renderer.toJSON());
const deletionTrigger = (renderer: ReactTestRenderer) => renderer.root.findAllByType('button')
  .find((button) => button.children.some((child) => typeof child === 'string' && child.includes('Delete Account')))!;
const openProfileDeletion = (renderer: ReactTestRenderer) => {
  act(() => renderer.root.findAllByType('button').find((button) => button.findAllByType('span').some((span) => span.children.join('') === 'Profile'))!.props.onClick());
  act(() => deletionTrigger(renderer).props.onClick());
};
const deletionPasswordInputs = (renderer: ReactTestRenderer) => renderer.root.findAllByProps({ id: 'account-deletion-password' });
const typeDeletionPassword = (renderer: ReactTestRenderer, value: string) =>
  act(() => renderer.root.findByProps({ id: 'account-deletion-password' }).props.onChange({ target: { value } }));
const submitDeletion = (renderer: ReactTestRenderer) =>
  renderer.root.findByProps({ className: 'account-deletion-confirmation' }).props.onSubmit({ preventDefault: vi.fn() });
const deletionError = (renderer: ReactTestRenderer) => renderer.root.findByProps({ id: 'account-deletion-error' }).children.join('');
const deletionStatusText = (renderer: ReactTestRenderer) => renderer.root
  .findAll((node) => typeof node.type === 'string' && node.props.role === 'status' && String(node.props.className).includes('account-deletion-status'))
  .map((node) => node.children.join(''));

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
    const oldUser = { uid: client.id, email: client.email, delete: vi.fn(async () => {}) };
    state.auth.currentUser = oldUser;
    let finishReauth!: () => void;
    state.reauthenticate.mockReturnValueOnce(new Promise<void>((resolve) => { finishReauth = resolve; }));
    let renderer!: ReactTestRenderer;
    try {
      await act(async () => { renderer = create(<PatientShell brand={brand} client={client} onUpdateClient={vi.fn()} onClientPersistedElsewhere={vi.fn()} />); });
      openProfileDeletion(renderer);
      typeDeletionPassword(renderer, 'secret');
      await act(async () => {
        submitDeletion(renderer);
        await Promise.resolve();
      });
      state.auth.currentUser = { uid: 'other-patient', email: 'other@example.com', delete: vi.fn(async () => {}) };
      await act(async () => { finishReauth(); await Promise.resolve(); });
      expect(state.prepareDeletion).not.toHaveBeenCalled();
      expect(oldUser.delete).not.toHaveBeenCalled();
      // App-authored guard messages are written for the patient and stay verbatim.
      expect(deletionError(renderer)).toBe('Your signed-in account changed. Restart account deletion.');
    } finally {
      renderer?.unmount();
    }
  });

  it('opens deletion in-app, holds a pending status, and turns a wrong password into a readable retry', async () => {
    const confirm = vi.fn(() => true);
    const restoreWindow = stubWindow({ confirm });
    const user = { uid: client.id, email: client.email, delete: vi.fn(async () => {}) };
    state.auth.currentUser = user;
    let rejectReauth!: (reason: unknown) => void;
    state.reauthenticate.mockReturnValueOnce(new Promise<void>((_resolve, reject) => { rejectReauth = reject; }));
    const onClientPersistedElsewhere = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<PatientShell brand={brand} client={client} onUpdateClient={vi.fn()} onClientPersistedElsewhere={onClientPersistedElsewhere} />); });
    try {
      openProfileDeletion(renderer);
      // The in-app step is the only confirmation: no browser dialog first.
      expect(confirm).not.toHaveBeenCalled();
      expect(rendered(renderer)).toContain('This action cannot be undone.');
      const password = () => renderer.root.findByProps({ id: 'account-deletion-password' });
      const submit = () => renderer.root.findByProps({ className: 'btn account-deletion-submit' });
      expect(password().props.type).toBe('password');
      expect(password().props.autoComplete).toBe('current-password');
      expect(password().props.className).toBe('account-deletion-password');
      expect(submit().children.join('')).toBe('Confirm account deletion');
      expect(submit().props.disabled).toBe(true);
      typeDeletionPassword(renderer, 'Wrong-Horse-7731');
      expect(submit().props.disabled).toBe(false);

      await act(async () => { submitDeletion(renderer); await Promise.resolve(); });
      expect(state.reauthenticate).toHaveBeenCalledWith(user, { email: client.email, password: 'Wrong-Horse-7731' });
      expect(deletionStatusText(renderer)).toEqual(['Deleting your account…']);
      expect(deletionPasswordInputs(renderer)).toHaveLength(0);
      expect(renderer.root.findAllByProps({ className: 'account-deletion-confirmation' })).toHaveLength(0);
      expect(rendered(renderer)).not.toContain('Wrong-Horse-7731');
      expect(deletionTrigger(renderer).props.disabled).toBe(true);

      await act(async () => {
        rejectReauth(firebaseError('auth/invalid-credential'));
        await Promise.resolve();
      });
      expect(deletionStatusText(renderer)).toEqual([]);
      expect(deletionError(renderer)).toBe('Incorrect password. Please try again.');
      expect(rendered(renderer)).not.toMatch(/Firebase|auth\//);
      expect(password().props.value).toBe('');
      expect(password().props.disabled).toBeFalsy();
      expect(password().props['aria-invalid']).toBe(true);
      expect(password().props['aria-describedby']).toBe('account-deletion-error');
      expect(submit().props.disabled).toBe(true);
      expect(deletionTrigger(renderer).props.disabled).toBe(false);
      expect(state.prepareDeletion).not.toHaveBeenCalled();
      expect(user.delete).not.toHaveBeenCalled();
      expect(onClientPersistedElsewhere).not.toHaveBeenCalled();
      typeDeletionPassword(renderer, 'Correct-Horse-7731');
      expect(submit().props.disabled).toBe(false);
    } finally {
      await act(async () => { renderer.unmount(); });
      restoreWindow();
    }
  });

  it('Cancel closes the deletion step and clears the password and error', async () => {
    state.auth.currentUser = { uid: client.id, email: client.email, delete: vi.fn(async () => {}) };
    state.reauthenticate.mockRejectedValueOnce(firebaseError('auth/wrong-password'));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<PatientShell brand={brand} client={client} onUpdateClient={vi.fn()} onClientPersistedElsewhere={vi.fn()} />); });
    try {
      openProfileDeletion(renderer);
      typeDeletionPassword(renderer, 'Wrong-Horse-7731');
      await act(async () => { submitDeletion(renderer); await flush(); });
      expect(deletionError(renderer)).toBe('Incorrect password. Please try again.');
      typeDeletionPassword(renderer, 'Half-Typed-7731');

      act(() => renderer.root.findByProps({ className: 'account-deletion-confirmation' }).findAllByType('button')
        .find((button) => button.children.join('') === 'Cancel')!.props.onClick());
      expect(deletionPasswordInputs(renderer)).toHaveLength(0);
      expect(renderer.root.findAllByProps({ id: 'account-deletion-error' })).toHaveLength(0);
      expect(rendered(renderer)).not.toContain('Half-Typed-7731');

      act(() => deletionTrigger(renderer).props.onClick());
      const password = renderer.root.findByProps({ id: 'account-deletion-password' });
      expect(password.props.value).toBe('');
      expect(password.props['aria-invalid']).toBe(false);
      expect(renderer.root.findAllByProps({ id: 'account-deletion-error' })).toHaveLength(0);
      expect(state.prepareDeletion).not.toHaveBeenCalled();
    } finally {
      await act(async () => { renderer.unmount(); });
    }
  });

  it('keeps one pending status through a successful deletion, never re-rendering the form or recovery screen', async () => {
    const location = { href: '' };
    const restoreWindow = stubWindow({ location });
    let finishAuthDeletion!: () => void;
    const user = { uid: client.id, email: client.email, delete: vi.fn(() => new Promise<void>((resolve) => { finishAuthDeletion = resolve; })) };
    state.auth.currentUser = user;
    state.reauthenticate.mockResolvedValue(undefined);
    state.prepareDeletion.mockImplementation(async (_uid: string, onDeactivated?: (updated: ClientProfile) => void) => {
      onDeactivated?.(deactivated);
    });
    const persisted = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<StatefulShell initial={client} onPersisted={persisted} />); });
    try {
      openProfileDeletion(renderer);
      typeDeletionPassword(renderer, 'Correct-Horse-7731');
      await act(async () => { submitDeletion(renderer); await flush(); });
      expect(state.prepareDeletion).toHaveBeenCalledWith(client.id, expect.any(Function));
      expect(user.delete).toHaveBeenCalledTimes(1);
      expect(deletionStatusText(renderer)).toEqual(['Deleting your account…']);
      expect(deletionPasswordInputs(renderer)).toHaveLength(0);
      expect(rendered(renderer)).not.toContain('Finish deleting your account');
      expect(rendered(renderer)).not.toContain('Correct-Horse-7731');
      expect(persisted).not.toHaveBeenCalled();

      await act(async () => { finishAuthDeletion(); await flush(); });
      expect(state.endSession).toHaveBeenCalledOnce();
      expect(state.endSession).toHaveBeenCalledWith(expect.objectContaining({ reason: 'account-deleted', signOut: false, destination: '/welcome' }));
      expect(location.href).toBe('/welcome');
      // Success leaves the status up until the browser navigates away.
      expect(deletionStatusText(renderer)).toEqual(['Deleting your account…']);
      expect(deletionPasswordInputs(renderer)).toHaveLength(0);
      expect(rendered(renderer)).not.toContain('Finish deleting your account');
      expect(persisted).not.toHaveBeenCalled();
    } finally {
      await act(async () => { renderer.unmount(); });
      restoreWindow();
    }
  });

  it('returns cleanup failures to the resumable screen: Firebase errors read generically and are logged, app errors stay', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = { uid: client.id, email: client.email, delete: vi.fn(async () => {}) };
    state.auth.currentUser = user;
    state.reauthenticate.mockResolvedValue(undefined);
    const permissionDenied = firebaseError('permission-denied');
    const appointmentError = new Error('A future appointment could not be cancelled automatically. Your clinic connection is removed; contact support to finish account deletion.');
    state.prepareDeletion
      .mockImplementationOnce(async (_uid: string, onDeactivated?: (updated: ClientProfile) => void) => { onDeactivated?.(deactivated); throw permissionDenied; })
      .mockImplementationOnce(async (_uid: string, onDeactivated?: (updated: ClientProfile) => void) => { onDeactivated?.(deactivated); throw appointmentError; });
    const persisted = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<StatefulShell initial={client} onPersisted={persisted} />); });
    try {
      openProfileDeletion(renderer);
      typeDeletionPassword(renderer, 'Correct-Horse-7731');
      await act(async () => { submitDeletion(renderer); await flush(); });
      // The deactivated profile is applied once teardown has failed, so the resumable screen takes over.
      expect(persisted).toHaveBeenCalledWith(deactivated);
      expect(rendered(renderer)).toContain('Finish deleting your account');
      expect(deletionError(renderer)).toBe('Account deletion could not finish. Please try again.');
      expect(rendered(renderer)).not.toMatch(/Firebase|permission-denied/);
      expect(consoleError).toHaveBeenCalledWith(expect.any(String), permissionDenied);
      expect(renderer.root.findByProps({ id: 'account-deletion-password' }).props.value).toBe('');

      typeDeletionPassword(renderer, 'Correct-Horse-7731');
      await act(async () => { submitDeletion(renderer); await flush(); });
      expect(deletionError(renderer)).toBe(appointmentError.message);
      // Only the unexpected Firebase error is logged; the app-authored one is not.
      expect(consoleError.mock.calls.filter(([, logged]) => logged instanceof Error)).toEqual([[expect.any(String), permissionDenied]]);
      expect(user.delete).not.toHaveBeenCalled();
    } finally {
      await act(async () => { renderer.unmount(); });
      consoleError.mockRestore();
    }
  });

  it('reloads the marked finish screen and retries after Auth deletion fails', async () => {
    const location = { href: '' };
    const restoreWindow = stubWindow({ location });
    const user = { uid: client.id, email: client.email, delete: vi.fn()
      .mockRejectedValueOnce(firebaseError('auth/network-request-failed'))
      .mockResolvedValueOnce(undefined) };
    state.auth.currentUser = user;
    state.reauthenticate.mockResolvedValue(undefined);
    state.prepareDeletion.mockResolvedValue(undefined);
    const marked = { ...client, accountDeletionStartedAt: new Date(), clinicianId: undefined, clinicId: undefined };
    let renderer!: ReactTestRenderer;
    try {
      await act(async () => { renderer = create(<PatientShell brand={brand} client={marked} onUpdateClient={vi.fn()} onClientPersistedElsewhere={vi.fn()} />); });
      const submit = async () => {
        act(() => renderer.root.findAllByType('button').find((button) => button.children.join('') === 'Finish account deletion')!.props.onClick());
        // Resuming is already confirmed: no browser dialog (the stub has none) and no repeated warning.
        expect(rendered(renderer)).not.toContain('This action cannot be undone.');
        typeDeletionPassword(renderer, 'secret');
        await act(async () => { submitDeletion(renderer); await flush(); });
      };
      await submit();
      expect(user.delete).toHaveBeenCalledTimes(1);
      expect(deletionError(renderer)).toBe('Unable to connect. Check your internet connection and try again.');
      await act(async () => { renderer.unmount(); });
      await act(async () => { renderer = create(<PatientShell brand={brand} client={marked} onUpdateClient={vi.fn()} onClientPersistedElsewhere={vi.fn()} />); });
      expect(JSON.stringify(renderer.toJSON())).toContain('Finish deleting your account');
      await submit();
      expect(user.delete).toHaveBeenCalledTimes(2);
      // The failed attempt cleared nothing; only the successful one ends the session.
      expect(state.endSession).toHaveBeenCalledTimes(2);
      expect(location.href).toBe('/welcome');
      expect(deletionStatusText(renderer)).toEqual(['Deleting your account…']);
    } finally {
      renderer?.unmount();
      restoreWindow();
    }
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
      renderer = create(<PatientShell brand={brand} client={client} onUpdateClient={onUpdateClient} onClientPersistedElsewhere={vi.fn()} />);
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
      renderer.update(<PatientShell brand={brand} client={refreshedClient} onUpdateClient={onUpdateClient} onClientPersistedElsewhere={vi.fn()} />);
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
    const assigned = { ...client, assignedProtocol: 'theta-beta-ratio' as const, allowedExperiences: ['neuro-gambit' as const] };
    const refreshed = { ...assigned, completedSessionsCount: 1 };
    state.saveSession.mockResolvedValueOnce(undefined);
    state.getClient.mockResolvedValueOnce(refreshed);
    const onUpdateClient = vi.fn();
    const onClientPersistedElsewhere = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<PatientShell brand={brand} client={assigned} onUpdateClient={onUpdateClient} onClientPersistedElsewhere={onClientPersistedElsewhere} />);
    });
    act(() => renderer.root.find((node) => (node.type as unknown) === 'home-screen').props.onStartSession('neuro-gambit'));
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
      renderer = create(<PatientShell brand={brand} client={client} onUpdateClient={vi.fn()} onClientPersistedElsewhere={vi.fn()} />);
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
        renderer = create(<PatientShell brand={brand} client={client} onUpdateClient={vi.fn()} onClientPersistedElsewhere={vi.fn()} />);
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
      renderer = create(<PatientShell brand={brand} client={{ ...client, individualBaselineModel: model }} onUpdateClient={onUpdateClient} onClientPersistedElsewhere={vi.fn()} onRecalibrate={onRecalibrate} />);
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

    await act(async () => { renderer.update(<PatientShell brand={brand} client={{ ...client, individualBaselineModel: { ...model, algorithmVersion: 'neurogambit-15s-v1', thetaMean: 2, betaMean: 4, alphaMean: 6 } }} onUpdateClient={onUpdateClient} onClientPersistedElsewhere={vi.fn()} />); });
    expect(summary()).toContain('Current');
    expect(summary()).not.toContain('9.8 Hz');
    await act(async () => { renderer.update(<PatientShell brand={brand} client={{ ...client, individualBaselineModel: { ...model, expiresAt: 0 } }} onUpdateClient={onUpdateClient} onClientPersistedElsewhere={vi.fn()} />); });
    expect(summary()).toContain('Expired');
    await act(async () => { renderer.update(<PatientShell brand={brand} client={client} onUpdateClient={onUpdateClient} onClientPersistedElsewhere={vi.fn()} />); });
    expect(summary()).toContain('Not calibrated');
    renderer.unmount();
  });
});
