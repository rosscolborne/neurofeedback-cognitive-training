import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, type Auth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  initializeFirestore,
  memoryLocalCache,
  memoryLruGarbageCollector,
  setDoc,
  Timestamp,
  writeBatch,
  type DocumentData,
  type Firestore,
} from 'firebase/firestore';
import { z } from 'zod';
import { defineGame, type LevelDefinition } from '@nfct/shared';
import type { ConsumerFirestoreContext } from '../../src/consumer/firestore/context';
import { createEegRecordingRepository } from '../../src/consumer/repositories/eegRecordingRepository';
import { createGameSessionRepository, type GameSessionDraft } from '../../src/consumer/repositories/gameSessionRepository';
import { createProfileRepository, type UserProfileDraft } from '../../src/consumer/repositories/profileRepository';
import { createProgressRepository } from '../../src/consumer/repositories/progressRepository';
import type { EegRecordingDraft } from '../../src/consumer/repositories/eegRecordingRepository';

/**
 * Repository tests run the real consumer repositories against the local Auth
 * and Firestore emulators, with the real firestore.rules loaded, so the
 * repositories and the rules are checked together. Nothing here can reach a
 * real Firebase project: the project is a demo- project and the emulator hosts
 * must be set (`npm run test:repositories` sets them).
 */
export const projectId = 'demo-nfct-repositories';

const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const isLoopback = (host: string | undefined) => /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host ?? '');
if (!isLoopback(firestoreHost) || !isLoopback(authHost) || process.env.GCLOUD_PROJECT !== projectId) {
  throw new Error('Repository tests require the local Auth and Firestore emulators for demo-nfct-repositories (npm run test:repositories).');
}

let testEnvironment: RulesTestEnvironment | undefined;

export async function environment(): Promise<RulesTestEnvironment> {
  testEnvironment ??= await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync(resolve('firestore.rules'), 'utf8') },
  });
  return testEnvironment;
}

const devices: FirebaseApp[] = [];

/**
 * One app install: its own Firebase app, Auth and Firestore. Node has no
 * IndexedDB, so the cache is in memory, with LRU garbage collection so that,
 * like the app's persistent cache, documents stay cached after a read.
 */
export interface Device {
  readonly app: FirebaseApp;
  readonly auth: Auth;
  readonly firestore: Firestore;
  readonly context: ConsumerFirestoreContext;
  readonly profiles: ReturnType<typeof createProfileRepository>;
  readonly sessions: ReturnType<typeof createGameSessionRepository>;
  readonly eeg: ReturnType<typeof createEegRecordingRepository>;
  readonly progress: ReturnType<typeof createProgressRepository>;
}

export interface Player {
  readonly uid: string;
  readonly email: string;
  readonly password: string;
}

export function newDevice(): Device {
  const app = initializeApp({ projectId, apiKey: 'demo-key', authDomain: `${projectId}.firebaseapp.com` }, `device-${randomUUID()}`);
  devices.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
  const firestore = initializeFirestore(app, { localCache: memoryLocalCache({ garbageCollector: memoryLruGarbageCollector() }) });
  const [host, port] = firestoreHost!.split(':');
  connectFirestoreEmulator(firestore, host!, Number(port));
  const context: ConsumerFirestoreContext = { firestore, auth };
  const eeg = createEegRecordingRepository(context);
  return {
    app, auth, firestore, context, eeg,
    profiles: createProfileRepository(context),
    sessions: createGameSessionRepository(context, eeg),
    progress: createProgressRepository(context),
  };
}

/** Signs a new emulator user up on a new device. */
export async function signedInDevice(label = 'player'): Promise<Device & { player: Player }> {
  const device = newDevice();
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = 'Emulator!123';
  const credential = await createUserWithEmailAndPassword(device.auth, email, password);
  return { ...device, player: { uid: credential.user.uid, email, password } };
}

export async function resetEmulators(): Promise<void> {
  await (await environment()).clearFirestore();
}

export async function closeDevices(): Promise<void> {
  await Promise.all(devices.splice(0).map((app) => deleteApp(app)));
}

export async function closeEnvironment(): Promise<void> {
  await closeDevices();
  await testEnvironment?.cleanup();
  testEnvironment = undefined;
}

/** Trusted code (the Admin SDK in production): reads and writes with the rules bypassed. */
export async function asServer<T>(work: (firestore: Firestore) => Promise<T>): Promise<T> {
  let result: T | undefined;
  await (await environment()).withSecurityRulesDisabled(async (context) => {
    result = await work(context.firestore() as unknown as Firestore);
  });
  return result as T;
}

export async function serverRead(path: string): Promise<DocumentData | undefined> {
  return asServer(async (firestore) => (await getDoc(doc(firestore, path))).data());
}

