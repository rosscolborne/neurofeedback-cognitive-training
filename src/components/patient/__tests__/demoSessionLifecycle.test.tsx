import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientProfile, SessionRecord } from '../../../types';

const saved = vi.hoisted(() => ({ sessions: [] as SessionRecord[] }));
const stream = vi.hoisted(() => ({
  callback: null as null | ((data: unknown) => void),
  sourceState: { sequence: 0, lastFrameAtMs: 0 },
}));
const engine = vi.hoisted(() => ({
  isHardwareConnected: false,
  isDemoMode: false,
  demoState: 'auto',
  deviceName: null,
  start: vi.fn(),
  stop: vi.fn(),
  subscribe: vi.fn((callback: (data: unknown) => void) => { stream.callback = callback; return vi.fn(); }),
  getHardwareSourceState: vi.fn(() => ({ ...stream.sourceState })),
  setSimulatedState: vi.fn(),
  connectMuseBluetooth: vi.fn(),
}));
const repository = vi.hoisted(() => ({
  createSession: vi.fn(async (session: SessionRecord) => { saved.sessions = [session]; return { created: true }; }),
  getSessions: vi.fn(async () => [...saved.sessions]),
}));

vi.mock('../../../services/eegEngine', () => ({ eegEngine: engine }));
vi.mock('../../../services/audioEngine', () => ({ audioEngine: { playChime: vi.fn(), setMuted: vi.fn() } }));
vi.mock('../../../services/storageEngine', () => ({ storageEngine: repository, INITIAL_BADGES: [] }));
vi.mock('../../experiences/NeuroGambitExperience', () => ({ NeuroGambitExperience: 'experience-view' }));
vi.mock('../HeadsetFitModal', () => ({ HeadsetFitModal: 'headset-fit' }));

import { resolveSessionCareProvenance, SessionRunner } from '../SessionRunner';
import { ProgressHistory } from '../ProgressHistory';
import { NEUROGAMBIT_SESSION_SECONDS } from '../../../services/trainingSession';

const client = {
  id: 'patient-1', name: 'Patient One', email: 'patient@example.com', avatarUrl: '',
  condition: 'Generalized Anxiety', status: 'active', assignedProtocol: 'alpha-enhancement',
  clinicId: 'clinic-1', clinicianId: 'clinician-1',
  prescribedSessionsPerWeek: 2, brainMaps: [], allowedExperiences: ['neuro-gambit'],
  completedSessionsCount: 0, currentStreak: 0, streakFreezeRemaining: 0,
  brainCapacityScore: 0, lastSessionDate: '', nextSessionDate: '',
  tidalGardenState: { stage: 0, plantsUnlocked: [], growthPoints: 0, lastWatered: '' },
  skylineBiomesUnlocked: [], badges: [],
} as ClientProfile;

