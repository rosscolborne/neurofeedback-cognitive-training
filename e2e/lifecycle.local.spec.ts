import { expect, test } from './fixtures';
import { arriveAtClinicianDashboard, arriveAtPatientDashboard, authenticatedUserId, loginThroughUi } from './helpers/auth';
import { findPendingLifecycleInvitation, readLifecycleRecords, seedFutureLifecycleAppointment, seedLifecycleHistory, seedLinkedPatient, seedPendingLifecycleInvitation } from './helpers/localEmulator';

for (const invitationMode of ['existing', 'fresh'] as const) {
test(`delete linked patient, re-register same email, and accept ${invitationMode} invitation with one active roster entry`, async ({ browser, permissionErrorGuard }) => {
  const fixture = await seedLinkedPatient();
  let code = invitationMode === 'existing' ? await seedPendingLifecycleInvitation(fixture) : '';
  if (invitationMode === 'fresh') await seedFutureLifecycleAppointment(fixture);
  await seedLifecycleHistory(fixture);
  const clinicianContext = await browser.newContext();
  const oldContext = await browser.newContext();
  const newContext = await browser.newContext();
  permissionErrorGuard.expectDenialsIn(newContext);
  try {
    const clinician = await clinicianContext.newPage();
    const oldPatient = await oldContext.newPage();
    await loginThroughUi(clinician, fixture.clinician);
    await arriveAtClinicianDashboard(clinician);
    const rosterRow = clinician.getByRole('row').filter({ hasText: fixture.name });
    await expect(rosterRow).toHaveCount(1);

    await loginThroughUi(oldPatient, fixture.patient);
    await arriveAtPatientDashboard(oldPatient);
    await oldPatient.getByRole('button', { name: 'Profile', exact: true }).click();
    oldPatient.once('dialog', (dialog) => { void dialog.accept(); });
    await oldPatient.getByRole('button', { name: 'Delete Account' }).click();
    await oldPatient.getByLabel('Enter your password to confirm account deletion').fill(fixture.patient.password);
    await oldPatient.getByRole('button', { name: 'Confirm account deletion' }).click();
    await expect(oldPatient).toHaveURL(/welcome/, { timeout: 20_000 });
    await expect(rosterRow).toHaveCount(0);

    const patient = await newContext.newPage();
    await patient.goto('/#/signup');
    await patient.getByPlaceholder('How should we call you?').fill(fixture.name);
    await patient.getByPlaceholder('you@example.com').fill(fixture.patient.email);
    await patient.getByPlaceholder('At least 6 characters').fill(fixture.patient.password);
    await patient.getByRole('button', { name: 'Create Account' }).click();
    await patient.getByRole('button', { name: /Train my brain/ }).click();
    await arriveAtPatientDashboard(patient);
    const newUid = await authenticatedUserId(patient);
    expect(newUid).not.toBe(fixture.patient.uid);
    if (invitationMode === 'fresh') {
      await clinician.getByRole('button', { name: 'Invite Patient' }).click();
      await clinician.getByPlaceholder('e.g. Alex Morgan').fill(fixture.name);
      await clinician.getByPlaceholder('patient@example.com').fill(fixture.patient.email);
      await clinician.locator('form select').nth(0).selectOption('ADHD (Inattentive)');
      await clinician.locator('form select').nth(1).selectOption('theta-beta-ratio');
      await clinician.getByPlaceholder('Unavailable').fill('3');
      await clinician.getByRole('button', { name: 'Create Invitation' }).click();
      await expect(clinician.getByRole('heading', { name: 'Invitation created' })).toBeVisible();
      code = await findPendingLifecycleInvitation(fixture.clinician.uid, fixture.patient.email);
    }
    await patient.getByRole('button', { name: 'Profile', exact: true }).click();
    await patient.getByRole('button', { name: 'Connect to Clinician' }).click();
    await patient.getByLabel('Invitation code').fill(code);
    await patient.getByRole('button', { name: 'Accept Invitation' }).click();
    await expect(patient.getByText('Connected to your clinician')).toBeVisible();
    await expect(rosterRow).toHaveCount(1);

    const stored = await readLifecycleRecords(fixture.patient.uid, newUid, fixture.clinician.uid, code, fixture.patient.email);
    expect(stored.oldAuthExists).toBe(false);
    expect(stored.oldClient?.accountDeletionStartedAt).toBeDefined();
    expect(stored.oldClient?.clinicianId).toBeNull();
    expect(stored.oldClient?.clinicId).toBeNull();
    expect(stored.newClient?.clinicianId).toBe(fixture.clinician.uid);
    expect(stored.invitation?.patientId).toBe(newUid);
    expect(stored.claimExists).toBe(false);
    expect(stored.appointmentStatuses).toEqual(['cancelled']);
    const oldReads = await patient.evaluate(async ({ oldUid, clinicianUid }) => {
      const { probeDeletedPatientHistory } = await import('/e2e/helpers/firestoreProbe.ts');
      return probeDeletedPatientHistory(oldUid, clinicianUid);
    }, { oldUid: fixture.patient.uid, clinicianUid: fixture.clinician.uid });
    expect(oldReads).toEqual(['permission-denied', 'permission-denied', 'permission-denied']);
  } finally {
    await Promise.allSettled([clinicianContext.close(), oldContext.close(), newContext.close()]);
  }
});
}
