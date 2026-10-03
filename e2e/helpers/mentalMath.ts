import type { Page } from '@playwright/test';
import { evaluate } from '../../shared/games/mental-math/v1/questions';
import type { Operator } from '../../shared/games/mental-math/v1/params';
import { expect } from '../fixtures';
import { arriveAtHome, loginThroughUi } from './auth';
import { seedPlayer } from './localEmulator';

// Mental Math driven through the signed-in UI (NFCT-21, NFCT-22). Time is
// Playwright's page.clock: the game reads time only through performance.now()
// and standard timers, so a run takes no real time. The E2E
// dev server gives every session the same fixed seed (VITE_E2E_EMULATORS
// only), and each answer is computed from the rendered question. Every answer
// takes at least 1 s of page time, well above the 250 ms plausibility floor.

/** The run controller's answer-feedback flash, off the run clock. */
export const FEEDBACK_MS = 400;

export type Trial = { level: number; response: number | null; timedOut: boolean; correct: boolean; shownAtMs: number; rtMs: number; timeLimitMs: number };

export function answerOf(text: string): number {
  const tokens = text.replace(/[()]/g, '').split(' ');
  const value = evaluate({
    operands: tokens.filter((_, index) => index % 2 === 0).map(Number),
    operators: tokens.filter((_, index) => index % 2 === 1) as Operator[],
    grouped: text.startsWith('('),
  });
  if (value === null) throw new Error(`Unexpected question: ${text}`);
  return value;
}

export const keypad = (page: Page) => page.getByRole('group', { name: 'Answer keypad' });
export const key = (page: Page, label: string) => keypad(page).getByRole('button', { name: label, exact: true });
export const hud = (page: Page, name: string) => page.locator(`[data-hud="${name}"]`);
export const questionText = async (page: Page) => (await page.locator('.mm-question').innerText()).replace(/\s*=$/, '');

/** Signs in a new player through the UI and opens Mental Math from the Train tab; returns the player's uid. */
export async function openMentalMath(page: Page): Promise<string> {
  // Installed before navigation; page time flows normally until a run pauses it.
  await page.clock.install();
  const fixture = await seedPlayer();
  await loginThroughUi(page, fixture.player);
  await arriveAtHome(page);
  await page.getByRole('button', { name: 'Train', exact: true }).click();
  await page.getByRole('button', { name: 'Mental Math', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mental Math', exact: true })).toBeVisible();
  // The levels load from the player's cached progress and sessions.
  await expect(page.getByRole('radio', { name: 'Level 1', exact: true })).toBeChecked();
  return fixture.player.uid;
}

/** Starts the run with page time frozen, so only runFor moves the game clock. */
export async function startRun(page: Page, level: number): Promise<void> {
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
  await page.getByRole('button', { name: `Start at level ${level}`, exact: true }).click();
  await expect(hud(page, 'time')).toHaveText('0:45'); // the starting time bank (NFCT-60)
  await expect(hud(page, 'level')).toHaveText(String(level));
}

export async function waitForQuestion(page: Page): Promise<string> {
  await expect(key(page, '1')).toBeEnabled();
  return questionText(page);
}

export async function typeAnswer(page: Page, value: number): Promise<void> {
  for (const digit of String(value)) await key(page, digit).click();
}

/** Answers the question on screen after `thinkMs` of page time; returns the response typed. */
export async function answer(page: Page, correct: boolean, thinkMs = 1_200): Promise<number> {
  const text = await waitForQuestion(page);
  const response = correct ? answerOf(text) : answerOf(text) + 1;
  await page.clock.runFor(thinkMs);
  await typeAnswer(page, response);
  await key(page, 'Submit').click();
  await expect(page.locator('.mm-feedback')).not.toHaveText('');
  await page.clock.runFor(FEEDBACK_MS);
  return response;
}

/**
 * Lets the remaining active time run out: unanswered questions time out, the
 * last is discarded when the time bank runs out. Page time stops as soon as the run has ended, so
 * the save's own real-time bounds (the EEG consent check gives the server
 * 1.5 s) are not fast-forwarded past before the network can answer.
 */
export async function runOut(page: Page): Promise<void> {
  const ended = page.getByRole('heading', { name: 'Run complete', exact: true });
  for (let step = 0; step < 1_000 && !(await ended.isVisible()); step += 1) {
    const [minutes, seconds] = ((await hud(page, 'time').textContent().catch(() => null)) ?? '0:00').split(':').map(Number);
    // Whole seconds while the run is far from its end, then 100 ms at a time.
    await page.clock.runFor((minutes ?? 0) * 60 + (seconds ?? 0) > 3 ? 1_000 : 100);
  }
  await expect(ended).toBeVisible();
}

/** Page time flows again so the queued write reaches the emulator; the summary reports it. */
export async function expectSaved(page: Page): Promise<void> {
  await page.clock.resume();
  await expect(page.locator('.mm-save')).toHaveText('Run saved to your account.', { timeout: 15_000 });
}
