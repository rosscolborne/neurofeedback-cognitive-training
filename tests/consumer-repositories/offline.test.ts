import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, disableNetwork, enableNetwork, getDocsFromCache, Timestamp } from 'firebase/firestore';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DomainReadError, readGameSession } from '@nfct/shared';
import { CONSENT_SERVER_READ_TIMEOUT_MS } from '../../src/consumer/repositories/eegRecordingRepository';
import type { RecentGameSessions } from '../../src/consumer/repositories/gameSessionRepository';
import type { ProgressWithRecentSessions } from '../../src/consumer/repositories/progressRepository';
import {
  acceptedConsentVersion,
  closeDevices,
  closeEnvironment,
  eegDraft,
  eventually,
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

  it('skips EEG offline even with consent cached on this device, at once, and still queues the session', async () => {
    const device = await signedInDevice();
    await withProfile(device, { eegConsent: true });
    // This device has read (and cached) the profile with consent.
    const cached = await device.profiles.getProfile();
    expect(cached.status === 'readable' && cached.data.eeg.consent).not.toBeNull();
    await disableNetwork(device.firestore);
    const started = device.sessions.startGameSession();

    const saved = await started.save({ definition: testGame, session: sessionDraft() });
    const before = Date.now();
    const eeg = await device.eeg.saveRecording(saved, eegDraft());
    // Offline the server read fails at once: no waiting for the consent read's time bound.
    expect(Date.now() - before).toBeLessThan(CONSENT_SERVER_READ_TIMEOUT_MS / 2);
    // Consent is established only by the server; the cached grant is never used.
    expect(eeg).toMatchObject({ status: 'skipped', reason: 'consent-unavailable' });
    expect(await device.eeg.hasEegRecording(started.sessionId)).toBe(false);

    await enableNetwork(device.firestore);
    await saved.acknowledged;
    expect(await serverRead(`users/${device.player.uid}/gameSessions/${started.sessionId}`)).toBeDefined();
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

  it('sends a session queued offline even if EEG consent is withdrawn before it reconnects', async () => {
    const device = await signedInDevice();
    await withProfile(device, { eegConsent: true });
    await disableNetwork(device.firestore);
    const started = device.sessions.startGameSession();
    const saved = await started.save({ definition: testGame, session: sessionDraft() });
    // Consent withdrawn on another device before this one reconnects: it has nothing to do with the session.
    const profile = await serverRead(`users/${device.player.uid}`);
    await serverWrite({ [`users/${device.player.uid}`]: { ...profile, eeg: { ...profile?.eeg, consent: null } } });

    await enableNetwork(device.firestore);
    await saved.acknowledged;

    expect(await serverRead(`users/${device.player.uid}/gameSessions/${started.sessionId}`)).toMatchObject({ userId: device.player.uid });
  });
});

describe('saving never waits on the network for EEG consent', () => {
  // disableNetwork() puts the SDK firmly offline, where server reads fail at
  // once. A stalled connection instead leaves it in an unknown state, where a
  // plain getDoc() waits for the server for many seconds.

  it('queues the session at once on a stalled connection, then skips the recording after the bounded consent read', async () => {
    const stalled = await stalledEndpoint();
    try {
      const device = await signedInDevice('stalled', { firestoreHost: stalled.host, eegOptions: { consentServerReadTimeoutMs: 300 } });
      // The profile and consent exist only in this device's cache: written here, never acknowledged.
      void device.profiles.createProfile(profileDraft()).acknowledged;
      void device.profiles.grantEegConsent(acceptedConsentVersion).acknowledged;
      const started = device.sessions.startGameSession();

      const beforeSave = Date.now();
      const saved = await started.save({ definition: testGame, session: sessionDraft() });
      const saveElapsed = Date.now() - beforeSave;
      const beforeEeg = Date.now();
      const eeg = await device.eeg.saveRecording(saved, eegDraft());
      const eegElapsed = Date.now() - beforeEeg;

      // The session never waits for EEG: it is queued before consent is even read.
      expect(saveElapsed).toBeLessThan(250);
      expect(eeg).toMatchObject({ status: 'skipped', reason: 'consent-unavailable' });
      expect(eegElapsed).toBeGreaterThanOrEqual(250);
      expect(eegElapsed).toBeLessThan(2_000);
      const queuedSessions = await getDocsFromCache(collection(device.firestore, 'users', device.player.uid, 'gameSessions'));
      expect(queuedSessions.docs.map((item) => [item.id, item.metadata.hasPendingWrites])).toEqual([[started.sessionId, true]]);
      const queuedRecordings = await getDocsFromCache(collection(device.firestore, 'users', device.player.uid, 'eegRecordings'));
      expect(queuedRecordings.docs).toEqual([]);
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
