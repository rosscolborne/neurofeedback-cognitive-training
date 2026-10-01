import type { Page } from '@playwright/test';
import { evaluate } from '../shared/games/mental-math/v1/questions';
import type { Operator } from '../shared/games/mental-math/v1/params';
import { E2E_FIXED_SESSION_SEED } from '../src/consumer/repositories/e2eSessionSeed';
import { expect, test } from './fixtures';
import { arriveAtPatientDashboard, loginThroughUi } from './helpers/auth';
import { readEegRecordings, readGameSessions, seedLinkedPatient } from './helpers/localEmulator';

// NFCT-21: Mental Math played end to end through the signed-in UI, against
// the local Auth and Firestore emulators. Time is Playwright's page.clock:
// the game reads time only through performance.now() and standard timers, so
// a 90-second run takes no real 90 seconds. The E2E dev server gives every
// session the same fixed seed (VITE_E2E_EMULATORS only), and each answer is
// computed from the rendered question. Every answer takes at least 1 s of
// page time, well above the 250 ms plausibility floor.

/** The run controller's answer-feedback flash, off the run clock. */
const FEEDBACK_MS = 400;

type Trial = { level: number; response: number | null; timedOut: boolean; correct: boolean; shownAtMs: number; rtMs: number; timeLimitMs: number };

function answerOf(text: string): number {
  const tokens = text.replace(/[()]/g, '').split(' ');
  const value = evaluate({
    operands: tokens.filter((_, index) => index % 2 === 0).map(Number),
    operators: tokens.filter((_, index) => index % 2 === 1) as Operator[],
    grouped: text.startsWith('('),
  });
  if (value === null) throw new Error(`Unexpected question: ${text}`);
  return value;
}

const keypad = (page: Page) => page.getByRole('group', { name: 'Answer keypad' });
const key = (page: Page, label: string) => keypad(page).getByRole('button', { name: label, exact: true });
const hud = (page: Page, name: string) => page.locator(`[data-hud="${name}"]`);
const questionText = async (page: Page) => (await page.locator('.mm-question').innerText()).replace(/\s*=$/, '');

