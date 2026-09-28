import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientProfile, ClinicBrandConfig, SessionRecord } from '../../../types';

const storage = vi.hoisted(() => ({ getSessions: vi.fn(), getBrainMaps: vi.fn(), patchSessionNotes: vi.fn() }));
vi.mock('../../../services/storageEngine', () => ({ storageEngine: storage }));
vi.mock('../ProtocolBuilderModal', () => ({ ProtocolBuilderModal: 'protocol-builder' }));
vi.mock('../BrainMapUploadModal', () => ({ BrainMapUploadModal: 'brain-map-upload' }));
vi.mock('../PatientAvatar', () => ({ PatientAvatar: 'patient-avatar' }));
import { ClientDetailView } from '../ClientDetailView';
import { ClinicianSessionDetail } from '../ClinicianSessionDetail';

const client = (id: string): ClientProfile => ({ id, name: `Patient ${id}`, email: `${id}@example.test`, status: 'active', assignedProtocol: 'theta-beta-ratio', allowedExperiences: [], brainMaps: [], badges: [], completedSessionsCount: 0, currentStreak: 0 });
const session = (id: string, patientId = 'a'): SessionRecord => ({ id, patientId, patientName: 'Patient', clinicId: 'clinic', date: 'Sep 27', timestamp: 100, protocol: 'alpha-enhancement', experience: 'tidal-garden', durationSeconds: 60, timeInZonePercent: 50, averageCoherence: null, timeSeries: [], adaptiveAdjustmentsCount: 2, finalThreshold: 0.7 });
const props = { brand: { name: 'Clinic' } as ClinicBrandConfig, onBack: vi.fn(), onUpdateClient: vi.fn(), onSendMessage: vi.fn() };
const text = (r: ReactTestRenderer) => JSON.stringify(r.toJSON());
const click = async (r: ReactTestRenderer, label: string) => {
  const button = r.root.findAllByType('button').find((b) => b.props['aria-label']?.includes(label) || b.children.filter((child): child is string => typeof child === 'string').join('').includes(label));
  if (!button) throw new Error(`Missing ${label}`);
  await act(async () => { await button.props.onClick(); });
};

