import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
    deleteField, doc, runTransaction, serverTimestamp, setDoc, updateDoc, writeBatch, type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeEach, describe, it } from 'vitest';
import { as, clinicA, closeEnvironment, emailOf, future, ids, past, resetWorld, seedDocuments } from '../../fixture';

// Track B (M3) draft: field ownership on clients/{uid}. Run against the proposed
// rules copy. Covers direct writes, the session-create merge, invitation
// acceptance (update and create paths), and the patched app write shapes.

beforeEach(resetWorld);
afterAll(closeEnvironment);

const code = 'INVU-TRKB-TRKB';

async function seedInvitation(patientUid: string, care: Record<string, unknown> = {
    condition: 'Peak Performance', assignedProtocol: 'smr-enhancement', prescribedSessionsPerWeek: 3, notes: 'from Dr A',
}) {
    const email = emailOf(patientUid);
    await seedDocuments({
        [`patientInvitations/${code}`]: {
            id: code, clinicianId: ids.clinicianA, clinicId: clinicA, clinicianName: 'Dr A', patientEmail: email,
            patientName: 'Invited', status: 'pending', uniquenessClaimId: email, schemaVersion: 1,
            createdAt: past, updatedAt: past, expiresAt: future(), ...care,
        },
        [`patientInvitationClaims/${ids.clinicianA}/emails/${email}`]: {
            clinicianId: ids.clinicianA, clinicId: clinicA, patientEmail: email, invitationId: code, status: 'pending', expiresAt: future(),
        },
    });
}

/** acceptPatientInvitation transaction; `profile` is the clients/{uid} merge payload. */
function accept(database: Firestore, patientUid: string, profile: Record<string, unknown>) {
    const email = emailOf(patientUid);
    return runTransaction(database, async (transaction) => {
        await transaction.get(doc(database, `patientInvitations/${code}`));
        await transaction.get(doc(database, `clients/${patientUid}`));
        transaction.set(doc(database, `clients/${patientUid}`), { ...profile, updatedAt: serverTimestamp() }, { merge: true });
        transaction.set(doc(database, `patientInvitations/${code}`), {
            status: 'accepted', patientId: patientUid, acceptedAt: serverTimestamp(), updatedAt: serverTimestamp(),
        }, { merge: true });
        transaction.delete(doc(database, `patientInvitationClaims/${ids.clinicianA}/emails/${email}`));
    });
}

/** Patched acceptance payload: relationship + invitation care plan, clearing whatever the invitation omits. */
function patchedAcceptPayload(patientUid: string, care: Record<string, unknown>) {
    const value = (key: string) => (care[key] === undefined ? deleteField() : care[key]);
    return {
        id: patientUid, patientId: patientUid, email: emailOf(patientUid),
        clinicianId: ids.clinicianA, clinicId: clinicA, acceptedInvitationId: code,
        condition: value('condition'), assignedProtocol: value('assignedProtocol'),
        prescribedSessionsPerWeek: value('prescribedSessionsPerWeek'), notes: value('notes'),
        customProtocolConfig: deleteField(), customThresholdBounds: deleteField(),
    };
}

const invitedCare = { condition: 'Peak Performance', assignedProtocol: 'smr-enhancement', prescribedSessionsPerWeek: 3, notes: 'from Dr A' };

/** Patched createSession: session create + aggregate-only merge onto the profile. */
function createSession(
    database: Firestore, sessionId: string, patientId: string,
    aggregates: (current: Record<string, unknown>) => Record<string, unknown> = (current) => ({
        completedSessionsCount: ((current.completedSessionsCount as number) ?? 0) + 1,
        lastSessionDate: new Date().toISOString(),
        recentCompletedSessionIds: [sessionId, ...((current.recentCompletedSessionIds as string[]) ?? [])].slice(0, 100),
        badges: [...new Set([...((current.badges as string[]) ?? []), 'first-light'])],
    }),
    sessionExtra: Record<string, unknown> = {},
) {
    return runTransaction(database, async (transaction) => {
        const client = await transaction.get(doc(database, `clients/${patientId}`));
        transaction.set(doc(database, `sessions/${sessionId}`), {
            id: sessionId, patientId, clinicId: clinicA, isDemo: false, timeInZonePercent: 50,
            createdAt: serverTimestamp(), updatedAt: serverTimestamp(), completedAt: serverTimestamp(), ...sessionExtra,
        });
        transaction.set(doc(database, `clients/${patientId}`), {
            ...aggregates(client.data() ?? {}), updatedAt: serverTimestamp(),
        }, { merge: true });
    });
}

