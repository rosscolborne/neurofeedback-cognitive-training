import { disableNetwork, enableNetwork, Timestamp } from 'firebase/firestore';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeDevices,
  closeEnvironment,
  eegDraft,
  queued,
  resetEmulators,
  serverRead,
  serverWrite,
  sessionDraft,
  signedInDevice,
  testGame,
  withProfile,
  type Device,
} from './harness';

// What the server decides when a queued session or recording finally reaches
// it. The session and its recording are separate writes, sent in order.
//
// A recording is queued only after the server has just confirmed consent, so
// it normally reaches the server at once. To hold it in the queue, as a
// connection lost at that moment would, `holdNextRecording` takes the device
// offline just before the repository writes it: the SDK runs its operations in
// order, so the network is down before the recording's write is processed.

/** The parts of a written document's reference the tests look at. */
interface WrittenRef {
  readonly id: string;
  readonly path: string;
  readonly parent: { readonly id: string };
}

const hooks = vi.hoisted(() => ({ beforeSetDoc: null as ((ref: WrittenRef) => void) | null }));

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    setDoc: ((...args: Parameters<typeof actual.setDoc>) => {
      hooks.beforeSetDoc?.(args[0]);
      return actual.setDoc(...args);
    }) as typeof actual.setDoc,
  };
});

beforeEach(resetEmulators);
afterEach(async () => {
  hooks.beforeSetDoc = null;
  await closeDevices();
});
afterAll(closeEnvironment);

/** Takes the device offline just before the repository queues its next EEG recording; resolves with that recording's reference. */
function holdNextRecording(device: Device): Promise<WrittenRef> {
  return new Promise((resolve) => {
    hooks.beforeSetDoc = (ref) => {
      if (ref.parent.id !== 'eegRecordings') return;
      hooks.beforeSetDoc = null;
      // Queued ahead of the recording's write, so the write is held, not sent.
      void disableNetwork(device.firestore);
      resolve(ref);
    };
  });
}

describe('a recording queued behind its session', () => {
  it('is refused, and the session kept, when consent is withdrawn before the recording reaches the server', async () => {
    const device = await signedInDevice();
    await withProfile(device, { eegConsent: true });
    const started = device.sessions.startGameSession();
    const saved = await started.save({ definition: testGame, session: sessionDraft() });
    await saved.acknowledged;
    const held = holdNextRecording(device);

    const eeg = await device.eeg.saveRecording(saved, eegDraft());
    const ref = await held;
    const { recordingId, serverOutcome } = queued(eeg);
    expect(recordingId).toBe(ref.id);
    expect(await device.eeg.hasEegRecording(started.sessionId)).toBe(true);
    // Consent withdrawn on another device while the recording waits in this device's queue.
    const profile = await serverRead(`users/${device.player.uid}`);
    await serverWrite({ [`users/${device.player.uid}`]: { ...profile, eeg: { ...profile?.eeg, consent: null } } });
    await enableNetwork(device.firestore);

    // The rules check consent again when the recording arrives.
    expect(await serverOutcome).toMatchObject({ status: 'refused', reason: 'consent-withdrawn' });
    expect(await serverRead(ref.path)).toBeUndefined();
    expect(await device.eeg.hasEegRecording(started.sessionId)).toBe(false);
    expect(await serverRead(`users/${device.player.uid}/gameSessions/${started.sessionId}`)).toBeDefined();
  });

  it('is reported as acknowledged, with no second copy, when the server had applied it and only the acknowledgement was lost', async () => {
    const device = await signedInDevice();
    await withProfile(device, { eegConsent: true });
    const started = device.sessions.startGameSession();
    const saved = await started.save({ definition: testGame, session: sessionDraft() });
    await saved.acknowledged;
    const held = holdNextRecording(device);

    const eeg = await device.eeg.saveRecording(saved, eegDraft());
    const ref = await held;
    // What the lost send had already written: the same recording, under the same ID.
    await serverWrite({
      [ref.path]: { ...eegDraft(), schemaVersion: 1, userId: device.player.uid, gameSessionId: started.sessionId, createdAt: Timestamp.now() },
    });
    await enableNetwork(device.firestore);

    // The resend is a create of an existing document, which the rules refuse as an update.
    expect(await queued(eeg).serverOutcome).toEqual({ status: 'acknowledged' });
    const { recordings } = await device.eeg.listForGameSession(started.sessionId);
    expect(recordings.map((record) => record.id)).toEqual([ref.id]);
  });
});

describe('a session whose acknowledgement was lost', () => {
  it('is refused as an update when resent, is still stored once, and its recording still lands once', async () => {
    const device = await signedInDevice();
    await withProfile(device, { eegConsent: true });
    await disableNetwork(device.firestore);
    const started = device.sessions.startGameSession();
    const draft = sessionDraft();
    const saved = await started.save({ definition: testGame, session: draft });
    const path = `users/${device.player.uid}/gameSessions/${started.sessionId}`;
    // What the lost send had already written: the same session, under the same ID.
    await serverWrite({ [path]: { ...draft, schemaVersion: 1, userId: device.player.uid, seed: started.seed, createdAt: Timestamp.now() } });
    await enableNetwork(device.firestore);

    // Offered straight after the save, as the runner does: the session is still queued on this device.
    const eeg = await device.eeg.saveRecording(saved, eegDraft());

    expect(await saved.acknowledged.catch((error: unknown) => (error as { code?: string }).code)).toBe('permission-denied');
    // Today's handling: re-read before telling the player the save failed. The session exists.
    expect(await device.sessions.getGameSession(started.sessionId)).toMatchObject({ status: 'readable', hasPendingWrites: false });
    expect(await serverRead(path)).toMatchObject({ seed: started.seed });
    // The recording was queued behind the session, so the session existed when it arrived.
    expect(await queued(eeg).serverOutcome).toEqual({ status: 'acknowledged' });
    expect((await device.eeg.listForGameSession(started.sessionId)).recordings).toHaveLength(1);
  });
});
