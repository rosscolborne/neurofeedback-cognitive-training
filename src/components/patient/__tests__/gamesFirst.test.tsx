import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientProfile, SessionRecord } from '../../../types';

const storage = vi.hoisted(() => ({ getSessions: vi.fn() }));
vi.mock('../../../services/storageEngine', () => ({ storageEngine: storage, INITIAL_BADGES: [] }));
import { HomeScreen } from '../HomeScreen';
import { ProgressHistory } from '../ProgressHistory';

// NFCT-13 part 2: with the games section mounted, Home and Progress lead with
// game performance, and the inherited neurofeedback (EEG) training and
// history follow as a clearly secondary, optional section. Nothing
// EEG-derived (an EEG streak, time in zone) appears beside the games.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const client: ClientProfile = {
  id: 'p', name: 'Sam Player', email: 'p@example.test', status: 'active', assignedProtocol: 'theta-beta-ratio',
  allowedExperiences: ['neuro-gambit'], brainMaps: [], badges: [], completedSessionsCount: 1, currentStreak: 4,
};
const eegSession = (id: string, timestamp: number): SessionRecord => ({
  id, patientId: 'p', patientName: 'Sam Player', clinicId: 'clinic', date: 'Sep 30', timestamp, protocol: 'theta-beta-ratio',
  experience: 'neuro-gambit', durationSeconds: 600, timeInZonePercent: 62, averageCoherence: null, timeSeries: [],
  adaptiveAdjustmentsCount: 0, finalThreshold: 0.7,
});

const nodeText = (node: ReactTestInstance | string): string => (typeof node === 'string' ? node : node.children.map(nodeText).join(' '));
const games = <section data-testid="games"><h2>Games come first</h2></section>;

let renderer: ReactTestRenderer | null = null;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
});

beforeEach(() => {
  vi.resetAllMocks();
  storage.getSessions.mockResolvedValue([]);
});

describe('Home with the games section', () => {
  it('puts the games first and makes neurofeedback an optional, secondary section', async () => {
    await act(async () => { renderer = create(<HomeScreen client={client} onStartSession={vi.fn()} gamesSection={games} />); });
    const text = nodeText(renderer!.root);
    expect(text.indexOf('Games come first')).toBeLessThan(text.indexOf('Neurofeedback training'));
    expect(text).toContain('Optional. Uses a Muse headset, and is separate from your game progress.');
    // One primary action on Home: the games' Play. The neurofeedback start is secondary.
    const begin = renderer!.root.findAllByType('button').find((button) => nodeText(button).includes('Begin Session'))!;
    expect(begin.props.className).toBe('btn btn-secondary');
    // No EEG-derived streak or time in zone beside the game streak, and Home reads no EEG history.
    expect(text).not.toMatch(/Training Consistency|Active Streak|target zone/);
    expect(storage.getSessions).not.toHaveBeenCalled();
  });

  it('keeps the inherited layout without a games section', async () => {
    await act(async () => { renderer = create(<HomeScreen client={client} onStartSession={vi.fn()} />); });
    const begin = renderer!.root.findAllByType('button').find((button) => nodeText(button).includes('Begin Session'))!;
    expect(begin.props.className).toBe('btn btn-primary');
    expect(nodeText(renderer!.root)).not.toContain('Neurofeedback training');
  });
});

describe('Progress with the games section', () => {
  it('leads with the games and keeps the neurofeedback history secondary and one line when empty', async () => {
    await act(async () => { renderer = create(<ProgressHistory client={client} gamesSection={games} />); });
    const text = nodeText(renderer!.root);
    expect(text.indexOf('Your Progress')).toBeLessThan(text.indexOf('Games come first'));
    expect(text.indexOf('Games come first')).toBeLessThan(text.indexOf('Neurofeedback sessions'));
    expect(text).toContain('No neurofeedback sessions yet.');
    // The old copy ignored games entirely.
    expect(text).not.toContain('Complete your first session to start tracking progress.');
    expect(text).not.toMatch(/target zone|Milestones|Export Data/);
  });

  it('shows the neurofeedback history in full once there is a session', async () => {
    storage.getSessions.mockResolvedValue([eegSession('s1', Date.now() - 3_600_000)]);
    await act(async () => { renderer = create(<ProgressHistory client={client} gamesSection={games} />); });
    const text = nodeText(renderer!.root);
    expect(text).toContain('Tracking 1 session over time.');
    expect(text).toMatch(/Average time in target zone/i);
    expect(text.indexOf('Games come first')).toBeLessThan(text.indexOf('Session History'));
  });
});
