export const FIXTURE_MARKER = 'wb-44-dedicated-e2e';

export const fixtureIdentities = {
    patient: { uid: 'wb44-e2e-patient', email: 'wb44-e2e-patient@example.com', name: 'E2E Patient' },
    clinician: { uid: 'wb44-e2e-clinician', email: 'wb44-e2e-clinician@example.com', name: 'E2E Clinician' },
    outsider: { uid: 'wb44-e2e-outsider', email: 'wb44-e2e-outsider@example.com', name: 'E2E Outsider' },
} as const;

export type FixtureRole = keyof typeof fixtureIdentities;

export function assertFixtureDocument(path: string, data: Record<string, unknown> | undefined): void {
    if (data && data.e2eFixture !== FIXTURE_MARKER) {
        throw new Error(`Refusing to reset unmarked document ${path}. Resolve ownership manually first.`);
    }
}

export function assertFixtureReference(path: string, data: Record<string, unknown>): void {
    const { patient, clinician, outsider } = fixtureIdentities;
    const fixturePatients = new Set<string>([patient.uid, outsider.uid]);
    const fixtureEmails = new Set<string>([patient.email, outsider.email]);
    if (typeof data.patientId === 'string' && !fixturePatients.has(data.patientId)) {
        throw new Error(`Refusing to reset ${path}: it refers to an unrelated patient.`);
    }
    if (typeof data.clientId === 'string' && !fixturePatients.has(data.clientId)) {
        throw new Error(`Refusing to reset ${path}: it refers to an unrelated client.`);
    }
    if (typeof data.clinicianId === 'string' && data.clinicianId !== clinician.uid) {
        throw new Error(`Refusing to reset ${path}: it refers to an unrelated clinician.`);
    }
    if (typeof data.linkedClinicianCode === 'string' && data.linkedClinicianCode !== clinician.uid) {
        throw new Error(`Refusing to reset ${path}: it has an unrelated legacy clinician link.`);
    }
    if (typeof data.clinicId === 'string' && data.clinicId !== clinician.uid) {
        throw new Error(`Refusing to reset ${path}: it refers to an unrelated clinic.`);
    }
    if (typeof data.patientEmail === 'string' && !fixtureEmails.has(data.patientEmail.toLowerCase())) {
        throw new Error(`Refusing to reset ${path}: it refers to an unrelated email.`);
    }
    const fixtureUsers = new Set<string>([patient.uid, clinician.uid, outsider.uid]);
    for (const field of ['createdBy', 'assignedByUserId', 'senderId', 'lastSenderId']) {
        if (typeof data[field] === 'string' && !fixtureUsers.has(data[field])) {
            throw new Error(`Refusing to reset ${path}: ${field} refers to an unrelated user.`);
        }
    }
    if (data.participantIds !== undefined &&
        (!Array.isArray(data.participantIds) || data.participantIds.some((uid) => typeof uid !== 'string' || !fixtureUsers.has(uid)))) {
        throw new Error(`Refusing to reset ${path}: participantIds includes an unrelated user.`);
    }
}