describe('linked patient cannot write the clinician-owned care plan directly', () => {
    const forged: Record<string, unknown> = {
        condition: 'Generalized Anxiety',
        assignedProtocol: 'alpha-enhancement',
        customProtocolConfig: { name: 'forged', freqMin: 1, freqMax: 40 },
        customThresholdBounds: { min: 0, max: 1000 },
        allowedExperiences: ['neuro-gambit'],
        prescribedSessionsPerWeek: 0,
        notes: 'patient edited',
        status: 'completed',
    };
    for (const [field, value] of Object.entries(forged)) {
        it(`rejects ${field}`, async () => {
            await assertFails(updateDoc(doc(await as(ids.patientA), `clients/${ids.patientA}`), { [field]: value }));
        });
    }

    it('rejects deleting a prescribed field', async () => {
        await assertFails(updateDoc(doc(await as(ids.patientA), `clients/${ids.patientA}`), { assignedProtocol: deleteField() }));
    });

    it('rejects frozen legacy and bookkeeping fields', async () => {
        const reference = doc(await as(ids.patientA), `clients/${ids.patientA}`);
        await assertFails(updateDoc(reference, { brainMaps: [{ id: 'forged', zScores: { frontalTheta: 99 } }] }));
        await assertFails(updateDoc(reference, { isDemo: true }));
        await assertFails(updateDoc(reference, { schemaVersion: 7 }));
        await assertFails(updateDoc(reference, { currentStreak: 99 }));
        await assertFails(updateDoc(reference, { skylineBiomesUnlocked: ['a', 'b', 'c', 'd', 'e'] }));
    });

    it('rejects session aggregates without a new session', async () => {
        const reference = doc(await as(ids.patientA), `clients/${ids.patientA}`);
        await assertFails(updateDoc(reference, { completedSessionsCount: 999 }));
        await assertFails(updateDoc(reference, { badges: ['deep-focus'] }));
        await assertFails(updateDoc(reference, { recentCompletedSessionIds: ['session-a'] }));
    });

    it('rejects identity values that are not their own', async () => {
        const reference = doc(await as(ids.patientA), `clients/${ids.patientA}`);
        await assertFails(updateDoc(reference, { email: emailOf(ids.patientB) }));
        await assertFails(updateDoc(reference, { id: ids.patientB }));
        await assertFails(updateDoc(reference, { patientId: ids.patientB }));
    });
});

describe('patient-owned profile fields stay writable', () => {
    it('name, avatar, calibration, and a pinned email/id/patientId', async () => {
        const reference = doc(await as(ids.patientA), `clients/${ids.patientA}`);
        await assertSucceeds(updateDoc(reference, { name: 'Renamed', updatedAt: serverTimestamp() }));
        await assertSucceeds(updateDoc(reference, { avatarUrl: 'data:image/png;base64,AAAA' }));
        await assertSucceeds(updateDoc(reference, {
            individualBaselineModel: { alphaPeakHz: 10, oneOverFSlope: 1.2, lastCalibratedAt: '2026-09-25T00:00:00Z' },
            updatedAt: serverTimestamp(),
        }));
        await assertSucceeds(updateDoc(reference, { patientId: ids.patientA, email: emailOf(ids.patientA).toUpperCase() }));
    });

    it('patched HardwareSetup writes calibration without touching status; the old status reset is denied', async () => {
        await seedDocuments({ [`clients/${ids.patientA}`]: {
            id: ids.patientA, email: emailOf(ids.patientA), name: 'A', status: 'paused',
            clinicianId: ids.clinicianA, clinicId: clinicA, acceptedInvitationId: 'INVA-AAAA-AAAA', assignedProtocol: 'theta-beta-ratio',
        } });
        const reference = doc(await as(ids.patientA), `clients/${ids.patientA}`);
        await assertSucceeds(setDoc(reference, { individualBaselineModel: { alphaPeakHz: 10 }, updatedAt: serverTimestamp() }, { merge: true }));
        await assertFails(setDoc(reference, { individualBaselineModel: { alphaPeakHz: 11 }, status: 'active' }, { merge: true }));
    });

    it('a full-profile merge that only re-sends unchanged values is not an edit', async () => {
        const reference = doc(await as(ids.patientA), `clients/${ids.patientA}`);
        await assertSucceeds(setDoc(reference, {
            id: ids.patientA, email: emailOf(ids.patientA), name: 'Renamed', assignedProtocol: 'theta-beta-ratio',
            clinicianId: ids.clinicianA, clinicId: clinicA, acceptedInvitationId: 'INVA-AAAA-AAAA',
        }, { merge: true }));
    });

    it('the unpatched normalized full-profile save is denied once normalization adds defaults', async () => {
        // readClientProfile adds schemaVersion: 1, brainMaps: [], badges: [], allowedExperiences: [].
        const reference = doc(await as(ids.patientA), `clients/${ids.patientA}`);
        await assertFails(setDoc(reference, {
            id: ids.patientA, email: emailOf(ids.patientA), name: 'Renamed', assignedProtocol: 'theta-beta-ratio',
            clinicianId: ids.clinicianA, clinicId: clinicA, acceptedInvitationId: 'INVA-AAAA-AAAA',
            schemaVersion: 1, brainMaps: [], badges: [], allowedExperiences: [],
        }, { merge: true }));
    });
});

