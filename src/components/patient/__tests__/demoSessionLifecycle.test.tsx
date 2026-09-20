import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientProfile, SessionRecord } from '../../../types';

const saved = vi.hoisted(() => ({ sessions: [] as SessionRecord[] }));
const engine = vi.hoisted(() => ({
  isHardwareConnected: false,
  isDemoMode: false,
  demoState: 'auto',
  deviceName: null,
  configureProtocol: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  subscribe: vi.fn(() => vi.fn()),
  getBandPowerProvenance: vi.fn(() => null),
  setThreshold: vi.fn(),
  setSimulatedState: vi.fn(),
  connectMuseBluetooth: vi.fn(),
}));
const repository = vi.hoisted(() => ({
  createSession: vi.fn(async (session: SessionRecord) => { saved.sessions = [session]; return { created: true }; }),
  getSessions: vi.fn(async () => [...saved.sessions]),
}));

vi.mock('../../../services/eegEngine', () => ({ eegEngine: engine }));
vi.mock('../../../services/audioEngine', () => ({ audioEngine: { playChime: vi.fn(), stopAll: vi.fn(), setMuted: vi.fn() } }));
vi.mock('../../../services/storageEngine', () => ({ storageEngine: repository, INITIAL_BADGES: [] }));
vi.mock('../../experiences/SkylineDriftCanvas', () => ({ SkylineDriftCanvas: 'experience-view' }));
vi.mock('../../experiences/TidalGardenCanvas', () => ({ TidalGardenCanvas: 'experience-view' }));
vi.mock('../../experiences/BreathWeaveCanvas', () => ({ BreathWeaveCanvas: 'experience-view' }));
vi.mock('../../experiences/SignalSortGame', () => ({ SignalSortGame: 'experience-view' }));
vi.mock('../../experiences/RhythmLockGame', () => ({ RhythmLockGame: 'experience-view' }));
vi.mock('../../experiences/MediaModePlayer', () => ({ MediaModePlayer: 'experience-view' }));
vi.mock('../../experiences/SoundscapePlayer', () => ({ SoundscapePlayer: 'experience-view' }));
vi.mock('../../experiences/MandalaBreathing', () => ({ MandalaBreathing: 'experience-view' }));
vi.mock('../../experiences/EegMandalaCanvas', () => ({ EegMandalaCanvas: 'experience-view' }));
vi.mock('../../experiences/GenerativeWebXRCanvas', () => ({ GenerativeWebXRCanvas: 'experience-view' }));
vi.mock('../../experiences/GenerativeMusicMode', () => ({ GenerativeMusicMode: 'experience-view' }));
vi.mock('../../experiences/NarrativeTherapyMode', () => ({ NarrativeTherapyMode: 'experience-view' }));
vi.mock('../../experiences/NeuroGambitExperience', () => ({ NeuroGambitExperience: 'experience-view' }));
vi.mock('../HeadsetFitModal', () => ({ HeadsetFitModal: 'headset-fit' }));

import { resolveSessionCareProvenance, SessionRunner } from '../SessionRunner';
import { ProgressHistory } from '../ProgressHistory';

const client = {
  id: 'patient-1', name: 'Patient One', email: 'patient@example.com', avatarUrl: '',
  condition: 'Generalized Anxiety', status: 'active', assignedProtocol: 'alpha-enhancement',
  clinicId: 'clinic-1', clinicianId: 'clinician-1',
  prescribedSessionsPerWeek: 2, brainMaps: [], allowedExperiences: ['tidal-garden'],
  completedSessionsCount: 0, currentStreak: 0, streakFreezeRemaining: 0,
  brainCapacityScore: 0, lastSessionDate: '', nextSessionDate: '',
  tidalGardenState: { stage: 0, plantsUnlocked: [], growthPoints: 0, lastWatered: '' },
  skylineBiomesUnlocked: [], badges: [],
} as ClientProfile;

const text = (renderer: ReactTestRenderer) => JSON.stringify(renderer.toJSON());
const button = (renderer: ReactTestRenderer, label: string): ReactTestInstance => {
  const match = renderer.root.findAllByType('button').find((candidate) =>
    candidate.findAll((node) => node.children.some((child) => typeof child === 'string' && child.includes(label))).length > 0
  );
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
};

