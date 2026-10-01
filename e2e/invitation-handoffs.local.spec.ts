import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { getClinicalProtocolTemplate } from '../src/services/clinicalProtocolTemplates';
import { expect, test } from './fixtures';
import { arriveAtClinicianDashboard, arriveAtPatientDashboard, loginThroughUi } from './helpers/auth';
import {
  findPendingLifecycleInvitation, readLocalInvitationRecord, readPendingInvitationState,
  seedLinkedPatient, seedPendingLifecycleInvitation,
} from './helpers/localEmulator';

async function submitInvitation(page: Page, email: string, name = 'Invited Patient') {
  await page.getByRole('button', { name: 'Invite Patient' }).click();
  await page.getByPlaceholder('e.g. Alex Morgan').fill(name);
  await page.getByPlaceholder('patient@example.com').fill(email);
  await page.locator('form select').nth(0).selectOption('ADHD (Inattentive)');
  await page.locator('form select').nth(1).selectOption('alpha-enhancement');
  await page.getByPlaceholder('e.g. 3').fill('3');
  await page.getByRole('button', { name: 'Create Invitation' }).click();
}

test('wrong patient account sees a rejection and leaves the invitation pending', async ({ browser, permissionErrorGuard }) => {
  const invited = await seedLinkedPatient({ clinicianId: null, clinicId: null });
  const wrong = await seedLinkedPatient({ clinicianId: null, clinicId: null });
  const code = await seedPendingLifecycleInvitation(invited);
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await loginThroughUi(page, wrong.patient);
    await arriveAtPatientDashboard(page);
    await page.goto(`/#/connect/${code}`);
    await expect(page.getByLabel('Invitation code')).toHaveValue(code);
    permissionErrorGuard.expectDenialsIn(context);
    await page.getByRole('button', { name: 'Accept Invitation' }).click();
    await expect(page.getByRole('alert')).toContainText('Invitation not found for this signed-in email');
    await expect(page.getByText('Connected to your clinician')).toHaveCount(0);
    expect(await readPendingInvitationState(invited.clinician.uid, invited.patient.email))
      .toEqual({ pendingCount: 1, claimExists: true });
  } finally {
    await context.close();
  }
});

