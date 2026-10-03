import { randomUUID } from 'node:crypto';
import { expect, test } from './fixtures';
import { arriveAtPatientDashboard, loginThroughUi } from './helpers/auth';
import { seedClinicianMessage, seedLinkedPatient } from './helpers/localEmulator';
import { readPersistedMessagesAs } from './helpers/persistenceAssertions';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

// The clinician side of a conversation is seeded with the Admin SDK, as the clinician workspace is retired.
test('a linked patient sends and receives persisted messages while an unrelated account is denied', async ({ browser, permissionErrorGuard }) => {
  const linked = await seedLinkedPatient();
  const unrelated = await seedLinkedPatient();
  const patientText = `Patient message ${randomUUID()}`;
  const clinicianText = `Clinician reply ${randomUUID()}`;
  const pageErrors: string[] = [];

  const patientContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const unrelatedContext = await browser.newContext();
  permissionErrorGuard.expectDenialsIn(unrelatedContext);
  try {
    const patient = await patientContext.newPage();
    patient.on('pageerror', (error) => pageErrors.push(`patient: ${error.message}`));

    await loginThroughUi(patient, linked.patient);
    await arriveAtPatientDashboard(patient);
    await patient.getByRole('button', { name: 'Messages', exact: true }).click();
    await expect(patient.getByRole('heading', { name: 'Messages', exact: true })).toBeVisible();
    await expect(patient.getByRole('button', { name: 'Messages, unread message' })).toHaveCount(0);
    const patientComposer = patient.getByLabel('Message your clinician');
    await expect(patientComposer).toBeEnabled();
    await patientComposer.fill('A longer draft that wraps across multiple lines on a phone screen. '.repeat(4));
    // While typing on a phone the tab bar steps aside for the keyboard; once focus leaves, the
    // wrapped draft still sits above the tab bar rather than under it.
    await expect(patient.locator('nav').last()).toBeHidden();
    await patientComposer.blur();
    await expect(patient.locator('nav').last()).toBeVisible();
    const composerBox = await patientComposer.boundingBox();
    const navigationBox = await patient.locator('nav').last().boundingBox();
    expect(composerBox && navigationBox).toBeTruthy();
    expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(navigationBox!.y);

    await patientComposer.fill(patientText);
    await patient.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(patient.getByText(patientText, { exact: true })).toBeVisible();
    await expect(patient.getByRole('button', { name: 'Messages, unread message' })).toHaveCount(0);

    await patient.getByRole('button', { name: 'Home', exact: true }).click();
    const clinicianMessageId = await seedClinicianMessage(linked, clinicianText);
    await expect(patient.getByRole('button', { name: 'Messages, unread message' })).toBeVisible();
    await patient.getByRole('button', { name: 'Messages, unread message' }).click();
    await expect(patient.getByText(clinicianText, { exact: true })).toBeVisible();
    await expect(patient.getByRole('button', { name: 'Messages', exact: true })).toBeVisible();
    await expect(patient.getByRole('button', { name: 'Messages, unread message' })).toHaveCount(0);

    await patient.reload();
    await arriveAtPatientDashboard(patient);
    await expect(patient.getByRole('button', { name: 'Messages, unread message' })).toHaveCount(0);
    await patient.getByRole('button', { name: 'Messages', exact: true }).click();
    await expect(patient.getByText(patientText, { exact: true })).toBeVisible();
    await expect(patient.getByText(clinicianText, { exact: true })).toBeVisible();

    const stored = await readPersistedMessagesAs(patient, linked.patient.uid, linked.clinician.uid);
    expect(stored.summary?.lastMessageText).toBe(clinicianText);
    expect(stored.patientRead?.lastReadMessageId).toBe(clinicianMessageId);
    expect(stored.messages.map((message) => [message.text, message.senderRole])).toEqual(expect.arrayContaining([
      [patientText, 'patient'], [clinicianText, 'clinician'],
    ]));

    // Exercise the patient's read probe against this existing local pair.
    // The probe itself creates no documents or identities.
    const patientProbe = await patient.evaluate(async (clinicianId) => {
      const probes = await import('/e2e/helpers/firestoreProbe.ts');
      return probes.probePatientBranchRuleReads(clinicianId);
    }, linked.clinician.uid);
    expect(Object.keys(patientProbe.reads)).toHaveLength(11);
    expect(patientProbe.hasReadableLegacyMessageHistory).toBe(false);
    expect(patientProbe.reads).toEqual(Object.fromEntries(Object.keys(patientProbe.reads).map((name) => [name, 'allowed'])));

    const outsider = await unrelatedContext.newPage();
    await loginThroughUi(outsider, unrelated.patient);
    await arriveAtPatientDashboard(outsider);
    const denial = await outsider.evaluate(async ({ patientId, clinicianId }) => {
      const probes = await import('/e2e/helpers/firestoreProbe.ts');
      return probes.probeMessageThreadRead(patientId, clinicianId);
    }, { patientId: linked.patient.uid, clinicianId: linked.clinician.uid });
    expect(denial).toBe('permission-denied');
    expect(pageErrors).toEqual([]);
  } finally {
    await Promise.allSettled([patientContext.close(), unrelatedContext.close()]);
  }
});
