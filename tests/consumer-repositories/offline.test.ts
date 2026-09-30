import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, disableNetwork, enableNetwork, getDocsFromCache, Timestamp } from 'firebase/firestore';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DomainReadError, readGameSession } from '@nfct/shared';
import type { RecentGameSessions } from '../../src/consumer/repositories/gameSessionRepository';
import type { ProgressWithRecentSessions } from '../../src/consumer/repositories/progressRepository';
import {
  acceptedConsentVersion,
  closeDevices,
  closeEnvironment,
  eegDraft,
  eventually,
  newDevice,
  profileDraft,
  resetEmulators,
  serverRead,
  serverWrite,
  sessionDraft,
  settle,
  signedInDevice,
  stalledEndpoint,
  testGame,
  withProfile,
  type Device,
} from './harness';

// Offline play (NFCT-20). The app uses Firestore's persistent IndexedDB cache;
// Node has none, so these tests use the memory cache, which queues writes and
// serves cached reads the same way while the app is running. Surviving a
// restart is the persistent cache's job and is not observable here.

beforeEach(resetEmulators);
afterEach(closeDevices);
afterAll(closeEnvironment);

function watchAcknowledgement(acknowledged: Promise<void>): { settled: () => boolean } {
  let settled = false;
  acknowledged.then(() => { settled = true; }, () => { settled = true; });
  return { settled: () => settled };
}