describe('self-guided (unlinked) patient protocol choice', () => {
    it('may choose and change their own protocol and drop a stale custom template', async () => {
        const reference = doc(await as(ids.unlinked), `clients/${ids.unlinked}`);
        await assertSucceeds(updateDoc(reference, {
            assignedProtocol: 'alpha-enhancement', customProtocolConfig: deleteField(), customThresholdBounds: deleteField(),
        }));
    });

    it('may not set a template, bounds, condition, notes, target, status, or experiences', async () => {
        const reference = doc(await as(ids.unlinked), `clients/${ids.unlinked}`);
        await assertFails(updateDoc(reference, { customProtocolConfig: { name: 'x' } }));
        await assertFails(updateDoc(reference, { customThresholdBounds: { min: 0, max: 1000 } }));
        await assertFails(updateDoc(reference, { condition: 'Peak Performance' }));
        await assertFails(updateDoc(reference, { notes: 'self' }));
        await assertFails(updateDoc(reference, { prescribedSessionsPerWeek: 7 }));
        await assertFails(updateDoc(reference, { status: 'paused' }));
        await assertFails(updateDoc(reference, { allowedExperiences: ['neuro-gambit'] }));
    });

    it('a linked patient loses the protocol choice', async () => {
        await assertFails(updateDoc(doc(await as(ids.patientA), `clients/${ids.patientA}`), { assignedProtocol: 'alpha-enhancement' }));
    });
});

describe('profile creation holds only defaults', () => {
    const fresh = 'fresh-patient';
    const blank = () => ({
        id: fresh, patientId: fresh, name: 'Fresh', email: emailOf(fresh), status: 'active',
        allowedExperiences: ['immersive-3d', 'generative-music', 'neuro-gambit'],
        completedSessionsCount: 0, currentStreak: 0, brainMaps: [], badges: [], isDemo: false,
    });

    it('accepts the createBlankProfile shape', async () => {
        await assertSucceeds(setDoc(doc(await as(fresh), `clients/${fresh}`), blank()));
    });

    it('rejects seeded care plan, aggregates, legacy QEEG, or foreign identity', async () => {
        const reference = doc(await as(fresh), `clients/${fresh}`);
        await assertFails(setDoc(reference, { ...blank(), condition: 'ADHD (Combined)' }));
        await assertFails(setDoc(reference, { ...blank(), assignedProtocol: 'alpha-enhancement' }));
        await assertFails(setDoc(reference, { ...blank(), customProtocolConfig: { name: 'x' } }));
        await assertFails(setDoc(reference, { ...blank(), customThresholdBounds: { min: 0, max: 1000 } }));
        await assertFails(setDoc(reference, { ...blank(), status: 'paused' }));
        await assertFails(setDoc(reference, { ...blank(), allowedExperiences: ['not-an-experience'] }));
        await assertFails(setDoc(reference, { ...blank(), completedSessionsCount: 50 }));
        await assertFails(setDoc(reference, { ...blank(), badges: ['deep-focus'] }));
        await assertFails(setDoc(reference, { ...blank(), brainMaps: [{ id: 'forged' }] }));
        await assertFails(setDoc(reference, { ...blank(), email: emailOf(ids.patientA) }));
        await assertFails(setDoc(reference, { ...blank(), patientId: ids.patientA }));
    });
});

