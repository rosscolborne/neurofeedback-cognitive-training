import { expect, test } from './fixtures';
import { arriveAtPatientDashboard, loginThroughUi } from './helpers/auth';
import { seedPatient } from './helpers/localEmulator';
import type { AuthorizedRead } from './helpers/authorizedFirestore';
import { expectRolePersisted } from './helpers/persistenceAssertions';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test('persistence assertions read as the patient; outsider reads are denied', async ({ browser, permissionErrorGuard }) => {
  const owner = await seedPatient();
  const unrelated = await seedPatient();
  // This local run has no privileged cleanup; the emulators discard all data.
  const patientContext = await browser.newContext();
  const outsiderContext = await browser.newContext();
  permissionErrorGuard.expectDenialsIn(outsiderContext);
  try {
    const patient = await patientContext.newPage();
    const outsider = await outsiderContext.newPage();
    await loginThroughUi(patient, owner.patient);
    await arriveAtPatientDashboard(patient);
    await loginThroughUi(outsider, unrelated.patient);
    await arriveAtPatientDashboard(outsider);

    await expectRolePersisted(owner.patient, 'patient', patient);

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
    }, { patientId: owner.patient.uid });
    expect(identityGuards.wrongUid).toContain('expected test account');
    expect(identityGuards.wrongProject).toContain('wrong Firebase project');

    const forbidden: AuthorizedRead[] = [
      { kind: 'document', path: `clients/${owner.patient.uid}` },
      { kind: 'document', path: `users/${owner.patient.uid}` },
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
    await Promise.allSettled([patientContext.close(), outsiderContext.close()]);
  }
});
