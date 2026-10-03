import type { Page } from '@playwright/test';
import { getClinicalProtocolTemplate } from '../src/services/clinicalProtocolTemplates';
import { expect, test } from './fixtures';
import { arriveAtPatientDashboard, authenticatedUserId, loginThroughUi } from './helpers/auth';
import {
  readLifecycleHistoryState, readLifecycleRecords, readPatientRelationship, seedFutureLifecycleAppointment,
  seedLifecycleHistory, seedLinkedPatient, seedPendingInvitation, seedPendingLifecycleInvitation,
} from './helpers/localEmulator';

// Every protocol template now recommends the one remaining experience, NeuroGambit.
const allExperienceNames = ['NeuroGambit'];
const alphaIds = getClinicalProtocolTemplate('alpha-enhancement')!.recommendedExperiences;
const alphaNames = ['NeuroGambit'];
const thetaIds = getClinicalProtocolTemplate('theta-beta-ratio')!.recommendedExperiences;
const thetaNames = ['NeuroGambit'];

async function expectPatientCatalogue(page: Page, names: string[]) {
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  for (const name of allExperienceNames) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(names.includes(name) ? 1 : 0);
  }
  await page.getByRole('button', { name: 'Train', exact: true }).click();
  const cards = page.locator('main .card-patient');
  await expect(cards).toHaveCount(names.length);
  for (const name of names) await expect(cards.getByText(name, { exact: true })).toHaveCount(1);
}

async function readCurrentPatientAssignment(page: Page) {
  return page.evaluate(async () => {
    const { auth } = await import('/src/services/firebase.ts');
    const { storageEngine } = await import('/src/services/storageEngine.ts');
    if (!auth.currentUser) throw new Error('Expected a signed-in patient');
    const profile = await storageEngine.getClient(auth.currentUser.uid);
    if (!profile) throw new Error('Expected a persisted patient profile');
    return {
      assignedProtocol: profile.assignedProtocol,
      allowedExperiences: profile.allowedExperiences,
      customProtocolConfig: profile.customProtocolConfig,
      completedSessionsCount: profile.completedSessionsCount,
      tidalGardenState: profile.tidalGardenState,
    };
  });
}

for (const invitationMode of ['existing', 'fresh'] as const) {
test(`delete linked patient, re-register same email, and accept ${invitationMode} invitation as the new account`, async ({ browser, permissionErrorGuard }) => {
  const fixture = await seedLinkedPatient();
  let code = invitationMode === 'existing' ? await seedPendingLifecycleInvitation(fixture) : '';
  if (invitationMode === 'fresh') await seedFutureLifecycleAppointment(fixture);
  await seedLifecycleHistory(fixture);
  const oldContext = await browser.newContext();
  const newContext = await browser.newContext();
  try {
    const oldPatient = await oldContext.newPage();
    await loginThroughUi(oldPatient, fixture.patient);
    await arriveAtPatientDashboard(oldPatient);
    await oldPatient.getByRole('button', { name: 'Profile', exact: true }).click();
    await oldPatient.getByRole('button', { name: 'Delete Account' }).click();
    await oldPatient.getByLabel('Enter your password to confirm account deletion').fill(fixture.patient.password);
    await oldPatient.getByRole('button', { name: 'Confirm account deletion' }).click();
    await expect(oldPatient).toHaveURL(/welcome/, { timeout: 20_000 });
    expect(await readPatientRelationship(fixture.patient.uid)).toMatchObject({ clinicianId: null, clinicId: null });

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
      code = await seedPendingInvitation(fixture.clinician.uid, fixture.patient.email, fixture.name, { assignedProtocol: 'alpha-enhancement' });
    }
    await patient.getByRole('button', { name: 'Profile', exact: true }).click();
    await patient.getByRole('button', { name: 'Connect to Clinician' }).click();
    await patient.getByLabel('Invitation code').fill(code);
    await patient.getByRole('button', { name: 'Accept Invitation' }).click();
    await expect(patient.getByText('Connected to your clinician')).toBeVisible();
    const expectedIds = invitationMode === 'existing' ? thetaIds : alphaIds;
    const expectedNames = invitationMode === 'existing' ? thetaNames : alphaNames;
    const assigned = await readCurrentPatientAssignment(patient);
    expect(assigned.assignedProtocol).toBe(invitationMode === 'existing' ? 'theta-beta-ratio' : 'alpha-enhancement');
    expect(assigned.allowedExperiences).toEqual(expectedIds);
    await expectPatientCatalogue(patient, expectedNames);
    await patient.reload();
    await arriveAtPatientDashboard(patient);
    await expectPatientCatalogue(patient, expectedNames);

    const stored = await readLifecycleRecords(fixture.patient.uid, newUid, fixture.clinician.uid, code, fixture.patient.email);
    expect(stored.oldAuthExists).toBe(false);
    expect(stored.oldClient?.accountDeletionStartedAt).toBeDefined();
    expect(stored.oldClient?.clinicianId).toBeNull();
    expect(stored.oldClient?.clinicId).toBeNull();
    expect(stored.newClient?.clinicianId).toBe(fixture.clinician.uid);
    expect(stored.newClient?.allowedExperiences).toEqual(expectedIds);
    expect(stored.invitation?.patientId).toBe(newUid);
    expect(stored.claimExists).toBe(false);
    expect(stored.appointmentStatuses).toEqual(['cancelled']);
    permissionErrorGuard.expectDenialsIn(newContext);
    const oldReads = await patient.evaluate(async ({ oldUid, clinicianUid }) => {
      const { probeDeletedPatientHistory } = await import('/e2e/helpers/firestoreProbe.ts');
      return probeDeletedPatientHistory(oldUid, clinicianUid);
    }, { oldUid: fixture.patient.uid, clinicianUid: fixture.clinician.uid });
    expect(oldReads).toEqual(['permission-denied', 'permission-denied', 'permission-denied']);
  } finally {
    await Promise.allSettled([oldContext.close(), newContext.close()]);
  }
});
}

