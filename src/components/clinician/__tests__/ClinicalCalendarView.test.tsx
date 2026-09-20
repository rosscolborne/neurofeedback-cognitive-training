import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import type { ClientProfile } from '../../../types';
import type { AppointmentRepository } from '../../../features/appointments/appointmentRepository';
import type { AppointmentRecord, ProductionAppointment } from '../../../features/appointments/appointmentTypes';

vi.mock('../../../services/firebase', () => ({ auth: { currentUser: { uid: 'clinician-1', displayName: 'Dr One' } }, db: {} }));

import { ClinicalCalendarView } from '../ClinicalCalendarView';
import { PatientAppointmentsView } from '../../patient/PatientAppointmentsView';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const patient = { id: 'patient-1', name: 'Patient One', isDemo: false } as ClientProfile;
const appointment = (overrides: Partial<ProductionAppointment> = {}): ProductionAppointment => ({
  dataKind: 'canonical', id: 'appt-1', clinicianId: 'clinician-1', patientId: 'patient-1',
  patientDisplayName: 'Patient One', clinicianDisplayName: 'Dr One', startsAtMillis: Date.parse('2026-09-19T14:30:00Z'),
  timezone: 'America/Toronto', durationMinutes: 45, type: 'consultation', status: 'scheduled',
  createdAtMillis: 1, updatedAtMillis: 1, createdBy: 'clinician-1', revision: 1, schemaVersion: 1, ...overrides,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function repository(overrides: Partial<Record<'list' | 'create' | 'edit' | 'cancel', ReturnType<typeof vi.fn>>> = {}): AppointmentRepository {
  return {
    list: overrides.list ?? vi.fn().mockResolvedValue([]),
    create: overrides.create ?? vi.fn(),
    edit: overrides.edit ?? vi.fn(),
    cancel: overrides.cancel ?? vi.fn(),
  } as unknown as AppointmentRepository;
}

function text(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : text(child)).join('');
}

function button(root: ReactTestInstance, label: string): ReactTestInstance {
  return root.findAllByType('button').find((candidate) => text(candidate).includes(label))!;
}

async function mountClinician(repo: AppointmentRepository): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<ClinicalCalendarView clients={[patient]} repository={repo} initialTimezone="America/Toronto" />); });
  return renderer;
}

