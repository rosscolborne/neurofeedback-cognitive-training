import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientProfile, ClinicBrandConfig } from '../../../types';
import { createBlankProfile } from '../../../services/storageEngine';
import { getClinicalProtocolTemplate } from '../../../services/clinicalProtocolTemplates';
import { ClinicianManagedTrainingError } from '../../../services/patientTrainingAuthority';

const state = vi.hoisted(() => ({ getSessions: vi.fn(async () => []), saveSelfDirectedTrainingSetup: vi.fn() }));
vi.mock('../../../services/firebase', () => ({ auth: { currentUser: null }, db: {} }));
vi.mock('firebase/auth', () => ({ signOut: vi.fn() }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), deleteDoc: vi.fn() }));
vi.mock('../../../services/audioEngine', () => ({ audioEngine: { getMuted: () => false, setMuted: vi.fn() } }));
vi.mock('../../../services/storageEngine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/storageEngine')>()),
  storageEngine: { getSessions: state.getSessions, saveSelfDirectedTrainingSetup: state.saveSelfDirectedTrainingSetup },
}));
vi.mock('../../messaging/useMessageUnread', () => ({ useMessageUnread: () => ({ byPatient: {}, error: null }) }));
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
import { SelfDirectedSetupModal } from '../SelfDirectedSetupModal';

const brand = { name: 'Clinic', logoUrl: '' } as ClinicBrandConfig;
const tbr = getClinicalProtocolTemplate('theta-beta-ratio')!.recommendedExperiences;
const alpha = getClinicalProtocolTemplate('alpha-enhancement')!.recommendedExperiences;
const smr = getClinicalProtocolTemplate('smr-enhancement')!.recommendedExperiences;
const unlinked = (): ClientProfile => createBlankProfile('patient-1', 'patient@example.com', 'Pat Self');
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
const trainCards = (renderer: ReactTestRenderer) => renderer.root.findAll((node) => node.props.className === 'card-patient' && typeof node.props.onClick === 'function');
const sessionRunners = (renderer: ReactTestRenderer) => renderer.root.findAll((node) => (node.type as unknown) === 'session-runner');

