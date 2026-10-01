#!/usr/bin/env node
// iOS Simulator smoke test (NFCT-30, NFCT-31). CI runs it on a GitHub-hosted
// Mac (.github/workflows/ios.yml); it also runs on any Mac with Xcode. It
// installs an emulator Debug build on a booted iPhone Simulator, signs up
// through the real UI against the local emulators, relaunches the app, and
// checks the origin, the secure context and that the session survived.
//
//   node scripts/ios/simulator-smoke.mjs pick                 # print an iPhone Simulator UDID
//   node scripts/ios/simulator-smoke.mjs inject               # add the probe to the synced emulator bundle
//   node scripts/ios/simulator-smoke.mjs run <App.app> <udid> <out-dir>
//
// `run` needs the Auth and Firestore emulators on 127.0.0.1, for example
// inside `firebase emulators:exec`. See docs/nfct/ios.md.
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const PROBE = 'nfct-simulator-probe.js';
const LAUNCH_TIMEOUT_MS = 180_000;
const xcrun = (...args) => execFileSync('xcrun', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The newest iOS runtime's preferred iPhone, so results compare across runs. */
function pick() {
  const { devices } = JSON.parse(xcrun('simctl', 'list', 'devices', 'available', '--json'));
  const runtimes = Object.keys(devices)
    .filter((runtime) => /SimRuntime\.iOS-/.test(runtime) && devices[runtime].some(({ name }) => name.startsWith('iPhone')))
    .sort((a, b) => version(b) - version(a));
  if (runtimes.length === 0) throw new Error('No iPhone Simulator is available.');
  const iphones = devices[runtimes[0]].filter(({ name }) => name.startsWith('iPhone'));
  const preferred = ['iPhone 17', 'iPhone 16', 'iPhone 17 Pro', 'iPhone 16 Pro'];
  const device = preferred.map((name) => iphones.find((candidate) => candidate.name === name)).find(Boolean) ?? iphones[0];
  console.error(`Using ${device.name} on ${runtimes[0].split('.').pop()}`);
  console.log(device.udid);
}

function version(runtime) {
  const [major = 0, minor = 0] = runtime.split('iOS-').pop().split('-').map(Number);
  return major * 100 + minor;
}

/** Adds the probe to ios/App/App/public; never to dist or a production bundle. */
function inject() {
  const publicDir = join(root, 'ios/App/App/public');
  const indexPath = join(publicDir, 'index.html');
  const html = readFileSync(indexPath, 'utf8');
  if (!html.includes('<meta name="nfct-build" content="development">')) {
    throw new Error('Refusing to add the smoke probe to a bundle that is not the emulator development build (npm run sync:ios:emulators).');
  }
  copyFileSync(join(root, 'scripts/ios/simulator-probe.js'), join(publicDir, PROBE));
  if (!html.includes(PROBE)) writeFileSync(indexPath, html.replace('</body>', `  <script src="./${PROBE}"></script>\n  </body>`));
  console.log(`Added ${PROBE} to ios/App/App/public.`);
}

/**
 * Launches the app with its stdout on a PTY (line-buffered) until the probe
 * reports a result, runs `whileOpen` with the app still in the foreground,
 * then terminates it.
 */
function launch(udid, bundleId, logPath, whileOpen = async () => {}) {
  return new Promise((resolve) => {
    const child = spawn('xcrun', ['simctl', 'launch', '--console-pty', '--terminate-running-process', udid, bundleId], {
      env: { ...process.env, SIMCTL_CHILD_NSUnbufferedIO: 'YES' },
    });
    let log = '';
    let finished = false;
    const finish = async (timedOut) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (!timedOut) await whileOpen();
      try { xcrun('simctl', 'terminate', udid, bundleId); } catch { /* already gone */ }
      child.kill();
      writeFileSync(logPath, log);
      resolve({ log, timedOut });
    };
    const onData = (chunk) => {
      log += chunk;
      if (/\[nfct-smoke\] \{"event":"result"/.test(log)) setTimeout(() => finish(false), 1_000);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => finish(true), LAUNCH_TIMEOUT_MS);
  });
}

const events = (log) => [...log.matchAll(/\[nfct-smoke\] (\{.*\})/g)].map(([, json]) => JSON.parse(json));

/**
 * Judges the two launch logs. Pure, so the Linux test suite covers it with
 * real Simulator logs (scripts/__tests__/simulator-smoke.test.mjs).
 */
export function evaluateSmoke(firstLog, secondLog) {
  const all = firstLog + secondLog;
  const logs = [firstLog, secondLog];
  // Every launch must report its own environment; each one is checked.
  const environments = logs.map((log) => events(log).find(({ event }) => event === 'environment'));
  const everyLaunch = (check) => environments.every((environment) => environment !== undefined && check(environment));
  const environment = environments.find(Boolean) ?? {};
  const result = (log, phase) => events(log).find((event) => event.event === 'result' && event.phase === phase);
  // Capacitor evaluates JS from native code, for example its document
  // 'resume' event when the scene enters the foreground at launch, before the
  // page has loaded. Failures before "WebView loaded" are reported, not
  // failed: they are not errors in the app's code. Any later one fails.
  const evalErrors = logs.map((log) => {
    const loaded = log.indexOf('WebView loaded');
    const at = [...log.matchAll(/JS Eval error/g)].map(({ index }) => index);
    return { early: at.filter((index) => loaded < 0 || index < loaded).length, late: at.filter((index) => loaded >= 0 && index > loaded).length };
  });
  const signUp = result(firstLog, 'sign-up');
  const relaunch = result(secondLog, 'relaunch');
  const checks = [
    ['Capacitor loads the bundled app from capacitor://localhost', logs.every((log) => /Loading app at capacitor:\/\/localhost(?:\/|\.\.\.)/.test(log))],
    ['The web view finishes loading', logs.every((log) => /WebView loaded/.test(log))],
    ['location.origin is capacitor://localhost', everyLaunch(({ origin }) => origin === 'capacitor://localhost')],
    ['The origin is a secure context', everyLaunch(({ secureContext }) => secureContext === true)],
    ['crypto.randomUUID is available', everyLaunch(({ randomUUID }) => randomUUID === 'function')],
    ['Sign-up and role choice work against the emulators', signUp?.ok === true],
    ['A cold relaunch restores the session and role', relaunch?.ok === true],
    // Page errors, from the probe and from Capacitor's own window.onerror bridge.
    ['No uncaught JavaScript errors in the page', !events(all).some(({ event }) => event === 'uncaught-error')
      && !/STARTUP JS ERROR/.test(all)],
    ['No failed native-to-web evaluations after the page loaded', evalErrors.every(({ late }) => late === 0)],
  ];
  return {
    checks,
    environment,
    signUp,
    relaunch,
    consoleErrors: [...all.matchAll(/\[error\] - (.*)/g)].map(([, line]) => line.slice(0, 300)),
    earlyEvalErrors: evalErrors.reduce((sum, { early }) => sum + early, 0),
  };
}

async function run(app, udid, out) {
  mkdirSync(out, { recursive: true });
  const bundleId = execFileSync('plutil', ['-extract', 'CFBundleIdentifier', 'raw', join(app, 'Info.plist')], { encoding: 'utf8' }).trim();
  try { xcrun('simctl', 'boot', udid); } catch { /* already booted */ }
  xcrun('simctl', 'bootstatus', udid, '-b');
  xcrun('simctl', 'ui', udid, 'appearance', 'light');
  try { xcrun('simctl', 'uninstall', udid, bundleId); } catch { /* not installed */ }
  xcrun('simctl', 'install', udid, app);

  const first = await launch(udid, bundleId, join(out, '1-first-launch.log'));
  // Screenshots of the relaunched, signed-in app in both system appearances,
  // for a human look at the status bar and layout.
  const second = await launch(udid, bundleId, join(out, '2-relaunch.log'), async () => {
    await sleep(2_000);
    xcrun('simctl', 'io', udid, 'screenshot', join(out, 'relaunch-light.png'));
    xcrun('simctl', 'ui', udid, 'appearance', 'dark');
    await sleep(3_000);
    xcrun('simctl', 'io', udid, 'screenshot', join(out, 'relaunch-dark-mode.png'));
    xcrun('simctl', 'ui', udid, 'appearance', 'light');
  });

  const { checks, environment, signUp, relaunch, consoleErrors, earlyEvalErrors } = evaluateSmoke(first.log, second.log);
  const runtime = Object.entries(JSON.parse(xcrun('simctl', 'list', 'devices', '--json')).devices)
    .find(([, devices]) => devices.some((device) => device.udid === udid))?.[0].split('.').pop() ?? 'unknown runtime';
  const summary = [
    '## iOS Simulator smoke',
    '',
    `Bundle \`${bundleId}\` on Simulator \`${udid}\` (${runtime}). User agent: ${environment.userAgent ?? 'not reported'}`,
    '',
    '| Check | Result |',
    '| --- | --- |',
    ...checks.map(([name, ok]) => `| ${name} | ${ok ? 'PASS' : '**FAIL**'} |`),
    '',
    `First launch: \`${JSON.stringify(signUp ?? { timedOut: first.timedOut })}\``,
    `Relaunch: \`${JSON.stringify(relaunch ?? { timedOut: second.timedOut })}\``,
    '',
    consoleErrors.length ? `Console errors (reported, not failed):\n\n${consoleErrors.map((line) => `- \`${line}\``).join('\n')}` : 'No console errors.',
    `Capacitor native-to-web evaluations that failed before the page loaded (reported, not failed): ${earlyEvalErrors}.`,
    '',
    'Screenshots and full logs are in the `ios-simulator-smoke` artifact.',
  ].join('\n');
  writeFileSync(join(out, 'summary.md'), summary + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n', { flag: 'a' });
  console.log(summary);
  if (checks.some(([, ok]) => !ok)) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'pick') pick();
  else if (command === 'inject') inject();
  else if (command === 'run' && args.length === 3 && existsSync(args[0])) await run(...args);
  else {
    console.error('Usage: simulator-smoke.mjs pick | inject | run <App.app> <udid> <out-dir>');
    process.exit(2);
  }
}
