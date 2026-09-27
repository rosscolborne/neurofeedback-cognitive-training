import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientProfile, ClinicBrandConfig, ExperienceType } from '../../../types';
import { readClientProfile } from '../../../services/dataMappers';
import { createBlankProfile } from '../../../services/storageEngine';

const state = vi.hoisted(() => ({ getSessions: vi.fn(async () => []), muted: false }));
vi.mock('../../../services/firebase', () => ({ auth: { currentUser: null }, db: {} }));
vi.mock('firebase/auth', () => ({ signOut: vi.fn() }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), deleteDoc: vi.fn() }));
vi.mock('../../../services/audioEngine', () => ({ audioEngine: { getMuted: () => state.muted, setMuted: vi.fn() } }));
vi.mock('../../../services/storageEngine', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../services/storageEngine')>()), storageEngine: { getSessions: state.getSessions } }));
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

  it('keeps the unlinked default list available and characterizes legacy mapper behavior', async () => {
    const unlinked = createBlankProfile('self', 'self@example.com');
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(shell(unlinked)); });
    train(renderer);
    expect(renderer.root.findAll((node) => node.props.className === 'card-patient' && typeof node.props.onClick === 'function')).toHaveLength(13);
    expect(readClientProfile({ ...profile([]), allowedExperiences: ['spatial-audio'] }).allowedExperiences).toEqual(['generative-music', 'neuro-gambit']);
    expect(readClientProfile({ ...profile([]), allowedExperiences: [] }).allowedExperiences).toEqual(['neuro-gambit']);
    const missing = profile([]) as Partial<ClientProfile>;
    delete missing.allowedExperiences;
    expect(readClientProfile(missing).allowedExperiences).toEqual([]);
    await act(async () => { renderer.unmount(); });
  });
});
