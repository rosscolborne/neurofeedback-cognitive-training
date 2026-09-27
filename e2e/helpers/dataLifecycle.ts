import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { TestInfo } from '@playwright/test';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import {
    FieldValue,
    Timestamp,
    type DocumentData,
    type DocumentSnapshot,
    Firestore,
} from 'firebase-admin/firestore';
import type { AuthenticatedE2EIdentity } from './auth';
import { impersonatedE2ECredentials, requireE2EAdminConfiguration } from './adminCredential';
import { fixtureIdentities } from './fixtureModel';
import {
    canonicalClinicianId,
    clinicExclusivityProblem,
    containsRunMarker,
    disposableEmailPattern,
    planDisposableCleanup,
    planPairCleanup,
    summarizeDisposablePlans,
    summarizePlan,
    valuesEqual,
    type CleanupPlan,
    type DisposableAccountPlan,
    type DisposableAccountState,
    type DisposableRegistry,
    type DocState,
    type PairBaseline,
    type PairCurrent,
    type PairScope,
    type PlanOptions,
    type RunWindow,
} from './cleanupPlan';

/**
 * Privileged lifecycle for stateful E2E runs against a shared Firebase project.
 *
 * Every stateful run takes an exclusive Firestore lease, records a baseline of
 * the approved pair's fixture documents, and ends by computing a cleanup plan.
 * In `plan` mode the plan is only reported and the lease is parked for
 * explicit review. In `execute` mode the plan is applied in one transaction
 * with update-time checks and then independently verified. A lease that did
 * not finish cleanly blocks later runs until an operator reviews it; stale
 * baselines are never restored automatically, and executing a recovery
 * requires the digest of the plan the operator reviewed.
 */

export type CleanupMode = 'plan' | 'execute';

const pairLeasePath = 'e2eHarnessLocks/mock-data-removal';
const disposableLeasePath = 'e2eHarnessLocks/account-isolation';
const disposableRegistryCollection = 'e2eHarnessDisposableAccounts';
const baselineCollection = 'e2eHarnessBaselines';
const leaseDurationMs = 30 * 60 * 1000;
const heartbeatIntervalMs = 30_000;
/** Consecutive renewal failures after which the run is stopped. */
const heartbeatFailureLimit = 2;
/**
 * For a run that crashed without recording its window end: the browser is
 * closed within `heartbeatFailureLimit` intervals of the last successful
 * heartbeat, so no run write can land later than this after it.
 */
const crashedRunGraceMs = (heartbeatFailureLimit + 2) * heartbeatIntervalMs;
const maxTransactionWrites = 450;
const cleanupReportDirectory = 'e2e/.cleanup-reports';

class LeaseLostError extends Error {}

type HeartbeatState = { timer: ReturnType<typeof setInterval>; failures: number; failure?: unknown };
const heartbeats = new Map<string, HeartbeatState>();
let leaseLossHandler: (() => void) | undefined;
/** Runs whose cleanup has begun; fixture changes from an abandoned test body are refused. */
const finishingRuns = new Set<string>();

/** Called when a lease is lost so the caller can stop all browser activity at once. */
export function setLeaseLossHandler(handler: (() => void) | undefined): void {
    leaseLossHandler = handler;
}

// ---------------------------------------------------------------------------
// Configuration and identity checks
// ---------------------------------------------------------------------------

function requireAdminConfiguration(): { projectId: string } {
    return { projectId: requireE2EAdminConfiguration() };
}

export function cleanupMode(): CleanupMode {
    const mode = process.env.E2E_CLEANUP_MODE?.trim();
    if (mode === 'plan' || mode === 'execute') return mode;
    throw new Error('Set E2E_CLEANUP_MODE=plan (report only) or E2E_CLEANUP_MODE=execute (apply the reported plan).');
}

/** Requires both the flag and the npm stateful script, so an exported shell variable alone cannot arm a run. */
export function statefulRunRequested(): boolean {
    return process.env.E2E_RUN_STATEFUL === 'true'
        && (process.env.npm_lifecycle_event ?? '').startsWith('test:e2e:stateful:');
}

function requireStatefulRun(): CleanupMode {
    if (!statefulRunRequested()) {
        throw new Error('Stateful E2E suites run only through the npm test:e2e:stateful:* scripts.');
    }
    return cleanupMode();
}

function expectedIdentity(role: 'patient' | 'clinician') {
    const prefix = role === 'patient' ? 'E2E_PATIENT' : 'E2E_CLINICIAN';
    const { uid, email } = fixtureIdentities[role];
    if (process.env[`${prefix}_UID`] && process.env[`${prefix}_UID`] !== uid) throw new Error(`${prefix}_UID differs from the pinned fixture UID.`);
    if (process.env[`${prefix}_EMAIL`] && process.env[`${prefix}_EMAIL`]?.toLowerCase() !== email) throw new Error(`${prefix}_EMAIL differs from the pinned fixture email.`);
    return { uid, email };
}

let adminDatabasePromise: Promise<Firestore> | undefined;

async function adminDatabase(): Promise<Firestore> {
    const { projectId } = requireAdminConfiguration();
    adminDatabasePromise ??= (async () => {
        const { adminCredential, firestoreAuth } = await impersonatedE2ECredentials();
        // firebase-admin's getFirestore() only accepts its built-in certificate
        // or ADC credential classes. Its custom Credential works for Auth, but
        // getFirestore() rejects it. Inject the same impersonated GoogleAuth
        // directly into the Firestore client instead of letting it find human ADC.
        const database = new Firestore({
            projectId, databaseId: '(default)', auth: firestoreAuth,
            ignoreUndefinedProperties: true,
        });
        initializeApp({ credential: adminCredential, projectId }, 'neurasticity-e2e');
        return database;
    })();
    try {
        return await adminDatabasePromise;
    } catch (error) {
        adminDatabasePromise = undefined;
        throw error;
    }
}

export async function adminServices() {
    const database = await adminDatabase();
    const app = getApps().find((candidate) => candidate.name === 'neurasticity-e2e');
    if (!app) throw new Error('The E2E Firebase admin app was not initialized.');
    return { database, authentication: getAuth(app) };
}

async function verifyAllowedPair(
    patient: AuthenticatedE2EIdentity,
    clinician: AuthenticatedE2EIdentity,
): Promise<void> {
    const { projectId } = requireAdminConfiguration();
    if (patient.projectId !== projectId || clinician.projectId !== projectId) {
        throw new Error('Browser and privileged cleanup Firebase projects do not match.');
    }
    const expectedPatient = expectedIdentity('patient');
    const expectedClinician = expectedIdentity('clinician');
    if (
        patient.uid !== expectedPatient.uid
        || patient.email.toLowerCase() !== expectedPatient.email
        || clinician.uid !== expectedClinician.uid
        || clinician.email.toLowerCase() !== expectedClinician.email
        || patient.uid === clinician.uid
    ) {
        throw new Error('Authenticated browser identities are not the explicitly allow-listed E2E accounts.');
    }

    const { authentication } = await adminServices();
    const [adminPatient, adminClinician] = await Promise.all([
        authentication.getUser(patient.uid),
        authentication.getUser(clinician.uid),
    ]);
    if (
        adminPatient.email?.toLowerCase() !== expectedPatient.email
        || adminClinician.email?.toLowerCase() !== expectedClinician.email
    ) {
        throw new Error('Admin Auth identities do not match the E2E account allow-list.');
    }
    if (!adminPatient.emailVerified || !adminClinician.emailVerified) {
        throw new Error('The E2E patient and clinician emails must be verified. Run npm run test:e2e:session -- reset.');
    }
}

async function verifyPrivilegedProject(browserProjectId: string, options: { writeSentinel: boolean }): Promise<void> {
    const { projectId } = requireAdminConfiguration();
    if (!browserProjectId || browserProjectId !== projectId) {
        throw new Error('Browser and privileged cleanup Firebase projects do not match.');
    }
    const { database, authentication } = await adminServices();
    await Promise.all([
        // Proves Auth access through an allow-listed account, without listing users.
        authentication.getUser(expectedIdentity('patient').uid),
        database.doc(pairLeasePath).get(),
    ]);
    if (!options.writeSentinel) return;
    // Proves the credential can delete before any account is created. The
    // sentinel lives in a harness-only collection under a random ID.
    const sentinel = database.doc(`e2eHarnessSentinels/${randomUUID()}`);
    await sentinel.create({ createdAt: FieldValue.serverTimestamp() });
    await sentinel.delete();
    if ((await sentinel.get()).exists) {
        throw new Error('Privileged E2E cleanup could not delete its Firestore sentinel.');
    }
}

