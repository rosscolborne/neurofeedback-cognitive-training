import { execFileSync } from 'node:child_process';
import { expect, test } from './fixtures';
import { arriveAtClinicianDashboard, arriveAtPatientDashboard, credentialsFor, loginThroughUi } from './helpers/auth';

function reportMetric(page: import('@playwright/test').Page, label: string) {
    return page.getByText(label, { exact: true }).locator('../..');
}

function patientRows(page: import('@playwright/test').Page) {
    return page.getByRole('heading', { name: 'Patient interval activity', exact: true })
        .locator('../..').locator('tbody tr');
}

function rosterRows(page: import('@playwright/test').Page) {
    return page.getByRole('table').locator('tbody tr');
}

function patientRosterRows(page: import('@playwright/test').Page) {
    return rosterRows(page).filter({ has: page.locator('td:first-child span') });
}

async function firstRosterPatient(page: import('@playwright/test').Page) {
    const row = patientRosterRows(page).first();
    await expect(row, 'The read-only clinician fixture needs a linked patient').toBeVisible();
    const name = (await row.locator('td').first().innerText()).split('\n')[0].trim();
    expect(name).not.toBe('');
    await row.click();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    return name;
}

// Read-only: confirms the saved clinician session reaches the real roster view.
test('authenticated clinician reaches the patient roster', async ({ page }) => {
    await page.goto('/');
    await arriveAtClinicianDashboard(page);
    await expect(page.getByRole('heading', { name: 'Patient Roster', exact: true })).toBeVisible();
});

test('linked patient detail shows honest telemetry and QEEG evidence states', async ({ page }) => {
    await page.goto('/');
    await arriveAtClinicianDashboard(page);
    await firstRosterPatient(page);

    await page.getByRole('button', { name: 'Live Telemetry', exact: true }).click();
    const telemetry = page.getByRole('status').filter({ hasText: 'Waveform / sample rate / packet loss' });
    await expect(page.getByText('Not connected — no active patient telemetry source is available in this clinician view.', { exact: true })).toBeVisible();
    await expect(telemetry).toContainText('ConnectionNot connected');
    await expect(telemetry).toContainText('Contact / impedanceUnavailable');
    await expect(telemetry).toContainText('Waveform / sample rate / packet lossUnavailable');

    await page.getByRole('button', { name: /^QEEG Records/ }).click();
    await expect(page.getByText('Loading saved QEEG records…', { exact: true })).toBeHidden();
    await expect(page.getByText('No QEEG measurements have been entered for this patient.', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: /^Session Logs/ }).click();
    await expect(page.getByText('Loading session logs…', { exact: true })).toBeHidden();
    await expect(page.getByText('No training sessions recorded yet for this patient.', { exact: true })
        .or(page.getByText(/Duration: (?:\d+ min|Unavailable) \| In-Zone:/).first())).toBeVisible();
});

test('Settings reloads the saved clinic identity without editing it', async ({ page }) => {
    await page.goto('/');
    await arriveAtClinicianDashboard(page);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const clinicNameInput = page.getByLabel('Clinic name', { exact: true });
    await expect(clinicNameInput).toBeEnabled();
    const clinicName = await clinicNameInput.inputValue();
    await page.reload();
    await arriveAtClinicianDashboard(page);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByLabel('Clinic name', { exact: true })).toHaveValue(clinicName);
});

