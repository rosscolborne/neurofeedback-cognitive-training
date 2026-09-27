import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { ClientProfile, ClinicBrandConfig } from '../../../types';

const unread = vi.hoisted(() => ({ value: { byPatient: {} as Record<string, { unread: boolean; latestIncomingMessageId: string | null; relationshipKey: string }>, error: null as string | null, isComplete: false } }));
const identity = vi.hoisted(() => ({ accountId: 'account-1', scope: '' }));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { uid: identity.accountId } }) }));
vi.mock('../../messaging/useMessageUnread', () => ({ useMessageUnread: (_ids: string[], _repository: unknown, _enabled: boolean, scope: string) => { identity.scope = scope; return unread.value; } }));
vi.mock('../ClientRosterView', () => ({ ClientRosterView: (props: { clients: ClientProfile[]; onSelectClient: (client: ClientProfile) => void; onMessageClient: (id: string) => void }) => <div><button onClick={() => props.onSelectClient(props.clients[0])}>Select A</button><button onClick={() => props.onMessageClient(props.clients[1].id)}>Message B</button></div> }));
vi.mock('../ClientDetailView', () => ({ ClientDetailView: (props: { client: ClientProfile; onScheduleClient: () => void; onSendMessage: () => void }) => <div><span>Chart {props.client.id}</span><button onClick={props.onScheduleClient}>Schedule from detail</button><button onClick={props.onSendMessage}>Message from detail</button></div> }));
vi.mock('../ClinicalCalendarView', () => ({ ClinicalCalendarView: (props: { preSelectedClientId?: string; clients: ClientProfile[]; onSelectClient: (client: ClientProfile) => void; onOpenMessages: (id: string) => void }) => <div><span>Preselected {props.preSelectedClientId ?? 'none'}</span><button onClick={() => props.onSelectClient(props.clients[1])}>Calendar chart B</button><button onClick={() => props.onOpenMessages(props.clients[1].id)}>Calendar message B</button></div> }));
vi.mock('../MessagingView', () => ({ MessagingView: (props: { selectedClientId?: string; onOpenChart: (id: string) => void }) => <div><span>Thread {props.selectedClientId ?? 'none'}</span><button onClick={() => props.onOpenChart(props.selectedClientId ?? '')}>Thread chart</button></div> }));
vi.mock('../ClinicalReportsView', () => ({ ClinicalReportsView: () => <div>Reports</div> }));
vi.mock('../ClinicSettingsView', () => ({ ClinicSettingsView: () => <div>Settings</div> }));
import { ClinicianShell } from '../ClinicianShell';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const clients: ClientProfile[] = ['a', 'b'].map((id) => ({ id, name: `Patient ${id}`, email: `${id}@example.test`, status: 'active', allowedExperiences: [], brainMaps: [], badges: [], completedSessionsCount: 0, currentStreak: 0 }));
const brand = { clinicId: 'clinic', name: 'Clinic', logoUrl: '', tagline: '', primaryAccent: '', primaryHover: '', primarySubtle: '', onPrimary: '', patientBaseSurface: '', clinicianBaseSurface: '', typographyStyle: 'modern-sans', createdAt: '' } as ClinicBrandConfig;
const shell = (patientList = clients, isDemoWorkspace = false, rosterStatus: 'loading' | 'ready' | 'error' = 'ready') => <ClinicianShell brand={brand} clinicianLabel="Clinician" clients={patientList} patientInvitations={[]} isDemoWorkspace={isDemoWorkspace} rosterStatus={rosterStatus} onUpdateClient={vi.fn()} onAppendBrainMap={vi.fn()} onAddClient={vi.fn()} onCancelPatientInvitation={vi.fn()} onOpenRebrand={vi.fn()} onLogout={vi.fn()} />;
const text = (node: ReactTestInstance): string => node.children.map((child) => typeof child === 'string' ? child : text(child)).join('');
const click = async (root: ReactTestInstance, label: string) => { const button = root.findAllByType('button').find((item) => text(item) === label)!; await act(async () => button.props.onClick()); };

