import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { getClinicalProtocolTemplate } from '../src/services/clinicalProtocolTemplates';
import { expect, test } from './fixtures';
import { arriveAtClinicianDashboard, arriveAtPatientDashboard, loginThroughUi, startPatientTrainingInDemoMode } from './helpers/auth';
import { seedLinkedPatient, type LocalPatientFixture } from './helpers/localEmulator';

const seedPatient = seedLinkedPatient;
type Fixture = LocalPatientFixture;

async function clinicianDetail(page: Page, fixture: Fixture) {
  await loginThroughUi(page, fixture.clinician);
  await arriveAtClinicianDashboard(page);
  await page.getByRole('row').filter({ hasText: fixture.name }).click();
  await expect(page.getByRole('heading', { name: fixture.name })).toBeVisible();
}

async function openBuilder(page: Page) {
  await page.getByRole('button', { name: 'Adjust Protocol' }).click();
  await expect(page.getByRole('heading', { name: /Clinical Protocol Architect/ })).toBeVisible();
}

async function saveBuilder(page: Page) {
  await page.getByRole('button', { name: 'Assign Protocol Configuration' }).click();
  await expect(page.getByRole('heading', { name: /Clinical Protocol Architect/ })).toBeHidden();
}

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
  const expectedNames = [
    'Skyline Drift', 'Signal Sort', 'Rhythm Lock', 'Media Mode', 'Generative Mandala',
    'Generative XR', 'Generative Music', 'Contemplative Reading', 'NeuroGambit',
  ];
  const excludedNames = ['Tidal Garden', 'Breath Weave', 'Soundscape Mode', 'Mandala Breathing'];
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
    for (const name of excludedNames) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Train', exact: true }).click();
    const cards = page.locator('main .card-patient');
    await expect(cards).toHaveCount(expectedIds.length);
    for (const name of expectedNames) await expect(cards.getByText(name, { exact: true })).toHaveCount(1);
    for (const name of excludedNames) await expect(cards.getByText(name, { exact: true })).toHaveCount(0);
    await page.reload();
    await arriveAtPatientDashboard(page);
    await expect(page.locator('main')).toContainText('Lubar Theta/Beta Ratio Protocol');
    await page.getByRole('button', { name: 'Train', exact: true }).click();
    await expect(page.locator('main .card-patient')).toHaveCount(expectedIds.length);
    for (const name of expectedNames) await expect(page.locator('main .card-patient').getByText(name, { exact: true })).toHaveCount(1);
    for (const name of excludedNames) await expect(page.locator('main .card-patient').getByText(name, { exact: true })).toHaveCount(0);
  } finally {
    await page.close();
  }
});

test('clinician protocol change updates patient Home and Train without losing Garden progress', async ({ browser }) => {
  const theta = getClinicalProtocolTemplate('theta-beta-ratio')!;
  const alpha = getClinicalProtocolTemplate('alpha-enhancement')!;
  const fixture = await seedLinkedPatient({
    assignedProtocol: theta.protocolType,
    allowedExperiences: theta.recommendedExperiences,
    tidalGardenState: { stage: 3, growthPoints: 601, plantsUnlocked: ['kelp'], lastWatered: 'yesterday' },
  });
  const clinicianContext = await browser.newContext();
  const patientContext = await browser.newContext();
  try {
    const clinician = await clinicianContext.newPage();
    const patient = await patientContext.newPage();
    await loginThroughUi(patient, fixture.patient);
    await arriveAtPatientDashboard(patient);
    await patient.getByRole('button', { name: 'Progress', exact: true }).click();
    await expect(patient.getByText('Garden Keeper', { exact: true })).toBeVisible();

    await clinicianDetail(clinician, fixture);
    await openBuilder(clinician);
    await clinician.getByRole('button', { name: /Hardt Alpha Synchrony Protocol/ }).click();
    await saveBuilder(clinician);

    await patient.reload();
    await arriveAtPatientDashboard(patient);
    await expect(patient.locator('main')).toContainText('Hardt Alpha Synchrony Protocol');
    for (const name of ['Tidal Garden', 'Breath Weave', 'Soundscape Mode', 'Mandala Breathing']) {
      await expect(patient.getByRole('button', { name, exact: true })).toHaveCount(1);
    }
    for (const name of ['Skyline Drift', 'Signal Sort', 'Rhythm Lock', 'Media Mode', 'NeuroGambit']) {
      await expect(patient.getByRole('button', { name, exact: true })).toHaveCount(0);
    }
    await patient.getByRole('button', { name: 'Train', exact: true }).click();
    const cards = patient.locator('main .card-patient');
    await expect(cards).toHaveCount(alpha.recommendedExperiences.length);
    for (const name of ['Generative XR', 'Generative Music', 'Contemplative Reading', 'Tidal Garden', 'Breath Weave', 'Soundscape Mode', 'Mandala Breathing', 'Generative Mandala']) {
      await expect(cards.getByText(name, { exact: true })).toHaveCount(1);
    }
    for (const name of ['Skyline Drift', 'Signal Sort', 'Rhythm Lock', 'Media Mode', 'NeuroGambit']) {
      await expect(cards.getByText(name, { exact: true })).toHaveCount(0);
    }
    await patient.getByRole('button', { name: 'Progress', exact: true }).click();
    await expect(patient.getByText('Garden Keeper', { exact: true })).toBeVisible();
    await patient.getByRole('button', { name: 'Home', exact: true }).click();
    await startPatientTrainingInDemoMode(patient, 'Tidal Garden');
    await expect(patient.getByText('Tidal Garden: Stage 3 (601 XP)')).toBeVisible();
  } finally {
    await Promise.allSettled([clinicianContext.close(), patientContext.close()]);
  }
});

