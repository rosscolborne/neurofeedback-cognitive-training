import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect, test } from './helpers/statefulFixture';
import { arriveAtClinicianDashboard, arriveAtPatientDashboard, authenticatedFirebaseIdentity, storageStatePath } from './helpers/auth';
import { prepareE2EPatientForInvitation, statefulRunRequested, type E2EPairRun } from './helpers/dataLifecycle';
import {
    expectAppointmentPersisted,
    expectClinicBrandPersisted,
    expectInvitationAcceptedPersisted,
    expectMessagesPersisted,
} from './helpers/persistenceAssertions';

const patientState = storageStatePath.patient;
const clinicianState = storageStatePath.clinician;

/** Text written through the UI carries the run marker, which is the cleanup evidence. */
function runLabel(run: E2EPairRun, purpose: string): string {
    return `${run.runMarker}-${purpose}-${Math.random().toString(36).slice(2, 8)}`;
}

async function openAuthenticatedPage(browser: Browser, storageState: string): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    await page.goto('/');
    return { context, page };
}

async function openClinicianDashboard(page: Page): Promise<void> {
    await page.goto('/');
    await arriveAtClinicianDashboard(page);
}

async function openPatientDashboard(page: Page): Promise<void> {
    await page.goto('/');
    await arriveAtPatientDashboard(page);
}

async function dedicatedPatientName(page: Page): Promise<string> {
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    const patientName = (await page.getByRole('heading', { level: 2 }).first().innerText()).trim();
    expect(patientName, 'The dedicated E2E patient profile must have a display name').not.toBe('');
    return patientName;
}

async function selectDedicatedPatient(page: Page, patientName: string): Promise<void> {
    await page.getByRole('button', { name: 'Patients', exact: true }).click();
    await page.getByPlaceholder('Search patients, email, conditions...').fill(patientName);

    const patientRow = page.getByRole('row').filter({ hasText: patientName });
    await expect(patientRow, 'The dedicated E2E patient must already be linked to the clinician').toHaveCount(1);
    await patientRow.click();
    await expect(page.getByRole('heading', { name: patientName, exact: true })).toBeVisible();
}

async function openClinicianConversation(page: Page, patientName: string): Promise<void> {
    await page.getByRole('button', { name: 'Messages', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(`^${escapeRegExp(patientName)}\\s+Open conversation$`) }).click();
    await expect(page.getByLabel(`Message ${patientName}`, { exact: true })).toBeEnabled();
}

