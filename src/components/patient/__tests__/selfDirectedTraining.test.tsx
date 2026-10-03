import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientProfile } from '../../../types';
import { createBlankProfile } from '../../../services/storageEngine';
import { getClinicalProtocolTemplate } from '../../../services/clinicalProtocolTemplates';
import { APP_DISPLAY_NAME } from '../../../config/appIdentity';

const state = vi.hoisted(() => ({
  getSessions: vi.fn(async () => []), saveSelfDirectedTrainingSetup: vi.fn(),
}));
vi.mock('../../../services/firebase', () => ({ auth: { currentUser: null }, db: {} }));
vi.mock('firebase/auth', () => ({ signOut: vi.fn() }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), deleteDoc: vi.fn() }));
vi.mock('../../../services/audioEngine', () => ({ audioEngine: { getMuted: () => false, setMuted: vi.fn() } }));
vi.mock('../../../services/storageEngine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/storageEngine')>()),
  storageEngine: {
    getSessions: state.getSessions, saveSelfDirectedTrainingSetup: state.saveSelfDirectedTrainingSetup,
  },
}));
vi.mock('../SessionRunner', () => ({ SessionRunner: 'session-runner' }));
vi.mock('../ProgressHistory', () => ({ ProgressHistory: 'progress-history' }));
vi.mock('../OnboardingFlow', () => ({ OnboardingFlow: 'onboarding-flow' }));
vi.mock('../PostSessionSummary', () => ({ PostSessionSummary: 'post-session-summary' }));
vi.mock('../ProtocolDetailsModal', () => ({ ProtocolDetailsModal: 'protocol-details' }));
vi.mock('../../brand/BrandLogo', () => ({ BrandLogo: 'brand-logo' }));
vi.mock('../../../consumer/games/mentalMath/MentalMathGame', () => ({ MentalMathGame: 'mental-math-game' }));

import { PatientShell } from '../PatientShell';
import { SelfDirectedSetupModal } from '../SelfDirectedSetupModal';

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

  it('gives an unlinked patient a clean four-tab shell with the default protocol and no care-team gaps', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(shell(unlinked())); });
    expect(navLabels(renderer)).toEqual(['Home', 'Train', 'Progress', 'Profile']);
    expect(text(renderer)).toContain('Your protocol');
    expect(button(renderer, 'Change training setup')).toBeDefined();
    tab(renderer, 'Train');
    expect(trainCards(renderer)).toHaveLength(tbr.length);
    tab(renderer, 'Profile');
    expect(button(renderer, 'Change Training Setup')).toBeDefined();
    expect(factLabels(renderer)).toEqual(['Protocol', 'Completed']);
    expect(factLabels(renderer)).not.toContain('Goal');
    expect(factLabels(renderer)).not.toContain('Weekly target');
    expect(text(renderer)).not.toContain('Unavailable');
    await act(async () => { renderer.unmount(); });
  });

  it('gives a profile linked under the retired clinician product the same self-directed shell', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(shell(linked())); });
    expect(navLabels(renderer)).toEqual(['Home', 'Train', 'Progress', 'Profile']);
    expect(text(renderer)).toContain('Your protocol');
    expect(text(renderer)).not.toMatch(/clinician|clinic\b/i);
    expect(button(renderer, 'Change training setup')).toBeDefined();
    // The stored assignment stays the starting point.
    tab(renderer, 'Train');
    expect(trainCards(renderer)).toHaveLength(smr.length);
    // Stored care-team fields are not presented.
    tab(renderer, 'Profile');
    expect(button(renderer, 'Change Training Setup')).toBeDefined();
    expect(factLabels(renderer)).toEqual(['Protocol', 'Completed']);
    expect(text(renderer)).not.toMatch(/clinician|clinic\b/i);
    await act(async () => { renderer.unmount(); });
  });

  it('saves a protocol choice with its canonical defaults and starts sessions from the persisted list', async () => {
    const saved = { ...unlinked(), assignedProtocol: 'alpha-enhancement' as const, allowedExperiences: [...alpha] };
    state.saveSelfDirectedTrainingSetup.mockResolvedValueOnce(saved);
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(shell(unlinked())); });
    act(() => button(renderer, 'Change training setup')!.props.onClick());
    const modal = renderer.root.findByType(SelfDirectedSetupModal);
    act(() => modal.findAll((node) => node.type === 'input' && node.props.value === 'alpha-enhancement')[0].props.onChange());
    await act(async () => { button(renderer, 'Save setup')!.props.onClick(); });
    expect(state.saveSelfDirectedTrainingSetup).toHaveBeenCalledWith('patient-1', { assignedProtocol: 'alpha-enhancement', allowedExperiences: alpha });
    expect(onClientPersistedElsewhere).toHaveBeenCalledWith(saved);
    expect(renderer.root.findAllByType(SelfDirectedSetupModal)).toHaveLength(0);

    await act(async () => { renderer.update(shell(saved)); });
    tab(renderer, 'Train');
    expect(trainCards(renderer)).toHaveLength(alpha.length);
    // Session start uses the same persisted list: the first Train card starts its own experience.
    act(() => trainCards(renderer)[0].props.onClick());
    expect(sessionRunners(renderer)[0].props.selectedExperience).toBe('neuro-gambit');
    await act(async () => { renderer.unmount(); });
  });

  it('requires at least one experience when customizing and offers a defaults reset', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<SelfDirectedSetupModal client={unlinked()} onSave={onSave} onClose={vi.fn()} />); });
    expect(text(renderer)).toContain('Using the 1 default for this protocol');
    act(() => button(renderer, 'Customize experiences')!.props.onClick());
    const checkbox = (name: string) => renderer.root.findAll((node) => node.type === 'label' && hasText(node, name))[0].findByType('input');
    expect(checkbox('NeuroGambit').props.checked).toBe(true);
    act(() => checkbox('NeuroGambit').props.onChange());
    expect(text(renderer)).toContain('Customized: 0 of 1 experience');
    expect(button(renderer, 'Save setup')!.props.disabled).toBe(true);
    expect(text(renderer)).toContain('Choose at least one training experience.');
    act(() => button(renderer, 'Use protocol defaults')!.props.onClick());
    expect(text(renderer)).toContain('Using the 1 default for this protocol');
    await act(async () => { button(renderer, 'Save setup')!.props.onClick(); });
    expect(onSave).toHaveBeenCalledWith({ assignedProtocol: 'theta-beta-ratio', allowedExperiences: ['neuro-gambit'] });
    await act(async () => { renderer.unmount(); });
  });

  it('keeps a customized self-directed list when the assessment is re-run with the same protocol', async () => {
    const customized = { ...unlinked(), allowedExperiences: [] as ClientProfile['allowedExperiences'] };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(shell(customized)); });
    tab(renderer, 'Profile');
    act(() => button(renderer, 'Redo Setup')!.props.onClick());
    await act(async () => { await renderer.root.find((node) => (node.type as unknown) === 'onboarding-flow').props.onFinish({ assignedProtocol: 'theta-beta-ratio' }); });
    expect(state.saveSelfDirectedTrainingSetup).not.toHaveBeenCalled();
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'onboarding-flow')).toHaveLength(0);
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
