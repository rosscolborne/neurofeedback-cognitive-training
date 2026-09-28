import type { Page } from '@playwright/test';
import { getClinicalProtocolTemplate } from '../src/services/clinicalProtocolTemplates';
import { expect, test } from './fixtures';
import { arriveAtClinicianDashboard, arriveAtPatientDashboard, authenticatedUserId, loginThroughUi } from './helpers/auth';
import { findPendingLifecycleInvitation, readLifecycleHistoryState, readLifecycleRecords, readPendingInvitationState, seedFutureLifecycleAppointment, seedLifecycleHistory, seedLinkedPatient, seedPendingLifecycleInvitation } from './helpers/localEmulator';

const allExperienceNames = [
  'Skyline Drift', 'Tidal Garden', 'Breath Weave', 'Signal Sort', 'Rhythm Lock',
  'Media Mode', 'Soundscape Mode', 'Mandala Breathing', 'Generative Mandala',
  'Generative XR', 'Generative Music', 'Contemplative Reading', 'NeuroGambit',
];
const alphaNames = [
  'Tidal Garden', 'Breath Weave', 'Soundscape Mode', 'Mandala Breathing',
  'Generative Mandala', 'Generative XR', 'Generative Music', 'Contemplative Reading',
];
const alphaIds = [
  'immersive-3d', 'generative-music', 'narrative-story', 'tidal-garden',
  'breath-weave', 'soundscape-mode', 'mandala', 'eeg-mandala',
];
const thetaNames = [
  'Skyline Drift', 'Signal Sort', 'Rhythm Lock', 'Media Mode',
  'Generative Mandala', 'Generative XR', 'Generative Music',
  'Contemplative Reading', 'NeuroGambit',
];
const thetaIds = [
  'immersive-3d', 'generative-music', 'narrative-story', 'skyline-drift',
  'signal-sort', 'media-mode', 'rhythm-lock', 'eeg-mandala', 'neuro-gambit',
];

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
test(`delete linked patient, re-register same email, and accept ${invitationMode} invitation with one active roster entry`, async ({ browser, permissionErrorGuard }) => {
  const fixture = await seedLinkedPatient();
  let code = invitationMode === 'existing' ? await seedPendingLifecycleInvitation(fixture) : '';
  if (invitationMode === 'fresh') await seedFutureLifecycleAppointment(fixture);
  await seedLifecycleHistory(fixture);
  const clinicianContext = await browser.newContext();
  const oldContext = await browser.newContext();
  const newContext = await browser.newContext();
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
      await clinician.locator('form select').nth(1).selectOption('alpha-enhancement');
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
    await Promise.allSettled([clinicianContext.close(), oldContext.close(), newContext.close()]);
  }
});
}

test('wrong deletion password keeps the account, profile, and clinician roster intact', async ({ browser }) => {
  const fixture = await seedLinkedPatient();
  const clinicianContext = await browser.newContext();
  const patientContext = await browser.newContext();
  try {
    const clinician = await clinicianContext.newPage();
    const patient = await patientContext.newPage();
    await loginThroughUi(clinician, fixture.clinician);
    await arriveAtClinicianDashboard(clinician);
    const rosterRow = clinician.getByRole('row').filter({ hasText: fixture.name });
    await expect(rosterRow).toHaveCount(1);

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
    await expect(rosterRow).toHaveCount(1);
    await patient.reload();
    await arriveAtPatientDashboard(patient);
    await patient.getByRole('button', { name: 'Profile', exact: true }).click();
    await expect(patient.getByText('Connected to your clinician')).toBeVisible();
    await expect(rosterRow).toHaveCount(1);
  } finally {
    await Promise.allSettled([clinicianContext.close(), patientContext.close()]);
  }
});