async function inZoneTrend(page: Page): Promise<number | null> {
  const text = await telemetryCell(page, 'In-Zone (10s)').innerText();
  const value = text.match(/(\d+)%/);
  return value ? Number(value[1]) : null;
}

test('unassigned patient resolves the same default in clinician, patient, and Demo training', async ({ browser }) => {
  const fixture = await seedPatient();
  const clinicianPage = await browser.newPage();
  await clinicianDetail(clinicianPage, fixture);
  await openBuilder(clinicianPage);
  await expect(clinicianPage.getByText('Default training compares 4–8 Hz power with 13–30 Hz power. Reward when the ratio is below 1.85.')).toBeVisible();
  await expect(clinicianPage.getByRole('checkbox', { name: 'Use clinician-defined reward criteria' })).not.toBeChecked();
  await clinicianPage.close();

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

test('switching a custom ratio to default Beta clears the prior rule across reload', async ({ browser }) => {
  const fixture = await seedPatient();
  const clinicianPage = await browser.newPage();
  await clinicianDetail(clinicianPage, fixture);
  await openBuilder(clinicianPage);
  await clinicianPage.getByRole('checkbox', { name: 'Use clinician-defined reward criteria' }).check();
  await clinicianPage.getByRole('spinbutton', { name: 'Theta Min Frequency' }).fill('5');
  await clinicianPage.getByRole('spinbutton', { name: 'Reward threshold' }).fill('2.6');
  await saveBuilder(clinicianPage);
  await openBuilder(clinicianPage);
  await clinicianPage.getByRole('button', { name: /Beta De-arousal Downtraining/ }).click();
  await saveBuilder(clinicianPage);
  await clinicianPage.reload();
  await arriveAtClinicianDashboard(clinicianPage);
  await clinicianPage.getByRole('row').filter({ hasText: fixture.name }).click();
  await openBuilder(clinicianPage);
  const custom = clinicianPage.getByRole('checkbox', { name: 'Use clinician-defined reward criteria' });
  await expect(custom).not.toBeChecked();
  await expect(clinicianPage.getByText('Default training measures 13–30 Hz spectral amplitude. Reward when below 14 µV.')).toBeVisible();
  await custom.check();
  await expect(clinicianPage.getByRole('spinbutton', { name: 'Min Frequency', exact: true })).toHaveValue('13');
  await expect(clinicianPage.getByRole('spinbutton', { name: 'Max Frequency', exact: true })).toHaveValue('30');
  await expect(clinicianPage.getByRole('spinbutton', { name: 'Reward threshold' })).toHaveValue('14');
  await expect(clinicianPage.getByRole('combobox', { name: 'Reward condition' })).toHaveValue('below');
  await clinicianPage.close();

  const patientPage = await browser.newPage();
  const dialog = await patientDetails(patientPage, fixture);
  await expect(detailValue(dialog, 'Protocol')).toContainText('Beta De-arousal Downtraining');
  await expect(detailValue(dialog, 'Reward when')).toContainText('Below 14 µV');
  await returnHome(patientPage);
  await startPatientTrainingInDemoMode(patientPage);
  await expect(pageReward(patientPage, /BETA \(13–30 Hz\)/)).toContainText('µV');
  await expect(patientPage.getByText('Ratio rewards are only supported by ratio protocols.')).toHaveCount(0);
  await patientPage.close();
});

function pageReward(page: Page, label: RegExp | string) { return telemetryCell(page, label); }

test('default Beta feedback agrees with the live reward value and in-zone trend', async ({ browser }) => {
  const fixture = await seedPatient({ assignedProtocol: 'beta-downtraining' });
  const clinicianPage = await browser.newPage();
  await clinicianDetail(clinicianPage, fixture);
  await openBuilder(clinicianPage);
  await expect(clinicianPage.getByRole('checkbox', { name: 'Use clinician-defined reward criteria' })).not.toBeChecked();
  await clinicianPage.close();

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

test('custom single-band and ratio rules survive reload and drive the visible reward tile', async ({ browser }) => {
  const fixture = await seedPatient({ assignedProtocol: 'beta-downtraining' });
  const clinicianPage = await browser.newPage();
  await clinicianDetail(clinicianPage, fixture);
  await openBuilder(clinicianPage);
  await clinicianPage.getByRole('checkbox', { name: 'Use clinician-defined reward criteria' }).check();
  await clinicianPage.getByRole('spinbutton', { name: 'Min Frequency', exact: true }).fill('18');
  await clinicianPage.getByRole('spinbutton', { name: 'Max Frequency', exact: true }).fill('24');
  await clinicianPage.getByRole('combobox', { name: 'Reward condition' }).selectOption('above');
  await clinicianPage.getByRole('spinbutton', { name: 'Reward threshold' }).fill('999');
  await saveBuilder(clinicianPage);
  await clinicianPage.reload();
  await arriveAtClinicianDashboard(clinicianPage);
  await clinicianPage.getByRole('row').filter({ hasText: fixture.name }).click();
  await openBuilder(clinicianPage);
  await expect(clinicianPage.getByRole('spinbutton', { name: 'Min Frequency', exact: true })).toHaveValue('18');
  await expect(clinicianPage.getByRole('spinbutton', { name: 'Max Frequency', exact: true })).toHaveValue('24');
  await expect(clinicianPage.getByRole('combobox', { name: 'Reward condition' })).toHaveValue('above');
  await expect(clinicianPage.getByRole('spinbutton', { name: 'Reward threshold' })).toHaveValue('999');
  await clinicianPage.getByRole('button', { name: 'Cancel', exact: true }).click();
  await clinicianPage.close();

  let patientPage = await browser.newPage();
  let dialog = await patientDetails(patientPage, fixture);
  await expect(detailValue(dialog, 'Min Frequency')).toContainText('18 Hz');
  await expect(detailValue(dialog, 'Max Frequency')).toContainText('24 Hz');
  await expect(detailValue(dialog, 'Reward when')).toContainText('Above 999 µV');
  await returnHome(patientPage);
  await startPatientTrainingInDemoMode(patientPage);
  await expect(pageReward(patientPage, /REWARD \(18–24 Hz\)/)).toContainText('µV');
  await expect(pageReward(patientPage, /REWARD \(18–24 Hz\)/)).toContainText('Out of zone now');
  await expect.poll(() => inZoneTrend(patientPage)).toBeLessThan(20);
  await patientPage.close();

  const directionPage = await browser.newPage();
  await clinicianDetail(directionPage, fixture);
  await openBuilder(directionPage);
  await directionPage.getByRole('combobox', { name: 'Reward condition' }).selectOption('below');
  await saveBuilder(directionPage);
  await directionPage.close();

  patientPage = await browser.newPage();
  dialog = await patientDetails(patientPage, fixture);
  await expect(detailValue(dialog, 'Reward when')).toContainText('Below 999 µV');
  await returnHome(patientPage);
  await startPatientTrainingInDemoMode(patientPage);
  await expect(pageReward(patientPage, /REWARD \(18–24 Hz\)/)).toContainText('In zone now');
  await expect.poll(() => inZoneTrend(patientPage)).toBeGreaterThan(80);
  await patientPage.close();

  // The same isolated patient switches to a clinician-defined two-band ratio.
  const secondClinicianPage = await browser.newPage();
  await clinicianDetail(secondClinicianPage, fixture);
  await openBuilder(secondClinicianPage);
  await secondClinicianPage.getByRole('button', { name: /Lubar Theta\/Beta Ratio Protocol/ }).click();
  await secondClinicianPage.getByRole('checkbox', { name: 'Use clinician-defined reward criteria' }).check();
  await secondClinicianPage.getByRole('spinbutton', { name: 'Theta Min Frequency' }).fill('5');
  await secondClinicianPage.getByRole('spinbutton', { name: 'Theta Max Frequency' }).fill('9');
  await secondClinicianPage.getByRole('spinbutton', { name: 'Beta Min Frequency' }).fill('15');
  await secondClinicianPage.getByRole('spinbutton', { name: 'Beta Max Frequency' }).fill('29');
  await secondClinicianPage.getByRole('combobox', { name: 'Reward condition' }).selectOption('below');
  await secondClinicianPage.getByRole('spinbutton', { name: 'Reward threshold' }).fill('999');
  await saveBuilder(secondClinicianPage);
  await secondClinicianPage.reload();
  await arriveAtClinicianDashboard(secondClinicianPage);
  await secondClinicianPage.getByRole('row').filter({ hasText: fixture.name }).click();
  await openBuilder(secondClinicianPage);
  await expect(secondClinicianPage.getByRole('spinbutton', { name: 'Theta Min Frequency' })).toHaveValue('5');
  await expect(secondClinicianPage.getByRole('spinbutton', { name: 'Theta Max Frequency' })).toHaveValue('9');
  await expect(secondClinicianPage.getByRole('spinbutton', { name: 'Beta Min Frequency' })).toHaveValue('15');
  await expect(secondClinicianPage.getByRole('spinbutton', { name: 'Beta Max Frequency' })).toHaveValue('29');
  await expect(secondClinicianPage.getByRole('combobox', { name: 'Reward condition' })).toHaveValue('below');
  await expect(secondClinicianPage.getByRole('spinbutton', { name: 'Reward threshold' })).toHaveValue('999');
  await secondClinicianPage.close();

  patientPage = await browser.newPage();
  dialog = await patientDetails(patientPage, fixture);
  await expect(detailValue(dialog, 'Theta Min Frequency')).toContainText('5 Hz');
  await expect(detailValue(dialog, 'Theta Max Frequency')).toContainText('9 Hz');
  await expect(detailValue(dialog, 'Beta Min Frequency')).toContainText('15 Hz');
  await expect(detailValue(dialog, 'Beta Max Frequency')).toContainText('29 Hz');
  await expect(detailValue(dialog, 'Reward condition')).toContainText('Below');
  await expect(detailValue(dialog, 'Reward threshold')).toContainText('999');
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

test('condition edits persist without changing assigned protocol or custom reward', async ({ browser }) => {
  const fixture = await seedPatient({ assignedProtocol: 'beta-downtraining' });
  const clinicianPage = await browser.newPage();
  await clinicianDetail(clinicianPage, fixture);
  await openBuilder(clinicianPage);
  await clinicianPage.getByRole('checkbox', { name: 'Use clinician-defined reward criteria' }).check();
  await clinicianPage.getByRole('spinbutton', { name: 'Reward threshold' }).fill('18');
  await saveBuilder(clinicianPage);
  await clinicianPage.getByRole('button', { name: 'Back to Patient Roster' }).click();
  await clinicianPage.getByRole('row').filter({ hasText: fixture.name }).getByTitle('Edit Patient').click();
  const edit = clinicianPage.getByRole('heading', { name: 'Edit Patient Clinical Profile' }).locator('..');
  await edit.getByText('Primary Clinical Indication').locator('..').locator('select').selectOption('Generalized Anxiety');
  await clinicianPage.getByRole('button', { name: 'Save Changes' }).click();
  await clinicianPage.reload();
  await arriveAtClinicianDashboard(clinicianPage);
  const row = clinicianPage.getByRole('row').filter({ hasText: fixture.name });
  await expect(row).toContainText('Generalized Anxiety');
  await expect(row).toContainText('Beta De-arousal Downtraining');
  await row.click();
  await expect(clinicianPage.getByRole('heading', { name: fixture.name }).locator('..').locator('..')).toContainText('Generalized Anxiety');
  await openBuilder(clinicianPage);
  await expect(clinicianPage.getByRole('checkbox', { name: 'Use clinician-defined reward criteria' })).toBeChecked();
  await expect(clinicianPage.getByRole('spinbutton', { name: 'Reward threshold' })).toHaveValue('18');
  await clinicianPage.close();
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
