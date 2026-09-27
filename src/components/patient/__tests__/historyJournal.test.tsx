import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientProfile, SessionRecord } from '../../../types';

const storage = vi.hoisted(() => ({ getSessions: vi.fn(), patchSessionNotes: vi.fn() }));
vi.mock('../../../services/storageEngine', () => ({ storageEngine: storage, INITIAL_BADGES: [] }));
import { ProgressHistory } from '../ProgressHistory';

const client = (id: string): ClientProfile => ({ id, name: id, email: `${id}@example.test`, status: 'active', assignedProtocol: 'theta-beta-ratio', allowedExperiences: [], brainMaps: [], badges: [], completedSessionsCount: 1, currentStreak: 0 });
const session = (patientId = 'p'): SessionRecord => ({ id: 'historical', patientId, patientName: 'Patient', clinicId: 'clinic', date: 'Sep 27', timestamp: Date.now(), protocol: 'alpha-enhancement', experience: 'tidal-garden', durationSeconds: 60, timeInZonePercent: 50, averageCoherence: null, timeSeries: [], adaptiveAdjustmentsCount: 2, finalThreshold: 0.7, clinicianNotes: 'Clinician feedback', patientNotes: 'Original', moodRating: 2 });
const text = (r: ReactTestRenderer) => JSON.stringify(r.toJSON());
const click = async (r: ReactTestRenderer, label: string) => {
  const button = r.root.findAllByType('button').find((b) => b.children.filter((child): child is string => typeof child === 'string').join('').includes(label));
  if (!button) throw new Error(`Missing ${label}`);
  await act(async () => { await button.props.onClick({ stopPropagation: vi.fn() }); });
};