test('unlink preserves the training list and Garden; a new invitation replaces the protocol and list together', async ({ browser }) => {
  const garden = { stage: 3, growthPoints: 501, plantsUnlocked: ['kelp'], lastWatered: 'yesterday' };
  const staleCustomProtocol = { ...getClinicalProtocolTemplate('theta-beta-ratio')!, alias: 'Old custom reward' };
  const fixture = await seedLinkedPatient({
    assignedProtocol: 'theta-beta-ratio', allowedExperiences: ['tidal-garden'],
    customProtocolConfig: staleCustomProtocol, tidalGardenState: garden, completedSessionsCount: 4,
  });
  await seedLifecycleHistory(fixture);
  const clinicianContext = await browser.newContext();
  const patientContext = await browser.newContext();
  try {
    const clinician = await clinicianContext.newPage();
    const patient = await patientContext.newPage();
    await loginThroughUi(clinician, fixture.clinician);
    await arriveAtClinicianDashboard(clinician);
    await loginThroughUi(patient, fixture.patient);
    await arriveAtPatientDashboard(patient);
    await expectPatientCatalogue(patient, ['Tidal Garden']);

    const rosterRow = clinician.getByRole('row').filter({ hasText: fixture.name });
    clinician.once('dialog', (dialog) => { void dialog.accept(); });
    await rosterRow.getByTitle('Remove Patient').click();
    await expect(rosterRow).toHaveCount(0);
    await patient.reload();
    await arriveAtPatientDashboard(patient);
    await expectPatientCatalogue(patient, ['Tidal Garden']);
    expect(await readCurrentPatientAssignment(patient)).toMatchObject({
      assignedProtocol: 'theta-beta-ratio', allowedExperiences: ['tidal-garden'],
      customProtocolConfig: staleCustomProtocol, completedSessionsCount: 4, tidalGardenState: garden,
    });
    expect(await readLifecycleHistoryState(fixture.patient.uid, fixture.clinician.uid)).toEqual({
      sessionPatientId: fixture.patient.uid, threadPatientId: fixture.patient.uid,
    });

    await clinician.getByRole('button', { name: 'Invite Patient' }).click();
    await clinician.getByPlaceholder('e.g. Alex Morgan').fill(fixture.name);
    await clinician.getByPlaceholder('patient@example.com').fill(fixture.patient.email);
    await clinician.locator('form select').nth(0).selectOption('ADHD (Inattentive)');
    await clinician.locator('form select').nth(1).selectOption('alpha-enhancement');
    await clinician.getByPlaceholder('Unavailable').fill('3');
    await clinician.getByRole('button', { name: 'Create Invitation' }).click();
    await expect(clinician.getByRole('heading', { name: 'Invitation created' })).toBeVisible();
    const code = await findPendingLifecycleInvitation(fixture.clinician.uid, fixture.patient.email);
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
    await expect(rosterRow).toHaveCount(1);
  } finally {
    await Promise.allSettled([clinicianContext.close(), patientContext.close()]);
  }
});

test('active linked patient cannot be reinvited until removed from the clinician roster', async ({ browser }) => {
  const fixture = await seedLinkedPatient();
  const context = await browser.newContext();
  try {
    const clinician = await context.newPage();
    await loginThroughUi(clinician, fixture.clinician);
    await arriveAtClinicianDashboard(clinician);
    const rosterRow = clinician.getByRole('row').filter({ hasText: fixture.name });
    await expect(rosterRow).toHaveCount(1);
    expect(await readPendingInvitationState(fixture.clinician.uid, fixture.patient.email))
      .toEqual({ pendingCount: 0, claimExists: false });

    const submitInvitation = async () => {
      await clinician.getByRole('button', { name: 'Invite Patient' }).click();
      await clinician.getByPlaceholder('e.g. Alex Morgan').fill(fixture.name);
      await clinician.getByPlaceholder('patient@example.com').fill(fixture.patient.email);
      await clinician.locator('form select').nth(0).selectOption('ADHD (Inattentive)');
      await clinician.locator('form select').nth(1).selectOption('theta-beta-ratio');
      await clinician.getByPlaceholder('Unavailable').fill('3');
      await clinician.getByRole('button', { name: 'Create Invitation' }).click();
    };

    await submitInvitation();
    await expect(clinician.getByRole('alert').filter({ hasText: 'This patient is already connected to your clinic.' })).toBeVisible();
    await expect(clinician.getByRole('heading', { name: 'Invitation created' })).toHaveCount(0);
    expect(await readPendingInvitationState(fixture.clinician.uid, fixture.patient.email))
      .toEqual({ pendingCount: 0, claimExists: false });

    await clinician.getByRole('button', { name: 'Cancel', exact: true }).click();
    clinician.once('dialog', (dialog) => { void dialog.accept(); });
    await rosterRow.getByTitle('Remove Patient').click();
    await expect(rosterRow).toHaveCount(0);

    await submitInvitation();
    await expect(clinician.getByRole('heading', { name: 'Invitation created' })).toBeVisible();
    expect(await readPendingInvitationState(fixture.clinician.uid, fixture.patient.email))
      .toEqual({ pendingCount: 1, claimExists: true });
  } finally {
    await context.close();
  }
});
