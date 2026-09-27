import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import type { ClientProfile, SessionRecord } from '../../../types';

const memory = vi.hoisted(() => ({ client: null as ClientProfile | null, sessions: [] as SessionRecord[] }));
const authState = vi.hoisted(() => ({ currentUser: { uid: 'patient-1' } }));
const stream = vi.hoisted(() => ({ callback: null as null | ((frame: unknown) => void), sequence: 0, lastFrameAtMs: 0 }));
const engine = vi.hoisted(() => ({
  isHardwareConnected: true, isDemoMode: false, demoState: 'auto', deviceName: 'Mock source',
  configureProtocol: vi.fn(), start: vi.fn(), stop: vi.fn(),
  subscribe: vi.fn((callback: (frame: unknown) => void) => { stream.callback = callback; return vi.fn(); }),
  getBandPowerProvenance: vi.fn(() => ({ algorithm: 'welch-psd', version: 'test', source: 'brainflow' })),
  getHardwareSourceState: vi.fn(() => ({ sequence: stream.sequence, lastFrameAtMs: stream.lastFrameAtMs })),
  setThreshold: vi.fn(), setSimulatedState: vi.fn(), connectMuseBluetooth: vi.fn(),
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
vi.mock('../../../services/audioEngine', () => ({ audioEngine: { playChime: vi.fn(), stopAll: vi.fn(), setMuted: vi.fn() } }));
vi.mock('../../experiences/TidalGardenCanvas', () => ({ TidalGardenCanvas: 'experience-view' }));
vi.mock('../HeadsetFitModal', () => ({ HeadsetFitModal: 'headset-fit' }));

import { createBlankProfile, storageEngine } from '../../../services/storageEngine';
import { SessionRunner } from '../SessionRunner';
import { getClinicalProtocolTemplate } from '../../../services/clinicalProtocolTemplates';

const snapshot = () => ({ id: 'patient-1', exists: () => memory.client != null, data: () => structuredClone(memory.client) });
const button = (view: ReactTestRenderer, label: string) => {
  const match = view.root.findAllByType('button').find((candidate) =>
    candidate.findAll((node) => node.children.some((child) => typeof child === 'string' && child.includes(label))).length > 0);
  if (!match) throw new Error(`Missing button ${label}`);
  return match;
};
const frame = () => ({
  timestamp: Date.now(), rawSignal: 1,
  bands: { delta: 1, theta: 2, alpha: 3, smr: 4, beta: 5, gamma: 6 },
  bandAvailability: { delta: true, theta: true, alpha: true, smr: true, beta: true, gamma: true },
  bandRatios: {}, thetaBetaRatio: 0.4, thetaBetaRatioAvailable: true,
  coherence: 40, coherenceAvailable: true, inZone: true, inZoneAvailable: true, zoneScore: 1,
  signalQuality: 'good', channelQuality: { tp9: 'good', af7: 'good', af8: 'good', tp10: 'good' },
  artifacts: { blink: false, clench: false }, trainingMetric: { score: 70, baselineReady: true },
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('opens a legacy garden, completes verified non-Demo training through the real transaction path, and reloads growth once', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  memory.client = { ...createBlankProfile('patient-1', 'patient@example.test'),
    name: 'Patient One', assignedProtocol: 'alpha-enhancement', notes: 'concurrent care note',
    customProtocolConfig: { ...getClinicalProtocolTemplate('alpha-enhancement')!, sessionDurationMinutes: 1 },
    tidalGardenState: undefined } as ClientProfile;
  memory.sessions = [];
  firestore.runTransaction.mockImplementation(async (_db: unknown, callback: (tx: unknown) => unknown) => callback({
    get: async () => snapshot(),
    update: (_ref: unknown, payload: Partial<ClientProfile>) => { Object.assign(memory.client!, payload); },
    set: (ref: { path: string }, payload: Record<string, unknown>) => {
      if (ref.path === 'sessions') memory.sessions.push(payload as unknown as SessionRecord);
      else Object.assign(memory.client!, payload);
    },
  }));
  firestore.getDoc.mockImplementation(async () => snapshot());
  const newProfile = createBlankProfile('new-patient', 'new@example.test');
  expect(newProfile.tidalGardenState).toMatchObject({ stage: 1, growthPoints: 0 });
  const opened = await storageEngine.ensureTidalGardenState('patient-1');
  expect(opened.tidalGardenState).toMatchObject({ stage: 1, growthPoints: 0 });
  expect(memory.client?.notes).toBe('concurrent care note');
  const persisted: { client: ClientProfile | null } = { client: null };
  let view!: ReactTestRenderer;
  await act(async () => { view = create(<SessionRunner client={opened} selectedExperience="tidal-garden"
    onComplete={async (session) => { await storageEngine.createSession(session); persisted.client = await storageEngine.getClient('patient-1'); }}
    onCancel={vi.fn()} />); });
  await act(async () => { view.root.find((node) => (node.type as unknown) === 'headset-fit').props.onConfirmReady(); });
  await act(async () => { button(view, 'Begin Training').props.onClick(); });
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      stream.sequence++;
      stream.lastFrameAtMs = Date.now();
      stream.callback?.(frame());
      vi.advanceTimersByTime(1000);
    });
  }
  const canvas = view.root.find((node) => (node.type as unknown) === 'experience-view');
  expect(canvas.props.growthPoints).toBe(150);
  await act(async () => { button(view, 'End Session & Save').props.onClick(); });
  await act(async () => { await button(view, 'Yes, Save Progress').props.onClick(); });
  expect(memory.sessions).toHaveLength(1);
  expect(memory.sessions[0]).toMatchObject({ patientId: 'patient-1', isDemo: false, experience: 'tidal-garden', timeInZonePercent: 100 });
  expect(persisted.client?.tidalGardenState).toMatchObject({ stage: 1, growthPoints: 150 });
  expect(memory.client?.notes).toBe('concurrent care note');
  expect(await storageEngine.createSession(memory.sessions[0])).toMatchObject({ created: false });
  expect((await storageEngine.getClient('patient-1'))?.tidalGardenState?.growthPoints).toBe(150);
  await act(async () => { view.unmount(); });
});