describe('self-directed patient shell', () => {
  let onClientPersistedElsewhere: ReturnType<typeof vi.fn<(updated: ClientProfile) => void>>;
  const shell = (client: ClientProfile) => (
    <PatientShell brand={brand} client={client} onUpdateClient={vi.fn()} onClientPersistedElsewhere={onClientPersistedElsewhere} onOpenRebrand={vi.fn()} />
  );

  afterEach(() => { vi.unstubAllGlobals(); });

  beforeEach(() => {
    vi.clearAllMocks();
    onClientPersistedElsewhere = vi.fn();
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('gives an unlinked patient a clean five-tab shell with the default protocol and no care-team gaps', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(shell(unlinked())); });
    expect(navLabels(renderer)).toEqual(['Home', 'Train', 'Science', 'Progress', 'Profile']);
    expect(text(renderer)).toContain('Self-directed');
    expect(button(renderer, 'Change training setup')).toBeDefined();
    tab(renderer, 'Train');
    expect(trainCards(renderer)).toHaveLength(tbr.length);
    tab(renderer, 'Profile');
    expect(button(renderer, 'Change Training Setup')).toBeDefined();
    expect(text(renderer)).not.toContain('Goal:');
    expect(text(renderer)).not.toContain('Weekly Target:');
    expect(text(renderer)).not.toContain('Unavailable');
    await act(async () => { renderer.unmount(); });
  });

  it('shows Messages and Visits only while linked, following relationship changes and falling back to Home', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(shell(linked())); });
    expect(navLabels(renderer)).toEqual(['Home', 'Train', 'Science', 'Progress', 'Messages', 'Visits', 'Profile']);
    expect(text(renderer)).toContain('Clinician-managed');
    expect(button(renderer, 'Change training setup')).toBeUndefined();
    tab(renderer, 'Profile');
    expect(button(renderer, 'Change Training Setup')).toBeUndefined();
    tab(renderer, 'Messages');
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'patient-messages')).toHaveLength(1);

    // The clinician removes the relationship (Firestore writes null link fields).
    await act(async () => { renderer.update(shell({ ...linked(), clinicianId: null as never, clinicId: null as never })); });
    expect(navLabels(renderer)).toEqual(['Home', 'Train', 'Science', 'Progress', 'Profile']);
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'patient-messages')).toHaveLength(0);
    expect(renderer.root.findAllByType(HomeScreen)).toHaveLength(1);
    expect(button(renderer, 'Change training setup')).toBeDefined();
    // Unlinking keeps the last assignment as the self-directed starting point.
    tab(renderer, 'Train');
    expect(trainCards(renderer)).toHaveLength(smr.length);
    // The former clinician's goal and weekly target are kept but no longer presented as care-team facts.
    tab(renderer, 'Profile');
    expect(text(renderer)).toContain('Self-directed');
    expect(text(renderer)).not.toContain('Goal:');
    expect(text(renderer)).not.toContain('Weekly Target:');

    await act(async () => { renderer.update(shell(linked())); });
    expect(navLabels(renderer)).toContain('Messages');
    expect(navLabels(renderer)).toContain('Visits');
    await act(async () => { renderer.unmount(); });
  });

  it('saves a protocol choice with its canonical defaults and blocks stale starts of dropped experiences', async () => {
    const saved = { ...unlinked(), assignedProtocol: 'alpha-enhancement' as const, allowedExperiences: [...alpha] };
    state.saveSelfDirectedTrainingSetup.mockResolvedValueOnce(saved);
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(shell(unlinked())); });
    const staleStart = renderer.root.findByType(HomeScreen).props.onStartSession;
    act(() => button(renderer, 'Change training setup')!.props.onClick());
    const modal = renderer.root.findByType(SelfDirectedSetupModal);
    act(() => modal.findAll((node) => node.type === 'input' && node.props.value === 'alpha-enhancement')[0].props.onChange());
    await act(async () => { button(renderer, 'Save setup')!.props.onClick(); });
    expect(state.saveSelfDirectedTrainingSetup).toHaveBeenCalledWith('patient-1', { assignedProtocol: 'alpha-enhancement', allowedExperiences: alpha });
    expect(onClientPersistedElsewhere).toHaveBeenCalledWith(saved);
    expect(renderer.root.findAllByType(SelfDirectedSetupModal)).toHaveLength(0);

    await act(async () => { renderer.update(shell(saved)); });
    expect(text(renderer)).not.toContain('Skyline Drift');
    act(() => staleStart('skyline-drift'));
    act(() => staleStart('neuro-gambit'));
    expect(sessionRunners(renderer)).toHaveLength(0);
    tab(renderer, 'Train');
    expect(trainCards(renderer)).toHaveLength(alpha.length);
    // Session start uses the same persisted list: the first Train card starts its own experience.
    act(() => trainCards(renderer)[0].props.onClick());
    expect(sessionRunners(renderer)[0].props.selectedExperience).toBe('immersive-3d');
    await act(async () => { renderer.unmount(); });
  });

  it('saves an exact customized list, offers a defaults reset, and requires at least one experience', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<SelfDirectedSetupModal client={unlinked()} onSave={onSave} onClose={vi.fn()} />); });
    expect(text(renderer)).toContain(`Using the ${tbr.length} defaults for this protocol`);
    act(() => button(renderer, 'Customize experiences')!.props.onClick());
    const checkbox = (name: string) => renderer.root.findAll((node) => node.type === 'label' && hasText(node, name))[0].findByType('input');
    expect(checkbox('NeuroGambit').props.checked).toBe(true);
    act(() => checkbox('NeuroGambit').props.onChange());
    act(() => checkbox('Tidal Garden').props.onChange());
    expect(text(renderer)).toContain(`Customized: ${tbr.length} of 13 experiences`);
    expect(button(renderer, 'Use protocol defaults')).toBeDefined();
    await act(async () => { button(renderer, 'Save setup')!.props.onClick(); });
    const custom = [...tbr.filter((id) => id !== 'neuro-gambit'), 'tidal-garden'];
    expect(onSave).toHaveBeenCalledWith({ assignedProtocol: 'theta-beta-ratio', allowedExperiences: expect.arrayContaining(custom) });
    expect(onSave.mock.calls[0][0].allowedExperiences).toHaveLength(custom.length);

    const checked = () => renderer.root.findAll((node) => node.type === 'input' && node.props.type === 'checkbox' && node.props.checked);
    while (checked().length > 0) act(() => checked()[0].props.onChange());
    expect(button(renderer, 'Save setup')!.props.disabled).toBe(true);
    expect(text(renderer)).toContain('Choose at least one training experience.');
    act(() => button(renderer, 'Use protocol defaults')!.props.onClick());
    expect(text(renderer)).toContain(`Using the ${tbr.length} defaults for this protocol`);
    await act(async () => { renderer.unmount(); });
  });

  it('switches to the clinician plan and explains why nothing was saved when a clinician linked meanwhile', async () => {
    const clinicianPlan = linked();
    state.saveSelfDirectedTrainingSetup.mockRejectedValueOnce(new ClinicianManagedTrainingError(clinicianPlan));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(shell(unlinked())); });
    act(() => button(renderer, 'Change training setup')!.props.onClick());
    await act(async () => { button(renderer, 'Save setup')!.props.onClick(); });
    expect(onClientPersistedElsewhere).toHaveBeenCalledWith(clinicianPlan);
    expect(text(renderer)).toContain('now managed by your clinician');
    expect(button(renderer, 'Save setup')!.props.disabled).toBe(true);
    await act(async () => { button(renderer, 'Save setup')!.props.onClick(); });
    expect(state.saveSelfDirectedTrainingSetup).toHaveBeenCalledTimes(1);
    act(() => button(renderer, 'Close')!.props.onClick());
    expect(renderer.root.findAllByType(SelfDirectedSetupModal)).toHaveLength(0);
    await act(async () => { renderer.unmount(); });
  });
});
