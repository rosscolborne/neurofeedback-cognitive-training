import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { serverTimestamp, Timestamp } from 'firebase/firestore';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineGame } from '@nfct/shared';
import type { ConsumerAuth } from '../../src/consumer/firestore/context';
import { createEegRecordingRepository, EegRecordingAlreadySavedError } from '../../src/consumer/repositories/eegRecordingRepository';
import {
  closeDevices,
  closeEnvironment,
  eegDraft,
  expectDenied,
  minutesAgo,
  newDevice,
  queued,
  rawClientWrite,
  resetEmulators,
  saveSessionThenEeg,
  serverRead,
  serverWrite,
  sessionDraft,
  signedInDevice,
  testGame,
  withProfile,
  type Device,
  type Player,
} from './harness';

beforeEach(resetEmulators);
afterEach(closeDevices);
afterAll(closeEnvironment);

async function sessionWithEeg(device: Device, source: 'measured' | 'simulated' = 'simulated') {
  const { started, saved, eeg } = await saveSessionThenEeg(device, eegDraft({ source }));
  const { recordingId, serverOutcome } = queued(eeg);
  await saved.acknowledged;
  expect(await serverOutcome).toEqual({ status: 'acknowledged' });
  return { sessionId: started.sessionId, recordingId };
}

const sessionPath = (device: Device & { player: Player }, sessionId: string) => `users/${device.player.uid}/gameSessions/${sessionId}`;
const recordingPath = (device: Device & { player: Player }, recordingId: string) => `users/${device.player.uid}/eegRecordings/${recordingId}`;

