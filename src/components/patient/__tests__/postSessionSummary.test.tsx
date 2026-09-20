import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRecord } from '../../../types';

const saveSession = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../../../services/storageEngine', () => ({ storageEngine: { saveSession } }));

import { PostSessionSummary } from '../PostSessionSummary';

const session: SessionRecord = {
  id: 'sess-durable', patientId: 'patient-1', patientName: 'Patient One', clinicId: 'clinic-1',
  clinicianId: 'clinician-1', date: 'Sep 19, 2026', timestamp: 1,
  protocol: 'alpha-enhancement', experience: 'tidal-garden', durationSeconds: 60,
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
    vi.clearAllMocks();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('labels Demo feedback synthetic and does not present synthetic bands as measurements', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<PostSessionSummary session={session} onViewProgress={vi.fn()} />); });
    expect(text(renderer)).toContain('Training Demo · Synthetic acquisition');
    expect(text(renderer)).toContain('Measured average band powers: unavailable in Training Demo');
    expect(text(renderer)).not.toContain('θ=0.0');
    await act(async () => { renderer.unmount(); });
  });

  it('begins with mood unset and persists it only after an explicit selection', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<PostSessionSummary session={session} onViewProgress={vi.fn()} />); });
    await act(async () => { await button(renderer, 'Save Notes').props.onClick(); });
    expect(saveSession).toHaveBeenLastCalledWith(expect.objectContaining({ moodRating: undefined }));

    await act(async () => { button(renderer, 'Calm').props.onClick(); });
    await act(async () => { await button(renderer, 'Saved').props.onClick(); });
    expect(saveSession).toHaveBeenLastCalledWith(expect.objectContaining({ moodRating: 3 }));
    await act(async () => { renderer.unmount(); });
  });
});
