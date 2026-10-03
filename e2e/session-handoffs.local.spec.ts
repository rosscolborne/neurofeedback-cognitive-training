import { expect, test } from './fixtures';
import { arriveAtPatientDashboard, loginThroughUi } from './helpers/auth';
import { seedPatient, seedReviewSession } from './helpers/localEmulator';

test('patient edits an older session journal and sees the saved note and mood after reload', async ({ browser }) => {
  const fixture = await seedPatient();
  await seedReviewSession(fixture, 'Earlier reflection');
  const context = await browser.newContext();
  try {
    const patient = await context.newPage();
    await loginThroughUi(patient, fixture.patient);
    await arriveAtPatientDashboard(patient);
    await patient.getByRole('button', { name: 'Progress', exact: true }).click();
    const card = patient.locator('.card-patient').filter({ hasText: 'NeuroGambit' }).first();
    await expect(card).toBeVisible();
    await card.click();
    await card.getByRole('button', { name: 'Edit journal' }).click();
    await card.getByLabel('Personal journal').fill('After reviewing the session, I felt calmer.');
    await card.getByLabel('Mood').selectOption('4');
    await card.getByRole('button', { name: 'Save journal' }).click();
    await expect(card.getByRole('button', { name: 'Edit journal' })).toBeVisible();
    await expect(card).toContainText('After reviewing the session, I felt calmer.');
    await patient.reload();
    await arriveAtPatientDashboard(patient);
    await patient.getByRole('button', { name: 'Progress', exact: true }).click();
    const reloadedCard = patient.locator('.card-patient').filter({ hasText: 'NeuroGambit' }).first();
    await reloadedCard.click();
    await expect(reloadedCard).toContainText('After reviewing the session, I felt calmer.');
    await expect(reloadedCard).toContainText('Focused · 4/5');
  } finally {
    await context.close();
  }
});
