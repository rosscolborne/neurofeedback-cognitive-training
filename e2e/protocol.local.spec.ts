import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { startPatientTrainingInDemoMode } from './helpers/auth';
import { completeConsumerOnboarding, consumerHome, signUpFreshAccountThroughUi } from './helpers/journeys';

// The consumer EEG boundary: there are no EEG protocols, reward bands or
// calibration anywhere in the app. EEG gives two metrics, BrainFlow's
// mindfulness and restfulness (simulated in Demo Mode), and NeuroGambit reads
// one composure value derived from them.

async function signUpFreshConsumer(page: Page, prefix: string) {
  await signUpFreshAccountThroughUi(page, {
    displayName: 'Consumer EEG',
    email: `${prefix}-${randomUUID().slice(0, 12)}@example.test`,
    password: 'LocalEmulator!123',
  });
  await completeConsumerOnboarding(page);
}

function telemetryCell(page: Page, label: string) {
  return page.locator('.session-telemetry > div').filter({ has: page.getByText(label, { exact: true }) });
}

async function telemetryValue(page: Page, label: string): Promise<number> {
  const text = await telemetryCell(page, label).locator('.session-telemetry-value').innerText();
  return Number(text);
}

async function composure(page: Page): Promise<number> {
  const text = await page.getByText(/^Composure \d+\.\d+×$/).innerText();
  return Number(text.match(/(\d+\.\d+)/)![1]);
}

/** EEG-protocol and calibration language that must not reach a consumer screen. */
const PROTOCOL_TERMS = /protocol|theta|beta|alpha|SMR|in zone|target zone|reward|calibrat|neural imprint|baseline/i;

test('a fresh consumer sees no EEG protocol or calibration, and headset setup is pairing and fit only', async ({ browser }) => {
  const page = await browser.newPage();
  try {
    await signUpFreshConsumer(page, 'consumer-eeg-setup');

    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await expect(consumerHome(page)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Protocol:/ })).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText(PROTOCOL_TERMS);

    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Neural Imprint' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'View Protocol Details' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Change Training Setup' })).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText(PROTOCOL_TERMS);

    // Headset setup pairs and checks fit; there is no calibration to run.
    await page.getByRole('button', { name: /Set Up Headset/ }).click();
    await expect(page.getByRole('heading', { name: 'Connect your Muse Headband', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pair Muse Headband' })).toBeEnabled();
    await expect(page.locator('body')).not.toContainText(PROTOCOL_TERMS);
    await page.getByRole('button', { name: 'Skip to Dashboard', exact: true }).click();
    await expect(consumerHome(page)).toBeVisible();
  } finally {
    await page.close();
  }
});

test('a Demo NeuroGambit session shows simulated mindfulness and restfulness that drive composure, and saves without in-zone data', async ({ browser }) => {
  const page = await browser.newPage();
  try {
    await signUpFreshConsumer(page, 'consumer-eeg-demo');
    await startPatientTrainingInDemoMode(page, 'NeuroGambit');

    // NeuroGambit starts at once: no calibration, and the session shows only the two consumer metrics.
    await expect(page.getByRole('group', { name: 'Training track' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Calibrate|Standard Baseline/ })).toHaveCount(0);
    await expect(telemetryCell(page, 'Mindfulness')).toContainText('Simulated');
    await expect(telemetryCell(page, 'Restfulness')).toContainText('Simulated');
    await expect(page.locator('.session-telemetry > div')).toHaveCount(2);
    await expect(page.locator('body')).not.toContainText(/in zone|target adjusted|theta|beta|µV/i);

    // The demo state moves both metrics, and NeuroGambit's composure follows them.
    const controls = page.getByRole('region', { name: 'Demo state controls' });
    await controls.getByRole('button', { name: 'Focus', exact: true }).click();
    await expect.poll(() => telemetryValue(page, 'Mindfulness')).toBeGreaterThanOrEqual(65);
    await expect.poll(() => composure(page)).toBeGreaterThanOrEqual(1.1);

    await controls.getByRole('button', { name: 'Drift', exact: true }).click();
    await expect.poll(() => telemetryValue(page, 'Mindfulness')).toBeLessThanOrEqual(40);
    await expect.poll(() => telemetryValue(page, 'Restfulness')).toBeLessThanOrEqual(40);
    await expect.poll(() => composure(page)).toBeLessThanOrEqual(0.7);

    // Saving records duration and simulated mindfulness, never time in zone or a protocol.
    await page.getByRole('button', { name: 'End Session & Save', exact: true }).click();
    await expect(page.getByText(/^You trained for /)).not.toContainText(/zone/i);
    await page.getByRole('button', { name: 'Save & View Summary', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Session Complete', level: 1 })).toBeVisible();
    await expect(page.getByText('Training Demo — these results are simulated, not measured EEG.')).toBeVisible();
    await expect(page.getByText('Simulated mindfulness', { exact: true })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(PROTOCOL_TERMS);

    const saved = await page.evaluate(async () => {
      const { auth } = await import('/src/services/firebase.ts');
      const { storageEngine } = await import('/src/services/storageEngine.ts');
      if (!auth.currentUser) throw new Error('Expected a signed-in consumer');
      const [session] = await storageEngine.getSessions(auth.currentUser.uid);
      return session;
    });
    expect(saved).toMatchObject({ experience: 'neuro-gambit', isDemo: true });
    expect(typeof saved.averageMindfulness).toBe('number');
    for (const legacyField of ['protocol', 'timeInZonePercent', 'inZoneSeconds', 'averageBands', 'averageCoherence', 'timeSeries', 'finalThreshold', 'adaptiveAdjustmentsCount']) {
      expect(saved, `a new session must not store ${legacyField}`).not.toHaveProperty(legacyField);
    }
  } finally {
    await page.close();
  }
});
