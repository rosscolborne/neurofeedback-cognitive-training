import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientProfile, ClinicBrandConfig, SessionRecord } from '../../../types';

const storage = vi.hoisted(() => ({ getSessions: vi.fn(), getBrainMaps: vi.fn() }));
const pdf = vi.hoisted(() => ({ generatePatientClinicalPDF: vi.fn() }));
vi.mock('../../../services/storageEngine', () => ({ storageEngine: storage }));
vi.mock('../../../services/pdfReportGenerator', () => pdf);
vi.mock('../ProtocolBuilderModal', () => ({ ProtocolBuilderModal: 'protocol-builder' }));
vi.mock('../BrainMapUploadModal', () => ({ BrainMapUploadModal: 'brain-map-upload' }));
vi.mock('../PatientAvatar', () => ({ PatientAvatar: 'patient-avatar' }));
import { ClientDetailView } from '../ClientDetailView';

const client = (id: string): ClientProfile => ({ id, name: `Patient ${id}`, email: `${id}@example.test`, status: 'active', assignedProtocol: 'theta-beta-ratio', allowedExperiences: [], brainMaps: [], badges: [], completedSessionsCount: 0, currentStreak: 0 });
const session = (id: string, patientId = 'a'): SessionRecord => ({ id, patientId, patientName: `Patient ${patientId}`, clinicId: 'clinic', date: 'Sep 27', timestamp: 100, protocol: 'alpha-enhancement', experience: 'tidal-garden', durationSeconds: 60, timeInZonePercent: 50, averageCoherence: null, timeSeries: [], adaptiveAdjustmentsCount: 0, finalThreshold: 0 });
const brand = { name: 'Clinic' } as ClinicBrandConfig;
const props = { brand, onBack: vi.fn(), onUpdateClient: vi.fn(), onSendMessage: vi.fn() };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const buttons = (r: ReactTestRenderer) => r.root.findAllByType('button');
const button = (r: ReactTestRenderer, label: string) => {
  const found = buttons(r).find((node) => node.children.filter((child): child is string => typeof child === 'string').join('') === label);
  if (!found) throw new Error(`Missing ${label}`);
  return found;
};
const alerts = (r: ReactTestRenderer) => r.root.findAllByProps({ role: 'alert' }).map((node) => JSON.stringify(node.children)).join(' ');
const mount = async (id = 'a') => {
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<ClientDetailView {...props} client={client(id)} />); });
  return r;
};

