/**
 * Pure cleanup planning from the former deployed-project stateful E2E harness,
 * which this repository no longer has. It stays only because
 * persistenceAssertions.ts (local emulator specs) uses its run-marker helpers.
 *
 * Nothing here talks to Firebase. The removed harness read Firestore into these
 * shapes, asked for a plan, reported it, and (only in execute mode) applied it
 * atomically with update-time checks. A document is deleted only with positive
 * evidence that the current run created it: the run marker in a field the test
 * wrote, the expected owner/UID fields, and server create/update times inside
 * the run window. A pre-existing fixture document is restored only when every
 * changed field is one the run's own code path writes and no related record is
 * left unattributed. Everything else is reported and left untouched.
 */

export type DocState = {
    path: string;
    exists: boolean;
    /** Server create/update times in milliseconds; absent for missing documents. */
    createTimeMs?: number;
    updateTimeMs?: number;
    /** Exact server update time (`seconds.nanoseconds`) for equality and write preconditions. */
    version?: string;
    data?: Record<string, unknown>;
};

/** Server-time bounds of the run. Writes outside them are never attributed to the run. */
export type RunWindow = { startMs: number; endMs: number };

export type PairScope = {
    patientId: string;
    clinicianId: string;
    patientEmail: string;
    runMarker: string;
};

export type PairBaseline = {
    patient: DocState;
    thread: DocState;
    claim: DocState;
    /** Present only when the run may change clinic-wide branding. */
    clinic?: DocState;
    /** Paths and update versions of every pre-existing related record. */
    sessionVersions: Record<string, string>;
    appointmentVersions: Record<string, string>;
    invitationVersions: Record<string, string>;
    messageVersions: Record<string, string>;
};

export type ClinicMembership = { practitionerIds: unknown; clientIds: string[] };

export type PairCurrent = {
    patient: DocState;
    thread: DocState;
    claim: DocState;
    clinic?: DocState;
    clinicMembership?: ClinicMembership;
    /** Sessions whose patientId is the scoped patient. */
    sessions: DocState[];
    /** Appointments for the scoped patient or created by the scoped clinician. */
    appointments: DocState[];
    /** Invitations whose clinicianId is the scoped clinician (any patient). */
    invitations: DocState[];
    /** Messages in the scoped pair's thread. */
    messages: DocState[];
};

export type CleanupAction =
    | { kind: 'delete'; path: string; expectedVersion: string; reason: string }
    | { kind: 'restore'; path: string; expectedVersion: string; changedFields: string[]; reason: string }
    | { kind: 'recreate'; path: string; reason: string };

export type RetainedDocument = { path: string; reason: string };

export type CleanupPlan = {
    actions: CleanupAction[];
    /** Changed or new documents that could not be positively attributed to the run. */
    retained: RetainedDocument[];
};

export type PlanOptions = {
    /**
     * Recreating a deleted baseline document has no time evidence, so it is
     * allowed only while the finishing run itself is cleaning up.
     */
    allowRecreate: boolean;
};

/** Markers are long random tokens; short strings could match ordinary text. */
export const minimumRunMarkerLength = 16;

export function containsRunMarker(value: unknown, runMarker: string): boolean {
    return runMarker.length >= minimumRunMarkerLength
        && typeof value === 'string'
        && value.includes(runMarker);
}

export type RestorableFields = {
    /** Fields the run's code path may overwrite whatever their earlier value. */
    always: ReadonlySet<string>;
    /** Fields the run only fills in when they were empty, so a change to a non-empty value is not the run's. */
    whenBaselineEmpty: ReadonlySet<string>;
};

/**
 * Fields each fixture document's run-time writers may change. A change to any
 * other field is not attributable to the run, so the document is not restored.
 */
