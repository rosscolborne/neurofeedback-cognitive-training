import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { ClientProfile } from '../../../types';
import type { AppointmentRepository } from '../../../features/appointments/appointmentRepository';
import type { ProductionAppointment } from '../../../features/appointments/appointmentTypes';
import { ClientRosterView } from '../ClientRosterView';
import { formatLastSessionDate } from '../formatLastSessionDate';
import { ClinicalCalendarView } from '../ClinicalCalendarView';
import { MessagingView } from '../MessagingView';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const patient = (id: string, name: string): ClientProfile => ({ id, name, email: `${id}@example.test`, status: 'active', allowedExperiences: [], brainMaps: [], badges: [], completedSessionsCount: 0, currentStreak: 0 });
const clients = [patient('patient-a', 'Patient A'), patient('patient-b', 'Patient B')];
const text = (node: ReactTestInstance): string => node.children.map((child) => typeof child === 'string' ? child : text(child)).join('');
const button = (root: ReactTestInstance, label: string) => root.findAllByType('button').find((item) => item.props['aria-label'] === label || text(item).includes(label))!;
const appointment = (patientId: string, patientDisplayName: string): ProductionAppointment => ({ dataKind: 'canonical', id: `appt-${patientId}`, clinicianId: 'clinician-1', patientId, patientDisplayName, clinicianDisplayName: 'Clinician', startsAtMillis: Date.parse('2026-09-19T14:30:00Z'), timezone: 'America/Toronto', durationMinutes: 45, type: 'consultation', status: 'scheduled', createdAtMillis: 1, updatedAtMillis: 1, createdBy: 'clinician-1', revision: 1, schemaVersion: 1 });

describe('clinician patient navigation', () => {
  it('opens the exact roster conversation from desktop and mobile actions without selecting a chart', async () => {
    const onMessageClient = vi.fn();
    const onSelectClient = vi.fn();
    let view!: ReactTestRenderer;
    await act(async () => { view = create(<ClientRosterView clients={clients} invitations={[]} onSelectClient={onSelectClient} onAddClient={vi.fn()} onCancelInvitation={vi.fn()} onMessageClient={onMessageClient} />); });
    const actions = view.root.findAllByType('button').filter((item) => item.props['aria-label'] === 'Message Patient B');
    expect(actions).toHaveLength(2);
    for (const action of actions) await act(async () => action.props.onClick({ stopPropagation: vi.fn() }));
    expect(onMessageClient.mock.calls).toEqual([['patient-b'], ['patient-b']]);
    expect(onSelectClient).not.toHaveBeenCalled();
  });

  it('routes calendar entries by linked appointment patient ID and leaves unknown IDs inert', async () => {
    const onSelectClient = vi.fn();
    const onOpenMessages = vi.fn();
    const repository = { list: vi.fn().mockResolvedValue([appointment('patient-b', 'Old name'), appointment('unknown', 'Unlinked')]) } as unknown as AppointmentRepository;
    let view!: ReactTestRenderer;
    await act(async () => { view = create(<ClinicalCalendarView clients={clients} repository={repository} onSelectClient={onSelectClient} onOpenMessages={onOpenMessages} />); });
    await act(async () => button(view.root, 'Open Patient B chart').props.onClick());
    await act(async () => button(view.root, 'Message Patient B').props.onClick());
    expect(onSelectClient).toHaveBeenCalledWith(clients[1]);
    expect(onOpenMessages).toHaveBeenCalledWith('patient-b');
    expect(view.root.findAllByType('button').some((item) => String(item.props['aria-label']).includes('Unlinked'))).toBe(false);
  });

  it('preselects the scheduled patient when opening the existing create form', async () => {
    const repository = { list: vi.fn().mockResolvedValue([]) } as unknown as AppointmentRepository;
    let view!: ReactTestRenderer;
    await act(async () => { view = create(<ClinicalCalendarView clients={clients} preSelectedClientId="patient-b" repository={repository} />); });
    await act(async () => button(view.root, 'Schedule appointment').props.onClick());
    const patientSelect = view.root.findAllByType('select').find((item) => item.props.value === 'patient-b');
    expect(patientSelect).toBeDefined();
  });

  it('opens the chart for the active message thread only while that patient remains linked', async () => {
    vi.stubGlobal('window', { innerWidth: 1280, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const onOpenChart = vi.fn();
    let view!: ReactTestRenderer;
    await act(async () => { view = create(<MessagingView participants={clients.map((item) => ({ patientId: item.id, name: item.name }))} onOpenChart={onOpenChart} />); });
    await act(async () => button(view.root, 'Patient B Open conversation').props.onClick());
    await act(async () => button(view.root, 'Open Patient B chart').props.onClick());
    expect(onOpenChart).toHaveBeenCalledWith('patient-b');
    await act(async () => { view.update(<MessagingView participants={[{ patientId: 'patient-a', name: 'Patient A' }]} onOpenChart={onOpenChart} />); });
    expect(view.root.findAllByType('button').some((item) => item.props['aria-label'] === 'Open Patient B chart')).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('last session display', () => {
  it('formats a valid instant locally and identifies absent and invalid values', () => {
    expect(formatLastSessionDate(undefined, 'America/Toronto', 'en-US')).toBe('No recorded session');
    expect(formatLastSessionDate('not-a-date', 'America/Toronto', 'en-US')).toBe('Date unavailable');
    expect(formatLastSessionDate('2026-02-30T01:00:00.000Z', 'America/Toronto', 'en-US')).toBe('Date unavailable');
    expect(formatLastSessionDate('2026-09-27T01:00:00.000Z', 'America/Toronto', 'en-US')).toBe('Sep 26, 2026');
    expect(formatLastSessionDate('2026-09-27T01:00:00.000Z', 'UTC', 'en-US')).toBe('Sep 27, 2026');
  });
});
