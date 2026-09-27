import { expect, test } from '@playwright/test';
import {
    canonicalClinicianId,
    containsRunMarker,
    planDisposableCleanup,
    planPairCleanup,
    valuesEqual,
    type DisposableAccountState,
    type DocState,
    type PairBaseline,
    type PairCurrent,
    type PairScope,
    type PlanOptions,
} from '../helpers/cleanupPlan';

// Offline unit tests for cleanup planning. No browser, Firebase, or network.

const marker = 'e2e-run-0123456789abcdef01234567';
const scope: PairScope = {
    patientId: 'patient-1',
    clinicianId: 'clinician-1',
    patientEmail: 'patient@example.test',
    runMarker: marker,
};
const window = { startMs: 1_000, endMs: 2_000 };
const finishing: PlanOptions = { allowRecreate: true };
const recovery: PlanOptions = { allowRecreate: false };

function doc(path: string, data: Record<string, unknown>, times: { created?: number; updated?: number } = {}): DocState {
    const created = times.created ?? 1_500;
    const updated = times.updated ?? created;
    return { path, exists: true, createTimeMs: created, updateTimeMs: updated, version: `${updated}.000000000`, data };
}

function missing(path: string): DocState {
    return { path, exists: false };
}

const patientPath = 'clients/patient-1';
const threadPath = 'messageThreads/patient-1/relationships/clinician-1';
const claimPath = 'patientInvitationClaims/clinician-1/emails/patient@example.test';
const patientData = { id: 'patient-1', email: 'patient@example.test', name: 'Patient', completedSessionsCount: 3 };

function baseline(overrides: Partial<PairBaseline> = {}): PairBaseline {
    return {
        patient: doc(patientPath, patientData, { created: 100, updated: 200 }),
        thread: missing(threadPath),
        claim: missing(claimPath),
        sessionVersions: {},
        appointmentVersions: {},
        invitationVersions: {},
        messageVersions: {},
        ...overrides,
    };
}

function current(overrides: Partial<PairCurrent> = {}): PairCurrent {
    return {
        patient: doc(patientPath, patientData, { created: 100, updated: 200 }),
        thread: missing(threadPath),
        claim: missing(claimPath),
        sessions: [],
        appointments: [],
        invitations: [],
        messages: [],
        ...overrides,
    };
}

function session(id: string, data: Record<string, unknown>, times?: { created?: number; updated?: number }) {
    return doc(`sessions/${id}`, { patientId: 'patient-1', isDemo: true, patientNotes: marker, ...data }, times);
}

const plan = (b: PairBaseline | null, c: PairCurrent, options: PlanOptions = finishing) => planPairCleanup(scope, window, b, c, options);
const kinds = (result: ReturnType<typeof planPairCleanup>) => result.actions.map((action) => `${action.kind} ${action.path}`);
const retainedPaths = (result: ReturnType<typeof planPairCleanup>) => result.retained.map((item) => item.path);
const changedPatient = (fields: Record<string, unknown>, updated = 1_800) =>
    doc(patientPath, { ...patientData, ...fields }, { created: 100, updated });

