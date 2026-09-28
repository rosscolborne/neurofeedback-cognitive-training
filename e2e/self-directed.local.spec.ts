import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { getClinicalProtocolTemplate } from '../src/services/clinicalProtocolTemplates';
import { expect, test } from './fixtures';
import {
  arriveAtClinicianDashboard, arriveAtPatientDashboard, authenticatedUserId, loginThroughUi, startPatientTrainingInDemoMode,
} from './helpers/auth';
import {
  findPendingLifecycleInvitation, readPatientTrainingRecord, removePatientFields, seedLinkedPatient, seedSelfDirectedHistory,
} from './helpers/localEmulator';

const EXPERIENCE_NAMES: Record<string, string> = {
  'neuro-gambit': 'NeuroGambit', 'immersive-3d': 'Generative XR', 'generative-music': 'Generative Music',
  'narrative-story': 'Contemplative Reading', 'skyline-drift': 'Skyline Drift', 'tidal-garden': 'Tidal Garden',
  'breath-weave': 'Breath Weave', 'signal-sort': 'Signal Sort', 'rhythm-lock': 'Rhythm Lock',
  'media-mode': 'Media Mode', 'soundscape-mode': 'Soundscape Mode', mandala: 'Mandala Breathing',
  'eeg-mandala': 'Generative Mandala',
};
const defaults = (protocol: Parameters<typeof getClinicalProtocolTemplate>[0]) => [...getClinicalProtocolTemplate(protocol)!.recommendedExperiences];
const PATIENT_TABS = ['Home', 'Train', 'Science', 'Progress', 'Profile'];

async function expectNavigation(page: Page, linked: boolean) {
  const nav = page.locator('nav').last();
  await expect(nav.getByRole('button')).toHaveCount(linked ? 7 : 5);
  for (const name of PATIENT_TABS) await expect(nav.getByRole('button', { name, exact: true })).toBeVisible();
  for (const name of ['Messages', 'Visits']) {
    await expect(nav.getByRole('button', { name, exact: true })).toHaveCount(linked ? 1 : 0);
  }
}

