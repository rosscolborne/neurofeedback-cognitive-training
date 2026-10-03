import { randomUUID } from 'node:crypto';
import { devices, type Locator, type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { arriveAtHome } from './helpers/auth';
import { readGameSessions } from './helpers/localEmulator';
import { answer, openMentalMath, runOut, startRun } from './helpers/mentalMath';

// NFCT-22: the post-session summary and Mental Math's per-game progress,
// through trusted scoring. The suite runs the Functions emulator, so
// onGameSessionCreated scores each saved run and writes its `result` and
// progress/{gameId}, as in production. Runs use NFCT-21's page.clock and fixed
// seed (e2e/helpers/mentalMath.ts); the only real-time waits poll for the
// server's result. Expected values are read back from what trusted scoring
// wrote (observation only), never written by the test.

const verification = (page: Page) => page.locator('[data-summary="verification"]');
const record = (page: Page) => page.locator('[data-summary="record"]');
const unlock = (page: Page) => page.locator('[data-summary="unlock"]');
const shownScore = (page: Page) => page.locator('[data-result="score"]');
const format = (value: number) => new Intl.NumberFormat('en-US').format(value);

/** Seven right answers from level 1 reach level 3: start level 2 unlocks. */
const CLIMB = [true, true, true, true, true, true, true];
/** One right answer, then a miss: a weaker run than CLIMB on the same seed. */
const WEAK = [true, false];

type Result = {
  validity: string;
  score: number;
  personalBest?: boolean;
  unlocked?: Array<{ modeId: string; startLevel: number }>;
  metrics: { difficultyPoints: number; speedBonusPoints: number; correct: number };
};

/** Trusted scoring's result for the player's newest session (observation only). */
async function newestResult(uid: string): Promise<Result> {
  const sessions = (await readGameSessions(uid))
    .sort((a, b) => (b.data.endedAt as { toMillis(): number }).toMillis() - (a.data.endedAt as { toMillis(): number }).toMillis());
  const result = sessions[0]?.data.result as Result | undefined;
  if (!result) throw new Error('The newest session has no trusted result');
  return result;
}

/**
 * Back to the real wall clock before a run. Each fast-forwarded run leaves
 * page time about 90 s ahead of the emulator's clock, and the rules refuse a
 * session that ends more than 5 minutes after the server's time.
 */
async function realWallClock(page: Page): Promise<void> {
  await page.clock.setSystemTime(Date.now());
}

/** Plays a whole run from `level`, answering `script` and letting the rest time out. */
async function playRun(page: Page, level: number, script: readonly boolean[]): Promise<void> {
  await realWallClock(page);
  await startRun(page, level);
  for (const correct of script) await answer(page, correct);
  await runOut(page);
}

/** Lets page time flow and waits for trusted scoring's valid result on screen. */
async function expectVerified(page: Page): Promise<void> {
  await page.clock.resume();
  await expect(verification(page)).toHaveText('Final', { timeout: 30_000 });
}

/**
 * Records the height of the record and unlock cards at every change, from the
 * summary's first render (NFCT-52). A MutationObserver sees each state React
 * commits, however briefly it lasts, with no timing in the test.
 */
async function watchHighlightHeights(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: Array<{ name: string; text: string; height: number }> = [];
    (window as unknown as { nfctHighlightHeights: typeof seen }).nfctHighlightHeights = seen;
    const record = () => {
      for (const name of ['record', 'unlock']) {
        const card = document.querySelector(`[data-summary="${name}"]`);
        if (!card) continue;
        const entry = { name, text: card.textContent ?? '', height: Math.round(card.getBoundingClientRect().height) };
        const last = seen.filter((item) => item.name === name).at(-1);
        if (last?.text !== entry.text || last.height !== entry.height) seen.push(entry);
      }
    };
    new MutationObserver(record).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  });
}

async function highlightHeights(page: Page): Promise<Array<{ name: string; text: string; height: number }>> {
  return page.evaluate(() => (window as unknown as { nfctHighlightHeights: Array<{ name: string; text: string; height: number }> }).nfctHighlightHeights);
}