// ---------------------------------------------------------------------------
// Document state helpers
// ---------------------------------------------------------------------------

function versionOf(time: Timestamp): string {
    return `${time.seconds}.${String(time.nanoseconds).padStart(9, '0')}`;
}

function toDocState(snapshot: DocumentSnapshot): DocState {
    if (!snapshot.exists) return { path: snapshot.ref.path, exists: false };
    return {
        path: snapshot.ref.path,
        exists: true,
        createTimeMs: snapshot.createTime?.toMillis(),
        updateTimeMs: snapshot.updateTime?.toMillis(),
        version: snapshot.updateTime ? versionOf(snapshot.updateTime) : undefined,
        data: snapshot.data(),
    };
}

function versions(documents: DocState[]): Record<string, string> {
    return Object.fromEntries(documents.map((document) => [document.path, document.version ?? '']));
}

function lower(value: unknown): string | undefined {
    return typeof value === 'string' ? value.trim().toLowerCase() : undefined;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Leases
// ---------------------------------------------------------------------------

type LeaseStatus = 'active' | 'awaiting-cleanup' | 'cleanup-failed' | 'cleanup-in-progress';

/** Liveness uses server times only: the last heartbeat against this read's server time. */
function leaseIsLive(lease: DocumentSnapshot): boolean {
    if (!lease.exists) return false;
    const status = lease.get('status') as LeaseStatus;
    const beat = status === 'active'
        ? lease.get('lastHeartbeatAt')
        : status === 'cleanup-in-progress' ? lease.get('recoveryStartedAt') : null;
    return beat instanceof Timestamp && beat.toMillis() + leaseDurationMs > lease.readTime.toMillis();
}

function describeBlockingLease(snapshot: DocumentSnapshot): string {
    const runId = snapshot.get('runId') ?? 'unknown';
    const status = snapshot.get('status') ?? 'unknown';
    if (leaseIsLive(snapshot)) return `Another stateful E2E run (${runId}) currently holds ${snapshot.ref.path} (${status}).`;
    return [
        `Stateful E2E run ${runId} did not finish cleanup (status: ${status}).`,
        'Stale baselines are never restored automatically. Review the recorded run with',
        `npm run test:e2e:recover -- ${runId} plan,`,
        'then execute it with the digest that plan prints.',
    ].join(' ');
}

async function acquireRunLease(path: string, runId: string, fields: DocumentData): Promise<number> {
    const database = await adminDatabase();
    const reference = database.doc(path);
    await database.runTransaction(async (transaction) => {
        const [current, reset] = await transaction.getAll(reference, database.doc('e2eHarnessLocks/fixture-reset'));
        if (reset.exists) throw new Error('A fixture reset is running; stateful E2E cannot start.');
        if (current.exists) throw new Error(describeBlockingLease(current));
        transaction.create(reference, {
            ...fields,
            runId,
            status: 'active',
            startedAt: FieldValue.serverTimestamp(),
            lastHeartbeatAt: FieldValue.serverTimestamp(),
        });
    });
    const startedAt = (await reference.get()).get('startedAt');
    if (!(startedAt instanceof Timestamp)) throw new Error('The E2E lease has no server start time.');
    return startedAt.toMillis();
}

/** Renews an owned active lease and returns the server time of that renewal. */
async function renewLease(path: string, runId: string): Promise<number> {
    const database = await adminDatabase();
    const reference = database.doc(path);
    await database.runTransaction(async (transaction) => {
        const current = await transaction.get(reference);
        if (!current.exists || current.get('runId') !== runId || current.get('status') !== 'active') {
            throw new LeaseLostError(`The stateful E2E lease ${path} is no longer owned by active run ${runId}.`);
        }
        transaction.update(reference, { lastHeartbeatAt: FieldValue.serverTimestamp() });
    });
    const renewedAt = (await reference.get()).get('lastHeartbeatAt');
    if (!(renewedAt instanceof Timestamp)) throw new Error('The E2E lease has no server heartbeat time.');
    return renewedAt.toMillis();
}

async function updateOwnedLease(path: string, runId: string, fromStatuses: LeaseStatus[], fields: DocumentData): Promise<void> {
    const database = await adminDatabase();
    const reference = database.doc(path);
    await database.runTransaction(async (transaction) => {
        const current = await transaction.get(reference);
        if (!current.exists || current.get('runId') !== runId || !fromStatuses.includes(current.get('status'))) {
            throw new Error(`The stateful E2E lease ${path} is not held by run ${runId} in status ${fromStatuses.join('/')}.`);
        }
        transaction.update(reference, fields);
    });
}

/** Stops treating the run as live; the lease remains until an operator clears it. */
async function parkLease(
    path: string,
    runId: string,
    status: 'awaiting-cleanup' | 'cleanup-failed',
    fromStatuses: LeaseStatus[],
): Promise<void> {
    await updateOwnedLease(path, runId, fromStatuses, { status, parkedAt: FieldValue.serverTimestamp() });
}

/** Deletes the lease and its stored baseline documents together. */
async function releaseLease(path: string, runId: string): Promise<void> {
    const database = await adminDatabase();
    const reference = database.doc(path);
    await database.runTransaction(async (transaction) => {
        const current = await transaction.get(reference);
        if (!current.exists || current.get('runId') !== runId) return;
        for (const baselinePath of ownedBaselinePaths(current, runId)) {
            transaction.delete(database.doc(baselinePath));
        }
        transaction.delete(reference);
    });
}

function startHeartbeat(path: string, runId: string): void {
    const state: HeartbeatState = {
        failures: 0,
        timer: setInterval(() => {
            void renewLease(path, runId).then(
                () => { state.failures = 0; },
                (error) => {
                    state.failures += 1;
                    if (error instanceof LeaseLostError || state.failures >= heartbeatFailureLimit) {
                        state.failure = error;
                        clearInterval(state.timer);
                        // Stop the browser so no run write lands outside the recorded window.
                        leaseLossHandler?.();
                    }
                },
            );
        }, heartbeatIntervalMs),
    };
    state.timer.unref();
    heartbeats.set(runId, state);
}

function stopHeartbeat(runId: string): void {
    const state = heartbeats.get(runId);
    if (state) clearInterval(state.timer);
    heartbeats.delete(runId);
}

function assertHeartbeatHealthy(runId: string): void {
    const failure = heartbeats.get(runId)?.failure;
    if (failure) throw new Error(`The stateful E2E lease heartbeat failed: ${errorMessage(failure)}`);
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export function planDigest(runId: string, lines: string[]): string {
    return createHash('sha256').update(`${runId}\n${lines.join('\n')}`).digest('hex');
}

/**
 * Writes the plan to an ignored local report and the Playwright report. Lines
 * hold document paths (which may include the test accounts' UIDs and email),
 * versions, field names, and reasons; never field values.
 */
async function reportCleanup(
    testInfo: TestInfo | undefined,
    runId: string,
    label: string,
    mode: CleanupMode,
    lines: string[],
    notes: string[] = [],
): Promise<string> {
    const digest = planDigest(runId, lines);
    const report = { runId, label, mode, digest, generatedAt: new Date().toISOString(), notes, lines };
    const body = JSON.stringify(report, null, 2);
    const directory = resolve(cleanupReportDirectory);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, `${runId}-${label}.json`);
    await writeFile(file, body, { mode: 0o600 });
    console.log([
        `[e2e-cleanup] ${label} for run ${runId} (${mode}); digest ${digest}`,
        ...notes.map((note) => `  NOTE ${note}`),
        ...(lines.length ? lines.map((line) => `  ${line}`) : ['  (nothing to do)']),
    ].join('\n'));
    if (testInfo) {
        await testInfo.attach(`cleanup-${label}`, { body, contentType: 'application/json' });
        testInfo.annotations.push({ type: `cleanup-${label}`, description: `${lines.length} line(s), digest ${digest}; see ${file}` });
    }
    return digest;
}

type Problem = { kind: 'unclean' | 'retained'; text: string };

function exportable(value: unknown): unknown {
    if (value instanceof Timestamp) return { timestamp: value.toDate().toISOString() };
    if (value instanceof Uint8Array) return { bytesBase64: Buffer.from(value).toString('base64') };
    if (Array.isArray(value)) return value.map(exportable);
    if (value && typeof value === 'object') {
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) return { value: String(value) };
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, exportable(entry)]));
    }
    return value;
}

