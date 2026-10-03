import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { arriveAtHome, authenticatedUserId } from './helpers/auth';
import { completeConsumerOnboarding, openGameFromTrain, signUpFreshAccountThroughUi } from './helpers/journeys';
import { readGameSessions, readPlayerStats } from './helpers/localEmulator';
import { expectPickerReady, hud, litTiles, playTrial, pressTile, startRun, status, tapTiles, tile, watchSequence } from './helpers/sequenceMemory';
import { LEAD_IN_MS, TRIALS_PER_RUN, levelParams } from '../shared/games/sequence-memory/v1/params';

// NFCT-93: Sequence Memory played end to end by a fresh account, from the
// Train tab, against the local emulators with trusted scoring (the suite runs
// the Functions emulator). Runs use page.clock; the sequence is read off the
// board. The only real-time waits poll for the save and the server's result,
// which are read back as observation only, never written by the test.

async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((isHidden) => {
    if (isHidden) Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    else delete (document as { visibilityState?: unknown }).visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

type StoredTrial = { level: number; sequence: number[]; response: number[]; correct: boolean; timedOut: boolean };

test('a fresh player plays Sequence Memory from Train: pauses discard the trial, the run is verified, and survives a reload', async ({ page }) => {
  test.setTimeout(240_000);
  await page.clock.install();
  await signUpFreshAccountThroughUi(page, {
    displayName: 'Sequence Player',
    email: `sequence-memory-${randomUUID().slice(0, 12)}@example.test`,
    password: 'LocalEmulator!123',
  });
  await completeConsumerOnboarding(page);
  const uid = await authenticatedUserId(page);

  await openGameFromTrain(page, 'Sequence Memory');
  await expectPickerReady(page);
  await expect(page.locator('#sm-levels-help')).toHaveText('Reach higher levels during a run to unlock higher start levels.');
  await expect(page.getByRole('radio', { name: 'Level 1', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Level 2 (locked)', exact: true })).toBeDisabled();

  await startRun(page, 1);
  await expect(hud(page, 'trial')).toHaveText(`1/${TRIALS_PER_RUN}`);
  await expect(page.locator('.sm-board [data-tile]')).toHaveCount(9);

  // Backgrounded during the presentation: paused, the trial discarded.
  const { litMs } = levelParams(1);
  await page.clock.runFor(LEAD_IN_MS + Math.floor(litMs / 2));
  await expect(litTiles(page)).toHaveCount(1);
  await setHidden(page, true);
  await expect(page.getByRole('heading', { name: 'Paused', exact: true })).toBeVisible();
  await expect(page.getByText('The run paused while the app was in the background.', { exact: false })).toBeVisible();
  await expect(page.locator('.sm-board')).toHaveCount(0);
  await page.clock.runFor(30_000);
  await setHidden(page, false);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  // A fresh trial at the same position, from its start.
  await expect(hud(page, 'trial')).toHaveText(`1/${TRIALS_PER_RUN}`);
  await expect(status(page)).toHaveText('Watch the sequence');
  await expect(litTiles(page)).toHaveCount(0);

  const shown: number[][] = [];
  shown.push(await playTrial(page, true));

  // Paused during the response, after one tap: that trial is discarded too.
  const partial = await watchSequence(page);
  await page.clock.runFor(400);
  await pressTile(page, partial[0]!);
  await expect(status(page)).toHaveText(`1 of ${partial.length}`);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByText('1 of 20 sequences done.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(hud(page, 'trial')).toHaveText(`2/${TRIALS_PER_RUN}`);

  // The rest of the run: every fifth trial missed.
  for (let trial = 1; trial < TRIALS_PER_RUN; trial += 1) {
    if (trial === TRIALS_PER_RUN - 1) {
      // The last trial is tapped back with the keyboard: Enter on a focused tile taps it.
      const sequence = await watchSequence(page);
      for (const index of sequence) {
        await page.clock.runFor(400);
        await tile(page, index).focus();
        await page.keyboard.press('Enter');
      }
      await expect(status(page)).toHaveText('Correct');
      shown.push(sequence);
      await page.clock.runFor(700);
    } else {
      shown.push(await playTrial(page, trial % 5 !== 3));
    }
  }

  await expect(page.locator('#sm-handoff-title')).toHaveText('Run complete');
  await expect(page.locator('#sm-handoff-title')).toBeFocused();
  await expect(page.locator('[data-stat="correct"]')).toHaveText(`16 of ${TRIALS_PER_RUN}`);
  // This device's result first, marked pending; then the save, then trusted scoring's result.
  await expect(page.locator('[data-summary="verification"]')).toHaveText('Pending');
  const provisional = await page.locator('[data-result="score"]').innerText();
  await page.clock.resume();
  await expect(page.locator('.mm-save')).toHaveText('Run saved to your account.', { timeout: 20_000 });
  await expect(page.locator('[data-summary="verification"]')).toHaveText('Final', { timeout: 30_000 });
  await expect(page.locator('[data-result="score"]')).toHaveText(provisional);
  await expect(page.locator('[data-summary="record"]')).toContainText('New personal best');

  // What the client saved and trusted scoring decided (observation only).
  const sessions = await readGameSessions(uid);
  expect(sessions).toHaveLength(1);
  const session = sessions[0]!.data;
  expect(session).toMatchObject({ gameId: 'sequence-memory', gameVersion: 1, modeId: 'standard', status: 'completed', startLevel: 1 });
  const trials = session.trials as StoredTrial[];
  expect(trials).toHaveLength(TRIALS_PER_RUN);
  // The trials are exactly the sequences shown after each pause: the discarded ones left nothing.
  expect(trials.map((trial) => trial.sequence)).toEqual(shown);
  expect(trials.filter((trial) => trial.correct)).toHaveLength(16);
  const result = session.result as { validity: string; reasons: string[]; score: number; peakLevel: number; unlocked: Array<{ startLevel: number }> };
  expect(result.validity).toBe('valid');
  // The fast-forwarded run ends minutes ahead of the emulator's clock: that diagnostic, and nothing else.
  expect(result.reasons.filter((reason) => reason !== 'device-clock-ahead')).toEqual([]);
  expect(new Intl.NumberFormat('en-US').format(result.score)).toBe(provisional);
  const unlockedTo = Math.max(1, ...result.unlocked.map((entry) => entry.startLevel));
  expect(unlockedTo).toBeGreaterThan(1);
  const stats = await readPlayerStats(uid);
  expect(stats.summary).toMatchObject({ sessionsCompleted: 1, validRuns: 1, bestPeakLevel: { 'sequence-memory': result.peakLevel } });

  // After a reload: the saved run counts on Progress, and its unlock is offered on the picker.
  await page.reload();
  await arriveAtHome(page, { afterReload: true });
  // A player whose only runs are Sequence Memory has played: Home does not treat them as new.
  await expect(page.locator('[data-overview="hero-text"]')).not.toContainText('Finish your first run');
  await expect(page.locator('[data-overview="recent-runs"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Progress', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your Progress', exact: true })).toBeVisible();
  await expect(page.locator('[data-overview="progress-empty"]')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('No runs yet');
  const card = page.getByRole('region', { name: 'Sequence Memory', exact: true });
  await expect(card.locator('[data-progress-card="summary"]')).toHaveText(`1 run completed · ${unlockedTo} of 10 start levels unlocked`);
  await card.getByRole('button', { name: 'Play Sequence Memory', exact: true }).click();
  await expectPickerReady(page);
  await expect(page.getByRole('radio', { name: `Level ${unlockedTo}`, exact: true })).toBeEnabled();
  await expect(page.getByRole('radio', { name: `Level ${unlockedTo + 1} (locked)`, exact: true })).toBeDisabled();
  await page.getByRole('radio', { name: 'Level 1', exact: true }).check({ force: true });
  await expect(page.locator('[data-picker="best"]')).toHaveText(`Your best from level 1: ${provisional}`);
});

test('quitting a Sequence Memory run saves it as unfinished, and it counts in no record', async ({ page }) => {
  test.setTimeout(120_000);
  await page.clock.install();
  await signUpFreshAccountThroughUi(page, {
    displayName: 'Sequence Quitter',
    email: `sequence-quit-${randomUUID().slice(0, 12)}@example.test`,
    password: 'LocalEmulator!123',
  });
  await completeConsumerOnboarding(page);
  const uid = await authenticatedUserId(page);
  await openGameFromTrain(page, 'Sequence Memory');
  await expectPickerReady(page);
  await startRun(page, 1);
  const sequence = await watchSequence(page);
  await tapTiles(page, sequence, 'Correct');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Quit run', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Run ended early', exact: true })).toBeVisible();
  await page.clock.resume();
  await expect(page.locator('.mm-save')).toHaveText('Run saved to your account.', { timeout: 20_000 });
  await expect(page.locator('[data-summary="verification"]')).toHaveText('Final', { timeout: 30_000 });
  await expect(page.locator('[data-summary="record"]')).toContainText('Unfinished runs don’t set records');
  const [session] = await readGameSessions(uid);
  expect(session!.data).toMatchObject({ gameId: 'sequence-memory', status: 'abandoned' });
  expect((session!.data.trials as StoredTrial[])).toHaveLength(1);
  expect((session!.data.result as { validity: string }).validity).toBe('valid');
});
