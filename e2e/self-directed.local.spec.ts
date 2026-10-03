import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { getClinicalProtocolTemplate } from '../src/services/clinicalProtocolTemplates';
import { expect, test } from './fixtures';
import {
  arriveAtPatientDashboard, authenticatedUserId, loginThroughUi, startPatientTrainingInDemoMode,
} from './helpers/auth';
import { removePatientFields, seedPatient, seedSelfDirectedHistory } from './helpers/localEmulator';

const EXPERIENCE_NAMES: Record<string, string> = { 'neuro-gambit': 'NeuroGambit' };
const defaults = (protocol: Parameters<typeof getClinicalProtocolTemplate>[0]) => [...getClinicalProtocolTemplate(protocol)!.recommendedExperiences];
const PATIENT_TABS = ['Home', 'Train', 'Progress', 'Profile'];

async function expectNavigation(page: Page) {
  const nav = page.locator('nav').last();
  await expect(nav.getByRole('button')).toHaveCount(PATIENT_TABS.length);
  for (const name of PATIENT_TABS) await expect(nav.getByRole('button', { name, exact: true })).toBeVisible();
}

/** There is no protocol to show or choose: the consumer app has no EEG protocols. */
async function expectNoProtocolSetup(page: Page) {
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Protocol:/ })).toHaveCount(0);
  await expect(page.getByText('Your protocol', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Change training setup', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await expect(page.getByText('Protocol', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Change Training Setup', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'View Protocol Details', exact: true })).toHaveCount(0);
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

test('a new patient has no protocol setup, and the stored experience list drives the catalogue and session start', async ({ browser }) => {
  test.setTimeout(240_000);
  const email = `self-directed-${randomUUID().slice(0, 12)}@example.test`;
  const name = 'Self Directed Patient';
  const patientContext = await browser.newContext();
  try {
    // 1. A new patient: the default experience list, no protocol setup, no clinician surface.
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
    await expectNoProtocolSetup(patient);
    await expect(patient.getByText('Goal', { exact: true })).toHaveCount(0);
    await expect(patient.getByText('Weekly target', { exact: true })).toHaveCount(0);
    await expectTrainCatalogue(patient, defaults('theta-beta-ratio'));
    await expectNoClinicianSurface(patient);
    const { sessionId } = await seedSelfDirectedHistory(uid);
    await reloadPatient(patient);
    await expectNavigation(patient);
    await expectHistory(patient, uid, sessionId);

    // 2. The stored experience starts, in Demo Mode without a headset.
    await patient.getByRole('button', { name: 'Home', exact: true }).click();
    await expect(patient.getByRole('button', { name: 'NeuroGambit', exact: true })).toHaveCount(1);
    await startPatientTrainingInDemoMode(patient, 'NeuroGambit');
    // Session start honors the saved list: NeuroGambit itself is running.
    await expect(patient.getByRole('group', { name: 'Training track' })).toBeVisible();
    await expect(patient.getByRole('button', { name: 'End Session & Save' })).toBeVisible();
    await reloadPatient(patient);
    await expectNoProtocolSetup(patient);
  } finally {
    await patientContext.close();
  }
});

test('a legacy profile without assignment fields stays usable', async ({ browser }) => {
  // Legacy field-missing records keep the full-catalogue fallback, which is NeuroGambit alone.
  const fixture = await seedPatient();
  await removePatientFields(fixture.patient.uid, ['allowedExperiences', 'assignedProtocol']);
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await loginThroughUi(page, fixture.patient);
    await arriveAtPatientDashboard(page);
    await expectNavigation(page);
    await expectTrainCatalogue(page, Object.keys(EXPERIENCE_NAMES));
    await expectNoProtocolSetup(page);
    await reloadPatient(page);
    await expectTrainCatalogue(page, Object.keys(EXPERIENCE_NAMES));
  } finally {
    await context.close();
  }
});
