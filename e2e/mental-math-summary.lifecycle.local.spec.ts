import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { arriveAtPatientDashboard } from './helpers/auth';
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

/** Lets page time flow and waits for trusted scoring to verify the run on screen. */
async function expectVerified(page: Page): Promise<void> {
  await page.clock.resume();
  await expect(verification(page)).toHaveText('Verified', { timeout: 30_000 });
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
  await runOut(page);
  await expect(page.locator('#mm-handoff-title')).toHaveText('Run complete');
  await expect(page.locator('#mm-handoff-title')).toBeFocused();
  await page.clock.resume();
  await expect(page.locator('.mm-save')).toHaveText('Saved on this device. Uploading to your account…');

  // 1. The optimistic preview: this device's score, marked provisional, with its predicted best and unlock.
  await expect(verification(page)).toHaveText('Provisional');
  await expect(page.locator('[data-summary="caption"]')).toHaveText('Provisional. Your run will be checked once it uploads.');
  const provisional = await shownScore(page).innerText();
  await expect(record(page)).toContainText('New personal best');
  await expect(record(page)).toContainText('Confirmed once the server checks your run.');
  await expect(unlock(page)).toContainText('Level 2 unlocked');
  expect(await readGameSessions(uid)).toHaveLength(0);

  // Back online: the run uploads, onGameSessionCreated scores it, and the result replaces the preview.
  await context.setOffline(false);
  await expect(verification(page)).toHaveText('Verified', { timeout: 30_000 });
  const result = await newestResult(uid);
  expect(result.validity).toBe('valid');
  await expect(shownScore(page)).toHaveText(format(result.score));
  expect(provisional).toBe(format(result.score));
  await expect(page.locator('[data-summary="caption"]')).toHaveText('Checked and confirmed by the server.');

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
  await expect(record(page)).not.toContainText('Confirmed once');
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
  await expect(record(page)).toHaveText(`Your best from level 1: ${format(levelOne.score)}Records are kept separately for each start level.`);
  await expect(page.getByText('New personal best')).toHaveCount(0);

  // 4. A run from level 2 has its own record class: its first run is a new best there, whatever level 1's best is.
  await playAgain(page);
  await page.getByRole('radio', { name: 'Level 2', exact: true }).check({ force: true });
  await playRun(page, 2, WEAK);
  await expectVerified(page);
  const levelTwo = await newestResult(uid);
  expect(levelTwo.personalBest).toBe(true);
  await expect(record(page)).toContainText('New personal best');
  await expect(record(page)).toContainText('for runs from level 2');

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
  await expect(rows.first()).toContainText('Ended early');
  await page.getByRole('button', { name: 'Show more runs', exact: true }).click();
  await expect(rows).toHaveCount(11);
  await expect(page.getByRole('button', { name: 'Show more runs', exact: true })).toHaveCount(0);
  const ids = await rows.evaluateAll((items) => items.map((item) => item.getAttribute('data-history-row')));
  expect(new Set(ids).size).toBe(11);
  // The oldest run is the finished one, with its trusted score.
  await expect(rows.last()).toContainText(format(completed.score));
  await expect(rows.last()).toContainText('Start level 1');

  // The history and totals survive a reload.
  await page.reload();
  await arriveAtPatientDashboard(page);
  await page.getByRole('button', { name: 'Progress', exact: true }).click();
  await page.getByRole('button', { name: 'Mental Math records and history', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your Mental Math', exact: true })).toBeVisible();
  await expect(page.locator('[data-total="runs-completed"]')).toHaveText('1');
  await expect(rows).toHaveCount(10);
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
  await expect(record(page)).toHaveText(`Your best from level 1: ${format(withoutEeg.score)}Records are kept separately for each start level.`);

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