describe('clinician shell navigation and unread badge', () => {
  it('keeps exact patient selection across roster, detail, calendar and thread, clearing a removed patient', async () => {
    let view!: ReactTestRenderer;
    await act(async () => { view = create(shell()); });
    await click(view.root, 'Message B');
    expect(text(view.root)).toContain('Thread b');
    await click(view.root, 'Thread chart');
    expect(text(view.root)).toContain('Chart b');
    await click(view.root, 'Schedule from detail');
    expect(text(view.root)).toContain('Preselected b');
    await click(view.root, 'Calendar chart B');
    expect(text(view.root)).toContain('Chart b');
    await click(view.root, 'Schedule from detail');
    await click(view.root, 'Calendar message B');
    expect(text(view.root)).toContain('Thread b');
    await act(async () => view.update(shell([clients[0]])));
    expect(text(view.root)).not.toContain('Chart b');
    expect(text(view.root)).toContain('Thread none');
  });

  it('shows counts only after complete snapshots and updates after reads and relationship removal', async () => {
    unread.value = { byPatient: {}, error: null, isComplete: false };
    let view!: ReactTestRenderer;
    await act(async () => { view = create(shell()); });
    expect(view.root.findAllByProps({ 'aria-label': 'Messages, unread count unavailable' })).toHaveLength(2);
    unread.value = { byPatient: { a: { unread: true, latestIncomingMessageId: 'm1', relationshipKey: 'a/c' }, b: { unread: true, latestIncomingMessageId: 'm2', relationshipKey: 'b/c' } }, error: null, isComplete: true };
    await act(async () => view.update(shell()));
    expect(view.root.findAllByProps({ 'aria-label': 'Messages, 2 unread conversations' })).toHaveLength(2);
    unread.value = { ...unread.value, byPatient: { ...unread.value.byPatient, a: { ...unread.value.byPatient.a, unread: false } } };
    await act(async () => view.update(shell()));
    expect(view.root.findAllByProps({ 'aria-label': 'Messages, 1 unread conversations' })).toHaveLength(2);
    await act(async () => view.update(shell([clients[0]])));
    expect(view.root.findAllByProps({ 'aria-label': 'Messages, 0 unread conversations' })).toHaveLength(2);
    unread.value = { byPatient: {}, error: 'offline', isComplete: false };
    await act(async () => view.update(shell()));
    expect(view.root.findAllByProps({ 'aria-label': 'Messages, unread count unavailable' })).toHaveLength(2);
    await act(async () => view.update(shell(clients, true)));
    expect(view.root.findAllByProps({ 'aria-label': 'Messages, unread count unavailable' })).toHaveLength(2);
    const oldScope = identity.scope;
    identity.accountId = 'account-2';
    await act(async () => view.update(shell()));
    expect(identity.scope).not.toBe(oldScope);
  });

  it('keeps unresolved empty rosters unknown and reports zero only for loaded empty rosters', async () => {
    unread.value = { byPatient: {}, error: null, isComplete: true };
    let view!: ReactTestRenderer;
    await act(async () => { view = create(shell([], false, 'loading')); });
    expect(view.root.findAllByProps({ 'aria-label': 'Messages, unread count unavailable' })).toHaveLength(2);
    await act(async () => view.update(shell([], false, 'error')));
    expect(view.root.findAllByProps({ 'aria-label': 'Messages, unread count unavailable' })).toHaveLength(2);
    await act(async () => view.update(shell([], false, 'ready')));
    expect(view.root.findAllByProps({ 'aria-label': 'Messages, 0 unread conversations' })).toHaveLength(2);
    await act(async () => view.update(shell([], false, 'loading')));
    expect(view.root.findAllByProps({ 'aria-label': 'Messages, unread count unavailable' })).toHaveLength(2);
  });
});
