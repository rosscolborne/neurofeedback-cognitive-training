import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type AddressInfo, type Socket } from 'node:net';
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
import { mentalMath } from '@nfct/shared';
import type { ConsumerFirestoreContext } from '../../src/consumer/firestore/context';
import { createEegRecordingRepository } from '../../src/consumer/repositories/eegRecordingRepository';
import {
  createGameSessionRepository,
  type GameSessionDraft,
  type GameSessionRepositoryOptions,
} from '../../src/consumer/repositories/gameSessionRepository';
import { createProfileRepository, type UserProfileDraft } from '../../src/consumer/repositories/profileRepository';
import { createProgressRepository } from '../../src/consumer/repositories/progressRepository';
import type {
  EegRecordingDraft,
  EegRecordingRepositoryOptions,
  EegRecordingSave,
  EegRecordingServerOutcome,
} from '../../src/consumer/repositories/eegRecordingRepository';

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

export interface DeviceOptions {
  /** Connect Firestore here instead of the emulator (for example a stalled endpoint). */
  readonly firestoreHost?: string;
  readonly eegOptions?: EegRecordingRepositoryOptions;
  readonly sessionOptions?: GameSessionRepositoryOptions;
}

export function newDevice(options: DeviceOptions = {}): Device {
  const app = initializeApp({ projectId, apiKey: 'demo-key', authDomain: `${projectId}.firebaseapp.com` }, `device-${randomUUID()}`);
  devices.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
  const firestore = initializeFirestore(app, { localCache: memoryLocalCache({ garbageCollector: memoryLruGarbageCollector() }) });
  const [host, port] = (options.firestoreHost ?? firestoreHost!).split(':');
  connectFirestoreEmulator(firestore, host!, Number(port));
  const context: ConsumerFirestoreContext = { firestore, auth };
  // EEG consent is confirmed only by a server read, bounded in production by
  // CONSENT_SERVER_READ_TIMEOUT_MS. A loaded CI emulator can be slower than
  // that, which would skip recordings the tests expect, so devices wait longer
  // unless a test sets the bound itself (as the stalled-connection tests do).
  const eeg = createEegRecordingRepository(context, { consentServerReadTimeoutMs: 10_000, ...options.eegOptions });
  return {
    app, auth, firestore, context, eeg,
    profiles: createProfileRepository(context),
    sessions: createGameSessionRepository(context, options.sessionOptions),
    progress: createProgressRepository(context),
  };
}

/** Signs a new emulator user up on a new device. */
export async function signedInDevice(label = 'player', options: DeviceOptions = {}): Promise<Device & { player: Player }> {
  const device = newDevice(options);
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = 'Emulator!123';
  const credential = await createUserWithEmailAndPassword(device.auth, email, password);
  return { ...device, player: { uid: credential.user.uid, email, password } };
}

/**
 * A TCP endpoint that accepts connections and never answers: a stalled
 * network. A client pointed at it stays in the SDK's "unknown" connection
 * state (neither online nor offline) instead of failing fast.
 */
export async function stalledEndpoint(): Promise<{ host: string; close(): Promise<void> }> {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const { port } = server.address() as AddressInfo;
  return {
    host: `127.0.0.1:${port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    },
  };
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
// The real Mental Math v1 definition (NFCT-17): its trial and metrics schemas
// check every session the tests save.

export const testGame = mentalMath.definition;
export const testTrialSchema = mentalMath.trialSchema;
export type TestTrial = mentalMath.MentalMathTrial;
export type TestMetrics = mentalMath.MentalMathMetrics;

/** A fixed session seed for documents the tests write around the repositories. */
export const TEST_SEED = 2_654_435_761;

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

/**
 * A stored session document as the repository would write it (seed and
 * createdAt included), for writes that go around the repository: trusted
 * setup, or a raw client write that shows what the rules refuse.
 */
export function sessionDocument(
  userId: string,
  overrides: Record<string, unknown> = {},
  endedMinutesAgo = 1,
): Record<string, unknown> {
  return { ...sessionDraft({}, endedMinutesAgo), schemaVersion: 1, userId, seed: TEST_SEED, createdAt: Timestamp.now(), ...overrides };
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
      score: 180,
      accuracy: 1,
      trialsTotal: 3,
      trialsCorrect: 3,
      responseTime: { medianMs: 1_200, meanMs: 1_200, p90Ms: 1_200 },
      metrics: { correct: 3, attempted: 3, timedOut: 0, longestStreak: 3, finalLevel: 1, difficultyPoints: 150, speedBonusPoints: 30 },
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

/**
 * Saves a finished session, then offers its EEG recording, as the game runner
 * does: the recording is a separate write, made after the session is queued.
 */
export async function saveSessionThenEeg(
  device: Device,
  recording: EegRecordingDraft = eegDraft(),
  session: GameSessionDraft<TestTrial, TestMetrics> = sessionDraft(),
) {
  const started = device.sessions.startGameSession();
  const saved = await started.save({ definition: testGame, session });
  const eeg = await device.eeg.saveRecording(saved, recording);
  return { started, saved, eeg };
}

/** A queued recording's ID and server outcome, failing clearly if it was skipped. */
export function queued(save: EegRecordingSave): { recordingId: string; serverOutcome: Promise<EegRecordingServerOutcome> } {
  if (save.status !== 'queued') throw new Error(`Expected the EEG recording to be queued, but it was skipped (${save.reason}): ${save.message}`);
  return save;
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
    score: 180, accuracy: 1, responseTime: null, peakLevel: 2,
    metrics: { correct: 3, attempted: 3, timedOut: 0, longestStreak: 3, finalLevel: 1, difficultyPoints: 150, speedBonusPoints: 30 },
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
