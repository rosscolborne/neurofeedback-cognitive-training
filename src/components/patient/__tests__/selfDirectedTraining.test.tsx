import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientProfile } from '../../../types';
import { createBlankProfile } from '../../../services/storageEngine';
import { getClinicalProtocolTemplate } from '../../../services/clinicalProtocolTemplates';
import { APP_DISPLAY_NAME } from '../../../config/appIdentity';

const state = vi.hoisted(() => ({
  getSessions: vi.fn(async () => []),
}));
vi.mock('../../../services/firebase', () => ({ auth: { currentUser: null }, db: {} }));
vi.mock('firebase/auth', () => ({ signOut: vi.fn() }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), deleteDoc: vi.fn() }));
vi.mock('../../../services/audioEngine', () => ({ audioEngine: { getMuted: () => false, setMuted: vi.fn() } }));
vi.mock('../../../services/storageEngine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/storageEngine')>()),
  storageEngine: {
    getSessions: state.getSessions,
  },
}));
vi.mock('../SessionRunner', () => ({ SessionRunner: 'session-runner' }));
vi.mock('../ProgressHistory', () => ({ ProgressHistory: 'progress-history' }));
vi.mock('../PostSessionSummary', () => ({ PostSessionSummary: 'post-session-summary' }));
vi.mock('../../brand/BrandLogo', () => ({ BrandLogo: 'brand-logo' }));
vi.mock('../../../consumer/games/mentalMath/MentalMathGame', () => ({ MentalMathGame: 'mental-math-game' }));

import { PatientShell } from '../PatientShell';

const tbr = getClinicalProtocolTemplate('theta-beta-ratio')!.recommendedExperiences;
const alpha = getClinicalProtocolTemplate('alpha-enhancement')!.recommendedExperiences;
const smr = getClinicalProtocolTemplate('smr-enhancement')!.recommendedExperiences;
const unlinked = (): ClientProfile => createBlankProfile('patient-1', 'patient@example.com', 'Pat Self');
// A profile linked under the retired clinician product: its relationship and care-team fields are still stored.
const linked = (): ClientProfile => ({
  ...unlinked(), clinicianId: 'clinician-1', clinicId: 'clinic-1', condition: 'Peak Performance',
  prescribedSessionsPerWeek: 3, assignedProtocol: 'smr-enhancement', allowedExperiences: [...smr],
});

const text = (renderer: ReactTestRenderer) => JSON.stringify(renderer.toJSON());
const navLabels = (renderer: ReactTestRenderer) => renderer.root.findByType('nav').findAllByType('button').map((button) => button.props['aria-label']);
const tab = (renderer: ReactTestRenderer, label: string) => act(() => {
  renderer.root.findByType('nav').findAllByType('button').find((button) => button.props['aria-label'] === label)!.props.onClick();
});
const hasText = (node: ReactTestInstance, value: string) => node.findAll((child) => child.children.some((entry) => typeof entry === 'string' && entry.includes(value))).length > 0;
const button = (renderer: ReactTestRenderer, value: string) => renderer.root.findAllByType('button').find((node) => node.props['aria-label'] === value || hasText(node, value));
const factLabels = (renderer: ReactTestRenderer) => renderer.root.findAllByType('dt').map((node) => node.children.join(''));
// Train's experience cards, as the button that starts each one (the name button stretched over the card).
const trainCards = (renderer: ReactTestRenderer) => renderer.root.findAll((node) => node.type === 'li' && String(node.props.className).split(' ').includes('card-patient')).map((item) => item.findByType('button'));
const sessionRunners = (renderer: ReactTestRenderer) => renderer.root.findAll((node) => (node.type as unknown) === 'session-runner');