/**
 * Before a reviewed release deletes the stored baseline, writes the pre-run
 * contents of retained fixture documents to an ignored local file (owner-only
 * permissions) so they can be restored by hand. This file does contain values.
 */
async function exportRetainedBaseline(runId: string, baseline: PairBaseline | null, plan: CleanupPlan): Promise<void> {
    if (!baseline) return;
    const retainedPaths = new Set(plan.retained.map((item) => item.path));
    const documents = [baseline.patient, baseline.thread, baseline.claim, baseline.clinic]
        .filter((document): document is DocState => Boolean(document && retainedPaths.has(document.path)));
    if (documents.length === 0) return;
    const directory = resolve(cleanupReportDirectory);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, `${runId}-retained-baseline.json`);
    await writeFile(file, JSON.stringify(documents.map((document) => ({
        path: document.path,
        existed: document.exists,
        data: exportable(document.data),
    })), null, 2), { mode: 0o600 });
    console.log(`[e2e-cleanup] pre-run values of ${documents.length} retained document(s) saved to ${file}`);
}

/**
 * Retained items stay untouched by design. They release the lease only in an
 * explicitly reviewed recovery whose acceptance names the run.
 */
function blockingProblems(problems: Problem[], acceptRetainedForRun: string | undefined, runId: string): string[] {
    const acceptRetained = acceptRetainedForRun !== undefined && acceptRetainedForRun === runId;
    return problems.filter((problem) => problem.kind === 'unclean' || !acceptRetained).map((problem) => problem.text);
}

// ---------------------------------------------------------------------------
// Approved patient/clinician pair
// ---------------------------------------------------------------------------

export type E2EPairRun = {
    runId: string;
    runMarker: string;
    runStartMs: number;
    scope: PairScope;
    clinicId: string;
    restoreClinic: boolean;
    baseline: PairBaseline;
};

function pairPaths(scope: PairScope, clinicId: string) {
    return {
        patient: `clients/${scope.patientId}`,
        thread: `messageThreads/${scope.patientId}/relationships/${scope.clinicianId}`,
        claim: `patientInvitationClaims/${scope.clinicianId}/emails/${scope.patientEmail}`,
        clinic: `clinics/${clinicId}`,
    };
}

async function readPairCurrent(scope: PairScope, clinicId: string, includeClinic: boolean): Promise<PairCurrent> {
    const database = await adminDatabase();
    const paths = pairPaths(scope, clinicId);
    const [patient, thread, claim, sessions, patientAppointments, clinicianAppointments, invitations, messages] = await Promise.all([
        database.doc(paths.patient).get(),
        database.doc(paths.thread).get(),
        database.doc(paths.claim).get(),
        database.collection('sessions').where('patientId', '==', scope.patientId).get(),
        database.collection('appointments').where('patientId', '==', scope.patientId).get(),
        database.collection('appointments').where('clinicianId', '==', scope.clinicianId).get(),
        database.collection('patientInvitations').where('clinicianId', '==', scope.clinicianId).get(),
        database.doc(paths.thread).collection('messages').get(),
    ]);
    const appointments = new Map<string, DocState>();
    for (const document of [...patientAppointments.docs, ...clinicianAppointments.docs]) {
        appointments.set(document.ref.path, toDocState(document));
    }
    const current: PairCurrent = {
        patient: toDocState(patient),
        thread: toDocState(thread),
        claim: toDocState(claim),
        sessions: sessions.docs.map(toDocState),
        appointments: [...appointments.values()],
        invitations: invitations.docs.map(toDocState),
        messages: messages.docs.map(toDocState),
    };
    if (includeClinic) {
        const [clinic, clients] = await Promise.all([
            database.doc(paths.clinic).get(),
            database.collection('clients').where('clinicId', '==', clinicId).get(),
        ]);
        current.clinic = toDocState(clinic);
        current.clinicMembership = {
            practitionerIds: clinic.get('practitionerIds'),
            clientIds: clients.docs.map((document) => document.id),
        };
    }
    return current;
}

function patientProfileProblem(document: DocState, scope: PairScope): string | undefined {
    const data = document.data ?? {};
    if (!document.exists) return 'the approved patient has no clients profile';
    if (data.id !== undefined && data.id !== scope.patientId) return 'the patient profile id differs from its UID';
    if (lower(data.email) !== scope.patientEmail) return 'the patient profile email differs from the allow-list';
    return undefined;
}

async function assertExclusiveE2EClinic(scope: PairScope, clinicId: string, current: PairCurrent): Promise<void> {
    const database = await adminDatabase();
    const practitioner = await database.doc(`practitioners/${scope.clinicianId}`).get();
    const patient = current.patient.data ?? {};
    if (
        !practitioner.exists
        || practitioner.get('userId') !== scope.clinicianId
        || practitioner.get('clinicId') !== clinicId
        || patient.clinicId !== clinicId
        // Mirror the rules: canonical clinicianId wins; the legacy field counts
        // only when clinicianId is absent or null.
        || canonicalClinicianId(patient) !== scope.clinicianId
    ) {
        throw new Error('The E2E patient and clinician do not form the expected exclusive linked pair.');
    }
    const problem = current.clinic?.exists
        ? clinicExclusivityProblem(current.clinicMembership, scope)
        : 'the clinic record does not exist';
    if (problem || !current.clinicMembership?.clientIds.includes(scope.patientId)) {
        throw new Error(`Clinic branding E2E requires a clinic used only by the approved pair (${problem ?? 'patient is not a member'}).`);
    }
}

function baselineFrom(current: PairCurrent, scope: PairScope, restoreClinic: boolean): PairBaseline {
    return {
        patient: current.patient,
        thread: current.thread,
        claim: current.claim,
        ...(restoreClinic && current.clinic ? { clinic: current.clinic } : {}),
        sessionVersions: versions(current.sessions),
        appointmentVersions: versions(current.appointments),
        invitationVersions: versions(current.invitations.filter((document) =>
            document.data?.clinicianId === scope.clinicianId && lower(document.data?.patientEmail) === scope.patientEmail)),
        messageVersions: versions(current.messages),
    };
}

type BaselineKey = 'patient' | 'thread' | 'claim' | 'clinic';
const baselineKeys: BaselineKey[] = ['patient', 'thread', 'claim', 'clinic'];

/**
 * Fixture documents are stored one per harness record so a large document
 * (such as a clinic logo) cannot push the lease past Firestore's size limit.
 */
async function storeBaseline(runId: string, baseline: PairBaseline, fields: DocumentData): Promise<void> {
    const database = await adminDatabase();
    const entries = baselineKeys
        .filter((key) => baseline[key])
        .map((key) => ({ key, path: `${baselineCollection}/${runId}-${key}`, document: baseline[key]! }));
    // Record the paths first so a release always finds and removes them.
    await updateOwnedLease(pairLeasePath, runId, ['active'], {
        ...fields,
        baselineDocuments: entries.map((entry) => entry.path),
        baselineIndex: {
            sessionVersions: baseline.sessionVersions,
            appointmentVersions: baseline.appointmentVersions,
            invitationVersions: baseline.invitationVersions,
            messageVersions: baseline.messageVersions,
        },
    });
    for (const entry of entries) {
        await database.doc(entry.path).create({ runId, key: entry.key, document: entry.document });
    }
    await updateOwnedLease(pairLeasePath, runId, ['active'], { baselineComplete: true });
}

/**
 * Baseline record paths stored on a lease, accepted only if each is this run's
 * own harness record, so a malformed lease cannot point a delete elsewhere.
 */
const runIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function ownedBaselinePaths(lease: DocumentSnapshot, runId: string): string[] {
    if (!runIdPattern.test(runId)) throw new Error('Lease run ID is not a harness-generated UUID; refusing to use it.');
    const paths = (lease.get('baselineDocuments') as unknown[] | undefined) ?? [];
    const allowed = new Set(baselineKeys.map((key) => `${baselineCollection}/${runId}-${key}`));
    for (const path of paths) {
        if (typeof path !== 'string' || !allowed.has(path)) {
            throw new Error(`Lease for run ${runId} lists an unexpected baseline path; refusing to use it.`);
        }
    }
    return paths as string[];
}