test('report range totals agree with visible patient rows and PDF export', async ({ page }) => {
    await page.goto('/');
    await arriveAtClinicianDashboard(page);
    await page.getByRole('button', { name: 'Reports', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Session Activity Reports', exact: true })).toBeVisible();
    await expect(page.getByText('Loading persisted sessions… Report measurements and exports are unavailable until loading completes.', { exact: true })).toBeHidden();

    const totals: number[] = [];
    const intervals: string[] = [];
    let selectedCohort = 0;
    for (const button of ['Last 30 Days', 'Last 90 Days', 'YTD'] as const) {
        await page.getByRole('button', { name: button, exact: true }).click();
        const interval = (await page.getByText(/^Interval:/).innerText()).split(' · Source:')[0].replace('Interval: ', '');
        expect(interval).toMatch(/\w+ \d+, \d{4} – \w+ \d+, \d{4} \([^)]+\)/);
        intervals.push(interval);
        const total = Number((await reportMetric(page, 'Persisted Sessions').innerText()).match(/Persisted Sessions\s*(\d+)/)?.[1]);
        expect(Number.isFinite(total)).toBe(true);
        const rows = patientRows(page);
        const cohort = Number((await reportMetric(page, 'Selected Cohort').innerText()).match(/Selected Cohort\s*(\d+)/)?.[1]);
        selectedCohort = cohort;
        await expect(rows).toHaveCount(cohort || 1);
        const rowCounts = await rows.locator('td:nth-child(2)').allInnerTexts();
        expect(rowCounts.reduce((sum, value) => sum + Number(value), 0)).toBe(total);
        totals.push(total);
    }
    expect(totals[0]).toBeLessThanOrEqual(totals[1]);
    expect(intervals[0]).not.toBe(intervals[1]);
    expect(intervals[2]).toMatch(/^Jan 1, \d{4} – /);
    expect(selectedCohort, 'The read-only clinician fixture needs a reportable patient').toBeGreaterThan(0);
    const sampleCount = Number((await reportMetric(page, 'Sample Workspace Records').innerText()).match(/Sample Workspace Records\s*(\d+)/)?.[1]);
    expect(sampleCount).toBe(0);

    const firstPatientRow = patientRows(page).first();
    const patientName = (await firstPatientRow.getByRole('button').first().innerText()).trim();
    const patientSessions = (await firstPatientRow.locator('td').nth(1).innerText()).trim();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export Practice Summary (PDF)', exact: true }).click();
    const download = await downloadPromise;
    const pdfText = execFileSync('pdftotext', ['-layout', await download.path(), '-'], { encoding: 'utf8' });
    for (const [label, expected] of [
        ['title', 'Practice Session Activity Report'],
        ['interval', `Reporting interval: ${intervals[2].replace(/ \([^)]+\)$/, '')}`],
        ['cohort', `Selected cohort: ${selectedCohort} patient profiles`],
        ['session total', `Persisted sessions: ${totals[2]}`],
        ['sample count', 'Sample workspace records: 0'],
        ['patient row', patientName],
        ['missing-value note', 'Unavailable values are not replaced'],
    ] as const) {
        expect(pdfText.includes(expected), `Practice PDF ${label} matches the visible report`).toBe(true);
    }

    const patientDownloadPromise = page.waitForEvent('download');
    await firstPatientRow.getByRole('button', { name: 'PDF', exact: true }).click();
    const patientDownload = await patientDownloadPromise;
    const patientPdfText = execFileSync('pdftotext', ['-layout', await patientDownload.path(), '-'], { encoding: 'utf8' });
    for (const [label, expected] of [
        ['title', 'Patient Session Activity Report'],
        ['patient', `Patient: ${patientName}`],
        ['interval', `Reporting interval: ${intervals[2].replace(/ \([^)]+\)$/, '')}`],
        ['session total', `Persisted sessions: ${patientSessions}`],
    ] as const) {
        expect(patientPdfText.includes(expected), `Patient PDF ${label} matches the visible report`).toBe(true);
    }
});

test('sample workspace and a second login never display the prior account’s roster', async ({ page }) => {
    const patientCredentials = credentialsFor('patient');
    const clinicianCredentials = credentialsFor('clinician');
    expect(patientCredentials && clinicianCredentials, 'The existing E2E pair credentials are required').toBeTruthy();

    await page.goto('/');
    await arriveAtClinicianDashboard(page);
    await expect(page.getByText(/Sample clinician workspace · fictional demonstration data/)).toHaveCount(0);
    await expect(patientRosterRows(page).first(), 'The read-only clinician fixture needs a linked patient').toBeVisible();
    const rosterName = (await patientRosterRows(page).first().locator('td').first().innerText()).split('\n')[0].trim();
    expect(rosterName).not.toBe('');
    await page.getByRole('button', { name: 'Sign out', exact: true }).first().click();
    await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();

    await loginThroughUi(page, patientCredentials!);
    await arriveAtPatientDashboard(page);
    await expect(page.getByText(rosterName, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Patient Roster', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await page.getByRole('button', { name: 'Log Out', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await page.getByRole('button', { name: 'Open Sample Clinician Workspace', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Sample clinician workspace · fictional demonstration data · isolated from production accounts' })).toBeVisible();
    await expect(patientRosterRows(page).first()).toBeVisible();
    const sampleName = (await patientRosterRows(page).first().locator('td').first().innerText()).split('\n')[0].trim();
    expect(sampleName).not.toBe(rosterName);
    await expect(rosterRows(page).filter({ hasText: rosterName })).toHaveCount(0);
    await page.getByRole('button', { name: 'Sign out', exact: true }).first().click();
    await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();

    await loginThroughUi(page, clinicianCredentials!);
    await arriveAtClinicianDashboard(page);
    await expect(page.getByText(/Sample clinician workspace · fictional demonstration data/)).toHaveCount(0);
    await expect(rosterRows(page).filter({ hasText: rosterName })).toBeVisible();
    await expect(rosterRows(page).filter({ hasText: sampleName })).toHaveCount(0);
});
