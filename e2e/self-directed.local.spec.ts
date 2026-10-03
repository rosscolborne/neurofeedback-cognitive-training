import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { getClinicalProtocolTemplate } from '../src/services/clinicalProtocolTemplates';
import { expect, test } from './fixtures';
import {
  arriveAtClinicianDashboard, arriveAtPatientDashboard, authenticatedUserId, loginThroughUi, startPatientTrainingInDemoMode,
} from './helpers/auth';
import {
  findPendingLifecycleInvitation, readInvitationNoticeClinicians, readPatientRelationship, readPatientTrainingRecord,
  removePatientFields, seedFutureLifecycleAppointment, seedLinkedPatient, seedPendingInvitation, seedSelfDirectedHistory,
} from './helpers/localEmulator';

const EXPERIENCE_NAMES: Record<string, string> = { 'neuro-gambit': 'NeuroGambit' };
const defaults = (protocol: Parameters<typeof getClinicalProtocolTemplate>[0]) => [...getClinicalProtocolTemplate(protocol)!.recommendedExperiences];
const PATIENT_TABS = ['Home', 'Train', 'Progress', 'Profile'];

async function expectNavigation(page: Page, linked: boolean) {
  const nav = page.locator('nav').last();
  await expect(nav.getByRole('button')).toHaveCount(linked ? 6 : 4);
  for (const name of PATIENT_TABS) await expect(nav.getByRole('button', { name, exact: true })).toBeVisible();
  for (const name of ['Messages', 'Visits']) {
    await expect(nav.getByRole('button', { name, exact: true })).toHaveCount(linked ? 1 : 0);
  }
}

/** A Profile fact: its label and value sit together in one FactGrid entry. */
function profileFact(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator('..');
}

/** Who manages the plan. There is no protocol to show or choose: the consumer app has no EEG protocols. */
async function expectAuthority(page: Page, authority: 'Self-directed' | 'Clinician-managed') {
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Protocol:/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Change training setup', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await expect(page.getByText('Protocol', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Training setup', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Change Training Setup', exact: true })).toHaveCount(0);
  await expect(page.getByText('Connected to your clinician', { exact: true })).toHaveCount(authority === 'Clinician-managed' ? 1 : 0);
}

async function expectTrainCatalogue(page: Page, ids: string[]) {
  await page.getByRole('button', { name: 'Train', exact: true }).click();
  const cards = page.locator('main .card-patient');
  await expect(cards).toHaveCount(ids.length);
  for (const [id, name] of Object.entries(EXPERIENCE_NAMES)) {
    await expect(cards.filter({ has: page.getByText(name, { exact: true }) })).toHaveCount(ids.includes(id) ? 1 : 0);
  }
}

async function expectHistory(page: Page, uid: string, sessionId: string) {
  const sessionIds = await page.evaluate(async (patientId) => {
    const { storageEngine } = await import('/src/services/storageEngine.ts');
    return (await storageEngine.getSessions(patientId)).map((session) => session.id);
  }, uid);
  expect(sessionIds).toContain(sessionId);
  await page.getByRole('button', { name: 'Progress', exact: true }).click();
  await expect(page.locator('.card-patient').filter({ hasText: 'NeuroGambit' }).first()).toBeVisible();
}

