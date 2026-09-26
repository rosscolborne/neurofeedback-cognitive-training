import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
    collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, updateDoc, writeBatch,
    type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeEach, describe, it } from 'vitest';
import { anonymous, as, closeEnvironment, ids, resetWorld, seededMessageId } from './fixture';

beforeEach(resetWorld);
afterAll(closeEnvironment);

type SendOptions = {
    patientId?: string;
    clinicianId?: string;
    senderId?: string;
    senderRole?: 'patient' | 'clinician';
    text?: string;
    summaryText?: string;
    newThread?: boolean;
    writeMessage?: boolean;
};

/** The app's sendMessage transaction: an immutable message plus the thread summary. */
function send(database: Firestore, sender: string, messageId: string, options: SendOptions = {}) {
    const patientId = options.patientId ?? ids.patientA;
    const clinicianId = options.clinicianId ?? ids.clinicianA;
    const senderRole = options.senderRole ?? (sender === patientId ? 'patient' : 'clinician');
    const text = options.text ?? 'hello there';
    const threadPath = `messageThreads/${patientId}/relationships/${clinicianId}`;
    const batch = writeBatch(database);
    batch.set(doc(database, threadPath), {
        patientId, clinicianId, participantIds: [patientId, clinicianId], lastMessageText: options.summaryText ?? text,
        lastMessageId: messageId, lastSenderId: sender, lastMessageAt: serverTimestamp(), updatedAt: serverTimestamp(),
        schemaVersion: 1, ...(options.newThread ? { createdAt: serverTimestamp() } : {}),
    }, { merge: true });
    if (options.writeMessage ?? true) {
        batch.set(doc(database, `${threadPath}/messages/${messageId}`), {
            id: messageId, patientId, clinicianId, senderId: options.senderId ?? sender, senderRole, text, createdAt: serverTimestamp(), schemaVersion: 1,
        });
    }
    return batch.commit();
}

describe('messageThreads: sending', () => {
    it('lets both current participants send into their relationship thread', async () => {
        await assertSucceeds(send(await as(ids.patientA), ids.patientA, 'msg-from-patient'));
        await assertSucceeds(send(await as(ids.clinicianA), ids.clinicianA, 'msg-from-clinician'));
    });

    it('lets a linked pair start a new thread', async () => {
        await assertSucceeds(send(await as(ids.patientB), ids.patientB, 'first', { patientId: ids.patientB, clinicianId: ids.clinicianB, newThread: true }));
    });

    it('rejects outsiders, clinic colleagues, and a patient writing into a thread with a clinician they are not linked to', async () => {
        await assertFails(send(await as(ids.clinicianB), ids.clinicianB, 'intrusion'));
        await assertFails(send(await as(ids.colleagueA), ids.colleagueA, 'colleague'));
        await assertFails(send(await as(ids.patientB), ids.patientB, 'intrusion'));
        await assertFails(send(await as(ids.patientA), ids.patientA, 'wrong-clinician', { clinicianId: ids.clinicianB, newThread: true }));
        await assertFails(send(await as(ids.unlinked), ids.unlinked, 'after-unlink', { patientId: ids.unlinked }));
    });

    it('rejects forged senders, wrong roles, mismatched summaries, and invalid text', async () => {
        const patientA = await as(ids.patientA);
        await assertFails(send(patientA, ids.patientA, 'forged', { senderId: ids.clinicianA }));
        await assertFails(send(patientA, ids.patientA, 'role', { senderRole: 'clinician' }));
        await assertFails(send(patientA, ids.patientA, 'summary', { summaryText: 'different' }));
        await assertFails(send(patientA, ids.patientA, 'blank', { text: '   ' }));
        await assertFails(send(patientA, ids.patientA, 'long', { text: 'x'.repeat(4001) }));
    });

    it('rejects a summary rewrite without a new message, and a message without a summary update', async () => {
        const patientA = await as(ids.patientA);
        await assertFails(send(patientA, ids.patientA, seededMessageId, { writeMessage: false, text: 'rewritten' }));
        await assertFails(setDoc(doc(patientA, `messageThreads/${ids.patientA}/relationships/${ids.clinicianA}/messages/lonely`), {
            id: 'lonely', patientId: ids.patientA, clinicianId: ids.clinicianA, senderId: ids.patientA, senderRole: 'patient',
            text: 'no summary', createdAt: serverTimestamp(), schemaVersion: 1,
        }));
    });

    it('keeps messages and threads immutable and undeletable', async () => {
        const clinicianA = await as(ids.clinicianA);
        const messagePath = `messageThreads/${ids.patientA}/relationships/${ids.clinicianA}/messages/${seededMessageId}`;
        await assertFails(updateDoc(doc(clinicianA, messagePath), { text: 'edited' }));
        await assertFails(deleteDoc(doc(clinicianA, messagePath)));
        await assertFails(deleteDoc(doc(clinicianA, `messageThreads/${ids.patientA}/relationships/${ids.clinicianA}`)));
    });
});

describe('messageThreads: reading', () => {
    const threadPath = `messageThreads/${ids.patientA}/relationships/${ids.clinicianA}`;
    const page = (database: Firestore, path: string) =>
        getDocs(query(collection(database, `${path}/messages`), orderBy('createdAt', 'desc'), limit(20)));

    it('lets both participants read the thread and page its messages', async () => {
        await assertSucceeds(getDoc(doc(await as(ids.patientA), threadPath)));
        await assertSucceeds(page(await as(ids.patientA), threadPath));
        await assertSucceeds(getDoc(doc(await as(ids.clinicianA), threadPath)));
        await assertSucceeds(page(await as(ids.clinicianA), threadPath));
    });

    it('denies other patients, other clinicians, clinic colleagues, and anonymous users', async () => {
        for (const uid of [ids.patientB, ids.clinicianB, ids.colleagueA]) {
            await assertFails(getDoc(doc(await as(uid), threadPath)));
            await assertFails(page(await as(uid), threadPath));
        }
        await assertFails(getDoc(doc(await anonymous(), threadPath)));
    });

    it("cuts a former clinician's access once the patient is unlinked", async () => {
        const formerThread = `messageThreads/${ids.unlinked}/relationships/${ids.clinicianA}`;
        await assertFails(getDoc(doc(await as(ids.clinicianA), formerThread)));
        await assertSucceeds(getDoc(doc(await as(ids.unlinked), formerThread)));
    });
});

describe('legacy messages/{patientId}', () => {
    it('is readable by the patient and their current clinician and never writable', async () => {
        await assertSucceeds(getDoc(doc(await as(ids.patientA), `messages/${ids.patientA}`)));
        await assertSucceeds(getDoc(doc(await as(ids.clinicianA), `messages/${ids.patientA}`)));
        await assertFails(getDoc(doc(await as(ids.clinicianB), `messages/${ids.patientA}`)));
        await assertFails(getDoc(doc(await as(ids.patientB), `messages/${ids.patientA}`)));
        await assertFails(setDoc(doc(await as(ids.patientA), `messages/${ids.patientA}`), { patientId: ids.patientA, messages: [] }));
        await assertFails(setDoc(doc(await as(ids.patientB), `messages/${ids.patientB}`), { patientId: ids.patientB, clinicianId: ids.clinicianA }));
    });
});