/**
 * A resolved run ended early, as a history row shows it (NFCT-64): one neutral
 * "Ended early" tag, its trusted score quieter than a finished run's, its play
 * time in the meta line, and neither a dash nor "Pending".
 */
async function expectEndedEarly(row: Locator): Promise<void> {
  await expect(row).toHaveAttribute('data-run', 'ended-early');
  await expect(row.locator('[data-history-tag]')).toHaveText('Ended early');
  await expect(row.locator('.mm-history-score-muted')).toHaveText(/^\d[\d,]*$/);
  await expect(row.locator('.mm-history-meta')).toHaveText('Start level 1 · 1\u00A0s');
  await expect(row).not.toContainText(/—|Pending|No score/);
}

/** Back to the picker, once it has loaded the player's levels (page time must flow for Firestore meanwhile). */
async function playAgain(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Play again', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mental Math', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Start at level \d+$/ })).toBeEnabled();
}

test('the summary shows a provisional score at once, then the server score, its breakdown, a new best and an unlock the picker offers', async ({ page, context }) => {
  const uid = await openMentalMath(page);
  await realWallClock(page);
  await startRun(page, 1);
  for (const correct of CLIMB) await answer(page, correct);
  // Offline when the run ends: it is saved on this device, and nothing can verify it yet.
  await context.setOffline(true);
  await watchHighlightHeights(page);
  await runOut(page);
  await expect(page.locator('#mm-handoff-title')).toHaveText('Run complete');
  await expect(page.locator('#mm-handoff-title')).toBeFocused();
  await page.clock.resume();
  await expect(page.locator('.mm-save')).toHaveText('Saved on this device. Uploading to your account…');

  // 1. The optimistic preview: this device's score, marked pending, with its predicted best and unlock.
  // No line narrates how the run is scored (NFCT-66); the save line says it is waiting to upload.
  await expect(verification(page)).toHaveText('Pending');
  await expect(page.locator('[data-summary="caption"]')).toHaveText('');
  const provisional = await shownScore(page).innerText();
  await expect(record(page)).toContainText('New personal best');
  await expect(unlock(page)).toContainText('Level 2 unlocked');
  await expect(record(page)).toHaveAttribute('data-pending', 'true');
  await expect(unlock(page)).toHaveAttribute('data-pending', 'true');
  const layout = async () => page.evaluate(() => ['.mm-score', '.mm-highlights', '.mm-panel-compact']
    .map((selector) => document.querySelector(selector)!.getBoundingClientRect()).map(({ top, height }) => [Math.round(top), Math.round(height)]));
  const provisionalLayout = await layout();
  expect(await readGameSessions(uid)).toHaveLength(0);
  // NFCT-52: the cards kept one height from "Loading…" to the preview, so nothing below them moved.
  const heights = await highlightHeights(page);
  expect(heights.filter((entry) => entry.text.includes('Loading your'))).toHaveLength(2);
  for (const name of ['record', 'unlock']) {
    expect(new Set(heights.filter((entry) => entry.name === name).map((entry) => entry.height)), `${name} heights: ${JSON.stringify(heights)}`).toHaveProperty('size', 1);
  }

  // Back online: the run uploads, onGameSessionCreated scores it, and the result replaces the preview.
  await context.setOffline(false);
  await expect(verification(page)).toHaveText('Final', { timeout: 30_000 });
  const result = await newestResult(uid);
  expect(result.validity).toBe('valid');
  await expect(shownScore(page)).toHaveText(format(result.score));
  expect(provisional).toBe(format(result.score));
  await expect(page.locator('[data-summary="caption"]')).toHaveText('');
  // The trusted result replaced the preview in place: the predictions are now confirmed, and nothing moved.
  await expect(record(page)).toHaveAttribute('data-pending', 'false');
  await expect(unlock(page)).toHaveAttribute('data-pending', 'false');
  expect(await layout()).toEqual(provisionalLayout);

  // 2. The difficulty points and speed bonus come from the server's result.metrics.
  await expect(page.locator('[data-result="difficulty-points"]')).toHaveText(format(result.metrics.difficultyPoints));
  await expect(page.locator('[data-result="speed-bonus"]')).toHaveText(`+${format(result.metrics.speedBonusPoints)}`);
  expect(result.metrics.difficultyPoints + result.metrics.speedBonusPoints).toBe(result.score);
  await page.getByText('How scoring works', { exact: true }).click();
  await expect(page.getByText(/Each correct answer earns its level’s difficulty points/)).toBeVisible();

  // 3 and 5. The first run at level 1 is a new best, and its unlock is the server's.
  expect(result.personalBest).toBe(true);
  expect(result.unlocked).toEqual([{ modeId: 'timed-90', startLevel: 2 }]);
  await expect(record(page)).toContainText('New personal best');
  await expect(unlock(page)).toHaveText('Level 2 unlockedYou can now start a run at level 2.');
  await expect(page.locator('[data-total="runs-completed"]')).toHaveText('1');

  // 5. The newly unlocked start level is selectable in the picker.
  await playAgain(page);
  await expect(page.getByRole('radio', { name: 'Level 2', exact: true })).toBeEnabled();
  await expect(page.getByRole('radio', { name: 'Level 3 (locked)', exact: true })).toBeDisabled();
  await page.getByRole('radio', { name: 'Level 2', exact: true }).check({ force: true });
  await expect(page.getByRole('button', { name: 'Start at level 2', exact: true })).toBeEnabled();
});

