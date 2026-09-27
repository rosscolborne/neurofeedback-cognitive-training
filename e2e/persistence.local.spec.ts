import { randomUUID } from 'node:crypto';
import { expect, test } from './fixtures';
import { arriveAtClinicianDashboard, arriveAtPatientDashboard, loginThroughUi } from './helpers/auth';
import { seedLinkedPatient, seedPersistenceRecords } from './helpers/localEmulator';
import type { E2EPairRun } from './helpers/dataLifecycle';
import type { AuthorizedRead } from './helpers/authorizedFirestore';
import {
  expectAppointmentPersisted,
  expectClinicBrandPersisted,
  expectDemoSessionPersisted,
  expectDisposableRolePersisted,
  expectInvitationAcceptedPersisted,
  expectMessagesPersisted,
} from './helpers/persistenceAssertions';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test('persistence assertions read as patient and clinician; outsider reads are denied', async ({ browser, permissionErrorGuard }) => {
  const linked = await seedLinkedPatient();
  const unrelated = await seedLinkedPatient();
  const marker = randomUUID();
  const runStartMs = Date.now() - 1_000;
  const invitationCode = await seedPersistenceRecords(linked, marker);
  // This local run has no privileged cleanup; the emulators discard all data.
  const run = {
    runStartMs,
    runMarker: marker,
    clinicId: linked.clinician.uid,
    scope: { patientId: linked.patient.uid, clinicianId: linked.clinician.uid, patientEmail: linked.patient.email },
  } as E2EPairRun;
  const patientContext = await browser.newContext();
  const clinicianContext = await browser.newContext();
  const outsiderContext = await browser.newContext();
  permissionErrorGuard.expectDenialsIn(outsiderContext);
  try {
    const patient = await patientContext.newPage();
    const clinician = await clinicianContext.newPage();
    const outsider = await outsiderContext.newPage();
    await loginThroughUi(patient, linked.patient);
    await arriveAtPatientDashboard(patient);
    await loginThroughUi(clinician, linked.clinician);
    await arriveAtClinicianDashboard(clinician);
    await loginThroughUi(outsider, unrelated.patient);
    await arriveAtPatientDashboard(outsider);

    expect(await expectDemoSessionPersisted(run, patient)).toBe(`session-${marker}`);
    await expectAppointmentPersisted(run, patient, clinician, { notes: marker, status: 'scheduled', durationMinutes: 45, type: 'remote-training' });
    await expectMessagesPersisted(run, patient, clinician, [{ text: marker, senderRole: 'patient' }]);
    await expectInvitationAcceptedPersisted(run, patient, clinician, invitationCode);
    await expectClinicBrandPersisted(run, patient, clinician, `Brand ${marker}`);
    await expectDisposableRolePersisted({ runId: 'local', projectId: 'demo-neurasticity-protocol-e2e', emails: [linked.patient.email] }, linked.patient, 'patient', patient);

    const identityGuards = await patient.evaluate(async ({ patientId }) => {
      const { authorizedFirestoreRead } = await import('/e2e/helpers/authorizedFirestore.ts');
      const read = { kind: 'document' as const, path: `users/${patientId}` };
      const outcome = async (uid: string, projectId: string) => {
        try {
          await authorizedFirestoreRead(uid, read, projectId);
          return 'allowed';
        } catch (error) {
          return (error as Error).message;
        }
      };
      return {
        wrongUid: await outcome('another-user', 'demo-neurasticity-protocol-e2e'),
        wrongProject: await outcome(patientId, 'another-project'),
      };
    }, { patientId: linked.patient.uid });
    expect(identityGuards.wrongUid).toContain('expected test account');
    expect(identityGuards.wrongProject).toContain('wrong Firebase project');

    const forbidden: AuthorizedRead[] = [
      { kind: 'document', path: `clients/${linked.patient.uid}` },
      { kind: 'document', path: `patientInvitations/${invitationCode}` },
      { kind: 'document', path: `patientInvitationClaims/${linked.clinician.uid}/emails/${linked.patient.email}` },
      { kind: 'document', path: `clinics/${linked.clinician.uid}` },
      { kind: 'document', path: `users/${linked.patient.uid}` },
      { kind: 'collection', path: 'sessions', where: { field: 'patientId', equals: linked.patient.uid } },
      { kind: 'collection', path: 'appointments', where: { field: 'patientId', equals: linked.patient.uid } },
      { kind: 'collection', path: `messageThreads/${linked.patient.uid}/relationships/${linked.clinician.uid}/messages` },
      { kind: 'document', path: `messageThreads/${linked.patient.uid}/relationships/${linked.clinician.uid}/reads/${linked.patient.uid}` },
    ];
    for (const read of forbidden) {
      const outcome = await outsider.evaluate(async ({ uid, read }) => {
        const { authorizedFirestoreRead } = await import('/e2e/helpers/authorizedFirestore.ts');
        try {
          await authorizedFirestoreRead(uid, read);
          return 'allowed';
        } catch (error) {
          return (error as Error).message;
        }
      }, { uid: unrelated.patient.uid, read });
      expect(outcome, `Outsider read of ${read.path}`).toContain('permission-denied');
    }
  } finally {
    await Promise.allSettled([patientContext.close(), clinicianContext.close(), outsiderContext.close()]);
  }
});