async function loadBaseline(lease: DocumentSnapshot): Promise<PairBaseline | null> {
    const index = lease.get('baselineIndex') as Omit<PairBaseline, BaselineKey> | undefined;
    const paths = ownedBaselinePaths(lease, String(lease.get('runId')));
    // A run that stopped while storing its baseline made no fixture changes yet.
    if (!index || paths.length === 0 || lease.get('baselineComplete') !== true) return null;
    const database = await adminDatabase();
    const documents: Partial<Record<BaselineKey, DocState>> = {};
    for (const path of paths) {
        const record = await database.doc(path).get();
        if (
            !record.exists
            || record.get('runId') !== lease.get('runId')
            || path !== `${baselineCollection}/${record.get('runId')}-${record.get('key')}`
        ) {
            throw new Error(`Stored baseline ${path} is missing, belongs to another run, or has an unexpected key.`);
        }
        documents[record.get('key') as BaselineKey] = record.get('document') as DocState;
    }
    if (!documents.patient || !documents.thread || !documents.claim) {
        throw new Error('Stored baseline is incomplete.');
    }
    return {
        patient: documents.patient,
        thread: documents.thread,
        claim: documents.claim,
        ...(documents.clinic ? { clinic: documents.clinic } : {}),
        sessionVersions: index.sessionVersions ?? {},
        appointmentVersions: index.appointmentVersions ?? {},
        invitationVersions: index.invitationVersions ?? {},
        messageVersions: index.messageVersions ?? {},
    };
}

/**
 * Starts a stateful run for the approved pair. Nothing but harness records is
 * written until the baseline is stored, so a failure here needs no cleanup.
 */
export async function beginE2EPairRun(
    patient: AuthenticatedE2EIdentity,
    clinician: AuthenticatedE2EIdentity,
    options: { restoreClinic?: boolean } = {},
): Promise<E2EPairRun> {
    requireStatefulRun();
    await verifyAllowedPair(patient, clinician);
    const runId = randomUUID();
    const runMarker = `e2e-run-${runId.replaceAll('-', '').slice(0, 24)}`;
    const scope: PairScope = {
        patientId: patient.uid,
        clinicianId: clinician.uid,
        patientEmail: patient.email.toLowerCase(),
        runMarker,
    };
    const restoreClinic = Boolean(options.restoreClinic);
    const runStartMs = await acquireRunLease(pairLeasePath, runId, {
        kind: 'pair',
        projectId: patient.projectId,
        patientId: scope.patientId,
        clinicianId: scope.clinicianId,
        patientEmail: scope.patientEmail,
        runMarker,
    });
    try {
        const database = await adminDatabase();
        const practitioner = await database.doc(`practitioners/${scope.clinicianId}`).get();
        const practitionerClinicId = practitioner.get('clinicId');
        const clinicId = typeof practitionerClinicId === 'string' && practitionerClinicId ? practitionerClinicId : scope.clinicianId;
        const current = await readPairCurrent(scope, clinicId, restoreClinic);
        const profileProblem = patientProfileProblem(current.patient, scope);
        if (profileProblem) throw new Error(`Refusing to start a stateful run: ${profileProblem}.`);
        if (restoreClinic) await assertExclusiveE2EClinic(scope, clinicId, current);

        const baseline = baselineFrom(current, scope, restoreClinic);
        await storeBaseline(runId, baseline, { clinicId, restoreClinic });
        startHeartbeat(pairLeasePath, runId);
        return { runId, runMarker, runStartMs, scope, clinicId, restoreClinic, baseline };
    } catch (error) {
        await releaseLease(pairLeasePath, runId).catch(() => {});
        throw error;
    }
}

async function assertOwnedActiveRun(run: { runId: string }, path: string): Promise<void> {
    if (finishingRuns.has(run.runId)) throw new Error(`Run ${run.runId} is finishing; no further run changes are allowed.`);
    assertHeartbeatHealthy(run.runId);
    await renewLease(path, run.runId);
}

/**
 * Changes the approved patient's fixture only while the run is active and has
 * not recorded its window end, checked in the same transaction as the write.
 */
async function updatePatientDuringRun(run: E2EPairRun, fields: DocumentData): Promise<void> {
    await assertOwnedActiveRun(run, pairLeasePath);
    const database = await adminDatabase();
    const leaseReference = database.doc(pairLeasePath);
    const patientReference = database.doc(`clients/${run.scope.patientId}`);
    await database.runTransaction(async (transaction) => {
        const [lease, patient] = await transaction.getAll(leaseReference, patientReference);
        if (
            finishingRuns.has(run.runId)
            || !lease.exists
            || lease.get('runId') !== run.runId
            || lease.get('status') !== 'active'
            || lease.get('windowEndAt') !== undefined
        ) {
            throw new Error(`Run ${run.runId} is no longer active; fixture change refused.`);
        }
        if (patientProfileProblem(toDocState(patient), run.scope)) {
            throw new Error('The authenticated E2E patient profile was not found.');
        }
        transaction.update(patientReference, fields);
    });
}

/**
 * Gives the dedicated patient a real supported catalog assignment for the test.
 * This changes fixture data only; the baseline restore reverses it.
 */
export async function prepareE2EPatientForCanonicalTraining(run: E2EPairRun): Promise<void> {
    await updatePatientDuringRun(run, {
        assignedProtocol: 'theta-beta-ratio',
        customProtocolConfig: FieldValue.delete(),
        allowedExperiences: ['skyline-drift'],
        updatedAt: FieldValue.serverTimestamp(),
    });
}

/** Temporarily unlinks the dedicated patient so the invitation UI can be retested. */
export async function prepareE2EPatientForInvitation(run: E2EPairRun): Promise<void> {
    await updatePatientDuringRun(run, {
        clinicId: FieldValue.delete(),
        clinicianId: FieldValue.delete(),
        linkedClinicianCode: FieldValue.delete(),
        acceptedInvitationId: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
    });
}

function baselineDocuments(baseline: PairBaseline | null): Map<string, DocState> {
    const documents = new Map<string, DocState>();
    if (!baseline) return documents;
    for (const document of [baseline.patient, baseline.thread, baseline.claim, baseline.clinic]) {
        if (document) documents.set(document.path, document);
    }
    return documents;
}

/**
 * Applies the whole plan in one transaction: every target is re-read and its
 * version checked first, so either all planned changes land or none do.
 */
async function executePlanAtomically(plan: CleanupPlan, baseline: PairBaseline | null): Promise<string[]> {
    if (plan.actions.length === 0) return [];
    if (plan.actions.length > maxTransactionWrites) {
        return [`Plan has ${plan.actions.length} actions, above the ${maxTransactionWrites}-write transaction limit; nothing was applied.`];
    }
    const database = await adminDatabase();
    const baselineByPath = baselineDocuments(baseline);
    try {
        await database.runTransaction(async (transaction) => {
            const references = plan.actions.map((action) => database.doc(action.path));
            const snapshots = await transaction.getAll(...references);
            plan.actions.forEach((action, index) => {
                const current = snapshots[index];
                if (action.kind === 'recreate') {
                    if (current.exists) throw new Error(`${action.path} exists again; recreate conflicts`);
                } else if (!current.exists || !current.updateTime || versionOf(current.updateTime) !== action.expectedVersion) {
                    throw new Error(`${action.path} changed after the plan was computed`);
                }
            });
            plan.actions.forEach((action, index) => {
                const reference = references[index];
                if (action.kind === 'delete') {
                    transaction.delete(reference);
                    return;
                }
                const stored = baselineByPath.get(action.path);
                if (!stored?.exists || !stored.data) throw new Error(`no baseline data is available for ${action.path}`);
                if (action.kind === 'recreate') transaction.create(reference, stored.data);
                else transaction.set(reference, stored.data);
            });
        }, { maxAttempts: 1 });
        return [];
    } catch (error) {
        return [`Cleanup transaction aborted; nothing was applied: ${errorMessage(error)}`];
    }
}

function markerFieldsStillPresent(current: PairCurrent, runMarker: string): string[] {
    const checks: [DocState[], string][] = [
        [current.sessions, 'patientNotes'],
        [current.appointments, 'notes'],
        [current.invitations, 'patientName'],
        [current.messages, 'text'],
    ];
    return checks.flatMap(([documents, field]) => documents
        .filter((document) => containsRunMarker(document.data?.[field], runMarker))
        .map((document) => document.path));
}