describe('mounted production appointment surfaces', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { confirm: vi.fn(() => true) });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('renders loading, genuine empty, error, and retry states', async () => {
    const first = deferred<ProductionAppointment[]>();
    const list = vi.fn().mockReturnValueOnce(first.promise);
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<ClinicalCalendarView clients={[patient]} repository={repository({ list })} />); });
    expect(text(renderer.root)).toContain('Loading appointments');
    await act(async () => { first.resolve([]); await first.promise; });
    expect(text(renderer.root)).toContain('No appointments scheduled');
    await act(async () => { renderer.unmount(); });

    const retryList = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
    const retryRenderer = await mountClinician(repository({ list: retryList }));
    expect(text(retryRenderer.root)).toContain('Appointments could not be loaded');
    await act(async () => { button(retryRenderer.root, 'Retry').props.onClick?.(); await Promise.resolve(); });
    expect(text(retryRenderer.root)).toContain('No appointments scheduled');
  });

  it('shows save failures including DST validation and only renders confirmed creates', async () => {
    const createAppointment = vi.fn().mockRejectedValueOnce(new Error('That local time does not exist because the clock moves forward'))
      .mockResolvedValueOnce(appointment());
    const renderer = await mountClinician(repository({ create: createAppointment }));
    await act(async () => { button(renderer.root, 'Schedule appointment').props.onClick(); });
    const form = renderer.root.findByType('form');
    await act(async () => { form.props.onSubmit({ preventDefault: vi.fn() }); await Promise.resolve(); });
    expect(text(renderer.root)).toContain('does not exist because the clock moves forward');
    expect(renderer.root.findAllByType('article')).toHaveLength(0);
    await act(async () => { form.props.onSubmit({ preventDefault: vi.fn() }); await Promise.resolve(); });
    expect(renderer.root.findAllByType('article')).toHaveLength(1);
    expect(text(renderer.root)).toContain('Patient One');
    expect(text(renderer.root)).toContain('America/Toronto');
  });

  it('passes the displayed revision to edits and exposes stale conflicts', async () => {
    const edit = vi.fn().mockRejectedValue(new Error('This appointment changed elsewhere. Reload the calendar before editing it'));
    const renderer = await mountClinician(repository({ list: vi.fn().mockResolvedValue([appointment({ revision: 7 })]), edit }));
    await act(async () => { button(renderer.root, 'Edit').props.onClick(); });
    await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }); await Promise.resolve(); });
    expect(edit.mock.calls[0][2]).toBe(7);
    expect(text(renderer.root)).toContain('Reload the calendar before editing it');
  });

  it('keeps overlapping cancellation state keyed and surfaces independent failures', async () => {
    const first = deferred<ProductionAppointment>();
    const second = deferred<ProductionAppointment>();
    const cancel = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const renderer = await mountClinician(repository({
      list: vi.fn().mockResolvedValue([appointment(), appointment({ id: 'appt-2', patientDisplayName: 'Patient Two', startsAtMillis: Date.parse('2026-09-20T14:30:00Z') })]),
      cancel,
    }));
    const cancelButtons = renderer.root.findAllByType('button').filter((candidate) => text(candidate).includes('Cancel'));
    await act(async () => { cancelButtons[0].props.onClick(); cancelButtons[1].props.onClick(); });
    expect(renderer.root.findAllByType('button').filter((candidate) => text(candidate).includes('Cancelling…'))).toHaveLength(2);
    await act(async () => { first.resolve(appointment({ status: 'cancelled', revision: 2, cancelledAtMillis: 2, cancelledBy: 'clinician-1' })); await first.promise; });
    expect(renderer.root.findAllByType('button').filter((candidate) => text(candidate).includes('Cancelling…'))).toHaveLength(1);
    await act(async () => { second.reject(new Error('permission denied')); try { await second.promise; } catch {} });
    expect(text(renderer.root)).toContain('permission denied');
    expect(cancel.mock.calls[0][1]).toBe(1);
    expect(cancel.mock.calls[0][2]).toMatch(/^cancel_/);
  });

  it('does not update an unmounted surface when a mutation completes', async () => {
    const pending = deferred<ProductionAppointment>();
    const renderer = await mountClinician(repository({ create: vi.fn(() => pending.promise) }));
    await act(async () => { button(renderer.root, 'Schedule appointment').props.onClick(); });
    await act(async () => { void renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }); });
    await act(async () => { renderer.unmount(); pending.resolve(appointment()); await pending.promise; });
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('unmounted'));
  });

  it('renders canonical and legacy records consistently for clinician and patient', async () => {
    const records = [appointment(), {
      dataKind: 'legacy' as const, id: 'legacy-1', clinicianId: 'clinician-1', patientId: 'patient-1',
      patientDisplayName: 'Patient One', legacyDate: '2026-10-01', legacyTime: '09:00', durationMinutes: 45,
      type: 'consultation' as const, status: 'cancelled' as const, readOnlyReason: 'Timezone unavailable — migration required',
    }];
    const repo = repository({ list: vi.fn().mockResolvedValue(records) });
    const clinician = await mountClinician(repo);
    let patientView!: ReactTestRenderer;
    await act(async () => { patientView = create(<PatientAppointmentsView repository={repo} />); });
    for (const rendered of [text(clinician.root), text(patientView.root)]) {
      expect(rendered).toContain('America/Toronto');
      expect(rendered).toContain('2026-10-01');
      expect(rendered).toContain('Timezone unavailable — migration required');
      expect(rendered).toContain('cancelled');
    }
  });

  it('mounts the patient loading and empty states', async () => {
    const pending = deferred<AppointmentRecord[]>();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<PatientAppointmentsView repository={repository({ list: vi.fn(() => pending.promise) })} />); });
    expect(text(renderer.root)).toContain('Loading appointments');
    await act(async () => { pending.resolve([]); await pending.promise; });
    expect(text(renderer.root)).toContain('No appointments scheduled');
  });

  it('mounts the patient error state and retries successfully', async () => {
    const list = vi.fn().mockRejectedValueOnce(new Error('patient offline')).mockResolvedValueOnce([appointment({ status: 'cancelled' })]);
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<PatientAppointmentsView repository={repository({ list })} />); });
    expect(text(renderer.root)).toContain('patient offline');
    await act(async () => { button(renderer.root, 'Retry').props.onClick(); await Promise.resolve(); });
    expect(text(renderer.root)).toContain('cancelled');
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('ignores a stale patient load after the repository changes', async () => {
    const stale = deferred<AppointmentRecord[]>();
    const firstRepository = repository({ list: vi.fn(() => stale.promise) });
    const currentRepository = repository({ list: vi.fn().mockResolvedValue([appointment()]) });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<PatientAppointmentsView repository={firstRepository} />); });
    await act(async () => { renderer.update(<PatientAppointmentsView repository={currentRepository} />); await Promise.resolve(); });
    expect(text(renderer.root)).toContain('America/Toronto');
    await act(async () => { stale.resolve([]); await stale.promise; });
    expect(text(renderer.root)).toContain('America/Toronto');
    expect(text(renderer.root)).not.toContain('No appointments scheduled');
  });

  it('ignores a patient load that completes after unmount', async () => {
    const pending = deferred<AppointmentRecord[]>();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<PatientAppointmentsView repository={repository({ list: vi.fn(() => pending.promise) })} />); });
    await act(async () => { renderer.unmount(); pending.resolve([appointment()]); await pending.promise; });
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('unmounted'));
  });
});