export const restorableFields = {
    // Session completion and invitation acceptance merge a normalized profile
    // (readClientProfile adds id/brainMaps/badges/schemaVersion/allowedExperiences);
    // acceptance overwrites the care-plan fields from the invitation; the
    // prepare helpers change the protocol assignment and relationship fields.
    patient: {
        always: new Set([
            'brainMaps', 'badges', 'schemaVersion', 'allowedExperiences', 'assignedProtocol', 'customProtocolConfig',
            'recentCompletedSessionIds', 'completedSessionsCount', 'lastSessionDate',
            'skylineBiomesUnlocked', 'tidalGardenState',
            'clinicId', 'clinicianId', 'linkedClinicianCode', 'acceptedInvitationId',
            'condition', 'prescribedSessionsPerWeek', 'notes', 'updatedAt',
        ]),
        whenBaselineEmpty: new Set(['id', 'patientId', 'email', 'name']),
    },
    thread: {
        always: new Set([
            'patientId', 'clinicianId', 'participantIds', 'lastMessageText', 'lastMessageId',
            'lastSenderId', 'lastMessageAt', 'updatedAt', 'createdAt', 'schemaVersion',
        ]),
        whenBaselineEmpty: new Set<string>(),
    },
    claim: {
        always: new Set(['clinicianId', 'clinicId', 'patientEmail', 'invitationId', 'status', 'expiresAt', 'createdAt']),
        whenBaselineEmpty: new Set<string>(),
    },
    // saveBrand always writes branding; it keeps existing name/timezone/membership.
    clinic: {
        always: new Set(['branding', 'updatedAt']),
        whenBaselineEmpty: new Set(['id', 'name', 'timezone', 'practitionerIds', 'createdAt']),
    },
} satisfies Record<string, RestorableFields>;

function isEmptyValue(value: unknown): boolean {
    return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

/**
 * Structural equality for Firestore values. Timestamps, GeoPoints, and
 * references compare with their own `isEqual`; bytes compare by content.
 */
export function valuesEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) return true;
    if (left === null || right === null || left === undefined || right === undefined) return false;
    if (left instanceof Uint8Array || right instanceof Uint8Array) {
        return left instanceof Uint8Array && right instanceof Uint8Array
            && left.length === right.length
            && left.every((byte, index) => byte === right[index]);
    }
    if (Array.isArray(left) || Array.isArray(right)) {
        if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
        return left.every((value, index) => valuesEqual(value, right[index]));
    }
    if (isPlainObject(left) && isPlainObject(right)) {
        const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
        return [...keys].every((key) => valuesEqual(left[key], right[key]));
    }
    if (typeof left === 'object' && typeof right === 'object') {
        const comparable = left as { isEqual?: (other: unknown) => boolean };
        if (typeof comparable.isEqual === 'function' && left.constructor === right.constructor) {
            return comparable.isEqual(right);
        }
        if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
    }
    return false;
}

export function changedFieldNames(
    baseline: Record<string, unknown> | undefined,
    current: Record<string, unknown> | undefined,
): string[] {
    const before = baseline ?? {};
    const after = current ?? {};
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
        .filter((key) => !valuesEqual(before[key], after[key]))
        .sort();
}

/**
 * Mirrors the Firestore rules: a non-null canonical clinicianId always wins;
 * the legacy linkedClinicianCode counts only when clinicianId is absent or null.
 */
export function canonicalClinicianId(patient: Record<string, unknown>): string | null {
    const canonical = patient.clinicianId;
    if (canonical !== undefined && canonical !== null) return typeof canonical === 'string' ? canonical : null;
    return typeof patient.linkedClinicianCode === 'string' ? patient.linkedClinicianCode : null;
}

/** Returns a reason when a new document's server times are not inside the run window. */
export function outsideRunWindow(document: DocState, window: RunWindow): string | undefined {
    if (!document.version || document.createTimeMs === undefined || document.updateTimeMs === undefined) {
        return 'missing server create/update time';
    }
    if (document.createTimeMs < window.startMs) return 'created before the run started';
    if (document.createTimeMs > window.endMs) return 'created after the run window closed';
    if (document.updateTimeMs > window.endMs) return 'modified after the run window closed';
    return undefined;
}

type Attribution = { identified: true } | { identified: false; reason: string };