test('a lower-scoring repeat is not a new best, and each start level keeps its own best', async ({ page }) => {
  test.setTimeout(180_000);
  const uid = await openMentalMath(page);

  await playRun(page, 1, CLIMB);
  await expectVerified(page);
  const levelOne = await newestResult(uid);
  await expect(record(page)).toContainText('New personal best');

  // 3. A weaker run from the same start level: no new best, and the best to beat is named.
  await playAgain(page);
  await playRun(page, 1, WEAK);
  await expectVerified(page);
  const repeat = await newestResult(uid);
  expect(repeat.score).toBeLessThan(levelOne.score);
  expect(repeat.personalBest).toBe(false);
  await expect(record(page)).toHaveText(`Your best from level 1: ${format(levelOne.score)}Each start level has its own records.`);
  await expect(page.getByText('New personal best')).toHaveCount(0);

  // 4. A run from level 2 has its own record class: its first run is a new best there, whatever level 1's best is.
  await playAgain(page);
  await page.getByRole('radio', { name: 'Level 2', exact: true }).check({ force: true });
  await playRun(page, 2, WEAK);
  await expectVerified(page);
  const levelTwo = await newestResult(uid);
  expect(levelTwo.personalBest).toBe(true);
  await expect(record(page)).toContainText('New personal best');
  await expect(record(page)).toContainText('From level 2:');

  // The game's progress keeps the two bests apart.
  await page.getByRole('button', { name: 'Records and history', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your Mental Math', exact: true })).toBeFocused();
  await expect(page.locator('[data-best-level="1"] [data-best="score"]')).toHaveText(format(levelOne.score));
  await expect(page.locator('[data-best-level="2"] [data-best="score"]')).toHaveText(format(levelTwo.score));
  await expect(page.locator('[data-total="runs-completed"]')).toHaveText('3');
});

test('the game’s progress shows per-game totals and a cursor-paged history of runs', async ({ page }) => {
  test.setTimeout(150_000);
  const uid = await openMentalMath(page);
  await playRun(page, 1, WEAK);
  await expectVerified(page);
  const completed = await newestResult(uid);

  // Ten more runs, each quit after a second of play: they count in history and time played, not as completed.
  // Page time keeps running from the finished run (about 90 s ahead, well inside the rules' 5 minutes),
  // so every quit run ends after it and the history order is the order they were played.
  for (let run = 0; run < 10; run += 1) {
    await playAgain(page);
    await startRun(page, 1);
    await page.clock.runFor(1_000);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.getByRole('button', { name: 'Quit run', exact: true }).click();
    await expect(page.locator('#mm-handoff-title')).toHaveText('Run ended early');
    await page.clock.resume();
    await expect(record(page)).toContainText('Unfinished runs don’t set records');
  }
  await expect.poll(async () => (await readGameSessions(uid)).filter((session) => session.data.result !== undefined).length, { timeout: 30_000 }).toBe(11);

  // 6. Per-game totals.
  await page.getByRole('button', { name: 'Records and history', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your Mental Math', exact: true })).toBeVisible();
  await expect(page.locator('[data-total="runs-completed"]')).toHaveText('1');
  await expect(page.locator('[data-total="time-played"]')).toHaveText('1\u00A0min 40\u00A0s');
  await expect(page.locator('[data-total="unlocked"]')).toHaveText('1 of 10');

  // 6. History: the newest ten, then the next page from the cursor, with nothing repeated.
  const rows = page.locator('li[data-history-row]');
  await expect(rows).toHaveCount(10);
  await expectEndedEarly(rows.first());
  await page.getByRole('button', { name: 'Show more runs', exact: true }).click();
  await expect(rows).toHaveCount(11);
  await expect(page.getByRole('button', { name: 'Show more runs', exact: true })).toHaveCount(0);
  const ids = await rows.evaluateAll((items) => items.map((item) => item.getAttribute('data-history-row')));
  expect(new Set(ids).size).toBe(11);
  // The oldest run is the finished one (the player's first, so a new best), with its trusted score in the normal treatment.
  await expect(rows.last().locator('.mm-history-score')).toHaveText(format(completed.score));
  await expect(rows.last()).toHaveAttribute('data-run', 'completed');
  await expect(rows.last().locator('.mm-history-score-muted')).toHaveCount(0);
  await expect(rows.last().locator('[data-history-tag]')).toHaveText('New best');
  await expect(rows.last()).toContainText('Start level 1');

  // The history and totals survive a reload. Home's recent runs show the same rows, ended early, first.
  await page.reload();
  await arriveAtHome(page, { afterReload: true });
  const homeRows = page.locator('[data-overview="recent-runs"] li[data-history-row]');
  await expect(homeRows).toHaveCount(3);
  for (const row of await homeRows.all()) await expectEndedEarly(row);
  await page.getByRole('button', { name: 'Progress', exact: true }).click();
  await page.getByRole('button', { name: 'Mental Math records and history', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your Mental Math', exact: true })).toBeVisible();
  await expect(page.locator('[data-total="runs-completed"]')).toHaveText('1');
  await expect(rows).toHaveCount(10);
  await expectEndedEarly(rows.first());
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your Progress', exact: true })).toBeVisible();
});

test('simulated EEG never changes the server score, and nothing EEG-derived appears in the summary or progress', async ({ page }) => {
  test.setTimeout(150_000);
  const uid = await openMentalMath(page);

  await playRun(page, 1, CLIMB);
  await expectVerified(page);
  const withoutEeg = await newestResult(uid);

  await playAgain(page);
  await page.getByRole('checkbox', { name: /Use Simulated EEG \(Demo Mode\)/ }).check();
  await realWallClock(page);
  await startRun(page, 1);
  await expect(page.getByText('Simulated EEG (Demo Mode): simulated, not measured', { exact: true })).toBeVisible();
  for (const correct of CLIMB) await answer(page, correct);
  await runOut(page);
  await expectVerified(page);
  const withEeg = await newestResult(uid);

  // 7. The same seeded run scores the same on the server, with and without simulated EEG.
  expect(withEeg.validity).toBe('valid');
  expect(withEeg.score).toBe(withoutEeg.score);
  expect(withEeg.metrics).toEqual(withoutEeg.metrics);
  await expect(shownScore(page)).toHaveText(format(withoutEeg.score));
  // An equal score from the same start level does not take the record: the earlier run keeps it.
  await expect(record(page)).toHaveText(`Your best from level 1: ${format(withoutEeg.score)}Each start level has its own records.`);

  // Nothing EEG-derived in the results, totals or progress; only the recording's own save status mentions EEG.
  const eegWords = /EEG|µV|alpha|theta|beta|gamma|delta|focus|calm|zone/i;
  for (const section of await page.locator('.mm-summary > section').all()) {
    await expect(section).not.toContainText(eegWords);
  }
  await page.getByRole('button', { name: 'Records and history', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your Mental Math', exact: true })).toBeVisible();
  await expect(page.locator('li[data-history-row]')).toHaveCount(2);
  await expect(page.locator('.mm-progress')).not.toContainText(eegWords);
});

// NFCT-52: leaving the game. On a phone the summary's sticky Done sits right
// over the bottom navigation that replaces it; the player here is
// self-directed (Home, Train, Progress and Profile), as in the QA report,
// where a double tap on Done opened Progress.
test.describe('leaving Mental Math on a phone', () => {
  const { viewport, deviceScaleFactor, isMobile, hasTouch } = devices['iPhone 17'];
  test.use({ viewport, deviceScaleFactor, isMobile, hasTouch });

  /** Signs up a new player through the UI and opens the Train tab. */
  async function signUpAndOpenTrain(page: Page): Promise<void> {
    await page.goto('/#/signup');
    await page.getByPlaceholder('How should we call you?').fill('Leaving Mental Math');
    await page.getByPlaceholder('you@example.com').fill(`leave-mm-${randomUUID().slice(0, 12)}@example.test`);
    await page.getByPlaceholder('At least 6 characters').fill('LocalEmulator!123');
    await page.getByRole('button', { name: 'Create Account' }).click();
    await arriveAtHome(page);
    await page.getByRole('button', { name: 'Train', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Train', exact: true })).toBeVisible();
  }

  const trainHeading = (page: Page) => page.getByRole('heading', { level: 1, name: 'Train', exact: true });
  const mentalMathCard = (page: Page) => page.getByRole('main').getByRole('button', { name: 'Mental Math', exact: true });

  /**
   * A quit run's summary, opened from `opener` (Train's Mental Math card by default), with page time stopped (it
   * moves only with runFor). Returns the centre of Done, and a count of the input events that reach the page,
   * taken before the app (or its guard) sees them.
   */
  async function quitToSummary(page: Page, opener = mentalMathCard(page)): Promise<{ x: number; y: number; seen: (type: string) => Promise<number> }> {
    await opener.tap();
    await expect(page.getByRole('radio', { name: 'Level 1', exact: true })).toBeChecked();
    await startRun(page, 1);
    await page.clock.runFor(1_000);
    await page.getByRole('button', { name: 'Pause', exact: true }).tap();
    await page.getByRole('button', { name: 'Quit run', exact: true }).tap();
    await expect(page.locator('#mm-handoff-title')).toHaveText('Run ended early');
    await page.evaluate(() => {
      const seen: Record<string, number> = {};
      (window as unknown as { nfctInput: Record<string, number> }).nfctInput = seen;
      for (const type of ['pointerdown', 'pointerup', 'click']) window.addEventListener(type, () => { seen[type] = (seen[type] ?? 0) + 1; }, { capture: true });
    });
    const done = await page.getByRole('button', { name: 'Done', exact: true }).boundingBox();
    return {
      x: done!.x + done!.width / 2,
      y: done!.y + done!.height / 2,
      seen: (type) => page.evaluate((name) => (window as unknown as { nfctInput: Record<string, number> }).nfctInput[name] ?? 0, type),
    };
  }

  test('a double tap on Done closes the game once: the second tap never opens the tab under it, and focus returns to the game’s card', async ({ page, browserName }) => {
    await page.clock.install();
    await signUpAndOpenTrain(page);
    // Page time stops in the run and moves only with runFor, so the taps below are exactly 150 ms apart.
    const { x, y, seen } = await quitToSummary(page);

    await page.touchscreen.tap(x, y);
    await expect(trainHeading(page)).toBeVisible();
    await expect(mentalMathCard(page)).toBeFocused();
    // The bottom tab now under the finger.
    expect(await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest('button')?.textContent?.trim(), [x, y])).toBe('Progress');

    await page.clock.runFor(150);
    await page.touchscreen.tap(x, y);
    // The second tap reached the page and was dropped there: Train stays, with focus on the card.
    // Dropping its press makes WebKit cancel the click too; Chromium still sends the click, which is dropped as well.
    await expect.poll(() => seen('pointerdown')).toBe(2);
    if (browserName === 'chromium') await expect.poll(() => seen('click')).toBe(2);
    await expect(trainHeading(page)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your Progress', exact: true })).toHaveCount(0);
    await expect(mentalMathCard(page)).toBeFocused();

    // Once the double-tap window has passed, a tap on the same spot opens Progress.
    await page.clock.runFor(500);
    await page.touchscreen.tap(x, y);
    await expect(page.getByRole('heading', { name: 'Your Progress', exact: true })).toBeVisible();
  });

  test('a second press made inside the double-tap window but released after it still never opens the tab under Done', async ({ page }) => {
    await page.clock.install();
    await signUpAndOpenTrain(page);
    const { x, y, seen } = await quitToSummary(page);
    await page.touchscreen.tap(x, y);
    await expect(trainHeading(page)).toBeVisible();

    // Pressed 350 ms after Done, released at 450 ms: past the 400 ms window, the click still belongs to that press.
    await page.clock.runFor(350);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.clock.runFor(100);
    const released = await seen('pointerup');
    await page.mouse.up();
    // A click follows its pointerup in the same task, so once the release has been seen, its click has been handled.
    await expect.poll(() => seen('pointerup')).toBe(released + 1);
    await expect(trainHeading(page)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your Progress', exact: true })).toHaveCount(0);

    await page.clock.runFor(1_100);
    await page.touchscreen.tap(x, y);
    await expect(page.getByRole('heading', { name: 'Your Progress', exact: true })).toBeVisible();
  });

  test('Done on a scrolled summary returns to the top of the screen that opened the game, with its opener in view and focused', async ({ page }) => {
    await page.clock.install();
    await signUpAndOpenTrain(page);
    const scrollY = () => page.evaluate(() => window.scrollY);
    const doneAtTheBottom = async () => {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      expect(await scrollY()).toBeGreaterThan(0);
      await page.getByRole('button', { name: 'Done', exact: true }).tap();
    };

    // From Train.
    await quitToSummary(page);
    await doneAtTheBottom();
    await expect(trainHeading(page)).toBeVisible();
    expect(await scrollY()).toBe(0);
    await expect(mentalMathCard(page)).toBeInViewport();
    await expect(mentalMathCard(page)).toBeFocused();

    // From Home's Play (NFCT-13): the Play card and the streak are on screen, not above it.
    // Page time flows again so the picker can load the player's levels; the next run stops it again.
    await page.clock.resume();
    await page.getByRole('button', { name: 'Home', exact: true }).tap();
    const homePlay = page.getByRole('main').getByRole('button', { name: 'Play Mental Math', exact: true });
    await quitToSummary(page, homePlay);
    await doneAtTheBottom();
    await expect(homePlay).toBeInViewport();
    expect(await scrollY()).toBe(0);
    await expect(homePlay).toBeFocused();
  });

  test('Back returns focus to the control that opened each screen', async ({ page }) => {
    await signUpAndOpenTrain(page);

    // Train → Mental Math: the picker's heading has focus; its Progress and Back return it.
    await mentalMathCard(page).click();
    await expect(page.getByRole('heading', { name: 'Mental Math', exact: true })).toBeFocused();
    const topBarProgress = page.getByRole('button', { name: 'Progress', exact: true });
    await topBarProgress.click();
    await expect(page.getByRole('heading', { name: 'Your Mental Math', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(topBarProgress).toBeFocused();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(trainHeading(page)).toBeVisible();
    await expect(mentalMathCard(page)).toBeFocused();

    // Home's Play button (NFCT-13) → the picker → Back.
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    const homePlay = page.getByRole('main').getByRole('button', { name: 'Play Mental Math', exact: true });
    await homePlay.click();
    await expect(page.getByRole('heading', { name: 'Mental Math', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(homePlay).toBeFocused();

    // The Progress tab's Records button → the game's progress → Back.
    await page.getByRole('button', { name: 'Progress', exact: true }).click();
    const records = page.getByRole('button', { name: 'Mental Math records and history', exact: true });
    await records.click();
    await expect(page.getByRole('heading', { name: 'Your Mental Math', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your Progress', exact: true })).toBeVisible();
    await expect(records).toBeFocused();
  });
});
