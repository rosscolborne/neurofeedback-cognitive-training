import { describe, expect, it, vi } from 'vitest';
import { StepError } from '../ios/simulator-driver.mjs';
import { LOADING_PROFILE, tapThroughBackendWait } from '../ios/simulator-scenarios.mjs';

// The Simulator's connection to the Firestore emulator sometimes stalls for
// 30 to 45 s on GitHub's macOS runner (NFCT-50). A backend step that runs out
// of time on the app's own waiting screen gets a grace period, reported as a
// warning; anything else still fails.

// Screens as the page agent reported them in real runs, at the hash sign-up
// now leaves the loading screen on.
const view = (screen) => ({ ok: true, hash: '#/hardware-setup', visibilityState: 'visible', headings: [], buttons: [], fields: [], alerts: [], ...screen });
/** The profile lookup's plain loading screen, while sign-up's profile write waits for the server. */
const LOADING = view({});
/** Run 37075924837 (0f3c4bf), smoke, when "Create Account" gave up (then on the role lookup). */
const RETRY = view({ buttons: ['Try again', 'Sign out'], alerts: ['Your account couldn’t be loaded.Check your internet connection, then try again.'] });
/** Headset setup, where sign-up arrives once the profile is confirmed. */
const HEADSET_SETUP = view({ headings: ['Pair your headset'], buttons: ['Skip to Dashboard', 'Connect Muse'] });
const DASHBOARD = view({ hash: '#/', headings: ['Good morning, IOS.', 'Mental Math'], buttons: ['Play Mental Math', 'Home', 'Train', 'Progress', 'Profile'] });
const SIGN_UP_FORM = view({ hash: '#/signup', headings: ['Create Account'], buttons: ['Back', 'Create Account'], fields: ['How should we call you?'] });
const SIGNED_OUT = view({ hash: '#/', headings: ['Welcome to your brain training journey'], buttons: ['Begin Journey', 'Sign In'] });

const SKIP = { target: { role: 'button', name: 'Skip to Dashboard', exact: true } };
const timedOut = (screen) => new StepError('tap button "Create Account": tapped, then: Timed out after 30000 ms waiting for button "Skip to Dashboard" to be visible.', { screen });

function setup({ tap, waits = [], snapshots = [] }) {
  const app = {
    tap: vi.fn(tap),
    waitIfAny: vi.fn(async () => waits.shift() ?? null),
    snapshot: vi.fn(async () => snapshots.shift() ?? LOADING),
  };
  const ctx = { app, warn: vi.fn() };
  const run = (options = {}) => tapThroughBackendWait(ctx, { role: 'button', name: 'Create Account', exact: true }, {
    then: SKIP, waiting: LOADING_PROFILE, step: 'Create Account → headset setup', graceMs: 20_000, ...options,
  });
  return { app, ctx, run };
}

describe('waiting screens', () => {
  it('recognizes the profile being loaded, including its error screen while it retries by itself', () => {
    expect(LOADING_PROFILE(LOADING)).toBe(true);
    expect(LOADING_PROFILE(RETRY)).toBe(true);
    const gone = { ok: false, reason: 'The page agent is gone.' };
    for (const screen of [HEADSET_SETUP, SIGN_UP_FORM, SIGNED_OUT, DASHBOARD, undefined, gone]) expect(LOADING_PROFILE(screen)).toBe(false);
  });
});

describe('tapThroughBackendWait', () => {
  it('passes a step that arrives in time without a warning', async () => {
    const { app, ctx, run } = setup({ tap: async () => ({ ok: true }) });
    await expect(run()).resolves.toEqual({ ok: true });
    expect(app.tap).toHaveBeenCalledWith(expect.anything(), { then: SKIP, thenTimeout: 30_000 });
    expect(app.waitIfAny).not.toHaveBeenCalled();
    expect(ctx.warn).not.toHaveBeenCalled();
  });

  it('passes the NFCT-50 stall with a warning: the profile is confirmed during the grace', async () => {
    const { ctx, run } = setup({ tap: async () => { throw timedOut(LOADING); }, waits: [null, { ok: true, index: 0 }] });
    await expect(run()).resolves.toEqual({ ok: true, index: 0 });
    expect(ctx.warn).toHaveBeenCalledOnce();
    expect(ctx.warn.mock.calls[0][0]).toBe('Simulator backend stall (NFCT-50)');
    expect(ctx.warn.mock.calls[0][1]).toMatch(/^Create Account → headset setup took \d+\.\d s, .*\(reported, not failed\)\.$/);
  });

  it('fails at once when the step timed out on any other screen', async () => {
    for (const screen of [SIGN_UP_FORM, SIGNED_OUT, DASHBOARD, undefined]) {
      const error = timedOut(screen);
      const { app, ctx, run } = setup({ tap: async () => { throw error; } });
      await expect(run()).rejects.toBe(error);
      expect(app.waitIfAny).not.toHaveBeenCalled();
      expect(ctx.warn).not.toHaveBeenCalled();
    }
  });

  it('fails when the page leaves the waiting screen for anything but the target', async () => {
    const { ctx, run } = setup({ tap: async () => { throw timedOut(LOADING); }, snapshots: [LOADING, SIGNED_OUT] });
    const error = await run().catch((caught) => caught);
    expect(error).toBeInstanceOf(StepError);
    expect(error.message).toMatch(/Timed out after 30000 ms .* It then left the waiting screen without arriving\.$/);
    expect(error.result.screen).toBe(SIGNED_OUT);
    expect(ctx.warn).not.toHaveBeenCalled();
  });

  it('passes when the target turns up just as the waiting screen goes', async () => {
    const { ctx, run } = setup({ tap: async () => { throw timedOut(LOADING); }, waits: [null, { ok: true, index: 0 }], snapshots: [HEADSET_SETUP] });
    await expect(run()).resolves.toEqual({ ok: true, index: 0 });
    expect(ctx.warn).toHaveBeenCalledOnce();
  });

  it('fails when the waiting screen is still up at the end of the grace', async () => {
    const { app, ctx, run } = setup({ tap: async () => { throw timedOut(LOADING); } });
    const error = await run().catch((caught) => caught);
    expect(error).toBeInstanceOf(StepError);
    expect(error.message).toMatch(/The waiting screen was still up after 20 s more\.$/);
    expect(error.result.screen).toBe(LOADING);
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
