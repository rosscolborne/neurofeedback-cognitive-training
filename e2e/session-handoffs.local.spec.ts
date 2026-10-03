import { expect, test } from './fixtures';
import { arriveAtClinicianDashboard, arriveAtPatientDashboard, loginThroughUi } from './helpers/auth';
import { readReviewSessionFeedback, seedLinkedPatient, seedReviewSession } from './helpers/localEmulator';

test('clinician opens the selected stored session and its feedback reaches the patient after reload', async ({ browser }) => {
  const fixture = await seedLinkedPatient();
  const selectedId = await seedReviewSession(fixture, 'Selected session reflection', 'neuro-gambit', Date.now() - 60_000);
  const otherId = await seedReviewSession(fixture, 'Other session reflection', 'neuro-gambit');
  const clinicianContext = await browser.newContext();
  const patientContext = await browser.newContext();
  try {
    const clinician = await clinicianContext.newPage();
    await loginThroughUi(clinician, fixture.clinician);
    await arriveAtClinicianDashboard(clinician);
    await clinician.getByRole('row').filter({ hasText: fixture.name }).click();
    await clinician.getByRole('button', { name: 'Session Logs (2)' }).click();
    await clinician.getByRole('button', { name: `Open ${selectedId}` }).click();
    const detail = clinician.getByRole('region', { name: `Session ${selectedId} details` });
    await expect(detail).toContainText('Selected session reflection');
    await expect(detail).not.toContainText('Other session reflection');
    await expect(clinician.getByRole('button', { name: `Open ${otherId}` })).toBeVisible();
    const feedback = 'Try the slower rhythm next session.';
    await detail.getByLabel('Clinician feedback').fill(feedback);
    await detail.getByRole('button', { name: 'Save feedback' }).click();
    await expect.poll(() => readReviewSessionFeedback(selectedId)).toBe(feedback);
    await expect.poll(() => readReviewSessionFeedback(otherId)).toBeUndefined();
    await clinician.getByRole('button', { name: `Open ${otherId}` }).click();
    await expect(clinician.getByRole('region', { name: `Session ${otherId} details` })).not.toContainText(feedback);

    const patient = await patientContext.newPage();
    await loginThroughUi(patient, fixture.patient);
    await arriveAtPatientDashboard(patient);
    await patient.getByRole('button', { name: 'Progress', exact: true }).click();
    // History is newest first, so the older selected session is the second card.
    const selectedCard = patient.locator('.card-patient').filter({ hasText: 'NeuroGambit' }).nth(1);
    await expect(selectedCard).toBeVisible();
    await selectedCard.click();
    await expect(selectedCard).toContainText('From your clinician');
    await expect(selectedCard).toContainText('Try the slower rhythm next session.');
    await patient.reload();
    await arriveAtPatientDashboard(patient);
    await patient.getByRole('button', { name: 'Progress', exact: true }).click();
    const reloadedCard = patient.locator('.card-patient').filter({ hasText: 'NeuroGambit' }).nth(1);
    await reloadedCard.click();
    await expect(reloadedCard).toContainText('Try the slower rhythm next session.');
  } finally {
    await Promise.allSettled([clinicianContext.close(), patientContext.close()]);
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
