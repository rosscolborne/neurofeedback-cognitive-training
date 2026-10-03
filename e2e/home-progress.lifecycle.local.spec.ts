import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { arriveAtHome, loginThroughUi } from './helpers/auth';
import { readGameSessions, readPlayerStats, seedPlayer } from './helpers/localEmulator';
import { formatPlayTime } from '../src/consumer/games/mentalMath/progressSummary';
import { answer, runOut, startRun } from './helpers/mentalMath';

// NFCT-13 part 2: Home and Progress around streaks, the week and
// achievements, from the aggregates trusted scoring maintains (the suite runs
// the Functions emulator, so onGameSessionCreated writes stats/summary,
// dailyStats and achievements with the session's result). Runs use NFCT-21's
// page.clock and fixed seed (e2e/helpers/mentalMath.ts); the only real-time
// waits poll for the server's result. What the server wrote is read back as
// observation only, never written by the test.

/** Seven right answers from level 1: a valid finished run that reaches level 3. */
const CLIMB = [true, true, true, true, true, true, true];

const overview = (page: Page, name: string) => page.locator(`[data-overview="${name}"]`);
const achievementRow = (page: Page, id: string) => page.locator(`[data-achievement="${id}"]`);

/**
 * Keeps the run and "today" on Home on the same local date: near midnight,
 * page time moves back to 23:00 of the day that is ending (or has just
 * ended), so the run cannot straddle the date change. A device clock behind
 * the server's is what an offline device produces; the session's local date
 * stays within the server's one-day check, so its day still counts as a
 * verified training day. Returns the page's local date for the run.
 */
async function awayFromMidnight(page: Page): Promise<string> {
  const target = await page.evaluate(() => {
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    if (minutes >= 23 * 60 + 30 || minutes < 15) {
      if (minutes < 15) now.setDate(now.getDate() - 1);
      now.setHours(23, 0, 0, 0);
      return now.getTime();
    }
    return null;
  });
  if (target !== null) await page.clock.setSystemTime(target);
  return page.evaluate(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  });
}