describe('playing offline', () => {
  it('saves a session offline, reads it back at once, and writes it once when back online', async () => {
    const device = await signedInDevice();
    await disableNetwork(device.firestore);
    const started = device.sessions.startGameSession();

    const saved = await started.save({ definition: testGame, session: sessionDraft() });
    const acknowledgement = watchAcknowledgement(saved.acknowledged);
    await settle(200);

    expect(acknowledgement.settled()).toBe(false);
    expect(await serverRead(`users/${device.player.uid}/gameSessions/${started.sessionId}`)).toBeUndefined();

    const page = await device.sessions.listGameSessions();
    expect(page.fromCache).toBe(true);
    expect(page.unreadable).toEqual([]);
    expect(page.sessions).toHaveLength(1);
    expect(page.sessions[0]).toMatchObject({ id: started.sessionId, hasPendingWrites: true, awaitingResult: true });
    // The server clock has not stamped createdAt yet; it reads as the local estimate.
    expect(page.sessions[0]?.session.createdAt).toBeInstanceOf(Timestamp);
    expect(await device.sessions.getGameSession(started.sessionId)).toMatchObject({ status: 'readable', hasPendingWrites: true });

    await enableNetwork(device.firestore);
    await saved.acknowledged;

    const stored = await serverRead(`users/${device.player.uid}/gameSessions/${started.sessionId}`);
    expect(stored?.createdAt).toBeInstanceOf(Timestamp);
    const afterSync = await device.sessions.listGameSessions();
    expect(afterSync.sessions.map((record) => [record.id, record.hasPendingWrites])).toEqual([[started.sessionId, false]]);
  });

  it('would drop a just-played session as unreadable without reading pending server timestamps as estimates', async () => {
    const device = await signedInDevice();
    await disableNetwork(device.firestore);
    const started = device.sessions.startGameSession();
    await started.save({ definition: testGame, session: sessionDraft() });

    const cached = await getDocsFromCache(collection(device.firestore, 'users', device.player.uid, 'gameSessions'));

    expect(cached.docs[0]?.data().createdAt).toBeNull();
    expect(() => readGameSession(cached.docs[0]?.data())).toThrow(DomainReadError);
    expect((await device.sessions.listGameSessions()).sessions.map((record) => record.id)).toEqual([started.sessionId]);
  });

  it('gives the start-level picker the newest session and the pending ones while offline', async () => {
    const device = await signedInDevice();
    const online = device.sessions.startGameSession();
    await (await online.save({ definition: testGame, session: sessionDraft({ startLevel: 1, peakLevel: 1 }, 20) })).acknowledged;
    await device.sessions.listGameSessions({ gameId: 'mental-math' });
    await disableNetwork(device.firestore);
    const offline = device.sessions.startGameSession();
    await offline.save({ definition: testGame, session: sessionDraft({ startLevel: 2, peakLevel: 3 }, 1) });

    const recent: RecentGameSessions[] = [];
    const states: ProgressWithRecentSessions[] = [];
    const stopRecent = device.sessions.subscribeToRecentGameSessions({ gameId: 'mental-math' }, (value) => recent.push(value), (error) => { throw error; });
    const stopState = device.progress.subscribeToProgressWithRecentSessions('mental-math', {}, (value) => states.push(value), (error) => { throw error; });

    await eventually(() => {
      expect(recent.at(-1)?.sessions.map((record) => record.id)).toEqual([offline.sessionId, online.sessionId]);
      expect(states.at(-1)?.pendingSessions.map((record) => record.id)).toEqual([offline.sessionId, online.sessionId]);
    });
    const latest = recent.at(-1)!;
    expect(latest.fromCache).toBe(true);
    expect(latest.sessions[0]).toMatchObject({ hasPendingWrites: true, session: { startLevel: 2 } });
    expect(states.at(-1)).toMatchObject({ progress: { status: 'missing', fromCache: true }, fromCache: true });
    stopRecent();
    stopState();
  });

  it('queues a session and its EEG recording as one batch, using the cached consent, and both land', async () => {
    const device = await signedInDevice();
    await withProfile(device, { eegConsent: true });
    await device.profiles.getProfile();
    await disableNetwork(device.firestore);
    const started = device.sessions.startGameSession();

    const saved = await started.save({ definition: testGame, session: sessionDraft(), eegRecording: eegDraft() });
    expect(saved.eegRecording.status).toBe('included');
    await enableNetwork(device.firestore);
    await saved.acknowledged;

    const recordingId = saved.eegRecording.status === 'included' ? saved.eegRecording.recordingId : '';
    expect(await serverRead(`users/${device.player.uid}/gameSessions/${started.sessionId}`)).toBeDefined();
    expect(await serverRead(`users/${device.player.uid}/eegRecordings/${recordingId}`)).toMatchObject({ gameSessionId: started.sessionId });
  });

  it('skips EEG it cannot check consent for offline, and still queues the session', async () => {
    const first = await signedInDevice();
    await withProfile(first, { eegConsent: true });
    // A second install that has never read the profile.
    const device: Device = newDevice();
    await signInWithEmailAndPassword(device.auth, first.player.email, first.player.password);
    await disableNetwork(device.firestore);
    const started = device.sessions.startGameSession();

    const saved = await started.save({ definition: testGame, session: sessionDraft(), eegRecording: eegDraft() });
    expect(saved.eegRecording).toMatchObject({ status: 'skipped', reason: 'consent-unavailable' });
    await enableNetwork(device.firestore);
    await saved.acknowledged;

    expect(await serverRead(`users/${first.player.uid}/gameSessions/${started.sessionId}`)).toBeDefined();
    expect(await device.eeg.hasEegRecording(started.sessionId)).toBe(false);
  });

  it('applies a profile change made offline when back online', async () => {
    const device = await signedInDevice();
    await withProfile(device);
    await disableNetwork(device.firestore);

    const write = device.profiles.updateProfile({ preferences: { soundEnabled: false } });
    const cached = await device.profiles.getProfile();
    expect(cached).toMatchObject({ status: 'readable', hasPendingWrites: true, data: { preferences: { soundEnabled: false } } });
    await enableNetwork(device.firestore);
    await write.acknowledged;

    expect(await serverRead(`users/${device.player.uid}`)).toMatchObject({ preferences: { soundEnabled: false } });
  });

  it('keeps a profile readable while consent granted offline waits for the server clock', async () => {
    const device = await signedInDevice();
    await withProfile(device);
    await device.profiles.getProfile();
    await disableNetwork(device.firestore);

    const write = device.profiles.grantEegConsent('placeholder-1');
    const cached = await device.profiles.getProfile();

    expect(cached).toMatchObject({ status: 'readable', hasPendingWrites: true, data: { eeg: { consent: { version: 'placeholder-1' } } } });
    if (cached.status !== 'readable') throw new Error('unreadable');
    expect(cached.data.eeg.consent?.grantedAt).toBeInstanceOf(Timestamp);
    expect(cached.data.updatedAt.toMillis()).toBeGreaterThanOrEqual(cached.data.createdAt.toMillis());
    await enableNetwork(device.firestore);
    await write.acknowledged;
  });

  it('refuses a queued batch as a whole when consent was withdrawn meanwhile (the session goes with it)', async () => {
    const device = await signedInDevice();
    await withProfile(device, { eegConsent: true });
    await device.profiles.getProfile();
    await disableNetwork(device.firestore);
    const started = device.sessions.startGameSession();
    const saved = await started.save({ definition: testGame, session: sessionDraft(), eegRecording: eegDraft() });
    // Consent withdrawn on another device before this one reconnects.
    const profile = await serverRead(`users/${device.player.uid}`);
    await serverWrite({ [`users/${device.player.uid}`]: { ...profile, eeg: { ...profile?.eeg, consent: null } } });

    await enableNetwork(device.firestore);
    const error = await saved.acknowledged.catch((reason: unknown) => reason);

    expect((error as { code?: string }).code).toBe('permission-denied');
    expect(await serverRead(`users/${device.player.uid}/gameSessions/${started.sessionId}`)).toBeUndefined();
  });
});