/** Without an invitation link a self-directed patient has nothing to connect with, on Home or Profile. */
async function expectNoClinicianConnection(page: Page) {
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Clinician invitation' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Accept Invitation' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await expect(page.getByRole('button', { name: /Connect to Clinician/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Disconnect from Clinician' })).toHaveCount(0);
}

async function reloadPatient(page: Page) {
  await page.reload();
  await arriveAtPatientDashboard(page);
}

async function inviteFromClinician(page: Page, email: string, name: string, protocol: string) {
  await page.getByRole('button', { name: 'Invite Patient' }).click();
  await page.getByPlaceholder('e.g. Alex Morgan').fill(name);
  await page.getByPlaceholder('patient@example.com').fill(email);
  await page.locator('form select').nth(0).selectOption('Peak Performance');
  await page.locator('form select').nth(1).selectOption(protocol);
  await page.getByPlaceholder('e.g. 3').fill('3');
  await page.getByRole('button', { name: 'Create Invitation' }).click();
  await expect(page.getByRole('heading', { name: 'Invitation created' })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
}

test('a self-directed patient has no protocol setup, yields to a clinician invitation, and returns after unlink', async ({ browser }) => {
  test.setTimeout(240_000);
  const { clinician: clinicianAccount } = await seedLinkedPatient();
  const email = `self-directed-${randomUUID().slice(0, 12)}@example.test`;
  const name = 'Self Directed Patient';
  const smr = defaults('smr-enhancement');
  const clinicianContext = await browser.newContext();
  const patientContext = await browser.newContext();
  try {
    // 1. A new unlinked patient: the default experience list, no protocol, no clinician destinations.
    const patient = await patientContext.newPage();
    await patient.goto('/#/');
    await patient.getByRole('button', { name: 'Begin Journey' }).click();
    await patient.getByPlaceholder('How should we call you?').fill(name);
    await patient.getByPlaceholder('you@example.com').fill(email);
    await patient.getByPlaceholder('At least 6 characters').fill('LocalEmulator!123');
    await patient.getByRole('button', { name: 'Create Account' }).click();
    await patient.getByRole('button', { name: /Train my brain/ }).click();
    await arriveAtPatientDashboard(patient);
    const uid = await authenticatedUserId(patient);
    await expectNavigation(patient, false);
    await expectAuthority(patient, 'Self-directed');
    await expect(patient.getByText('Goal', { exact: true })).toHaveCount(0);
    await expect(patient.getByText('Weekly target', { exact: true })).toHaveCount(0);
    await expectTrainCatalogue(patient, defaults('theta-beta-ratio'));
    await expectNoClinicianConnection(patient);
    const { sessionId, garden } = await seedSelfDirectedHistory(uid);
    await reloadPatient(patient);
    await expectNavigation(patient, false);
    await expectHistory(patient, uid, sessionId);

    // 2. The assigned experience starts, in Demo Mode without a headset.
    await patient.getByRole('button', { name: 'Home', exact: true }).click();
    await expect(patient.getByRole('button', { name: 'NeuroGambit', exact: true })).toHaveCount(1);
    await startPatientTrainingInDemoMode(patient, 'NeuroGambit');
    // Session start honors the saved list: NeuroGambit itself is running.
    await expect(patient.getByRole('group', { name: 'Training track' })).toBeVisible();
    await expect(patient.getByRole('button', { name: 'End Session & Save' })).toBeVisible();
    await reloadPatient(patient);

    // 3. Accepting a clinician invitation replaces the self-directed setup completely.
    const clinician = await clinicianContext.newPage();
    await loginThroughUi(clinician, clinicianAccount);
    await arriveAtClinicianDashboard(clinician);
    await inviteFromClinician(clinician, email, name, 'smr-enhancement');
    const code = await findPendingLifecycleInvitation(clinicianAccount.uid, email);
    // The pending invitation (not a link) makes Connect available; the patient types the code.
    expect(await readInvitationNoticeClinicians(email)).toEqual([clinicianAccount.uid]);
    await reloadPatient(patient);
    await expectNavigation(patient, false);
    await patient.getByRole('button', { name: 'Connect to Clinician' }).click();
    await patient.getByLabel('Invitation code').fill(code);
    await patient.getByRole('button', { name: 'Accept Invitation' }).click();
    await expect(patient.getByRole('region', { name: 'Clinician invitation' })).toHaveCount(0);
    expect(await readInvitationNoticeClinicians(email)).toEqual([]);
    await expectNavigation(patient, true);
    await expectAuthority(patient, 'Clinician-managed');
    await expect(patient.getByText('Connected to your clinician')).toBeVisible();
    await expect(profileFact(patient, 'Goal')).toContainText('Peak Performance');
    await expect(profileFact(patient, 'Weekly target')).toContainText('3 sessions / week');
    await expectTrainCatalogue(patient, smr);
    await reloadPatient(patient);
    await expectNavigation(patient, true);
    await expectAuthority(patient, 'Clinician-managed');
    await expectTrainCatalogue(patient, smr);
    await patient.getByRole('button', { name: 'Messages', exact: true }).click();
    await expect(patient.getByRole('heading', { name: 'Messages', exact: true })).toBeVisible();
    await expectHistory(patient, uid, sessionId);
    expect(await readPatientTrainingRecord(uid)).toMatchObject({
      clinicianId: clinicianAccount.uid, assignedProtocol: 'smr-enhancement', allowedExperiences: smr,
      hasCustomProtocolConfig: false, tidalGardenState: garden, completedSessionsCount: 1, badges: ['garden-keeper'],
    });

    // 4. Unlinking removes clinician destinations and restores self-directed setup without losing history.
    await clinician.reload();
    await arriveAtClinicianDashboard(clinician);
    const rosterRow = clinician.getByRole('row').filter({ hasText: name });
    await expect(rosterRow).toHaveCount(1);
    clinician.once('dialog', (dialog) => { void dialog.accept(); });
    await rosterRow.getByTitle('Remove Patient').click();
    await expect(rosterRow).toHaveCount(0);
    await reloadPatient(patient);
    await expectNavigation(patient, false);
    // Existing unlink contract: the last clinician assignment stays as the self-directed starting point.
    await expectAuthority(patient, 'Self-directed');
    await expect(patient.getByText('Goal', { exact: true })).toHaveCount(0);
    await expect(patient.getByText('Weekly target', { exact: true })).toHaveCount(0);
    await expectNoClinicianConnection(patient);
    await expectTrainCatalogue(patient, smr);
    await expectHistory(patient, uid, sessionId);
  } finally {
    await Promise.allSettled([clinicianContext.close(), patientContext.close()]);
  }
});

test('Connect appears only for a pending invitation, survives another clinician cancelling, and needs the code', async ({ browser, permissionErrorGuard }) => {
  test.setTimeout(180_000);
  const fixture = await seedLinkedPatient({ clinicianId: null, clinicId: null });
  const { clinician: otherClinician } = await seedLinkedPatient({ clinicianId: null, clinicId: null });
  const email = fixture.patient.email;
  const patientContext = await browser.newContext();
  const clinicianContext = await browser.newContext();
  try {
    // A. No pending invitation: nothing to connect with.
    const patient = await patientContext.newPage();
    await loginThroughUi(patient, fixture.patient);
    await arriveAtPatientDashboard(patient);
    await expectNoClinicianConnection(patient);

    // An expired invitation is not a pending one.
    await seedPendingInvitation(fixture.clinician.uid, email, fixture.name, { expiresInMs: -60_000 });
    await reloadPatient(patient);
    await expectNoClinicianConnection(patient);

    // B. Two clinicians invite this email; a normal login offers Connect with manual code entry.
    const codeA = await seedPendingInvitation(fixture.clinician.uid, email, fixture.name);
    const codeB = await seedPendingInvitation(otherClinician.uid, email, fixture.name, { assignedProtocol: 'alpha-enhancement' });
    expect(await readInvitationNoticeClinicians(email)).toEqual([fixture.clinician.uid, otherClinician.uid].sort());
    await reloadPatient(patient);
    await expectNavigation(patient, false);
    const card = patient.getByRole('region', { name: 'Clinician invitation' });
    await expect(card.getByRole('button', { name: 'Connect to Clinician' })).toBeVisible();
    await expect(patient.getByLabel('Invitation code')).toHaveCount(0);

    // Knowing an invitation exists is not enough: a code that is not this patient's is refused.
    permissionErrorGuard.expectDenialsIn(patientContext);
    await card.getByRole('button', { name: 'Connect to Clinician' }).click();
    await patient.getByLabel('Invitation code').fill('ZZZZ-ZZZZ-ZZZZ');
    await patient.getByRole('button', { name: 'Accept Invitation' }).click();
    await expect(card.getByRole('alert')).toContainText('Invitation not found for this signed-in email');
    expect(await readPatientRelationship(fixture.patient.uid)).toMatchObject({ clinicianId: null });

    // Cancelling one clinician's invitation keeps the other's Connect path.
    const clinician = await clinicianContext.newPage();
    await loginThroughUi(clinician, fixture.clinician);
    await arriveAtClinicianDashboard(clinician);
    const pending = clinician.locator('.card-clinician').filter({ hasText: 'Pending invitations' });
    await pending.getByRole('button', { name: 'Cancel' }).click();
    await expect(pending.getByText(codeA, { exact: true })).toHaveCount(0);
    expect(await readInvitationNoticeClinicians(email)).toEqual([otherClinician.uid]);
    await reloadPatient(patient);
    await patient.getByRole('button', { name: 'Connect to Clinician' }).click();
    await patient.getByLabel('Invitation code').fill(codeB);
    await patient.getByRole('button', { name: 'Accept Invitation' }).click();
    await expectNavigation(patient, true);
    await expectAuthority(patient, 'Clinician-managed');
    expect(await readInvitationNoticeClinicians(email)).toEqual([]);
    expect(await readPatientRelationship(fixture.patient.uid)).toMatchObject({ clinicianId: otherClinician.uid, acceptedInvitationId: codeB });
  } finally {
    await Promise.allSettled([patientContext.close(), clinicianContext.close()]);
  }
});

test('an invitation link opened while signed out pre-fills the same Connect flow after sign-in', async ({ browser }) => {
  const fixture = await seedLinkedPatient({ clinicianId: null, clinicId: null });
  const code = await seedPendingInvitation(fixture.clinician.uid, fixture.patient.email, fixture.name, { assignedProtocol: 'alpha-enhancement' });
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    // C. Same flow as B, with the code filled in from the link.
    await page.goto(`/#/connect/${code}`);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.getByPlaceholder('name@example.com', { exact: true }).fill(fixture.patient.email);
    await page.getByPlaceholder('Your password', { exact: true }).fill(fixture.patient.password);
    await page.getByRole('button', { name: 'Log In', exact: true }).click();
    await arriveAtPatientDashboard(page);
    await expect(page.getByLabel('Invitation code')).toHaveValue(code);
    await expectNavigation(page, false);
    await page.getByRole('button', { name: 'Accept Invitation' }).click();
    await expectNavigation(page, true);
    await expectAuthority(page, 'Clinician-managed');
    expect(await readInvitationNoticeClinicians(fixture.patient.email)).toEqual([]);
    await reloadPatient(page);
    await expectNavigation(page, true);
  } finally {
    await context.close();
  }
});

test('a linked patient disconnects after confirming, keeps history and the last assignment, and stays disconnected', async ({ browser }) => {
  test.setTimeout(180_000);
  const smr = defaults('smr-enhancement');
  const fixture = await seedLinkedPatient({ condition: 'Peak Performance', assignedProtocol: 'smr-enhancement', allowedExperiences: smr });
  const uid = fixture.patient.uid;
  const { sessionId, garden } = await seedSelfDirectedHistory(uid);
  await seedFutureLifecycleAppointment(fixture);
  const patientContext = await browser.newContext();
  const clinicianContext = await browser.newContext();
  try {
    const patient = await patientContext.newPage();
    await loginThroughUi(patient, fixture.patient);
    await arriveAtPatientDashboard(patient);
    await expectNavigation(patient, true);
    await expectAuthority(patient, 'Clinician-managed');

    // The action sits with account settings on Profile and always asks first.
    const account = patient.getByRole('heading', { name: 'Account', exact: true }).locator('..');
    await expect(account.getByRole('button', { name: 'Disconnect from Clinician' })).toBeVisible();
    await account.getByRole('button', { name: 'Disconnect from Clinician' }).click();
    const confirm = patient.getByRole('alertdialog', { name: 'Disconnect from your clinician?' });
    await expect(confirm).toContainText('Your connection with your clinician ends.');
    await expect(confirm).toContainText('Your sessions, progress and journal stay in your account.');
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toHaveCount(0);
    await expectNavigation(patient, true);
    expect(await readPatientRelationship(uid)).toMatchObject({ clinicianId: fixture.clinician.uid, appointmentStatuses: ['scheduled'] });

    await patient.getByRole('button', { name: 'Disconnect from Clinician' }).click();
    await confirm.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(confirm).toHaveCount(0);
    await expectNavigation(patient, false);
    await expectAuthority(patient, 'Self-directed');
    await expect(patient.getByText('Goal', { exact: true })).toHaveCount(0);
    await expectNoClinicianConnection(patient);
    await expectTrainCatalogue(patient, smr);
    await expectHistory(patient, uid, sessionId);

    // Nothing recreates the relationship on reload, and the clinician's access has ended.
    await reloadPatient(patient);
    await expectNavigation(patient, false);
    await expectAuthority(patient, 'Self-directed');
    expect(await readPatientRelationship(uid)).toEqual({
      clinicianId: null, clinicId: null, linkedClinicianCode: null, acceptedInvitationId: null, appointmentStatuses: ['cancelled'],
    });
    expect(await readPatientTrainingRecord(uid)).toMatchObject({
      assignedProtocol: 'smr-enhancement', allowedExperiences: smr, tidalGardenState: garden, completedSessionsCount: 1, badges: ['garden-keeper'],
    });
    const clinician = await clinicianContext.newPage();
    await loginThroughUi(clinician, fixture.clinician);
    await arriveAtClinicianDashboard(clinician);
    await expect(clinician.getByRole('row').filter({ hasText: fixture.name })).toHaveCount(0);
  } finally {
    await Promise.allSettled([patientContext.close(), clinicianContext.close()]);
  }
});

test('a clinician can end the relationship from the phone roster without deleting the patient', async ({ browser }) => {
  const fixture = await seedLinkedPatient({ assignedProtocol: 'smr-enhancement', allowedExperiences: defaults('smr-enhancement') });
  await seedSelfDirectedHistory(fixture.patient.uid);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const clinician = await context.newPage();
    await loginThroughUi(clinician, fixture.clinician);
    await arriveAtClinicianDashboard(clinician);
    const remove = clinician.getByRole('button', { name: `Remove ${fixture.name}`, exact: true });
    await expect(remove).toBeVisible();
    clinician.once('dialog', (dialog) => { void dialog.accept(); });
    await remove.click();
    await expect(remove).toHaveCount(0);
    // The roster listener drops the card on the local write; the server commit can land a moment later.
    await expect.poll(async () => readPatientRelationship(fixture.patient.uid)).toMatchObject({ clinicianId: null, clinicId: null });
    // Only the relationship ends: the patient's profile and history remain.
    expect(await readPatientTrainingRecord(fixture.patient.uid)).toMatchObject({
      assignedProtocol: 'smr-enhancement', completedSessionsCount: 1, badges: ['garden-keeper'],
    });
  } finally {
    await context.close();
  }
});

test('an unlinked legacy profile without assignment fields stays usable', async ({ browser }) => {
  // Legacy field-missing records keep the full-catalogue fallback, which is NeuroGambit alone.
  const fixture = await seedLinkedPatient({ clinicianId: null, clinicId: null });
  await removePatientFields(fixture.patient.uid, ['allowedExperiences', 'assignedProtocol']);
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await loginThroughUi(page, fixture.patient);
    await arriveAtPatientDashboard(page);
    await expectNavigation(page, false);
    await expectTrainCatalogue(page, Object.keys(EXPERIENCE_NAMES));
    await expectAuthority(page, 'Self-directed');
    await reloadPatient(page);
    await expectTrainCatalogue(page, Object.keys(EXPERIENCE_NAMES));
  } finally {
    await context.close();
  }
});
