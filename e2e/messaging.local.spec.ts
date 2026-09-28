import { randomUUID } from 'node:crypto';
import { expect, test } from './fixtures';
import { arriveAtClinicianDashboard, arriveAtPatientDashboard, loginThroughUi } from './helpers/auth';
import { seedAdditionalLinkedPatient, seedLinkedPatient } from './helpers/localEmulator';
import { readPersistedMessagesAs } from './helpers/persistenceAssertions';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test('linked patient and clinician exchange persisted messages while an unrelated account is denied', async ({ browser, permissionErrorGuard }) => {
  const linked = await seedLinkedPatient();
  const unrelated = await seedLinkedPatient();
  const patientText = `Patient message ${randomUUID()}`;
  const clinicianText = `Clinician reply ${randomUUID()}`;
  const pageErrors: string[] = [];

  const patientContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const clinicianContext = await browser.newContext();
  const unrelatedContext = await browser.newContext();
  permissionErrorGuard.expectDenialsIn(unrelatedContext);
  try {
    const patient = await patientContext.newPage();
    const clinician = await clinicianContext.newPage();
    patient.on('pageerror', (error) => pageErrors.push(`patient: ${error.message}`));
    clinician.on('pageerror', (error) => pageErrors.push(`clinician: ${error.message}`));

    await loginThroughUi(patient, linked.patient);
    await arriveAtPatientDashboard(patient);
    await patient.getByRole('button', { name: 'Messages', exact: true }).click();
    await expect(patient.getByRole('heading', { name: 'Messages', exact: true })).toBeVisible();
    await expect(patient.getByRole('button', { name: 'Messages, unread message' })).toHaveCount(0);
    const patientComposer = patient.getByLabel('Message your clinician');
    await expect(patientComposer).toBeEnabled();
    await patientComposer.fill('A longer draft that wraps across multiple lines on a phone screen. '.repeat(4));
    const composerBox = await patientComposer.boundingBox();
    const navigationBox = await patient.locator('nav').last().boundingBox();
    expect(composerBox && navigationBox).toBeTruthy();
    expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(navigationBox!.y);

    await loginThroughUi(clinician, linked.clinician);
    await arriveAtClinicianDashboard(clinician);
    await expect(clinician.getByRole('button', { name: 'Messages, 0 unread conversations' }).first()).toBeVisible();
    await patientComposer.fill(patientText);
    await patient.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(patient.getByText(patientText, { exact: true })).toBeVisible();
    await expect(patient.getByRole('button', { name: 'Messages, unread message' })).toHaveCount(0);
    await expect(clinician.getByRole('button', { name: 'Messages, 1 unread conversations' }).first()).toBeVisible();
    await clinician.getByRole('button', { name: 'Messages, 1 unread conversations' }).first().click();
    await expect(clinician.getByRole('heading', { name: 'Patient Messages' })).toBeVisible();
    const patientRow = clinician.getByRole('button', { name: new RegExp(`${linked.name} Open conversation`) });
    await expect(patientRow).toContainText('Unread');
    await patientRow.click();
    await expect(clinician.getByLabel(`Message ${linked.name}`)).toBeEnabled();
    await expect(clinician.getByText(patientText, { exact: true })).toBeVisible();
    await expect(patientRow).not.toContainText('Unread');
    await expect(clinician.getByRole('button', { name: 'Messages, 0 unread conversations' }).first()).toBeVisible();

    await patient.getByRole('button', { name: 'Home', exact: true }).click();
    await clinician.getByLabel(`Message ${linked.name}`).fill(clinicianText);
    await clinician.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(clinician.getByText(clinicianText, { exact: true })).toBeVisible();
    await expect(clinician.getByRole('button', { name: 'Messages, 0 unread conversations' }).first()).toBeVisible();
    await expect(patientRow).not.toContainText('Unread');
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

    await clinician.reload();
    await arriveAtClinicianDashboard(clinician);
    await expect(clinician.getByRole('button', { name: 'Messages, 0 unread conversations' }).first()).toBeVisible();
    await clinician.getByRole('button', { name: 'Messages, 0 unread conversations' }).first().click();
    await clinician.getByRole('button', { name: new RegExp(`${linked.name}\\s+Open conversation`) }).click();
    await expect(clinician.getByText(patientText, { exact: true })).toBeVisible();
    await expect(clinician.getByText(clinicianText, { exact: true })).toBeVisible();

    const stored = await readPersistedMessagesAs(patient, clinician, linked.patient.uid, linked.clinician.uid);
    expect(stored.summary?.lastMessageText).toBe(clinicianText);
    expect(stored.clinicianRead?.lastReadMessageId).toBe(stored.messages.find((message) => message.text === patientText)?.id);
    expect(stored.patientRead?.lastReadMessageId).toBe(stored.messages.find((message) => message.text === clinicianText)?.id);
    expect(stored.messages.map((message) => [message.text, message.senderRole])).toEqual(expect.arrayContaining([
      [patientText, 'patient'], [clinicianText, 'clinician'],
    ]));

    // Exercise the deployed-rules read probe against this existing local pair.
    // The probe itself creates no documents or identities.
    const patientProbe = await patient.evaluate(async (clinicianId) => {
      const probes = await import('/e2e/helpers/firestoreProbe.ts');
      return probes.probePatientBranchRuleReads(clinicianId);
    }, linked.clinician.uid);
    const clinicianProbe = await clinician.evaluate(async ({ patientId, hasReadableLegacyMessageHistory }) => {
      const probes = await import('/e2e/helpers/firestoreProbe.ts');
      return probes.probeClinicianBranchRuleReads(patientId, hasReadableLegacyMessageHistory);
    }, { patientId: linked.patient.uid, hasReadableLegacyMessageHistory: patientProbe.hasReadableLegacyMessageHistory });
    expect(Object.keys(patientProbe.reads)).toHaveLength(11);
    expect(Object.keys(clinicianProbe.reads)).toHaveLength(17);
    expect(patientProbe.hasReadableLegacyMessageHistory).toBe(false);
    expect(clinicianProbe.hasExistingInvitation).toBe(false);
    for (const reads of [patientProbe.reads, clinicianProbe.reads]) {
      expect(reads).toEqual(Object.fromEntries(Object.keys(reads).map((name) => [name, 'allowed'])));
    }

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
    await Promise.allSettled([patientContext.close(), clinicianContext.close(), unrelatedContext.close()]);
  }
});

