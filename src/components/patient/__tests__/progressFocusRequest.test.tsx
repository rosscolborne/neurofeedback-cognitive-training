import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlankProfile } from '../../../services/storageEngine';

// NFCT-13 part 2: Home's "See all achievements" opens Progress at its
// achievements. The request lasts only for the Progress visit it opened, so
// leaving Progress before it loads never makes a later, ordinary visit jump
// to the achievements.

vi.mock('../../../services/firebase', () => ({ auth: { currentUser: null }, db: {} }));
vi.mock('firebase/auth', () => ({ signOut: vi.fn() }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), deleteDoc: vi.fn() }));
vi.mock('../../../services/audioEngine', () => ({ audioEngine: { getMuted: () => false, setMuted: vi.fn() } }));
vi.mock('../../../services/storageEngine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/storageEngine')>()),
  storageEngine: {},
}));
vi.mock('../../brand/BrandLogo', () => ({ BrandLogo: 'brand-logo' }));
vi.mock('../../../consumer/games/mentalMath/MentalMathGame', () => ({ MentalMathGame: 'mental-math-game' }));
vi.mock('../../../consumer/games/mentalMath/MentalMathProgressCard', () => ({ MentalMathProgressCard: 'mental-math-progress-card' }));
vi.mock('../../../consumer/overview/HomeOverview', () => ({ HomeOverview: 'home-overview' }));
vi.mock('../../../consumer/overview/ProgressOverview', () => ({ ProgressOverview: 'progress-overview' }));
vi.mock('../ProgressHistory', () => ({ ProgressHistory: ({ gamesSection }: { gamesSection?: React.ReactNode }) => gamesSection ?? null }));

import { PatientShell } from '../PatientShell';


const tab = (renderer: ReactTestRenderer, label: string) => act(() => {
  renderer.root.findByType('nav').findAllByType('button').find((button) => button.props['aria-label'] === label)!.props.onClick();
});
const element = (renderer: ReactTestRenderer, type: string): ReactTestInstance => renderer.root.find((node) => (node.type as unknown) === type);

describe('the "See all achievements" request', () => {
  let renderer: ReactTestRenderer;

  beforeEach(async () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    await act(async () => {
      renderer = create(
        <PatientShell client={createBlankProfile('patient-1', 'p@example.com', 'Pat')} onUpdateClient={vi.fn()} onClientPersistedElsewhere={vi.fn()} />,
      );
    });
  });

  afterEach(() => {
    act(() => renderer.unmount());
    vi.unstubAllGlobals();
  });

  it('opens Progress at its achievements, and is done once they are focused', () => {
    act(() => element(renderer, 'home-overview').props.onOpenAchievements());
    const progress = element(renderer, 'progress-overview');
    expect(progress.props.focusSection).toBe('achievements');
    act(() => progress.props.onSectionFocused());
    expect(element(renderer, 'progress-overview').props.focusSection).toBeNull();
  });

  it('is dropped when the player leaves Progress before it has loaded', () => {
    act(() => element(renderer, 'home-overview').props.onOpenAchievements());
    expect(element(renderer, 'progress-overview').props.focusSection).toBe('achievements');
    tab(renderer, 'Home');
    tab(renderer, 'Progress');
    expect(element(renderer, 'progress-overview').props.focusSection).toBeNull();
  });

  it('never applies to an ordinary visit to Progress', () => {
    tab(renderer, 'Progress');
    expect(element(renderer, 'progress-overview').props.focusSection).toBeNull();
  });
});