async function expectAuthority(page: Page, authority: 'Self-directed' | 'Clinician-managed', protocolName: string) {
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.getByText(`Protocol: ${protocolName}`)).toBeVisible();
  await expect(page.getByText(`${authority} protocol`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change training setup', exact: true })).toHaveCount(authority === 'Self-directed' ? 1 : 0);
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await expect(page.getByText(`Training setup: ${authority}`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change Training Setup', exact: true })).toHaveCount(authority === 'Self-directed' ? 1 : 0);
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
  await expect(page.locator('.card-patient').filter({ hasText: 'breath weave' }).first()).toBeVisible();
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
  await page.getByPlaceholder('Unavailable').fill('3');
  await page.getByRole('button', { name: 'Create Invitation' }).click();
  await expect(page.getByRole('heading', { name: 'Invitation created' })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
}

test('self-directed setup survives reloads, yields to a clinician invitation, and returns after unlink', async ({ browser }) => {
  test.setTimeout(240_000);
  const { clinician: clinicianAccount } = await seedLinkedPatient();
  const email = `self-directed-${randomUUID().slice(0, 12)}@example.test`;
  const name = 'Self Directed Patient';
  const alpha = defaults('alpha-enhancement');
  const smr = defaults('smr-enhancement');
  const clinicianContext = await browser.newContext();
  const patientContext = await browser.newContext();
  try {
    // 1. A new unlinked patient: default protocol, canonical list, no clinician destinations.
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
    await expectAuthority(patient, 'Self-directed', 'Lubar Theta/Beta Ratio Protocol');
    await expect(patient.getByText('Goal:')).toHaveCount(0);
    await expect(patient.getByText('Weekly Target:')).toHaveCount(0);
    await expectTrainCatalogue(patient, defaults('theta-beta-ratio'));
    const { sessionId, garden } = await seedSelfDirectedHistory(uid);
    await reloadPatient(patient);
    await expectNavigation(patient, false);
    await expectHistory(patient, uid, sessionId);

    // 2. Choose another supported protocol: its canonical experiences become active and persist.
    await patient.getByRole('button', { name: 'Home', exact: true }).click();
    await patient.getByRole('button', { name: 'Change training setup', exact: true }).click();
    const setup = patient.getByRole('dialog', { name: 'Training setup' });
    await expect(setup).toContainText('not a diagnosis or a treatment plan');
    await setup.getByRole('radio', { name: /Hardt Alpha Synchrony Protocol/ }).check();
    await expect(setup).toContainText(`Using the ${alpha.length} defaults for this protocol`);
    await setup.getByRole('button', { name: 'Save setup' }).click();
    await expect(setup).toHaveCount(0);
    await expectAuthority(patient, 'Self-directed', 'Hardt Alpha Synchrony Protocol');
    await expectTrainCatalogue(patient, alpha);
    await reloadPatient(patient);
    await expectNavigation(patient, false);
    await expectAuthority(patient, 'Self-directed', 'Hardt Alpha Synchrony Protocol');
    await expectTrainCatalogue(patient, alpha);
    expect(await readPatientTrainingRecord(uid)).toMatchObject({ clinicianId: null, assignedProtocol: 'alpha-enhancement', allowedExperiences: alpha });

    // 3. Customize experiences: the exact list persists and drives Home, Train and session start.
    await patient.getByRole('button', { name: 'Profile', exact: true }).click();
    await patient.getByRole('button', { name: 'Change Training Setup', exact: true }).click();
    await setup.getByRole('button', { name: 'Customize experiences' }).click();
    await setup.getByRole('checkbox', { name: 'Tidal Garden' }).uncheck();
    await setup.getByRole('checkbox', { name: 'Signal Sort' }).check();
    const custom = [...alpha.filter((id) => id !== 'tidal-garden'), 'signal-sort'];
    await expect(setup).toContainText(`Customized: ${custom.length} of 13 experiences`);
    await setup.getByRole('button', { name: 'Save setup' }).click();
    await expect(setup).toHaveCount(0);
    await reloadPatient(patient);
    await expectTrainCatalogue(patient, custom);
    await patient.getByRole('button', { name: 'Home', exact: true }).click();
    await expect(patient.getByRole('button', { name: 'Signal Sort', exact: true })).toHaveCount(1);
    await expect(patient.getByRole('button', { name: 'Tidal Garden', exact: true })).toHaveCount(0);
    const saved = await readPatientTrainingRecord(uid);
    expect(new Set(saved.allowedExperiences)).toEqual(new Set(custom));
    expect(saved.allowedExperiences).toHaveLength(custom.length);
    await startPatientTrainingInDemoMode(patient, 'Signal Sort');
    // Session start honors the customized list: the Signal Sort game itself is running.
    await expect(patient.getByText(/SMR Motor Stillness/)).toBeVisible();
    await expect(patient.getByRole('button', { name: 'End Session & Save' })).toBeVisible();
    await reloadPatient(patient);

    // 4. Accepting a clinician invitation replaces the self-directed setup completely.
    const clinician = await clinicianContext.newPage();
    await loginThroughUi(clinician, clinicianAccount);
    await arriveAtClinicianDashboard(clinician);
    await inviteFromClinician(clinician, email, name, 'smr-enhancement');
    const code = await findPendingLifecycleInvitation(clinicianAccount.uid, email);
    await patient.getByRole('button', { name: 'Home', exact: true }).click();
    await patient.getByRole('button', { name: 'Connect to Clinician' }).click();
    await patient.getByLabel('Invitation code').fill(code);
    await patient.getByRole('button', { name: 'Accept Invitation' }).click();
    await expectNavigation(patient, true);
    await expectAuthority(patient, 'Clinician-managed', 'Sterman SMR Stillness Protocol');
    await expect(patient.getByText('Connected to your clinician')).toBeVisible();
    await expect(patient.getByText('Goal: Peak Performance')).toBeVisible();
    await expectTrainCatalogue(patient, smr);
    await reloadPatient(patient);
    await expectNavigation(patient, true);
    await expectAuthority(patient, 'Clinician-managed', 'Sterman SMR Stillness Protocol');
    await expectTrainCatalogue(patient, smr);
    await patient.getByRole('button', { name: 'Messages', exact: true }).click();
    await expect(patient.getByRole('heading', { name: 'Messages', exact: true })).toBeVisible();
    await expectHistory(patient, uid, sessionId);
    expect(await readPatientTrainingRecord(uid)).toMatchObject({
      clinicianId: clinicianAccount.uid, assignedProtocol: 'smr-enhancement', allowedExperiences: smr,
      hasCustomProtocolConfig: false, tidalGardenState: garden, completedSessionsCount: 1, badges: ['garden-keeper'],
    });

    // 5. Unlinking removes clinician destinations and restores self-directed setup without losing history.
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
    await expectAuthority(patient, 'Self-directed', 'Sterman SMR Stillness Protocol');
    await expect(patient.getByText('Goal:')).toHaveCount(0);
    await expect(patient.getByText('Connect to Clinician')).toBeVisible();
    await expectTrainCatalogue(patient, smr);
    await expectHistory(patient, uid, sessionId);
    await patient.getByRole('button', { name: 'Home', exact: true }).click();
    await patient.getByRole('button', { name: 'Change training setup', exact: true }).click();
    await setup.getByRole('radio', { name: /Beta De-arousal Downtraining/ }).check();
    await setup.getByRole('button', { name: 'Save setup' }).click();
    await expect(setup).toHaveCount(0);
    await reloadPatient(patient);
    await expectNavigation(patient, false);
    await expectAuthority(patient, 'Self-directed', 'Beta De-arousal Downtraining');
    await expectTrainCatalogue(patient, defaults('beta-downtraining'));
    expect(await readPatientTrainingRecord(uid)).toMatchObject({
      clinicianId: null, assignedProtocol: 'beta-downtraining', allowedExperiences: defaults('beta-downtraining'),
      tidalGardenState: garden, completedSessionsCount: 1, badges: ['garden-keeper'],
    });
  } finally {
    await Promise.allSettled([clinicianContext.close(), patientContext.close()]);
  }
});

test('an unlinked legacy profile without assignment fields stays usable and can be configured', async ({ browser }) => {
  // Legacy field-missing records keep the established full-catalogue fallback until the patient chooses.
  const fixture = await seedLinkedPatient({ clinicianId: null, clinicId: null });
  await removePatientFields(fixture.patient.uid, ['allowedExperiences', 'assignedProtocol']);
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await loginThroughUi(page, fixture.patient);
    await arriveAtPatientDashboard(page);
    await expectNavigation(page, false);
    await expectTrainCatalogue(page, Object.keys(EXPERIENCE_NAMES));
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await page.getByRole('button', { name: 'Change training setup', exact: true }).click();
    const setup = page.getByRole('dialog', { name: 'Training setup' });
    await expect(setup).toContainText('Customized: 13 of 13 experiences');
    await setup.getByRole('radio', { name: /Peniston Alpha-Theta Protocol/ }).check();
    await setup.getByRole('button', { name: 'Save setup' }).click();
    await expect(setup).toHaveCount(0);
    await reloadPatient(page);
    await expectAuthority(page, 'Self-directed', 'Peniston Alpha-Theta Protocol');
    await expectTrainCatalogue(page, defaults('alpha-theta-crossover'));
  } finally {
    await context.close();
  }
});
