import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { getClinicalProtocolTemplate } from '../src/services/clinicalProtocolTemplates';
import { expect, test } from './fixtures';
import { arriveAtPatientDashboard, loginThroughUi, startPatientTrainingInDemoMode } from './helpers/auth';
import { seedLinkedPatient, setPatientFields, type LocalPatientFixture } from './helpers/localEmulator';

const seedPatient = seedLinkedPatient;
type Fixture = LocalPatientFixture;

// Clinician-defined rewards as the retired protocol builder saved them on the patient's profile.
const betaTemplate = getClinicalProtocolTemplate('beta-downtraining')!;
const thetaTemplate = getClinicalProtocolTemplate('theta-beta-ratio')!;
const customSingleBand = (targetCondition: 'above' | 'below') => ({
  assignedProtocol: 'beta-downtraining',
  customProtocolConfig: {
    ...betaTemplate, id: `custom-single-band-${targetCondition}`, customRewardEnabled: true,
    rewardBand: { ...betaTemplate.rewardBand, freqMin: 18, freqMax: 24, targetCondition, targetThreshold: 999 },
  },
});
const customRatio = {
  assignedProtocol: 'theta-beta-ratio',
  customProtocolConfig: {
    ...thetaTemplate, id: 'custom-ratio', customRewardEnabled: true,
    ratioReward: {
      numerator: { freqMin: 5, freqMax: 9 }, denominator: { freqMin: 15, freqMax: 29 },
      targetCondition: 'below', targetThreshold: 999,
    },
    rewardBand: { ...thetaTemplate.rewardBand },
  },
};

async function patientDetails(page: Page, fixture: Fixture) {
  await loginThroughUi(page, fixture.patient);
  await arriveAtPatientDashboard(page);
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await page.getByRole('button', { name: 'View Protocol Details' }).click();
  return page.getByRole('dialog', { name: 'Protocol details' });
}

async function returnHome(page: Page) {
  await page.getByRole('button', { name: 'Close protocol details' }).click();
  await page.getByRole('button', { name: 'Home', exact: true }).click();
}

function detailValue(dialog: ReturnType<Page['getByRole']>, label: string) {
  return dialog.getByText(label, { exact: true }).locator('..');
}

function telemetryCell(page: Page, label: RegExp | string) {
  return page.locator('.card-patient-recessed > div').filter({ has: page.getByText(label, { exact: typeof label === 'string' }) }).first();
}

test('fresh patient signup shows the default TBR protocol and only its assigned Home and Train experiences', async ({ browser }) => {
  const page = await browser.newPage();
  const email = `fresh-tbr-${randomUUID().slice(0, 12)}@example.test`;
  const expectedIds = getClinicalProtocolTemplate('theta-beta-ratio')!.recommendedExperiences;
  const expectedNames = ['NeuroGambit'];
  try {
    await page.goto('/#/signup');
    await page.getByPlaceholder('How should we call you?').fill('Fresh TBR Patient');
    await page.getByPlaceholder('you@example.com').fill(email);
    await page.getByPlaceholder('At least 6 characters').fill('LocalEmulator!123');
    await page.getByRole('button', { name: 'Create Account' }).click();
    await page.getByRole('button', { name: /Train my brain/ }).click();
    await arriveAtPatientDashboard(page);

    const assignment = await page.evaluate(async () => {
      const { auth } = await import('/src/services/firebase.ts');
      const { storageEngine } = await import('/src/services/storageEngine.ts');
      if (!auth.currentUser) throw new Error('Expected a signed-in patient');
      const profile = await storageEngine.getClient(auth.currentUser.uid);
      return { protocol: profile?.assignedProtocol, allowed: profile?.allowedExperiences };
    });
    expect(assignment).toEqual({ protocol: 'theta-beta-ratio', allowed: expectedIds });
    await expect(page.locator('main')).toContainText('Lubar Theta/Beta Ratio Protocol');
    for (const name of expectedNames) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(1);

    await page.getByRole('button', { name: 'Train', exact: true }).click();
    const cards = page.locator('main .card-patient');
    await expect(cards).toHaveCount(expectedIds.length);
    for (const name of expectedNames) await expect(cards.getByText(name, { exact: true })).toHaveCount(1);
    await page.reload();
    await arriveAtPatientDashboard(page);
    await expect(page.locator('main')).toContainText('Lubar Theta/Beta Ratio Protocol');
    await page.getByRole('button', { name: 'Train', exact: true }).click();
    await expect(page.locator('main .card-patient')).toHaveCount(expectedIds.length);
    for (const name of expectedNames) await expect(page.locator('main .card-patient').getByText(name, { exact: true })).toHaveCount(1);
  } finally {
    await page.close();
  }
});