describe('session-create merge cannot carry clinician fields or inflate aggregates', () => {
    it('patched shape works for the patient, canonical clinician, and clinic colleague', async () => {
        await assertSucceeds(createSession(await as(ids.patientA), 'b-patient', ids.patientA));
        await assertSucceeds(createSession(await as(ids.clinicianA), 'b-clinician', ids.patientA, undefined, { clinicianId: ids.clinicianA }));
        await assertSucceeds(createSession(await as(ids.colleagueA), 'b-colleague', ids.patientA));
    });

    it('the pre-change raw full merge of client.data() also still passes', async () => {
        const database = await as(ids.patientA);
        await assertSucceeds(runTransaction(database, async (transaction) => {
            const client = await transaction.get(doc(database, `clients/${ids.patientA}`));
            transaction.set(doc(database, 'sessions/b-raw'), { id: 'b-raw', patientId: ids.patientA, clinicId: clinicA });
            transaction.set(doc(database, `clients/${ids.patientA}`), {
                ...client.data(), completedSessionsCount: 1, recentCompletedSessionIds: ['b-raw'], badges: ['first-light'], updatedAt: serverTimestamp(),
            }, { merge: true });
        }));
    });

    it('rejects a care-plan change riding on the session merge', async () => {
        await assertFails(createSession(await as(ids.patientA), 'b-forge-1', ids.patientA, (current) => ({
            completedSessionsCount: ((current.completedSessionsCount as number) ?? 0) + 1,
            recentCompletedSessionIds: ['b-forge-1'], badges: ['first-light'],
            assignedProtocol: 'alpha-enhancement',
        })));
        await assertFails(createSession(await as(ids.patientA), 'b-forge-2', ids.patientA, (current) => ({
            completedSessionsCount: ((current.completedSessionsCount as number) ?? 0) + 1,
            recentCompletedSessionIds: ['b-forge-2'], badges: ['first-light'],
            notes: 'patient edited', prescribedSessionsPerWeek: 0,
        })));
    });

    it('a clinician cannot bundle a care-plan edit into a session merge either', async () => {
        await assertFails(createSession(await as(ids.clinicianA), 'b-forge-c', ids.patientA, () => ({
            completedSessionsCount: 1, recentCompletedSessionIds: ['b-forge-c'], badges: ['first-light'], status: 'paused',
        })));
    });

    it('rejects inflated counts, skipped ledgers, unknown badges, and forged garden growth', async () => {
        const patient = await as(ids.patientA);
        await assertFails(createSession(patient, 'b-count', ids.patientA, () => ({
            completedSessionsCount: 50, recentCompletedSessionIds: ['b-count'], badges: [],
        })));
        await assertFails(createSession(patient, 'b-ledger', ids.patientA, () => ({
            completedSessionsCount: 1, recentCompletedSessionIds: ['some-other-id'], badges: [],
        })));
        await assertFails(createSession(patient, 'b-badge', ids.patientA, () => ({
            completedSessionsCount: 1, recentCompletedSessionIds: ['b-badge'], badges: ['made-up'],
        })));
        await assertFails(createSession(patient, 'b-garden', ids.patientA, () => ({
            completedSessionsCount: 1, recentCompletedSessionIds: ['b-garden'], badges: [],
            tidalGardenState: { stage: 4, plantsUnlocked: [], growthPoints: 9999, lastWatered: 'x' },
        })));
    });

    it('rejects replaying an existing session ID or recording a session for someone else', async () => {
        const patient = await as(ids.patientA);
        // session-a already exists, so it is an update of a session, not a new one.
        await assertFails(runTransaction(patient, async (transaction) => {
            await transaction.get(doc(patient, `clients/${ids.patientA}`));
            transaction.set(doc(patient, `clients/${ids.patientA}`), {
                completedSessionsCount: 1, recentCompletedSessionIds: ['session-a'], badges: [],
            }, { merge: true });
        }));
        await assertFails(createSession(patient, 'b-other', ids.patientB));
    });

    it('bounded garden growth and a full 100-entry ledger roll over correctly', async () => {
        const ledger = Array.from({ length: 100 }, (_, index) => `old-${index}`);
        await seedDocuments({ [`clients/${ids.patientA}`]: {
            id: ids.patientA, email: emailOf(ids.patientA), name: 'A', clinicianId: ids.clinicianA, clinicId: clinicA,
            acceptedInvitationId: 'INVA-AAAA-AAAA', completedSessionsCount: 100, recentCompletedSessionIds: ledger,
            badges: ['first-light'], tidalGardenState: { stage: 1, plantsUnlocked: ['kelp'], growthPoints: 250, lastWatered: 'w' },
        } });
        await assertSucceeds(createSession(await as(ids.patientA), 'b-roll', ids.patientA, () => ({
            completedSessionsCount: 101, lastSessionDate: '2026-09-25T00:00:00.000Z',
            recentCompletedSessionIds: ['b-roll', ...ledger.slice(0, 99)], badges: ['first-light'],
            tidalGardenState: { stage: 2, plantsUnlocked: ['kelp'], growthPoints: 400, lastWatered: 'w' },
        }), { experience: 'tidal-garden', timeInZonePercent: 100 }));
    });
});