describe('saving never waits on the network for EEG consent', () => {
  // disableNetwork() puts the SDK firmly offline, where reads answer from the
  // cache at once. A stalled connection instead leaves it in an unknown state,
  // where a plain getDoc() waits for the server for many seconds.

  it('uses the cached consent on a stalled connection, and queues the batch at once', async () => {
    const stalled = await stalledEndpoint();
    try {
      const device = await signedInDevice('stalled', { firestoreHost: stalled.host });
      // The profile and consent exist only in this device's cache: written here, never acknowledged.
      void device.profiles.createProfile(profileDraft()).acknowledged;
      void device.profiles.grantEegConsent(acceptedConsentVersion).acknowledged;
      const started = device.sessions.startGameSession();

      const before = Date.now();
      const saved = await started.save({ definition: testGame, session: sessionDraft(), eegRecording: eegDraft() });
      const elapsed = Date.now() - before;

      expect(saved.eegRecording.status).toBe('included');
      expect(elapsed).toBeLessThan(1_500);
      const queued = await getDocsFromCache(collection(device.firestore, 'users', device.player.uid, 'gameSessions'));
      expect(queued.docs.map((item) => [item.id, item.metadata.hasPendingWrites])).toEqual([[started.sessionId, true]]);
    } finally {
      await closeDevices();
      await stalled.close();
    }
  });

  it('bounds the server read when the profile is not cached, then skips the recording and queues the session', async () => {
    const stalled = await stalledEndpoint();
    try {
      const device = await signedInDevice('stalled', { firestoreHost: stalled.host, eegOptions: { consentServerReadTimeoutMs: 300 } });
      const started = device.sessions.startGameSession();

      const before = Date.now();
      const saved = await started.save({ definition: testGame, session: sessionDraft(), eegRecording: eegDraft() });
      const elapsed = Date.now() - before;

      expect(saved.eegRecording).toMatchObject({ status: 'skipped', reason: 'consent-unavailable' });
      expect(elapsed).toBeGreaterThanOrEqual(250);
      expect(elapsed).toBeLessThan(2_000);
      const queued = await getDocsFromCache(collection(device.firestore, 'users', device.player.uid, 'gameSessions'));
      expect(queued.docs.map((item) => item.id)).toEqual([started.sessionId]);
    } finally {
      await closeDevices();
      await stalled.close();
    }
  });
});

describe('queued writes and account switches', () => {
  it("never sends one user's queued session under another user, and sends it when that user returns", async () => {
    const playerB = (await signedInDevice('b')).player;
    const device = await signedInDevice('a');
    const playerA = device.player;
    await disableNetwork(device.firestore);
    const started = device.sessions.startGameSession();
    const saved = await started.save({ definition: testGame, session: sessionDraft() });
    const acknowledgement = watchAcknowledgement(saved.acknowledged);
    const pathA = `users/${playerA.uid}/gameSessions/${started.sessionId}`;

    // B signs in on the same install and the connection comes back.
    await signOut(device.auth);
    await signInWithEmailAndPassword(device.auth, playerB.email, playerB.password);
    await enableNetwork(device.firestore);
    // B's own write goes through, so the connection is flowing...
    const savedByB = device.sessions.startGameSession();
    await (await savedByB.save({ definition: testGame, session: sessionDraft() })).acknowledged;
    await settle(300);

    // ...but A's queued session stays on the device: not sent under B, not refused, not lost.
    expect(await serverRead(pathA)).toBeUndefined();
    expect(acknowledgement.settled()).toBe(false);
    expect(await serverRead(`users/${playerB.uid}/gameSessions/${savedByB.sessionId}`)).toMatchObject({ userId: playerB.uid });

    // A signs back in: the queued session is sent once, under A.
    await signOut(device.auth);
    await signInWithEmailAndPassword(device.auth, playerA.email, playerA.password);
    await saved.acknowledged;
    expect(await serverRead(pathA)).toMatchObject({ userId: playerA.uid, seed: started.seed });
  });
});
