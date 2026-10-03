import { expect, test } from './fixtures';
import { arriveAtPatientDashboard, loginThroughUi } from './helpers/auth';
import { seedLinkedPatient, seedReviewSession } from './helpers/localEmulator';

test('clinician feedback on one stored session reaches the patient and survives reload', async ({ browser }) => {
  const fixture = await seedLinkedPatient();
  const feedback = 'Try the slower rhythm next session.';
  // Feedback written on the older session, as the retired clinician workspace saved it.
  await seedReviewSession(fixture, 'Selected session reflection', 'neuro-gambit', Date.now() - 60_000, { clinicianNotes: feedback });
  await seedReviewSession(fixture, 'Other session reflection', 'neuro-gambit');
  const patientContext = await browser.newContext();
  try {
    const patient = await patientContext.newPage();
    await loginThroughUi(patient, fixture.patient);
    await arriveAtPatientDashboard(patient);
    await patient.getByRole('button', { name: 'Progress', exact: true }).click();
    // History is newest first, so the older selected session is the second card.
    const selectedCard = patient.locator('.card-patient').filter({ hasText: 'NeuroGambit' }).nth(1);
    await expect(selectedCard).toBeVisible();
    await selectedCard.click();
    await expect(selectedCard).toContainText('From your clinician');
    await expect(selectedCard).toContainText(feedback);
    const otherCard = patient.locator('.card-patient').filter({ hasText: 'NeuroGambit' }).first();
    await otherCard.click();
    await expect(otherCard).toContainText('Other session reflection');
    await expect(otherCard).not.toContainText(feedback);
    await patient.reload();
    await arriveAtPatientDashboard(patient);
    await patient.getByRole('button', { name: 'Progress', exact: true }).click();
    const reloadedCard = patient.locator('.card-patient').filter({ hasText: 'NeuroGambit' }).nth(1);
    await reloadedCard.click();
    await expect(reloadedCard).toContainText(feedback);
  } finally {
    await patientContext.close();
  }
});

test('patient edits an older session journal and sees the saved note and mood after reload', async ({ browser }) => {
  const fixture = await seedLinkedPatient();
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