describe('saving a recording after its session', () => {
  it('writes the recording as its own create after the session; both are acknowledged, linked only by the recording', async () => {
    const device = await signedInDevice();
    await withProfile(device, { eegConsent: true });
    const { started, saved, eeg } = await saveSessionThenEeg(device, eegDraft({ source: 'simulated' }));

    expect(eeg).toMatchObject({ status: 'queued' });
    const { recordingId, serverOutcome } = queued(eeg);
    // A session's recording has the session's ID.
    expect(recordingId).toBe(started.sessionId);
    await saved.acknowledged;
    expect(await serverOutcome).toEqual({ status: 'acknowledged' });

    const recording = await serverRead(recordingPath(device, recordingId));
    expect(recording).toMatchObject({ schemaVersion: 1, userId: device.player.uid, gameSessionId: started.sessionId, source: 'simulated' });
    expect(recording?.createdAt).toBeInstanceOf(Timestamp);
    // The session carries no EEG flag: the recording's gameSessionId is the only link.
    const session = await serverRead(sessionPath(device, started.sessionId));
    expect(Object.keys(session ?? {}).filter((key) => /eeg|recording/i.test(key))).toEqual([]);
    expect(await device.eeg.hasEegRecording(started.sessionId)).toBe(true);
  });

  it('writes measured recordings as measured', async () => {
    const device = await signedInDevice();
    await withProfile(device, { eegConsent: true });

    const { sessionId } = await sessionWithEeg(device, 'measured');

    const { recordings } = await device.eeg.listForGameSession(sessionId);
    expect(recordings.map((record) => record.recording.source)).toEqual(['measured']);
  });

  it('never needs EEG consent to save the session, and skips the recording without it', async () => {
    const device = await signedInDevice();
    await withProfile(device);

    const { started, saved, eeg } = await saveSessionThenEeg(device);
    await saved.acknowledged;

    expect(eeg).toMatchObject({ status: 'skipped', reason: 'consent-required' });
    expect(await serverRead(sessionPath(device, started.sessionId))).toBeDefined();
    expect(await device.eeg.hasEegRecording(started.sessionId)).toBe(false);
  });

  it('confirms consent with the server, so consent withdrawn on another device skips the recording; the cached grant is never used', async () => {
    const device = await signedInDevice();
    await withProfile(device, { eegConsent: true });
    // This device has read (and cached) the profile with consent...
    const cached = await device.profiles.getProfile();
    expect(cached.status === 'readable' && cached.data.eeg.consent).not.toBeNull();
    // ...then consent is withdrawn on another device; nothing here is listening to the profile.
    const profile = await serverRead(`users/${device.player.uid}`);
    await serverWrite({ [`users/${device.player.uid}`]: { ...profile, eeg: { ...profile?.eeg, consent: null } } });

    const { started, saved, eeg } = await saveSessionThenEeg(device);
    await saved.acknowledged;

    expect(eeg).toMatchObject({ status: 'skipped', reason: 'consent-required' });
    expect(await serverRead(sessionPath(device, started.sessionId))).toBeDefined();
    expect(await device.eeg.hasEegRecording(started.sessionId)).toBe(false);
  });

  it('treats a missing profile as no consent', async () => {
    const device = await signedInDevice();

    const { started, saved, eeg } = await saveSessionThenEeg(device);
    await saved.acknowledged;

    expect(eeg).toMatchObject({ status: 'skipped', reason: 'consent-required' });
    expect(await device.eeg.hasEegRecording(started.sessionId)).toBe(false);
  });

  it('never takes a consent grant made on this device as established until the server has confirmed it', async () => {
    const device = await signedInDevice();
    await withProfile(device);
    const started = device.sessions.startGameSession();
    const saved = await started.save({ definition: testGame, session: sessionDraft() });
    // A grant the server will refuse (a version the rules do not accept). Until
    // the refusal arrives, this device's view of the profile shows consent.
    const grant = device.profiles.grantEegConsent('unapproved-version');

    const eeg = await device.eeg.saveRecording(saved, eegDraft());

    // The server's answer either still carries the unconfirmed local grant, or
    // comes after the refusal: either way the recording is not written.
    expect(eeg.status === 'skipped' ? eeg.reason : eeg.status).toMatch(/^consent-(unavailable|required)$/);
    expect(await grant.acknowledged.catch((error: unknown) => (error as { code?: string }).code)).toBe('permission-denied');
    await saved.acknowledged;
    expect(await device.eeg.hasEegRecording(started.sessionId)).toBe(false);
  });

  it('skips a recording with no valid source, or any other schema problem; the session is saved and may still be offered a valid one', async () => {
    const device = await signedInDevice();
    await withProfile(device, { eegConsent: true });
    const invalid = [
      { ...eegDraft(), source: undefined },
      { ...eegDraft(), source: 'demo' },
      { ...eegDraft(), device: { ...eegDraft().device, model: 'simulated' } },
      { ...eegDraft(), valence: 0.4 },
      { ...eegDraft(), gameSessionId: 'another-session-000001' },
      { ...eegDraft(), summary: { ...eegDraft().summary, relativeBandPower: { delta: 0.3, theta: undefined } } },
    ] as unknown as ReturnType<typeof eegDraft>[];
    const started = device.sessions.startGameSession();
    const saved = await started.save({ definition: testGame, session: sessionDraft() });

    for (const draft of invalid) {
      expect(await device.eeg.saveRecording(saved, draft)).toMatchObject({ status: 'skipped', reason: 'invalid' });
    }
    const undefinedValue = await device.eeg.saveRecording(saved, invalid.at(-1)!);
    expect(undefinedValue.status === 'skipped' && undefinedValue.message).toMatch(/summary\.relativeBandPower\.theta/);
    await saved.acknowledged;
    expect(await serverRead(sessionPath(device, started.sessionId))).toBeDefined();
    expect(await device.eeg.hasEegRecording(started.sessionId)).toBe(false);

    // Nothing was queued, so the session can still be offered its recording.
    expect(await queued(await device.eeg.saveRecording(saved, eegDraft())).serverOutcome).toEqual({ status: 'acknowledged' });
    expect(await device.eeg.hasEegRecording(started.sessionId)).toBe(true);
  });

  it('skips a recording for a session that is not saved on this device', async () => {
    const device = await signedInDevice();
    await withProfile(device, { eegConsent: true });
    const started = device.sessions.startGameSession();

    // The game has not been saved: there is nothing for the recording to link to yet.
    const eeg = await device.eeg.saveRecording({ sessionId: started.sessionId, userId: device.player.uid }, eegDraft());

    expect(eeg).toMatchObject({ status: 'skipped', reason: 'session-not-saved' });
    expect(await device.eeg.hasEegRecording(started.sessionId)).toBe(false);
  });

  it('skips the recording when the signed-in user changed after the session was saved', async () => {
    const device = await signedInDevice('first');
    await withProfile(device, { eegConsent: true });
    const second = await signedInDevice('second');
    await withProfile(second, { eegConsent: true });
    const started = device.sessions.startGameSession();
    const saved = await started.save({ definition: testGame, session: sessionDraft() });
    await saved.acknowledged;

    await signOut(device.auth);
    expect(await device.eeg.saveRecording(saved, eegDraft())).toMatchObject({ status: 'skipped', reason: 'owner-changed' });
    await signInWithEmailAndPassword(device.auth, second.player.email, second.player.password);
    expect(await device.eeg.saveRecording(saved, eegDraft())).toMatchObject({ status: 'skipped', reason: 'owner-changed' });

    expect(await serverRead(sessionPath(device, started.sessionId))).toMatchObject({ userId: device.player.uid });
    expect(await device.eeg.hasEegRecording(started.sessionId)).toBe(false);
  });

  it('skips the recording when the signed-in user changes while its checks are in flight', async () => {
    const device = await signedInDevice();
    await withProfile(device, { eegConsent: true });
    const started = device.sessions.startGameSession();
    const saved = await started.save({ definition: testGame, session: sessionDraft() });
    // The repository sees the signed-in user through its context; the switch is made after the call's synchronous start.
    let switched = false;
    const auth: ConsumerAuth = { get currentUser() { return switched ? { uid: 'another-player-uid-000001' } : device.auth.currentUser; } };
    const eeg = createEegRecordingRepository({ firestore: device.firestore, auth }, { consentServerReadTimeoutMs: 10_000 });

    const pending = eeg.saveRecording(saved, eegDraft());
    switched = true;

    expect(await pending).toMatchObject({ status: 'skipped', reason: 'owner-changed' });
    await saved.acknowledged;
    expect(await device.eeg.hasEegRecording(started.sessionId)).toBe(false);
  });

  it('reports a recording the server refuses, and the session is kept', async () => {
    const device = await signedInDevice();
    await withProfile(device, { eegConsent: true });
    // The device clock ran ahead: the rules refuse an interval ending more than
    // 5 minutes after the server's clock, which no client-side schema can know.
    const ahead = eegDraft({ startedAt: minutesAgo(-8), endedAt: minutesAgo(-10) });

    const { started, saved, eeg } = await saveSessionThenEeg(device, ahead);
    await saved.acknowledged;

    const { recordingId, serverOutcome } = queued(eeg);
    expect(await serverOutcome).toMatchObject({ status: 'refused', reason: 'unknown' });
    expect(await serverRead(recordingPath(device, recordingId))).toBeUndefined();
    expect(await serverRead(sessionPath(device, started.sessionId))).toBeDefined();
    expect(await device.eeg.hasEegRecording(started.sessionId)).toBe(false);
  });

  it('never lets a recording land without its session: when the server refuses the session, it refuses the recording too', async () => {
    const device = await signedInDevice();
    await withProfile(device, { eegConsent: true });
    // A game version the client accepts and the rules do not support.
    const unsupported = defineGame({ ...testGame, gameVersion: 3 });
    const started = device.sessions.startGameSession();
    const saved = await started.save({ definition: unsupported, session: sessionDraft({ gameVersion: 3 }) });

    const eeg = await device.eeg.saveRecording(saved, eegDraft());

    const { recordingId, serverOutcome } = queued(eeg);
    expect(await saved.acknowledged.catch((error: unknown) => (error as { code?: string }).code)).toBe('permission-denied');
    expect(await serverOutcome).toMatchObject({ status: 'refused', reason: 'session-not-saved' });
    expect(await serverRead(sessionPath(device, started.sessionId))).toBeUndefined();
    expect(await serverRead(recordingPath(device, recordingId))).toBeUndefined();
  });
});