describe('invitation acceptance copies exactly the clinician-authored plan', () => {
    it('the patched acceptance succeeds and drops a stale custom template and previous notes', async () => {
        await seedDocuments({ [`clients/${ids.unlinked}`]: {
            id: ids.unlinked, email: emailOf(ids.unlinked), name: 'U', assignedProtocol: 'alpha-enhancement',
            customProtocolConfig: { name: 'stale' }, customThresholdBounds: { min: 1, max: 2 }, notes: 'previous clinician note',
        } });
        await seedInvitation(ids.unlinked);
        await assertSucceeds(accept(await as(ids.unlinked), ids.unlinked, patchedAcceptPayload(ids.unlinked, invitedCare)));
    });

    it('an invitation without notes clears notes instead of keeping old ones', async () => {
        await seedDocuments({ [`clients/${ids.unlinked}`]: {
            id: ids.unlinked, email: emailOf(ids.unlinked), name: 'U', notes: 'previous clinician note',
        } });
        const { notes: _omit, ...withoutNotes } = invitedCare;
        await seedInvitation(ids.unlinked, withoutNotes);
        const database = await as(ids.unlinked);
        await assertFails(accept(database, ids.unlinked, { ...patchedAcceptPayload(ids.unlinked, withoutNotes), notes: 'previous clinician note' }));
        await assertSucceeds(accept(database, ids.unlinked, patchedAcceptPayload(ids.unlinked, withoutNotes)));
    });

    it('the pre-change acceptance shape (keeps stale custom template) is denied', async () => {
        await seedDocuments({ [`clients/${ids.unlinked}`]: {
            id: ids.unlinked, email: emailOf(ids.unlinked), name: 'U', customProtocolConfig: { name: 'stale' },
        } });
        await seedInvitation(ids.unlinked);
        await assertFails(accept(await as(ids.unlinked), ids.unlinked, {
            id: ids.unlinked, patientId: ids.unlinked, email: emailOf(ids.unlinked),
            clinicianId: ids.clinicianA, clinicId: clinicA, acceptedInvitationId: code, ...invitedCare,
        }));
    });

    it('rejects values the clinician did not author', async () => {
        await seedInvitation(ids.unlinked);
        const database = await as(ids.unlinked);
        const base = patchedAcceptPayload(ids.unlinked, invitedCare);
        await assertFails(accept(database, ids.unlinked, { ...base, condition: 'Generalized Anxiety' }));
        await assertFails(accept(database, ids.unlinked, { ...base, assignedProtocol: 'alpha-enhancement' }));
        await assertFails(accept(database, ids.unlinked, { ...base, prescribedSessionsPerWeek: 0 }));
        await assertFails(accept(database, ids.unlinked, { ...base, notes: 'self-authored' }));
        await assertFails(accept(database, ids.unlinked, { ...base, customProtocolConfig: { name: 'self' } }));
        await assertFails(accept(database, ids.unlinked, { ...base, customThresholdBounds: { min: 0, max: 1000 } }));
        await assertFails(accept(database, ids.unlinked, { ...base, allowedExperiences: ['neuro-gambit'] }));
        await assertFails(accept(database, ids.unlinked, { ...base, status: 'completed' }));
        await assertFails(accept(database, ids.unlinked, { ...base, completedSessionsCount: 99 }));
        await assertFails(accept(database, ids.unlinked, { ...base, brainMaps: [{ id: 'forged' }] }));
        // Nothing above consumed the invitation, so the honest shape still works.
        await assertSucceeds(accept(database, ids.unlinked, base));
    });

    it('the create path (no profile yet) is held to the same plan', async () => {
        const fresh = 'fresh-invitee';
        await seedInvitation(fresh);
        const database = await as(fresh);
        const created = {
            id: fresh, patientId: fresh, email: emailOf(fresh), name: 'Invited', status: 'active',
            allowedExperiences: ['neuro-gambit'], completedSessionsCount: 0, currentStreak: 0, brainMaps: [], badges: [], isDemo: false,
            clinicianId: ids.clinicianA, clinicId: clinicA, acceptedInvitationId: code,
        };
        await assertFails(accept(database, fresh, { ...created, ...invitedCare, condition: 'Generalized Anxiety' }));
        await assertFails(accept(database, fresh, { ...created, ...invitedCare, customProtocolConfig: { name: 'self' } }));
        await assertSucceeds(accept(database, fresh, { ...created, ...invitedCare }));
    });
});

