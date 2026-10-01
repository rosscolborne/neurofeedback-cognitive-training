import { doc, Timestamp, writeBatch } from 'firebase/firestore';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GameProgress } from '@nfct/shared';
import type { DocumentRead } from '../../src/consumer/firestore/reads';
import type { ProgressWithRecentSessions } from '../../src/consumer/repositories/progressRepository';
import {
  asServer,
  closeDevices,
  closeEnvironment,
  eventually,
  expectDenied,
  rawClientWrite,
  resetEmulators,
  serverRead,
  serverWrite,
  sessionDraft,
  signedInDevice,
  testGame,
  trustedProgress,
  trustedResult,
  type Device,
} from './harness';

beforeEach(resetEmulators);
afterEach(closeDevices);
afterAll(closeEnvironment);

async function playOnce(device: Device, endedMinutesAgo = 1): Promise<string> {
  const started = device.sessions.startGameSession();
  await (await started.save({ definition: testGame, session: sessionDraft({}, endedMinutesAgo) })).acknowledged;
  return started.sessionId;
}

/** What NFCT-19's trusted scoring does: result and progress in one commit. */
async function processSession(uid: string, sessionId: string, sessionsCompleted: number): Promise<void> {
  const sessionPath = `users/${uid}/gameSessions/${sessionId}`;
  const session = await serverRead(sessionPath);
  await asServer(async (firestore) => {
    const batch = writeBatch(firestore);
    batch.set(doc(firestore, sessionPath), { ...session, result: trustedResult() });
    batch.set(doc(firestore, `users/${uid}/progress/mental-math`), trustedProgress(sessionId, sessionsCompleted));
    await batch.commit();
  });
}

describe('reading progress', () => {
  it('reports missing progress for a game with no processed session', async () => {
    const device = await signedInDevice();

    expect(await device.progress.getProgress('mental-math')).toMatchObject({ status: 'missing', id: 'mental-math' });
  });

  it('reads trusted progress', async () => {
    const device = await signedInDevice();
    const sessionId = await playOnce(device);
    await processSession(device.player.uid, sessionId, 1);

    const read = await device.progress.getProgress('mental-math');

    expect(read).toMatchObject({ status: 'readable', data: { gameId: 'mental-math', sessionsCompleted: 1, bestPeakLevel: { 'timed-90': 2 } } });
    expect(read.status === 'readable' && read.data.updatedAt).toBeInstanceOf(Timestamp);
  });

  it('reports progress this build cannot read as unreadable instead of throwing', async () => {
    const device = await signedInDevice();
    await serverWrite({ [`users/${device.player.uid}/progress/mental-math`]: { schemaVersion: 2, gameId: 'mental-math' } });

    expect(await device.progress.getProgress('mental-math')).toMatchObject({ status: 'unreadable' });
  });

  it('follows progress as trusted scoring updates it', async () => {
    const device = await signedInDevice();
    const reads: DocumentRead<GameProgress>[] = [];
    const stop = device.progress.subscribeToProgress('mental-math', (read) => reads.push(read), (error) => { throw error; });

    await eventually(() => expect(reads.at(-1)).toMatchObject({ status: 'missing', fromCache: false }));
    const sessionId = await playOnce(device);
    await processSession(device.player.uid, sessionId, 1);
    await eventually(() => expect(reads.at(-1)).toMatchObject({ status: 'readable', data: { sessionsCompleted: 1 } }));
    stop();
  });

  it('refuses a game ID that is not a catalogue ID', async () => {
    const device = await signedInDevice();

    await expect(device.progress.getProgress('mental-math/other')).rejects.toThrow(/Invalid game ID/);
  });

  it('is never written by a client: the rules refuse it', async () => {
    const device = await signedInDevice();

    await expectDenied(rawClientWrite(device, `users/${device.player.uid}/progress/mental-math`, trustedProgress('x'.repeat(20), 1)));
  });
});

describe('progress with recent sessions, for the start-level picker and client preview', () => {
  it('never counts a session twice or not at all while trusted scoring processes it', async () => {
    const device = await signedInDevice();
    const earlier = await playOnce(device, 30);
    await processSession(device.player.uid, earlier, 1);
    const latest = await playOnce(device, 1);
    const states: ProgressWithRecentSessions[] = [];
    const stop = device.progress.subscribeToProgressWithRecentSessions('mental-math', {}, (state) => states.push(state), (error) => { throw error; });

    await eventually(() => expect(states.at(-1)?.pendingSessions.map((record) => record.id)).toEqual([latest]));
    await processSession(device.player.uid, latest, 2);
    await eventually(() => {
      const last = states.at(-1);
      expect(last?.pendingSessions).toEqual([]);
      expect(last?.progress).toMatchObject({ status: 'readable', data: { sessionsCompleted: 2 } });
    });
    stop();

    // Each delivered state counts the latest session exactly once: pending, or in progress.
    for (const state of states) {
      const counted = state.progress.status === 'readable' ? state.progress.data.sessionsCompleted : 0;
      const pending = state.pendingSessions.length;
      expect(counted + pending, `progress counts ${counted}, ${pending} pending`).toBe(2);
    }
    expect(states.at(-1)?.recentSessions.map((record) => record.id)).toEqual([latest, earlier]);
    expect(states.at(-1)?.recentSessions[0]?.session.startLevel).toBe(1);
  });

  it('delivers once both parts have arrived, with missing progress for a new player', async () => {
    const device = await signedInDevice();
    const states: ProgressWithRecentSessions[] = [];
    const stop = device.progress.subscribeToProgressWithRecentSessions('mental-math', { recentLimit: 5 }, (state) => states.push(state), (error) => { throw error; });

    await eventually(() => expect(states.at(-1)).toMatchObject({ progress: { status: 'missing' }, recentSessions: [], pendingSessions: [] }));
    stop();
  });

  it('stops delivering after unsubscribing', async () => {
    const device = await signedInDevice();
    const states: ProgressWithRecentSessions[] = [];
    const stop = device.progress.subscribeToProgressWithRecentSessions('mental-math', {}, (state) => states.push(state), (error) => { throw error; });
    await eventually(() => expect(states.length).toBeGreaterThan(0));
    stop();
    const delivered = states.length;

    await playOnce(device);

    expect(states.length).toBe(delivered);
  });
});