function attribute(document: DocState, window: RunWindow, checks: [boolean, string][]): Attribution {
    for (const [passes, failure] of checks) {
        if (!passes) return { identified: false, reason: failure };
    }
    const timing = outsideRunWindow(document, window);
    return timing ? { identified: false, reason: timing } : { identified: true };
}

function lowerEmail(value: unknown): string | undefined {
    return typeof value === 'string' ? value.trim().toLowerCase() : undefined;
}

export function attributeSession(document: DocState, scope: PairScope, window: RunWindow): Attribution {
    const data = document.data ?? {};
    return attribute(document, window, [
        [data.patientId === scope.patientId, 'session belongs to a different patient'],
        [data.isDemo === true, 'session is not a Training Demo session'],
        [containsRunMarker(data.patientNotes, scope.runMarker), 'session notes do not contain the run marker'],
    ]);
}

export function attributeAppointment(document: DocState, scope: PairScope, window: RunWindow): Attribution {
    const data = document.data ?? {};
    return attribute(document, window, [
        [data.patientId === scope.patientId, 'appointment belongs to a different patient'],
        [data.clinicianId === scope.clinicianId, 'appointment belongs to a different clinician'],
        [data.createdBy === scope.clinicianId, 'appointment was created by a different account'],
        [containsRunMarker(data.notes, scope.runMarker), 'appointment notes do not contain the run marker'],
    ]);
}

export function isScopedInvitation(document: DocState, scope: PairScope): boolean {
    const data = document.data ?? {};
    return data.clinicianId === scope.clinicianId && lowerEmail(data.patientEmail) === scope.patientEmail;
}

export function attributeInvitation(document: DocState, scope: PairScope, window: RunWindow): Attribution {
    const data = document.data ?? {};
    return attribute(document, window, [
        [isScopedInvitation(document, scope), 'invitation is for a different clinician or patient'],
        [data.patientId === undefined || data.patientId === scope.patientId, 'invitation was accepted by a different patient'],
        [containsRunMarker(data.patientName, scope.runMarker), 'invitation patient name does not contain the run marker'],
    ]);
}

export function attributeMessage(document: DocState, scope: PairScope, window: RunWindow): Attribution {
    const data = document.data ?? {};
    return attribute(document, window, [
        [data.patientId === scope.patientId && data.clinicianId === scope.clinicianId, 'message belongs to a different relationship'],
        [data.senderId === scope.patientId || data.senderId === scope.clinicianId, 'message sender is outside the approved pair'],
        [containsRunMarker(data.text, scope.runMarker), 'message text does not contain the run marker'],
    ]);
}

type RestoreDecision =
    | { kind: 'unchanged' }
    | { kind: 'created' }
    | { kind: 'action'; action: CleanupAction }
    | { kind: 'retained'; reason: string };

/**
 * Decides how to return a pre-existing fixture document to its baseline. A
 * document last modified outside the run window, or with changes outside the
 * fields the run writes, is never overwritten.
 */
export function planRestore(
    baseline: DocState,
    current: DocState,
    window: RunWindow,
    fields: RestorableFields,
    options: PlanOptions,
): RestoreDecision {
    if (!baseline.exists && !current.exists) return { kind: 'unchanged' };
    if (!baseline.exists) return { kind: 'created' };
    if (!current.exists) {
        return options.allowRecreate
            ? { kind: 'action', action: { kind: 'recreate', path: current.path, reason: 'baseline document was removed during the finishing run' } }
            : { kind: 'retained', reason: 'baseline document is missing; recreation has no time evidence outside the finishing run' };
    }
    if (baseline.version && baseline.version === current.version) return { kind: 'unchanged' };
    const changedFields = changedFieldNames(baseline.data, current.data);
    if (changedFields.length === 0) return { kind: 'unchanged' };
    if (!current.version || current.updateTimeMs === undefined) {
        return { kind: 'retained', reason: 'current document has no server update time' };
    }
    if (current.updateTimeMs < window.startMs) {
        return { kind: 'retained', reason: 'document differs from baseline but was last modified before the run started' };
    }
    if (current.updateTimeMs > window.endMs) {
        return { kind: 'retained', reason: 'document was modified after the run window closed' };
    }
    const unexpected = changedFields.filter((field) =>
        !fields.always.has(field)
        && !(fields.whenBaselineEmpty.has(field) && isEmptyValue(baseline.data?.[field])));
    if (unexpected.length > 0) {
        return { kind: 'retained', reason: `fields the run never writes changed (${unexpected.join(', ')})` };
    }
    return {
        kind: 'action',
        action: {
            kind: 'restore',
            path: current.path,
            expectedVersion: current.version,
            changedFields,
            reason: 'pre-existing fixture document changed during the run window',
        },
    };
}