async function openPatientMessages(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Messages', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Messages', exact: true })).toBeVisible();
    await expect(page.getByLabel('Message your clinician', { exact: true })).toBeEnabled();
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test.describe('linked clinician and patient collaboration (stateful)', () => {
    test.describe.configure({ mode: 'serial' });
    test.skip(!statefulRunRequested(), 'Stateful: run through npm run test:e2e:stateful:clinician.');

    test('clinician invitation and patient acceptance persist the roster and clinic relationship after reload', async ({ browser, stateful }) => {
        const patientEmail = process.env.E2E_PATIENT_EMAIL;
        expect(patientEmail, 'The E2E session must supply E2E_PATIENT_EMAIL for the signed-in patient.').toBeTruthy();

        const clinician = await openAuthenticatedPage(browser, clinicianState);
        const patient = await openAuthenticatedPage(browser, patientState);
        let run: E2EPairRun | undefined;

        try {
            await arriveAtClinicianDashboard(clinician.page);
            await arriveAtPatientDashboard(patient.page);
            const patientIdentity = await authenticatedFirebaseIdentity(patient.page);
            const clinicianIdentity = await authenticatedFirebaseIdentity(clinician.page);
            run = await stateful.beginPairRun(patientIdentity, clinicianIdentity, { restoreClinic: true });
            const clinicBrandName = `E2E Clinic ${run.runMarker.slice(-8)}`;
            await clinician.page.getByRole('button', { name: 'Clinic Theme Settings', exact: true }).click();
            const brandingPanel = clinician.page
                .getByRole('heading', { name: 'Clinic Branding & Theme Customizer', exact: true })
                .locator('../..');
            await brandingPanel.getByText('Clinic Display Name', { exact: true }).locator('..').locator('input').fill(clinicBrandName);
            await brandingPanel.getByText('Clinic Tagline', { exact: true }).locator('..').locator('input').fill('Dedicated E2E clinic');
            await brandingPanel.getByRole('button', { name: 'Save and apply clinic branding', exact: true }).click();
            await expect(clinician.page.getByRole('heading', { name: 'Clinic Branding & Theme Customizer', exact: true })).toBeHidden();
            await expect(clinician.page.getByText(clinicBrandName, { exact: true }).first()).toBeVisible();
            await expectClinicBrandPersisted(run, patient.page, clinician.page, clinicBrandName);
            await clinician.page.reload();
            await arriveAtClinicianDashboard(clinician.page);
            await expect(clinician.page.getByText(clinicBrandName, { exact: true }).first()).toBeVisible();

            await prepareE2EPatientForInvitation(run);

            await clinician.page.reload();
            await arriveAtClinicianDashboard(clinician.page);
            await clinician.page.getByPlaceholder('Search patients, email, conditions...').fill(patientEmail!);
            await expect(clinician.page.getByRole('row').filter({ hasText: patientEmail! })).toHaveCount(0);

            await patient.page.reload();
            await arriveAtPatientDashboard(patient.page);
            // WB-102: without an invitation link there is no Connect control.
            await expect(patient.page.getByRole('button', { name: 'Connect to Clinician', exact: true })).toHaveCount(0);

            await clinician.page.getByRole('button', { name: 'Invite Patient', exact: true }).click();
            const invitePanel = clinician.page.getByRole('heading', { name: 'Invite Patient', exact: true }).locator('..');
            await invitePanel.getByPlaceholder('e.g. Alex Morgan', { exact: true }).fill(`E2E ${run.runMarker}`);
            await invitePanel.getByPlaceholder('patient@example.com', { exact: true }).fill(patientEmail!);
            await invitePanel.getByText('Primary Clinical Indication', { exact: true }).locator('..').locator('select').selectOption('ADHD (Inattentive)');
            await invitePanel.getByText('Assigned Protocol', { exact: true }).locator('..').locator('select').selectOption('theta-beta-ratio');
            await invitePanel.getByPlaceholder('e.g. 3', { exact: true }).fill('3');
            await invitePanel.getByRole('button', { name: 'Create Invitation', exact: true }).click();

            const createdPanel = clinician.page.getByRole('heading', { name: 'Invitation created', exact: true }).locator('..');
            const invitationCode = (await createdPanel.getByText(/^[A-Za-z0-9_-]{6,}$/).first().innerText()).trim();
            expect(invitationCode).toMatch(/^[A-Za-z0-9_-]+$/);
            await createdPanel.getByRole('button', { name: 'Done', exact: true }).click();

            // The new pending invitation is what makes Connect available again.
            await patient.page.reload();
            await arriveAtPatientDashboard(patient.page);
            await patient.page.getByRole('button', { name: 'Connect to Clinician', exact: true }).click();
            await patient.page.getByLabel('Invitation code', { exact: true }).fill(invitationCode);
            await patient.page.getByRole('button', { name: 'Accept Invitation', exact: true }).click();
            await patient.page.getByRole('button', { name: 'Profile', exact: true }).click();
            await expect(patient.page.getByText('Connected to your clinician', { exact: true })).toBeVisible({ timeout: 15_000 });
            await expectInvitationAcceptedPersisted(run, patient.page, clinician.page, invitationCode);

            await patient.page.reload();
            await arriveAtPatientDashboard(patient.page);
            await expect(patient.page.getByText('Connected to your clinician', { exact: true })).toBeVisible();

            await clinician.page.reload();
            await arriveAtClinicianDashboard(clinician.page);
            await clinician.page.getByPlaceholder('Search patients, email, conditions...').fill(patientEmail!);
            await expect(clinician.page.getByRole('row').filter({ hasText: patientEmail! })).toHaveCount(1);

            await patient.page.reload();
            await arriveAtPatientDashboard(patient.page);
            await expect(patient.page.getByText(clinicBrandName, { exact: true }).first()).toBeVisible();
        } finally {
            await Promise.allSettled([clinician.context.close(), patient.context.close()]);
        }
    });

    test('linked roster, brand state, honest clinical states, and messages persist in both accounts', async ({ browser, stateful }) => {
        const clinician = await openAuthenticatedPage(browser, clinicianState);
        const patient = await openAuthenticatedPage(browser, patientState);
        let run: E2EPairRun | undefined;

        try {
            await arriveAtClinicianDashboard(clinician.page);
            await arriveAtPatientDashboard(patient.page);
            const patientName = await dedicatedPatientName(patient.page);
            run = await stateful.beginPairRun(
                await authenticatedFirebaseIdentity(patient.page),
                await authenticatedFirebaseIdentity(clinician.page),
            );
            const clinicianMessage = runLabel(run, 'clinician-message');
            const patientMessage = runLabel(run, 'patient-message');
            await selectDedicatedPatient(clinician.page, patientName);

            await clinician.page.getByRole('button', { name: 'Live Telemetry', exact: true }).click();
            await expect(clinician.page.getByText('Not connected — no active patient telemetry source is available in this clinician view.', { exact: true })).toBeVisible();
            await expect(clinician.page.getByText('Waveform / sample rate / packet loss', { exact: true })).toBeVisible();
            await expect(clinician.page.getByText('Unavailable', { exact: true }).last()).toBeVisible();

            await clinician.page.getByRole('button', { name: /^QEEG Records/ }).click();
            await expect(clinician.page.getByText('Loading saved QEEG records…', { exact: true })).toBeHidden();
            const emptyQeeg = clinician.page.getByText('No QEEG measurements have been entered for this patient.', { exact: true });
            const persistedQeeg = clinician.page.getByText(/^Recorded (?!date unavailable)/).first();
            await expect(emptyQeeg.or(persistedQeeg)).toBeVisible();

            await clinician.page.getByRole('button', { name: 'Reports', exact: true }).click();
            await expect(clinician.page.getByText('Loading persisted sessions… Report measurements and exports are unavailable until loading completes.', { exact: true })).toBeHidden();
            await expect(clinician.page.getByRole('row').filter({ hasText: patientName })).toBeVisible();
            const last90Days = clinician.page.getByRole('button', { name: 'Last 90 Days', exact: true });
            const yearToDate = clinician.page.getByRole('button', { name: 'YTD', exact: true });
            const interval = clinician.page.getByText(/^Interval:/);
            await expect(interval).toContainText('Last 30 days');
            await last90Days.click();
            await expect(interval).toContainText('Last 90 days');
            await yearToDate.click();
            await expect(interval).toContainText('Year to date');
            await expect(clinician.page.getByText('not a clinical outcome or significance claim.', { exact: false }).or(
                clinician.page.getByText('Needs at least two sessions with a recorded in-zone measurement.', { exact: true }),
            )).toBeVisible();

            await clinician.page.getByRole('button', { name: 'Settings', exact: true }).click();
            const clinicNameInput = clinician.page.getByLabel('Clinic name', { exact: true });
            await expect(clinicNameInput).toBeEnabled();
            const clinicName = await clinicNameInput.inputValue();
            await clinician.page.reload();
            await arriveAtClinicianDashboard(clinician.page);
            await clinician.page.getByRole('button', { name: 'Settings', exact: true }).click();
            await expect(clinician.page.getByLabel('Clinic name', { exact: true })).toBeEnabled();
            await expect(clinician.page.getByLabel('Clinic name', { exact: true })).toHaveValue(clinicName);

            await openPatientDashboard(patient.page);
            await expect(patient.page.getByText('Connected to your clinician', { exact: true })).toBeVisible();
            if (clinicName.trim()) {
                await expect(patient.page.getByText(clinicName, { exact: true }).first()).toBeVisible();
            } else {
                await expect(patient.page.getByText('Waveable', { exact: true }).first()).toBeVisible();
            }
            await patient.page.reload();
            await arriveAtPatientDashboard(patient.page);
            await expect(patient.page.getByText(clinicName.trim() || 'Waveable', { exact: true }).first()).toBeVisible();

            await openClinicianDashboard(clinician.page);
            await openClinicianConversation(clinician.page, patientName);
            await clinician.page.getByLabel(`Message ${patientName}`, { exact: true }).fill(clinicianMessage);
            await clinician.page.getByRole('button', { name: 'Send', exact: true }).click();
            await expect(clinician.page.getByText(clinicianMessage, { exact: true })).toBeVisible();
            await expectMessagesPersisted(run, patient.page, clinician.page, [{ text: clinicianMessage, senderRole: 'clinician' }]);

            await patient.page.reload();
            await arriveAtPatientDashboard(patient.page);
            await openPatientMessages(patient.page);
            await expect(patient.page.getByText(clinicianMessage, { exact: true })).toBeVisible();
            await patient.page.getByLabel('Message your clinician', { exact: true }).fill(patientMessage);
            await patient.page.getByRole('button', { name: 'Send', exact: true }).click();
            await expect(patient.page.getByText(patientMessage, { exact: true })).toBeVisible();
            await expectMessagesPersisted(run, patient.page, clinician.page, [
                { text: clinicianMessage, senderRole: 'clinician' },
                { text: patientMessage, senderRole: 'patient' },
            ]);

            await patient.page.reload();
            await arriveAtPatientDashboard(patient.page);
            await openPatientMessages(patient.page);
            await expect(patient.page.getByText(clinicianMessage, { exact: true })).toBeVisible();
            await expect(patient.page.getByText(patientMessage, { exact: true })).toBeVisible();

            await clinician.page.reload();
            await arriveAtClinicianDashboard(clinician.page);
            await openClinicianConversation(clinician.page, patientName);
            await expect(clinician.page.getByText(clinicianMessage, { exact: true })).toBeVisible();
            await expect(clinician.page.getByText(patientMessage, { exact: true })).toBeVisible();
        } finally {
            await Promise.allSettled([clinician.context.close(), patient.context.close()]);
        }
    });

    test('appointment creation, edit, and cancellation are observed by both accounts after reload', async ({ browser, stateful }) => {
        const clinician = await openAuthenticatedPage(browser, clinicianState);
        const patient = await openAuthenticatedPage(browser, patientState);
        let run: E2EPairRun | undefined;

        try {
            await arriveAtClinicianDashboard(clinician.page);
            await arriveAtPatientDashboard(patient.page);
            const patientName = await dedicatedPatientName(patient.page);
            run = await stateful.beginPairRun(
                await authenticatedFirebaseIdentity(patient.page),
                await authenticatedFirebaseIdentity(clinician.page),
            );
            const appointmentLabel = runLabel(run, 'appointment');
            const editedLabel = `${appointmentLabel}-edited`;
            await selectDedicatedPatient(clinician.page, patientName);
            await clinician.page.getByRole('button', { name: 'Calendar', exact: true }).click();
            await clinician.page.getByRole('button', { name: 'Schedule appointment', exact: true }).click();

            const createDialog = clinician.page.getByRole('dialog', { name: 'Schedule appointment' });
            await createDialog.getByLabel('Patient', { exact: true }).selectOption({ label: patientName });
            await createDialog.getByLabel('Date', { exact: true }).fill(futureDate(45));
            await createDialog.getByLabel('Local time', { exact: true }).fill('11:20');
            await createDialog.getByLabel('Timezone', { exact: true }).fill('America/Toronto');
            await createDialog.getByLabel('Duration (minutes)', { exact: true }).fill('45');
            await createDialog.getByLabel('Type', { exact: true }).selectOption('remote-training');
            await createDialog.getByLabel('Notes', { exact: true }).fill(appointmentLabel);
            await createDialog.getByRole('button', { name: 'Create appointment', exact: true }).click();

            let clinicianAppointment = clinician.page.getByRole('article').filter({ hasText: appointmentLabel });
            await expect(clinicianAppointment).toHaveCount(1);
            await expect(clinicianAppointment.getByText('scheduled', { exact: true })).toBeVisible();
            await expectAppointmentPersisted(run, patient.page, clinician.page, { notes: appointmentLabel, status: 'scheduled', durationMinutes: 45, type: 'remote-training' });

            await clinician.page.reload();
            await arriveAtClinicianDashboard(clinician.page);
            await clinician.page.getByRole('button', { name: 'Calendar', exact: true }).click();
            clinicianAppointment = clinician.page.getByRole('article').filter({ hasText: appointmentLabel });
            await expect(clinicianAppointment).toHaveCount(1);

            await openPatientDashboard(patient.page);
            await patient.page.getByRole('button', { name: 'Visits', exact: true }).click();
            let patientAppointment = patient.page.getByRole('article').filter({ hasText: appointmentLabel });
            await expect(patientAppointment).toHaveCount(1);
            await expect(patientAppointment.getByText('scheduled', { exact: true })).toBeVisible();

            await clinicianAppointment.getByRole('button', { name: 'Edit', exact: true }).click();
            const editDialog = clinician.page.getByRole('dialog', { name: 'Edit appointment' });
            await editDialog.getByLabel('Duration (minutes)', { exact: true }).fill('60');
            await editDialog.getByLabel('Type', { exact: true }).selectOption('protocol-review');
            await editDialog.getByLabel('Notes', { exact: true }).fill(editedLabel);
            await editDialog.getByRole('button', { name: 'Save changes', exact: true }).click();
            clinicianAppointment = clinician.page.getByRole('article').filter({ hasText: editedLabel });
            await expect(clinicianAppointment).toContainText('Protocol review');
            await expect(clinicianAppointment).toContainText('60 min');
            await expectAppointmentPersisted(run, patient.page, clinician.page, { notes: editedLabel, status: 'scheduled', durationMinutes: 60, type: 'protocol-review' });

            await patient.page.reload();
            await arriveAtPatientDashboard(patient.page);
            await patient.page.getByRole('button', { name: 'Visits', exact: true }).click();
            patientAppointment = patient.page.getByRole('article').filter({ hasText: editedLabel });
            await expect(patientAppointment).toHaveCount(1);
            await expect(patientAppointment).toContainText('protocol review');
            await expect(patientAppointment).toContainText('60 min');

            await clinician.page.reload();
            await arriveAtClinicianDashboard(clinician.page);
            await clinician.page.getByRole('button', { name: 'Calendar', exact: true }).click();
            clinicianAppointment = clinician.page.getByRole('article').filter({ hasText: editedLabel });
            clinician.page.once('dialog', (dialog) => dialog.accept());
            await clinicianAppointment.getByRole('button', { name: 'Cancel', exact: true }).click();
            await expect(clinicianAppointment.getByText('cancelled', { exact: true })).toBeVisible();
            await expectAppointmentPersisted(run, patient.page, clinician.page, { notes: editedLabel, status: 'cancelled', durationMinutes: 60, type: 'protocol-review' });

            await clinician.page.reload();
            await arriveAtClinicianDashboard(clinician.page);
            await clinician.page.getByRole('button', { name: 'Calendar', exact: true }).click();
            clinicianAppointment = clinician.page.getByRole('article').filter({ hasText: editedLabel });
            await expect(clinicianAppointment.getByText('cancelled', { exact: true })).toBeVisible();

            await patient.page.reload();
            await arriveAtPatientDashboard(patient.page);
            await patient.page.getByRole('button', { name: 'Visits', exact: true }).click();
            patientAppointment = patient.page.getByRole('article').filter({ hasText: editedLabel });
            await expect(patientAppointment.getByText('cancelled', { exact: true })).toBeVisible();
        } finally {
            await Promise.allSettled([clinician.context.close(), patient.context.close()]);
        }
    });
});

function futureDate(daysAhead: number): string {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + daysAhead);
    return date.toISOString().slice(0, 10);
}
