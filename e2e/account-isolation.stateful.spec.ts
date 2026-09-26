import { randomUUID } from 'node:crypto';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect, test } from './helpers/statefulFixture';
import {
    arriveAtClinicianDashboard,
    arriveAtPatientDashboard,
    authenticatedFirebaseIdentity,
    authenticatedUserId,
    storageStatePath,
    type AuthenticatedE2EIdentity,
} from './helpers/auth';
import { recordDisposableE2EAccount, statefulRunRequested, type DisposableE2ERun } from './helpers/dataLifecycle';
import { expectDisposableRolePersisted } from './helpers/persistenceAssertions';

const dedicatedPatientState = storageStatePath.patient;
const dedicatedClinicianState = storageStatePath.clinician;

type DisposableRole = 'patient' | 'clinician';

type DisposableIdentity = {
    email: string;
    name: string;
    password: string;
};

// Account credentials must never appear in traces, screenshots, video, or the
// test title/reporter. This spec creates them only in memory for one run.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

function disposableIdentity(role: DisposableRole): DisposableIdentity {
    const marker = randomUUID().replaceAll('-', '').toLowerCase();
    return {
        email: `neurasticity-e2e-${role}-${marker}@example.com`,
        name: `E2E ${role === 'patient' ? 'Patient' : 'Clinician'} ${marker.slice(0, 8)}`,
        password: `N3u!${randomUUID().replaceAll('-', '')}`,
    };
}

