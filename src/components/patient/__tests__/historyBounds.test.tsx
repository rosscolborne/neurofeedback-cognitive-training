import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientProfile, SessionRecord } from '../../../types';

const storage = vi.hoisted(() => ({ getSessions: vi.fn(), patchSessionNotes: vi.fn() }));
vi.mock('../../../services/storageEngine', () => ({ storageEngine: storage, INITIAL_BADGES: [] }));
import { ProgressHistory } from '../ProgressHistory';

const DAY = 86_400_000;
const client: ClientProfile = { id: 'p', name: 'Patient', email: 'p@example.test', status: 'active', assignedProtocol: 'theta-beta-ratio', allowedExperiences: [], brainMaps: [], badges: [], completedSessionsCount: 30, currentStreak: 0 };
/** Session `index` days ago (plus an hour), newest first. */
const session = (index: number, now: number): SessionRecord => ({
  id: `s${index}`, patientId: 'p', patientName: 'Patient', clinicId: 'clinic', date: 'Sep 27',
  timestamp: now - index * DAY - 3_600_000, protocol: 'alpha-enhancement', experience: 'neuro-gambit',
  durationSeconds: 600, timeInZonePercent: index % 4 === 0 ? undefined as unknown as number : 50, averageCoherence: null, timeSeries: [],
  adaptiveAdjustmentsCount: 0, finalThreshold: 0.7, patientNotes: `Journal ${index}`, moodRating: 3,
});
/** 7 sessions this week, 25 this month, 30 in all. */
const history = (now: number) => [...Array.from({ length: 25 }, (_, i) => session(i, now)), ...Array.from({ length: 5 }, (_, i) => session(40 + i, now))];

const nodeText = (node: ReactTestInstance): string => node.children.map((child) => typeof child === 'string' ? child : nodeText(child)).join('');
const text = (r: ReactTestRenderer) => nodeText(r.root);
const cards = (r: ReactTestRenderer) => r.root.findAll((node) => node.props.className === 'card-patient' && typeof node.props.onClick === 'function');
const buttonNamed = (scope: ReactTestInstance, label: string) => scope.findAllByType('button').find((b) => nodeText(b).includes(label));
const click = async (scope: ReactTestInstance, label: string) => {
  const button = buttonNamed(scope, label);
  if (!button) throw new Error(`Missing ${label}`);
  await act(async () => { await button.props.onClick({ stopPropagation: vi.fn() }); });
};
const render = async () => {
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<ProgressHistory client={client} />); });
  return r;
};