test.describe('pair cleanup attribution', () => {
    test('deletes a new, marked, owned Demo session created inside the run window', () => {
        expect(kinds(plan(baseline(), current({ sessions: [session('run', {})] })))).toEqual(['delete sessions/run']);
    });

    test('reports sessions without positive evidence, and then keeps the run session with its patient group', () => {
        const result = plan(baseline(), current({
            sessions: [
                session('run', {}),
                session('unmarked', { patientNotes: 'manual note' }),
                session('early', {}, { created: 900 }),
                session('touched-later', {}, { created: 1_500, updated: 2_500 }),
                session('real-eeg', { isDemo: false }),
                session('other-patient', { patientId: 'someone-else' }),
            ],
        }));
        expect(result.actions).toEqual([]);
        expect(result.retained.map((item) => `${item.path}: ${item.reason}`)).toEqual([
            'sessions/unmarked: new session not attributed to this run: session notes do not contain the run marker',
            'sessions/early: new session not attributed to this run: created before the run started',
            'sessions/touched-later: new session not attributed to this run: modified after the run window closed',
            'sessions/real-eeg: new session not attributed to this run: session is not a Training Demo session',
            'sessions/other-patient: new session not attributed to this run: session belongs to a different patient',
            'sessions/run: session created by this run is kept with its patient profile, which is not being cleaned',
        ]);
    });

    test('never deletes a pre-existing record; reports one that was modified or removed', () => {
        const old = session('old', {}, { created: 100, updated: 200 });
        const result = plan(
            baseline({ sessionVersions: { 'sessions/old': '150.000000000', 'sessions/gone': '100.000000000' } }),
            current({ sessions: [old] }),
        );
        expect(result.actions).toEqual([]);
        expect(result.retained.map((item) => item.reason)).toEqual(['pre-existing session is missing', 'pre-existing session was modified']);
    });

    test('a new document is not deleted merely because it appeared after the snapshot', () => {
        const result = plan(baseline(), current({
            appointments: [doc('appointments/a', { patientId: 'patient-1', clinicianId: 'clinician-1', createdBy: 'clinician-1', notes: 'check-in' })],
        }));
        expect(result.actions).toEqual([]);
        expect(result.retained[0].reason).toContain('run marker');
    });

    test('appointments must belong to and be created by the approved clinician', () => {
        const base = { patientId: 'patient-1', clinicianId: 'clinician-1', createdBy: 'clinician-1', notes: `${marker}-appointment` };
        const result = plan(baseline(), current({
            appointments: [
                doc('appointments/ok', base),
                doc('appointments/other-clinician', { ...base, clinicianId: 'clinician-2' }),
                doc('appointments/other-patient', { ...base, patientId: 'patient-2' }),
            ],
        }));
        expect(kinds(result)).toEqual(['delete appointments/ok']);
        expect(retainedPaths(result)).toEqual(['appointments/other-clinician', 'appointments/other-patient']);
    });

    test("other patients' invitations are ignored unless the run marked them", () => {
        const result = plan(baseline(), current({
            invitations: [
                doc('patientInvitations/OTHER', { clinicianId: 'clinician-1', patientEmail: 'someone@example.test', patientName: 'Real patient' }),
                doc('patientInvitations/MISDIRECTED', { clinicianId: 'clinician-1', patientEmail: 'someone@example.test', patientName: `E2E ${marker}` }),
                doc('patientInvitations/RUN', { clinicianId: 'clinician-1', patientEmail: 'Patient@Example.test', patientName: `E2E ${marker}`, patientId: 'patient-1' }),
            ],
        }));
        expect(kinds(result)).toEqual(['delete patientInvitations/RUN']);
        expect(retainedPaths(result)).toEqual(['patientInvitations/MISDIRECTED']);
    });

    test('an invitation accepted by another account is never attributed to the run', () => {
        const result = plan(baseline(), current({
            invitations: [doc('patientInvitations/HIJACK', {
                clinicianId: 'clinician-1', patientEmail: 'patient@example.test', patientName: `E2E ${marker}`, patientId: 'intruder',
            })],
        }));
        expect(result.actions).toEqual([]);
        expect(result.retained[0].reason).toContain('accepted by a different patient');
    });

    test('a new claim is deleted only when it points at an invitation created by this run', () => {
        const invitation = doc('patientInvitations/RUN', { clinicianId: 'clinician-1', patientEmail: 'patient@example.test', patientName: `E2E ${marker}` });
        const claim = doc(claimPath, { clinicianId: 'clinician-1', patientEmail: 'patient@example.test', invitationId: 'RUN' });
        expect(kinds(plan(baseline(), current({ invitations: [invitation], claim })))).toContain(`delete ${claimPath}`);

        const foreignClaim = doc(claimPath, { clinicianId: 'clinician-1', patientEmail: 'patient@example.test', invitationId: 'MANUAL' });
        const result = plan(baseline(), current({ invitations: [invitation], claim: foreignClaim }));
        expect(kinds(result)).not.toContain(`delete ${claimPath}`);
        expect(retainedPaths(result)).toContain(claimPath);
    });

    test('a new thread is deleted only when every remaining message is attributed to the run', () => {
        const message = (id: string, text: string) => doc(`${threadPath}/messages/${id}`, {
            patientId: 'patient-1', clinicianId: 'clinician-1', senderId: 'patient-1', text,
        });
        const thread = doc(threadPath, { patientId: 'patient-1', clinicianId: 'clinician-1', lastMessageText: `${marker}-hello` });

        const clean = plan(baseline(), current({ thread, messages: [message('m1', `${marker}-hello`)] }));
        expect(kinds(clean)).toEqual([`delete ${threadPath}/messages/m1`, `delete ${threadPath}`]);

        const mixed = plan(baseline(), current({
            thread,
            messages: [message('m1', `${marker}-hello`), message('m2', 'a real message')],
        }));
        // The group is all-or-nothing: the run message stays with its thread.
        expect(kinds(mixed)).toEqual([]);
        expect(retainedPaths(mixed)).toEqual([`${threadPath}/messages/m2`, `${threadPath}/messages/m1`, threadPath]);
    });

    test('markers shorter than the minimum never identify anything', () => {
        expect(containsRunMarker('e2e', 'e2e')).toBe(false);
        expect(containsRunMarker(`note ${marker}`, marker)).toBe(true);
        expect(containsRunMarker(42, marker)).toBe(false);
    });
});