describe('clinician selected session review', () => {
  beforeEach(() => { vi.resetAllMocks(); storage.getBrainMaps.mockResolvedValue([]); storage.patchSessionNotes.mockResolvedValue(undefined); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

  it('shows only the selected stored points and honest legacy absence, with patient notes read only', async () => {
    storage.getSessions.mockResolvedValue([session('old'), { ...session('recorded'), isDemo: true, moodRating: 4, patientNotes: 'Felt steady', device: { model: 'Muse', sampleRateHz: 256 }, timeSeries: [{ t: 12, thetaBetaRatio: 1.3, alpha: 2, smr: 3, beta: 4, inZone: true }] }]);
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<ClientDetailView {...props} client={client('a')} />); });
    await click(r, 'Session Logs');
    await click(r, 'Open recorded');
    expect(text(r)).toContain('Felt steady');
    expect(text(r)).toContain('Muse');
    expect(text(r)).toContain('Synthetic acquisition');
    expect(text(r)).toContain('1.3');
    expect(text(r)).toContain('Final threshold');
    expect(text(r)).not.toContain('Threshold trajectory');
    expect(r.root.findAllByType('textarea')).toHaveLength(1);
    await click(r, 'Open old');
    expect(text(r)).toContain('No recorded points');
    expect(r.root.findByProps({ 'aria-label': 'Session old details' }).parent?.parent?.props.style.display).toBe('block');
    expect(r.root.findByProps({ 'aria-label': 'Session recorded details' }).parent?.parent?.props.style.display).toBe('none');
    await act(async () => { r.unmount(); });
  });

  it('edits and clears only clinician feedback, retaining draft on failure and showing success locally', async () => {
    storage.getSessions.mockResolvedValue([{ ...session('one'), patientNotes: 'Patient only', clinicianNotes: 'Initial' }]);
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<ClientDetailView {...props} client={client('a')} />); });
    await click(r, 'Session Logs'); await click(r, 'Open one');
    await act(async () => { r.root.findByType('textarea').props.onChange({ target: { value: 'Revised' } }); });
    storage.patchSessionNotes.mockRejectedValueOnce(new Error('offline'));
    await click(r, 'Save feedback');
    expect(text(r)).toContain('could not be saved');
    expect(r.root.findByType('textarea').props.value).toBe('Revised');
    await click(r, 'Save feedback');
    expect(storage.patchSessionNotes).toHaveBeenLastCalledWith('one', { clinicianNotes: 'Revised' });
    expect(text(r)).toContain('Revised');
    await click(r, 'Clear feedback');
    expect(storage.patchSessionNotes).toHaveBeenLastCalledWith('one', { clinicianNotes: null });
    expect(text(r)).toContain('Patient only');
    await act(async () => { r.unmount(); });
  });

  it('does not display a prior patient result after an identity switch', async () => {
    let resolveA!: (sessions: SessionRecord[]) => void;
    storage.getSessions.mockImplementation((id: string) => id === 'a' ? new Promise((resolve) => { resolveA = resolve; }) : Promise.resolve([session('b-one', 'b')]));
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<ClientDetailView {...props} client={client('a')} />); });
    await act(async () => { r.update(<ClientDetailView {...props} client={client('b')} />); });
    await act(async () => { resolveA([{ ...session('a-only'), patientNotes: 'Secret A' }]); });
    await click(r, 'Session Logs');
    expect(text(r)).toContain('b-one');
    expect(text(r)).not.toContain('Secret A');
    await act(async () => { r.unmount(); });
  });

  it('loads persisted feedback after remounting from the repository', async () => {
    let stored = session('persisted');
    storage.getSessions.mockImplementation(async () => [stored]);
    storage.patchSessionNotes.mockImplementation(async (_id: string, patch: { clinicianNotes: string | null }) => {
      stored = { ...stored, clinicianNotes: patch.clinicianNotes || undefined };
    });
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<ClientDetailView {...props} client={client('a')} />); });
    await click(r, 'Session Logs'); await click(r, 'Open persisted');
    await act(async () => { r.root.findByType('textarea').props.onChange({ target: { value: 'Follow up next week' } }); });
    await click(r, 'Save feedback');
    await act(async () => { r.unmount(); r = create(<ClientDetailView {...props} client={client('a')} />); });
    await click(r, 'Session Logs'); await click(r, 'Open persisted');
    expect(r.root.findByType('textarea').props.value).toBe('Follow up next week');
    expect(text(r)).toContain('Follow up next week');
    await act(async () => { r.unmount(); });
  });

  it('preserves feedback drafts and pending ownership across session and tab switches', async () => {
    storage.getSessions.mockResolvedValue([session('a'), session('b')]);
    let finish!: () => void;
    storage.patchSessionNotes.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<ClientDetailView {...props} client={client('a')} />); });
    await click(r, 'Session Logs'); await click(r, 'Open a');
    await act(async () => { r.root.findByProps({ id: 'feedback-a' }).props.onChange({ target: { value: 'Draft A' } }); });
    await click(r, 'Open b'); await click(r, 'Protocol Settings'); await click(r, 'Session Logs'); await click(r, 'Open a');
    expect(r.root.findByProps({ id: 'feedback-a' }).props.value).toBe('Draft A');
    const saveA = r.root.findByProps({ 'aria-label': 'Session a details' }).findAllByType('button').find((node) => node.children.includes('Save feedback'))!;
    await act(async () => { saveA.props.onClick(); });
    await click(r, 'Open b'); await click(r, 'Open a');
    expect(r.root.findByProps({ id: 'feedback-a' }).props.disabled).toBe(true);
    await act(async () => { saveA?.props.onClick(); });
    expect(storage.patchSessionNotes).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
    expect(text(r)).toContain('Clinician: ');
    expect(r.root.findByProps({ id: 'feedback-a' }).props.value).toBe('Draft A');
    await act(async () => { r.unmount(); });
  });

  it('handles StrictMode feedback failure, retry and success', async () => {
    const onSaved = vi.fn();
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<React.StrictMode><ClinicianSessionDetail session={session('strict')} onSaved={onSaved} /></React.StrictMode>); });
    await act(async () => { r.root.findByType('textarea').props.onChange({ target: { value: 'Clinical note' } }); });
    storage.patchSessionNotes.mockRejectedValueOnce(new Error('offline'));
    await click(r, 'Save feedback');
    expect(text(r)).toContain('could not be saved');
    expect(onSaved).not.toHaveBeenCalled();
    await click(r, 'Save feedback');
    expect(onSaved).toHaveBeenCalledWith('strict', 'Clinical note');
    expect(storage.patchSessionNotes).toHaveBeenCalledTimes(2);
    await act(async () => { r.unmount(); });
  });

  it('keeps failed feedback and retry available after switching sessions during the request', async () => {
    storage.getSessions.mockResolvedValue([session('a'), session('b')]);
    let rejectSave!: (reason: Error) => void;
    storage.patchSessionNotes.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectSave = reject; }));
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<ClientDetailView {...props} client={client('a')} />); });
    await click(r, 'Session Logs'); await click(r, 'Open a');
    await act(async () => { r.root.findByProps({ id: 'feedback-a' }).props.onChange({ target: { value: 'Retry A' } }); });
    const saveA = r.root.findByProps({ 'aria-label': 'Session a details' }).findAllByType('button').find((node) => node.children.includes('Save feedback'))!;
    await act(async () => { saveA.props.onClick(); });
    await click(r, 'Open b');
    await act(async () => { rejectSave(new Error('offline')); });
    await click(r, 'Open a');
    expect(r.root.findByProps({ id: 'feedback-a' }).props.value).toBe('Retry A');
    expect(text(r)).toContain('Feedback could not be saved');
    await act(async () => { await saveA.props.onClick(); });
    expect(storage.patchSessionNotes).toHaveBeenLastCalledWith('a', { clinicianNotes: 'Retry A' });
    await act(async () => { r.unmount(); });
  });

  it('does not apply a prior patient feedback completion to the current patient', async () => {
    storage.getSessions.mockImplementation(async (id: string) => [session(id === 'a' ? 'a-note' : 'b-note', id)]);
    let finish!: () => void;
    storage.patchSessionNotes.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<ClientDetailView {...props} client={client('a')} />); });
    await click(r, 'Session Logs'); await click(r, 'Open a-note');
    await act(async () => { r.root.findByProps({ id: 'feedback-a-note' }).props.onChange({ target: { value: 'A only' } }); });
    const saveA = r.root.findByProps({ 'aria-label': 'Session a-note details' }).findAllByType('button').find((node) => node.children.includes('Save feedback'))!;
    await act(async () => { saveA.props.onClick(); });
    await act(async () => { r.update(<ClientDetailView {...props} client={client('b')} />); });
    await act(async () => { finish(); });
    await click(r, 'Session Logs'); await click(r, 'Open b-note');
    expect(r.root.findByProps({ id: 'feedback-b-note' }).props.value).toBe('');
    expect(text(r)).not.toContain('A only');
    await act(async () => { r.unmount(); });
  });
});