describe('historical patient journal', () => {
  beforeEach(() => { vi.resetAllMocks(); storage.getSessions.mockResolvedValue([session()]); storage.patchSessionNotes.mockResolvedValue(undefined); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

  it('edits only patient fields and retains immutable feedback and measurements after save and reload', async () => {
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<ProgressHistory client={client('p')} />); });
    await click(r, 'All Time');
    const card = r.root.findAll((node) => node.props.className === 'card-patient' && typeof node.props.onClick === 'function')[0];
    expect(card, text(r)).toBeDefined();
    await act(async () => { card.props.onClick(); });
    await click(r, 'Edit journal');
    await act(async () => { r.root.findByType('textarea').props.onChange({ target: { value: 'Updated' } }); });
    await click(r, 'Save journal');
    expect(storage.patchSessionNotes).toHaveBeenLastCalledWith('historical', { patientNotes: 'Updated', moodRating: 2 });
    expect(text(r)).toContain('Clinician feedback');
    expect(text(r)).toContain('Updated');
    storage.getSessions.mockResolvedValueOnce([{ ...session(), patientNotes: 'Updated' }]);
    await act(async () => { r.unmount(); r = create(<ProgressHistory client={client('p')} />); });
    await click(r, 'All Time');
    const reloadedCard = r.root.findAll((node) => node.props.className === 'card-patient' && typeof node.props.onClick === 'function')[0];
    await act(async () => { reloadedCard.props.onClick(); });
    expect(text(r)).toContain('Updated');
    await act(async () => { r.unmount(); });
  });

  it('keeps the draft on a failed save for retry', async () => {
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<ProgressHistory client={client('p')} />); });
    await click(r, 'All Time');
    const card = r.root.findAll((node) => node.props.className === 'card-patient' && typeof node.props.onClick === 'function')[0];
    await act(async () => { card.props.onClick(); });
    await click(r, 'Edit journal');
    await act(async () => { r.root.findByType('textarea').props.onChange({ target: { value: 'Retry me' } }); });
    storage.patchSessionNotes.mockRejectedValueOnce(new Error('offline'));
    await click(r, 'Save journal');
    expect(text(r)).toContain('could not be saved');
    expect(r.root.findByType('textarea').props.value).toBe('Retry me');
    await click(r, 'Save journal');
    expect(storage.patchSessionNotes).toHaveBeenCalledTimes(2);
    await act(async () => { r.unmount(); });
  });

  it('ignores an old account journal save after switching patients', async () => {
    storage.getSessions.mockResolvedValueOnce([session('p')]).mockResolvedValueOnce([{ ...session('q'), id: 'q-session', patientNotes: 'Patient Q' }]);
    let finish!: () => void;
    storage.patchSessionNotes.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<ProgressHistory client={client('p')} />); });
    await click(r, 'All Time');
    const card = r.root.findAll((node) => node.props.className === 'card-patient' && typeof node.props.onClick === 'function')[0];
    expect(card, text(r)).toBeDefined();
    await act(async () => { card.props.onClick(); });
    await click(r, 'Edit journal');
    await act(async () => { r.root.findByType('textarea').props.onChange({ target: { value: 'Old patient draft' } }); });
    await act(async () => { r.root.findAllByType('button').find((b) => b.children.includes('Save journal'))!.props.onClick({ stopPropagation: vi.fn() }); });
    await act(async () => { r.update(<ProgressHistory client={client('q')} />); });
    await act(async () => { finish(); });
    const qCard = r.root.findAll((node) => node.props.className === 'card-patient' && typeof node.props.onClick === 'function')[0];
    await act(async () => { qCard.props.onClick(); });
    expect(text(r)).toContain('Patient Q');
    expect(text(r)).not.toContain('Old patient draft');
    await act(async () => { r.unmount(); });
  });

  it('guards A to B switching until an unsaved journal is saved or explicitly canceled', async () => {
    storage.getSessions.mockResolvedValue([{ ...session(), id: 'a' }, { ...session(), id: 'b', timestamp: Date.now() - 1000 }]);
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<ProgressHistory client={client('p')} />); });
    await click(r, 'All Time');
    const cards = r.root.findAll((node) => node.props.className === 'card-patient' && typeof node.props.onClick === 'function');
    await act(async () => { cards[0].props.onClick(); }); await click(r, 'Edit journal');
    await act(async () => { r.root.findByType('textarea').props.onChange({ target: { value: 'Unsaved A' } }); });
    await act(async () => { cards[1].props.onClick(); });
    expect(r.root.findByType('textarea').props.value).toBe('Unsaved A');
    expect(text(r)).toContain('Save or cancel');
    await click(r, 'Cancel');
    await act(async () => { cards[1].props.onClick(); });
    await click(r, 'Edit journal');
    expect(r.root.findByType('textarea').props.value).toBe('Original');
    await act(async () => { r.unmount(); });
  });

  it('guards A to B to A while A save is pending and suppresses duplicate A writes', async () => {
    storage.getSessions.mockResolvedValue([{ ...session(), id: 'a' }, { ...session(), id: 'b', timestamp: Date.now() - 1000 }]);
    let finish!: () => void;
    storage.patchSessionNotes.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<ProgressHistory client={client('p')} />); });
    await click(r, 'All Time');
    const cards = r.root.findAll((node) => node.props.className === 'card-patient' && typeof node.props.onClick === 'function');
    await act(async () => { cards[0].props.onClick(); }); await click(r, 'Edit journal');
    await act(async () => { r.root.findByType('textarea').props.onChange({ target: { value: 'Pending A' } }); });
    await act(async () => { r.root.findAllByType('button').find((node) => node.children.includes('Save journal'))!.props.onClick({ stopPropagation: vi.fn() }); });
    await act(async () => { cards[1].props.onClick(); cards[0].props.onClick(); });
    expect(r.root.findByType('textarea').props.value).toBe('Pending A');
    expect(text(r)).toContain('Save or cancel');
    await act(async () => { r.root.findAllByType('button').find((node) => node.children.includes('Save journal'))!.props.onClick({ stopPropagation: vi.fn() }); });
    expect(storage.patchSessionNotes).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
    expect(text(r)).toContain('Pending A');
    await act(async () => { cards[1].props.onClick(); });
    await click(r, 'Edit journal');
    expect(r.root.findByType('textarea').props.value).toBe('Original');
    await act(async () => { r.unmount(); });
  });
});