describe('clinicians own the care plan', () => {
    it('the canonical clinician edits every care field, including explicit clearing', async () => {
        const reference = doc(await as(ids.clinicianA), `clients/${ids.patientA}`);
        // ClientRosterView edit shape (care fields only).
        await assertSucceeds(setDoc(reference, {
            condition: 'ADHD (Combined)', assignedProtocol: 'smr-enhancement', status: 'paused',
            prescribedSessionsPerWeek: 4, notes: 'plan v2', customProtocolConfig: deleteField(), updatedAt: serverTimestamp(),
        }, { merge: true }));
        // ClientDetailView protocol-builder shape.
        await assertSucceeds(setDoc(reference, {
            assignedProtocol: 'alpha-enhancement', customProtocolConfig: { name: 'Alpha custom', freqMin: 8, freqMax: 12 },
            allowedExperiences: ['tidal-garden', 'breath-weave'], customThresholdBounds: { min: 1, max: 50 },
        }, { merge: true }));
        await assertSucceeds(updateDoc(reference, {
            condition: deleteField(), assignedProtocol: deleteField(), prescribedSessionsPerWeek: deleteField(), customProtocolConfig: deleteField(),
        }));
    });

    it('a clinic colleague may edit the care plan (current policy)', async () => {
        await assertSucceeds(updateDoc(doc(await as(ids.colleagueA), `clients/${ids.patientA}`), { prescribedSessionsPerWeek: 2 }));
    });

    it('clinicians cannot write patient-owned, aggregate, frozen, or malformed fields', async () => {
        const reference = doc(await as(ids.clinicianA), `clients/${ids.patientA}`);
        await assertFails(updateDoc(reference, { name: 'Renamed by clinician' }));
        await assertFails(updateDoc(reference, { email: 'other@example.test' }));
        await assertFails(updateDoc(reference, { avatarUrl: 'x' }));
        await assertFails(updateDoc(reference, { individualBaselineModel: { alphaPeakHz: 3 } }));
        await assertFails(updateDoc(reference, { completedSessionsCount: 0 }));
        await assertFails(updateDoc(reference, { brainMaps: [{ id: 'legacy-edit' }] }));
        await assertFails(updateDoc(reference, { status: 'deleted' }));
        await assertFails(updateDoc(reference, { allowedExperiences: ['not-an-experience'] }));
        await assertFails(updateDoc(reference, { prescribedSessionsPerWeek: 500 }));
    });

    it('outsiders cannot edit the care plan', async () => {
        await assertFails(updateDoc(doc(await as(ids.clinicianB), `clients/${ids.patientA}`), { assignedProtocol: 'x' }));
        await assertFails(updateDoc(doc(await as(ids.clinicianX), `clients/${ids.patientA}`), { notes: 'x' }));
        await assertFails(updateDoc(doc(await as(ids.patientB), `clients/${ids.patientA}`), { notes: 'x' }));
    });

    it('unlink stays relationship-only; bundling a care-plan change is denied', async () => {
        const reference = doc(await as(ids.clinicianA), `clients/${ids.patientA}`);
        await assertFails(setDoc(reference, {
            clinicianId: null, linkedClinicianCode: null, clinicId: null, acceptedInvitationId: null, assignedProtocol: deleteField(),
        }, { merge: true }));
        await assertSucceeds(setDoc(reference, {
            clinicianId: null, linkedClinicianCode: null, clinicId: null, acceptedInvitationId: null, updatedAt: serverTimestamp(),
        }, { merge: true }));
    });
});

