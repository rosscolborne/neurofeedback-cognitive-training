import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { getClinicalProtocolTemplate } from '../src/services/clinicalProtocolTemplates';
import { expect, test } from './fixtures';
import {
  arriveAtPatientDashboard, authenticatedUserId, loginThroughUi, startPatientTrainingInDemoMode,
} from './helpers/auth';
import { readPatientTrainingRecord, removePatientFields, seedPatient, seedSelfDirectedHistory } from './helpers/localEmulator';

const EXPERIENCE_NAMES: Record<string, string> = { 'neuro-gambit': 'NeuroGambit' };
const defaults = (protocol: Parameters<typeof getClinicalProtocolTemplate>[0]) => [...getClinicalProtocolTemplate(protocol)!.recommendedExperiences];
const PATIENT_TABS = ['Home', 'Train', 'Progress', 'Profile'];

async function expectNavigation(page: Page) {
  const nav = page.locator('nav').last();
  await expect(nav.getByRole('button')).toHaveCount(PATIENT_TABS.length);
  for (const name of PATIENT_TABS) await expect(nav.getByRole('button', { name, exact: true })).toBeVisible();
}

/** A Profile fact: its label and value sit together in one FactGrid entry. */
function profileFact(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator('..');
}

/** The patient's own protocol on Home and Profile, with the controls to change it. */
async function expectOwnProtocol(page: Page, protocolName: string) {
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('button', { name: `Protocol: ${protocolName}. View protocol details`, exact: true })).toBeVisible();
  await expect(page.getByText('Your protocol', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change training setup', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await expect(profileFact(page, 'Protocol')).toContainText(protocolName);
  await expect(page.getByRole('button', { name: 'Change Training Setup', exact: true })).toHaveCount(1);
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

/** No clinician surface remains on Home or Profile. */
async function expectNoClinicianSurface(page: Page) {
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Clinician invitation' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Accept Invitation' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await expect(page.getByRole('button', { name: /Connect to Clinician/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Disconnect from Clinician' })).toHaveCount(0);
  await expect(page.getByText(/clinician/i)).toHaveCount(0);
}

async function reloadPatient(page: Page) {
  await page.reload();
  await arriveAtPatientDashboard(page);
}

test('self-directed setup survives reloads and drives the catalogue and session start', async ({ browser }) => {
  test.setTimeout(240_000);
  const email = `self-directed-${randomUUID().slice(0, 12)}@example.test`;
  const name = 'Self Directed Patient';
  const alpha = defaults('alpha-enhancement');
  const patientContext = await browser.newContext();
  try {
    // 1. A new patient: default protocol, canonical list, no clinician surface.
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
    await expectNavigation(patient);
    await expectOwnProtocol(patient, 'Lubar Theta/Beta Ratio Protocol');
    await expect(patient.getByText('Goal', { exact: true })).toHaveCount(0);
    await expect(patient.getByText('Weekly target', { exact: true })).toHaveCount(0);
    await expectTrainCatalogue(patient, defaults('theta-beta-ratio'));
    await expectNoClinicianSurface(patient);
    const { sessionId } = await seedSelfDirectedHistory(uid);
    await reloadPatient(patient);
    await expectNavigation(patient);
    await expectHistory(patient, uid, sessionId);

    // 2. Choose another supported protocol: its canonical experiences become active and persist.
    await patient.getByRole('button', { name: 'Home', exact: true }).click();
    await patient.getByRole('button', { name: 'Change training setup', exact: true }).click();
    const setup = patient.getByRole('dialog', { name: 'Training setup' });
    await expect(setup).toContainText('not a diagnosis or a treatment plan');
    await setup.getByRole('radio', { name: /Hardt Alpha Synchrony Protocol/ }).check();
    await expect(setup).toContainText('Using the 1 default for this protocol');
    await setup.getByRole('button', { name: 'Save setup' }).click();
    await expect(setup).toHaveCount(0);
    await expectOwnProtocol(patient, 'Hardt Alpha Synchrony Protocol');
    await expectTrainCatalogue(patient, alpha);
    await reloadPatient(patient);
    await expectNavigation(patient);
    await expectOwnProtocol(patient, 'Hardt Alpha Synchrony Protocol');
    await expectTrainCatalogue(patient, alpha);
    expect(await readPatientTrainingRecord(uid)).toMatchObject({ assignedProtocol: 'alpha-enhancement', allowedExperiences: alpha });

    // 3. Customizing needs at least one experience; the saved list drives Home, Train and session start.
    await patient.getByRole('button', { name: 'Profile', exact: true }).click();
    await patient.getByRole('button', { name: 'Change Training Setup', exact: true }).click();
    await setup.getByRole('button', { name: 'Customize experiences' }).click();
    await setup.getByRole('checkbox', { name: 'NeuroGambit' }).uncheck();
    await expect(setup).toContainText('Customized: 0 of 1 experience');
    await expect(setup.getByRole('alert')).toContainText('Choose at least one training experience.');
    await expect(setup.getByRole('button', { name: 'Save setup' })).toBeDisabled();
    await setup.getByRole('button', { name: 'Use protocol defaults' }).click();
    await expect(setup).toContainText('Using the 1 default for this protocol');
    await setup.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(setup).toHaveCount(0);
    expect(await readPatientTrainingRecord(uid)).toMatchObject({ assignedProtocol: 'alpha-enhancement', allowedExperiences: alpha });
    await patient.getByRole('button', { name: 'Home', exact: true }).click();
    await expect(patient.getByRole('button', { name: 'NeuroGambit', exact: true })).toHaveCount(1);
    await startPatientTrainingInDemoMode(patient, 'NeuroGambit');
    // Session start honors the saved list: NeuroGambit itself is running.
    await expect(patient.getByRole('group', { name: 'Training track' })).toBeVisible();
    await expect(patient.getByRole('button', { name: 'End Session & Save' })).toBeVisible();
    await reloadPatient(patient);

  } finally {
    await patientContext.close();
  }
});

test('a legacy profile without assignment fields stays usable and can be configured', async ({ browser }) => {
  // Legacy field-missing records keep the full-catalogue fallback until the patient chooses; that catalogue is
  // now NeuroGambit alone, which matches the default protocol's defaults.
  const fixture = await seedPatient();
  await removePatientFields(fixture.patient.uid, ['allowedExperiences', 'assignedProtocol']);
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await loginThroughUi(page, fixture.patient);
    await arriveAtPatientDashboard(page);
    await expectNavigation(page);
    await expectTrainCatalogue(page, Object.keys(EXPERIENCE_NAMES));
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await page.getByRole('button', { name: 'Change training setup', exact: true }).click();
    const setup = page.getByRole('dialog', { name: 'Training setup' });
    await expect(setup).toContainText('Using the 1 default for this protocol');
    await setup.getByRole('radio', { name: /Peniston Alpha-Theta Protocol/ }).check();
    await setup.getByRole('button', { name: 'Save setup' }).click();
    await expect(setup).toHaveCount(0);
    await reloadPatient(page);
    await expectOwnProtocol(page, 'Peniston Alpha-Theta Protocol');
    await expectTrainCatalogue(page, defaults('alpha-theta-crossover'));
  } finally {
    await context.close();
  }
});
