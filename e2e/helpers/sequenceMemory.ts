import type { Page } from '@playwright/test';
import { LEAD_IN_MS, levelParams } from '../../shared/games/sequence-memory/v1/params';
import { expect } from '../fixtures';

// Sequence Memory driven through the signed-in UI (NFCT-93). Time is
// Playwright's page.clock: the game reads time only through performance.now()
// and standard timers, so a run takes no real time. The sequence is read off
// the board as a player sees it (the lit tile), at the middle of each tile's
// lit time, never from the app's state. Taps are 400 ms apart, well above the
// 100 ms plausibility floor.

/** The run controller's correct/wrong flash, off the run clock. */
export const FEEDBACK_MS = 700;
/** Page time between taps. */
export const TAP_MS = 400;

export const hud = (page: Page, name: string) => page.locator(`[data-hud="${name}"]`);
export const status = (page: Page) => page.locator('[data-sm="status"]');
export const tile = (page: Page, index: number) => page.locator(`.sm-board [data-tile="${index}"]`);
export const litTiles = (page: Page) => page.locator('.sm-board [data-lit="true"]');

/** The picker has loaded the player's levels from the server. */
export async function expectPickerReady(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Sequence Memory', exact: true })).toBeVisible();
  await expect(page.locator('#sm-levels-help')).not.toHaveText('Loading your levels…', { timeout: 20_000 });
  await expect(page.getByRole('button', { name: /^Start at level \d+$/ })).toBeEnabled();
}

/** Starts the run with page time frozen, so only runFor moves the game clock. */
export async function startRun(page: Page, level: number): Promise<void> {
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
  await page.getByRole('button', { name: `Start at level ${level}`, exact: true }).click();
  await expect(hud(page, 'level')).toHaveText(String(level));
  await expect(status(page)).toHaveText('Watch the sequence');
}

/**
 * Watches the presentation that has just begun and returns the lit tiles in
 * order, then waits for the response phase. `level` is the HUD's level.
 */
export async function watchSequence(page: Page): Promise<number[]> {
  const level = Number(await hud(page, 'level').innerText());
  const { span, litMs, gapMs, presentationMs } = levelParams(level);
  const seen: number[] = [];
  let at = 0;
  for (let step = 0; step < span; step += 1) {
    const middle = LEAD_IN_MS + step * (litMs + gapMs) + Math.floor(litMs / 2);
    await page.clock.runFor(middle - at);
    at = middle;
    await expect(litTiles(page)).toHaveCount(1);
    await expect(litTiles(page)).toHaveAttribute('data-lit-step', String(step));
    seen.push(Number(await litTiles(page).getAttribute('data-tile')));
  }
  await page.clock.runFor(presentationMs - at);
  await expect(status(page)).toHaveText(`Your turn: tap ${span} tiles in order`);
  await expect(litTiles(page)).toHaveCount(0);
  return seen;
}

/**
 * Presses a tile as the device would: a touch tap on a touch device (the
 * WebKit iPhone projects), a mouse click otherwise. Either way the press is
 * followed by a click, which the board must not count twice.
 */
export async function pressTile(page: Page, index: number): Promise<void> {
  const touch = await page.evaluate(() => navigator.maxTouchPoints > 0);
  if (touch) await tile(page, index).tap();
  else await tile(page, index).click();
}

/** Taps `tiles` in order, TAP_MS apart, then waits out the feedback flash. */
export async function tapTiles(page: Page, tiles: readonly number[], expected: 'Correct' | 'Not quite'): Promise<void> {
  for (const index of tiles) {
    await page.clock.runFor(TAP_MS);
    await pressTile(page, index);
  }
  await expect(status(page)).toHaveText(expected);
  await page.clock.runFor(FEEDBACK_MS);
}

/** A tile of the board that is not `index`. */
export async function otherTile(page: Page, index: number): Promise<number> {
  const count = await page.locator('.sm-board [data-tile]').count();
  return (index + 1) % count;
}

/** Plays the trial on screen: the whole sequence back, or a wrong first tile. Returns the sequence shown. */
export async function playTrial(page: Page, correct: boolean): Promise<number[]> {
  const sequence = await watchSequence(page);
  await tapTiles(page, correct ? sequence : [await otherTile(page, sequence[0]!)], correct ? 'Correct' : 'Not quite');
  return sequence;
}
