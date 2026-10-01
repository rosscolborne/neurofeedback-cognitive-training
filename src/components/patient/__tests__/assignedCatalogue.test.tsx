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
const cards = (renderer: ReactTestRenderer) => renderer.root.findAll((node) => node.props.className === 'card-patient' && typeof node.props.onClick === 'function');
const begin = (renderer: ReactTestRenderer) => renderer.root.findAllByType('button').find((node) => node.findAll((child) => child.children.includes(' Begin Session')).length > 0)!.props.onClick;

describe('patient assigned catalogue', () => {
  beforeEach(() => { vi.clearAllMocks(); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

  it('has one stable entry per experience: NeuroGambit, the only remaining EEG experience', () => {
    expect(EXPERIENCE_IDS).toEqual(['neuro-gambit']);
    expect(Object.keys(EXPERIENCE_CATALOGUE).sort()).toEqual([...EXPERIENCE_IDS].sort());
    expect(EXPERIENCE_CATALOGUE['neuro-gambit']).toMatchObject({ id: 'neuro-gambit', name: 'NeuroGambit', description: expect.any(String) });
    expect(EXPERIENCE_CATALOGUE['neuro-gambit']).not.toHaveProperty('researchUrl');
  });

  it('keeps Home pills and Train cards on the resolved assignment and guards stale callbacks after it changes', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(shell(profile(['neuro-gambit', 'neuro-gambit']))); });
    const staleStart = renderer.root.findByType(HomeScreen).props.onStartSession;
    expect(text(renderer)).toContain('NeuroGambit');
    train(renderer);
    expect(cards(renderer)).toHaveLength(1);
    const staleTrainClick = card(renderer, 'NeuroGambit').props.onClick;
    await act(async () => { renderer.update(shell(profile([]))); });
    expect(card(renderer, 'NeuroGambit')).toBeUndefined();
    act(() => staleStart('neuro-gambit'));
    act(() => staleTrainClick());
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'session-runner')).toHaveLength(0);
    await act(async () => { renderer.update(shell(profile(['neuro-gambit']))); });
    act(() => card(renderer, 'NeuroGambit').props.onClick());
    expect(renderer.root.find((node) => (node.type as unknown) === 'session-runner').props.selectedExperience).toBe('neuro-gambit');
    await act(async () => { renderer.unmount(); });
  });

  it('preserves a running session across an assignment refresh', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(shell(profile(['neuro-gambit']))); });
    act(() => renderer.root.findByType(HomeScreen).props.onStartSession('neuro-gambit'));
    expect(renderer.root.find((node) => (node.type as unknown) === 'session-runner').props.selectedExperience).toBe('neuro-gambit');
    await act(async () => { renderer.update(shell(profile([]))); });
    expect(renderer.root.find((node) => (node.type as unknown) === 'session-runner').props.selectedExperience).toBe('neuro-gambit');
    await act(async () => { renderer.unmount(); });
  });

  it('blocks a stale Begin callback after the assignment is removed and begins again once reassigned', async () => {
    const onStartSession = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<HomeScreen client={profile(['neuro-gambit'])} onStartSession={onStartSession} />); });
    const staleBegin = begin(renderer);
    await act(async () => { renderer.update(<HomeScreen client={profile([])} onStartSession={onStartSession} />); });
    expect(text(renderer)).toContain('No assigned experience');
    act(() => staleBegin());
    expect(onStartSession).not.toHaveBeenCalled();
    await act(async () => { renderer.update(<HomeScreen client={profile(['neuro-gambit'])} onStartSession={onStartSession} />); });
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
    expect(cards(renderer)).toHaveLength(tbr.length);
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

  it('grants nothing for stored retired experience IDs and does not substitute NeuroGambit', async () => {
    // A legacy profile can still name experiences that no longer exist; they are read as stored and ignored.
    const retired = readClientProfile({ ...profile([]), allowedExperiences: ['skyline-drift', 'spatial-audio'] });
    expect(retired.allowedExperiences).toEqual(['skyline-drift', 'spatial-audio']);
    expect(getAssignedExperienceIds(retired.allowedExperiences)).toEqual([]);
    expect(canStartAssignedExperience(retired.allowedExperiences, 'neuro-gambit')).toBe(false);

    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(shell(retired)); });
    expect(text(renderer)).toContain('No assigned experience');
    expect(text(renderer)).not.toContain('NeuroGambit');
    act(() => renderer.root.findByType(HomeScreen).props.onStartSession('neuro-gambit'));
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'session-runner')).toHaveLength(0);
    train(renderer);
    expect(cards(renderer)).toHaveLength(0);
    await act(async () => { renderer.unmount(); });
  });

  it('treats an explicit empty list as no Home or Train experiences and blocks stale starts', async () => {
    expect(getAssignedExperienceIds([])).toEqual([]);
    expect(canStartAssignedExperience([], 'neuro-gambit')).toBe(false);
    const empty = readClientProfile(profile([]));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(shell(profile(['neuro-gambit']))); });
    const staleStart = renderer.root.findByType(HomeScreen).props.onStartSession;
    await act(async () => { renderer.update(shell(empty)); });
    expect(text(renderer)).toContain('No assigned experience');
    expect(renderer.root.findAllByType('button').find((node) => node.findAll((child) => child.children.includes(' Begin Session')).length > 0)?.props.disabled).toBe(true);
    act(() => staleStart('neuro-gambit'));
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'session-runner')).toHaveLength(0);
    train(renderer);
    expect(cards(renderer)).toHaveLength(0);
    await act(async () => { renderer.unmount(); });
  });
});