describe('patient detail PDF export', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    storage.getBrainMaps.mockResolvedValue([]);
    storage.getSessions.mockResolvedValue([session('one'), session('two')]);
    pdf.generatePatientClinicalPDF.mockResolvedValue(undefined);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('passes the whole loaded list from the header export and exactly one selected row session', async () => {
    const r = await mount();
    await act(async () => { await button(r, ' Export Clinical PDF').props.onClick(); });
    expect(pdf.generatePatientClinicalPDF).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a' }), [session('one'), session('two')], brand);
    await act(async () => { button(r, 'Session Logs (2)').props.onClick(); });
    const row = buttons(r).filter((node) => node.children.includes(' PDF'))[1];
    await act(async () => { await row.props.onClick(); });
    expect(pdf.generatePatientClinicalPDF).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a' }), [session('two')], brand, 'selected-session');
    expect(pdf.generatePatientClinicalPDF).toHaveBeenCalledTimes(2);
    await act(async () => { r.unmount(); });
  });

  it('catches rejection visibly, then clears the error for a successful retry', async () => {
    pdf.generatePatientClinicalPDF.mockRejectedValueOnce(new Error('offline'));
    const r = await mount();
    await act(async () => { await button(r, ' Export Clinical PDF').props.onClick(); });
    expect(alerts(r)).toContain('PDF export failed');
    await act(async () => { await button(r, ' Export Clinical PDF').props.onClick(); });
    expect(alerts(r)).not.toContain('PDF export failed');
    expect(pdf.generatePatientClinicalPDF).toHaveBeenCalledTimes(2);
    await act(async () => { r.unmount(); });
  });

  it('disables every entry point and synchronously guards duplicate clicks while pending', async () => {
    const pending = deferred<void>();
    pdf.generatePatientClinicalPDF.mockReturnValueOnce(pending.promise);
    const r = await mount();
    await act(async () => { button(r, 'Session Logs (2)').props.onClick(); });
    const row = buttons(r).filter((node) => node.children.includes(' PDF'))[0];
    await act(async () => { row.props.onClick(); button(r, ' Export Clinical PDF').props.onClick(); row.props.onClick(); });
    expect(pdf.generatePatientClinicalPDF).toHaveBeenCalledTimes(1);
    expect(pdf.generatePatientClinicalPDF).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), [session('one')], brand, 'selected-session');
    expect(button(r, ' Export Clinical PDF').props.disabled).toBe(true);
    expect(buttons(r).filter((node) => node.children.includes(' PDF')).every((node) => node.props.disabled)).toBe(true);
    await act(async () => { pending.resolve(); await pending.promise; });
    expect(button(r, ' Export Clinical PDF').props.disabled).toBe(false);
    await act(async () => { r.unmount(); });
  });

  it('blocks whole export during loading or load failure and ignores stale completion after patient switch', async () => {
    const loading = deferred<SessionRecord[]>();
    const oldExport = deferred<void>();
    storage.getSessions.mockImplementation((id: string) => id === 'a' ? loading.promise : Promise.resolve([session('b-one', 'b')]));
    const r = await mount();
    expect(button(r, ' Export Clinical PDF').props.disabled).toBe(true);
    await act(async () => { button(r, ' Export Clinical PDF').props.onClick(); loading.reject(new Error('load failed')); });
    expect(pdf.generatePatientClinicalPDF).not.toHaveBeenCalled();
    expect(button(r, ' Export Clinical PDF').props.disabled).toBe(true);
    await act(async () => { r.update(<ClientDetailView {...props} client={client('b')} />); });
    pdf.generatePatientClinicalPDF.mockReturnValueOnce(oldExport.promise);
    await act(async () => { button(r, ' Export Clinical PDF').props.onClick(); });
    await act(async () => { r.update(<ClientDetailView {...props} client={client('c')} />); });
    await act(async () => { oldExport.reject(new Error('old patient failed')); });
    expect(alerts(r)).not.toContain('PDF export failed');
    expect(button(r, ' Export Clinical PDF').props.disabled).toBe(false);
    await act(async () => { r.unmount(); });
  });

  it('does not revive an old error or pending request after switching away and back', async () => {
    const oldExport = deferred<void>();
    pdf.generatePatientClinicalPDF.mockReturnValueOnce(oldExport.promise);
    storage.getSessions.mockImplementation(async (id: string) => [session(`${id}-one`, id)]);
    const r = await mount();
    await act(async () => { button(r, ' Export Clinical PDF').props.onClick(); });
    await act(async () => { r.update(<ClientDetailView {...props} client={client('b')} />); });
    await act(async () => { r.update(<ClientDetailView {...props} client={client('a')} />); });
    expect(button(r, ' Export Clinical PDF').props.disabled).toBe(false);
    await act(async () => { button(r, ' Export Clinical PDF').props.onClick(); });
    expect(pdf.generatePatientClinicalPDF).toHaveBeenCalledTimes(2);
    await act(async () => { oldExport.reject(new Error('stale failure')); });
    expect(alerts(r)).not.toContain('PDF export failed');
    await act(async () => { r.unmount(); });
  });

  it('settles an export rejection after unmount without an unhandled promise', async () => {
    const pending = deferred<void>();
    pdf.generatePatientClinicalPDF.mockReturnValueOnce(pending.promise);
    const r = await mount();
    await act(async () => { button(r, ' Export Clinical PDF').props.onClick(); });
    await act(async () => { r.unmount(); });
    await act(async () => { pending.reject(new Error('late failure')); });
    expect(pdf.generatePatientClinicalPDF).toHaveBeenCalledTimes(1);
  });
});