function sameIds(value: unknown, expected: string[]): boolean {
    return Array.isArray(value)
        && value.length === expected.length
        && value.every((entry, index) => entry === expected[index]);
}

/** A clinic may be restored only while the approved pair are its only members. */
export function clinicExclusivityProblem(membership: ClinicMembership | undefined, scope: PairScope): string | undefined {
    if (!membership) return 'clinic membership was not read';
    if (!sameIds(membership.practitionerIds, [scope.clinicianId])) {
        return 'clinic has practitioners other than the approved clinician';
    }
    if (membership.clientIds.some((clientId) => clientId !== scope.patientId)) {
        return 'clinic has patients other than the approved patient';
    }
    return undefined;
}

function deleteAction(document: DocState, reason: string): CleanupAction {
    return { kind: 'delete', path: document.path, expectedVersion: document.version!, reason };
}

function documentId(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1);
}

type Group = 'patient' | 'thread' | 'claim';

type ChildCandidate = { document: DocState; label: string; groups: Group[]; retainedReason?: string };

type ParentDecision =
    | { kind: 'none' }
    | { kind: 'action'; action: CleanupAction }
    | { kind: 'retained'; reason: string };

/**
 * Plans cleanup for the approved patient/clinician pair. `baseline` is null
 * when a run stopped before storing one; restores are then impossible and are
 * reported, while marker-identified documents can still be removed.
 *
 * Each parent fixture document and the records that affect it form a group
 * (patient: sessions and invitations; thread: messages; claim: invitations).
 * A group is cleaned all-or-nothing: if any member cannot be attributed or
 * restored, every member of the group, and of groups sharing its records, is
 * left untouched so no parent points at a deleted child or keeps its effects.
 */