const text = (renderer: ReactTestRenderer) => JSON.stringify(renderer.toJSON());
const SESSION = NEUROGAMBIT_SESSION_SECONDS;
/** An EEG frame as the engine now publishes it: fit and the two consumer scores. */
const frame = (method: 'brainflow' | 'demo' | null, mindfulnessScore = 60, restfulnessScore = 50) => ({
  timestamp: Date.now(),
  signalQuality: 'good',
  channelQuality: { tp9: 'good', af7: 'good', af8: 'good', tp10: 'good' },
  ...(method ? { brainflowScores: { mindfulnessScore, restfulnessScore, method } } : {}),
});
/** Rendered text as a reader sees it, across inline spans. */
const visibleText = (renderer: ReactTestRenderer) => {
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string') parts.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object' && 'children' in node) walk((node as { children: unknown }).children);
  };
  walk(renderer.toJSON());
  return parts.join('');
};
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
    stream.callback = null;
    stream.sourceState = { sequence: 0, lastFrameAtMs: 0 };
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

  it('gives NeuroGambit only the EEG frame and pause state: no patient, baseline or calibration', async () => {
    let runner!: ReactTestRenderer;
    await act(async () => { runner = create(<SessionRunner client={{ ...client, individualBaselineModel: { alphaPeakHz: 9, oneOverFSlope: 1, lastCalibratedAt: '2026-09-26T12:00:00Z' } }} selectedExperience="neuro-gambit" onComplete={vi.fn()} onCancel={vi.fn()} />); });
    await act(async () => { button(runner, 'Try Demo Mode').props.onClick(); });
    const experience = runner.root.find((node) => (node.type as unknown) === 'experience-view');
    expect(Object.keys(experience.props).sort()).toEqual(['eegData', 'isPaused']);
    await act(async () => { runner.unmount(); });
  });

  afterEach(() => {
    engine.isDemoMode = false;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows only mindfulness and restfulness, simulated in Demo, and never a protocol reward or time in zone', async () => {
    let runner!: ReactTestRenderer;
    await act(async () => {
      runner = create(<SessionRunner client={client} selectedExperience="neuro-gambit" onComplete={vi.fn()} onCancel={vi.fn()} />);
    });
    await act(async () => { button(runner, 'Try Demo Mode').props.onClick(); });
    await act(async () => { stream.callback?.(frame('demo', 88, 92)); });
    const output = visibleText(runner);
    expect(output).toContain('Mindfulness88');
    expect(output).toContain('Restfulness92');
    expect(output).toContain('Simulated');
    expect(output).not.toMatch(/zone|µV|ALPHA|BETA|THETA|REWARD|Target adjusted|calibration/i);
    await act(async () => { runner.unmount(); });
  });

  it('shows no metric slots for a headset session without BrainFlow scores', async () => {
    engine.isHardwareConnected = true;
    let runner!: ReactTestRenderer;
    await act(async () => {
      runner = create(<SessionRunner client={client} selectedExperience="neuro-gambit" onComplete={vi.fn()} onCancel={vi.fn()} />);
    });
    await act(async () => { runner.root.find((node) => (node.type as unknown) === 'headset-fit').props.onConfirmReady(); });
    await act(async () => { button(runner, 'Begin Training').props.onClick(); });
    await act(async () => { stream.callback?.(frame(null)); });
    expect(visibleText(runner)).not.toContain('Mindfulness');
    expect(visibleText(runner)).not.toContain('Unavailable');
    // A simulated score never appears in a headset session.
    await act(async () => { stream.callback?.(frame('demo', 70, 70)); });
    expect(visibleText(runner)).not.toContain('Mindfulness');
    await act(async () => { stream.callback?.(frame('brainflow', 71, 64)); });
    expect(visibleText(runner)).toContain('Mindfulness71');
    expect(visibleText(runner)).not.toContain('Simulated');
    await act(async () => { runner.unmount(); });
  });

  it('saves and reloads one synthetic session, labels it in history, then restores the next headset gate', async () => {
    let runner!: ReactTestRenderer;
    await act(async () => {
      runner = create(<SessionRunner client={client} selectedExperience="neuro-gambit" onComplete={(session) => repository.createSession(session).then(() => undefined)} onCancel={vi.fn()} />);
    });
    expect(text(runner)).toContain('Connect Muse Headband');

    await act(async () => { button(runner, 'Try Demo Mode').props.onClick(); });
    expect(engine.isDemoMode).toBe(true);
    await act(async () => { button(runner, 'End Session & Save').props.onClick(); });
    await act(async () => { await button(runner, 'Save & View Summary').props.onClick(); });
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
    expect(text(history)).toContain('"Training Demo"');
    const sessionCard = history.root.findAll((node) => node.props.className === 'card-patient' && typeof node.props.onClick === 'function')[0];
    await act(async () => { sessionCard.props.onClick(); });
    expect(text(history)).toContain('Not measured in Demo');
    await act(async () => { history.unmount(); });

    engine.isDemoMode = true; // Simulate any stale singleton value before the next ordinary run.
    let nextRunner!: ReactTestRenderer;
    await act(async () => { nextRunner = create(<SessionRunner client={client} selectedExperience="neuro-gambit" onComplete={vi.fn()} onCancel={vi.fn()} />); });
    expect(engine.isDemoMode).toBe(false);
    expect(text(nextRunner)).toContain('Connect Muse Headband');
    await act(async () => { nextRunner.unmount(); });
  });

  it('includes the final Demo clock tick and saves duration and simulated mindfulness, never in-zone data', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval });
    const onComplete = vi.fn(async (_session: SessionRecord) => undefined);
    let runner!: ReactTestRenderer;
    await act(async () => { runner = create(<SessionRunner client={client} selectedExperience="neuro-gambit" onComplete={onComplete} onCancel={vi.fn()} />); });
    await act(async () => { button(runner, 'Try Demo Mode').props.onClick(); });
    await act(async () => {
      stream.callback?.(frame('demo', 70, 40));
      vi.advanceTimersByTime((SESSION - 1) * 1_000);
    });
    expect(onComplete).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1_000); });
    expect(onComplete).toHaveBeenCalledOnce();
    const saved = onComplete.mock.calls[0][0];
    expect(saved).toMatchObject({
      durationSeconds: SESSION, configuredDurationSeconds: SESSION, isDemo: true, averageMindfulness: 70, experience: 'neuro-gambit',
    });
    for (const legacyField of ['protocol', 'timeInZonePercent', 'inZoneSeconds', 'averageBands', 'averageCoherence', 'timeSeries', 'finalThreshold', 'adaptiveAdjustmentsCount', 'averageTrainingScore', 'averageValence', 'averageArousal']) {
      expect(saved).not.toHaveProperty(legacyField);
    }
    await act(async () => { runner.unmount(); });
  });

  it('shows retry after automatic hardware completion even if the headset disconnects', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval });
    engine.isHardwareConnected = true;
    const attempts: SessionRecord[] = [];
    const onComplete = vi.fn(async (session: SessionRecord) => {
      attempts.push(session);
      if (attempts.length === 1) throw new Error('ambiguous response');
    });
    let runner!: ReactTestRenderer;
    await act(async () => { runner = create(<SessionRunner client={client} selectedExperience="neuro-gambit" onComplete={onComplete} onCancel={vi.fn()} />); });
    await act(async () => { runner.root.find((node) => (node.type as unknown) === 'headset-fit').props.onConfirmReady(); });
    await act(async () => { button(runner, 'Begin Training').props.onClick(); });
    for (let second = 0; second < SESSION; second++) {
      await act(async () => {
        stream.sourceState = { sequence: second + 1, lastFrameAtMs: Date.now() };
        stream.callback?.(frame('brainflow', 64, 50));
        vi.advanceTimersByTime(1_000);
      });
    }
    expect(onComplete).toHaveBeenCalledOnce();
    expect(button(runner, 'Save & View Summary').props.disabled).toBe(false);
    expect(text(runner)).toContain("We couldn't confirm this session was saved");
    engine.isHardwareConnected = false;
    await act(async () => { runner.update(<SessionRunner client={client} selectedExperience="neuro-gambit" onComplete={onComplete} onCancel={vi.fn()} />); });
    expect(button(runner, 'Save & View Summary').props.disabled).toBe(false);
    expect(text(runner)).not.toContain('Connect Muse Headband');
    await act(async () => { await button(runner, 'Save & View Summary').props.onClick(); });
    expect(attempts[1]).toBe(attempts[0]);
    expect(attempts[1]).toMatchObject({ durationSeconds: SESSION, configuredDurationSeconds: SESSION, averageMindfulness: 64, isDemo: false });
    expect(attempts[1]).not.toHaveProperty('inZoneSeconds');
    await act(async () => { runner.unmount(); });
  });

  it('refuses to save a hardware session without verified EEG coverage', async () => {
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
      renderer = create(<SessionRunner client={legacyLinkedClient} selectedExperience="neuro-gambit" onComplete={onComplete} onCancel={vi.fn()} />);
    });
    await act(async () => {
      renderer.root.find((node) => (node.type as unknown) === 'headset-fit').props.onConfirmReady();
    });
    await act(async () => { button(renderer, 'Begin Training').props.onClick(); });
    await act(async () => { button(renderer, 'End Session & Save').props.onClick(); });
    await act(async () => { await button(renderer, 'Save & View Summary').props.onClick(); });
    expect(onComplete).not.toHaveBeenCalled();
    expect(text(renderer)).toContain('Live EEG data has stopped');
    expect(button(renderer, 'Continue Training').props.disabled).toBe(false);
    expect(() => button(renderer, 'Return to Dashboard')).toThrow();
    await act(async () => { renderer.unmount(); });
  });

  it('pauses a started hardware session on disconnect without offering an in-place Demo substitution', async () => {
    engine.isHardwareConnected = true;
    const onComplete = vi.fn(async () => undefined);
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<SessionRunner client={client} selectedExperience="neuro-gambit" onComplete={onComplete} onCancel={vi.fn()} />);
    });
    await act(async () => {
      renderer.root.find((node) => (node.type as unknown) === 'headset-fit').props.onConfirmReady();
    });
    await act(async () => { button(renderer, 'Begin Training').props.onClick(); });
    engine.isHardwareConnected = false;
    await act(async () => {
      renderer.update(<SessionRunner client={client} selectedExperience="neuro-gambit" onComplete={onComplete} onCancel={vi.fn()} />);
    });
    expect(text(renderer)).toContain('Your session is paused — reconnect the headband to continue.');
    expect(text(renderer)).not.toContain('Try Demo Mode');
    expect(onComplete).not.toHaveBeenCalled();
    await act(async () => { renderer.unmount(); });
  });

  it('pauses and blocks saving when connected hardware stops delivering new source frames', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval });
    engine.isHardwareConnected = true;
    const onComplete = vi.fn(async () => undefined);
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<SessionRunner client={client} selectedExperience="neuro-gambit" onComplete={onComplete} onCancel={vi.fn()} />);
    });
    await act(async () => {
      renderer.root.find((node) => (node.type as unknown) === 'headset-fit').props.onConfirmReady();
    });
    await act(async () => { button(renderer, 'Begin Training').props.onClick(); });

    stream.sourceState = { sequence: 1, lastFrameAtMs: Date.now() };
    await act(async () => {
      stream.callback?.(frame('brainflow'));
      vi.advanceTimersByTime(1_000);
    });
    await act(async () => { vi.advanceTimersByTime(1_000); });
    expect(text(renderer)).toContain('Headset data has stopped. The session is paused until it returns.');
    expect(button(renderer, 'Resume')).toBeTruthy();

    await act(async () => { vi.advanceTimersByTime(2_001); });
    await act(async () => { button(renderer, 'End Session & Save').props.onClick(); });
    await act(async () => { await button(renderer, 'Save & View Summary').props.onClick(); });
    expect(text(renderer)).toContain('Live EEG data has stopped');
    expect(onComplete).not.toHaveBeenCalled();
    await act(async () => { renderer.unmount(); });
  });

  it('freezes Demo time and retries the identical session after an ambiguous save response', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval });
    const attempts: SessionRecord[] = [];
    const onComplete = vi.fn(async (session: SessionRecord) => {
      attempts.push(session);
      if (attempts.length === 1) throw new Error('ambiguous response');
    });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<SessionRunner client={client} selectedExperience="neuro-gambit" onComplete={onComplete} onCancel={vi.fn()} />);
    });
    await act(async () => { button(renderer, 'Try Demo Mode').props.onClick(); });
    await act(async () => {
      stream.callback?.(frame('demo'));
      vi.advanceTimersByTime(30_000);
    });
    await act(async () => { button(renderer, 'End Session & Save').props.onClick(); });
    await act(async () => { await button(renderer, 'Save & View Summary').props.onClick(); });
    expect(text(renderer)).toContain("We couldn't confirm this session was saved");
    expect(text(renderer)).toContain('Retry with the same session');
    expect(() => button(renderer, 'Continue Training')).toThrow();
    expect(button(renderer, 'Return to Dashboard').props.disabled).toBe(false);
    await act(async () => { vi.advanceTimersByTime(10_000); });
    await act(async () => { await button(renderer, 'Save & View Summary').props.onClick(); });
    expect(onComplete).toHaveBeenCalledTimes(2);
    expect(attempts[0].id).toMatch(/^sess-[0-9a-f-]{36}$/i);
    expect(attempts[1]).toBe(attempts[0]);
    expect(attempts[1]).toMatchObject({ durationSeconds: 30, configuredDurationSeconds: SESSION });
    await act(async () => { renderer.unmount(); });
  });

  it('clears Demo acquisition on cancellation and unmount', async () => {
    const onCancel = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<SessionRunner client={client} selectedExperience="neuro-gambit" onComplete={vi.fn()} onCancel={onCancel} />); });
    await act(async () => { button(renderer, 'Try Demo Mode').props.onClick(); });
    await act(async () => { button(renderer, 'End Session & Save').props.onClick(); });
    await act(async () => { button(renderer, 'Exit Without Saving').props.onClick(); });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(engine.isDemoMode).toBe(false);
    await act(async () => { renderer.unmount(); });
    expect(engine.isDemoMode).toBe(false);
  });
});
