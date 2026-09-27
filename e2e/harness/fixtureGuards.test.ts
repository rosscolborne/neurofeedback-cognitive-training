import { expect, test } from '@playwright/test';
import { E2E_PROJECT_ID, E2E_SERVICE_ACCOUNT, requireE2EAdminConfiguration, TOKEN_LIFETIME_SECONDS } from '../helpers/adminCredential';
import { assertFixtureDocument, assertFixtureReference, FIXTURE_MARKER, fixtureIdentities } from '../helpers/fixtureModel';

const valid = {
    E2E_FIREBASE_PROJECT_ID: E2E_PROJECT_ID,
    E2E_FIREBASE_SERVICE_ACCOUNT_EMAIL: E2E_SERVICE_ACCOUNT,
    E2E_ENABLE_PRIVILEGED_CLEANUP: 'true',
    E2E_CONFIRM_SHARED_PROJECT_TEST_ACCOUNTS: 'true',
};

test('Admin preflight pins the project and target identity and refuses key paths', () => {
    expect(requireE2EAdminConfiguration(valid)).toBe(E2E_PROJECT_ID);
    expect(TOKEN_LIFETIME_SECONDS).toBe(600);
    expect(() => requireE2EAdminConfiguration({ ...valid, E2E_FIREBASE_PROJECT_ID: 'production' })).toThrow('pinned development project');
    expect(() => requireE2EAdminConfiguration({ ...valid, E2E_FIREBASE_SERVICE_ACCOUNT_EMAIL: 'other@example.com' })).toThrow('must be');
    expect(() => requireE2EAdminConfiguration({ ...valid, GOOGLE_APPLICATION_CREDENTIALS: '/tmp/key.json' })).toThrow('key paths');
    expect(() => requireE2EAdminConfiguration({ ...valid, E2E_FIREBASE_SERVICE_ACCOUNT_PATH: '/tmp/key.json' })).toThrow('key paths');
    expect(() => requireE2EAdminConfiguration({ ...valid, FIRESTORE_EMULATOR_HOST: 'localhost:8080' })).toThrow('emulators');
    expect(() => requireE2EAdminConfiguration({ ...valid, E2E_ENABLE_PRIVILEGED_CLEANUP: 'false' })).toThrow('PRIVILEGED');
    expect(() => requireE2EAdminConfiguration({ ...valid, E2E_CONFIRM_SHARED_PROJECT_TEST_ACCOUNTS: 'false' })).toThrow('exclusive test accounts');
});

test('fixture reset refuses unowned fixed documents and unrelated links', () => {
    expect(() => assertFixtureDocument('clients/x', { e2eFixture: FIXTURE_MARKER })).not.toThrow();
    expect(() => assertFixtureDocument('clients/x', { name: 'other' })).toThrow('unmarked');
    expect(() => assertFixtureReference('sessions/x', {
        patientId: fixtureIdentities.patient.uid,
        clinicianId: fixtureIdentities.clinician.uid,
    })).not.toThrow();
    expect(() => assertFixtureReference('sessions/x', {
        patientId: 'real-user', clinicianId: fixtureIdentities.clinician.uid,
    })).toThrow('unrelated patient');
    expect(() => assertFixtureReference('patientInvitations/x', {
        clinicianId: fixtureIdentities.clinician.uid, patientEmail: 'unrelated@example.com',
    })).toThrow('unrelated email');
    expect(() => assertFixtureReference('messageThreads/x/relationships/y', {
        patientId: fixtureIdentities.patient.uid,
        clinicianId: fixtureIdentities.clinician.uid,
        participantIds: [fixtureIdentities.patient.uid, 'unrelated-user'],
    })).toThrow('participantIds includes an unrelated user');
});