export function planPairCleanup(
    scope: PairScope,
    window: RunWindow,
    baseline: PairBaseline | null,
    current: PairCurrent,
    options: PlanOptions,
): CleanupPlan {
    const retained: RetainedDocument[] = [];
    const independentDeletions: CleanupAction[] = [];
    const candidates: ChildCandidate[] = [];
    const unsettled = new Set<Group>();

    const classify = (
        documents: DocState[],
        baselineVersions: Record<string, string> | undefined,
        attributeDocument: (document: DocState) => Attribution,
        label: string,
        groups: Group[],
    ) => {
        const known = baselineVersions ?? {};
        const present = new Set(documents.map((document) => document.path));
        for (const path of Object.keys(known)) {
            if (!present.has(path)) {
                retained.push({ path, reason: `pre-existing ${label} is missing` });
                groups.forEach((group) => unsettled.add(group));
            }
        }
        for (const document of documents) {
            if (document.path in known) {
                if (known[document.path] !== document.version) {
                    retained.push({ path: document.path, reason: `pre-existing ${label} was modified` });
                    groups.forEach((group) => unsettled.add(group));
                }
                continue;
            }
            const attribution = attributeDocument(document);
            if (!attribution.identified) {
                retained.push({ path: document.path, reason: `new ${label} not attributed to this run: ${attribution.reason}` });
                groups.forEach((group) => unsettled.add(group));
            } else if (groups.length === 0) {
                independentDeletions.push(deleteAction(document, `${label} created by this run (marker, owner, and run window verified)`));
            } else {
                candidates.push({ document, label, groups });
            }
        }
    };

    classify(current.messages, baseline?.messageVersions, (document) => attributeMessage(document, scope, window), 'message', ['thread']);
    classify(current.sessions, baseline?.sessionVersions, (document) => attributeSession(document, scope, window), 'session', ['patient']);
    classify(current.appointments, baseline?.appointmentVersions, (document) => attributeAppointment(document, scope, window), 'appointment', []);
    classify(
        current.invitations.filter((document) => isScopedInvitation(document, scope)),
        baseline?.invitationVersions,
        (document) => attributeInvitation(document, scope, window),
        'invitation',
        ['patient', 'claim'],
    );
    // Invitations to other patients are not the run's, but one carrying the
    // marker means the run misdirected an invitation; report it.
    for (const document of current.invitations) {
        if (!isScopedInvitation(document, scope) && containsRunMarker(document.data?.patientName, scope.runMarker)) {
            retained.push({ path: document.path, reason: 'run-marked invitation addressed to another patient' });
        }
    }

    const candidateInvitationIds = new Set(candidates
        .filter((candidate) => candidate.label === 'invitation')
        .map((candidate) => documentId(candidate.document.path)));

    const decideParent = (
        label: string,
        baselineDocument: DocState | undefined,
        currentDocument: DocState,
        fields: RestorableFields,
        decideCreated: () => ParentDecision,
    ): ParentDecision => {
        if (!baselineDocument) {
            return currentDocument.exists
                ? { kind: 'retained', reason: `${label} cannot be restored because no baseline was stored` }
                : { kind: 'none' };
        }
        const decision = planRestore(baselineDocument, currentDocument, window, fields, options);
        if (decision.kind === 'created') return decideCreated();
        if (decision.kind === 'retained') return { kind: 'retained', reason: `${label}: ${decision.reason}` };
        if (decision.kind === 'action') return { kind: 'action', action: decision.action };
        return { kind: 'none' };
    };

    const parents: Record<Group, { path: string; label: string; decision: ParentDecision }> = {
        thread: {
            path: current.thread.path,
            label: 'message thread',
            decision: decideParent('message thread', baseline?.thread, current.thread, restorableFields.thread, () => {
                const data = current.thread.data ?? {};
                const attribution = attribute(current.thread, window, [
                    [data.patientId === scope.patientId && data.clinicianId === scope.clinicianId, 'thread belongs to a different relationship'],
                    [containsRunMarker(data.lastMessageText, scope.runMarker), 'thread summary does not reference a run message'],
                ]);
                return attribution.identified
                    ? { kind: 'action', action: deleteAction(current.thread, 'message thread created by this run') }
                    : { kind: 'retained', reason: `new message thread not attributed to this run: ${attribution.reason}` };
            }),
        },
        claim: {
            path: current.claim.path,
            label: 'invitation claim',
            decision: decideParent('invitation claim', baseline?.claim, current.claim, restorableFields.claim, () => {
                const data = current.claim.data ?? {};
                const attribution = attribute(current.claim, window, [
                    [data.clinicianId === scope.clinicianId && lowerEmail(data.patientEmail) === scope.patientEmail, 'claim is for a different clinician or patient'],
                    [typeof data.invitationId === 'string' && candidateInvitationIds.has(data.invitationId), 'claim does not point to an invitation created by this run'],
                ]);
                return attribution.identified
                    ? { kind: 'action', action: deleteAction(current.claim, 'invitation claim created by this run') }
                    : { kind: 'retained', reason: `new invitation claim not attributed to this run: ${attribution.reason}` };
            }),
        },
        patient: {
            path: current.patient.path,
            label: 'patient profile',
            decision: decideParent('patient profile', baseline?.patient, current.patient, restorableFields.patient, () => ({
                kind: 'retained',
                reason: 'patient profile did not exist at baseline and is never deleted',
            })),
        },
    };
    for (const [group, parent] of Object.entries(parents) as [Group, (typeof parents)[Group]][]) {
        if (parent.decision.kind === 'retained') unsettled.add(group);
    }

    // Spread unsettled state through records shared between groups until stable.
    let changed = true;
    while (changed) {
        changed = false;
        for (const candidate of candidates) {
            if (candidate.retainedReason) continue;
            const blocking = candidate.groups.find((group) => unsettled.has(group));
            if (!blocking) continue;
            candidate.retainedReason = `${candidate.label} created by this run is kept with its ${parents[blocking].label}, which is not being cleaned`;
            for (const group of candidate.groups) {
                if (!unsettled.has(group)) {
                    unsettled.add(group);
                    changed = true;
                }
            }
        }
    }

    const restores: CleanupAction[] = [];
    const deletions: CleanupAction[] = [];
    for (const candidate of candidates) {
        if (candidate.retainedReason) retained.push({ path: candidate.document.path, reason: candidate.retainedReason });
        else deletions.push(deleteAction(candidate.document, `${candidate.label} created by this run (marker, owner, and run window verified)`));
    }
    for (const [group, parent] of Object.entries(parents) as [Group, (typeof parents)[Group]][]) {
        const decision = parent.decision;
        if (decision.kind === 'retained') {
            retained.push({ path: parent.path, reason: decision.reason });
        } else if (decision.kind === 'action') {
            if (unsettled.has(group)) {
                retained.push({ path: parent.path, reason: `${parent.label} not cleaned: a related record is left untouched` });
            } else if (decision.action.kind === 'delete') {
                deletions.push(decision.action);
            } else {
                restores.push(decision.action);
            }
        }
    }

    if (baseline?.clinic && current.clinic) {
        const problem = clinicExclusivityProblem(current.clinicMembership, scope);
        const decision = planRestore(baseline.clinic, current.clinic, window, restorableFields.clinic, options);
        if (problem && decision.kind !== 'unchanged') {
            retained.push({ path: current.clinic.path, reason: `clinic restore refused: ${problem}` });
        } else if (!problem) {
            if (decision.kind === 'action') restores.push(decision.action);
            else if (decision.kind === 'retained') retained.push({ path: current.clinic.path, reason: `clinic: ${decision.reason}` });
            else if (decision.kind === 'created') retained.push({ path: current.clinic.path, reason: 'clinic did not exist at baseline and is never deleted' });
        }
    }

    return { actions: [...restores, ...deletions, ...independentDeletions], retained };
}