test.describe('fixture restoration', () => {
    test('restores a fixture changed inside the run window, restores before deleting, and names the changed fields', () => {
        const result = plan(baseline(), current({
            patient: changedPatient({ completedSessionsCount: 4, assignedProtocol: 'x' }),
            sessions: [session('run', {})],
        }));
        expect(result.actions[0]).toEqual({
            kind: 'restore',
            path: patientPath,
            expectedVersion: '1800.000000000',
            changedFields: ['assignedProtocol', 'completedSessionsCount'],
            reason: expect.any(String),
        });
        expect(kinds(result)).toEqual([`restore ${patientPath}`, 'delete sessions/run']);
    });

    test('never overwrites a fixture modified after the run window (possible manual use)', () => {
        const result = plan(baseline(), current({ patient: changedPatient({ name: 'Edited by hand' }, 5_000) }));
        expect(result.actions).toEqual([]);
        expect(result.retained[0].reason).toContain('after the run window');
    });

    test('never overwrites a fixture when a field the run never writes changed', () => {
        const result = plan(baseline(), current({ patient: changedPatient({ completedSessionsCount: 4, goals: 'manual edit' }) }));
        expect(result.actions).toEqual([]);
        expect(result.retained[0].reason).toContain('goals');
    });

    test('does not restore a parent whose related record was left untouched', () => {
        const withUnmarkedSession = plan(baseline(), current({
            patient: changedPatient({ completedSessionsCount: 4 }),
            sessions: [session('manual', { patientNotes: 'manual session' })],
        }));
        expect(withUnmarkedSession.actions).toEqual([]);
        expect(retainedPaths(withUnmarkedSession)).toEqual(['sessions/manual', patientPath]);

        const threadBase = doc(threadPath, { patientId: 'patient-1', clinicianId: 'clinician-1', lastMessageText: 'old' }, { created: 100 });
        const withUnmarkedMessage = plan(baseline({ thread: threadBase }), current({
            thread: doc(threadPath, { patientId: 'patient-1', clinicianId: 'clinician-1', lastMessageText: 'manual reply' }, { created: 100, updated: 1_600 }),
            messages: [doc(`${threadPath}/messages/m9`, { patientId: 'patient-1', clinicianId: 'clinician-1', senderId: 'patient-1', text: 'manual reply' })],
        }));
        expect(withUnmarkedMessage.actions).toEqual([]);
        expect(retainedPaths(withUnmarkedMessage)).toContain(threadPath);
    });

    test('a held-back parent keeps its run-created children and every group sharing them', () => {
        const invitation = doc('patientInvitations/RUN', {
            clinicianId: 'clinician-1', patientEmail: 'patient@example.test', patientName: `E2E ${marker}`, patientId: 'patient-1', status: 'accepted',
        });
        const result = plan(baseline(), current({
            patient: changedPatient({ clinicianId: 'clinician-1', acceptedInvitationId: 'RUN', completedSessionsCount: 4 }),
            invitations: [invitation],
            claim: doc(claimPath, { clinicianId: 'clinician-1', patientEmail: 'patient@example.test', invitationId: 'RUN' }),
            sessions: [session('manual', { patientNotes: 'manual session' })],
            appointments: [doc('appointments/run', {
                patientId: 'patient-1', clinicianId: 'clinician-1', createdBy: 'clinician-1', notes: `${marker}-appointment`,
            })],
        }));
        // Appointments affect no parent, so they are still removed.
        expect(kinds(result)).toEqual(['delete appointments/run']);
        expect(retainedPaths(result).sort()).toEqual([claimPath, patientPath, 'patientInvitations/RUN', 'sessions/manual'].sort());
    });

    test('a changed name is restored only when the run could have filled it in', () => {
        const filled = plan(
            baseline({ patient: doc(patientPath, { ...patientData, name: '' }, { created: 100, updated: 200 }) }),
            current({ patient: changedPatient({ name: 'E2E filled' }) }),
        );
        expect(kinds(filled)).toEqual([`restore ${patientPath}`]);

        const renamed = plan(baseline(), current({ patient: changedPatient({ name: 'Renamed by owner' }) }));
        expect(renamed.actions).toEqual([]);
        expect(renamed.retained[0].reason).toContain('name');
    });

    test('equal data with a new update time needs no write', () => {
        const result = plan(baseline(), current({ patient: changedPatient({}, 1_900) }));
        expect(result.actions).toEqual([]);
        expect(result.retained).toEqual([]);
    });

    test('recreates a removed baseline document only while the finishing run cleans up', () => {
        const baselineClaim = doc(claimPath, { clinicianId: 'clinician-1', patientEmail: 'patient@example.test', invitationId: 'OLD' }, { created: 100 });
        expect(kinds(plan(baseline({ claim: baselineClaim }), current(), finishing))).toEqual([`recreate ${claimPath}`]);

        const inRecovery = plan(baseline({ claim: baselineClaim }), current(), recovery);
        expect(inRecovery.actions).toEqual([]);
        expect(retainedPaths(inRecovery)).toEqual([claimPath]);
    });

    test('without a stored baseline, the patient group is left alone while independent run records are removed', () => {
        const result = plan(null, current({
            patient: changedPatient({ completedSessionsCount: 9 }, 1_500),
            sessions: [session('run', {})],
            appointments: [doc('appointments/run', {
                patientId: 'patient-1', clinicianId: 'clinician-1', createdBy: 'clinician-1', notes: `${marker}-appointment`,
            })],
        }));
        expect(kinds(result)).toEqual(['delete appointments/run']);
        expect(retainedPaths(result)).toEqual(['sessions/run', patientPath]);
    });

    test('clinic restore requires the approved pair to remain its only members', () => {
        const clinicPath = 'clinics/clinic-1';
        const base = baseline({ clinic: doc(clinicPath, { practitionerIds: ['clinician-1'], branding: { name: 'Before' } }, { created: 100 }) });
        const changed = doc(clinicPath, { practitionerIds: ['clinician-1'], branding: { name: 'After' } }, { created: 100, updated: 1_500 });

        const exclusive = plan(base, current({
            clinic: changed,
            clinicMembership: { practitionerIds: ['clinician-1'], clientIds: ['patient-1'] },
        }));
        expect(kinds(exclusive)).toEqual([`restore ${clinicPath}`]);

        const shared = plan(base, current({
            clinic: changed,
            clinicMembership: { practitionerIds: ['clinician-1'], clientIds: ['patient-1', 'real-patient'] },
        }));
        expect(shared.actions).toEqual([]);
        expect(shared.retained[0].reason).toContain('patients other than the approved patient');
    });

    test('canonical clinician mirrors the rules: clinicianId wins over the legacy field', () => {
        expect(canonicalClinicianId({ clinicianId: 'other', linkedClinicianCode: 'clinician-1' })).toBe('other');
        expect(canonicalClinicianId({ clinicianId: null, linkedClinicianCode: 'clinician-1' })).toBe('clinician-1');
        expect(canonicalClinicianId({ linkedClinicianCode: 'clinician-1' })).toBe('clinician-1');
        expect(canonicalClinicianId({})).toBeNull();
    });

    test('value equality understands Firestore value objects, bytes, NaN, and nesting', () => {
        class FakeTimestamp {
            constructor(readonly millis: number) {}
            isEqual(other: FakeTimestamp) { return other.millis === this.millis; }
        }
        expect(valuesEqual({ at: new FakeTimestamp(1), list: [1, { a: 2 }] }, { list: [1, { a: 2 }], at: new FakeTimestamp(1) })).toBe(true);
        expect(valuesEqual({ at: new FakeTimestamp(1) }, { at: new FakeTimestamp(2) })).toBe(false);
        expect(valuesEqual({ a: 1 }, { a: 1, b: undefined })).toBe(true);
        expect(valuesEqual([1, 2], [2, 1])).toBe(false);
        expect(valuesEqual(Number.NaN, Number.NaN)).toBe(true);
        expect(valuesEqual(Buffer.from([1, 2]), Buffer.from([1, 2]))).toBe(true);
        expect(valuesEqual(Buffer.from([1, 2]), Buffer.from([1, 3]))).toBe(false);
    });
});

