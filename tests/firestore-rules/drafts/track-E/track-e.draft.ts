// Track E draft rules tests (LOW items). Not part of npm run test:rules.
//   RULES_FILE=<scratch>/firestore.rules.fixnow  -> E1 + E5a (brands) + as-is pins
//   RULES_FILE=<scratch>/firestore.rules.all TRACK_E_OPTIONAL=1
//                                                -> also optional E3 (clinic sizes)
//                                                   and E5b (protocolCatalog writes closed)
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeEach, describe, it } from 'vitest';
import { anonymous, as, clinicA, closeEnvironment, emailOf, future, ids, past, resetWorld, seedDocuments } from '../../fixture';

beforeEach(resetWorld);
afterAll(closeEnvironment);

const optional = process.env.TRACK_E_OPTIONAL === '1' ? it : it.skip;

function acceptBatch(db: Awaited<ReturnType<typeof as>>, code: string, clinicId: string | null) {
    const batch = writeBatch(db);
    batch.update(doc(db, `patientInvitations/${code}`), { status: 'accepted', patientId: ids.unlinked, acceptedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    batch.set(doc(db, `clients/${ids.unlinked}`), { clinicianId: ids.clinicianA, clinicId, acceptedInvitationId: code }, { merge: true });
    return batch;
}

describe('E1: invitations must carry a timestamp expiry to be accepted', () => {
    it('rejects a legacy invitation with no expiresAt', async () => {
        await seedDocuments({
            'patientInvitations/LEGA-CYXX-XXXX': {
                id: 'LEGA-CYXX-XXXX', clinicianId: ids.clinicianA, patientEmail: emailOf(ids.unlinked), patientName: 'U', status: 'pending',
            },
        });
        await assertFails(acceptBatch(await as(ids.unlinked), 'LEGA-CYXX-XXXX', null).commit());
    });

    it('rejects a non-timestamp expiresAt (legacy millis number)', async () => {
        await seedDocuments({
            'patientInvitations/NUMB-ERXX-XXXX': {
                id: 'NUMB-ERXX-XXXX', clinicianId: ids.clinicianA, clinicId: clinicA, patientEmail: emailOf(ids.unlinked), patientName: 'U',
                status: 'pending', expiresAt: Date.now() + 86_400_000,
            },
        });
        await assertFails(acceptBatch(await as(ids.unlinked), 'NUMB-ERXX-XXXX', clinicA).commit());
    });

    it('still accepts an invitation with a future timestamp expiry (no claim)', async () => {
        await seedDocuments({
            'patientInvitations/CURR-ENTX-XXXX': {
                id: 'CURR-ENTX-XXXX', clinicianId: ids.clinicianA, clinicId: clinicA, patientEmail: emailOf(ids.unlinked), patientName: 'U',
                status: 'pending', expiresAt: future(),
            },
        });
        await assertSucceeds(acceptBatch(await as(ids.unlinked), 'CURR-ENTX-XXXX', clinicA).commit());
    });

    it('lets the clinician still cancel a legacy no-expiry invitation', async () => {
        await seedDocuments({
            'patientInvitations/LEGA-CYXX-XXXX': {
                id: 'LEGA-CYXX-XXXX', clinicianId: ids.clinicianA, patientEmail: emailOf(ids.unlinked), patientName: 'U', status: 'pending',
            },
        });
        await assertSucceeds(updateDoc(doc(await as(ids.clinicianA), 'patientInvitations/LEGA-CYXX-XXXX'), { status: 'cancelled', updatedAt: serverTimestamp() }));
    });
});

describe('E2 (as-is, documented): superseded expired invitation', () => {
    const email = emailOf(ids.unlinked);
    const claimPath = `patientInvitationClaims/${ids.clinicianA}/emails/${email}`;
    const base = { clinicianId: ids.clinicianA, clinicId: clinicA, patientEmail: email, patientName: 'U', status: 'pending', uniquenessClaimId: email, createdAt: past, updatedAt: past };

    async function seedSuperseded() {
        const fresh = future();
        await seedDocuments({
            'patientInvitations/OLDX-OLDX-OLDX': { ...base, id: 'OLDX-OLDX-OLDX', expiresAt: Timestamp.fromMillis(Date.now() - 60_000) },
            'patientInvitations/NEWX-NEWX-NEWX': { ...base, id: 'NEWX-NEWX-NEWX', expiresAt: fresh },
            [claimPath]: { clinicianId: ids.clinicianA, clinicId: clinicA, patientEmail: email, invitationId: 'NEWX-NEWX-NEWX', status: 'pending', expiresAt: fresh },
        });
    }

    it('is harmless: the stale "pending" document can never be accepted', async () => {
        await seedSuperseded();
        await assertFails(acceptBatch(await as(ids.unlinked), 'OLDX-OLDX-OLDX', clinicA).commit());
    });

    it("the app's cancel transaction (update + claim delete) fails, and must not take the live claim", async () => {
        await seedSuperseded();
        const db = await as(ids.clinicianA);
        const batch = writeBatch(db);
        batch.update(doc(db, 'patientInvitations/OLDX-OLDX-OLDX'), { status: 'cancelled', updatedAt: serverTimestamp() });
        batch.delete(doc(db, claimPath));
        await assertFails(batch.commit());
    });

    it('the live replacement invitation is still acceptable', async () => {
        await seedSuperseded();
        const db = await as(ids.unlinked);
        const batch = acceptBatch(db, 'NEWX-NEWX-NEWX', clinicA);
        batch.delete(doc(db, claimPath));
        await assertSucceeds(batch.commit());
    });
});

describe('E5a: legacy brands collection is closed', () => {
    it('denies reads and writes to anonymous and signed-in users', async () => {
        await assertFails(getDoc(doc(await anonymous(), 'brands/brand-a')));
        await assertFails(getDoc(doc(await as(ids.clinicianA), 'brands/brand-a')));
        await assertFails(setDoc(doc(await as(ids.clinicianA), 'brands/brand-a'), { name: 'x' }));
    });
});

describe('E3 [optional]: clinic size bounds mirror clinicSettingsRepository', () => {
    optional('accepts a realistic logo and the app onboarding shape; rejects oversize fields', async () => {
        const db = await as(ids.clinicianA);
        await assertSucceeds(updateDoc(doc(db, `clinics/${clinicA}`), { branding: { name: 'A', tagline: 't'.repeat(180), logoUrl: `data:image/png;base64,${'A'.repeat(600_000)}` } }));
        await assertSucceeds(setDoc(doc(db, `clinics/${clinicA}`), { name: 'n'.repeat(120), timezone: 'UTC', updatedAt: serverTimestamp() }, { merge: true }));
        await assertFails(updateDoc(doc(db, `clinics/${clinicA}`), { branding: { name: 'A', logoUrl: 'A'.repeat(700_001) } }));
        await assertFails(updateDoc(doc(db, `clinics/${clinicA}`), { name: 'n'.repeat(121) }));
        await assertFails(updateDoc(doc(db, `clinics/${clinicA}`), { branding: { name: 'A', tagline: 't'.repeat(181) } }));
        await assertFails(updateDoc(doc(db, `clinics/${clinicA}`), { branding: 'not-a-map' }));
    });
});

describe('E5b [optional]: protocolCatalog is read-only (app never writes it)', () => {
    optional('denies create and update even to clinic members; reads unchanged', async () => {
        await assertFails(setDoc(doc(await as(ids.clinicianA), 'protocolCatalog/new-a'), { id: 'new-a', clinicId: clinicA, name: 'A2' }));
        await assertFails(updateDoc(doc(await as(ids.colleagueA), 'protocolCatalog/protocol-a'), { name: 'Renamed' }));
        await assertSucceeds(getDoc(doc(await as(ids.colleagueA), 'protocolCatalog/protocol-a')));
        await assertSucceeds(getDoc(doc(await as(ids.patientA), 'protocolCatalog/protocol-a')));
    });
});
