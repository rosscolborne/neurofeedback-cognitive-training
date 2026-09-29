import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientProfile, ClinicBrandConfig, SessionRecord } from '../../../types';

const storage = vi.hoisted(() => ({ getSessions: vi.fn(), getBrainMaps: vi.fn(), patchSessionNotes: vi.fn() }));
vi.mock('../../../services/storageEngine', () => ({ storageEngine: storage }));
vi.mock('../ProtocolBuilderModal', () => ({ ProtocolBuilderModal: 'protocol-builder' }));
vi.mock('../BrainMapUploadModal', () => ({ BrainMapUploadModal: 'brain-map-upload' }));
vi.mock('../PatientAvatar', () => ({ PatientAvatar: 'patient-avatar' }));
import { ClientDetailView } from '../ClientDetailView';

const client = (id: string): ClientProfile => ({ id, name: `Patient ${id}`, email: `${id}@example.test`, status: 'active', assignedProtocol: 'theta-beta-ratio', allowedExperiences: [], brainMaps: [], badges: [], completedSessionsCount: 0, currentStreak: 0 });
/** Newest first, as the repository returns them. */
const sessions = (count: number, prefix = 's', patientId = 'a'): SessionRecord[] => Array.from({ length: count }, (_, index) => ({
  id: `${prefix}${index}`, patientId, patientName: 'Patient', clinicId: 'clinic', date: 'Sep 27',
  timestamp: 1_800_000_000_000 - index * 86_400_000, protocol: 'alpha-enhancement', experience: 'tidal-garden',
  durationSeconds: index % 5 === 0 ? undefined as unknown as number : 600, timeInZonePercent: 50, averageCoherence: null,
  timeSeries: [], adaptiveAdjustmentsCount: 1, finalThreshold: 0.7,
}));
const props = { brand: { name: 'Clinic' } as ClinicBrandConfig, onBack: vi.fn(), onUpdateClient: vi.fn(), onSendMessage: vi.fn() };
const nodeText = (node: ReactTestInstance): string => node.children.map((child) => typeof child === 'string' ? child : nodeText(child)).join('');
const text = (r: ReactTestRenderer) => nodeText(r.root);
const button = (r: ReactTestRenderer, label: string) => r.root.findAllByType('button').find((b) => b.props['aria-label'] === label || nodeText(b) === label);
const click = async (r: ReactTestRenderer, label: string) => {
  const target = button(r, label);
  if (!target) throw new Error(`Missing ${label}`);
  await act(async () => { await target.props.onClick(); });
};
const openButtons = (r: ReactTestRenderer) => r.root.findAllByType('button').filter((b) => /^(Open|Close) /.test(b.props['aria-label'] ?? ''));
const render = async (id = 'a') => {
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<ClientDetailView {...props} client={client(id)} />); });
  return r;
};