/** Independently re-reads Firestore after cleanup and lists anything left unclean. */
async function verifyPairCleanup(
    scope: PairScope,
    clinicId: string,
    restoreClinic: boolean,
    baseline: PairBaseline | null,
    window: RunWindow,
    options: PlanOptions,
): Promise<Problem[]> {
    const current = await readPairCurrent(scope, clinicId, restoreClinic);
    const plan = planPairCleanup(scope, window, baseline, current, options);
    const retainedPaths = new Set(plan.retained.map((item) => item.path));
    const problems: Problem[] = [
        ...plan.actions.map((action): Problem => ({ kind: 'unclean', text: `still requires ${action.kind}: ${action.path}` })),
        ...plan.retained.map((item): Problem => ({ kind: 'retained', text: `retained: ${item.path} (${item.reason})` })),
        ...markerFieldsStillPresent(current, scope.runMarker).map((path): Problem => ({
            kind: retainedPaths.has(path) ? 'retained' : 'unclean',
            text: `run marker still present: ${path}`,
        })),
    ];
    if (baseline) {
        const pairs: [string, DocState | undefined, DocState | undefined][] = [
            ['patient profile', baseline.patient, current.patient],
            ['message thread', baseline.thread, current.thread],
            ['invitation claim', baseline.claim, current.claim],
            ['clinic', baseline.clinic, baseline.clinic ? current.clinic : undefined],
        ];
        for (const [label, before, after] of pairs) {
            if (!before || !after) continue;
            if (before.exists !== after.exists || (before.exists && !valuesEqual(before.data, after.data))) {
                problems.push({
                    kind: retainedPaths.has(after.path) ? 'retained' : 'unclean',
                    text: `${label} does not match its baseline: ${after.path}`,
                });
            }
        }
    }
    return problems;
}

async function applyPairCleanup(input: {
    runId: string;
    scope: PairScope;
    clinicId: string;
    restoreClinic: boolean;
    baseline: PairBaseline | null;
    window: RunWindow;
    mode: CleanupMode;
    label: 'finish' | 'recovery';
    notes: string[];
    testInfo?: TestInfo;
}): Promise<void> {
    const recovery = input.label === 'recovery';
    const options: PlanOptions = { allowRecreate: !recovery };
    const current = await readPairCurrent(input.scope, input.clinicId, input.restoreClinic);
    const plan = planPairCleanup(input.scope, input.window, input.baseline, current, options);
    const lines = summarizePlan(plan);
    const digest = await reportCleanup(input.testInfo, input.runId, `${input.label}-plan`, input.mode, lines, input.notes);
    if (input.mode === 'plan') {
        if (!recovery) {
            await parkLease(pairLeasePath, input.runId, 'awaiting-cleanup', ['active']);
            input.testInfo?.annotations.push({
                type: 'cleanup-pending',
                description: `Plan-only run: E2E data remains until reviewed with E2E_CLEANUP_RUN_ID=${input.runId} npm run test:e2e:cleanup.`,
            });
        }
        return;
    }
    if (recovery) {
        if (process.env.E2E_CLEANUP_PLAN_SHA?.trim() !== digest) {
            throw new Error(`Recovery execute requires E2E_CLEANUP_PLAN_SHA=${digest} from a reviewed plan of the same state; nothing was applied.`);
        }
        await claimParkedLease(pairLeasePath, input.runId);
    }
    const heldStatus: LeaseStatus = recovery ? 'cleanup-in-progress' : 'active';

    try {
        const failures = await executePlanAtomically(plan, input.baseline);
        const problems = await verifyPairCleanup(input.scope, input.clinicId, input.restoreClinic, input.baseline, input.window, options);
        await reportCleanup(input.testInfo, input.runId, `${input.label}-verification`, input.mode, [...failures, ...problems.map((problem) => problem.text)]);
        const blocking = [
            ...failures,
            ...blockingProblems(problems, recovery ? process.env.E2E_CLEANUP_ACCEPT_RETAINED?.trim() : undefined, input.runId),
        ];
        if (blocking.length > 0) throw new Error(`E2E cleanup for run ${input.runId} is incomplete:\n${blocking.join('\n')}`);
        // Accepted retained fixtures keep run changes; keep their pre-run values locally before the baseline is deleted.
        await exportRetainedBaseline(input.runId, input.baseline, plan);
    } catch (error) {
        await parkLease(pairLeasePath, input.runId, 'cleanup-failed', [heldStatus]).catch(() => {});
        throw error;
    }
    await releaseLease(pairLeasePath, input.runId);
}

/**
 * Ends a pair run after its browser contexts are closed. Plan mode reports and
 * parks the lease for review; execute mode applies the plan, verifies the
 * result, and releases the lease only when the approved pair is back at its
 * baseline.
 */
export async function finishE2EPairRun(run: E2EPairRun, testInfo?: TestInfo): Promise<void> {
    finishingRuns.add(run.runId);
    const mode = cleanupMode();
    try {
        // A heartbeat that failed transiently is fine if the lease is still owned.
        const windowEndMs = await renewLease(pairLeasePath, run.runId);
        stopHeartbeat(run.runId);
        await updateOwnedLease(pairLeasePath, run.runId, ['active'], { windowEndAt: Timestamp.fromMillis(windowEndMs) });
        await applyPairCleanup({
            runId: run.runId,
            scope: run.scope,
            clinicId: run.clinicId,
            restoreClinic: run.restoreClinic,
            baseline: run.baseline,
            window: { startMs: run.runStartMs, endMs: windowEndMs },
            mode,
            label: 'finish',
            notes: [],
            testInfo,
        });
    } catch (error) {
        await parkLease(pairLeasePath, run.runId, 'cleanup-failed', ['active']).catch(() => {});
        throw error;
    } finally {
        stopHeartbeat(run.runId);
    }
}

/** Admin-side read access for persistence assertions; scoped to a live run. */
export async function adminFirestoreForRun(run: { runId: string }): Promise<Firestore> {
    assertHeartbeatHealthy(run.runId);
    return adminDatabase();
}

// ---------------------------------------------------------------------------
// Fresh-account (disposable identity) runs
// ---------------------------------------------------------------------------

export type DisposableE2EAccount = { uid: string; email: string };

/** Collection-group queries that disposable cleanup discovery depends on (read-only). */
async function probeCleanupQueries(): Promise<{ label: string; error?: string }[]> {
    const database = await adminDatabase();
    const probes: [string, () => Promise<unknown>][] = [
        ['collection-group relationships query', () => database.collectionGroup('relationships').where('clinicianId', '==', '__e2e_probe__').limit(1).get()],
        ['collection-group emails query', () => database.collectionGroup('emails').where('patientEmail', '==', '__e2e_probe__').limit(1).get()],
    ];
    return Promise.all(probes.map(async ([label, probe]) => {
        try {
            await probe();
            return { label };
        } catch (error) {
            return { label, error: errorMessage(error) };
        }
    }));
}
export type DisposableE2ERun = { runId: string; projectId: string; emails: string[] };

function disposableRegistryPath(email: string): string {
    return `${disposableRegistryCollection}/${Buffer.from(email.toLowerCase()).toString('base64url')}`;
}

/**
 * Admits one fresh-account run and registers the planned identities before
 * browser signup. Leftovers from earlier runs block admission until reviewed.
 */
export async function beginDisposableE2ERun(
    emails: readonly string[],
    browserProjectId: string,
): Promise<DisposableE2ERun> {
    requireStatefulRun();
    const normalized = emails.map((email) => email.toLowerCase());
    if (normalized.length === 0 || normalized.some((email) => !disposableEmailPattern.test(email))) {
        throw new Error('Refused to register an account outside the disposable E2E namespace.');
    }
    await verifyPrivilegedProject(browserProjectId, { writeSentinel: true });
    // Cleanup must be able to discover linked data before any account exists.
    const unavailable = (await probeCleanupQueries()).filter((probe) => probe.error);
    if (unavailable.length > 0) {
        throw new Error(`Disposable cleanup discovery is unavailable (${unavailable.map((probe) => `${probe.label}: ${probe.error}`).join('; ')}); no account was created.`);
    }
    const runId = randomUUID();
    await acquireRunLease(disposableLeasePath, runId, { kind: 'disposable', projectId: browserProjectId, emails: normalized });
    const { database, authentication } = await adminServices();
    const created: string[] = [];
    try {
        const leftovers = await database.collection(disposableRegistryCollection).limit(20).get();
        if (!leftovers.empty) {
            const runIds = [...new Set(leftovers.docs.map((document) => String(document.get('runId'))))];
            throw new Error(`Disposable identities from run(s) ${runIds.join(', ')} are still registered. Review them with npm run test:e2e:cleanup.`);
        }
        for (const email of normalized) {
            try {
                await authentication.getUserByEmail(email);
                throw new Error('A planned disposable E2E account already exists.');
            } catch (error) {
                if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
            }
            const path = disposableRegistryPath(email);
            await database.doc(path).create({
                email,
                projectId: browserProjectId,
                runId,
                createdAt: FieldValue.serverTimestamp(),
            });
            created.push(path);
        }
        startHeartbeat(disposableLeasePath, runId);
        return { runId, projectId: browserProjectId, emails: normalized };
    } catch (error) {
        // Only registry entries written by this call exist; no Auth user was created yet.
        await Promise.allSettled(created.map((path) => database.runTransaction(async (transaction) => {
            const entry = await transaction.get(database.doc(path));
            if (entry.exists && entry.get('runId') === runId) transaction.delete(entry.ref);
        })));
        await releaseLease(disposableLeasePath, runId).catch(() => {});
        throw error;
    }
}

