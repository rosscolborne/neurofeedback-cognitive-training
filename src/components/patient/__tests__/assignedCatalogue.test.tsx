import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientProfile, ClinicBrandConfig, ExperienceType } from '../../../types';
import { readClientProfile } from '../../../services/dataMappers';
import { createBlankProfile } from '../../../services/storageEngine';

const state = vi.hoisted(() => ({ getSessions: vi.fn(async () => []), saveSelfDirectedTrainingSetup: vi.fn(), muted: false }));
vi.mock('../../../services/firebase', () => ({ auth: { currentUser: null }, db: {} }));
vi.mock('firebase/auth', () => ({ signOut: vi.fn() }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), deleteDoc: vi.fn() }));
vi.mock('../../../services/audioEngine', () => ({ audioEngine: { getMuted: () => state.muted, setMuted: vi.fn() } }));
vi.mock('../../../services/storageEngine', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../services/storageEngine')>()), storageEngine: { getSessions: state.getSessions, saveSelfDirectedTrainingSetup: state.saveSelfDirectedTrainingSetup, hasPendingInvitationNotice: async () => false } }));
vi.mock('../SessionRunner', () => ({ SessionRunner: 'session-runner' }));
vi.mock('../ProgressHistory', () => ({ ProgressHistory: 'progress-history' }));
vi.mock('../OnboardingFlow', () => ({ OnboardingFlow: 'onboarding-flow' }));
vi.mock('../PostSessionSummary', () => ({ PostSessionSummary: 'post-session-summary' }));
vi.mock('../ProtocolDetailsModal', () => ({ ProtocolDetailsModal: 'protocol-details' }));
vi.mock('../EducationHub', () => ({ EducationHub: 'education-hub' }));
vi.mock('../PatientMessagingView', () => ({ PatientMessagingView: 'patient-messages' }));
vi.mock('../PatientAppointmentsView', () => ({ PatientAppointmentsView: 'patient-appointments' }));
vi.mock('../../brand/BrandLogo', () => ({ BrandLogo: 'brand-logo' }));

import { HomeScreen } from '../HomeScreen';
import { PatientShell } from '../PatientShell';
import { EXPERIENCE_CATALOGUE, EXPERIENCE_IDS } from '../experienceCatalogue';
import { canStartAssignedExperience, getAssignedExperienceIds } from '../experienceCatalogue';
import { getClinicalProtocolTemplate } from '../../../services/clinicalProtocolTemplates';

const brand = { name: 'Clinic', logoUrl: '' } as ClinicBrandConfig;
const profile = (allowedExperiences: ExperienceType[]): ClientProfile => ({
  id: 'patient-1', name: 'Patient One', email: 'patient@example.com', status: 'active',
  clinicianId: 'clinician-1', allowedExperiences, brainMaps: [], badges: [], completedSessionsCount: 0, currentStreak: 0,
});
const shell = (client: ClientProfile) => <PatientShell brand={brand} client={client} onUpdateClient={vi.fn()} onClientPersistedElsewhere={vi.fn()} onOpenRebrand={vi.fn()} />;
const text = (renderer: ReactTestRenderer) => JSON.stringify(renderer.toJSON());
const train = (renderer: ReactTestRenderer) => {
  const button = renderer.root.findAllByType('button').find((node) => node.props['aria-label'] === 'Train');
  if (!button) throw new Error('Train tab missing');
  act(() => button.props.onClick());
};
const card = (renderer: ReactTestRenderer, name: string) => renderer.root.findAll((node) => node.props.className === 'card-patient' && typeof node.props.onClick === 'function' && node.findAll((child) => child.children.includes(name)).length > 0)[0];
const begin = (renderer: ReactTestRenderer) => renderer.root.findAllByType('button').find((node) => node.findAll((child) => child.children.includes(' Begin Session')).length > 0)!.props.onClick;

describe('patient assigned catalogue', () => {
  beforeEach(() => { vi.clearAllMocks(); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

  it('has one stable entry per experience and preserves names, descriptions, and research links', () => {
    expect(EXPERIENCE_IDS).toHaveLength(13);
    expect(new Set(EXPERIENCE_IDS).size).toBe(13);
    expect(Object.keys(EXPERIENCE_CATALOGUE).sort()).toEqual([...EXPERIENCE_IDS].sort());
    expect(EXPERIENCE_CATALOGUE['narrative-story']).toMatchObject({ name: 'Contemplative Reading', description: 'Calm mindfulness reflections guided by neurofeedback therapy', researchUrl: 'https://doi.org/10.1145/1978942.1978958' });
    expect(EXPERIENCE_CATALOGUE['eeg-mandala']).toMatchObject({ name: 'Generative Mandala', researchUrl: 'https://doi.org/10.1007/s10484-012-9204-4' });
    for (const id of EXPERIENCE_IDS) expect(EXPERIENCE_CATALOGUE[id]).toMatchObject({ id, name: expect.any(String), description: expect.any(String), researchUrl: expect.stringMatching(/^https:\/\/doi.org\//) });
  });

  it('keeps Home pills and Train cards on resolved X/Y, guards stale callbacks, and reselects after assignment changes', async () => {
    const xy = profile(['skyline-drift', 'neuro-gambit', 'skyline-drift']);
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(shell(xy)); });
    const home = renderer.root.findByType(HomeScreen);
    const staleStart = home.props.onStartSession;
    expect(text(renderer)).toContain('Skyline Drift');
    expect(text(renderer)).toContain('NeuroGambit');
    expect(text(renderer)).not.toContain('Tidal Garden');
    train(renderer);
    expect(card(renderer, 'Skyline Drift')).toBeDefined();
    expect(card(renderer, 'NeuroGambit')).toBeDefined();
    expect(card(renderer, 'Tidal Garden')).toBeUndefined();
    const staleTrainClick = card(renderer, 'Skyline Drift').props.onClick;
    act(() => staleStart('tidal-garden'));
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'session-runner')).toHaveLength(0);
    await act(async () => { renderer.update(shell(profile(['narrative-story']))); });
    expect(card(renderer, 'Contemplative Reading')).toBeDefined();
    expect(text(renderer)).toContain(EXPERIENCE_CATALOGUE['narrative-story'].description);
    expect(card(renderer, 'Skyline Drift')).toBeUndefined();
    act(() => staleStart('skyline-drift'));
    act(() => staleTrainClick());
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'session-runner')).toHaveLength(0);
    await act(async () => { renderer.root.findAllByType('button').find((node) => node.props['aria-label'] === 'Home')!.props.onClick(); });
    expect(text(renderer)).toContain('Calm mindfulness reflections guided by neurofeedback therapy');
    expect(text(renderer)).not.toContain('Skyline Drift');
    train(renderer);
    act(() => card(renderer, 'Contemplative Reading').props.onClick());
    expect(renderer.root.find((node) => (node.type as unknown) === 'session-runner').props.selectedExperience).toBe('narrative-story');
    await act(async () => { renderer.unmount(); });
  });

  it('preserves a running session across an assignment refresh', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(shell(profile(['skyline-drift']))); });
    act(() => renderer.root.findByType(HomeScreen).props.onStartSession('skyline-drift'));
    expect(renderer.root.find((node) => (node.type as unknown) === 'session-runner').props.selectedExperience).toBe('skyline-drift');
    await act(async () => { renderer.update(shell(profile(['narrative-story']))); });
    expect(renderer.root.find((node) => (node.type as unknown) === 'session-runner').props.selectedExperience).toBe('skyline-drift');
    await act(async () => { renderer.unmount(); });
  });

  it('reselects a newly assigned Home card and blocks a stale Begin callback', async () => {
    const onStartSession = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<HomeScreen client={profile(['skyline-drift', 'neuro-gambit'])} onStartSession={onStartSession} onNavigateTab={vi.fn()} />); });
    const staleBegin = begin(renderer);
    await act(async () => { renderer.update(<HomeScreen client={profile(['narrative-story'])} onStartSession={onStartSession} onNavigateTab={vi.fn()} />); });
    expect(text(renderer)).toContain('Contemplative Reading');
    expect(text(renderer)).not.toContain('Skyline Drift');
    act(() => staleBegin());
    expect(onStartSession).not.toHaveBeenCalled();
    act(() => begin(renderer)());
    expect(onStartSession).toHaveBeenCalledWith('narrative-story');
    onStartSession.mockClear();
    await act(async () => { renderer.update(<HomeScreen client={profile(['skyline-drift', 'neuro-gambit'])} onStartSession={onStartSession} onNavigateTab={vi.fn()} />); });
    act(() => renderer.root.findAllByType('button').find((node) => node.findAll((child) => child.children.some((value) => typeof value === 'string' && value.includes('Skyline Drift'))).length > 0)!.props.onClick({ currentTarget: { scrollIntoView: vi.fn() } }));
    await act(async () => { renderer.update(<HomeScreen client={profile(['neuro-gambit', 'skyline-drift'])} onStartSession={onStartSession} onNavigateTab={vi.fn()} />); });
    act(() => begin(renderer)());
    expect(onStartSession).toHaveBeenCalledWith('neuro-gambit');
    await act(async () => { renderer.unmount(); });
  });

  it('gives a fresh unlinked patient the default TBR list and keeps the missing-field legacy fallback', async () => {
    const unlinked = createBlankProfile('self', 'self@example.com');
    const tbr = getClinicalProtocolTemplate('theta-beta-ratio')!.recommendedExperiences;
    expect(unlinked.assignedProtocol).toBe('theta-beta-ratio');
    expect(unlinked.allowedExperiences).toEqual(tbr);
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(shell(unlinked)); });
    train(renderer);
    expect(renderer.root.findAll((node) => node.props.className === 'card-patient' && typeof node.props.onClick === 'function')).toHaveLength(tbr.length);
    expect(readClientProfile({ ...profile([]), allowedExperiences: ['spatial-audio'] }).allowedExperiences).toEqual(['generative-music']);
    expect(readClientProfile({ ...profile([]), allowedExperiences: [] }).allowedExperiences).toEqual([]);
    const missing = profile([]) as Partial<ClientProfile>;
    delete missing.allowedExperiences;
    expect(new Set(readClientProfile(missing).allowedExperiences)).toEqual(new Set(EXPERIENCE_IDS));
    await act(async () => { renderer.unmount(); });
  });

  it('keeps an unlinked assessment protocol and its experiences paired', async () => {
    const unlinked = {
      ...createBlankProfile('self', 'self@example.com'),
      customProtocolConfig: getClinicalProtocolTemplate('theta-beta-ratio'),
    };
    const onUpdateClient = vi.fn().mockResolvedValue(undefined);
    const onClientPersistedElsewhere = vi.fn();
    const saved = { ...unlinked, assignedProtocol: 'alpha-enhancement' as const, customProtocolConfig: undefined,
      allowedExperiences: [...getClinicalProtocolTemplate('alpha-enhancement')!.recommendedExperiences] };
    state.saveSelfDirectedTrainingSetup.mockResolvedValueOnce(saved);
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<PatientShell brand={brand} client={unlinked} onUpdateClient={onUpdateClient} onClientPersistedElsewhere={onClientPersistedElsewhere} onOpenRebrand={vi.fn()} />); });
    act(() => renderer.root.findAllByType('button').find((node) => node.props['aria-label'] === 'Profile')!.props.onClick());
    act(() => renderer.root.findAllByType('button').find((node) => node.findAll((child) => child.children.includes('Redo Setup')).length > 0 || node.children.includes('Redo Setup'))!.props.onClick());
    await act(async () => { await renderer.root.find((node) => (node.type as unknown) === 'onboarding-flow').props.onFinish({ assignedProtocol: 'alpha-enhancement' }); });
    // WB-102: the unlinked assessment goes through the relationship-guarded self-directed write.
    expect(onUpdateClient).not.toHaveBeenCalled();
    expect(state.saveSelfDirectedTrainingSetup).toHaveBeenCalledWith('self', {
      assignedProtocol: 'alpha-enhancement',
      allowedExperiences: getClinicalProtocolTemplate('alpha-enhancement')!.recommendedExperiences,
    });
    expect(onClientPersistedElsewhere).toHaveBeenCalledWith(saved);
    await act(async () => { renderer.unmount(); });
  });

  it('keeps NeuroGambit excluded by a selected template after a persisted reload', async () => {
    const template = getClinicalProtocolTemplate('alpha-enhancement')!;
    expect(template.recommendedExperiences).not.toContain('neuro-gambit');
    const persisted = { ...profile(EXPERIENCE_IDS), allowedExperiences: [...template.recommendedExperiences] };
    const reloaded = readClientProfile(persisted);
    expect(reloaded.allowedExperiences).toEqual(template.recommendedExperiences);
    expect(readClientProfile(persisted).allowedExperiences).not.toContain('neuro-gambit');
    expect(getAssignedExperienceIds(reloaded.allowedExperiences)).not.toContain('neuro-gambit');
    expect(canStartAssignedExperience(reloaded.allowedExperiences, 'neuro-gambit')).toBe(false);

    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(shell(reloaded)); });
    expect(text(renderer)).not.toContain('NeuroGambit');
    const staleHomeStart = renderer.root.findByType(HomeScreen).props.onStartSession;
    act(() => staleHomeStart('neuro-gambit'));
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'session-runner')).toHaveLength(0);
    train(renderer);
    expect(card(renderer, 'NeuroGambit')).toBeUndefined();
    expect(card(renderer, 'Mandala Breathing')).toBeDefined();
    await act(async () => { renderer.unmount(); });
  });

  it('treats an explicit empty list as no Home or Train experiences and blocks stale starts', async () => {
    expect(getAssignedExperienceIds([])).toEqual([]);
    expect(canStartAssignedExperience([], 'neuro-gambit')).toBe(false);
    expect(canStartAssignedExperience([], 'skyline-drift')).toBe(false);
    const empty = readClientProfile(profile([]));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(shell(profile(['skyline-drift']))); });
    const staleStart = renderer.root.findByType(HomeScreen).props.onStartSession;
    await act(async () => { renderer.update(shell(empty)); });
    expect(text(renderer)).toContain('No assigned experience');
    expect(renderer.root.findAllByType('button').find((node) => node.findAll((child) => child.children.includes(' Begin Session')).length > 0)?.props.disabled).toBe(true);
    act(() => staleStart('skyline-drift'));
    act(() => staleStart('neuro-gambit'));
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'session-runner')).toHaveLength(0);
    train(renderer);
    expect(renderer.root.findAll((node) => node.props.className === 'card-patient' && typeof node.props.onClick === 'function')).toHaveLength(0);
    await act(async () => { renderer.unmount(); });
  });
});