describe('self-directed patient shell', () => {
  let onClientPersistedElsewhere: ReturnType<typeof vi.fn<(updated: ClientProfile) => void>>;
  const shell = (client: ClientProfile) => (
    <PatientShell client={client} onUpdateClient={vi.fn()} onClientPersistedElsewhere={onClientPersistedElsewhere} />
  );

  afterEach(() => { vi.unstubAllGlobals(); });

  beforeEach(() => {
    vi.clearAllMocks();
    onClientPersistedElsewhere = vi.fn();
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('opens Mental Math from the Train tab with Demo Mode EEG offered as simulated, and returns to Train', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(shell(unlinked())); });
    tab(renderer, 'Train');
    const gameCard = renderer.root.findAll((node) => node.type === 'li' && String(node.props.className).split(' ').includes('train-game-card'))[0]!;
    expect(hasText(gameCard, 'Mental Math')).toBe(true);
    act(() => { gameCard.findByType('button').props.onClick(); });
    const game = renderer.root.findAll((node) => (node.type as unknown) === 'mental-math-game');
    expect(game).toHaveLength(1);
    expect(game[0]!.props.eegProvider.source).toBe('simulated');
    act(() => { game[0]!.props.onExit(); });
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'mental-math-game')).toHaveLength(0);
    expect(trainCards(renderer)).toHaveLength(tbr.length);
  });

  it('gives an unlinked patient a clean four-tab shell with no protocol setup and no care-team gaps', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(shell(unlinked())); });
    expect(navLabels(renderer)).toEqual(['Home', 'Train', 'Progress', 'Profile']);
    expect(text(renderer)).not.toMatch(/protocol/i);
    expect(button(renderer, 'Change training setup')).toBeUndefined();
    tab(renderer, 'Train');
    expect(trainCards(renderer)).toHaveLength(tbr.length);
    tab(renderer, 'Profile');
    expect(button(renderer, 'Change Training Setup')).toBeUndefined();
    expect(factLabels(renderer)).toEqual(['Completed']);
    expect(text(renderer)).not.toMatch(/protocol|calibrat|imprint/i);
    expect(factLabels(renderer)).not.toContain('Goal');
    expect(factLabels(renderer)).not.toContain('Weekly target');
    expect(text(renderer)).not.toContain('Unavailable');
    await act(async () => { renderer.unmount(); });
  });

  it('gives a profile linked under the retired clinician product the same self-directed shell', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(shell(linked())); });
    expect(navLabels(renderer)).toEqual(['Home', 'Train', 'Progress', 'Profile']);
    expect(text(renderer)).not.toMatch(/protocol/i);
    expect(text(renderer)).not.toMatch(/clinician|clinic\b/i);
    expect(button(renderer, 'Change training setup')).toBeUndefined();
    // The stored assignment stays the starting point.
    tab(renderer, 'Train');
    expect(trainCards(renderer)).toHaveLength(smr.length);
    // Stored care-team fields are not presented.
    tab(renderer, 'Profile');
    expect(button(renderer, 'Change Training Setup')).toBeUndefined();
    expect(factLabels(renderer)).toEqual(['Completed']);
    expect(text(renderer)).not.toMatch(/protocol|calibrat|imprint/i);
    expect(text(renderer)).not.toMatch(/clinician|clinic\b/i);
    await act(async () => { renderer.unmount(); });
  });

  it('starts sessions from the persisted experience list', async () => {
    const saved = { ...unlinked(), assignedProtocol: 'alpha-enhancement' as const, allowedExperiences: [...alpha] };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(shell(saved)); });
    tab(renderer, 'Train');
    expect(trainCards(renderer)).toHaveLength(alpha.length);
    // The first Train card starts its own experience.
    act(() => trainCards(renderer)[0].props.onClick());
    expect(sessionRunners(renderer)[0].props.selectedExperience).toBe('neuro-gambit');
    await act(async () => { renderer.unmount(); });
  });
});

describe('patient shell header name (NFCT-38)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it.each([
    ['an unlinked patient', unlinked],
    ['a profile linked under the retired clinician product', linked],
  ] as const)('names the app, never Waveable or a clinic, for %s', async (_who, client) => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<PatientShell client={client()} onUpdateClient={vi.fn()} onClientPersistedElsewhere={vi.fn()} />); });
    expect(hasText(renderer.root.findByType('header'), APP_DISPLAY_NAME)).toBe(true);
    expect(text(renderer)).not.toMatch(/waveable/i);
    await act(async () => { renderer.unmount(); });
  });
});