describe('bounded clinician session logs', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    storage.getBrainMaps.mockResolvedValue([]);
    storage.patchSessionNotes.mockResolvedValue(undefined);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('renders one page of rows with a count, reveals more, and keeps the tab label on the total', async () => {
    storage.getSessions.mockResolvedValue(sessions(23));
    const r = await render();
    await click(r, 'Session Logs (23)');
    expect(openButtons(r)).toHaveLength(10);
    expect(openButtons(r)[0].props['aria-label']).toBe('Open s0');
    expect(openButtons(r)[9].props['aria-label']).toBe('Open s9');
    expect(text(r)).toContain('Showing 10 of 23 sessions');
    // An unrecorded duration stays truthful on a bounded row.
    expect(text(r)).toContain('Duration unavailable');

    await click(r, 'Show 10 more sessions');
    expect(openButtons(r)).toHaveLength(20);
    expect(text(r)).toContain('Showing 20 of 23 sessions');
    expect(button(r, 'Session Logs (23)')).toBeDefined();

    await click(r, 'Show 3 more sessions');
    expect(openButtons(r)).toHaveLength(23);
    expect(text(r)).toContain('Showing all 23 sessions');
    expect(r.root.findAllByType('button').some((b) => /more session/.test(nodeText(b)))).toBe(false);
    expect(button(r, 'Session Logs (23)')).toBeDefined();
    await act(async () => { r.unmount(); });
  });

  it('shows no count or control for a history of one page or less', async () => {
    storage.getSessions.mockResolvedValue(sessions(10));
    const r = await render();
    await click(r, 'Session Logs (10)');
    expect(openButtons(r)).toHaveLength(10);
    expect(text(r)).not.toContain('Showing');
    await act(async () => { r.unmount(); });
  });

  it('keeps a feedback draft on a revealed session across session switches, tab switches and further reveals', async () => {
    storage.getSessions.mockResolvedValue(sessions(25));
    const r = await render();
    await click(r, 'Session Logs (25)');
    await click(r, 'Show 10 more sessions');
    await click(r, 'Open s14');
    await act(async () => { r.root.findByProps({ id: 'feedback-s14' }).props.onChange({ target: { value: 'Draft for s14' } }); });

    await click(r, 'Open s2');
    expect(r.root.findByProps({ 'aria-label': 'Session s14 details' }).parent?.parent?.props.style.display).toBe('none');
    await click(r, 'Protocol Settings');
    await click(r, 'Session Logs (25)');
    await click(r, 'Show 5 more sessions');
    expect(openButtons(r)).toHaveLength(25);
    await click(r, 'Open s14');
    expect(r.root.findByProps({ id: 'feedback-s14' }).props.value).toBe('Draft for s14');

    const save = r.root.findByProps({ 'aria-label': 'Session s14 details' }).findAllByType('button').find((node) => node.children.includes('Save feedback'))!;
    await act(async () => { await save.props.onClick(); });
    expect(storage.patchSessionNotes).toHaveBeenCalledTimes(1);
    expect(storage.patchSessionNotes).toHaveBeenLastCalledWith('s14', { clinicianNotes: 'Draft for s14' });
    expect(text(r)).toContain('Clinician: Draft for s14');
    await act(async () => { r.unmount(); });
  });

  it('keeps a failed save on a revealed session available for retry', async () => {
    storage.getSessions.mockResolvedValue(sessions(15));
    const r = await render();
    await click(r, 'Session Logs (15)');
    await click(r, 'Show 5 more sessions');
    await click(r, 'Open s12');
    await act(async () => { r.root.findByProps({ id: 'feedback-s12' }).props.onChange({ target: { value: 'Retry s12' } }); });
    storage.patchSessionNotes.mockRejectedValueOnce(new Error('offline'));
    const save = () => r.root.findByProps({ 'aria-label': 'Session s12 details' }).findAllByType('button').find((node) => node.children.includes('Save feedback'))!;
    await act(async () => { await save().props.onClick(); });
    expect(text(r)).toContain('Feedback could not be saved');
    await click(r, 'Open s1');
    await click(r, 'Open s12');
    expect(r.root.findByProps({ id: 'feedback-s12' }).props.value).toBe('Retry s12');
    await act(async () => { await save().props.onClick(); });
    expect(storage.patchSessionNotes).toHaveBeenLastCalledWith('s12', { clinicianNotes: 'Retry s12' });
    await act(async () => { r.unmount(); });
  });

  it('starts a different patient at the first page', async () => {
    storage.getSessions.mockImplementation(async (id: string) => id === 'a' ? sessions(30) : sessions(12, 'b', 'b'));
    const r = await render('a');
    await click(r, 'Session Logs (30)');
    await click(r, 'Show 10 more sessions');
    expect(openButtons(r)).toHaveLength(20);
    await act(async () => { r.update(<ClientDetailView {...props} client={client('b')} />); });
    expect(button(r, 'Session Logs (12)')).toBeDefined();
    expect(openButtons(r)).toHaveLength(10);
    expect(openButtons(r)[0].props['aria-label']).toBe('Open b0');
    expect(text(r)).toContain('Showing 10 of 12 sessions');
    await act(async () => { r.unmount(); });
  });

  it('leaves loading and error states without a count or control', async () => {
    storage.getSessions.mockReturnValueOnce(new Promise(() => {}));
    let r = await render();
    expect(button(r, 'Session Logs (Loading…)')).toBeDefined();
    expect(text(r)).toContain('Loading session logs');
    expect(text(r)).not.toContain('Showing');
    await act(async () => { r.unmount(); });

    storage.getSessions.mockRejectedValueOnce(new Error('offline'));
    r = await render();
    expect(text(r)).toContain('Session logs could not be loaded.');
    expect(text(r)).not.toContain('Showing');
    await act(async () => { r.unmount(); });
  });
});
