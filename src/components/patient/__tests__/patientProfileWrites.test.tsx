import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientProfile, ClinicBrandConfig } from '../../../types';

const state = vi.hoisted(() => ({
  muted: false,
  getSessions: vi.fn(),
  saveSession: vi.fn(),
  getClient: vi.fn(),
}));

vi.mock('../../../services/firebase', () => ({ auth: { currentUser: null }, db: {} }));
vi.mock('firebase/auth', () => ({ signOut: vi.fn() }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), deleteDoc: vi.fn() }));
vi.mock('../../../services/audioEngine', () => ({ audioEngine: { getMuted: () => state.muted, setMuted: vi.fn() } }));
vi.mock('../../../services/storageEngine', () => ({ storageEngine: { getSessions: state.getSessions, saveSession: state.saveSession, getClient: state.getClient } }));
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
  allowedExperiences: [], brainMaps: [], badges: [], completedSessionsCount: 0, currentStreak: 0,
};
const brand = { name: 'Clinic', logoUrl: '' } as ClinicBrandConfig;

describe('PatientShell persisted profile writes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.getSessions.mockResolvedValue([]);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
    const retry = renderer.root.findAllByType('button').find((button) => button.children.join('') === 'Retry')!;
    await act(async () => { await retry.props.onClick(); });
    expect(onUpdateClient).toHaveBeenCalledTimes(2);
    expect(onUpdateClient.mock.calls[1][0]).toMatchObject({ avatarUrl: 'data:image/png;base64,abc' });

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
});