async function signUpThroughUi(
    page: Page,
    identity: DisposableIdentity,
    role: DisposableRole,
): Promise<string> {
    await page.goto('/#/signup');
    await expect(page.getByRole('heading', { name: 'Create Account', exact: true })).toBeVisible();
    const nameInput = page.getByPlaceholder('How should we call you?', { exact: true });
    const emailInput = page.getByPlaceholder('you@example.com', { exact: true });
    const passwordInput = page.getByPlaceholder('At least 6 characters', { exact: true });
    await nameInput.fill(identity.name);
    await emailInput.fill(identity.email);
    await passwordInput.fill(identity.password);
    try {
        await page.getByRole('button', { name: 'Create Account', exact: true }).click();
        await expect.poll(async () => page.evaluate(async () => {
            const { auth } = await import('/src/services/firebase.ts');
            await auth.authStateReady();
            return auth.currentUser?.uid ?? '';
        }), { timeout: 15_000 }).not.toBe('');
    } catch (error) {
        // If signup fails while the form is still mounted, scrub its values
        // before Playwright records a textual error-context snapshot.
        await Promise.allSettled([nameInput.fill(''), emailInput.fill(''), passwordInput.fill('')]);
        throw error;
    }
    const userId = await authenticatedUserId(page);

    await expect(page.getByRole('heading', { name: 'How will you use Waveable?', exact: true })).toBeVisible();
    await page.getByRole('button', {
        name: role === 'patient' ? /Train my brain/ : /I am a practitioner/,
    }).click();

    if (role === 'patient') {
        await expect(page.getByRole('button', { name: 'Skip to Dashboard', exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Skip to Dashboard', exact: true }).click();
        await arriveAtPatientDashboard(page);
    } else {
        await arriveAtClinicianDashboard(page);
    }

    return userId;
}

async function openDedicatedPatient(browser: Browser): Promise<{
    context: BrowserContext;
    page: Page;
    name: string;
    identity: AuthenticatedE2EIdentity;
}> {
    const context = await browser.newContext({ storageState: dedicatedPatientState });
    const page = await context.newPage();
    await page.goto('/');
    await arriveAtPatientDashboard(page);
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    const name = (await page.getByRole('heading', { level: 2 }).first().innerText()).trim();
    expect(name, 'The dedicated E2E patient must have a user-visible display name').not.toBe('');
    const identity = await authenticatedFirebaseIdentity(page);
    return { context, page, name, identity };
}

async function openDedicatedClinician(browser: Browser): Promise<{
    context: BrowserContext;
    identity: AuthenticatedE2EIdentity;
}> {
    const context = await browser.newContext({ storageState: dedicatedClinicianState });
    const page = await context.newPage();
    await page.goto('/');
    await arriveAtClinicianDashboard(page);
    return { context, identity: await authenticatedFirebaseIdentity(page) };
}

async function expectUnrelatedClinicianAuthorizationDenied(
    page: Page,
    patientId: string,
    ownerClinicianId: string,
): Promise<void> {
    const denialCodes = await page.evaluate(async ({ patientId, ownerClinicianId }) => {
        const { probeUnrelatedClinicianReads } = await import('/e2e/helpers/firestoreProbe.ts');
        return probeUnrelatedClinicianReads(patientId, ownerClinicianId);
    }, { patientId, ownerClinicianId });

    expect(denialCodes, 'Unrelated clinicians must be denied patient, session, appointment, QEEG, and message reads')
        .toEqual(Array(6).fill('permission-denied'));
}

function reportMetric(page: Page, label: string) {
    return page.getByText(label, { exact: true }).locator('..').locator('..');
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test.describe('fresh-account truthfulness and cross-account isolation (stateful)', () => {
    test.skip(!statefulRunRequested(), 'Stateful: run through npm run test:e2e:stateful:isolation.');

    test('fresh patient and unrelated clinician see only their persisted, authorized data', async ({ browser, stateful, permissionErrorGuard }) => {
        const dedicatedPatient = await openDedicatedPatient(browser);
        const dedicatedClinician = await openDedicatedClinician(browser);
        expect(dedicatedClinician.identity.projectId).toBe(dedicatedPatient.identity.projectId);
        const patientIdentity = disposableIdentity('patient');
        const clinicianIdentity = disposableIdentity('clinician');
        const cleanupEmails = [patientIdentity.email, clinicianIdentity.email];
        let patientContext: BrowserContext | undefined;
        let clinicianContext: BrowserContext | undefined;
        let disposableRun: DisposableE2ERun | undefined;

        try {
            // Validate the destructive-operation guard and Admin credentials
            // before registering or creating either account. Registry leftovers
            // from earlier runs block admission until an operator reviews them.
            disposableRun = await stateful.beginDisposableRun(
                cleanupEmails,
                dedicatedPatient.identity.projectId,
            );
            patientContext = await browser.newContext();
            clinicianContext = await browser.newContext();
            const patientPage = await patientContext.newPage();
            const clinicianPage = await clinicianContext.newPage();

            const freshPatientId = await signUpThroughUi(patientPage, patientIdentity, 'patient');
            const freshPatient = { uid: freshPatientId, email: patientIdentity.email };
            await recordDisposableE2EAccount(freshPatient, disposableRun);
            await expectDisposableRolePersisted(disposableRun, freshPatient, 'patient');

            await expect(patientPage.getByText('Assignment required', { exact: true })).toBeVisible();
            await expect(patientPage.getByRole('button', { name: 'Protocol assignment required', exact: true })).toBeDisabled();
            await expect(patientPage.getByText('No measured sessions in this period.', { exact: true })).toBeVisible();

            await patientPage.getByRole('button', { name: 'Progress', exact: true }).click();
            await expect(patientPage.getByRole('heading', { name: 'Your Progress', exact: true })).toBeVisible();
            await expect(patientPage.getByText('Complete your first session to start tracking progress.', { exact: true })).toBeVisible();
            await expect(patientPage.getByText('No sessions in this period', { exact: true })).toBeVisible();
            await expect(reportMetric(patientPage, 'Sessions')).toContainText('0');
            await expect(reportMetric(patientPage, 'Measured sessions')).toContainText('0');

            await patientPage.getByRole('button', { name: 'Visits', exact: true }).click();
            await expect(patientPage.getByText('No appointments scheduled', { exact: true })).toBeVisible();
            await expect(patientPage.getByText('New appointments from your linked clinician will appear here.', { exact: true })).toBeVisible();

            await patientPage.getByRole('button', { name: 'Profile', exact: true }).click();
            await expect(patientPage.getByRole('button', { name: 'Connect to Clinician', exact: true })).toBeVisible();
            await expect(patientPage.getByText('Goal:', { exact: true }).locator('..')).toContainText('Unavailable');
            await expect(patientPage.getByText('Protocol:', { exact: true }).locator('..')).toContainText('Assignment required');
            await expect(patientPage.getByText('Weekly Target:', { exact: true }).locator('..')).toContainText('Unavailable');
            await expect(patientPage.getByText('Completed:', { exact: true }).locator('..')).toContainText('0 sessions total');
            await expect(patientPage.getByText('Connected to your clinician', { exact: true })).toHaveCount(0);

            const dedicatedPatientName = dedicatedPatient.name;

            const freshClinicianId = await signUpThroughUi(clinicianPage, clinicianIdentity, 'clinician');
            const freshClinician = { uid: freshClinicianId, email: clinicianIdentity.email };
            await recordDisposableE2EAccount(freshClinician, disposableRun);
            await expectDisposableRolePersisted(disposableRun, freshClinician, 'clinician');
            await expect(clinicianPage.getByRole('heading', { name: 'Patient Roster', exact: true })).toBeVisible();
            await expect(clinicianPage.getByText('0 Total Patients • 0 Active Training', { exact: true })).toBeVisible();
            await expect(clinicianPage.getByText('No patients match the selected filter.', { exact: true })).toBeVisible();
            await expect(clinicianPage.getByText('Pending invitations', { exact: true })).toHaveCount(0);
            await clinicianPage.getByPlaceholder('Search patients, email, conditions...').fill(dedicatedPatientName);
            await expect(clinicianPage.getByRole('row').filter({ hasText: dedicatedPatientName })).toHaveCount(0);
            await expect(clinicianPage.getByRole('button', { name: 'Live Telemetry', exact: true })).toHaveCount(0);
            await expect(clinicianPage.getByRole('button', { name: /^QEEG Records/ })).toHaveCount(0);

            await clinicianPage.getByRole('button', { name: 'Messages', exact: true }).click();
            await expect(clinicianPage.getByText('No linked patients are available for messaging.', { exact: true })).toBeVisible();
            await clinicianPage.getByPlaceholder('Search conversations', { exact: true }).fill(dedicatedPatientName);
            await expect(clinicianPage.getByRole('button', { name: new RegExp(escapeRegExp(dedicatedPatientName)) })).toHaveCount(0);

            await clinicianPage.getByRole('button', { name: 'Calendar', exact: true }).click();
            await expect(clinicianPage.getByText('No appointments scheduled', { exact: true })).toBeVisible();
            await expect(clinicianPage.getByText('Link a patient before scheduling an appointment.', { exact: true })).toBeVisible();
            await expect(clinicianPage.getByRole('button', { name: 'Schedule appointment', exact: true })).toBeDisabled();
            await expect(clinicianPage.getByText(dedicatedPatientName, { exact: true })).toHaveCount(0);

            await clinicianPage.getByRole('button', { name: 'Reports', exact: true }).click();
            await expect(clinicianPage.getByText('Loading persisted sessions… Report measurements and exports are unavailable until loading completes.', { exact: true })).toBeHidden();
            await expect(clinicianPage.getByText('No eligible clinical or training Demo sessions were found in this interval.', { exact: true })).toBeVisible();
            await expect(clinicianPage.getByRole('button', { name: 'Enrolled (0)', exact: true })).toBeVisible();
            await expect(clinicianPage.getByRole('button', { name: 'Sample (0)', exact: true })).toBeVisible();
            await expect(reportMetric(clinicianPage, 'Selected Cohort')).toContainText('0');
            await expect(reportMetric(clinicianPage, 'Persisted Sessions')).toContainText('0');
            await expect(reportMetric(clinicianPage, 'Training Demo Completions')).toContainText('0');
            await expect(reportMetric(clinicianPage, 'Sample Workspace Records')).toContainText('0');
            await expect(reportMetric(clinicianPage, 'Average In-Zone Time')).toContainText('Unavailable');
            await expect(reportMetric(clinicianPage, 'Device Snapshot Coverage')).toContainText('Unavailable');
            await expect(clinicianPage.getByText('Device models recorded: Unavailable.', { exact: true })).toBeVisible();
            await expect(clinicianPage.getByText('No patients are in this cohort.', { exact: true })).toBeVisible();
            await expect(clinicianPage.getByText(dedicatedPatientName, { exact: true })).toHaveCount(0);

            // Only this browser context's deliberate direct probes may return
            // permission-denied; the other contexts remain under the guard.
            permissionErrorGuard.expectDenialsIn(clinicianPage.context());
            await expectUnrelatedClinicianAuthorizationDenied(
                clinicianPage,
                dedicatedPatient.identity.uid,
                dedicatedClinician.identity.uid,
            );
        } finally {
            await Promise.allSettled([
                patientContext?.close() ?? Promise.resolve(),
                clinicianContext?.close() ?? Promise.resolve(),
                dedicatedPatient.context.close(),
                dedicatedClinician.context.close(),
            ]);
        }
    });
});