test('an already-linked patient cannot accept another pending invitation', async ({ browser }) => {
  const fixture = await seedLinkedPatient();
  const code = await seedPendingLifecycleInvitation(fixture);
  const invitationBefore = await readLocalInvitationRecord(code);
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await loginThroughUi(page, fixture.patient);
    await arriveAtPatientDashboard(page);
    await expect(page.getByRole('alert').filter({ hasText: 'already connected to a clinician' })).toHaveCount(0);
    await page.goto(`/#/connect/${code}`);
    await expect(page.getByRole('alert')).toContainText("You're already connected to a clinician. Disconnect before accepting another invitation.");
    await expect(page.getByText(code, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept Invitation' })).toHaveCount(0);
    expect(await readPendingInvitationState(fixture.clinician.uid, fixture.patient.email))
      .toEqual({ pendingCount: 1, claimExists: true });
    expect(await readLocalInvitationRecord(code)).toEqual(invitationBefore);
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await expect(page.getByText('Connected to your clinician')).toBeVisible();
    const link = await page.evaluate(async () => {
      const { auth } = await import('/src/services/firebase.ts');
      const { storageEngine } = await import('/src/services/storageEngine.ts');
      const profile = await storageEngine.getClient(auth.currentUser!.uid);
      return { clinicianId: profile?.clinicianId, clinicId: profile?.clinicId };
    });
    expect(link).toEqual({ clinicianId: fixture.clinician.uid, clinicId: fixture.clinician.uid });
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await page.getByRole('button', { name: 'Dismiss invitation' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'already connected to a clinician' })).toHaveCount(0);
    await expect(page.getByText('Training Session', { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

test('an invitation opened before logging out does not follow a later normal login', async ({ browser }) => {
  const fixture = await seedLinkedPatient();
  const code = await seedPendingLifecycleInvitation(fixture);
  const context = await browser.newContext();
  const conflict = (page: Page) => page.getByRole('alert').filter({ hasText: 'already connected to a clinician' });
  try {
    const page = await context.newPage();
    await loginThroughUi(page, fixture.patient);
    await arriveAtPatientDashboard(page);
    await page.goto(`/#/connect/${code}`);
    await expect(conflict(page)).toBeVisible();
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await page.getByRole('button', { name: /Log Out/ }).click();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('waveable_pending_invitation'))).toBeNull();

    await loginThroughUi(page, fixture.patient);
    await arriveAtPatientDashboard(page);
    await expect(conflict(page)).toHaveCount(0);
    await expect(page.getByText(code, { exact: true })).toHaveCount(0);
    expect(await readPendingInvitationState(fixture.clinician.uid, fixture.patient.email))
      .toEqual({ pendingCount: 1, claimExists: true });
  } finally {
    await context.close();
  }
});

test('reopening the invitation a patient already accepted shows no conflict', async ({ browser }) => {
  const acceptedCode = 'LIFE-DONE-0001';
  const fixture = await seedLinkedPatient({ acceptedInvitationId: acceptedCode });
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await loginThroughUi(page, fixture.patient);
    await arriveAtPatientDashboard(page);
    await page.goto(`/#/connect/${acceptedCode}`);
    await expect(page).toHaveURL(/\/#\/$/);
    await expect(page.getByRole('alert').filter({ hasText: 'already connected to a clinician' })).toHaveCount(0);
    expect(await page.evaluate(() => sessionStorage.getItem('waveable_pending_invitation'))).toBeNull();
  } finally {
    await context.close();
  }
});

test('clinician cancels a pending invite and can issue a new one despite cancellation history', async ({ browser }) => {
  const fixture = await seedLinkedPatient();
  const email = `pending-${randomUUID().slice(0, 12)}@example.test`;
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await loginThroughUi(page, fixture.clinician);
    await arriveAtClinicianDashboard(page);
    await submitInvitation(page, email);
    await expect(page.getByRole('heading', { name: 'Invitation created' })).toBeVisible();
    const cancelledCode = await findPendingLifecycleInvitation(fixture.clinician.uid, email);
    await page.getByRole('button', { name: 'Done' }).click();

    await submitInvitation(page, email);
    await expect(page.getByRole('alert').filter({ hasText: 'A pending invitation already exists' })).toBeVisible();
    expect(await readPendingInvitationState(fixture.clinician.uid, email))
      .toEqual({ pendingCount: 1, claimExists: true });
    await page.getByRole('button', { name: 'Cancel', exact: true }).last().click();

    const pending = page.locator('.card-clinician').filter({ hasText: 'Pending invitations' });
    await pending.getByRole('button', { name: 'Cancel' }).click();
    await expect(pending.getByText(cancelledCode, { exact: true })).toHaveCount(0);
    expect(await readPendingInvitationState(fixture.clinician.uid, email))
      .toEqual({ pendingCount: 0, claimExists: false });

    await submitInvitation(page, email);
    await expect(page.getByRole('heading', { name: 'Invitation created' })).toBeVisible();
    const replacementCode = await findPendingLifecycleInvitation(fixture.clinician.uid, email);
    expect(replacementCode).not.toBe(cancelledCode);
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Invitation history (1)' }).click();
    await expect(page.getByText('Cancelled · Cancellation date unavailable')).toBeVisible();
    expect(await readPendingInvitationState(fixture.clinician.uid, email))
      .toEqual({ pendingCount: 1, claimExists: true });
  } finally {
    await context.close();
  }
});

test('first-time patient signup retains the signed-out invitation deep link', async ({ browser }) => {
  const fixture = await seedLinkedPatient();
  const email = `new-patient-${randomUUID().slice(0, 12)}@example.test`;
  const clinicianContext = await browser.newContext();
  const patientContext = await browser.newContext();
  try {
    const clinician = await clinicianContext.newPage();
    await loginThroughUi(clinician, fixture.clinician);
    await arriveAtClinicianDashboard(clinician);
    await submitInvitation(clinician, email, 'New Patient');
    await expect(clinician.getByRole('heading', { name: 'Invitation created' })).toBeVisible();
    const code = await findPendingLifecycleInvitation(fixture.clinician.uid, email);

    const patient = await patientContext.newPage();
    await patient.goto(`/#/connect/${code}`);
    await expect(patient.getByRole('button', { name: 'Begin Journey' })).toBeVisible();
    await patient.getByRole('button', { name: 'Begin Journey' }).click();
    await patient.getByPlaceholder('How should we call you?').fill('New Patient');
    await patient.getByPlaceholder('you@example.com').fill(email);
    await patient.getByPlaceholder('At least 6 characters').fill('LocalEmulator!123');
    await patient.getByRole('button', { name: 'Create Account' }).click();
    await patient.getByRole('button', { name: /Train my brain/ }).click();
    await arriveAtPatientDashboard(patient);
    await expect(patient.getByLabel('Invitation code')).toHaveValue(code);
    await patient.getByRole('button', { name: 'Accept Invitation' }).click();
    await expect(patient).toHaveURL(/\/#\/$/);
    await expect(patient.getByRole('alert').filter({ hasText: 'already connected to a clinician' })).toHaveCount(0);
    await patient.getByRole('button', { name: 'Profile', exact: true }).click();
    await expect(patient.getByText('Connected to your clinician')).toBeVisible();
    const assigned = await patient.evaluate(async () => {
      const { auth } = await import('/src/services/firebase.ts');
      const { storageEngine } = await import('/src/services/storageEngine.ts');
      const profile = await storageEngine.getClient(auth.currentUser!.uid);
      return { uid: auth.currentUser?.uid, protocol: profile?.assignedProtocol, allowed: profile?.allowedExperiences };
    });
    expect(assigned.protocol).toBe('alpha-enhancement');
    expect(assigned.allowed).toEqual(getClinicalProtocolTemplate('alpha-enhancement')!.recommendedExperiences);
    await patient.getByRole('button', { name: 'Home', exact: true }).click();
    await expect(patient.getByRole('button', { name: 'NeuroGambit', exact: true })).toHaveCount(1);
    await patient.getByRole('button', { name: 'Train', exact: true }).click();
    await expect(patient.locator('main .card-patient')).toHaveCount(assigned.allowed!.length);
    await expect(patient.locator('main .card-patient').getByText('NeuroGambit', { exact: true })).toHaveCount(1);
    await patient.reload();
    await arriveAtPatientDashboard(patient);
    await expect(patient.getByRole('alert').filter({ hasText: 'already connected to a clinician' })).toHaveCount(0);
    await patient.getByRole('button', { name: 'Profile', exact: true }).click();
    await expect(patient.getByText('Connected to your clinician')).toBeVisible();
    await patient.getByRole('button', { name: 'Train', exact: true }).click();
    await expect(patient.locator('main .card-patient')).toHaveCount(assigned.allowed!.length);
    await expect(clinician.getByRole('row').filter({ hasText: 'New Patient' })).toHaveCount(1);
    expect(await readLocalInvitationRecord(code)).toMatchObject({ status: 'accepted', patientId: assigned.uid, assignedProtocol: 'alpha-enhancement' });
    expect(await readPendingInvitationState(fixture.clinician.uid, email))
      .toEqual({ pendingCount: 0, claimExists: false });
  } finally {
    await Promise.allSettled([clinicianContext.close(), patientContext.close()]);
  }
});

test('signup with a different email cannot consume a pre-account invitation', async ({ browser, permissionErrorGuard }) => {
  const fixture = await seedLinkedPatient();
  const invitedEmail = `invited-${randomUUID().slice(0, 12)}@example.test`;
  const wrongEmail = `other-${randomUUID().slice(0, 12)}@example.test`;
  const clinicianContext = await browser.newContext();
  const patientContext = await browser.newContext();
  try {
    const clinician = await clinicianContext.newPage();
    await loginThroughUi(clinician, fixture.clinician);
    await arriveAtClinicianDashboard(clinician);
    await submitInvitation(clinician, invitedEmail);
    await expect(clinician.getByRole('heading', { name: 'Invitation created' })).toBeVisible();
    const code = await findPendingLifecycleInvitation(fixture.clinician.uid, invitedEmail);
    const invitationBefore = await readLocalInvitationRecord(code);

    const patient = await patientContext.newPage();
    await patient.goto(`/#/connect/${code}`);
    await patient.getByRole('button', { name: 'Begin Journey' }).click();
    await patient.getByPlaceholder('How should we call you?').fill('Other Patient');
    await patient.getByPlaceholder('you@example.com').fill(wrongEmail);
    await patient.getByPlaceholder('At least 6 characters').fill('LocalEmulator!123');
    await patient.getByRole('button', { name: 'Create Account' }).click();
    await patient.getByRole('button', { name: /Train my brain/ }).click();
    await arriveAtPatientDashboard(patient);
    await expect(patient.getByLabel('Invitation code')).toHaveValue(code);
    permissionErrorGuard.expectDenialsIn(patientContext);
    await patient.getByRole('button', { name: 'Accept Invitation' }).click();
    await expect(patient.getByRole('alert')).toContainText('Invitation not found for this signed-in email');
    expect(await readLocalInvitationRecord(code)).toEqual(invitationBefore);
    expect(await readPendingInvitationState(fixture.clinician.uid, invitedEmail))
      .toEqual({ pendingCount: 1, claimExists: true });
  } finally {
    await Promise.allSettled([clinicianContext.close(), patientContext.close()]);
  }
});

test('signed-out login and signed-in direct links preserve the invitation code', async ({ browser }) => {
  const fixture = await seedLinkedPatient({ clinicianId: null, clinicId: null });
  const code = await seedPendingLifecycleInvitation(fixture);
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`/#/connect/${code}`);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.getByPlaceholder('name@example.com', { exact: true }).fill(fixture.patient.email);
    await page.getByPlaceholder('Your password', { exact: true }).fill(fixture.patient.password);
    await page.getByRole('button', { name: 'Log In', exact: true }).click();
    await arriveAtPatientDashboard(page);
    await expect(page.getByLabel('Invitation code')).toHaveValue(code);

    await page.getByRole('button', { name: 'Train', exact: true }).click();
    await expect(page.getByLabel('Invitation code')).toHaveCount(0);
    await page.goto(`/#/connect/${code}`);
    await expect(page.getByLabel('Invitation code')).toHaveValue(code);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.goto('/#/');
    await expect(page.getByLabel('Invitation code')).toHaveCount(0);
    await page.goto(`/#/connect/${code}`);
    await expect(page.getByLabel('Invitation code')).toHaveValue(code);

    // Previously shared physical-path links are rewritten when the app loads.
    await page.goto(`/connect/${code}`);
    await expect(page).toHaveURL(new RegExp(`/#/connect/${code}$`));
    await expect(page.getByLabel('Invitation code')).toHaveValue(code);
    await page.getByRole('button', { name: 'Accept Invitation' }).click();
    await expect(page).toHaveURL(/\/#\/$/);
    await expect(page.getByRole('alert').filter({ hasText: 'already connected to a clinician' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await expect(page.getByText('Connected to your clinician')).toBeVisible();
    expect(await readPendingInvitationState(fixture.clinician.uid, fixture.patient.email))
      .toEqual({ pendingCount: 0, claimExists: false });
    await page.reload();
    await arriveAtPatientDashboard(page);
    await expect(page.getByRole('alert').filter({ hasText: 'already connected to a clinician' })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('clinician opening a patient invitation sees an explanation without accepting it', async ({ browser }) => {
  const fixture = await seedLinkedPatient({ clinicianId: null, clinicId: null });
  const code = await seedPendingLifecycleInvitation(fixture);
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await loginThroughUi(page, fixture.clinician);
    await arriveAtClinicianDashboard(page);
    await page.goto(`/#/connect/${code}`);
    await expect(page.getByRole('heading', { name: 'Patient invitation' })).toBeVisible();
    await expect(page.getByText('This invitation is for a patient account. Sign in with the invited patient email address to accept it.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept Invitation' })).toHaveCount(0);
    expect(await readPendingInvitationState(fixture.clinician.uid, fixture.patient.email))
      .toEqual({ pendingCount: 1, claimExists: true });
    await page.getByRole('button', { name: 'Return to clinician dashboard' }).click();
    await arriveAtClinicianDashboard(page);
  } finally {
    await context.close();
  }
});

test('clinician signing in from a patient invitation sees the same explanation', async ({ browser }) => {
  const fixture = await seedLinkedPatient({ clinicianId: null, clinicId: null });
  const code = await seedPendingLifecycleInvitation(fixture);
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`/#/connect/${code}`);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.getByPlaceholder('name@example.com', { exact: true }).fill(fixture.clinician.email);
    await page.getByPlaceholder('Your password', { exact: true }).fill(fixture.clinician.password);
    await page.getByRole('button', { name: 'Log In', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Patient invitation' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept Invitation' })).toHaveCount(0);
    expect(await readPendingInvitationState(fixture.clinician.uid, fixture.patient.email))
      .toEqual({ pendingCount: 1, claimExists: true });
    await page.getByRole('button', { name: 'Return to clinician dashboard' }).click();
    await arriveAtClinicianDashboard(page);
    await page.reload();
    await arriveAtClinicianDashboard(page);
  } finally {
    await context.close();
  }
});
