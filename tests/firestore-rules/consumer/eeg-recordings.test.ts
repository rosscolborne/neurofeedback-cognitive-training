import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
    collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, updateDoc, where, writeBatch,
} from 'firebase/firestore';
import { afterAll, beforeEach, describe, it } from 'vitest';
import { anonymous, as, closeEnvironment, past, seedDocuments } from '../fixture';
import {
    acceptedConsentVersion, players, recordingData, resetConsumerWorld, seededRecordingId, seededSessionId, sessionData, without,
} from './consumerFixture';

beforeEach(resetConsumerWorld);
afterAll(closeEnvironment);

const newRecordingId = 'recording-new-000000001';
const newSessionId = 'session-with-eeg-000001';
const recordingPath = (uid: string, id = newRecordingId) => `users/${uid}/eegRecordings/${id}`;
const sessionPath = (uid: string, id: string) => `users/${uid}/gameSessions/${id}`;

describe('users/{uid}/eegRecordings: create', () => {
    it('lets a consenting owner record EEG for an existing session of theirs', async () => {
        await assertSucceeds(setDoc(doc(await as(players.a), recordingPath(players.a)), recordingData(players.a, seededSessionId)));
    });

    it('lets the owner write a new session and its recording in one batch', async () => {
        const database = await as(players.a);
        const batch = writeBatch(database);
        batch.set(doc(database, sessionPath(players.a, newSessionId)), sessionData(players.a));
        batch.set(doc(database, recordingPath(players.a)), recordingData(players.a, newSessionId));
        await assertSucceeds(batch.commit());
    });

    it('requires the linked session to exist after the write', async () => {
        await assertFails(setDoc(doc(await as(players.a), recordingPath(players.a)), recordingData(players.a, newSessionId)));
    });

    it("cannot link to another user's session", async () => {
        // player-b has a session with this ID; player-a does not.
        await seedDocuments({ [sessionPath(players.b, newSessionId)]: sessionData(players.b, { createdAt: past }) });
        await assertFails(setDoc(doc(await as(players.a), recordingPath(players.a)), recordingData(players.a, newSessionId)));
    });

    it('requires EEG consent on the profile', async () => {
        // player-b has no consent; legacy-user has no consumer profile; the last user has no profile at all.
        // Playing never needs a profile or consent; recording EEG does.
        for (const uid of [players.b, players.legacy, players.noProfile]) {
            const database = await as(uid);
            await assertSucceeds(setDoc(doc(database, sessionPath(uid, newSessionId)), sessionData(uid)));
            await assertFails(setDoc(doc(database, recordingPath(uid)), recordingData(uid, newSessionId)));
        }
    });

    it('counts consent granted in the same batch, and not consent withdrawn in it', async () => {
        const grant = await as(players.b);
        const granting = writeBatch(grant);
        granting.update(doc(grant, `users/${players.b}`), {
            'eeg.enabled': true, 'eeg.consent': { version: acceptedConsentVersion, grantedAt: serverTimestamp() }, updatedAt: serverTimestamp(),
        });
        granting.set(doc(grant, recordingPath(players.b)), recordingData(players.b, seededSessionId));
        await assertSucceeds(granting.commit());

        const withdraw = await as(players.a);
        const withdrawing = writeBatch(withdraw);
        withdrawing.update(doc(withdraw, `users/${players.a}`), { 'eeg.consent': null, updatedAt: serverTimestamp() });
        withdrawing.set(doc(withdraw, recordingPath(players.a)), recordingData(players.a, seededSessionId));
        await assertFails(withdrawing.commit());
    });

    it("denies writing into another user's recordings and unauthenticated writes", async () => {
        await assertFails(setDoc(doc(await as(players.b), recordingPath(players.a)), recordingData(players.a, seededSessionId)));
        await assertFails(setDoc(doc(await as(players.b), recordingPath(players.a)), recordingData(players.b, seededSessionId)));
        await assertFails(setDoc(doc(await anonymous(), recordingPath(players.a)), recordingData(players.a, seededSessionId)));
    });

    it('requires the stored userId to match the path uid', async () => {
        await assertFails(setDoc(doc(await as(players.a), recordingPath(players.a)), recordingData(players.b, seededSessionId)));
    });

    it('records provenance: measured or simulated, never as a device model', async () => {
        const database = await as(players.a);
        await assertSucceeds(setDoc(doc(database, recordingPath(players.a)), recordingData(players.a, seededSessionId, { source: 'simulated' })));
        const other = recordingPath(players.a, 'recording-new-000000002');
        await assertFails(setDoc(doc(database, other), recordingData(players.a, seededSessionId, { source: 'demo' })));
        await assertFails(setDoc(doc(database, other), recordingData(players.a, seededSessionId, { source: null })));
        await assertFails(setDoc(doc(database, other), without(recordingData(players.a, seededSessionId), 'source')));
        for (const model of ['simulated', 'demo', 'synthetic']) {
            await assertFails(setDoc(doc(database, other), recordingData(players.a, seededSessionId, {
                device: { ...recordingData(players.a, seededSessionId).device, model },
            })));
        }
    });

    it('rejects raw samples, affective labels, neurofeedback concepts and device identifiers', async () => {
        const database = await as(players.a);
        const base = recordingData(players.a, seededSessionId);
        for (const key of ['samples', 'rawSamples', 'rawCapture', 'valence', 'arousal', 'emotion', 'state', 'inZone', 'zoneScore', 'protocolId', 'score']) {
            await assertFails(setDoc(doc(database, recordingPath(players.a)), { ...base, [key]: [] }));
        }
        for (const key of ['valence', 'arousal', 'emotion', 'focus']) {
            await assertFails(setDoc(doc(database, recordingPath(players.a)), { ...base, summary: { ...base.summary, [key]: null } }));
        }
        for (const key of ['serialNumber', 'macAddress', 'peripheralId']) {
            await assertFails(setDoc(doc(database, recordingPath(players.a)), { ...base, device: { ...base.device, [key]: 'x' } }));
        }
    });

    it('rejects a recording missing any required key', async () => {
        const database = await as(players.a);
        const base = recordingData(players.a, seededSessionId);
        for (const key of Object.keys(base)) {
            await assertFails(setDoc(doc(database, recordingPath(players.a)), without(base, key)));
        }
    });

    it('requires createdAt to be the server clock', async () => {
        await assertFails(setDoc(doc(await as(players.a), recordingPath(players.a)), recordingData(players.a, seededSessionId, { createdAt: past })));
    });

    it('rejects malformed recordings', async () => {
        const database = await as(players.a);
        const base = recordingData(players.a, seededSessionId);
        const malformed: Record<string, unknown>[] = [
            { schemaVersion: 2 },
            { gameSessionId: 'short' },
            { startedAt: base.endedAt, endedAt: base.startedAt },
            { device: { ...base.device, channels: [] } },
            {
                device: { ...base.device, channels: ['TP9', 'TP9'] },
                quality: { ...base.quality, channelGoodFraction: { TP9: 0.9 } },
            },
            { quality: { ...base.quality, channelGoodFraction: { ...base.quality.channelGoodFraction, Fpz: 0.5 } } },
            { device: { ...base.device, transport: 'usb' } },
            { device: { ...base.device, sampleRateHz: 0 } },
            { processing: { ...base.processing, service: 'waveable-service' } },
            { processing: { ...base.processing, featureVersion: 0 } },
            { calibration: { ...base.calibration, status: 'done' } },
            { quality: { ...base.quality, windowsUsable: 21 } },
            { quality: { ...base.quality, usableFraction: 1.5 } },
            { summary: { ...base.summary, mindfulness: { mean: 0.5 } } },
            { summary: { ...base.summary, relativeBandPower: { mu: 0.1 } } },
            { summary: { ...base.summary, relativeBandPower: { alpha: 2 } } },
            { timeline: { ...base.timeline, bucketSeconds: 5 } },
            { timeline: { bucketSeconds: 10, mindfulness: Array(361).fill(0.5), restfulness: Array(361).fill(0.5) } },
            { timeline: { bucketSeconds: 10, mindfulness: [0.5], restfulness: [] } },
        ];
        for (const overrides of malformed) {
            await assertFails(setDoc(doc(database, recordingPath(players.a)), recordingData(players.a, seededSessionId, overrides)));
        }
        await assertSucceeds(setDoc(doc(database, recordingPath(players.a)), recordingData(players.a, seededSessionId, {
            timeline: null, summary: { mindfulness: null, restfulness: null, relativeBandPower: { alpha: 0.4 } },
        })));
    });

    it('requires a well-formed client-generated recording ID', async () => {
        await assertFails(setDoc(doc(await as(players.a), recordingPath(players.a, 'short')), recordingData(players.a, seededSessionId)));
    });
});

