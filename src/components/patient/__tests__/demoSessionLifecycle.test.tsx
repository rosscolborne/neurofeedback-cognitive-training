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
  configureProtocol: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  subscribe: vi.fn((callback: (data: unknown) => void) => { stream.callback = callback; return vi.fn(); }),
  getBandPowerProvenance: vi.fn((): { algorithm: string; version: string; source: 'brainflow' | 'browser-dsp' } | null => null),
  getHardwareSourceState: vi.fn(() => ({ ...stream.sourceState })),
  setThreshold: vi.fn(),
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

import { SessionRunner } from '../SessionRunner';
import { ProgressHistory } from '../ProgressHistory';
import { getClinicalProtocolTemplate } from '../../../services/clinicalProtocolTemplates';

// A profile linked under the retired clinician product, which still stores relationship fields.
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

  it('passes the actual patient Demo session mode into NeuroGambit without changing session progress behavior', async () => {
    let runner!: ReactTestRenderer;
    await act(async () => { runner = create(<SessionRunner client={{ ...client, individualBaselineModel: { alphaPeakHz: 9, oneOverFSlope: 1, lastCalibratedAt: '2026-09-26T12:00:00Z' } }} selectedExperience="neuro-gambit" onComplete={vi.fn()} onCancel={vi.fn()} />); });
    await act(async () => { button(runner, 'Try Demo Mode').props.onClick(); });
    const experience = runner.root.find((node) => (node.type as unknown) === 'experience-view');
    expect(experience.props.isDemoSession).toBe(true);
    expect(experience.props.patientId).toBe('patient-1');
    await act(async () => { runner.unmount(); });
  });

  afterEach(() => {
    engine.isDemoMode = false;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('renders the resolved default and clinician reward from the emitted feedback metric', async () => {
    const renderTelemetry = async (profile: ClientProfile, measured: number, inZone = true) => {
      let runner!: ReactTestRenderer;
      await act(async () => {
        runner = create(<SessionRunner client={profile} selectedExperience="neuro-gambit" onComplete={vi.fn()} onCancel={vi.fn()} />);
      });
      await act(async () => { button(runner, 'Try Demo Mode').props.onClick(); });
      await act(async () => {
        stream.callback?.({
          timestamp: Date.now(),
          rawSignal: 0,
          bands: { delta: 1, theta: 2, alpha: 99, smr: 8, beta: 4, gamma: 1 },
          bandAvailability: { delta: true, theta: true, alpha: true, smr: true, beta: true, gamma: true },
          bandRatios: {}, coherence: null, coherenceAvailable: false,
          thetaBetaRatio: 0.5, thetaBetaRatioAvailable: true,
          activeRewardMetric: { value: measured, source: profile.customProtocolConfig?.customRewardEnabled ? 'custom-raw' : 'demo' },
          inZone, inZoneAvailable: true, zoneScore: inZone ? 1 : 0,
          signalQuality: 'good',
          channelQuality: { tp9: 'good', af7: 'good', af8: 'good', tp10: 'good' },
          artifacts: { blink: false, clench: false },
          brainflowScores: { mindfulnessScore: 88, restfulnessScore: 92, method: 'demo' },
        });
      });
      const output = visibleText(runner);
      await act(async () => { runner.unmount(); });
      return output;
    };

    const defaultOutput = await renderTelemetry(client, 12.2);
    expect(defaultOutput).toContain('ALPHA (8–13 Hz)');
    expect(defaultOutput).toContain('12.2 µV');
    expect(defaultOutput).toContain('In zone now');
    expect(defaultOutput).toContain('Restfulness');
    expect(defaultOutput).toContain('88');
    expect(defaultOutput).toContain('92');
    expect(defaultOutput).toContain('Simulated');
    expect(defaultOutput).not.toContain('99.0 µV');

    const template = getClinicalProtocolTemplate('alpha-enhancement')!;
    const custom = (freqMin: number, freqMax: number): ClientProfile => ({
      ...client,
      customProtocolConfig: {
        ...template, id: 'custom-alpha', customRewardEnabled: true,
        rewardBand: { ...template.rewardBand, freqMin, freqMax, targetThreshold: 6 },
      },
    });
    const a = await renderTelemetry(custom(9, 11), 7.2);
    expect(a).toContain('REWARD (9–11 Hz)');
    expect(a).toContain('7.2 µV');
    const b = await renderTelemetry(custom(16, 18), 0.8);
    expect(b).toContain('REWARD (16–18 Hz)');
    expect(b).toContain('0.8 µV');
    expect(b).not.toContain('REWARD (9–11 Hz)');

    const beta = await renderTelemetry({
      ...client,
      assignedProtocol: 'beta-downtraining',
      customProtocolConfig: { ...getClinicalProtocolTemplate('beta-downtraining')!, alias: 'Test 123' },
    }, 16.2, false);
    expect(beta).toContain('BETA (13–30 Hz)');
    expect(beta).toContain('16.2 µV');
    expect(beta).toContain('Out of zone now');
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
    // Every new session is self-guided, whatever relationship fields the profile still stores.
    expect(saved.sessions[0]).toMatchObject({
      patientId: client.id,
      clinicId: 'self-guided',
      isDemo: true,
    });
    expect(saved.sessions[0]).not.toHaveProperty('clinicianId');
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

  it('includes the final Demo clock tick in the saved verified time and reaches 150 XP', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval });
    const onComplete = vi.fn(async (_session: SessionRecord) => undefined);
    const profile = { ...client, customProtocolConfig: {
      ...getClinicalProtocolTemplate('alpha-enhancement')!, sessionDurationMinutes: 1,
    } };
    let runner!: ReactTestRenderer;
    await act(async () => { runner = create(<SessionRunner client={profile} selectedExperience="neuro-gambit" onComplete={onComplete} onCancel={vi.fn()} />); });
    await act(async () => { button(runner, 'Try Demo Mode').props.onClick(); });
    await act(async () => {
      stream.callback?.({
        timestamp: Date.now(), rawSignal: 0,
        bands: { delta: 1, theta: 2, alpha: 3, smr: 4, beta: 5, gamma: 6 },
        bandAvailability: { delta: true, theta: true, alpha: true, smr: true, beta: true, gamma: true },
        bandRatios: {}, thetaBetaRatio: 0.5, thetaBetaRatioAvailable: true,
        coherence: null, coherenceAvailable: false, inZone: true, inZoneAvailable: true, zoneScore: 1,
        signalQuality: 'good', channelQuality: { tp9: 'good', af7: 'good', af8: 'good', tp10: 'good' },
        artifacts: { blink: false, clench: false },
      });
      vi.advanceTimersByTime(59_000);
    });
    expect(onComplete).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1_000); });
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete.mock.calls[0][0]).toMatchObject({
      durationSeconds: 60, configuredDurationSeconds: 60, inZoneSeconds: 60, timeInZonePercent: 100, isDemo: true,
    });
    await act(async () => { runner.unmount(); });
  });

  it('shows retry after automatic hardware completion even if the headset disconnects', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval });
    engine.isHardwareConnected = true;
    engine.getBandPowerProvenance.mockReturnValue({ algorithm: 'welch-psd', version: 'test', source: 'brainflow' });
    const attempts: SessionRecord[] = [];
    const onComplete = vi.fn(async (session: SessionRecord) => {
      attempts.push(session);
      if (attempts.length === 1) throw new Error('ambiguous response');
    });
    const profile = { ...client, customProtocolConfig: {
      ...getClinicalProtocolTemplate('alpha-enhancement')!, sessionDurationMinutes: 1,
    } };
    let runner!: ReactTestRenderer;
    await act(async () => { runner = create(<SessionRunner client={profile} selectedExperience="neuro-gambit" onComplete={onComplete} onCancel={vi.fn()} />); });
    await act(async () => { runner.root.find((node) => (node.type as unknown) === 'headset-fit').props.onConfirmReady(); });
    await act(async () => { button(runner, 'Begin Training').props.onClick(); });
    for (let second = 0; second < 60; second++) {
      await act(async () => {
        stream.sourceState = { sequence: second + 1, lastFrameAtMs: Date.now() };
        stream.callback?.({
          timestamp: Date.now(), rawSignal: 1,
          bands: { delta: 1, theta: 2, alpha: 3, smr: 4, beta: 5, gamma: 6 },
          bandAvailability: { delta: true, theta: true, alpha: true, smr: true, beta: true, gamma: true },
          bandRatios: {}, thetaBetaRatio: 0.5, thetaBetaRatioAvailable: true,
          coherence: 40, coherenceAvailable: true, inZone: true, inZoneAvailable: true, zoneScore: 1,
          signalQuality: 'good', channelQuality: { tp9: 'good', af7: 'good', af8: 'good', tp10: 'good' },
          artifacts: { blink: false, clench: false }, trainingMetric: { score: 70, baselineReady: true },
        });
        vi.advanceTimersByTime(1_000);
      });
    }
    expect(onComplete).toHaveBeenCalledOnce();
    expect(button(runner, 'Save & View Summary').props.disabled).toBe(false);
    expect(text(runner)).toContain("We couldn't confirm this session was saved");
    engine.isHardwareConnected = false;
    await act(async () => { runner.update(<SessionRunner client={profile} selectedExperience="neuro-gambit" onComplete={onComplete} onCancel={vi.fn()} />); });
    expect(button(runner, 'Save & View Summary').props.disabled).toBe(false);
    expect(text(runner)).not.toContain('Connect Muse Headband');
    await act(async () => { await button(runner, 'Save & View Summary').props.onClick(); });
    expect(attempts[1]).toBe(attempts[0]);
    expect(attempts[1]).toMatchObject({ durationSeconds: 60, inZoneSeconds: 60, configuredDurationSeconds: 60 });
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
    engine.getBandPowerProvenance.mockReturnValue({ algorithm: 'welch-psd', version: 'test', source: 'brainflow' });
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
      stream.callback?.({
        timestamp: Date.now(), rawSignal: 1,
        bands: { delta: 1, theta: 2, alpha: 3, smr: 4, beta: 5, gamma: 6 },
        bandAvailability: { delta: true, theta: true, alpha: true, smr: true, beta: true, gamma: true },
        bandRatios: {}, thetaBetaRatio: 0.4, thetaBetaRatioAvailable: true,
        coherence: 40, coherenceAvailable: true, inZone: true, inZoneAvailable: true, zoneScore: 1,
        signalQuality: 'good', channelQuality: { tp9: 'good', af7: 'good', af8: 'good', tp10: 'good' },
        artifacts: { blink: false, clench: false }, trainingMetric: { score: 70, baselineReady: true },
      });
      vi.advanceTimersByTime(1_000);
    });
    await act(async () => { vi.advanceTimersByTime(1_000); });
    expect(text(renderer)).toContain('Verified EEG is unavailable. Training is paused');
    expect(button(renderer, 'Resume')).toBeTruthy();

    await act(async () => { vi.advanceTimersByTime(2_001); });
    await act(async () => { button(renderer, 'End Session & Save').props.onClick(); });
    await act(async () => { await button(renderer, 'Save & View Summary').props.onClick(); });
    expect(text(renderer)).toContain('Live EEG data has stopped');
    expect(onComplete).not.toHaveBeenCalled();
    await act(async () => { renderer.unmount(); });
  });

  it('freezes Demo time and XP and retries the identical session after an ambiguous save response', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval });
    const attempts: SessionRecord[] = [];
    const onComplete = vi.fn(async (session: SessionRecord) => {
      attempts.push(session);
      if (attempts.length === 1) throw new Error('ambiguous response');
    });
    const profile = { ...client, customProtocolConfig: {
      ...getClinicalProtocolTemplate('alpha-enhancement')!, sessionDurationMinutes: 1,
    } };
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<SessionRunner client={profile} selectedExperience="neuro-gambit" onComplete={onComplete} onCancel={vi.fn()} />);
    });
    await act(async () => { button(renderer, 'Try Demo Mode').props.onClick(); });
    await act(async () => {
      stream.callback?.({
        timestamp: Date.now(), rawSignal: 0,
        bands: { delta: 1, theta: 2, alpha: 3, smr: 4, beta: 5, gamma: 6 },
        bandAvailability: { delta: true, theta: true, alpha: true, smr: true, beta: true, gamma: true },
        bandRatios: {}, thetaBetaRatio: 0.5, thetaBetaRatioAvailable: true,
        coherence: null, coherenceAvailable: false, inZone: true, inZoneAvailable: true, zoneScore: 1,
        signalQuality: 'good', channelQuality: { tp9: 'good', af7: 'good', af8: 'good', tp10: 'good' },
        artifacts: { blink: false, clench: false },
      });
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
    expect(attempts[1]).toMatchObject({ durationSeconds: 30, inZoneSeconds: 30, configuredDurationSeconds: 60 });
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
