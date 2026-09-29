import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { arriveAtClinicianDashboard, arriveAtPatientDashboard, loginThroughUi } from './helpers/auth';
import { readReviewSessionFeedback, seedLinkedPatient } from './helpers/localEmulator';
import { trackingCopy } from './helpers/patientProgress';
import { readSessionNotes, seedSessionHistory, SESSION_HISTORY_COUNTS, UNMEASURED_SESSION_INDEXES } from './helpers/sessionHistorySeed';

// WB-88: long histories render one page at a time with an explicit "Show more".
const unmeasured = UNMEASURED_SESSION_INDEXES[1];

async function openProgress(page: Page) {
  await page.getByRole('button', { name: 'Progress', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your Progress', exact: true })).toBeVisible();
  await expect(page.getByText(trackingCopy(SESSION_HISTORY_COUNTS.all), { exact: true })).toBeVisible({ timeout: 15_000 });
}

/** Session History cards: each carries a time-in-zone ring, measured or not. */
const historyCards = (page: Page) => page.locator('.card-patient').filter({ has: page.getByRole('img', { name: /in zone/ }) });
const countText = (page: Page, text: string) => page.getByText(text, { exact: true });

/** At a phone width, the count and one-line control fit without horizontal page scroll. */
async function expectShowMoreFits(page: Page, width: number) {
  await page.setViewportSize({ width, height: 844 });
  const count = countText(page, `Showing 10 of ${SESSION_HISTORY_COUNTS.month} sessions`);
  const button = page.getByRole('button', { name: 'Show 10 more sessions', exact: true });
  await button.scrollIntoViewIfNeeded();
  await expect(count).toBeVisible();
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  const countBox = await count.boundingBox();
  expect(box, `button box at ${width}px`).not.toBeNull();
  expect(countBox, `count box at ${width}px`).not.toBeNull();
  expect(box!.x, `button inside the viewport at ${width}px`).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, `button inside the viewport at ${width}px`).toBeLessThanOrEqual(width);
  // One line of 14px text plus padding is about 42px; a wrapped label would be over 60px.
  expect(box!.height, `one-line button at ${width}px`).toBeLessThanOrEqual(48);
  expect(countBox!.height, `one-line count at ${width}px`).toBeLessThanOrEqual(24);
  expect(countBox!.x + countBox!.width, `count inside the viewport at ${width}px`).toBeLessThanOrEqual(width);
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth), `no horizontal overflow at ${width}px`).toBe(true);
}

async function openSessionLogs(page: Page, patientName: string) {
  await page.getByRole('row').filter({ hasText: patientName }).click();
  await page.getByRole('button', { name: `Session Logs (${SESSION_HISTORY_COUNTS.all})`, exact: true }).click();
}

test('patient Progress bounds a long history, reveals it a page at a time, and saves a journal on a revealed session', async ({ browser }) => {
  const fixture = await seedLinkedPatient();
  const ids = await seedSessionHistory(fixture);
  // Patient Progress is a phone surface: run it at a phone viewport.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await loginThroughUi(page, fixture.patient);
    await arriveAtPatientDashboard(page);
    await openProgress(page);
    const cards = historyCards(page);

    // Past 30 days (the default range): one page, summary rows, details collapsed.
    await expect(cards).toHaveCount(10);
    await expect(countText(page, `Showing 10 of ${SESSION_HISTORY_COUNTS.month} sessions`)).toBeVisible();
    await expect(page.getByText('Session details', { exact: true })).toHaveCount(0);
    for (const width of [320, 440, 390]) await expectShowMoreFits(page, width);
    await page.getByRole('button', { name: 'Show 10 more sessions', exact: true }).click();
    await expect(cards).toHaveCount(SESSION_HISTORY_COUNTS.month);
    await expect(countText(page, `Showing all ${SESSION_HISTORY_COUNTS.month} sessions`)).toBeVisible();
    await expect(page.getByRole('button', { name: /more sessions?$/ })).toHaveCount(0);

    // Each range starts again at one page.
    await page.getByRole('button', { name: /^week$/i }).click();
    await expect(cards).toHaveCount(10);
    await expect(countText(page, `Showing 10 of ${SESSION_HISTORY_COUNTS.week} sessions`)).toBeVisible();
    await page.getByRole('button', { name: 'Show 2 more sessions', exact: true }).click();
    await expect(cards).toHaveCount(SESSION_HISTORY_COUNTS.week);
    await page.getByRole('button', { name: 'All Time', exact: true }).click();
    await expect(cards).toHaveCount(10);
    await expect(countText(page, `Showing 10 of ${SESSION_HISTORY_COUNTS.all} sessions`)).toBeVisible();
    await page.getByRole('button', { name: 'Show 10 more sessions', exact: true }).click();
    await expect(cards).toHaveCount(20);

    // A revealed session saved without measurements: truthful row, details only on request.
    const revealed = cards.nth(unmeasured);
    await expect(revealed.getByRole('img', { name: 'Time in zone unavailable' })).toBeVisible();
    await expect(revealed).toContainText('Duration unavailable');
    await expect(revealed).not.toContainText('Session details');
    await revealed.click();
    await expect(revealed).toContainText('Session details');
    await expect(revealed).toContainText('No journal entry yet.');
    await expect(revealed.locator('.fact-grid > div').filter({ hasText: 'Band power' })).toContainText('Unavailable');

    const journal = `Long history reflection ${randomUUID().slice(0, 8)}`;
    await revealed.getByRole('button', { name: 'Edit journal' }).click();
    await revealed.getByLabel('Personal journal').fill(journal);
    await revealed.getByLabel('Mood').selectOption('4');
    // Revealing more never hides the open journal; a range change is still refused.
    await page.getByRole('button', { name: 'Show 8 more sessions', exact: true }).click();
    await expect(cards).toHaveCount(SESSION_HISTORY_COUNTS.all);
    await expect(countText(page, `Showing all ${SESSION_HISTORY_COUNTS.all} sessions`)).toBeVisible();
    await expect(revealed.getByLabel('Personal journal')).toHaveValue(journal);
    await page.getByRole('button', { name: /^month$/i }).click();
    await expect(page.getByText('Save or cancel the current journal before opening another session or range.')).toBeVisible();
    await expect(cards).toHaveCount(SESSION_HISTORY_COUNTS.all);
    await expect(revealed.getByLabel('Personal journal')).toHaveValue(journal);

    await revealed.getByRole('button', { name: 'Save journal' }).click();
    await expect(revealed.getByRole('button', { name: 'Edit journal' })).toBeVisible();
    await expect(revealed).toContainText(journal);
    await expect(revealed).toContainText('Focused · 4/5');
    await expect.poll(() => readSessionNotes(ids[unmeasured])).toMatchObject({ patientNotes: journal, moodRating: 4 });

    // A reload starts bounded again, and the saved journal is on the same revealed session.
    await page.reload();
    await arriveAtPatientDashboard(page);
    await openProgress(page);
    await expect(cards).toHaveCount(10);
    await expect(countText(page, `Showing 10 of ${SESSION_HISTORY_COUNTS.month} sessions`)).toBeVisible();
    await page.getByRole('button', { name: 'Show 10 more sessions', exact: true }).click();
    const reloaded = cards.nth(unmeasured);
    await expect(reloaded).toContainText('Focused · 4/5');
    await expect(reloaded).not.toContainText(journal);
    await reloaded.click();
    await expect(reloaded).toContainText(journal);
  } finally {
    await context.close();
  }
});