/** A stored timestamp field, failing clearly if it is missing or not a Firestore Timestamp. */
export function timestampAt(data: DocumentData | undefined, field: string): Timestamp {
  const value = data?.[field];
  if (!(value instanceof Timestamp)) throw new Error(`Expected ${field} to be a Firestore Timestamp, got ${String(value)}`);
  return value;
}

export async function serverWrite(documents: Record<string, DocumentData>): Promise<void> {
  await asServer(async (firestore) => {
    const batch = writeBatch(firestore);
    for (const [path, data] of Object.entries(documents)) batch.set(doc(firestore, path), data);
    await batch.commit();
  });
}

/** A write from a signed-in client that bypasses the repositories, to show what the rules refuse. */
export async function rawClientWrite(device: Device, path: string, data: DocumentData): Promise<void> {
  await setDoc(doc(device.firestore, path), data);
}

export async function expectDenied(write: Promise<unknown>): Promise<void> {
  const error = await write.then(() => null, (reason: unknown) => reason);
  if (!error) throw new Error('Expected the rules to refuse the write, but it succeeded.');
  const code = (error as { code?: unknown }).code;
  if (code !== 'permission-denied') throw error;
}

// ---- Test game ----
// A test double with Mental Math's catalogue identity (the rules allow only
// supported games) and the Stage 1 trial shape. Replaced by the real
// shared/games/mental-math definition once NFCT-17 lands.

function levels(count: number): LevelDefinition[] {
  return Array.from({ length: count }, (_, index) => ({ level: index + 1, label: `Level ${index + 1}`, params: {} }));
}

const testTrialSchema = z.strictObject({
  level: z.int().min(1).max(10),
  operands: z.array(z.int().min(1)).min(2).max(3),
  operators: z.array(z.enum(['+', '-', '×', '÷'])).min(1).max(2),
  grouped: z.boolean(),
  expected: z.int().min(1),
  response: z.int().min(0).nullable(),
  correct: z.boolean(),
  timedOut: z.boolean(),
  shownAtMs: z.int().min(0),
  rtMs: z.int().min(0),
  timeLimitMs: z.int().min(1),
});
export type TestTrial = z.infer<typeof testTrialSchema>;

const testMetricsSchema = z.strictObject({
  correct: z.int().min(0),
  attempted: z.int().min(0),
  timedOut: z.int().min(0),
});
export type TestMetrics = z.infer<typeof testMetricsSchema>;

export const testGame = defineGame<TestTrial, TestMetrics>({
  id: 'mental-math',
  gameVersion: 1,
  scoringVersion: 1,
  domainWeights: { math: 0.7, 'processing-speed': 0.2, memory: 0.1 },
  modes: [{
    id: 'timed-90',
    adaptive: true,
    initiallyUnlockedStartLevel: 1,
    levels: levels(10),
    unlockPolicy: ({ bestPeakLevel }) => (bestPeakLevel >= 10 ? 10 : bestPeakLevel - 1),
  }],
  trialSchema: testTrialSchema,
  metricsSchema: testMetricsSchema,
  limits: { maxTrials: 400, minActiveMs: 0, maxActiveMs: 3_600_000, minPlausibleRtMs: 250 },
  score(trials, { startLevel }) {
    const correct = trials.filter((trial) => trial.correct).length;
    return {
      score: correct * 50,
      accuracy: trials.length === 0 ? null : correct / trials.length,
      responseTime: null,
      peakLevel: Math.max(startLevel, ...trials.map((trial) => trial.level)),
      metrics: { correct, attempted: trials.length, timedOut: trials.filter((trial) => trial.timedOut).length },
    };
  },
  recordKey: ({ modeId, startLevel }) => `${modeId}:${startLevel}`,
  recordMetrics: ['score', 'correct', 'peakLevel'],
});

// ---- Builders ----

export function minutesAgo(minutes: number): Timestamp {
  return Timestamp.fromMillis(Date.now() - minutes * 60_000);
}

function trial(index: number): TestTrial {
  return {
    level: 1, operands: [2, 3], operators: ['+'], grouped: false, expected: 5, response: 5,
    correct: true, timedOut: false, shownAtMs: index * 2_000, rtMs: 1_200, timeLimitMs: 8_000,
  };
}