test('a first run from Home shows a one-day streak, this week and the first achievement on Home and Progress', async ({ page }) => {
  test.setTimeout(150_000);
  await page.clock.install();
  const fixture = await seedPlayer();
  const uid = fixture.player.uid;
  await loginThroughUi(page, fixture.player);
  await arriveAtHome(page);

  // A new player: Home invites a first run instead of showing zeros.
  await expect(overview(page, 'hero-text')).toHaveText(
    'Quick arithmetic against the clock that adapts as you play. Finish your first run to start a streak and earn your first achievement.',
  );
  await expect(overview(page, 'streak-card')).toHaveCount(0);
  await expect(overview(page, 'home-achievements')).toHaveCount(0);
  // Home is the games: no neurofeedback training.
  await expect(page.locator('main')).not.toContainText(/Neurofeedback|NeuroGambit|Begin Session/);

  await page.getByRole('button', { name: 'Progress', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your Progress', exact: true })).toBeVisible();
  await expect(overview(page, 'progress-empty')).toContainText('No runs yet');
  await expect(overview(page, 'achievement-count')).toHaveText('0 of 9 earned');
  // Progress is the games: no neurofeedback session history.
  await expect(page.locator('main')).not.toContainText(/Neurofeedback|Session History|target zone/);

  // Play now, from Home: the existing Mental Math launch path.
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'Play Mental Math', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mental Math', exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Level 1', exact: true })).toBeChecked();
  const today = await awayFromMidnight(page);
  await startRun(page, 1);
  for (const correct of CLIMB) await answer(page, correct);
  await runOut(page);
  await page.clock.resume();
  await expect(page.locator('[data-summary="verification"]')).toHaveText('Final', { timeout: 30_000 });

  // What trusted scoring wrote in the same commit as the result (observation only).
  const [session] = await readGameSessions(uid);
  expect((session!.data.result as { validity: string }).validity).toBe('valid');
  expect(session!.data.localDate).toBe(today);
  const stats = await readPlayerStats(uid);
  expect(stats.summary).toMatchObject({ sessionsCompleted: 1, validRuns: 1, streak: { runs: [{ start: today, end: today }], longest: 1 } });
  expect(stats.achievements.map((entry) => entry.id)).toEqual(['first-run']);

  // Done returns to Home, which now shows the streak, the week and the achievement.
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(overview(page, 'streak')).toHaveText('1');
  await expect(overview(page, 'streak-caption')).toHaveText('Come back tomorrow to make it 2 days.');
  await expect(overview(page, 'hero-text')).toHaveText('You’ve trained today. Play again to chase a new best.');
  const strip = page.getByRole('list', { name: 'This week’s training days' }).getByRole('listitem');
  await expect(strip).toHaveCount(7);
  await expect(strip.and(page.locator('[data-trained="true"]'))).toHaveCount(1);
  await expect(page.locator(`.ov-week-day[data-date="${today}"]`)).toHaveAttribute('data-trained', 'true');
  // A time-bank run (NFCT-60) lasts as long as its answers earned.
  await expect(overview(page, 'week-summary')).toHaveText(`This week: 1 finished run · ${formatPlayTime(session!.data.activeDurationMs as number)} played`);
  // The seeded consumer profile sets no weekly goal (weeklyGoal: null), so none is shown.
  await expect(overview(page, 'weekly-goal')).toHaveCount(0);
  await expect(overview(page, 'achievement-count')).toHaveText('1 of 9 earned');
  await expect(achievementRow(page, 'first-run')).toHaveAttribute('data-earned', 'true');
  await expect(achievementRow(page, 'first-run')).toContainText('Earned');
  await expect(overview(page, 'recent-runs').locator('li[data-history-row]')).toHaveCount(1);
  await expect(overview(page, 'recent-runs')).toContainText('New best');

  // Progress lists it as earned, with the run on this week's calendar.
  await page.getByRole('button', { name: 'See all achievements', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your Progress', exact: true })).toBeVisible();
  await expect(overview(page, 'current-streak')).toHaveText('1 day');
  await expect(overview(page, 'longest-streak')).toHaveText('1 day');
  await expect(overview(page, 'runs-finished')).toHaveText('1');
  await expect(overview(page, 'period-active-days')).toHaveText('1');
  await expect(page.locator(`.ov-cal-day[data-date="${today}"]`)).toHaveAttribute('data-active', 'true');
  await expect(overview(page, 'achievement-count')).toHaveText('1 of 9 earned');
  await expect(page.getByRole('list', { name: 'Earned achievements, newest first' }).getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('list', { name: 'Earned achievements, newest first' })).toContainText('First run');
  await expect(page.getByRole('list', { name: 'Achievements not earned yet' }).getByRole('listitem')).toHaveCount(8);
  // Nothing EEG-derived in the game progress.
  await expect(overview(page, 'progress')).not.toContainText(/EEG|µV|alpha|theta|beta|gamma|zone|neurofeedback/i);

  // It survives a reload.
  await page.reload();
  await arriveAtHome(page, { afterReload: true });
  await expect(overview(page, 'streak')).toHaveText('1');
  await expect(achievementRow(page, 'first-run')).toHaveAttribute('data-earned', 'true');

  // NFCT-66: after the reload, the run is resolved everywhere it is listed, with the trusted score, nothing
  // pending, and no copy about how it was scored. Home's recent runs first, then the game's full history.
  const score = new Intl.NumberFormat('en-US').format((session!.data.result as { score: number }).score);
  const homeRow = overview(page, 'recent-runs').locator('li[data-history-row]');
  await expect(homeRow).toHaveCount(1);
  await expect(homeRow.locator('.mm-history-score')).toHaveText(score);
  await expect(homeRow).not.toContainText('Pending');
  const noBackendCopy = /server|being checked|confirm|verif|provisional|processing/i;
  await expect(overview(page, 'home')).not.toContainText(noBackendCopy);
  await page.getByRole('button', { name: 'All Mental Math runs and records', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your Mental Math', exact: true })).toBeVisible();
  const historyRow = page.getByRole('list', { name: 'Runs, newest first' }).getByRole('listitem');
  await expect(historyRow).toHaveCount(1);
  await expect(historyRow.locator('.mm-history-score')).toHaveText(score);
  await expect(historyRow).toContainText('New best');
  await expect(historyRow).not.toContainText('Pending');
  await expect(page.locator('.mm-progress')).not.toContainText(noBackendCopy);
});
