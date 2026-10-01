#!/usr/bin/env node
// iOS Simulator scenarios (NFCT-30, NFCT-31, NFCT-39). CI runs them on a
// GitHub-hosted Mac (.github/workflows/ios.yml); they also run on any Mac with
// Xcode. Each scenario installs the emulator Debug build fresh on a booted
// iPhone Simulator, drives the real UI through the page agent
// (simulator-probe.js) against the local emulators, takes screenshots, and
// writes a summary.
//
//   node scripts/ios/simulator-smoke.mjs pick                 # print an iPhone Simulator UDID
//   node scripts/ios/simulator-smoke.mjs inject               # add the page agent to the synced emulator bundle
//   node scripts/ios/simulator-smoke.mjs list [scenario ...]  # describe (and check) the scenarios
//   node scripts/ios/simulator-smoke.mjs run <App.app> <udid> <out-dir> [scenario ...]
//
// `run` needs the Auth and Firestore emulators on 127.0.0.1, for example
// inside `firebase emulators:exec`, and runs every scenario when none is
// named. See docs/nfct/ios.md.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AppDriver, Emulators, PageChannel, Simulator, StepError, evaluateLaunches } from './simulator-driver.mjs';
import { DEFAULT_SCENARIOS, SCENARIOS } from './simulator-scenarios.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const PROBE = 'nfct-simulator-probe.js';
const xcrun = (...args) => execFileSync('xcrun', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

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

/** Adds the page agent to ios/App/App/public; never to dist or a production bundle. */
function inject() {
  const publicDir = join(root, 'ios/App/App/public');
  const indexPath = join(publicDir, 'index.html');
  const html = readFileSync(indexPath, 'utf8');
  if (!html.includes('<meta name="nfct-build" content="development">')) {
    throw new Error('Refusing to add the Simulator page agent to a bundle that is not the emulator development build (npm run sync:ios:emulators).');
  }
  copyFileSync(join(root, 'scripts/ios/simulator-probe.js'), join(publicDir, PROBE));
  if (!html.includes(PROBE)) writeFileSync(indexPath, html.replace('</body>', `  <script src="./${PROBE}"></script>\n  </body>`));
  console.log(`Added ${PROBE} to ios/App/App/public.`);
}

/** Validates scenario names; an empty list means every scenario. */
export function scenarioNames(args) {
  const names = args.flatMap((arg) => arg.split(/[\s,]+/)).filter(Boolean);
  if (names.length === 0 || names.includes('all')) return [...DEFAULT_SCENARIOS];
  const unknown = names.filter((name) => !Object.hasOwn(SCENARIOS, name));
  if (unknown.length) throw new Error(`Unknown scenario(s): ${unknown.join(', ')}. Known: ${DEFAULT_SCENARIOS.join(', ')}.`);
  return [...new Set(names)];
}

const cell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').slice(0, 300);

/** The Markdown summary of a run. Pure, so the Linux tests cover it. */
export function summarize({ device, bundleId, userAgent, results }) {
  const lines = [
    '## iOS Simulator scenarios',
    '',
    `Bundle \`${bundleId}\` on ${device}. User agent: ${userAgent ?? 'not reported'}`,
    '',
    '| Scenario | Result | Checks | Time |',
    '| --- | --- | --- | --- |',
    ...results.map((result) => `| ${result.name} | ${result.ok ? 'PASS' : '**FAIL**'} | ${result.checks.filter(([, ok]) => ok).length}/${result.checks.length} | ${Math.round(result.ms / 1_000)} s |`),
  ];
  for (const result of results) {
    lines.push('', `### ${result.name}`, '', result.summary, '', '| Check | Result | Detail |', '| --- | --- | --- |');
    lines.push(...result.checks.map(([name, ok, detail]) => `| ${cell(name)} | ${ok ? 'PASS' : '**FAIL**'} | ${cell(detail)} |`));
    if (result.error) lines.push('', `Stopped at: \`${cell(result.error)}\``);
    if (result.screen) {
      const { when = 'at the failure', hash, headings, buttons, alerts } = result.screen;
      lines.push('', `Screen ${when}: \`${cell(JSON.stringify({ hash, headings, buttons, alerts }))}\``);
    }
    for (const note of result.notes) lines.push('', note);
    if (result.consoleErrors.length) lines.push('', 'Console errors (reported, not failed):', '', ...result.consoleErrors.map((line) => `- \`${cell(line)}\``));
    if (result.unhandledRejections.length) lines.push('', 'Unhandled promise rejections (reported, not failed):', '', ...result.unhandledRejections.map((line) => `- \`${cell(line)}\``));
    lines.push('', `Capacitor native-to-web evaluations that failed before the page loaded (reported, not failed): ${result.earlyEvalErrors}.`);
    lines.push('', `Screenshots: ${result.screenshots.map((file) => `\`${file}\``).join(', ') || 'none'}.`);
  }
  lines.push('', 'Screenshots, logs (`*.log`), steps (`steps.json`) and `results.json` are in the run\'s `ios-simulator-scenarios` artifact.');
  return lines.join('\n') + '\n';
}

export async function runScenario(name, { device, channel, emulators, out }) {
  const dir = join(out, name);
  mkdirSync(dir, { recursive: true });
  const started = Date.now();
  const steps = [];
  const checks = [];
  const notes = [];
  const screenshots = [];
  const logs = [];
  let launches = 0;
  const record = (step) => steps.push({ at: Date.now() - started, ...step });
  const app = new AppDriver(channel, record);
  const ctx = {
    app,
    channel,
    device,
    emulators,
    account: { email: `ios-${name}-${Date.now()}@example.test`, password: 'simulator-password-1' },
    check(label, ok, detail) {
      checks.push([label, Boolean(ok), detail]);
      record({ action: 'check', target: label, ok: Boolean(ok), detail });
    },
    note(text) {
      notes.push(text);
    },
    /** A screenshot through simctl, plus what the page shows, for agents and reviewers. */
    async checkpoint(label) {
      const file = `${String(screenshots.length + 1).padStart(2, '0')}-${label}.png`;
      await device.screenshot(join(dir, file));
      screenshots.push(file);
      const screen = await app.snapshot();
      record({ action: 'checkpoint', target: label, ok: true, screenshot: file, screen });
      if (screen.horizontalOverflow) notes.push(`Horizontal overflow on screen at checkpoint ${label} (reported, not failed).`);
    },
    /** A launch, with its console captured, and the page agent connected. */
    async launch() {
      const known = new Set(channel.launches.keys());
      launches += 1;
      const capture = await device.launch(join(dir, `launch-${launches}.log`));
      logs.push(capture);
      await channel.waitForLaunch(known, 120_000);
      record({ action: 'launch', target: `launch ${launches}`, ok: true });
    },
    /** Kills the app (simctl terminate) and launches it again. */
    async relaunch() {
      await device.kill();
      record({ action: 'kill', target: 'simctl terminate', ok: true });
      await ctx.launch();
    },
  };

  let error = null;
  let screen = null;
  try {
    await device.install();
    await SCENARIOS[name].run(ctx);
  } catch (caught) {
    error = caught instanceof StepError ? caught.message : String(caught?.stack ?? caught);
    record({ action: 'error', ok: false, detail: error });
    try {
      const file = `${String(screenshots.length + 1).padStart(2, '0')}-failure.png`;
      await device.screenshot(join(dir, file));
      screenshots.push(file);
    } catch { /* the Simulator is gone */ }
    // The page's own view when the step gave up, else what it shows now.
    screen = caught?.result?.screen ? { ok: true, when: 'when the step gave up', ...caught.result.screen } : { when: 'after the failure', ...(await app.snapshot()) };
    record({ action: 'screen', ok: true, screen, screenAfter: caught?.result?.screen ? await app.snapshot() : undefined });
  } finally {
    await device.kill();
  }

  for (const step of steps.filter(({ stalledMs }) => stalledMs >= 2_000)) {
    const stall = `The page's JavaScript stalled for ${(step.stalledMs / 1_000).toFixed(1)} s during ${step.action} ${step.target}`;
    notes.push(`${stall} (reported, not failed).`);
    // An annotation on the checks, so a green run with a freeze is still visible.
    console.log(`::warning title=Simulator page stall (${name})::${stall}`);
  }
  const launchesJudged = evaluateLaunches(logs.map(({ log }) => log));
  const allChecks = [
    ...checks,
    ...(error ? [['The scenario ran to the end', false, error]] : []),
    ...launchesJudged.checks.map(([label, ok]) => [label, ok, `${logs.length} launch(es)`]),
  ];
  writeFileSync(join(dir, 'steps.json'), JSON.stringify(steps, null, 2));
  return {
    name,
    summary: SCENARIOS[name].summary,
    ok: allChecks.every(([, ok]) => ok),
    ms: Date.now() - started,
    checks: allChecks,
    error,
    screen: screen?.ok ? screen : null,
    notes,
    screenshots: screenshots.map((file) => `${name}/${file}`),
    environment: launchesJudged.environment,
    consoleErrors: launchesJudged.consoleErrors,
    unhandledRejections: launchesJudged.unhandledRejections,
    earlyEvalErrors: launchesJudged.earlyEvalErrors,
  };
}