async function inZoneTrend(page: Page): Promise<number | null> {
  const text = await telemetryCell(page, 'In zone · last 10s').innerText();
  const value = text.match(/(\d+)%/);
  return value ? Number(value[1]) : null;
}

test('unassigned patient resolves the default protocol in details and Demo training', async ({ browser }) => {
  const fixture = await seedPatient();
  const patientPage = await browser.newPage();
  const dialog = await patientDetails(patientPage, fixture);
  await expect(detailValue(dialog, 'Protocol')).toContainText('Lubar Theta/Beta Ratio Protocol');
  await expect(detailValue(dialog, 'Theta')).toContainText('4–8 Hz');
  await expect(detailValue(dialog, 'Beta')).toContainText('13–30 Hz');
  await expect(detailValue(dialog, 'Reward when')).toContainText('Theta/Beta below 1.85');
  await returnHome(patientPage);
  await startPatientTrainingInDemoMode(patientPage);
  await expect(telemetryCell(patientPage, 'THETA/BETA')).toBeVisible();
  await expect(telemetryCell(patientPage, 'THETA/BETA')).not.toContainText('µV');
  await patientPage.close();
});

function pageReward(page: Page, label: RegExp | string) { return telemetryCell(page, label); }

test('default Beta feedback agrees with the live reward value and in-zone trend', async ({ browser }) => {
  const fixture = await seedPatient({ assignedProtocol: 'beta-downtraining' });
  const page = await browser.newPage();
  const dialog = await patientDetails(page, fixture);
  await expect(detailValue(dialog, 'Protocol')).toContainText('Beta De-arousal Downtraining');
  await expect(detailValue(dialog, 'Training band')).toContainText('13–30 Hz');
  await expect(detailValue(dialog, 'Reward when')).toContainText('Below 14 µV');
  await returnHome(page);
  await startPatientTrainingInDemoMode(page);

  const controls = page.getByRole('region', { name: 'Demo state controls' });
  const tile = pageReward(page, /BETA \(13–30 Hz\)/);
  const displayedUv = (snapshot: string) => {
    const value = snapshot.match(/(\d+(?:\.\d+)?)\s*µV/);
    expect(value, `Expected a µV reading in the reward tile: ${snapshot}`).not.toBeNull();
    return Number(value![1]);
  };
  const waitForSnapshot = async (onClearSide: (value: number) => boolean) => {
    let snapshot = '';
    await expect.poll(async () => {
      snapshot = await tile.innerText();
      const value = snapshot.match(/(\d+(?:\.\d+)?)\s*µV/);
      return Boolean(value && onClearSide(Number(value[1])) && /(?:In|Out of) zone now/.test(snapshot));
    }, { timeout: 15_000 }).toBe(true);
    return snapshot;
  };

  // Demo emits at 10 Hz; adaptation needs 900 training samples (~90s).
  // Two 10-second state windows stay before that first threshold change.
  await controls.getByRole('button', { name: 'Focus' }).click();
  const focusSnapshot = await waitForSnapshot((value) => value > 15);
  expect(focusSnapshot).toMatch(/BETA \(13–30 Hz\)/i);
  expect(displayedUv(focusSnapshot)).toBeGreaterThan(15);
  expect(focusSnapshot).toContain('Out of zone now');
  await page.waitForTimeout(10_500);
  const focusTrend = await inZoneTrend(page);
  expect(focusTrend).not.toBeNull();
  expect(focusTrend!).toBeLessThan(70);

  await controls.getByRole('button', { name: 'Drift' }).click();
  const driftSnapshot = await waitForSnapshot((value) => value < 11);
  expect(driftSnapshot).toMatch(/BETA \(13–30 Hz\)/i);
  expect(displayedUv(driftSnapshot)).toBeLessThan(11);
  expect(driftSnapshot).toContain('In zone now');
  await page.waitForTimeout(10_500);
  const driftTrend = await inZoneTrend(page);
  expect(driftTrend).not.toBeNull();
  expect(driftTrend!).toBeGreaterThan(focusTrend! + 20);
  await page.close();
});

