import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import type { ClientProfile, SessionRecord } from '../../../types';

const memory = vi.hoisted(() => ({ client: null as ClientProfile | null, sessions: [] as SessionRecord[] }));
const authState = vi.hoisted(() => ({ currentUser: { uid: 'patient-1' } }));
const stream = vi.hoisted(() => ({ callback: null as null | ((frame: unknown) => void), sequence: 0, lastFrameAtMs: 0 }));
const engine = vi.hoisted(() => ({
  isHardwareConnected: true, isDemoMode: false, demoState: 'auto', deviceName: 'Mock source',
  start: vi.fn(), stop: vi.fn(),
  subscribe: vi.fn((callback: (frame: unknown) => void) => { stream.callback = callback; return vi.fn(); }),
  getHardwareSourceState: vi.fn(() => ({ sequence: stream.sequence, lastFrameAtMs: stream.lastFrameAtMs })),
  setSimulatedState: vi.fn(), connectMuseBluetooth: vi.fn(),
}));
const firestore = vi.hoisted(() => ({
  runTransaction: vi.fn(), getDoc: vi.fn(), getDocs: vi.fn(), setDoc: vi.fn(), updateDoc: vi.fn(),
  deleteDoc: vi.fn(), deleteField: vi.fn(), onSnapshot: vi.fn(() => vi.fn()),
  serverTimestamp: vi.fn(() => ({ __serverTimestamp: true })), writeBatch: vi.fn(),
}));
vi.mock('../../../services/firebase', () => ({ auth: authState, db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ type: 'collection', path: segments.join('/') }),
  doc: (_db: unknown, ...segments: string[]) => ({ type: 'doc', path: segments.slice(0, -1).join('/'), id: segments.at(-1) }),
  where: vi.fn(), query: vi.fn(), Timestamp: { fromDate: (date: Date) => date }, ...firestore,
}));
vi.mock('../../../services/eegEngine', () => ({ eegEngine: engine }));
vi.mock('../../../services/audioEngine', () => ({ audioEngine: { playChime: vi.fn(), setMuted: vi.fn() } }));
vi.mock('../../experiences/NeuroGambitExperience', () => ({ NeuroGambitExperience: 'experience-view' }));
vi.mock('../HeadsetFitModal', () => ({ HeadsetFitModal: 'headset-fit' }));

import { createBlankProfile, storageEngine } from '../../../services/storageEngine';
import { SessionRunner } from '../SessionRunner';
import { NEUROGAMBIT_SESSION_SECONDS } from '../../../services/trainingSession';

const snapshot = () => ({ id: 'patient-1', exists: () => memory.client != null, data: () => structuredClone(memory.client) });
const button = (view: ReactTestRenderer, label: string) => {
  const match = view.root.findAllByType('button').find((candidate) =>
    candidate.findAll((node) => node.children.some((child) => typeof child === 'string' && child.includes(label))).length > 0);
  if (!match) throw new Error(`Missing button ${label}`);
  return match;
};
/** A measured frame: fit plus BrainFlow's mindfulness and restfulness. */
const frame = (mindfulnessScore = 60) => ({
  timestamp: Date.now(),
  signalQuality: 'good', channelQuality: { tp9: 'good', af7: 'good', af8: 'good', tp10: 'good' },
  brainflowScores: { mindfulnessScore, restfulnessScore: 50, method: 'brainflow' },
});
const garden = { stage: 2, growthPoints: 420, plantsUnlocked: ['kelp'], lastWatered: 'yesterday' };

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('saves a measured headset session through the real transaction path once, with mindfulness and no EEG-driven growth', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  memory.client = { ...createBlankProfile('patient-1', 'patient@example.test'),
    name: 'Patient One', assignedProtocol: 'alpha-enhancement', notes: 'concurrent care note',
    tidalGardenState: { ...garden } } as ClientProfile;
  memory.sessions = [];
  engine.isHardwareConnected = true;
  stream.sequence = 0;
  stream.lastFrameAtMs = 0;
  firestore.runTransaction.mockImplementation(async (_db: unknown, callback: (tx: unknown) => unknown) => callback({
    get: async () => snapshot(),
    update: (_ref: unknown, payload: Partial<ClientProfile>) => { Object.assign(memory.client!, payload); },
    set: (ref: { path: string }, payload: Record<string, unknown>) => {
      if (ref.path === 'sessions') memory.sessions.push(payload as unknown as SessionRecord);
      else Object.assign(memory.client!, payload);
    },
  }));
  firestore.getDoc.mockImplementation(async () => snapshot());
  const persisted: { client: ClientProfile | null } = { client: null };
  let view!: ReactTestRenderer;
  await act(async () => { view = create(<SessionRunner client={memory.client!} selectedExperience="neuro-gambit"
    onComplete={async (session) => { await storageEngine.createSession(session); persisted.client = await storageEngine.getClient('patient-1'); }}
    onCancel={vi.fn()} />); });
  await act(async () => { view.root.find((node) => (node.type as unknown) === 'headset-fit').props.onConfirmReady(); });
  await act(async () => { button(view, 'Begin Training').props.onClick(); });
  for (const score of [50, 60, 70, 80, 90]) {
    await act(async () => {
      stream.sequence++;
      stream.lastFrameAtMs = Date.now();
      stream.callback?.(frame(score));
      vi.advanceTimersByTime(1000);
    });
  }
  await act(async () => { button(view, 'End Session & Save').props.onClick(); });
  await act(async () => { await button(view, 'Save & View Summary').props.onClick(); });
  expect(memory.sessions).toHaveLength(1);
  expect(memory.sessions[0]).toMatchObject({ patientId: 'patient-1', isDemo: false, experience: 'neuro-gambit',
    durationSeconds: 5, configuredDurationSeconds: NEUROGAMBIT_SESSION_SECONDS, averageMindfulness: 70 });
  for (const legacyField of ['protocol', 'timeInZonePercent', 'inZoneSeconds', 'averageBands', 'averageCoherence', 'timeSeries', 'finalThreshold', 'adaptiveAdjustmentsCount']) {
    expect(memory.sessions[0]).not.toHaveProperty(legacyField);
  }
  expect(persisted.client).toMatchObject({ completedSessionsCount: 1, badges: ['first-light'], tidalGardenState: garden });
  expect(memory.client?.notes).toBe('concurrent care note');
  expect(await storageEngine.createSession(memory.sessions[0])).toMatchObject({ created: false });
  expect((await storageEngine.getClient('patient-1'))?.completedSessionsCount).toBe(1);
  await act(async () => { view.unmount(); });
});