/** Signs in a new player through the UI and opens Mental Math from the Train tab; returns the player's uid. */
async function openMentalMath(page: Page): Promise<string> {
  // Installed before navigation; page time flows normally until a run pauses it.
  await page.clock.install();
  const fixture = await seedLinkedPatient();
  await loginThroughUi(page, fixture.patient);
  await arriveAtPatientDashboard(page);
  await page.getByRole('button', { name: 'Train', exact: true }).click();
  await page.getByRole('button', { name: 'Mental Math', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mental Math', exact: true })).toBeVisible();
  // The levels load from the player's cached progress and sessions.
  await expect(page.getByRole('radio', { name: 'Level 1', exact: true })).toBeChecked();
  return fixture.patient.uid;
}

/** Starts the run with page time frozen, so only runFor moves the game clock. */
async function startRun(page: Page, level: number): Promise<void> {
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
  await page.getByRole('button', { name: `Start at level ${level}`, exact: true }).click();
  await expect(hud(page, 'time')).toHaveText('1:30');
  await expect(hud(page, 'level')).toHaveText(String(level));
}

async function waitForQuestion(page: Page): Promise<string> {
  await expect(key(page, '1')).toBeEnabled();
  return questionText(page);
}

async function typeAnswer(page: Page, value: number): Promise<void> {
  for (const digit of String(value)) await key(page, digit).click();
}

/** Answers the question on screen after `thinkMs` of page time; returns the response typed. */
async function answer(page: Page, correct: boolean, thinkMs = 1_200): Promise<number> {
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
 * last is discarded at 90 s. Page time stops as soon as the run has ended, so
 * the save's own real-time bounds (the EEG consent check gives the server
 * 1.5 s) are not fast-forwarded past before the network can answer.
 */
async function runOut(page: Page): Promise<void> {
  const ended = page.getByRole('heading', { name: 'Run complete', exact: true });
  for (let step = 0; step < 1_000 && !(await ended.isVisible()); step += 1) {
    const [minutes, seconds] = ((await hud(page, 'time').textContent().catch(() => null)) ?? '0:00').split(':').map(Number);
    // Whole seconds while the run is far from its end, then 100 ms at a time.
    await page.clock.runFor((minutes ?? 0) * 60 + (seconds ?? 0) > 3 ? 1_000 : 100);
  }
  await expect(ended).toBeVisible();
}

/** Page time flows again so the queued write reaches the emulator; the handoff reports it. */
async function expectSaved(page: Page): Promise<void> {
  await page.clock.resume();
  await expect(page.locator('.mm-save')).toHaveText('Run saved to your account.', { timeout: 15_000 });
}

async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((isHidden) => {
    if (isHidden) Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    else delete (document as { visibilityState?: unknown }).visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

function sortedByEnd(sessions: Array<{ data: Record<string, unknown> }>) {
  return [...sessions].sort((a, b) => (a.data.endedAt as { toMillis(): number }).toMillis() - (b.data.endedAt as { toMillis(): number }).toMillis());
}

test('a signed-in player enters Mental Math, answers on the keypad and a completed run is saved once, with no EEG', async ({ page }) => {
  const uid = await openMentalMath(page);

  // A new player may start only at level 1; every other level is shown locked and cannot be chosen.
  await expect(page.getByRole('radio', { name: 'Level 1', exact: true })).toBeChecked();
  for (let level = 2; level <= 10; level += 1) {
    await expect(page.getByRole('radio', { name: `Level ${level} (locked)`, exact: true })).toBeDisabled();
  }
  await startRun(page, 1);
  await expect(page.getByText(/Simulated EEG/)).toHaveCount(0);

  // A complete answer is never submitted on its own; Submit needs a tap.
  const typed: number[] = [];
  const first = await waitForQuestion(page);
  await expect(key(page, 'Submit')).toBeDisabled();
  await page.clock.runFor(1_000);
  await typeAnswer(page, answerOf(first));
  await page.clock.runFor(1_000);
  await expect(page.locator('.mm-question')).toHaveText(`${first} =`);
  await expect(hud(page, 'entry')).toHaveText(String(answerOf(first)));
  await expect(page.locator('.mm-feedback')).toHaveText('');
  // A rapid double click on Submit answers the question once.
  await key(page, 'Submit').dblclick();
  await expect(page.locator('.mm-feedback')).toHaveText('Correct');
  typed.push(answerOf(first));
  await page.clock.runFor(FEEDBACK_MS);

  // Two clicks dispatched before React can re-render still resolve one question.
  const second = await waitForQuestion(page);
  await page.clock.runFor(1_100);
  await typeAnswer(page, answerOf(second));
  await key(page, 'Submit').evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.locator('.mm-feedback')).toHaveText('Correct');
  typed.push(answerOf(second));
  await page.clock.runFor(FEEDBACK_MS);

  for (const correct of [true, false, true, true]) typed.push(await answer(page, correct));
  await expect(hud(page, 'score')).not.toHaveText('0');

  await runOut(page);
  const shownScore = Number((await page.locator('[data-result="score"]').innerText()).replace(/\D/g, ''));
  await expectSaved(page);

  const sessions = await readGameSessions(uid);
  expect(sessions).toHaveLength(1);
  const session = sessions[0]!.data;
  expect(session).toMatchObject({ gameId: 'mental-math', gameVersion: 1, modeId: 'timed-90', status: 'completed', startLevel: 1, activeDurationMs: 90_000, seed: E2E_FIXED_SESSION_SEED });
  const trials = session.trials as Trial[];
  // One trial per question answered (the double submissions included once), plus the ones left to time out.
  expect(trials.filter((trial) => !trial.timedOut).map((trial) => trial.response)).toEqual(typed);
  expect(trials.filter((trial) => trial.timedOut).every((trial) => trial.response === null && trial.rtMs === trial.timeLimitMs)).toBe(true);
  expect(trials[0]).toMatchObject({ shownAtMs: 0, rtMs: 2_000, correct: true });
  expect(trials[1]).toMatchObject({ shownAtMs: 2_000, rtMs: 1_100, correct: true });
  const last = trials.at(-1)!;
  expect(last.shownAtMs + last.rtMs).toBeLessThanOrEqual(90_000);
  expect(session.summary).toMatchObject({ trialsTotal: trials.length, score: shownScore });
  expect(await readEegRecordings(uid)).toHaveLength(0);

  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Games', exact: true })).toBeVisible();
});

test('pausing and backgrounding freeze the run clock and discard the question, and never end the run', async ({ page }) => {
  const uid = await openMentalMath(page);
  await startRun(page, 1);
  await answer(page, true, 1_000);
  await page.clock.runFor(2_000);
  await expect(hud(page, 'time')).toHaveText('1:27');
  const beforePause = await questionText(page);

  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Paused', exact: true })).toBeVisible();
  await expect(page.locator('.mm-question')).toHaveCount(0);
  await page.clock.runFor(60_000);
  await expect(hud(page, 'time')).toHaveText('1:27');
  // The pause panel takes focus, and Enter activates the focused Resume.
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  const afterPause = await waitForQuestion(page);
  expect(afterPause).not.toBe(beforePause);
  await expect(hud(page, 'time')).toHaveText('1:27');

  // The app goes to the background and comes back: paused, not abandoned, no time lost.
  await setHidden(page, true);
  await expect(page.getByText('The run paused while the app was in the background.', { exact: false })).toBeVisible();
  await page.clock.runFor(120_000);
  await setHidden(page, false);
  await expect(page.getByRole('heading', { name: 'Paused', exact: true })).toBeVisible();
  await expect(hud(page, 'time')).toHaveText('1:27');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  expect(await waitForQuestion(page)).not.toBe(afterPause);

  // Nothing is written while the run is in progress.
  expect(await readGameSessions(uid)).toHaveLength(0);

  // Only an explicit quit ends the run early, as abandoned.
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Quit run', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Run ended early', exact: true })).toBeVisible();
  await expectSaved(page);
  const sessions = await readGameSessions(uid);
  expect(sessions).toHaveLength(1);
  expect(sessions[0]!.data).toMatchObject({ status: 'abandoned', activeDurationMs: 3_000 });
  expect(sessions[0]!.data.trials).toHaveLength(1);
});