test('clinician Session Logs are bounded and a feedback draft on a revealed session survives switching, then saves', async ({ browser }) => {
  const fixture = await seedLinkedPatient();
  const ids = await seedSessionHistory(fixture);
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await loginThroughUi(page, fixture.clinician);
    await arriveAtClinicianDashboard(page);
    await openSessionLogs(page, fixture.name);

    const rows = page.getByRole('list', { name: 'Session logs' }).getByRole('listitem');
    await expect(rows).toHaveCount(10);
    await expect(countText(page, `Showing 10 of ${SESSION_HISTORY_COUNTS.all} sessions`)).toBeVisible();
    await expect(page.getByRole('button', { name: `Open ${ids[9]}`, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: `Open ${ids[10]}`, exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Show 10 more sessions', exact: true }).click();
    await expect(rows).toHaveCount(20);
    await expect(countText(page, `Showing 20 of ${SESSION_HISTORY_COUNTS.all} sessions`)).toBeVisible();
    // The tab keeps counting every session, not the visible page.
    await expect(page.getByRole('button', { name: `Session Logs (${SESSION_HISTORY_COUNTS.all})`, exact: true })).toBeVisible();

    await page.getByRole('button', { name: `Open ${ids[unmeasured]}`, exact: true }).click();
    const detail = page.getByRole('region', { name: `Session ${ids[unmeasured]} details` });
    await expect(detail).toContainText('Not recorded:');
    await expect(rows.filter({ has: page.getByRole('button', { name: `Close ${ids[unmeasured]}` }) })).toContainText('Unavailable');
    const draft = `Revealed feedback ${randomUUID().slice(0, 8)}`;
    await detail.getByLabel('Clinician feedback').fill(draft);

    await page.getByRole('button', { name: `Open ${ids[15]}`, exact: true }).click();
    await expect(page.getByRole('region', { name: `Session ${ids[15]} details` })).toBeVisible();
    await expect(detail).toBeHidden();
    await page.getByRole('button', { name: 'Protocol Settings', exact: true }).click();
    await page.getByRole('button', { name: `Session Logs (${SESSION_HISTORY_COUNTS.all})`, exact: true }).click();
    await page.getByRole('button', { name: 'Show 8 more sessions', exact: true }).click();
    await expect(rows).toHaveCount(SESSION_HISTORY_COUNTS.all);
    await expect(countText(page, `Showing all ${SESSION_HISTORY_COUNTS.all} sessions`)).toBeVisible();
    await page.getByRole('button', { name: `Open ${ids[unmeasured]}`, exact: true }).click();
    await expect(detail.getByLabel('Clinician feedback')).toHaveValue(draft);

    await detail.getByRole('button', { name: 'Save feedback' }).click();
    await expect.poll(() => readReviewSessionFeedback(ids[unmeasured])).toBe(draft);
    await expect.poll(async () => (await readSessionNotes(ids[15])).clinicianNotes).toBeUndefined();
    await expect(rows.filter({ hasText: `Clinician: ${draft}` })).toHaveCount(1);

    await page.reload();
    await arriveAtClinicianDashboard(page);
    await openSessionLogs(page, fixture.name);
    await expect(rows).toHaveCount(10);
    await page.getByRole('button', { name: 'Show 10 more sessions', exact: true }).click();
    await page.getByRole('button', { name: `Open ${ids[unmeasured]}`, exact: true }).click();
    await expect(detail.getByLabel('Clinician feedback')).toHaveValue(draft);
  } finally {
    await context.close();
  }
});
