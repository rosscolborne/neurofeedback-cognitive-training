import { describe, expect, it, vi } from 'vitest';
import { StepError } from '../ios/simulator-driver.mjs';
import { PREPARING_PROFILE, READING_ROLE, tapThroughBackendWait } from '../ios/simulator-scenarios.mjs';

// The Simulator's connection to the Firestore emulator sometimes stalls for
// 30 to 45 s on GitHub's macOS runner (NFCT-50). A backend step that runs out
// of time on the app's own waiting screen gets a grace period, reported as a
// warning; anything else still fails.

// Screens as the page agent reported them in real runs.
const view = (screen) => ({ ok: true, hash: '#/', visibilityState: 'visible', headings: [], buttons: [], fields: [], alerts: [], ...screen });
/** Run 37082805080 (4ac66e2), lifecycle, when "Skip to Dashboard" gave up. */
const PREPARING = view({ alerts: ['Preparing your patient profile…'] });
/** The same run a few seconds later. */
const DASHBOARD = view({ headings: ['Good morning, IOS.', 'Mental Math'], buttons: ['Play Mental Math', 'Home', 'Train', 'Progress', 'Profile'] });
const PROFILE_ERROR = view({ buttons: ['Retry'], alerts: ['Your patient profile could not be loaded.Missing or insufficient permissions.'] });
/** The role lookup's plain loading screen. */
const ROLE_LOADING = view({ hash: '#/role-selection' });
/** Run 37075924837 (0f3c4bf), smoke, when "Create Account" gave up. */
const ROLE_RETRY = view({ hash: '#/role-selection', buttons: ['Try again', 'Sign out'], alerts: ['Your account couldn’t be loaded.Check your internet connection, then try again.'] });
const ROLE_SELECTION = view({ hash: '#/role-selection', headings: ['How will you use NFCT?', 'Train my brain'], buttons: ['Train my brain', 'I am a practitioner'] });
const SIGN_UP_FORM = view({ hash: '#/signup', headings: ['Create Account'], buttons: ['Back', 'Create Account'], fields: ['How should we call you?'] });

const TRAIN = { target: { role: 'button', name: 'Train', exact: true } };
const timedOut = (screen) => new StepError('tap button "Skip to Dashboard": tapped, then: Timed out after 30000 ms waiting for button "Train" to be visible.', { screen });

function setup({ tap, waits = [], snapshots = [] }) {
  const app = {
    tap: vi.fn(tap),
    waitIfAny: vi.fn(async () => waits.shift() ?? null),
    snapshot: vi.fn(async () => snapshots.shift() ?? PREPARING),
  };
  const ctx = { app, warn: vi.fn() };
  const run = (options = {}) => tapThroughBackendWait(ctx, { role: 'button', name: 'Skip to Dashboard', exact: true }, {
    then: TRAIN, waiting: PREPARING_PROFILE, step: 'Skip to Dashboard → dashboard', graceMs: 20_000, ...options,
  });
  return { app, ctx, run };
}

describe('waiting screens', () => {
  it('recognizes the profile being prepared', () => {
    expect(PREPARING_PROFILE(PREPARING)).toBe(true);
    const gone = { ok: false, reason: 'The page agent is gone.' };
    for (const screen of [DASHBOARD, PROFILE_ERROR, ROLE_LOADING, ROLE_RETRY, ROLE_SELECTION, undefined, gone]) expect(PREPARING_PROFILE(screen)).toBe(false);
  });

  it('recognizes the role being read, including its error screen while it retries by itself', () => {
    expect(READING_ROLE(ROLE_LOADING)).toBe(true);
    expect(READING_ROLE(ROLE_RETRY)).toBe(true);
    const gone = { ok: false, reason: 'The page agent is gone.' };
    for (const screen of [ROLE_SELECTION, SIGN_UP_FORM, PREPARING, PROFILE_ERROR, DASHBOARD, undefined, gone]) expect(READING_ROLE(screen)).toBe(false);
  });
});

describe('tapThroughBackendWait', () => {
  it('passes a step that arrives in time without a warning', async () => {
    const { app, ctx, run } = setup({ tap: async () => ({ ok: true }) });
    await expect(run()).resolves.toEqual({ ok: true });
    expect(app.tap).toHaveBeenCalledWith(expect.anything(), { then: TRAIN, thenTimeout: 30_000 });
    expect(app.waitIfAny).not.toHaveBeenCalled();
    expect(ctx.warn).not.toHaveBeenCalled();
  });

  it('passes the NFCT-50 stall with a warning: the profile arrives during the grace', async () => {
    const { ctx, run } = setup({ tap: async () => { throw timedOut(PREPARING); }, waits: [null, { ok: true, index: 0 }] });
    await expect(run()).resolves.toEqual({ ok: true, index: 0 });
    expect(ctx.warn).toHaveBeenCalledOnce();
    expect(ctx.warn.mock.calls[0][0]).toBe('Simulator backend stall (NFCT-50)');
    expect(ctx.warn.mock.calls[0][1]).toMatch(/^Skip to Dashboard → dashboard took \d+\.\d s, .*\(reported, not failed\)\.$/);
  });

  it('fails at once when the step timed out on any other screen', async () => {
    for (const screen of [PROFILE_ERROR, ROLE_SELECTION, DASHBOARD, undefined]) {
      const error = timedOut(screen);
      const { app, ctx, run } = setup({ tap: async () => { throw error; } });
      await expect(run()).rejects.toBe(error);
      expect(app.waitIfAny).not.toHaveBeenCalled();
      expect(ctx.warn).not.toHaveBeenCalled();
    }
  });

  it('fails when the page leaves the waiting screen for anything but the target', async () => {
    const { ctx, run } = setup({ tap: async () => { throw timedOut(PREPARING); }, snapshots: [PREPARING, PROFILE_ERROR] });
    const error = await run().catch((caught) => caught);
    expect(error).toBeInstanceOf(StepError);
    expect(error.message).toMatch(/Timed out after 30000 ms .* It then left the waiting screen without arriving\.$/);
    expect(error.result.screen).toBe(PROFILE_ERROR);
    expect(ctx.warn).not.toHaveBeenCalled();
  });

  it('passes when the target turns up just as the waiting screen goes', async () => {
    const { ctx, run } = setup({ tap: async () => { throw timedOut(PREPARING); }, waits: [null, { ok: true, index: 0 }], snapshots: [DASHBOARD] });
    await expect(run()).resolves.toEqual({ ok: true, index: 0 });
    expect(ctx.warn).toHaveBeenCalledOnce();
  });

  it('fails when the waiting screen is still up at the end of the grace', async () => {
    const { app, ctx, run } = setup({ tap: async () => { throw timedOut(PREPARING); } });
    const error = await run().catch((caught) => caught);
    expect(error).toBeInstanceOf(StepError);
    expect(error.message).toMatch(/The waiting screen was still up after 20 s more\.$/);
    expect(error.result.screen).toBe(PREPARING);
    // 20 s of grace in 5 s polls.
    expect(app.waitIfAny.mock.calls.map(([, { timeout }]) => timeout)).toEqual([5_000, 5_000, 5_000, 5_000]);
    expect(ctx.warn).not.toHaveBeenCalled();
  });

  it('does not treat a lost connection to the page as a stall', async () => {
    const error = new Error('The page agent is gone.');
    const { app, run } = setup({ tap: async () => { throw error; } });
    await expect(run()).rejects.toBe(error);
    expect(app.waitIfAny).not.toHaveBeenCalled();
  });
});