describe('mounted patient Demo session lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saved.sessions = [];
    engine.isHardwareConnected = false;
    engine.isDemoMode = false;
    engine.demoState = 'auto';
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('window', { setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval });
  });

  it('uses self-guided provenance only for an unlinked patient', () => {
    expect(resolveSessionCareProvenance({ ...client, clinicId: undefined, clinicianId: undefined, linkedClinicianCode: undefined }))
      .toEqual({ clinicId: 'self-guided', clinicianId: undefined });
    expect(resolveSessionCareProvenance({ ...client, clinicId: undefined, clinicianId: undefined, linkedClinicianCode: 'legacy-clinician' }))
      .toEqual({ clinicId: '', clinicianId: 'legacy-clinician' });
    expect(resolveSessionCareProvenance({ ...client, clinicId: 'clinic-1', clinicianId: 'canonical', linkedClinicianCode: 'legacy' }))
      .toEqual({ clinicId: 'clinic-1', clinicianId: 'canonical' });
  });

  afterEach(() => {
    engine.isDemoMode = false;
    vi.unstubAllGlobals();
  });

  it('saves and reloads one synthetic session, labels it in history, then restores the next headset gate', async () => {
    let runner!: ReactTestRenderer;
    await act(async () => {
      runner = create(<SessionRunner client={client} selectedExperience="tidal-garden" onComplete={(session) => repository.createSession(session).then(() => undefined)} onCancel={vi.fn()} />);
    });
    expect(text(runner)).toContain('Connect Muse Headband');

    await act(async () => { button(runner, 'Try Demo Mode').props.onClick(); });
    expect(engine.isDemoMode).toBe(true);
    await act(async () => { button(runner, 'End Session & Save').props.onClick(); });
    await act(async () => { await button(runner, 'Yes, Save Progress').props.onClick(); });
    expect(repository.createSession).toHaveBeenCalledOnce();
    expect(saved.sessions[0]).toMatchObject({
      patientId: client.id,
      clinicId: 'clinic-1',
      clinicianId: 'clinician-1',
      isDemo: true,
    });
    expect(engine.isDemoMode).toBe(false);
    await act(async () => { runner.unmount(); });

    let history!: ReactTestRenderer;
    await act(async () => { history = create(<ProgressHistory client={client} />); await Promise.resolve(); });
    expect(repository.getSessions).toHaveBeenCalledWith(client.id);
    expect(text(history)).toContain('Tracking 1 session over time.');
    expect(text(history)).toContain('Training Demo · Synthetic acquisition');
    await act(async () => { history.unmount(); });

    engine.isDemoMode = true; // Simulate any stale singleton value before the next ordinary run.
    let nextRunner!: ReactTestRenderer;
    await act(async () => { nextRunner = create(<SessionRunner client={client} selectedExperience="tidal-garden" onComplete={vi.fn()} onCancel={vi.fn()} />); });
    expect(engine.isDemoMode).toBe(false);
    expect(text(nextRunner)).toContain('Connect Muse Headband');
    await act(async () => { nextRunner.unmount(); });
  });

  it('uses the clinic and legacy clinician relationship independently for a hardware session', async () => {
    engine.isHardwareConnected = true;
    const legacyLinkedClient = {
      ...client,
      clinicId: 'clinic-legacy',
      clinicianId: undefined,
      linkedClinicianCode: 'clinician-legacy',
    };
    const onComplete = vi.fn(async () => undefined);
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<SessionRunner client={legacyLinkedClient} selectedExperience="tidal-garden" onComplete={onComplete} onCancel={vi.fn()} />);
    });
    await act(async () => {
      renderer.root.find((node) => (node.type as unknown) === 'headset-fit').props.onConfirmReady();
    });
    await act(async () => { button(renderer, 'Begin Training').props.onClick(); });
    await act(async () => { button(renderer, 'End Session & Save').props.onClick(); });
    await act(async () => { await button(renderer, 'Yes, Save Progress').props.onClick(); });
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
      clinicId: 'clinic-legacy',
      clinicianId: 'clinician-legacy',
      isDemo: false,
    }));
    await act(async () => { renderer.unmount(); });
  });

  it('clears Demo acquisition on cancellation and unmount', async () => {
    const onCancel = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<SessionRunner client={client} selectedExperience="tidal-garden" onComplete={vi.fn()} onCancel={onCancel} />); });
    await act(async () => { button(renderer, 'Try Demo Mode').props.onClick(); });
    await act(async () => { button(renderer, 'End Session & Save').props.onClick(); });
    await act(async () => { button(renderer, 'Exit Without Saving').props.onClick(); });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(engine.isDemoMode).toBe(false);
    await act(async () => { renderer.unmount(); });
    expect(engine.isDemoMode).toBe(false);
  });
});