test.describe('disposable identity cleanup', () => {
    const email = `neurasticity-e2e-patient-${'a'.repeat(32)}@example.com`;
    const registryPath = 'e2eHarnessDisposableAccounts/x';

    function account(overrides: Partial<DisposableAccountState> = {}): DisposableAccountState {
        return {
            email,
            registry: { path: registryPath, exists: true, version: '10.0', email, projectId: 'p', runId: 'run-1', uid: 'u1', createdAtMs: 1_000 },
            authUser: { uid: 'u1', email, creationTimeMs: 1_200 },
            linkedDataPaths: [],
            ownDocuments: {
                users: doc('users/u1', { email, role: 'patient' }, { created: 1_300 }),
                clients: doc('clients/u1', { id: 'u1', email }, { created: 1_300 }),
                practitioners: missing('practitioners/u1'),
                clinics: missing('clinics/u1'),
            },
            ...overrides,
        };
    }
    const planFor = (state: DisposableAccountState) => planDisposableCleanup({ projectId: 'p', runId: 'run-1' }, [state])[0];

    test('deletes own signup records, the Auth user, and the registry entry', () => {
        const result = planFor(account());
        expect(result.deleteDocuments.map((action) => action.path)).toEqual(['users/u1', 'clients/u1']);
        expect(result.deleteAuthUser).toBe(true);
        expect(result.deleteRegistry?.path).toBe(registryPath);
        expect(result.retained).toEqual([]);
    });

    test('retains identities from another run, outside the namespace, or predating registration', () => {
        const foreignRun = planFor(account({ registry: { ...account().registry, runId: 'run-2' } }));
        const outside = planFor(account({ email: 'real.user@example.org' }));
        // Earlier than the registry by more than the allowed Auth clock skew.
        const early = planFor(account({ authUser: { uid: 'u1', email, creationTimeMs: 1_000 - 6_000 } }));
        for (const result of [foreignRun, outside, early]) {
            expect(result.deleteDocuments).toEqual([]);
            expect(result.deleteAuthUser).toBe(false);
            expect(result.deleteRegistry).toBeNull();
        }
    });

    test('any unattributable record or linked data retains the whole identity', () => {
        const linked = planFor(account({ linkedDataPaths: ['sessions/x'] }));
        const olderDoc = planFor(account({
            ownDocuments: { ...account().ownDocuments, clients: doc('clients/u1', { id: 'u1', email }, { created: 500 }) },
        }));
        for (const result of [linked, olderDoc]) {
            expect(result.deleteDocuments).toEqual([]);
            expect(result.deleteAuthUser).toBe(false);
            expect(result.deleteRegistry).toBeNull();
        }
    });

    test('an Auth user that never got created still has its registered records cleaned', () => {
        const result = planFor(account({ authUser: null }));
        expect(result.deleteAuthUser).toBe(false);
        expect(result.deleteDocuments.map((action) => action.path)).toEqual(['users/u1', 'clients/u1']);
        expect(result.deleteRegistry?.path).toBe(registryPath);
    });
});