/** Binds a newly signed-up browser identity to its preexisting run registry. */
export async function recordDisposableE2EAccount(account: DisposableE2EAccount, run: DisposableE2ERun): Promise<void> {
    const email = account.email.toLowerCase();
    if (!disposableEmailPattern.test(email) || !account.uid || !run.emails.includes(email)) {
        throw new Error('Refused to record an identity outside the disposable E2E namespace.');
    }
    await assertOwnedActiveRun(run, disposableLeasePath);
    const { database, authentication } = await adminServices();
    const user = await authentication.getUser(account.uid);
    if (user.email?.toLowerCase() !== email) {
        throw new Error('Disposable browser account does not match its allow-listed run registry.');
    }
    const reference = database.doc(disposableRegistryPath(email));
    await database.runTransaction(async (transaction) => {
        const registry = await transaction.get(reference);
        if (
            !registry.exists
            || registry.get('email') !== email
            || registry.get('projectId') !== run.projectId
            || registry.get('runId') !== run.runId
            || (registry.get('uid') !== undefined && registry.get('uid') !== account.uid)
        ) {
            throw new Error('Disposable browser account does not match its allow-listed run registry.');
        }
        transaction.update(reference, { uid: account.uid });
    });
}

async function readDisposableAccount(email: string): Promise<DisposableAccountState> {
    const { database, authentication } = await adminServices();
    const registrySnapshot = await database.doc(disposableRegistryPath(email)).get();
    const registryCreatedAt = registrySnapshot.get('createdAt');
    const registry: DisposableRegistry = {
        path: registrySnapshot.ref.path,
        exists: registrySnapshot.exists,
        version: registrySnapshot.updateTime ? versionOf(registrySnapshot.updateTime) : undefined,
        email: registrySnapshot.get('email'),
        projectId: registrySnapshot.get('projectId'),
        runId: registrySnapshot.get('runId'),
        uid: registrySnapshot.get('uid'),
        createdAtMs: registryCreatedAt instanceof Timestamp ? registryCreatedAt.toMillis() : undefined,
    };

    let authUser: DisposableAccountState['authUser'] = null;
    try {
        const user = await authentication.getUserByEmail(email);
        authUser = { uid: user.uid, email: user.email, creationTimeMs: Date.parse(user.metadata.creationTime) };
    } catch (error) {
        if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
    }

    const uid = authUser?.uid ?? registry.uid;
    const missing = (path: string): DocState => ({ path, exists: false });
    if (!uid) {
        return {
            email,
            registry,
            authUser,
            linkedDataPaths: [],
            ownDocuments: {
                users: missing('users/(none)'),
                clients: missing('clients/(none)'),
                practitioners: missing('practitioners/(none)'),
                clinics: missing('clinics/(none)'),
            },
        };
    }

    // A query failure (for example a missing collection-group index) rejects
    // the whole read, so nothing is planned for deletion without full evidence.
    const ownClinicPath = `clinics/${uid}`;
    const ownPractitionerPath = `practitioners/${uid}`;
    const linkedQueries = await Promise.all([
        database.collection('sessions').where('patientId', '==', uid).get(),
        database.collection('sessions').where('clinicianId', '==', uid).get(),
        database.collection('sessions').where('clinicId', '==', uid).get(),
        database.collection('appointments').where('patientId', '==', uid).get(),
        database.collection('appointments').where('clinicianId', '==', uid).get(),
        database.collection('patientInvitations').where('patientId', '==', uid).get(),
        database.collection('patientInvitations').where('clinicianId', '==', uid).get(),
        database.collection('patientInvitations').where('patientEmail', '==', email).get(),
        database.collection('clients').where('clinicianId', '==', uid).get(),
        database.collection('clients').where('linkedClinicianCode', '==', uid).get(),
        database.collection('clients').where('clinicId', '==', uid).get(),
        database.collection('clinics').where('practitionerIds', 'array-contains', uid).get(),
        database.collection('practitioners').where('clinicId', '==', uid).get(),
        database.collection('protocolCatalog').where('clinicId', '==', uid).get(),
        database.collection('messages').where('clientId', '==', uid).get(),
        database.collection('messages').where('clinicianId', '==', uid).get(),
        database.collectionGroup('relationships').where('clinicianId', '==', uid).get(),
        database.collectionGroup('emails').where('patientEmail', '==', email).get(),
        database.collection(`messageThreads/${uid}/relationships`).get(),
        database.collection(`patientInvitationClaims/${uid}/emails`).get(),
        database.collection(`clients/${uid}/brainMaps`).get(),
    ]);
    const deviceAssignment = await database.doc(`deviceAssignments/${uid}`).get();
    const linkedDataPaths = [
        ...linkedQueries.flatMap((result) => result.docs.map((document) => document.ref.path)),
        ...(deviceAssignment.exists ? [deviceAssignment.ref.path] : []),
    ].filter((path) => path !== ownClinicPath && path !== ownPractitionerPath);

    const [users, clients, practitioners, clinics] = await Promise.all([
        database.doc(`users/${uid}`).get(),
        database.doc(`clients/${uid}`).get(),
        database.doc(ownPractitionerPath).get(),
        database.doc(ownClinicPath).get(),
    ]);
    return {
        email,
        registry,
        authUser,
        linkedDataPaths: [...new Set(linkedDataPaths)],
        ownDocuments: {
            users: toDocState(users),
            clients: toDocState(clients),
            practitioners: toDocState(practitioners),
            clinics: toDocState(clinics),
        },
    };
}

/** Per identity: its own records atomically, then the Auth user, then the registry entry. */
async function executeDisposablePlans(plans: DisposableAccountPlan[]): Promise<string[]> {
    const { database, authentication } = await adminServices();
    const failures: string[] = [];
    for (const plan of plans) {
        try {
            const deletions = plan.deleteDocuments.filter((action) => action.kind === 'delete');
            if (deletions.length > 0) {
                await database.runTransaction(async (transaction) => {
                    const references = deletions.map((action) => database.doc(action.path));
                    const snapshots = await transaction.getAll(...references);
                    snapshots.forEach((snapshot, index) => {
                        const action = deletions[index];
                        if (!snapshot.exists || !snapshot.updateTime || versionOf(snapshot.updateTime) !== action.expectedVersion) {
                            throw new Error(`${action.path} changed after the plan was computed`);
                        }
                    });
                    references.forEach((reference) => transaction.delete(reference));
                }, { maxAttempts: 1 });
            }
            if (plan.deleteAuthUser && plan.uid) {
                const user = await authentication.getUser(plan.uid);
                if (user.email?.toLowerCase() !== plan.email) throw new Error('Auth email changed after planning');
                await authentication.deleteUser(plan.uid);
            }
            if (plan.deleteRegistry) {
                const registry = plan.deleteRegistry;
                await database.runTransaction(async (transaction) => {
                    const snapshot = await transaction.get(database.doc(registry.path));
                    if (!snapshot.exists || !snapshot.updateTime || versionOf(snapshot.updateTime) !== registry.expectedVersion) {
                        throw new Error(`${registry.path} changed after the plan was computed`);
                    }
                    transaction.delete(snapshot.ref);
                }, { maxAttempts: 1 });
            }
        } catch (error) {
            failures.push(`Disposable cleanup stopped for ${plan.uid ?? plan.deleteRegistry?.path ?? 'an identity'}: ${errorMessage(error)}`);
        }
    }
    return failures;
}