test('wrong deletion password keeps the account, profile, and clinician relationship intact', async ({ browser }) => {
  const fixture = await seedLinkedPatient();
  const linked = { clinicianId: fixture.clinician.uid, clinicId: fixture.clinician.uid };
  const patientContext = await browser.newContext();
  try {
    const patient = await patientContext.newPage();
    await loginThroughUi(patient, fixture.patient);
    await arriveAtPatientDashboard(patient);
    await patient.getByRole('button', { name: 'Profile', exact: true }).click();
    await patient.getByRole('button', { name: 'Delete Account' }).click();
    const deletionPassword = patient.getByLabel('Enter your password to confirm account deletion');
    const confirmDeletion = patient.getByRole('button', { name: 'Confirm account deletion' });
    await deletionPassword.fill('WrongLocalPassword!123');
    await confirmDeletion.click();
    const deletionError = patient.locator('form').filter({ has: deletionPassword }).getByRole('alert');
    await expect(deletionError).toHaveText('Incorrect password. Please try again.');
    await expect(deletionError).not.toContainText('auth/');
    await expect(deletionError).not.toContainText('Firebase');
    // The form stays usable for another attempt, starting from an empty field.
    await expect(deletionPassword).toHaveValue('');
    await expect(deletionPassword).toBeEditable();
    await expect(confirmDeletion).toBeDisabled();
    await deletionPassword.fill('AnotherAttempt!123');
    await expect(confirmDeletion).toBeEnabled();
    expect(await authenticatedUserId(patient)).toBe(fixture.patient.uid);
    expect(await readPatientRelationship(fixture.patient.uid)).toMatchObject(linked);
    await patient.reload();
    await arriveAtPatientDashboard(patient);
    await patient.getByRole('button', { name: 'Profile', exact: true }).click();
    await expect(patient.getByText('Connected to your clinician')).toBeVisible();
    expect(await readPatientRelationship(fixture.patient.uid)).toMatchObject(linked);
  } finally {
    await patientContext.close();
  }
});

test('disconnecting preserves the training list and Garden; a new invitation replaces the protocol and list together', async ({ browser }) => {
  const garden = { stage: 3, growthPoints: 501, plantsUnlocked: ['kelp'], lastWatered: 'yesterday' };
  const staleCustomProtocol = { ...getClinicalProtocolTemplate('theta-beta-ratio')!, alias: 'Old custom reward' };
  const fixture = await seedLinkedPatient({
    // An explicit empty list, so keeping it on disconnect and replacing it on relink are both visible.
    assignedProtocol: 'theta-beta-ratio', allowedExperiences: [],
    customProtocolConfig: staleCustomProtocol, tidalGardenState: garden, completedSessionsCount: 4,
  });
  await seedLifecycleHistory(fixture);
  const patientContext = await browser.newContext();
  try {
    const patient = await patientContext.newPage();
    await loginThroughUi(patient, fixture.patient);
    await arriveAtPatientDashboard(patient);
    await expectPatientCatalogue(patient, []);

    await patient.getByRole('button', { name: 'Profile', exact: true }).click();
    await patient.getByRole('button', { name: 'Disconnect from Clinician' }).click();
    const confirm = patient.getByRole('alertdialog', { name: 'Disconnect from your clinician?' });
    await confirm.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(confirm).toHaveCount(0);
    await expect.poll(async () => (await readPatientRelationship(fixture.patient.uid)).clinicianId).toBeNull();
    await patient.reload();
    await arriveAtPatientDashboard(patient);
    await expectPatientCatalogue(patient, []);
    expect(await readCurrentPatientAssignment(patient)).toMatchObject({
      assignedProtocol: 'theta-beta-ratio', allowedExperiences: [],
      customProtocolConfig: staleCustomProtocol, completedSessionsCount: 4, tidalGardenState: garden,
    });
    expect(await readLifecycleHistoryState(fixture.patient.uid, fixture.clinician.uid)).toEqual({
      sessionPatientId: fixture.patient.uid, threadPatientId: fixture.patient.uid,
    });

    const code = await seedPendingInvitation(fixture.clinician.uid, fixture.patient.email, fixture.name, { assignedProtocol: 'alpha-enhancement' });
    await patient.reload();
    await arriveAtPatientDashboard(patient);
    await patient.getByRole('button', { name: 'Profile', exact: true }).click();
    await patient.getByRole('button', { name: 'Connect to Clinician' }).click();
    await patient.getByLabel('Invitation code').fill(code);
    await patient.getByRole('button', { name: 'Accept Invitation' }).click();
    await expect(patient.getByText('Connected to your clinician')).toBeVisible();
    await patient.reload();
    await arriveAtPatientDashboard(patient);
    await expectPatientCatalogue(patient, alphaNames);
    const relinked = await readCurrentPatientAssignment(patient);
    expect(relinked).toMatchObject({
      assignedProtocol: 'alpha-enhancement', allowedExperiences: alphaIds,
      completedSessionsCount: 4, tidalGardenState: garden,
    });
    expect(relinked.customProtocolConfig).toBeUndefined();
    expect(await readLifecycleHistoryState(fixture.patient.uid, fixture.clinician.uid)).toEqual({
      sessionPatientId: fixture.patient.uid, threadPatientId: fixture.patient.uid,
    });
    expect(await readPatientRelationship(fixture.patient.uid)).toMatchObject({ clinicianId: fixture.clinician.uid, acceptedInvitationId: code });
  } finally {
    await patientContext.close();
  }
});