describe('users/{uid}/eegRecordings: update and delete', () => {
    it('never lets a client update a recording', async () => {
        await assertFails(updateDoc(doc(await as(players.a), recordingPath(players.a, seededRecordingId)), { source: 'measured' }));
        await assertFails(updateDoc(doc(await as(players.a), recordingPath(players.a, seededRecordingId)), { gameSessionId: 'session-other-00000001' }));
    });

    it('lets only the owner delete a recording', async () => {
        await assertFails(deleteDoc(doc(await as(players.b), recordingPath(players.a, seededRecordingId))));
        await assertFails(deleteDoc(doc(await anonymous(), recordingPath(players.a, seededRecordingId))));
        await assertSucceeds(deleteDoc(doc(await as(players.a), recordingPath(players.a, seededRecordingId))));
    });
});

describe('users/{uid}/eegRecordings: read', () => {
    it('lets the owner get and query their recordings', async () => {
        const database = await as(players.a);
        const recordings = collection(database, `users/${players.a}/eegRecordings`);
        await assertSucceeds(getDoc(doc(database, recordingPath(players.a, seededRecordingId))));
        await assertSucceeds(getDocs(query(recordings, orderBy('startedAt', 'desc'), limit(20))));
        await assertSucceeds(getDocs(query(recordings, where('gameSessionId', '==', seededSessionId))));
    });

    it('denies other users and unauthenticated reads', async () => {
        await assertFails(getDoc(doc(await as(players.b), recordingPath(players.a, seededRecordingId))));
        await assertFails(getDocs(collection(await as(players.b), `users/${players.a}/eegRecordings`)));
        await assertFails(getDoc(doc(await anonymous(), recordingPath(players.a, seededRecordingId))));
    });
});