test('simulated EEG never changes the trials or the score for the same seed and inputs', async ({ page }) => {
  const script = [true, true, true, true, true, true, false];
  const uid = await openMentalMath(page);

  await startRun(page, 1);
  for (const correct of script) await answer(page, correct);
  await runOut(page);
  const withoutEeg = await page.locator('[data-result="score"]').innerText();
  await expectSaved(page);

  // The pending run reached level 3, so level 2 unlocks at once; the default stays the last start level.
  await page.getByRole('button', { name: 'Play again', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Level 2', exact: true })).toBeEnabled();
  await expect(page.getByRole('radio', { name: 'Level 3 (locked)', exact: true })).toBeDisabled();
  await expect(page.getByRole('radio', { name: 'Level 1', exact: true })).toBeChecked();

  await page.getByRole('checkbox', { name: /Use Simulated EEG \(Demo Mode\)/ }).check();
  await startRun(page, 1);
  await expect(page.getByText('Simulated EEG (Demo Mode): simulated, not measured', { exact: true })).toBeVisible();
  for (const correct of script) await answer(page, correct);
  await runOut(page);
  await expect(page.locator('[data-result="score"]')).toHaveText(withoutEeg);
  await expectSaved(page);
  // This account has no EEG consent, so the simulated recording is not saved, and the player is told so.
  await expect(page.getByText('Simulated EEG (Demo Mode) was not saved: saving EEG needs your EEG consent.', { exact: true })).toBeVisible();

  const [plain, simulated] = sortedByEnd(await readGameSessions(uid));
  expect(plain!.data.seed).toBe(E2E_FIXED_SESSION_SEED);
  expect(simulated!.data.seed).toBe(E2E_FIXED_SESSION_SEED);
  expect(simulated!.data.trials).toEqual(plain!.data.trials);
  expect(simulated!.data.summary).toEqual(plain!.data.summary);
  expect(simulated!.data.peakLevel).toBe(3);
  expect(await readEegRecordings(uid)).toHaveLength(0);
});

test('offline at the end of a run: the run is saved on the device, simulated EEG is not, and the session uploads once on reconnect', async ({ page, context }) => {
  const uid = await openMentalMath(page);
  await page.getByRole('checkbox', { name: /Use Simulated EEG \(Demo Mode\)/ }).check();
  await startRun(page, 1);
  for (const correct of [true, false, true]) await answer(page, correct);
  await context.setOffline(true);
  await runOut(page);
  // Page time flows again so the save's bounded consent check can finish.
  await page.clock.resume();
  await expect(page.locator('.mm-save')).toHaveText('Saved on this device. Uploading to your account…');
  // EEG consent is confirmed only with the server, so offline the recording is not saved, and the run still is.
  await expect(page.locator('.mm-eeg-status')).toHaveText(
    'Simulated EEG (Demo Mode) wasn’t saved because your EEG consent couldn’t be confirmed with the server (you may be offline, on a slow connection, or have profile changes still uploading).',
    { timeout: 15_000 },
  );
  expect(await readGameSessions(uid)).toHaveLength(0);

  await context.setOffline(false);
  await expect(page.locator('.mm-save')).toHaveText('Run saved to your account.', { timeout: 30_000 });
  const sessions = await readGameSessions(uid);
  expect(sessions).toHaveLength(1);
  expect(sessions[0]!.data).toMatchObject({ status: 'completed', seed: E2E_FIXED_SESSION_SEED });
  expect(await readEegRecordings(uid)).toHaveLength(0);
});

test('a run saved while Firestore is unreachable survives a reload and is uploaded exactly once', async ({ page, context }) => {
  const uid = await openMentalMath(page);
  await startRun(page, 1);
  const typed: number[] = [];
  for (const correct of [true, true]) typed.push(await answer(page, correct));
  // Only the Firestore emulator is cut off (setOffline would also stop the app itself from reloading).
  const firestore = 'http://127.0.0.1:8080/**';
  await context.route(firestore, (route) => route.abort('internetdisconnected'));
  await runOut(page);
  await page.clock.resume();
  await expect(page.locator('.mm-save')).toHaveText('Saved on this device. Uploading to your account…');

  // The queued write is in the persistent cache, so it survives a full reload.
  await page.reload();
  await arriveAtPatientDashboard(page);
  expect(await readGameSessions(uid)).toHaveLength(0);

  await context.unroute(firestore);
  await expect.poll(async () => (await readGameSessions(uid)).length, { timeout: 30_000 }).toBe(1);
  const [session] = await readGameSessions(uid);
  expect(session!.data).toMatchObject({ status: 'completed', seed: E2E_FIXED_SESSION_SEED });
  expect((session!.data.trials as Trial[]).filter((trial) => !trial.timedOut).map((trial) => trial.response)).toEqual(typed);
  // The game's own history read, back online, still finds one session: the write was not repeated.
  await page.getByRole('button', { name: 'Train', exact: true }).click();
  await page.getByRole('button', { name: 'Mental Math', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Level 1', exact: true })).toBeChecked();
  expect(await readGameSessions(uid)).toHaveLength(1);
});
