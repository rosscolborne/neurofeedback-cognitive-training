import { randomUUID } from 'node:crypto';
import { expect, test } from './fixtures';
import { arriveAtClinicianDashboard, arriveAtPatientDashboard, loginThroughUi } from './helpers/auth';
import { persistedMessages, seedLinkedPatient } from './helpers/localEmulator';

test('linked patient and clinician exchange persisted messages while an unrelated account is denied', async ({ browser, permissionErrorGuard }) => {
  const linked = await seedLinkedPatient();
  const unrelated = await seedLinkedPatient();
  const patientText = `Patient message ${randomUUID()}`;
  const clinicianText = `Clinician reply ${randomUUID()}`;
  const pageErrors: string[] = [];

  const patientContext = await browser.newContext();
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
    await expect(patient.getByLabel('Message your clinician')).toBeEnabled();

    await loginThroughUi(clinician, linked.clinician);
    await arriveAtClinicianDashboard(clinician);
    await clinician.getByRole('button', { name: 'Messages', exact: true }).first().click();
    await expect(clinician.getByRole('heading', { name: 'Patient Messages' })).toBeVisible();
    await clinician.getByRole('button', { name: new RegExp(`${linked.name}\\s+Open conversation`) }).click();
    await expect(clinician.getByLabel(`Message ${linked.name}`)).toBeEnabled();

    await patient.getByLabel('Message your clinician').fill(patientText);
    await patient.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(patient.getByText(patientText, { exact: true })).toBeVisible();
    await expect(clinician.getByText(patientText, { exact: true })).toBeVisible();

    await clinician.getByLabel(`Message ${linked.name}`).fill(clinicianText);
    await clinician.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(clinician.getByText(clinicianText, { exact: true })).toBeVisible();
    await expect(patient.getByText(clinicianText, { exact: true })).toBeVisible();

    await patient.reload();
    await arriveAtPatientDashboard(patient);
    await patient.getByRole('button', { name: 'Messages', exact: true }).click();
    await expect(patient.getByText(patientText, { exact: true })).toBeVisible();
    await expect(patient.getByText(clinicianText, { exact: true })).toBeVisible();

    await clinician.reload();
    await arriveAtClinicianDashboard(clinician);
    await clinician.getByRole('button', { name: 'Messages', exact: true }).first().click();
    await clinician.getByRole('button', { name: new RegExp(`${linked.name}\\s+Open conversation`) }).click();
    await expect(clinician.getByText(patientText, { exact: true })).toBeVisible();
    await expect(clinician.getByText(clinicianText, { exact: true })).toBeVisible();

    const stored = await persistedMessages(linked.patient.uid, linked.clinician.uid);
    expect(stored.summary?.lastMessageText).toBe(clinicianText);
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
    expect(Object.keys(patientProbe.reads)).toHaveLength(10);
    expect(Object.keys(clinicianProbe.reads)).toHaveLength(13);
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
