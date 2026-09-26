// DRAFT (Track A, stage 2): run only against firestore.rules.proposed-revocation.
// A suspended/revoked clinician grant must also end relationship-based access
// (canonical patient ownership and clinic membership), not only new writes.
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { afterAll, beforeEach, describe, it } from 'vitest';
import { as, clinicA, closeEnvironment, ids, resetWorld, seedDocuments } from '../../fixture';

const v = (uid: string) => as(uid, { email_verified: true });
const active = (displayName: string) => ({ status: 'active', displayName });

beforeEach(async () => {
    await resetWorld();
    await seedDocuments({
        [`clinicianAccess/${ids.clinicianA}`]: active('Dr A'),
        [`clinicianAccess/${ids.colleagueA}`]: active('Dr A2'),
        [`clinicianAccess/${ids.clinicianB}`]: active('Dr B'),
    });
});
afterAll(closeEnvironment);

function sendAsClinicianA(database: Awaited<ReturnType<typeof v>>) {
    const id = 'msg-revocation-1';
    const base = `messageThreads/${ids.patientA}/relationships/${ids.clinicianA}`;
    const batch = writeBatch(database);
    batch.set(doc(database, `${base}/messages/${id}`), {
        id, patientId: ids.patientA, clinicianId: ids.clinicianA, senderId: ids.clinicianA, senderRole: 'clinician',
        text: 'hi', createdAt: serverTimestamp(), schemaVersion: 1,
    });
    batch.update(doc(database, base), {
        lastMessageId: id, lastMessageText: 'hi', lastSenderId: ids.clinicianA,
        lastMessageAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    return batch.commit();
}

describe('stage 2: grant revocation ends relationship access', () => {
    it('an active, verified clinician keeps full access (sanity)', async () => {
        const database = await v(ids.clinicianA);
        await assertSucceeds(getDoc(doc(database, `clients/${ids.patientA}`)));
        await assertSucceeds(getDoc(doc(database, 'sessions/session-a')));
        await assertSucceeds(getDoc(doc(database, `clinics/${clinicA}`)));
        await assertSucceeds(getDocs(query(collection(database, 'clients'), where('clinicianId', '==', ids.clinicianA))));
        await assertSucceeds(sendAsClinicianA(database));
    });

    for (const status of ['suspended', 'revoked']) {
        it(`a ${status} clinician loses patient, session, clinic and messaging access`, async () => {
            await seedDocuments({ [`clinicianAccess/${ids.clinicianA}`]: { status, displayName: 'Dr A' } });
            const database = await v(ids.clinicianA);
            await assertFails(getDoc(doc(database, `clients/${ids.patientA}`)));
            await assertFails(getDoc(doc(database, 'sessions/session-a')));
            await assertFails(getDoc(doc(database, `clients/${ids.patientA}/brainMaps/bm-a`)));
            await assertFails(getDoc(doc(database, `clinics/${clinicA}`)));
            await assertFails(getDoc(doc(database, 'protocolCatalog/protocol-a')));
            await assertFails(getDocs(query(collection(database, 'clients'), where('clinicianId', '==', ids.clinicianA))));
            await assertFails(sendAsClinicianA(database));
        });
    }

    it('a colleague without an active grant loses clinic-membership access', async () => {
        await seedDocuments({ [`clinicianAccess/${ids.colleagueA}`]: { status: 'suspended', displayName: 'Dr A2' } });
        await assertFails(getDoc(doc(await v(ids.colleagueA), `clients/${ids.patientA}`)));
        await assertFails(getDoc(doc(await v(ids.colleagueA), 'sessions/session-a')));
    });

    it('an unverified email alone suspends clinician access', async () => {
        await assertFails(getDoc(doc(await as(ids.clinicianA, { email_verified: false }), `clients/${ids.patientA}`)));
    });

    it('the patient keeps access to their own records after the clinician is revoked', async () => {
        await seedDocuments({ [`clinicianAccess/${ids.clinicianA}`]: { status: 'revoked', displayName: 'Dr A' } });
        const database = await as(ids.patientA, { email_verified: false });
        await assertSucceeds(getDoc(doc(database, `clients/${ids.patientA}`)));
        await assertSucceeds(getDoc(doc(database, 'sessions/session-a')));
        await assertSucceeds(getDoc(doc(database, `messageThreads/${ids.patientA}/relationships/${ids.clinicianA}`)));
    });
});
