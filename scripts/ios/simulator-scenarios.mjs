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
//   lifecycle    background mid-run pauses it; a kill mid-run writes nothing; a quit run is saved

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

/** The screens a launch can land on, named so a failure explains itself. */
const LANDINGS = [
  ['signed-in', { target: button('Skip to Dashboard') }],
  ['signed-in', { target: button('Train') }],
  ['role-selection', { hash: '#/role-selection' }],
  ['account-load-error', { target: { role: 'alert', hasText: 'Your account couldn' } }],
  ['signed-out', { target: button('Begin Journey') }],
  ['signed-out', { target: heading('Log In') }],
  ['signed-out', { target: heading('Create Account') }],
];

/** Which screen the app shows after a launch: one of LANDINGS' names, or 'none'. */
async function landing(ctx, timeout = 45_000) {
  const seen = await ctx.app.waitIfAny(LANDINGS.map(([, condition]) => condition), { timeout });
  if (seen) return { screen: LANDINGS[seen.index][0], hash: seen.hash };
  return { screen: 'none', hash: (await ctx.app.state().catch(() => ({}))).hash };
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
  await app.tap(button('Create Account'), { then: { target: button('Train my brain', false) }, thenTimeout: 30_000 });
  await ctx.checkpoint('role-selection');
  await app.tap(button('Train my brain', false), { then: { hash: '#/hardware-setup' }, thenTimeout: 30_000 });
}

async function toDashboard(ctx) {
  await ctx.app.tap(button('Skip to Dashboard'), { then: { target: button('Train') }, thenTimeout: 30_000 });
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
  const question = (await app.read(QUESTION)).text.replace(/\s*=\s*$/, '');
  const expected = solveQuestion(question);
  const response = correct ? expected : expected + 1;
  await sleep(thinkMs);
  try {
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
      ctx.check('A cold relaunch restores the session and role', landed.screen === 'signed-in', `landed on ${landed.screen} at ${landed.hash || '#/'}`);
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
      // The run is 90 s of active time; feedback flashes are extra. Stop well after it.
      while (Date.now() - started < 150_000) {
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
    summary: 'Background mid-run (simctl launches Settings) pauses the run without losing time and waits for the player; a kill mid-run then relaunch writes no session; a quit run is still saved.',
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
      await sleep(2_000);
      const before = clockSeconds((await app.read(HUD_TIME)).text);
      const launchBefore = ctx.channel.current;
      await device.background();
      const backgroundMs = 8_000;
      await sleep(backgroundMs);
      await ctx.checkpoint('in-background');
      await device.foreground();
      const paused = await app.waitIfAny({ target: heading('Paused') }, { timeout: 15_000 });
      ctx.check('The app resumes the same page (not a relaunch)', ctx.channel.current === launchBefore);
      ctx.check('Backgrounding pauses the run', Boolean(paused));
      await ctx.checkpoint('after-background');
      if (!paused) return;
      const pauseText = await app.read({ css: '.mm-paused .mm-muted' });
      ctx.check('The pause is attributed to the background', /background/i.test(pauseText.text), pauseText.text);
      const after = clockSeconds((await app.read(HUD_TIME)).text);
      // Reading the clock and backgrounding take a moment of active time; 8 s in the background must not count.
      ctx.check('The run clock did not run in the background', before - after <= 2, `${before} s left before, ${after} s after ${backgroundMs / 1_000} s in the background`);
      await sleep(3_000);
      const later = clockSeconds((await app.read(HUD_TIME)).text);
      const stillPaused = await app.waitIfAny({ target: heading('Paused') }, { timeout: 1_000 });
      ctx.check('Returning does not resume the run; the clock stays frozen while paused', Boolean(stillPaused) && later === after, `${later} s left 3 s later`);
      await app.tap(button('Resume'), { then: QUESTION_READY });
      ctx.check('Resume shows a new question', true);

      // 2. Kill mid-run, then relaunch.
      await answer(ctx);
      await app.wait(QUESTION_READY);
      await ctx.relaunch();
      const landed = await landing(ctx);
      ctx.check('After a kill mid-run the app relaunches signed in', landed.screen === 'signed-in', `landed on ${landed.screen} at ${landed.hash || '#/'}`);
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