export type DisposableRegistry = {
    path: string;
    exists: boolean;
    version?: string;
    email?: string;
    projectId?: string;
    runId?: string;
    uid?: string;
    createdAtMs?: number;
};

export type DisposableAuthUser = { uid: string; email?: string; creationTimeMs: number };

export type DisposableAccountState = {
    email: string;
    registry: DisposableRegistry;
    /** null when Auth has no user for the email/UID. */
    authUser: DisposableAuthUser | null;
    /** Paths of data linking this identity to anything beyond its own signup records. */
    linkedDataPaths: string[];
    ownDocuments: { users: DocState; clients: DocState; practitioners: DocState; clinics: DocState };
};

export type DisposableAccountPlan = {
    email: string;
    uid?: string;
    deleteDocuments: CleanupAction[];
    deleteAuthUser: boolean;
    deleteRegistry: { path: string; expectedVersion: string } | null;
    retained: RetainedDocument[];
};

export const disposableEmailPattern = /^neurasticity-e2e-(patient|clinician)-[a-f0-9]{32}@example\.com$/;

/** Auth and Firestore clocks are separate services; allow this much skew between them. */
export const authClockSkewMs = 5_000;

function ownDocumentProblem(
    name: keyof DisposableAccountState['ownDocuments'],
    document: DocState,
    account: { uid: string; email: string },
    registryCreatedAtMs: number,
): string | undefined {
    const data = document.data ?? {};
    if (document.createTimeMs === undefined || !document.version) return 'missing server create time';
    if (document.createTimeMs < registryCreatedAtMs) return 'created before the disposable identity was registered';
    if (name === 'users' && data.email !== undefined && lowerEmail(data.email) !== account.email) return 'user profile email differs';
    if (name === 'clients' && data.id !== undefined && data.id !== account.uid) return 'client profile id differs';
    if (name === 'clients' && data.email !== undefined && lowerEmail(data.email) !== account.email) return 'client profile email differs';
    if (name === 'practitioners' && data.userId !== account.uid) return 'practitioner userId differs';
    if (name === 'clinics' && !sameIds(data.practitionerIds, [account.uid])) return 'clinic has members other than the disposable clinician';
    return undefined;
}