/** A finished Mental Math session as the game produces it, ended `endedMinutesAgo` minutes ago. */
export function sessionDraft(
  overrides: Partial<GameSessionDraft<TestTrial, TestMetrics>> = {},
  endedMinutesAgo = 1,
): GameSessionDraft<TestTrial, TestMetrics> {
  return {
    gameId: 'mental-math',
    gameVersion: 1,
    modeId: 'timed-90',
    startLevel: 1,
    peakLevel: 2,
    status: 'completed',
    startedAt: minutesAgo(endedMinutesAgo + 2),
    endedAt: minutesAgo(endedMinutesAgo),
    activeDurationMs: 90_000,
    localDate: '2026-09-30',
    timezone: 'America/Toronto',
    client: { appVersion: '0.1.0', platform: 'web' },
    trials: [trial(0), trial(1), trial(2)],
    summary: {
      score: 150,
      accuracy: 1,
      trialsTotal: 3,
      trialsCorrect: 3,
      responseTime: { medianMs: 1_200, meanMs: 1_200, p90Ms: 1_200 },
      metrics: { correct: 3, attempted: 3, timedOut: 0 },
    },
    ...overrides,
  };
}

const distribution = { mean: 0.5, median: 0.5, p10: 0.2, p90: 0.8, n: 9 };

export function eegDraft(overrides: Partial<EegRecordingDraft> = {}): EegRecordingDraft {
  return {
    source: 'simulated',
    startedAt: minutesAgo(3),
    endedAt: minutesAgo(1),
    device: {
      model: 'muse-2',
      firmwareVersion: '1.2.13',
      transport: 'web-bluetooth',
      channels: ['TP9', 'AF7', 'AF8', 'TP10'],
      sampleRateHz: 256,
    },
    processing: { service: 'brainflow-service', serviceVersion: '1.4.0', featureVersion: 1, windowSeconds: 4 },
    calibration: { status: 'complete', windowsCollected: 10, windowsRequired: 10 },
    quality: {
      windowsTotal: 20,
      windowsUsable: 18,
      usableFraction: 0.9,
      channelGoodFraction: { TP9: 0.9, AF7: 0.95, AF8: 0.92, TP10: 0.88 },
      artifactFraction: 0.1,
    },
    summary: {
      mindfulness: distribution,
      restfulness: distribution,
      relativeBandPower: { delta: 0.3, theta: 0.2, alpha: 0.25, beta: 0.2, gamma: 0.05 },
    },
    timeline: { bucketSeconds: 10, mindfulness: [0.4, null, 0.6], restfulness: [0.5, 0.5, null] },
    ...overrides,
  };
}

export function profileDraft(overrides: Partial<UserProfileDraft> = {}): UserProfileDraft {
  return {
    displayName: 'Player',
    avatar: { kind: 'preset', presetId: 'fox' },
    preferences: { timezone: 'America/Toronto', soundEnabled: true, hapticsEnabled: false, weeklyGoal: null },
    onboarding: { version: 1 },
    eeg: { enabled: false, preferredDevice: null },
    ...overrides,
  };
}

/** The accepted placeholder consent version in firestore.rules until NFCT-25/NFCT-27 approve the copy. */
export const acceptedConsentVersion = 'placeholder-1';

/** Creates the player's profile and waits for the server; optionally records EEG consent. */
export async function withProfile(device: Device, { eegConsent = false } = {}): Promise<void> {
  await device.profiles.createProfile(profileDraft()).acknowledged;
  if (eegConsent) await device.profiles.grantEegConsent(acceptedConsentVersion).acknowledged;
}

/** A valid trusted result, as NFCT-19's scoring writes it. */
export function trustedResult(processedAt: Timestamp = Timestamp.now()) {
  return {
    processedAt, scoringVersion: 1, validity: 'valid', reasons: [],
    score: 150, accuracy: 1, responseTime: null, peakLevel: 2, metrics: { correct: 3, attempted: 3, timedOut: 0 },
    performanceIndex: null, performanceIndexVersion: null, domainContributions: { math: 0.7, 'processing-speed': 0.2, memory: 0.1 },
    recordKey: 'timed-90:1', recordValues: { score: 150 }, personalBest: true,
    unlocked: [{ modeId: 'timed-90', startLevel: 2 }] as { modeId: string; startLevel: number }[],
  };
}

/** Progress as trusted scoring maintains it. */
export function trustedProgress(sessionId: string, sessionsCompleted: number, at: Timestamp = Timestamp.now()) {
  return {
    schemaVersion: 1, aggregateVersion: 1, updatedAt: at, gameId: 'mental-math', gameVersion: 1,
    sessionsCompleted, activeMs: sessionsCompleted * 90_000, lastPlayedAt: at,
    bestPeakLevel: { 'timed-90': 2 }, unlocked: { 'timed-90': 1 },
    bests: { 'timed-90:1': { score: { value: 150, sessionId, achievedAt: at } } },
    bestsArchive: {},
  };
}

/** Resolves after pending microtasks and a macrotask turn, so SDK listeners can deliver. */
export async function settle(ms = 50): Promise<void> {
  await new Promise((resolveTimer) => setTimeout(resolveTimer, ms));
}

/** Polls until `check` passes or the timeout elapses. */
export async function eventually(check: () => void | Promise<void>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await check();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await settle(50);
    }
  }
}
