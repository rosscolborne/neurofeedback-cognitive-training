import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRecord } from '../../../types';

const patchSessionNotes = vi.hoisted(() => vi.fn(async (): Promise<void> => undefined));
vi.mock('../../../services/storageEngine', () => ({ storageEngine: { patchSessionNotes } }));

import { PostSessionSummary } from '../PostSessionSummary';

const session: SessionRecord = {
  id: 'sess-durable', patientId: 'patient-1', patientName: 'Patient One', clinicId: 'clinic-1',
  clinicianId: 'clinician-1', date: 'Sep 19, 2026', timestamp: 1,
  protocol: 'alpha-enhancement', experience: 'neuro-gambit', durationSeconds: 60,
  timeInZonePercent: 50, averageCoherence: null, timeSeries: [],
  adaptiveAdjustmentsCount: 0, finalThreshold: 11, isDemo: true,
};

const text = (renderer: ReactTestRenderer) => JSON.stringify(renderer.toJSON());
const button = (renderer: ReactTestRenderer, label: string): ReactTestInstance => {
  const match = renderer.root.findAllByType('button').find((candidate) =>
    candidate.findAll((node) => node.children.some((child) => typeof child === 'string' && child.includes(label))).length > 0
  );
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
};

describe('PostSessionSummary authenticity', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    patchSessionNotes.mockResolvedValue(undefined);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('labels Demo feedback synthetic and does not present synthetic bands as measurements', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<PostSessionSummary session={session} onViewProgress={vi.fn()} />); });
    expect(text(renderer)).toContain('Training Demo — these results are simulated');
    expect(text(renderer)).toContain('Not measured in Demo');
    expect(text(renderer)).not.toContain('θ=0.0');
    await act(async () => { renderer.unmount(); });
  });

  it('preserves an existing mood and saves only journal fields', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<PostSessionSummary session={{ ...session, moodRating: 2 }} onViewProgress={vi.fn()} />); });
    await act(async () => { renderer.root.findByType('textarea').props.onChange({ target: { value: 'Existing mood, new note' } }); });
    await act(async () => { await button(renderer, 'Save Notes').props.onClick(); });
    expect(patchSessionNotes).toHaveBeenLastCalledWith(session.id, { moodRating: 2, patientNotes: 'Existing mood, new note' });

    await act(async () => { button(renderer, 'Calm').props.onClick(); });
    await act(async () => { await button(renderer, 'Save Notes').props.onClick(); });
    expect(patchSessionNotes).toHaveBeenLastCalledWith(session.id, { moodRating: 3, patientNotes: 'Existing mood, new note' });
    await act(async () => { renderer.unmount(); });
  });

  it('awaits a journal save before View Progress and keeps the draft on failure for retry', async () => {
    const onViewProgress = vi.fn();
    let rejectSave!: (error: Error) => void;
    patchSessionNotes.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectSave = reject; }));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<PostSessionSummary session={session} onViewProgress={onViewProgress} />); });
    await act(async () => { renderer.root.findByType('textarea').props.onChange({ target: { value: 'Important reflection' } }); });
    await act(async () => { button(renderer, 'Calm').props.onClick(); });
    await act(async () => { button(renderer, 'View Progress').props.onClick(); button(renderer, 'View Progress').props.onClick(); });
    expect(patchSessionNotes).toHaveBeenCalledTimes(1);
    expect(onViewProgress).not.toHaveBeenCalled();
    await act(async () => { rejectSave(new Error('offline')); });
    expect(onViewProgress).not.toHaveBeenCalled();
    expect(renderer.root.findByType('textarea').props.value).toBe('Important reflection');
    expect(text(renderer)).toContain("couldn't save");
    await act(async () => { await button(renderer, 'View Progress').props.onClick(); });
    expect(patchSessionNotes).toHaveBeenLastCalledWith(session.id, { moodRating: 3, patientNotes: 'Important reflection' });
    expect(onViewProgress).toHaveBeenCalledOnce();
    await act(async () => { renderer.unmount(); });
  });

  it('locks text and mood during View Progress save so later input cannot be silently lost', async () => {
    let finish!: () => void;
    patchSessionNotes.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const onViewProgress = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<PostSessionSummary session={session} onViewProgress={onViewProgress} />); });
    await act(async () => { renderer.root.findByType('textarea').props.onChange({ target: { value: 'First draft' } }); });
    await act(async () => { button(renderer, 'View Progress').props.onClick(); });
    expect(renderer.root.findByType('textarea').props.disabled).toBe(true);
    await act(async () => { renderer.root.findByType('textarea').props.onChange({ target: { value: 'Second draft' } }); button(renderer, 'Calm').props.onClick(); });
    expect(renderer.root.findByType('textarea').props.value).toBe('First draft');
    expect(patchSessionNotes).toHaveBeenCalledWith(session.id, { patientNotes: 'First draft', moodRating: undefined });
    await act(async () => { finish(); });
    expect(onViewProgress).toHaveBeenCalledOnce();
    await act(async () => { renderer.unmount(); });
  });

  it('handles StrictMode success and failure followed by retry', async () => {
    const onViewProgress = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<React.StrictMode><PostSessionSummary session={session} onViewProgress={onViewProgress} /></React.StrictMode>); });
    await act(async () => { renderer.root.findByType('textarea').props.onChange({ target: { value: 'Strict draft' } }); });
    patchSessionNotes.mockRejectedValueOnce(new Error('offline'));
    await act(async () => { await button(renderer, 'View Progress').props.onClick(); });
    expect(text(renderer)).toContain("couldn't save");
    expect(button(renderer, 'View Progress').props.disabled).toBe(false);
    expect(onViewProgress).not.toHaveBeenCalled();
    await act(async () => { await button(renderer, 'View Progress').props.onClick(); });
    expect(onViewProgress).toHaveBeenCalledOnce();
    expect(patchSessionNotes).toHaveBeenCalledTimes(2);
    await act(async () => { renderer.unmount(); });
  });
});
