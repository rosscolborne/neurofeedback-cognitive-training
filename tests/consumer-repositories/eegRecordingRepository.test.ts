import { serverTimestamp, Timestamp } from 'firebase/firestore';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeDevices,
  closeEnvironment,
  eegDraft,
  expectDenied,
  rawClientWrite,
  resetEmulators,
  serverRead,
  serverWrite,
  sessionDraft,
  signedInDevice,
  testGame,
  withProfile,
  type Device,
} from './harness';

beforeEach(resetEmulators);
afterEach(closeDevices);
afterAll(closeEnvironment);

async function sessionWithEeg(device: Device, source: 'measured' | 'simulated' = 'simulated') {
  const started = device.sessions.startGameSession();
  const saved = await started.save({ definition: testGame, session: sessionDraft(), eegRecording: eegDraft({ source }) });
  await saved.acknowledged;
  if (saved.eegRecording.status !== 'included') throw new Error(`EEG was not included: ${JSON.stringify(saved.eegRecording)}`);
  return { sessionId: started.sessionId, recordingId: saved.eegRecording.recordingId };
}

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
  it('a recording whose session is not written in the same batch', async () => {
    const device = await signedInDevice();
    await withProfile(device, { eegConsent: true });
    const path = `users/${device.player.uid}/eegRecordings/lonely-recording-000001`;

    await expectDenied(rawClientWrite(device, path, storedRecording(device.player.uid, 'never-written-session-01', { createdAt: serverTimestamp() })));
  });

  it('a recording without consent on the profile', async () => {
    const device = await signedInDevice();
    await withProfile(device);
    const started = device.sessions.startGameSession();
    await (await started.save({ definition: testGame, session: sessionDraft() })).acknowledged;

    await expectDenied(rawClientWrite(device, `users/${device.player.uid}/eegRecordings/no-consent-recording-01`,
      storedRecording(device.player.uid, started.sessionId, { createdAt: serverTimestamp() })));
  });

  it('an update of a recording', async () => {
    const device = await signedInDevice();
    await withProfile(device, { eegConsent: true });
    const { recordingId } = await sessionWithEeg(device);
    const path = `users/${device.player.uid}/eegRecordings/${recordingId}`;

    await expectDenied(rawClientWrite(device, path, { ...(await serverRead(path)), source: 'measured' }));
  });
});