async function verifyDisposableCleanup(emails: string[], plans: DisposableAccountPlan[]): Promise<Problem[]> {
    const retainedIdentities = new Set(plans.filter((plan) => plan.retained.length > 0).map((plan) => plan.email));
    const problems: Problem[] = [];
    for (const email of emails) {
        const state = await readDisposableAccount(email);
        const kind = retainedIdentities.has(email) ? 'retained' : 'unclean';
        if (state.authUser) problems.push({ kind, text: `Auth user still exists for ${state.authUser.uid}` });
        if (state.registry.exists) problems.push({ kind, text: `registry entry still exists: ${state.registry.path}` });
        for (const document of Object.values(state.ownDocuments)) {
            if (document.exists) problems.push({ kind, text: `${document.path} still exists` });
        }
    }
    return problems;
}

async function applyDisposableCleanup(input: {
    runId: string;
    projectId: string;
    emails: string[];
    mode: CleanupMode;
    label: 'finish' | 'recovery';
    testInfo?: TestInfo;
}): Promise<void> {
    const recovery = input.label === 'recovery';
    const states = await Promise.all(input.emails.map(readDisposableAccount));
    const plans = planDisposableCleanup({ projectId: input.projectId, runId: input.runId }, states);
    const digest = await reportCleanup(input.testInfo, input.runId, `${input.label}-plan`, input.mode, summarizeDisposablePlans(plans));
    if (input.mode === 'plan') {
        if (!recovery) {
            await parkLease(disposableLeasePath, input.runId, 'awaiting-cleanup', ['active']);
            input.testInfo?.annotations.push({
                type: 'cleanup-pending',
                description: `Plan-only run: disposable accounts remain until reviewed with E2E_CLEANUP_RUN_ID=${input.runId} npm run test:e2e:cleanup.`,
            });
        }
        return;
    }
    if (recovery) {
        if (process.env.E2E_CLEANUP_PLAN_SHA?.trim() !== digest) {
            throw new Error(`Recovery execute requires E2E_CLEANUP_PLAN_SHA=${digest} from a reviewed plan of the same state; nothing was applied.`);
        }
        await claimParkedLease(disposableLeasePath, input.runId);
    }
    const heldStatus: LeaseStatus = recovery ? 'cleanup-in-progress' : 'active';
    try {
        const failures = await executeDisposablePlans(plans);
        const problems = await verifyDisposableCleanup(input.emails, plans);
        await reportCleanup(input.testInfo, input.runId, `${input.label}-verification`, input.mode, [...failures, ...problems.map((problem) => problem.text)]);
        const blocking = [
            ...failures,
            ...blockingProblems(problems, recovery ? process.env.E2E_CLEANUP_ACCEPT_RETAINED?.trim() : undefined, input.runId),
        ];
        if (blocking.length > 0) throw new Error(`Disposable E2E cleanup for run ${input.runId} is incomplete:\n${blocking.join('\n')}`);
    } catch (error) {
        await parkLease(disposableLeasePath, input.runId, 'cleanup-failed', [heldStatus]).catch(() => {});
        throw error;
    }
    await releaseLease(disposableLeasePath, input.runId);
}

/** Plans (and in execute mode applies and verifies) removal of this run's identities. */
export async function finishDisposableE2ERun(run: DisposableE2ERun, testInfo?: TestInfo): Promise<void> {
    finishingRuns.add(run.runId);
    const mode = cleanupMode();
    try {
        await verifyPrivilegedProject(run.projectId, { writeSentinel: false });
        await renewLease(disposableLeasePath, run.runId);
        stopHeartbeat(run.runId);
        await applyDisposableCleanup({ ...run, mode, label: 'finish', testInfo });
    } catch (error) {
        await parkLease(disposableLeasePath, run.runId, 'cleanup-failed', ['active']).catch(() => {});
        throw error;
    } finally {
        stopHeartbeat(run.runId);
    }
}

// ---------------------------------------------------------------------------
// Explicit review of runs that did not finish cleanly
// ---------------------------------------------------------------------------

/** Takes over a parked or dead lease so no new run or second recovery starts meanwhile. */
async function claimParkedLease(path: string, runId: string): Promise<void> {
    const database = await adminDatabase();
    const reference = database.doc(path);
    await database.runTransaction(async (transaction) => {
        const current = await transaction.get(reference);
        if (!current.exists || current.get('runId') !== runId) throw new Error(`Run ${runId} no longer holds ${path}.`);
        if (leaseIsLive(current)) throw new Error(`Run ${runId} is still active or already being recovered.`);
        transaction.update(reference, {
            status: 'cleanup-in-progress',
            recoveryStartedAt: FieldValue.serverTimestamp(),
        });
    });
}

/**
 * Reviews or cleans a recorded run named explicitly by the operator. Plan mode
 * reads only. The window ends where the run recorded it; for a run that
 * crashed before recording it, shortly after its last heartbeat. Anything
 * modified later (such as manual use of the test accounts) is reported and
 * left untouched.
 */
export async function cleanupRecordedE2ERun(
    runId: string,
    testInfo?: TestInfo,
): Promise<void> {
    const mode = cleanupMode();
    if (mode === 'execute' && process.env.npm_lifecycle_event !== 'test:e2e:cleanup') {
        throw new Error('Recovery execute runs only through npm run test:e2e:cleanup.');
    }
    // Recovery cannot depend on the browser storage states or random passwords
    // from the failed run. Recheck the pinned Auth users through Admin instead.
    const projectId = requireAdminConfiguration().projectId;
    await verifyAllowedPair(
        { ...expectedIdentity('patient'), projectId },
        { ...expectedIdentity('clinician'), projectId },
    );
    const database = await adminDatabase();
    const [pairLease, disposableLease] = await Promise.all([
        database.doc(pairLeasePath).get(),
        database.doc(disposableLeasePath).get(),
    ]);

    if (pairLease.exists && pairLease.get('runId') === runId) {
        if (leaseIsLive(pairLease)) throw new Error(`Run ${runId} is still active or being recovered.`);
        const expectedPatient = expectedIdentity('patient');
        const expectedClinician = expectedIdentity('clinician');
        const runMarker = pairLease.get('runMarker');
        const clinicId = pairLease.get('clinicId');
        if (
            pairLease.get('patientId') !== expectedPatient.uid
            || pairLease.get('clinicianId') !== expectedClinician.uid
            || pairLease.get('patientEmail') !== expectedPatient.email
            || typeof runMarker !== 'string'
        ) {
            throw new Error('The recorded pair run does not belong to the allow-listed accounts.');
        }
        const scope: PairScope = {
            patientId: expectedPatient.uid,
            clinicianId: expectedClinician.uid,
            patientEmail: expectedPatient.email,
            runMarker,
        };
        const baseline = await loadBaseline(pairLease);
        const effectiveClinicId = typeof clinicId === 'string' && clinicId ? clinicId : scope.clinicianId;
        // The lease is harness data; confirm its clinic against the practitioner record.
        const practitionerClinicId = (await database.doc(`practitioners/${scope.clinicianId}`).get()).get('clinicId');
        const expectedClinicId = typeof practitionerClinicId === 'string' && practitionerClinicId ? practitionerClinicId : scope.clinicianId;
        if (effectiveClinicId !== expectedClinicId) {
            throw new Error('The recorded run clinic does not match the clinician practitioner record.');
        }
        if (baseline) {
            const paths = pairPaths(scope, effectiveClinicId);
            if (
                baseline.patient.path !== paths.patient
                || baseline.thread.path !== paths.thread
                || baseline.claim.path !== paths.claim
                || (baseline.clinic && baseline.clinic.path !== paths.clinic)
            ) {
                throw new Error('The recorded baseline does not match the allow-listed pair paths.');
            }
        }
        const startedAt = pairLease.get('startedAt');
        const windowEndAt = pairLease.get('windowEndAt');
        const lastHeartbeatAt = pairLease.get('lastHeartbeatAt');
        if (!(startedAt instanceof Timestamp) || !(lastHeartbeatAt instanceof Timestamp)) {
            throw new Error('The recorded pair run has no server-time window.');
        }
        const exactEnd = windowEndAt instanceof Timestamp;
        const window = {
            startMs: startedAt.toMillis(),
            endMs: exactEnd ? windowEndAt.toMillis() : lastHeartbeatAt.toMillis() + crashedRunGraceMs,
        };
        await applyPairCleanup({
            runId,
            scope,
            clinicId: effectiveClinicId,
            restoreClinic: Boolean(pairLease.get('restoreClinic')) && Boolean(baseline?.clinic),
            baseline,
            window,
            mode,
            label: 'recovery',
            notes: [
                `lease status: ${pairLease.get('status')}`,
                exactEnd
                    ? 'run window end was recorded by the run'
                    : `run crashed before recording its window end; using last heartbeat + ${crashedRunGraceMs / 1000}s (heuristic)`,
            ],
            testInfo,
        });
        return;
    }

    const registryEntries = await database.collection(disposableRegistryCollection).where('runId', '==', runId).get();
    const disposableRun = disposableLease.exists && disposableLease.get('runId') === runId;
    if (disposableRun || !registryEntries.empty) {
        if (disposableRun && leaseIsLive(disposableLease)) throw new Error(`Run ${runId} is still active or being recovered.`);
        if (!disposableRun && disposableLease.exists) {
            throw new Error(`Another disposable run (${disposableLease.get('runId')}) holds the lease; review that run first.`);
        }
        const projectId = requireAdminConfiguration().projectId;
        const emails = [...new Set([
            ...(disposableRun ? (disposableLease.get('emails') as string[] | undefined) ?? [] : []),
            ...registryEntries.docs.map((document) => String(document.get('email'))),
        ])];
        if (!disposableRun && mode === 'execute') {
            // Check the reviewed digest before writing anything, even a lease.
            const states = await Promise.all(emails.map(readDisposableAccount));
            const digest = planDigest(runId, summarizeDisposablePlans(planDisposableCleanup({ projectId, runId }, states)));
            if (process.env.E2E_CLEANUP_PLAN_SHA?.trim() !== digest) {
                throw new Error(`Recovery execute requires E2E_CLEANUP_PLAN_SHA=${digest} from a reviewed plan of the same state; nothing was applied.`);
            }
            // Registry entries without a lease: hold a parked lease while cleaning.
            await acquireRunLease(disposableLeasePath, runId, { kind: 'disposable', projectId, emails, recovered: true });
            await parkLease(disposableLeasePath, runId, 'awaiting-cleanup', ['active']);
        }
        await applyDisposableCleanup({ runId, projectId, emails, mode, label: 'recovery', testInfo });
        return;
    }

    throw new Error(`No recorded stateful E2E run ${runId} was found.`);
}