// Minimal edits the existing suite needs under the proposed rules: the batch
// acceptance shapes in invitations.test.ts and policy/identity-and-roles.test.ts
// must copy the invitation's care plan (or clear what
// it omits), as the app does. Relationship behavior is unchanged.
describe('existing acceptance shapes, amended to copy the invitation plan', () => {
    it('invitations.test.ts "accept and link atomically" + care plan', async () => {
        await seedInvitation(ids.unlinked, { condition: 'ADHD', assignedProtocol: 'theta-beta-ratio', prescribedSessionsPerWeek: 3 });
        const database = await as(ids.unlinked);
        const batch = writeBatch(database);
        batch.update(doc(database, `patientInvitations/${code}`), { status: 'accepted', patientId: ids.unlinked, acceptedAt: serverTimestamp(), updatedAt: serverTimestamp() });
        batch.set(doc(database, `clients/${ids.unlinked}`), {
            clinicianId: ids.clinicianA, clinicId: clinicA, acceptedInvitationId: code, updatedAt: serverTimestamp(),
            condition: 'ADHD', assignedProtocol: 'theta-beta-ratio', prescribedSessionsPerWeek: 3,
        }, { merge: true });
        batch.delete(doc(database, `patientInvitationClaims/${ids.clinicianA}/emails/${emailOf(ids.unlinked)}`));
        await assertSucceeds(batch.commit());
    });

    it('an invitation with no care plan clears the self-guided protocol on acceptance', async () => {
        await seedInvitation(ids.unlinked, {});
        const database = await as(ids.unlinked);
        // Keeping the self-guided protocol is not allowed; the clinician assigns one after linking.
        await assertFails(accept(database, ids.unlinked, { ...patchedAcceptPayload(ids.unlinked, {}), assignedProtocol: 'theta-beta-ratio' }));
        await assertSucceeds(accept(database, ids.unlinked, patchedAcceptPayload(ids.unlinked, {})));
    });

    it('identity-and-roles.test.ts unverified-email acceptance + care plan', async () => {
        await seedInvitation(ids.unlinked, { condition: 'ADHD' });
        const squatter = await as(ids.unlinked, { email_verified: false });
        const batch = writeBatch(squatter);
        batch.update(doc(squatter, `patientInvitations/${code}`), { status: 'accepted', patientId: ids.unlinked, acceptedAt: serverTimestamp(), updatedAt: serverTimestamp() });
        batch.set(doc(squatter, `clients/${ids.unlinked}`), {
            clinicianId: ids.clinicianA, clinicId: clinicA, acceptedInvitationId: code, condition: 'ADHD', assignedProtocol: deleteField(),
        }, { merge: true });
        batch.delete(doc(squatter, `patientInvitationClaims/${ids.clinicianA}/emails/${emailOf(ids.unlinked)}`));
        await assertSucceeds(batch.commit());
    });
});