describe('bounded patient session history', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    storage.getSessions.mockResolvedValue(history(Date.now()));
    storage.patchSessionNotes.mockResolvedValue(undefined);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('renders one page of the newest sessions, then reveals the rest a page at a time', async () => {
    const r = await render();
    expect(cards(r)).toHaveLength(10);
    expect(text(r)).toContain('Showing 10 of 25 sessions');
    // The range summary still counts every session in the range, not the visible page.
    expect(text(r)).toContain('Past 30 days · 25 sessions');
    await act(async () => { cards(r)[0].props.onClick(); });
    expect(text(r)).toContain('Journal 0');

    await click(r.root, 'Show 10 more sessions');
    expect(cards(r)).toHaveLength(20);
    expect(text(r)).toContain('Showing 20 of 25 sessions');
    await click(r.root, 'Show 5 more sessions');
    expect(cards(r)).toHaveLength(25);
    expect(text(r)).toContain('Showing all 25 sessions');
    expect(buttonNamed(r.root, 'more session')).toBeUndefined();
    // The first page's expanded card is still open; revealing only adds rows.
    expect(text(r)).toContain('Journal 0');
    await act(async () => { cards(r)[24].props.onClick(); });
    expect(text(r)).toContain('Journal 24');
    await act(async () => { r.unmount(); });
  });

  it('resets to the first page when the range changes and shows no control for a short range', async () => {
    const r = await render();
    await click(r.root, 'Show 10 more sessions');
    expect(cards(r)).toHaveLength(20);

    await click(r.root, 'All Time');
    expect(cards(r)).toHaveLength(10);
    expect(text(r)).toContain('Showing 10 of 30 sessions');

    await click(r.root, 'week');
    expect(cards(r)).toHaveLength(7);
    expect(text(r)).not.toContain('Showing');
    expect(buttonNamed(r.root, 'more session')).toBeUndefined();

    await click(r.root, 'month');
    expect(cards(r)).toHaveLength(10);
    expect(text(r)).toContain('Showing 10 of 25 sessions');
    await act(async () => { r.unmount(); });
  });

  it('keeps a journal on a revealed session open and saveable while more rows are revealed', async () => {
    const r = await render();
    await click(r.root, 'Show 10 more sessions');
    const target = cards(r)[14];
    await act(async () => { target.props.onClick(); });
    expect(nodeText(target)).toContain('Journal 14');
    await click(target, 'Edit journal');
    await act(async () => { r.root.findByType('textarea').props.onChange({ target: { value: 'Revealed draft' } }); });

    await click(r.root, 'Show 5 more sessions');
    expect(r.root.findByType('textarea').props.value).toBe('Revealed draft');
    expect(r.root.findByType('textarea').props.id).toBe('journal-s14');

    // A range change is still refused while the journal is open, so the reset cannot hide it.
    await click(r.root, 'All Time');
    expect(text(r)).toContain('Save or cancel the current journal');
    expect(cards(r)).toHaveLength(25);
    expect(r.root.findByType('textarea').props.value).toBe('Revealed draft');

    await click(r.root, 'Save journal');
    expect(storage.patchSessionNotes).toHaveBeenCalledTimes(1);
    expect(storage.patchSessionNotes).toHaveBeenLastCalledWith('s14', { patientNotes: 'Revealed draft', moodRating: 3 });
    expect(r.root.findAllByType('textarea')).toHaveLength(0);
    expect(cards(r)).toHaveLength(25);
    expect(nodeText(cards(r)[14])).toContain('Revealed draft');
    await act(async () => { r.unmount(); });
  });

  it('keeps a failed save on a revealed session for retry', async () => {
    const r = await render();
    await click(r.root, 'Show 10 more sessions');
    await act(async () => { cards(r)[12].props.onClick(); });
    await click(cards(r)[12], 'Edit journal');
    await act(async () => { r.root.findByType('textarea').props.onChange({ target: { value: 'Retry revealed' } }); });
    storage.patchSessionNotes.mockRejectedValueOnce(new Error('offline'));
    await click(r.root, 'Save journal');
    expect(text(r)).toContain('Journal could not be saved');
    expect(cards(r)).toHaveLength(20);
    expect(r.root.findByType('textarea').props.value).toBe('Retry revealed');
    await click(r.root, 'Save journal');
    expect(storage.patchSessionNotes).toHaveBeenLastCalledWith('s12', { patientNotes: 'Retry revealed', moodRating: 3 });
    await act(async () => { r.unmount(); });
  });

  it('shows collapsed truthful rows: an unmeasured session reads unavailable', async () => {
    const r = await render();
    const unmeasured = cards(r)[4];
    expect(nodeText(unmeasured)).toContain('—');
    expect(unmeasured.findByProps({ role: 'img' }).props['aria-label']).toBe('Time in zone unavailable');
    expect(nodeText(unmeasured)).not.toContain('Journal 4');
    await act(async () => { r.unmount(); });
  });

  it('leaves loading, error and empty states without a count or control', async () => {
    storage.getSessions.mockReturnValueOnce(new Promise(() => {}));
    let r = await render();
    expect(text(r)).toContain('Loading session history');
    expect(text(r)).not.toContain('Showing');
    await act(async () => { r.unmount(); });

    storage.getSessions.mockRejectedValueOnce(new Error('offline'));
    r = await render();
    expect(text(r)).toContain('Session history unavailable');
    expect(text(r)).not.toContain('Showing');
    await act(async () => { r.unmount(); });

    // No neurofeedback session at all: the optional section stays one line, with no empty charts or controls.
    storage.getSessions.mockResolvedValueOnce([]);
    r = await render();
    expect(text(r)).toContain('No neurofeedback sessions yet.');
    expect(text(r)).not.toContain('No sessions in this period');
    expect(text(r)).not.toContain('Showing');
    expect(text(r)).not.toContain('Milestones');
    await act(async () => { r.unmount(); });
  });
});