// ---------------------------------------------------------------------------
// Read-only preflight
// ---------------------------------------------------------------------------

export type HarnessPreflight = { findings: string[]; blockers: Record<string, string[]> };

function describeLease(label: string, lease: DocumentSnapshot): string {
    if (!lease.exists) return `${label}: free`;
    return `${label}: held by run ${lease.get('runId')} (status ${lease.get('status')}${leaseIsLive(lease) ? ', live' : ', not live'})`;
}

/**
 * Checks Admin configuration, identities, leases, registry, and fixture
 * readiness without writing anything to Firestore or Auth.
 */
export async function inspectE2EHarness(
    patient: AuthenticatedE2EIdentity,
    clinician: AuthenticatedE2EIdentity,
): Promise<HarnessPreflight> {
    await verifyAllowedPair(patient, clinician);
    await verifyPrivilegedProject(patient.projectId, { writeSentinel: false });
    const { database, authentication } = await adminServices();
    const findings: string[] = [
        `project ${patient.projectId}; browser identities, allow-list, and Admin Auth records agree`,
        `cleanup mode: ${process.env.E2E_CLEANUP_MODE?.trim() || '(unset)'}`,
    ];
    const blockers: Record<string, string[]> = { 'stateful-patient': [], 'stateful-clinician': [], 'stateful-isolation': [] };
    const blockAll = (reason: string) => Object.values(blockers).forEach((list) => list.push(reason));
    try {
        const outsider = await authentication.getUser(fixtureIdentities.outsider.uid);
        if (outsider.email?.toLowerCase() !== fixtureIdentities.outsider.email || !outsider.emailVerified) {
            blockers['stateful-isolation'].push('outsider Auth identity is not the verified fixture account');
        }
    } catch {
        blockers['stateful-isolation'].push('outsider Auth identity is missing; run npm run test:e2e:session -- reset');
    }

    const [pairLease, disposableLease, resetLock, registry, patientProfile, practitioner, clinicianUser, outsiderUser, outsiderProfile] = await Promise.all([
        database.doc(pairLeasePath).get(),
        database.doc(disposableLeasePath).get(),
        database.doc('e2eHarnessLocks/fixture-reset').get(),
        database.collection(disposableRegistryCollection).limit(20).get(),
        database.doc(`clients/${patient.uid}`).get(),
        database.doc(`practitioners/${clinician.uid}`).get(),
        database.doc(`users/${clinician.uid}`).get(),
        database.doc(`users/${fixtureIdentities.outsider.uid}`).get(),
        database.doc(`clients/${fixtureIdentities.outsider.uid}`).get(),
    ]);
    findings.push(describeLease('pair lease', pairLease), describeLease('disposable lease', disposableLease));
    if (resetLock.exists) blockAll('fixture reset lock is held');
    if (pairLease.exists) {
        blockers['stateful-patient'].push('pair lease is held');
        blockers['stateful-clinician'].push('pair lease is held');
    }
    if (disposableLease.exists) blockers['stateful-isolation'].push('disposable lease is held');
    findings.push(`disposable registry entries: ${registry.size}`);
    if (!registry.empty) blockers['stateful-isolation'].push('disposable registry has leftover entries');

    const scope: PairScope = {
        patientId: patient.uid,
        clinicianId: clinician.uid,
        patientEmail: patient.email.toLowerCase(),
        runMarker: '',
    };
    const profileProblem = patientProfileProblem(toDocState(patientProfile), scope);
    findings.push(`patient profile: ${profileProblem ?? 'present and matches allow-list'}`);
    if (profileProblem) {
        blockers['stateful-patient'].push(profileProblem);
        blockers['stateful-clinician'].push(profileProblem);
    }
    const linkedClinician = canonicalClinicianId(patientProfile.data() ?? {});
    findings.push(`patient canonically linked to approved clinician: ${linkedClinician === clinician.uid}`);
    if (linkedClinician !== clinician.uid) blockers['stateful-clinician'].push('patient is not canonically linked to the approved clinician');

    const practitionerOk = practitioner.exists && practitioner.get('userId') === clinician.uid;
    findings.push(`practitioner record: ${practitioner.exists ? (practitionerOk ? 'present' : 'present but userId differs') : 'missing'}`);
    if (!practitionerOk) blockers['stateful-clinician'].push('clinician practitioner record is missing or mismatched');
    if (clinicianUser.get('role') !== 'clinician') blockAll('clinician role grant in users/{uid} is missing');
    if (outsiderUser.get('role') !== 'patient' || !outsiderProfile.exists ||
        outsiderProfile.get('clinicianId') || outsiderProfile.get('linkedClinicianCode') || outsiderProfile.get('clinicId')) {
        blockers['stateful-isolation'].push('outsider fixture is missing or linked to a clinician');
    }

    const clinicId = typeof practitioner.get('clinicId') === 'string' && practitioner.get('clinicId')
        ? practitioner.get('clinicId') as string
        : clinician.uid;
    const [clinic, clinicClients] = await Promise.all([
        database.doc(`clinics/${clinicId}`).get(),
        database.collection('clients').where('clinicId', '==', clinicId).get(),
    ]);
    const exclusivity = clinic.exists
        ? clinicExclusivityProblem({ practitionerIds: clinic.get('practitionerIds'), clientIds: clinicClients.docs.map((document) => document.id) }, scope)
        : 'clinic record does not exist';
    findings.push(`clinic ${clinicId}: ${exclusivity ?? 'used only by the approved pair'}`);
    if (exclusivity) blockers['stateful-clinician'].push(`branding scenario: ${exclusivity}`);

    for (const probe of await probeCleanupQueries()) {
        findings.push(`${probe.label}: ${probe.error ? `unavailable (${probe.error})` : 'available'}`);
        if (probe.error) blockers['stateful-isolation'].push(`disposable cleanup discovery needs the ${probe.label}`);
    }

    if (process.env.E2E_CLEANUP_MODE !== 'plan' && process.env.E2E_CLEANUP_MODE !== 'execute') {
        blockAll('E2E_CLEANUP_MODE is not set to plan or execute');
    }
    return { findings, blockers };
}