// Rules have a 1000-expression budget per request. Real profiles carry a
// 100-entry ledger, legacy embedded QEEG, a custom template, and calibration,
// so every legitimate path is exercised on a large document.
describe('expression budget on realistic large profiles', () => {
    const ledger = Array.from({ length: 100 }, (_, index) => `old-${index}`);
    const heavy = (extra: Record<string, unknown>) => ({
        name: 'Heavy', status: 'active', schemaVersion: 1, isDemo: false, currentStreak: 3,
        allowedExperiences: ['skyline-drift', 'tidal-garden', 'breath-weave', 'signal-sort', 'rhythm-lock', 'media-mode',
            'soundscape-mode', 'mandala', 'eeg-mandala', 'immersive-3d', 'generative-music', 'narrative-story', 'neuro-gambit'],
        brainMaps: Array.from({ length: 20 }, (_, index) => ({
            id: `legacy-${index}`, uploadDate: '2025-01-01', fileName: 'x.edf', deviceSource: 'Muse', technicianNotes: 'n',
            zScores: { frontalTheta: 1, centralBeta: 1, occipitalAlpha: 1, temporalDelta: 1, sensorimotorSMR: 1 }, dominantAlphaPeakHz: 10,
        })),
        badges: ['first-light', 'deep-focus', 'still-waters'],
        completedSessionsCount: 100, recentCompletedSessionIds: ledger,
        customProtocolConfig: {
            id: 'custom-1', name: 'Custom', freqMin: 8, freqMax: 12, targetCondition: 'x', targetThreshold: 1, montageSite: 'Cz',
            clinicalNotes: 'long', recommendedExperiences: ['tidal-garden'], version: 'v1', channel: 'Cz', reward: 'alpha',
        },
        customThresholdBounds: { min: 1, max: 50 },
        individualBaselineModel: { alphaPeakHz: 10, oneOverFSlope: 1.1, lastCalibratedAt: 'x', thetaMean: 1, thetaStd: 1, betaMean: 1, betaStd: 1, alphaMean: 1, alphaStd: 1 },
        tidalGardenState: { stage: 1, plantsUnlocked: ['kelp'], growthPoints: 10, lastWatered: 'w' },
        skylineBiomesUnlocked: ['a', 'b'],
        ...extra,
    });
    const linked = () => heavy({
        id: ids.patientA, patientId: ids.patientA, email: emailOf(ids.patientA),
        clinicianId: ids.clinicianA, clinicId: clinicA, acceptedInvitationId: 'INVA-AAAA-AAAA',
        condition: 'ADHD (Combined)', assignedProtocol: 'alpha-enhancement', prescribedSessionsPerWeek: 3, notes: 'plan',
    });
    const roll = (id: string) => () => ({
        completedSessionsCount: 101, lastSessionDate: '2026-09-25T00:00:00.000Z',
        recentCompletedSessionIds: [id, ...ledger.slice(0, 99)], badges: ['first-light', 'deep-focus', 'still-waters'],
    });

    it('session aggregates from patient, clinician and colleague', async () => {
        for (const [actor, id] of [[ids.patientA, 'h-p'], [ids.clinicianA, 'h-c'], [ids.colleagueA, 'h-g']] as const) {
            await seedDocuments({ [`clients/${ids.patientA}`]: linked() });
            await assertSucceeds(createSession(await as(actor), id, ids.patientA, roll(id)));
        }
    });

    it('care-plan edits by clinician and colleague; profile and calibration edits by the patient', async () => {
        await seedDocuments({ [`clients/${ids.patientA}`]: linked() });
        await assertSucceeds(updateDoc(doc(await as(ids.clinicianA), `clients/${ids.patientA}`), { notes: 'v2', status: 'paused', allowedExperiences: ['mandala'] }));
        await assertSucceeds(updateDoc(doc(await as(ids.colleagueA), `clients/${ids.patientA}`), { prescribedSessionsPerWeek: 5 }));
        await assertSucceeds(updateDoc(doc(await as(ids.patientA), `clients/${ids.patientA}`), { name: 'Renamed', email: emailOf(ids.patientA) }));
        await assertSucceeds(updateDoc(doc(await as(ids.patientA), `clients/${ids.patientA}`), { individualBaselineModel: { alphaPeakHz: 9 } }));
        await assertSucceeds(setDoc(doc(await as(ids.clinicianA), `clients/${ids.patientA}`), {
            clinicianId: null, linkedClinicianCode: null, clinicId: null, acceptedInvitationId: null, updatedAt: serverTimestamp(),
        }, { merge: true }));
    });

    it('acceptance and self-guided protocol choice on a heavy unlinked profile', async () => {
        await seedDocuments({ [`clients/${ids.unlinked}`]: heavy({ id: ids.unlinked, email: emailOf(ids.unlinked), assignedProtocol: 'alpha-enhancement' }) });
        await assertSucceeds(updateDoc(doc(await as(ids.unlinked), `clients/${ids.unlinked}`), {
            assignedProtocol: 'smr-enhancement', customProtocolConfig: deleteField(), customThresholdBounds: deleteField(),
        }));
        await seedDocuments({ [`clients/${ids.unlinked}`]: heavy({ id: ids.unlinked, email: emailOf(ids.unlinked), assignedProtocol: 'alpha-enhancement' }) });
        await seedInvitation(ids.unlinked);
        await assertSucceeds(accept(await as(ids.unlinked), ids.unlinked, patchedAcceptPayload(ids.unlinked, invitedCare)));
    });
});