async function run(appPath, udid, out, names) {
  mkdirSync(out, { recursive: true });
  const bundleId = execFileSync('plutil', ['-extract', 'CFBundleIdentifier', 'raw', join(appPath, 'Info.plist')], { encoding: 'utf8' }).trim();
  const device = new Simulator({ udid, bundleId, app: appPath });
  device.boot();
  const emulators = new Emulators();
  const channel = new PageChannel();
  await channel.start();
  const results = [];
  try {
    for (const name of names) {
      console.log(`--- ${name}`);
      const result = await runScenario(name, { device, channel, emulators, out });
      console.log(`--- ${name}: ${result.ok ? 'PASS' : 'FAIL'} in ${Math.round(result.ms / 1_000)} s`);
      results.push(result);
    }
  } finally {
    await channel.stop();
  }
  const description = `${device.describe()} (\`${udid}\`)`;
  const summary = summarize({ device: description, bundleId, userAgent: results.find((result) => result.environment.userAgent)?.environment.userAgent, results });
  writeFileSync(join(out, 'summary.md'), summary);
  writeFileSync(join(out, 'results.json'), JSON.stringify({ device: description, bundleId, results }, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, summary, { flag: 'a' });
  console.log(summary);
  if (results.some((result) => !result.ok)) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'pick') pick();
  else if (command === 'inject') inject();
  else if (command === 'list') for (const name of scenarioNames(args)) console.log(`${name}: ${SCENARIOS[name].summary}`);
  else if (command === 'run' && args.length >= 3 && existsSync(args[0])) await run(args[0], args[1], args[2], scenarioNames(args.slice(3)));
  else {
    console.error('Usage: simulator-smoke.mjs pick | inject | list [scenario ...] | run <App.app> <udid> <out-dir> [scenario ...]');
    process.exit(2);
  }
}
