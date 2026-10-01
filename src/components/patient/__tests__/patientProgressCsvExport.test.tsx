import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientProfile, SessionRecord } from '../../../types';

const state = vi.hoisted(() => ({ getSessions: vi.fn(), exportCsv: vi.fn() }));
vi.mock('../../../services/storageEngine', () => ({ storageEngine: { getSessions: state.getSessions }, INITIAL_BADGES: [
  { id: 'first-light', title: 'First Light', iconName: 'Award', description: 'First session' },
  { id: 'steady-state', title: 'Steady State', iconName: 'Award', description: 'Seven days' },
  { id: 'deep-focus', title: 'Deep Focus Master', iconName: 'Award', description: '80 percent' },
  { id: 'garden-keeper', title: 'Garden Keeper', iconName: 'Award', description: 'Stage 3' },
  { id: 'still-waters', title: 'Still Waters', iconName: 'Award', description: 'Alpha' },
] }));
vi.mock('../patientSessionCsv', () => ({ exportPatientSessionCsv: state.exportCsv }));

import { ProgressHistory } from '../ProgressHistory';

const client = {
  id: 'patient-1', name: 'Synthetic Patient', email: 'patient@example.test',
  status: 'active', brainMaps: [], allowedExperiences: [], badges: [],
  completedSessionsCount: 0, currentStreak: 0,
} as ClientProfile;
const session = (id: string, timestamp: number, isDemo?: boolean): SessionRecord => ({
  id, patientId: client.id, patientName: client.name, clinicId: 'clinic-1',
  date: 'Sep 27, 2026', timestamp, protocol: 'theta-beta-ratio', experience: 'neuro-gambit',
  durationSeconds: 100, timeInZonePercent: 50, averageCoherence: null,
  timeSeries: [], adaptiveAdjustmentsCount: 0, finalThreshold: 0, isDemo,
});
const exportButton = (renderer: ReactTestRenderer) => renderer.root.findAllByType('button').find((button) =>
  button.children.some((child) => typeof child === 'string' && (
    child.includes('Export Data (CSV)') || child.includes('Loading export data') ||
    child.includes('Export unavailable') || child.includes('No data to export')
  ))
)!;

describe('Progress CSV caller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('shows only supported milestones and updates Garden Keeper from reloaded stage evidence', async () => {
    state.getSessions.mockResolvedValueOnce([]);
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<ProgressHistory client={client} />); });
    const text = () => renderer.root.findAllByType('div').flatMap((node) => node.children.filter((child): child is string => typeof child === 'string')).join(' ');
    expect(text()).toContain('Garden Keeper');
    expect(text()).not.toContain('Still Waters');
    const gardenCard = () => renderer.root.findAllByType('div').find((node) => node.children.includes('Garden Keeper'))!.parent!;
    expect(gardenCard().props['aria-label']).toContain('Garden Keeper: locked');
    await act(async () => { renderer.update(<ProgressHistory client={{ ...client, tidalGardenState: { stage: 3, growthPoints: 501, plantsUnlocked: [], lastWatered: '' } }} />); });
    expect(gardenCard().props['aria-label']).toContain('Garden Keeper: earned');
    renderer.unmount();
  });

  it('passes its timestamp-valid all-time selection, including demos, to the shared exporter', async () => {
    const now = Date.now();
    const demo = session('demo', now - 2 * 86_400_000, true);
    const real = session('real', now - 40 * 86_400_000, false);
    state.getSessions.mockResolvedValueOnce([
      session('invalid', 0), demo, session('future', now + 86_400_000), real,
    ]);
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<ProgressHistory client={client} />); await Promise.resolve(); });
    expect(exportButton(renderer).props.disabled).toBe(false);
    act(() => exportButton(renderer).props.onClick());
    expect(state.getSessions).toHaveBeenCalledWith(client.id);
    expect(state.exportCsv).toHaveBeenCalledTimes(1);
    expect(state.exportCsv.mock.calls[0][0]).toEqual([real, demo]);
    renderer.unmount();
  });

  it('keeps export unavailable while loading, after read failure, and for valid-empty data', async () => {
    let rejectRead!: (reason: Error) => void;
    state.getSessions.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectRead = reject; }));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<ProgressHistory client={client} />); });
    expect(exportButton(renderer).props.disabled).toBe(true);
    act(() => exportButton(renderer).props.onClick());
    await act(async () => { rejectRead(new Error('offline')); await Promise.resolve(); });
    expect(exportButton(renderer).props.disabled).toBe(true);
    act(() => exportButton(renderer).props.onClick());
    renderer.unmount();

    state.getSessions.mockResolvedValueOnce([session('invalid', 0)]);
    await act(async () => { renderer = create(<ProgressHistory client={client} />); await Promise.resolve(); });
    expect(exportButton(renderer).props.disabled).toBe(true);
    act(() => exportButton(renderer).props.onClick());
    expect(state.exportCsv).not.toHaveBeenCalled();
    renderer.unmount();
  });
});