describe('one recording per session', () => {
  it('refuses a second recording once one is queued, before anything is sent', async () => {
    const device = await signedInDevice();
    await withProfile(device, { eegConsent: true });
    const { started, saved, eeg } = await saveSessionThenEeg(device);
    await queued(eeg).serverOutcome;

    await expect(device.eeg.saveRecording(saved, eegDraft({ source: 'measured' }))).rejects.toThrow(EegRecordingAlreadySavedError);

    const { recordings } = await device.eeg.listForGameSession(started.sessionId);
    expect(recordings.map((record) => record.recording.source)).toEqual(['simulated']);
  });

  it('refuses concurrent recordings for one session, so only one is queued', async () => {
    const device = await signedInDevice();
    await withProfile(device, { eegConsent: true });
    const started = device.sessions.startGameSession();
    const saved = await started.save({ definition: testGame, session: sessionDraft() });

    const results = await Promise.allSettled([
      device.eeg.saveRecording(saved, eegDraft()),
      device.eeg.saveRecording(saved, eegDraft({ source: 'measured' })),
    ]);

    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(EegRecordingAlreadySavedError);
    const first = (results[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof device.eeg.saveRecording>>>).value;
    expect(await queued(first).serverOutcome).toEqual({ status: 'acknowledged' });
    expect((await device.eeg.listForGameSession(started.sessionId)).recordings).toHaveLength(1);
  });

  it('skips a second recording from another repository on this device, which sees the first in its cache', async () => {
    const device = await signedInDevice();
    await withProfile(device, { eegConsent: true });
    const { started, saved, eeg } = await saveSessionThenEeg(device);
    // Another tab, or a repository created again: it has no memory of the first save.
    const another = createEegRecordingRepository(device.context, { consentServerReadTimeoutMs: 10_000 });

    expect(await another.saveRecording(saved, eegDraft({ source: 'measured' }))).toMatchObject({ status: 'skipped', reason: 'already-recorded' });
    // Even before the first recording is acknowledged: it is already queued here.
    expect(await queued(eeg).serverOutcome).toEqual({ status: 'acknowledged' });
    expect(await another.saveRecording(saved, eegDraft({ source: 'measured' }))).toMatchObject({ status: 'skipped', reason: 'already-recorded' });

    const { recordings } = await device.eeg.listForGameSession(started.sessionId);
    expect(recordings.map((record) => [record.id, record.recording.source])).toEqual([[started.sessionId, 'simulated']]);
  });

  it('lets the rules refuse a second recording that a repository could not see, and keeps the first', async () => {
    const device = await signedInDevice();
    await withProfile(device, { eegConsent: true });
    const { started, saved, eeg } = await saveSessionThenEeg(device);
    await queued(eeg).serverOutcome;
    // Another install of the same player: it has the session cached, but has never read the recording.
    const other = newDevice();
    await signInWithEmailAndPassword(other.auth, device.player.email, device.player.password);
    expect(await other.sessions.getGameSession(started.sessionId)).toMatchObject({ status: 'readable' });

    const second = await other.eeg.saveRecording(saved, eegDraft({ source: 'measured' }));

    // The second create of the session's recording ID is refused as an update.
    expect(await queued(second).serverOutcome).toMatchObject({ status: 'refused', reason: 'already-recorded' });
    const { recordings } = await device.eeg.listForGameSession(started.sessionId);
    expect(recordings.map((record) => [record.id, record.recording.source])).toEqual([[started.sessionId, 'simulated']]);
  });

  it('never re-creates a deleted recording from the same repository; the rules accept one new create, still only one', async () => {
    const device = await signedInDevice();
    await withProfile(device, { eegConsent: true });
    const { started, saved, eeg } = await saveSessionThenEeg(device);
    await queued(eeg).serverOutcome;
    await device.eeg.deleteRecording(started.sessionId).acknowledged;

    await expect(device.eeg.saveRecording(saved, eegDraft())).rejects.toThrow(EegRecordingAlreadySavedError);
    expect(await device.eeg.hasEegRecording(started.sessionId)).toBe(false);

    // A new repository has no memory of the deleted one. With the document
    // gone, the rules see a create, so the session can hold one recording again.
    const another = createEegRecordingRepository(device.context, { consentServerReadTimeoutMs: 10_000 });
    expect(await queued(await another.saveRecording(saved, eegDraft({ source: 'measured' }))).serverOutcome).toEqual({ status: 'acknowledged' });
    const { recordings } = await device.eeg.listForGameSession(started.sessionId);
    expect(recordings.map((record) => [record.id, record.recording.source])).toEqual([[started.sessionId, 'measured']]);
  });
});

/** A stored recording document, as trusted setup writes it. */
function storedRecording(userId: string, gameSessionId: string, overrides: Record<string, unknown> = {}) {
  return { ...eegDraft(), schemaVersion: 1, userId, gameSessionId, createdAt: Timestamp.now(), ...overrides };
}

describe('whether a session has EEG', () => {
  it('is answered only by querying recordings on gameSessionId', async () => {
    const device = await signedInDevice();
    await withProfile(device, { eegConsent: true });
    const withEeg = await sessionWithEeg(device);
    const withoutEeg = device.sessions.startGameSession();
    await (await withoutEeg.save({ definition: testGame, session: sessionDraft() })).acknowledged;

    expect(await device.eeg.hasEegRecording(withEeg.sessionId)).toBe(true);
    expect(await device.eeg.hasEegRecording(withoutEeg.sessionId)).toBe(false);
    const { recordings, unreadable } = await device.eeg.listForGameSession(withEeg.sessionId);
    expect(recordings.map((record) => record.id)).toEqual([withEeg.recordingId]);
    expect(recordings[0]?.recording).toMatchObject({ gameSessionId: withEeg.sessionId, source: 'simulated' });
    expect(unreadable).toEqual([]);
    expect((await device.eeg.listForGameSession(withoutEeg.sessionId)).recordings).toEqual([]);
  });

  it('counts a recording this build cannot read, but skips it in the list', async () => {
    const device = await signedInDevice();
    const started = device.sessions.startGameSession();
    await (await started.save({ definition: testGame, session: sessionDraft() })).acknowledged;
    // The rules accept timeline values outside 0-1; the shared reader does not.
    await serverWrite({
      [`users/${device.player.uid}/eegRecordings/odd-recording-0000001`]: storedRecording(device.player.uid, started.sessionId, {
        timeline: { bucketSeconds: 10, mindfulness: [1.7], restfulness: [0.2] },
      }),
    });

    const list = await device.eeg.listForGameSession(started.sessionId);

    expect(await device.eeg.hasEegRecording(started.sessionId)).toBe(true);
    expect(list.recordings).toEqual([]);
    expect(list.unreadable.map((item) => item.id)).toEqual(['odd-recording-0000001']);
  });

  it("never sees another user's recordings", async () => {
    const owner = await signedInDevice('owner');
    await withProfile(owner, { eegConsent: true });
    const { sessionId, recordingId } = await sessionWithEeg(owner);
    const other = await signedInDevice('other');

    expect(await other.eeg.hasEegRecording(sessionId)).toBe(false);
    await other.eeg.deleteRecording(recordingId).acknowledged;
    expect(await other.eeg.deleteAllRecordings()).toEqual({ deleted: 0 });
    expect(await serverRead(`users/${owner.player.uid}/eegRecordings/${recordingId}`)).toBeDefined();
  });
});

describe('deleting recordings', () => {
  it('deletes one recording and keeps the session', async () => {
    const device = await signedInDevice();
    await withProfile(device, { eegConsent: true });
    const first = await sessionWithEeg(device);
    const second = await sessionWithEeg(device, 'measured');

    await device.eeg.deleteRecording(first.recordingId).acknowledged;

    expect(await serverRead(`users/${device.player.uid}/eegRecordings/${first.recordingId}`)).toBeUndefined();
    expect(await serverRead(`users/${device.player.uid}/eegRecordings/${second.recordingId}`)).toBeDefined();
    expect(await serverRead(`users/${device.player.uid}/gameSessions/${first.sessionId}`)).toBeDefined();
    expect(await device.eeg.hasEegRecording(first.sessionId)).toBe(false);
  });

  it('deletes every recording, across more than one page, and nothing else', async () => {
    const device = await signedInDevice();
    await withProfile(device, { eegConsent: true });
    const saved = await sessionWithEeg(device);
    const uid = device.player.uid;
    const seeded: Record<string, Record<string, unknown>> = {};
    for (let index = 0; index < 449; index += 1) {
      seeded[`users/${uid}/eegRecordings/seeded-recording-${String(index).padStart(4, '0')}`] = storedRecording(uid, saved.sessionId);
    }
    await serverWrite(seeded);

    expect(await device.eeg.deleteAllRecordings()).toEqual({ deleted: 450 });

    expect(await device.eeg.hasEegRecording(saved.sessionId)).toBe(false);
    expect(await serverRead(`users/${uid}/gameSessions/${saved.sessionId}`)).toBeDefined();
    expect(await serverRead(`users/${uid}`)).toBeDefined();
    expect(await device.eeg.deleteAllRecordings()).toEqual({ deleted: 0 });
  });

  it('refuses an ID that is not a recording ID instead of addressing another path', async () => {
    const device = await signedInDevice();

    expect(() => device.eeg.deleteRecording('../../other')).toThrow(/Invalid EEG recording ID/);
    await expect(device.eeg.hasEegRecording('short')).rejects.toThrow(/Invalid game session ID/);
  });
});

describe('what the rules refuse, and the repository therefore never sends', () => {
  it('a recording whose session does not exist', async () => {
    const device = await signedInDevice();
    await withProfile(device, { eegConsent: true });
    // Under its session's ID, as every recording must be, so only the missing session refuses it.
    const path = `users/${device.player.uid}/eegRecordings/never-written-session-01`;

    await expectDenied(rawClientWrite(device, path, storedRecording(device.player.uid, 'never-written-session-01', { createdAt: serverTimestamp() })));
  });

  it('a recording without consent on the profile', async () => {
    const device = await signedInDevice();
    await withProfile(device);
    const started = device.sessions.startGameSession();
    await (await started.save({ definition: testGame, session: sessionDraft() })).acknowledged;

    await expectDenied(rawClientWrite(device, `users/${device.player.uid}/eegRecordings/${started.sessionId}`,
      storedRecording(device.player.uid, started.sessionId, { createdAt: serverTimestamp() })));
  });

  it('an update of a recording', async () => {
    const device = await signedInDevice();
    await withProfile(device, { eegConsent: true });
    const { recordingId } = await sessionWithEeg(device);
    const path = `users/${device.player.uid}/eegRecordings/${recordingId}`;

    await expectDenied(rawClientWrite(device, path, { ...(await serverRead(path)), source: 'measured' }));
  });

  it('a second recording for a session under another ID', async () => {
    const device = await signedInDevice();
    await withProfile(device, { eegConsent: true });
    const { sessionId } = await sessionWithEeg(device);

    // A recording's ID must be its session's ID, so no crafted write adds another.
    await expectDenied(rawClientWrite(device, `users/${device.player.uid}/eegRecordings/another-recording-0001`,
      storedRecording(device.player.uid, sessionId, { createdAt: serverTimestamp() })));
  });
});
