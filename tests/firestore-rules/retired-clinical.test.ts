import { assertFails } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeEach, describe, it } from 'vitest';
import { anonymous, as, closeEnvironment, past, seedDocuments } from './fixture';
import { players, resetConsumerWorld } from './consumer/consumerFixture';

// The clinical product's collections have no rules: everything outside
// users/{uid} and the server-only ledger falls under the default deny. A
// player's own leftover documents there grant them nothing either.

beforeEach(resetConsumerWorld);
afterAll(closeEnvironment);

const owner = players.a;
const leftovers = {
    [`clients/${owner}`]: { id: owner, name: 'Player', email: 'player-a@example.test', status: 'active' },
    [`clients/${owner}/brainMaps/bm-1`]: { id: 'bm-1', schemaVersion: 1 },
    'sessions/session-1': { id: 'session-1', patientId: owner, isDemo: true },
    [`patientInvitations/INVA-AAAA-AAAA`]: { id: 'INVA-AAAA-AAAA', patientId: owner, status: 'accepted', createdAt: past },
    [`messageThreads/${owner}/relationships/clinician-1`]: { patientId: owner, participantIds: [owner, 'clinician-1'] },
    [`messages/${owner}`]: { patientId: owner, messages: [] },
    'appointments/appt-1': { patientId: owner, status: 'scheduled' },
    'clinics/clinic-1': { id: 'clinic-1', practitionerIds: [owner] },
    [`practitioners/${owner}`]: { id: owner, userId: owner },
    [`deviceAssignments/${owner}`]: { patientId: owner, deviceId: 'muse-1' },
    'brands/brand-1': { name: 'Brand' },
    'protocolCatalog/protocol-1': { id: 'protocol-1', name: 'Protocol' },
};

describe('retired clinical collections', () => {
    it('deny every read and write, including to the player a leftover document names', async () => {
        await seedDocuments(leftovers);
        for (const database of [await as(owner), await as(players.b), await anonymous()]) {
            for (const path of Object.keys(leftovers)) {
                await assertFails(getDoc(doc(database, path)));
                await assertFails(setDoc(doc(database, path), { touched: true }));
                await assertFails(updateDoc(doc(database, path), { touched: true }));
                await assertFails(deleteDoc(doc(database, path)));
            }
        }
    });

    it('deny creating a clients/{uid} profile, even for the signed-in player', async () => {
        const database = await as(players.noProfile);
        await assertFails(setDoc(doc(database, `clients/${players.noProfile}`), { id: players.noProfile, name: 'New', status: 'active' }));
        await assertFails(getDocs(collection(database, 'clients')));
        await assertFails(getDocs(collection(database, 'sessions')));
    });
});