test('custom single-band and ratio rewards drive patient details and the visible reward tile', async ({ browser }) => {
  const fixture = await seedPatient(customSingleBand('above'));
  let patientPage = await browser.newPage();
  let dialog = await patientDetails(patientPage, fixture);
  await expect(detailValue(dialog, 'Training band')).toContainText('18–24 Hz');
  await expect(detailValue(dialog, 'Reward when')).toContainText('Above 999 µV');
  await returnHome(patientPage);
  await startPatientTrainingInDemoMode(patientPage);
  await expect(pageReward(patientPage, /REWARD \(18–24 Hz\)/)).toContainText('µV');
  await expect(pageReward(patientPage, /REWARD \(18–24 Hz\)/)).toContainText('Out of zone now');
  await expect.poll(() => inZoneTrend(patientPage)).toBeLessThan(20);
  await patientPage.close();

  await setPatientFields(fixture.patient.uid, customSingleBand('below'));
  patientPage = await browser.newPage();
  dialog = await patientDetails(patientPage, fixture);
  await expect(detailValue(dialog, 'Reward when')).toContainText('Below 999 µV');
  await returnHome(patientPage);
  await startPatientTrainingInDemoMode(patientPage);
  await expect(pageReward(patientPage, /REWARD \(18–24 Hz\)/)).toContainText('In zone now');
  await expect.poll(() => inZoneTrend(patientPage)).toBeGreaterThan(80);
  await patientPage.close();

  // The same patient switches to a clinician-defined two-band ratio.
  await setPatientFields(fixture.patient.uid, customRatio);
  patientPage = await browser.newPage();
  dialog = await patientDetails(patientPage, fixture);
  await expect(detailValue(dialog, 'Theta')).toContainText('5–9 Hz');
  await expect(detailValue(dialog, 'Beta')).toContainText('15–29 Hz');
  await expect(detailValue(dialog, 'Reward when')).toContainText('Theta/Beta below 999');
  await returnHome(patientPage);
  await startPatientTrainingInDemoMode(patientPage);
  await expect(pageReward(patientPage, /THETA\/BETA \(5–9 \/ 15–29 Hz\)/)).not.toContainText('µV');
  await expect(pageReward(patientPage, /THETA\/BETA \(5–9 \/ 15–29 Hz\)/)).toContainText('In zone now');
  const controls = patientPage.getByRole('region', { name: 'Demo state controls' });
  await controls.getByRole('button', { name: 'Focus' }).click();
  const focusRatio = await pageReward(patientPage, /THETA\/BETA \(5–9 \/ 15–29 Hz\)/).innerText();
  await controls.getByRole('button', { name: 'Drift' }).click();
  await expect.poll(async () => pageReward(patientPage, /THETA\/BETA \(5–9 \/ 15–29 Hz\)/).innerText()).not.toBe(focusRatio);
  await patientPage.close();
});

test('Demo telemetry follows Focus and Drift and remains labeled simulated', async ({ browser }) => {
  const fixture = await seedPatient();
  const page = await browser.newPage();
  await loginThroughUi(page, fixture.patient);
  await startPatientTrainingInDemoMode(page);
  const controls = page.getByRole('region', { name: 'Demo state controls' });
  const mindfulness = telemetryCell(page, 'Mindfulness');
  const restfulness = telemetryCell(page, 'Restfulness');
  await expect(mindfulness).toContainText('Simulated');
  await expect(restfulness).toContainText('Simulated');
  await controls.getByRole('button', { name: 'Focus' }).click();
  await page.waitForTimeout(2_000);
  await expect(mindfulness).not.toContainText('Unavailable');
  await expect(restfulness).not.toContainText('Unavailable');
  const focus = await mindfulness.innerText();
  await controls.getByRole('button', { name: 'Drift' }).click();
  await page.waitForTimeout(2_000);
  await expect.poll(async () => mindfulness.innerText(), { timeout: 12_000 }).not.toBe(focus);
  const drift = await restfulness.innerText();
  await expect.poll(async () => restfulness.innerText(), { timeout: 12_000 }).not.toBe(drift);
  await expect(pageReward(page, 'THETA/BETA')).not.toContainText('Unavailable');
  await page.close();
});

test('malformed persisted reward is blocked in details and training', async ({ browser }) => {
  const fixture = await seedPatient({
    assignedProtocol: 'beta-downtraining',
    customProtocolConfig: {
      id: 'bad-beta-rule', protocolType: 'beta-downtraining', name: 'Beta De-arousal Downtraining',
      customRewardEnabled: true,
      ratioReward: { numerator: { freqMin: 4, freqMax: 8 }, denominator: { freqMin: 13, freqMax: 30 }, targetCondition: 'below', targetThreshold: 1.8 },
      rewardBand: { name: 'Beta spectral amplitude', freqMin: 13, freqMax: 30, targetCondition: 'below', targetThreshold: 14 },
      sessionDurationMinutes: 25,
    },
  });
  const page = await browser.newPage();
  const dialog = await patientDetails(page, fixture);
  await expect(dialog.getByRole('alert')).toContainText('Training unavailable');
  await returnHome(page);
  await page.getByRole('button', { name: 'Begin Session' }).click();
  await expect(page.getByRole('heading', { name: 'Protocol unavailable' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try Demo Mode' })).toHaveCount(0);
  await page.close();
});