test('two unread patient conversations show badge 2 even when one patient sends twice', async ({ browser }) => {
  const first = await seedLinkedPatient();
  const second = await seedAdditionalLinkedPatient(first);
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const clinicianContext = await browser.newContext();
  try {
    for (const [context, fixture, texts] of [
      [firstContext, first, ['First patient message', 'First patient follow-up']],
      [secondContext, second, ['Second patient message']],
    ] as const) {
      const patient = await context.newPage();
      await loginThroughUi(patient, fixture.patient);
      await arriveAtPatientDashboard(patient);
      await patient.getByRole('button', { name: 'Messages', exact: true }).click();
      for (const message of texts) {
        await patient.getByLabel('Message your clinician').fill(message);
        await patient.getByRole('button', { name: 'Send', exact: true }).click();
        await expect(patient.getByText(message, { exact: true })).toBeVisible();
      }
    }

    const clinician = await clinicianContext.newPage();
    await loginThroughUi(clinician, first.clinician);
    await arriveAtClinicianDashboard(clinician);
    const messagesTab = clinician.getByRole('button', { name: 'Messages, 2 unread conversations' }).first();
    await expect(messagesTab).toBeVisible();
    await messagesTab.click();
    await expect(clinician.getByRole('button', { name: new RegExp(`${first.name} Open conversation`) })).toContainText('Unread');
    await expect(clinician.getByRole('button', { name: new RegExp(`${second.name} Open conversation`) })).toContainText('Unread');
  } finally {
    await Promise.allSettled([firstContext.close(), secondContext.close(), clinicianContext.close()]);
  }
});