it('ends a full session on its last tick, ignores later frames, and counts a replayed save once', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  memory.client = { ...createBlankProfile('patient-1', 'patient@example.test'), tidalGardenState: { ...garden } };
  memory.sessions = [];
  engine.isHardwareConnected = true;
  stream.sequence = 0;
  stream.lastFrameAtMs = 0;
  firestore.runTransaction.mockImplementation(async (_db: unknown, callback: (tx: unknown) => unknown) => callback({
    get: async () => snapshot(),
    set: (ref: { path: string }, payload: Record<string, unknown>) => {
      if (ref.path === 'sessions') memory.sessions.push(payload as unknown as SessionRecord);
      else memory.client = { ...memory.client!, ...payload } as ClientProfile;
    },
  }));
  firestore.getDoc.mockImplementation(async () => snapshot());

  let view!: ReactTestRenderer;
  await act(async () => { view = create(<SessionRunner client={memory.client!} selectedExperience="neuro-gambit"
    onComplete={async (session) => { await storageEngine.createSession(session); }} onCancel={vi.fn()} />); });
  await act(async () => { view.root.find((node) => (node.type as unknown) === 'headset-fit').props.onConfirmReady(); });
  await act(async () => { button(view, 'Begin Training').props.onClick(); });
  for (let second = 0; second < NEUROGAMBIT_SESSION_SECONDS; second++) {
    await act(async () => {
      stream.sequence++;
      stream.lastFrameAtMs = Date.now();
      stream.callback?.(frame());
      vi.advanceTimersByTime(1_000);
    });
  }
  expect(memory.sessions).toHaveLength(1);
  expect(memory.sessions[0]).toMatchObject({ patientId: 'patient-1', isDemo: false,
    durationSeconds: NEUROGAMBIT_SESSION_SECONDS, configuredDurationSeconds: NEUROGAMBIT_SESSION_SECONDS, averageMindfulness: 60 });
  expect(memory.client?.completedSessionsCount).toBe(1);

  // Valid fresh hardware frames after completion cannot extend the session.
  for (let second = 0; second < 15; second++) {
    await act(async () => {
      stream.sequence++;
      stream.lastFrameAtMs = Date.now();
      stream.callback?.(frame(95));
      vi.advanceTimersByTime(1_000);
    });
  }
  expect(memory.sessions[0]).toMatchObject({ durationSeconds: NEUROGAMBIT_SESSION_SECONDS, averageMindfulness: 60 });

  // Replaying the same ID cannot count it twice.
  await expect(storageEngine.createSession({ ...memory.sessions[0], durationSeconds: NEUROGAMBIT_SESSION_SECONDS + 15 }))
    .resolves.toMatchObject({ created: false });
  expect(memory.sessions).toHaveLength(1);
  const reloaded = await storageEngine.getClient('patient-1');
  expect(reloaded).toMatchObject({ completedSessionsCount: 1, tidalGardenState: garden });
  await act(async () => { view.unmount(); });
});

it('averages mindfulness only from the session itself, not the fit check or briefing before Begin Training', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  engine.isHardwareConnected = true;
  stream.sequence = 0;
  stream.lastFrameAtMs = 0;
  const onComplete = vi.fn(async (_session: SessionRecord) => undefined);
  let view!: ReactTestRenderer;
  await act(async () => { view = create(<SessionRunner client={createBlankProfile('patient-1', 'patient@example.test')} selectedExperience="neuro-gambit"
    onComplete={onComplete} onCancel={vi.fn()} />); });
  await act(async () => { view.root.find((node) => (node.type as unknown) === 'headset-fit').props.onConfirmReady(); });
  // Fit accepted, briefing still open: these frames are not session time.
  for (let frameIndex = 0; frameIndex < 20; frameIndex++) {
    await act(async () => {
      stream.sequence++;
      stream.lastFrameAtMs = Date.now();
      stream.callback?.(frame(10));
    });
  }
  await act(async () => { button(view, 'Begin Training').props.onClick(); });
  for (let second = 0; second < 5; second++) {
    await act(async () => {
      stream.sequence++;
      stream.lastFrameAtMs = Date.now();
      stream.callback?.(frame(90));
      vi.advanceTimersByTime(1_000);
    });
  }
  await act(async () => { button(view, 'End Session & Save').props.onClick(); });
  await act(async () => { await button(view, 'Save & View Summary').props.onClick(); });
  expect(onComplete).toHaveBeenCalledOnce();
  expect(onComplete.mock.calls[0][0]).toMatchObject({ durationSeconds: 5, averageMindfulness: 90 });
  await act(async () => { view.unmount(); });
});