/**
 * Plans removal of identities created by the fresh-account scenario. Evidence:
 * the strict random email namespace, an Admin-only registry entry written for
 * this run before signup, an Auth account created after that entry, and own
 * signup documents created after it. Anything else is retained.
 */
export function planDisposableCleanup(
    scope: { projectId: string; runId: string },
    accounts: DisposableAccountState[],
): DisposableAccountPlan[] {
    return accounts.map((account) => {
        const email = account.email.toLowerCase();
        const plan: DisposableAccountPlan = {
            email,
            uid: account.authUser?.uid ?? account.registry.uid,
            deleteDocuments: [],
            deleteAuthUser: false,
            deleteRegistry: null,
            retained: [],
        };
        const retainAll = (reason: string) => {
            plan.retained.push({ path: account.registry.path, reason });
            return plan;
        };
        const registry = account.registry;
        if (!disposableEmailPattern.test(email)) return retainAll('email is outside the disposable E2E namespace');
        if (
            !registry.exists
            || !registry.version
            || registry.email !== email
            || registry.projectId !== scope.projectId
            || registry.runId !== scope.runId
            || registry.createdAtMs === undefined
        ) {
            return retainAll('registry entry is missing or belongs to a different project or run');
        }
        const auth = account.authUser;
        if (auth) {
            if (lowerEmail(auth.email) !== email) return retainAll('Auth account email differs from the registry');
            if (registry.uid && registry.uid !== auth.uid) return retainAll('Auth UID differs from the registered UID');
            if (auth.creationTimeMs < registry.createdAtMs - authClockSkewMs) {
                return retainAll('Auth account predates its registry entry');
            }
        }
        const uid = plan.uid;
        if (account.linkedDataPaths.length > 0) {
            return retainAll(`identity has unexpected linked data (${account.linkedDataPaths.length} record(s))`);
        }
        if (uid) {
            for (const [name, document] of Object.entries(account.ownDocuments) as [keyof DisposableAccountState['ownDocuments'], DocState][]) {
                if (!document.exists) continue;
                const problem = ownDocumentProblem(name, document, { uid, email }, registry.createdAtMs);
                if (problem) plan.retained.push({ path: document.path, reason: problem });
                else plan.deleteDocuments.push(deleteAction(document, `${name} record created by disposable identity`));
            }
        }
        if (plan.retained.length > 0) {
            plan.deleteDocuments = [];
            plan.retained.push({ path: account.registry.path, reason: 'identity retained because one of its records was not attributable' });
            return plan;
        }
        plan.deleteAuthUser = Boolean(auth);
        plan.deleteRegistry = { path: registry.path, expectedVersion: registry.version };
        return plan;
    });
}

export function summarizePlan(plan: CleanupPlan): string[] {
    return [
        ...plan.actions.map((action) => {
            if (action.kind === 'restore') return `RESTORE ${action.path} @${action.expectedVersion} [${action.changedFields.join(', ')}] — ${action.reason}`;
            if (action.kind === 'delete') return `DELETE ${action.path} @${action.expectedVersion} — ${action.reason}`;
            return `RECREATE ${action.path} — ${action.reason}`;
        }),
        ...plan.retained.map((item) => `RETAIN ${item.path} — ${item.reason}`),
    ];
}

export function summarizeDisposablePlans(plans: DisposableAccountPlan[]): string[] {
    return plans.flatMap((plan) => [
        ...plan.deleteDocuments.map((action) => `DELETE ${action.path} @${action.kind === 'delete' ? action.expectedVersion : ''} — ${action.reason}`),
        ...(plan.deleteAuthUser ? [`DELETE-AUTH ${plan.uid}`] : []),
        ...(plan.deleteRegistry ? [`DELETE ${plan.deleteRegistry.path} @${plan.deleteRegistry.expectedVersion} — registry entry for this run`] : []),
        ...plan.retained.map((item) => `RETAIN ${item.path} — ${item.reason}`),
    ]);
}
