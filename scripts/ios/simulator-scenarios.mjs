// Named iOS Simulator scenarios (NFCT-30, NFCT-31, NFCT-39). Each one starts
// from a fresh install, drives the real UI through the page agent, uses
// simctl for lifecycle, and checks the emulators from the host. They use
// only what a user sees: roles, accessible names, visible text and
// placeholders, plus a few stable hooks (the Mental Math HUD's data-hud
// attributes, its question and feedback text, and the end-of-run heading id
// #mm-handoff-title). Update them with the screens, as for e2e/helpers/auth.ts.
//
//   smoke        sign up, relaunch: the session and role come back (plus light and Dark Mode screenshots)
//   mental-math  sign up, play a whole 90-second run on the keypad, the session is written
//   lifecycle    background mid-run pauses it, timed against iOS's own events; a kill mid-run writes nothing; a quit run is saved

import { StepError } from './simulator-driver.mjs';

const button = (name, exact = true) => ({ role: 'button', name, exact });
const heading = (name, exact = true) => ({ role: 'heading', name, exact });
const KEYPAD = { role: 'group', name: 'Answer keypad' };
const key = (label) => ({ role: 'button', name: label, within: KEYPAD });
const HUD_TIME = { css: '[data-hud="time"]' };
const HUD_LEVEL = { css: '[data-hud="level"]' };
const QUESTION = { css: '.mm-question' };
const FEEDBACK = { css: '.mm-feedback' };
/** The end-of-run screen's heading: a stable id while NFCT-22 replaces the screen around it. */
const RUN_END = { css: '#mm-handoff-title' };
const QUESTION_READY = { target: key('1'), state: 'enabled' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- Solving the question on screen ----

const isMulDiv = (operator) => operator === '×' || operator === '÷';
const OPERATORS = { '+': '+', '-': '-', '−': '-', '×': '×', '÷': '÷' };

function apply(operator, left, right) {
  switch (operator) {
    case '+': return left + right;
    case '-': return left - right;
    case '×': return left * right;
    case '÷': return left / right;
    default: throw new Error(`Unknown operator ${operator}`);
  }
}

/**
 * The answer to a displayed Mental Math question such as "(4 + 5) × 6" or
 * "12 + 3 × 4", read the way the game evaluates it: × and ÷ before + and -,
 * equal precedence left to right, brackets first. The Linux tests check it
 * against the shared game's own evaluate() for every level.
 */
export function solveQuestion(text) {
  const shown = text.replace(/\s*=\s*$/, '').trim();
  const grouped = shown.startsWith('(');
  const tokens = shown.replace(/[()]/g, ' ').trim().split(/\s+/);
  const operands = tokens.filter((_, index) => index % 2 === 0).map(Number);
  const operators = tokens.filter((_, index) => index % 2 === 1).map((symbol) => OPERATORS[symbol]);
  const valid = tokens.length % 2 === 1 && tokens.filter((_, index) => index % 2 === 0).every((token) => /^\d+$/.test(token))
    && operators.every(Boolean) && (operands.length === 2 || operands.length === 3);
  if (!valid) throw new Error(`Not a Mental Math question: "${text}"`);
  const [a, b, c] = operands;
  const [first, second] = operators;
  if (operands.length === 2) return apply(first, a, b);
  return !grouped && isMulDiv(second) && !isMulDiv(first) ? apply(first, a, apply(second, b, c)) : apply(second, apply(first, a, b), c);
}

/** "1:27" to 87. */
export const clockSeconds = (text) => {
  const [minutes, seconds] = String(text).split(':').map(Number);
  return minutes * 60 + seconds;
};

// ---- Shared steps ----

/**
 * The screens a launch can land on, named so a failure explains itself. The
 * first that matches wins, so the account-load error comes before the hash it
 * can show at (#/role-selection).
 */
const LANDINGS = [
  ['account-load-error', { target: { role: 'alert', hasText: 'Your account couldn' } }],
  ['signed-in', { target: button('Skip to Dashboard') }],
  ['signed-in', { target: button('Train') }],
  ['role-selection', { hash: '#/role-selection' }],
  ['signed-out', { target: button('Begin Journey') }],
  ['signed-out', { target: heading('Log In') }],
  ['signed-out', { target: heading('Create Account') }],
];

/**
 * After a transient failure the role lookup retries by itself (2 s, then
 * backing off to every 10 s; NFCT-44), so the account-load error counts only
 * if it is still there after this long.
 */
const ACCOUNT_LOAD_RECOVERY_MS = 25_000;

/**
 * Which screen the app shows after a launch: one of LANDINGS' names, or
 * 'none'. `recovered` says how long an account-load error showed first.
 */
async function landing(ctx, timeout = 45_000) {
  const seen = await ctx.app.waitIfAny(LANDINGS.map(([, condition]) => condition), { timeout });
  if (!seen) return { screen: 'none', hash: (await ctx.app.state().catch(() => ({}))).hash };
  if (LANDINGS[seen.index][0] !== 'account-load-error') return { screen: LANDINGS[seen.index][0], hash: seen.hash };
  const started = Date.now();
  const others = LANDINGS.slice(1);
  const next = await ctx.app.waitIfAny(others.map(([, condition]) => condition), { timeout: ACCOUNT_LOAD_RECOVERY_MS });
  if (!next) return { screen: 'account-load-error', hash: seen.hash };
  return { screen: others[next.index][0], hash: next.hash, recovered: `${((Date.now() - started) / 1000).toFixed(1)} s` };
}

const landedOn = (landed) => `landed on ${landed.screen} at ${landed.hash || '#/'}${landed.recovered ? ` after the account-load error for ${landed.recovered}` : ''}`;

// ---- Steps that wait on the backend ----

/**
 * On GitHub's macOS runner, the Simulator's connection to the Firestore
 * emulator sometimes stops answering for about 30 to 45 s (NFCT-50: runs
 * 36839120021, 37075924837 and 37082805080). The app shows its own waiting
 * screen and carries on as soon as Firestore answers. Locally, with
 * Firestore blocked, it carries on within a second of it answering, and the
 * Linux journeys allow a backend step only 15 s. So a backend step whose
 * 30 s runs out while the page still shows that waiting screen gets up to
 * BACKEND_STALL_GRACE_MS more, as long as the waiting screen stays up. The
 * delay is reported as a warning. An error, any other screen, or no arrival
 * by the end still fails the step.
 */
export const BACKEND_STALL_GRACE_MS = 60_000;
const BACKEND_STALL_POLL_MS = 5_000;
const alerts = (screen) => screen?.alerts ?? [];
/** A screen the page reported (not a failed snapshot) with no headings or fields. */
const nothingElse = (screen) => Boolean(screen) && screen.ok !== false
  && (screen.headings ?? []).length === 0 && (screen.fields ?? []).length === 0;

/** The account's role is still being read: the plain loading screen, or its error screen while it retries by itself (NFCT-44). */
export const READING_ROLE = (screen) => nothingElse(screen) && (
  (alerts(screen).length === 0 && (screen?.buttons ?? []).length === 0)
  || (alerts(screen).length === 1 && alerts(screen)[0].startsWith('Your account couldn’t be loaded.')
    && (screen?.buttons ?? []).every((name) => name === 'Try again' || name === 'Sign out'))
);

/** App's "Preparing your patient profile…" while it reads or creates clients/{uid}. */
export const PREPARING_PROFILE = (screen) => nothingElse(screen) && (screen?.buttons ?? []).length === 0
  && alerts(screen).length === 1 && alerts(screen)[0].startsWith('Preparing your patient profile');

/**
 * Taps, then waits up to 30 s for `then`, plus the backend-stall grace while
 * the page shows `waiting` (see BACKEND_STALL_GRACE_MS).
 */
export async function tapThroughBackendWait(ctx, target, { then, waiting, step, graceMs = BACKEND_STALL_GRACE_MS }) {
  const { app } = ctx;
  const started = Date.now();
  try {
    return await app.tap(target, { then, thenTimeout: 30_000 });
  } catch (error) {
    if (!(error instanceof StepError) || !waiting(error.result?.screen)) throw error;
    for (let waited = 0; waited < graceMs; waited += BACKEND_STALL_POLL_MS) {
      const arrived = await app.waitIfAny(then, { timeout: Math.min(BACKEND_STALL_POLL_MS, graceMs - waited) });
      if (arrived) {
        ctx.warn('Simulator backend stall (NFCT-50)', `${step} took ${((Date.now() - started) / 1_000).toFixed(1)} s, on the app's own waiting screen until the backend answered (reported, not failed).`);
        return arrived;
      }
      const screen = await app.snapshot();
      if (!waiting(screen)) {
        // It may have just arrived; anything else is a real failure.
        const late = await app.waitIfAny(then, { timeout: 2_000 });
        if (late) {
          ctx.warn('Simulator backend stall (NFCT-50)', `${step} took ${((Date.now() - started) / 1_000).toFixed(1)} s, on the app's own waiting screen until the backend answered (reported, not failed).`);
          return late;
        }
        throw new StepError(`${error.message} It then left the waiting screen without arriving.`, { screen });
      }
    }
    throw new StepError(`${error.message} The waiting screen was still up after ${graceMs / 1_000} s more.`, { screen: await app.snapshot() });
  }
}

/** Signs up a new account through the real onboarding UI and chooses the training role. */
async function signUp(ctx) {
  const { app, account } = ctx;
  // The first launch can take a while to paint.
  await app.tap(button('Begin Journey'), { timeout: 45_000 });
  await app.wait({ target: heading('Create Account') });
  await app.fill({ placeholder: 'How should we call you?' }, 'iOS Simulator');
  await app.fill({ placeholder: 'you@example.com' }, account.email);
  await app.fill({ placeholder: 'At least 6 characters' }, account.password);
  await ctx.checkpoint('sign-up-form');
  await tapThroughBackendWait(ctx, button('Create Account'), { then: { target: button('Train my brain', false) }, waiting: READING_ROLE, step: 'Create Account → role selection' });
  await ctx.checkpoint('role-selection');
  await app.tap(button('Train my brain', false), { then: { hash: '#/hardware-setup' }, thenTimeout: 30_000 });
}

async function toDashboard(ctx) {
  await tapThroughBackendWait(ctx, button('Skip to Dashboard'), { then: { target: button('Train') }, waiting: PREPARING_PROFILE, step: 'Skip to Dashboard → dashboard' });
}

/** Opens Mental Math from the Train tab and starts a run at level 1. */
async function startMentalMath(ctx) {
  const { app } = ctx;
  await app.tap(button('Train'), { then: { target: button('Mental Math') } });
  await app.tap(button('Mental Math'), { then: { target: heading('Mental Math') } });
  // The levels load from the player's cached progress and sessions.
  await app.wait({ target: { role: 'radio', name: 'Level 1' }, state: 'checked' }, { timeout: 20_000 });
  await app.tap(button('Start at level 1'), { then: QUESTION_READY, thenTimeout: 10_000 });
}

/**
 * Answers the question on screen through the keypad, like a player: reads
 * it, thinks, taps the digits and Submit. Returns null when the run is over.
 */
async function answer(ctx, { correct = true, thinkMs = 500 } = {}) {
  const { app } = ctx;
  const ready = await app.wait([QUESTION_READY, { target: RUN_END }], { timeout: 15_000 });
  if (ready.index === 1) return null;
  let question = null;
  let expected = null;
  let response = null;
  try {
    question = (await app.read(QUESTION, { timeout: 3_000 })).text.replace(/\s*=\s*$/, '');
    expected = solveQuestion(question);
    response = correct ? expected : expected + 1;
    await sleep(thinkMs);
    for (const digit of String(response)) await app.tap(key(digit), { timeout: 3_000 });
    const submitted = await app.tap(key('Submit'), {
      timeout: 3_000,
      then: [{ target: FEEDBACK, nonEmpty: true }, { target: RUN_END }],
      thenTimeout: 5_000,
    });
    if (submitted.then.index === 1) return { question, response, expected, feedback: null, ended: true };
    return { question, response, expected, feedback: submitted.then.text };
  } catch (error) {
    // The run can end under the player's finger: that is not a failure.
    if (await app.waitIfAny({ target: RUN_END }, { timeout: 2_000 })) return { question, response, expected, feedback: null, ended: true };
    throw error;
  }
}

const trialsAnswered = (session) => (session.data.trials ?? []).filter((trial) => !trial.timedOut);

// ---- The scenarios ----

export const SCENARIOS = {
  smoke: {
    summary: 'Sign up through the real UI, then a cold relaunch restores the session and role; light and Dark Mode screenshots.',
    async run(ctx) {
      await ctx.launch();
      await ctx.checkpoint('welcome');
      await signUp(ctx);
      ctx.check('Sign-up and role choice work against the emulators', true);
      await ctx.checkpoint('hardware-setup');

      await ctx.relaunch();
      const landed = await landing(ctx);
      ctx.check('A cold relaunch restores the session and role', landed.screen === 'signed-in', landedOn(landed));
      await sleep(2_000);
      await ctx.checkpoint('relaunch-light');
      await ctx.device.appearance('dark');
      await sleep(3_000);
      await ctx.checkpoint('relaunch-dark-mode');
      await ctx.device.appearance('light');
    },
  },

  'mental-math': {
    summary: 'Sign up, open Mental Math from the Train tab, play a whole 90-second run on the on-screen keypad (one answer deliberately wrong); the end-of-run screen appears and the session is written.',
    async run(ctx) {
      const { app } = ctx;
      await ctx.launch();
      await signUp(ctx);
      await toDashboard(ctx);
      const uid = await ctx.emulators.uid(ctx.account);
      await startMentalMath(ctx);
      ctx.check('Opens Mental Math from the Train tab and starts a run at level 1', true);
      await ctx.checkpoint('run-first-question');

      const answers = [];
      let peakLevel = 1;
      const started = Date.now();
      // 90 s of active time, plus 0.4 s of feedback per answer off the clock: about 150 s. A safety stop only.
      while (Date.now() - started < 300_000) {
        const result = await answer(ctx, { correct: answers.length !== 2 });
        if (!result) break;
        if (result.feedback) answers.push(result);
        if (result.ended) break;
        if (answers.length === 20) {
          peakLevel = Number((await app.read(HUD_LEVEL)).text) || peakLevel;
          await ctx.checkpoint('run-after-20-answers');
        }
      }
      ctx.check('Answers questions on the on-screen keypad, each with feedback', answers.length >= 10,
        `${answers.length} answers; level ${peakLevel} shown after 20; last question "${answers.at(-1)?.question ?? ''}"`);
      ctx.check('The deliberately wrong answer is marked wrong', answers.length > 2 && !/^Correct/.test(answers[2].feedback ?? ''), answers[2]?.feedback);

      const ended = await app.waitIfAny({ target: RUN_END }, { timeout: 30_000 });
      ctx.check('The run ends after 90 s and the end-of-run screen appears', Boolean(ended), ended?.text);
      await ctx.checkpoint('run-end');

      const sessions = await ctx.emulators.until(() => ctx.emulators.gameSessions(uid), (documents) => documents.length > 0);
      ctx.check('Exactly one session is written to the Firestore emulator', sessions.length === 1, `${sessions.length} session(s)`);
      const session = sessions[0];
      if (!session) return;
      const { data } = session;
      ctx.check('It is a completed Mental Math run of 90 s of active time, from iOS',
        data.gameId === 'mental-math' && data.status === 'completed' && data.activeDurationMs === 90_000 && data.client?.platform === 'ios',
        `gameId ${data.gameId}, status ${data.status}, activeDurationMs ${data.activeDurationMs}, platform ${data.client?.platform}`);
      const recorded = trialsAnswered(session);
      ctx.check('Its trials hold exactly the answers typed on the keypad, in order',
        JSON.stringify(recorded.map((trial) => trial.response)) === JSON.stringify(answers.map((item) => item.response)),
        `${recorded.length} answered trials recorded, ${answers.length} typed`);
      ctx.check('Each trial is marked correct or wrong as answered',
        recorded.length === answers.length && recorded.every((trial, index) => trial.correct === (answers[index].response === answers[index].expected)));
      ctx.note(`Session ${session.id}: score ${data.summary?.score}, ${data.summary?.trialsTotal} trials, peak level ${data.peakLevel}, seed ${data.seed}.`);
      await ctx.checkpoint('run-saved');
    },
  },

  lifecycle: {
    summary: 'Background mid-run (simctl launches Settings): iOS hides the page, the run pauses, none of the time the page is hidden counts, and the run waits for the player; a kill mid-run then relaunch writes no session; a quit run is still saved.',
    async run(ctx) {
      const { app, device } = ctx;
      await ctx.launch();
      await signUp(ctx);
      await toDashboard(ctx);
      const uid = await ctx.emulators.uid(ctx.account);
      await startMentalMath(ctx);
      await answer(ctx);
      await answer(ctx);

      // 1. Background and foreground, with a question on screen and the clock running.
      await app.wait(QUESTION_READY);
      const discarded = (await app.read(QUESTION)).text;
      await sleep(2_000);
      const before = clockSeconds((await app.read(HUD_TIME)).text);
      const readAt = Date.now();
      const launchBefore = ctx.channel.current;
      const backgroundAt = Date.now();
      await device.background();
      // Settings takes a few seconds to come forward (3.9 to 5.1 s seen), so the page is hidden for at least 10 s of this.
      const backgroundMs = 15_000;
      await sleep(backgroundMs);
      await ctx.checkpoint('in-background');
      const foregroundAt = Date.now();
      await device.foreground();
      const paused = await app.waitIfAny({ target: heading('Paused') }, { timeout: 15_000 });
      ctx.check('The app resumes the same page (not a relaunch)', ctx.channel.current === launchBefore);
      ctx.check('Backgrounding pauses the run', Boolean(paused));
      await ctx.checkpoint('after-background');
      if (!paused) return;
      const pauseText = await app.read({ css: '.mm-paused .mm-muted' });
      ctx.check('The pause is attributed to the background', /background/i.test(pauseText.text), pauseText.text);
      const after = clockSeconds((await app.read(HUD_TIME)).text);

      // What iOS told the page, and when, on the clock the host shares with the Simulator.
      const { lifecycle } = await app.state();
      const firstAfter = (since, test) => lifecycle.find((event) => event.at >= since && test(event));
      const hidden = firstAfter(backgroundAt, ({ type, visibility }) => type === 'visibilitychange' && visibility === 'hidden');
      const visible = firstAfter(foregroundAt, ({ type, visibility }) => type === 'visibilitychange' && visibility === 'visible');
      const seconds = (ms) => `${(ms / 1_000).toFixed(1)} s`;
      const timeline = lifecycle.filter(({ at }) => at >= backgroundAt)
        .map(({ type, visibility, at }) => `${type}${type === 'visibilitychange' ? `:${visibility}` : ''} +${seconds(at - backgroundAt)}`).join(', ');
      ctx.note(`Lifecycle events after the simctl command that opens Settings (t = 0; the app is brought back at +${seconds(foregroundAt - backgroundAt)}): ${timeline || 'none'}.`);
      ctx.check('iOS hides the page in the background and shows it again on return (visibilitychange)', Boolean(hidden && visible),
        hidden ? `hidden ${seconds(hidden.at - backgroundAt)} after the simctl command` : 'no hidden event');
      // iOS's own signal that the app left the foreground: Capacitor's native 'pause', or the window's blur.
      const native = [firstAfter(backgroundAt, ({ type }) => type === 'pause'), firstAfter(backgroundAt, ({ type }) => type === 'blur')]
        .filter(Boolean).sort((a, b) => a.at - b.at)[0];
      ctx.check('The page is hidden as soon as iOS backgrounds the app (within 1 s of its native signal)', Boolean(hidden && native && hidden.at - native.at <= 1_000),
        native && hidden ? `${native.type} at +${seconds(native.at - backgroundAt)}, visibilitychange:hidden ${hidden.at - native.at} ms later` : 'no native signal or no hidden event');
      // The clock may run from the read until the page is hidden (while Settings opens, the app is still in front); none of the time hidden may count.
      const runningMs = (hidden?.at ?? foregroundAt) - readAt;
      const lost = before - after;
      ctx.check('The run clock stops when the page is hidden and does not run in the background', lost <= runningMs / 1_000 + 1,
        `${before} s left before, ${after} s after; the page stayed visible ${seconds(runningMs)} after the clock was read, then was hidden ${hidden && visible ? seconds(visible.at - hidden.at) : '?'}`);
      await sleep(3_000);
      const later = clockSeconds((await app.read(HUD_TIME)).text);
      const stillPaused = await app.waitIfAny({ target: heading('Paused') }, { timeout: 1_000 });
      ctx.check('Returning does not resume the run; the clock stays frozen while paused', Boolean(stillPaused) && later === after, `${later} s left 3 s later`);
      await app.tap(button('Resume'), { then: QUESTION_READY });
      // The game never repeats the question a pause discarded (shared/games/mental-math/v1/run.ts).
      const fresh = (await app.read(QUESTION)).text;
      ctx.check('Resume shows a different question from the one the pause discarded', fresh !== discarded, `"${discarded}" then "${fresh}"`);

      // 2. Kill mid-run, then relaunch.
      await answer(ctx);
      await app.wait(QUESTION_READY);
      await ctx.relaunch();
      const landed = await landing(ctx);
      ctx.check('After a kill mid-run the app relaunches signed in', landed.screen === 'signed-in', landedOn(landed));
      const inRun = await app.waitIfAny({ target: HUD_TIME }, { timeout: 1_000 });
      ctx.check('The relaunched app is not in a run', !inRun);
      await ctx.checkpoint('after-kill-relaunch');
      const afterKill = await ctx.emulators.gameSessions(uid);
      ctx.check('A run killed mid-play writes no session', afterKill.length === 0, `${afterKill.length} session(s)`);
      if (landed.screen !== 'signed-in') return;

      // 3. The same account still saves a run: quit one early.
      if (await app.waitIfAny({ target: button('Skip to Dashboard') }, { timeout: 1_000 })) await toDashboard(ctx);
      await startMentalMath(ctx);
      await app.tap(button('Pause'), { then: { target: heading('Paused') } });
      await app.tap(button('Quit run'), { then: { target: RUN_END }, thenTimeout: 10_000 });
      const saved = await ctx.emulators.until(() => ctx.emulators.gameSessions(uid), (documents) => documents.length > 0);
      ctx.check('A quit run is saved once, as abandoned', saved.length === 1 && saved[0].data.status === 'abandoned',
        saved.map(({ data }) => `${data.status}, ${data.activeDurationMs} ms`).join('; ') || 'no session');
      await ctx.checkpoint('quit-saved');
    },
  },
};

export const DEFAULT_SCENARIOS = Object.keys(SCENARIOS);
