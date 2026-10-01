// iOS Simulator smoke probe (NFCT-30, NFCT-31).
//
// scripts/ios/simulator-smoke.mjs adds this file to the synced emulator web
// bundle of a Debug build, only for the Simulator smoke test; it is never part
// of the product or of a production bundle. It drives the real sign-up UI
// against the local emulators and reports through console.log, which
// Capacitor forwards to the app's stdout in Debug builds.
//
// First launch: sign up, choose the training role (a Firestore write), reach
// the next screen. Relaunch: the session and role come back from the
// capacitor://localhost origin's storage. The selectors follow the onboarding
// screens, as e2e/helpers/auth.ts does; update both when onboarding changes.
(() => {
  const PHASE_KEY = 'nfct-smoke-phase';
  const report = (event, detail = {}) => console.log(`[nfct-smoke] ${JSON.stringify({ event, ...detail })}`);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (check, timeout = 45_000) => {
    for (const end = Date.now() + timeout; Date.now() < end; await sleep(250)) {
      const value = check();
      if (value) return value;
    }
    return null;
  };
  const text = (selector, value) => [...document.querySelectorAll(selector)].find((node) => node.textContent.trim() === value);
  const visibleAlert = () => document.querySelector('[role="alert"]')?.textContent.trim() || undefined;
  const fill = (input, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  window.addEventListener('error', (event) => report('uncaught-error', { message: String(event.message), source: event.filename }));
  window.addEventListener('unhandledrejection', (event) => report('unhandled-rejection', { message: String(event.reason?.message ?? event.reason) }));

  async function signUp() {
    location.hash = '#/signup';
    const form = await waitFor(() => text('h1', 'Create Account') && document.querySelector('form'));
    if (!form) return { ok: false, reason: 'The sign-up form did not appear.' };
    const email = `ios-smoke-${Date.now()}@example.test`;
    fill(form.querySelector('input[type="text"]'), 'iOS Smoke');
    fill(form.querySelector('input[type="email"]'), email);
    fill(form.querySelector('input[type="password"]'), 'smoke-password-1');
    form.querySelector('button[type="submit"]').click();
    if (!await waitFor(() => location.hash.startsWith('#/role-selection'))) {
      return { ok: false, reason: 'Sign-up did not reach role selection.', hash: location.hash, alert: visibleAlert() };
    }
    const train = await waitFor(() => text('h3', 'Train my brain')?.closest('button'));
    if (!train) return { ok: false, reason: 'The role choice did not appear.' };
    train.click();
    if (!await waitFor(() => location.hash.startsWith('#/hardware-setup'))) {
      return { ok: false, reason: 'Choosing a role did not save (Firestore).', hash: location.hash, alert: visibleAlert() };
    }
    localStorage.setItem(PHASE_KEY, 'relaunch');
    return { ok: true, email };
  }

  async function restoredAfterRelaunch() {
    const screen = await waitFor(() => (text('button', 'Skip to Dashboard') || text('*', 'Training Session') ? 'signed-in'
      : text('h1', 'Create Account') || text('h1', 'Log In') ? 'signed-out' : null));
    return { ok: screen === 'signed-in', screen: screen ?? 'none', hash: location.hash, alert: visibleAlert() };
  }

  async function main() {
    report('environment', {
      origin: location.origin,
      secureContext: window.isSecureContext,
      randomUUID: typeof crypto?.randomUUID,
      indexedDB: typeof indexedDB,
      userAgent: navigator.userAgent,
    });
    const phase = localStorage.getItem(PHASE_KEY) ?? 'sign-up';
    try {
      report('result', { phase, ...(phase === 'sign-up' ? await signUp() : await restoredAfterRelaunch()) });
    } catch (error) {
      report('result', { phase, ok: false, reason: String(error?.stack ?? error) });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main);
  else main();
})();
