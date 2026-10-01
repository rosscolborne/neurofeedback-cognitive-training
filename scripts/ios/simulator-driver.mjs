// The host half of the iOS Simulator driver (NFCT-39). No dependencies:
// node:http for the page channel, `xcrun simctl` for the device, and the
// emulators' REST APIs for host-side checks.
//
// - PageChannel: the HTTP endpoint the page agent (simulator-probe.js) polls
//   for commands, on 127.0.0.1:AGENT_PORT, which the Simulator shares.
// - AppDriver: tap, fill, wait and read, sent to the page, each one recorded
//   as a step.
// - Simulator: install, launch with the console captured, kill, background,
//   foreground, screenshots and appearance, through simctl.
// - evaluateLaunches: judges the captured console logs (pure, tested on Linux).
// - Emulators: reads the Auth and Firestore emulators from the host.
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';

/** The page agent's fixed host port; simulator-probe.js uses the same one. */
export const AGENT_PORT = 8735;
const DELIVERY_MARGIN_MS = 30_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- The page channel ----

/**
 * The page agent says hello once per page load (a launch), then long-polls for
 * commands and posts each result. The host sends one command at a time to the
 * newest launch. A hello from a new launch while a command is outstanding
 * means the page reloaded or the app restarted, and fails that command.
 */
export class PageChannel {
  constructor({ port = AGENT_PORT, pollHoldMs = 10_000 } = {}) {
    this.port = port;
    this.pollHoldMs = pollHoldMs;
    this.launches = new Map();
    this.current = null;
    this.poll = null;
    this.outstanding = null;
    this.launchWaiters = [];
    this.sequence = 0;
  }

  start() {
    this.server = createServer((request, response) => this.handle(request, response));
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, '127.0.0.1', () => {
        this.port = this.server.address().port;
        resolve(this.port);
      });
    });
  }

  async stop() {
    if (this.poll) this.reply(this.poll, { type: 'idle' });
    this.outstanding?.fail(new Error('The driver stopped.'));
    if (!this.server) return;
    const closed = new Promise((resolve) => this.server.close(() => resolve()));
    this.server.closeAllConnections();
    await closed;
  }

  /** Resolves with the id of the first launch that is not in `known`. */
  waitForLaunch(known, timeout) {
    const fresh = [...this.launches.keys()].find((id) => !known.has(id));
    if (fresh) return Promise.resolve(fresh);
    return new Promise((resolve, reject) => {
      const waiter = { known, resolve, timer: setTimeout(() => {
        this.launchWaiters = this.launchWaiters.filter((other) => other !== waiter);
        reject(new Error(`The app's page did not connect within ${timeout} ms.`));
      }, timeout) };
      this.launchWaiters.push(waiter);
    });
  }

  /** Sends one command to the current launch and resolves with the page's result. */
  send(command) {
    if (!this.current) return Promise.reject(new Error('No page is connected.'));
    if (this.outstanding) return Promise.reject(new Error('A command is already outstanding.'));
    const limit = (command.timeout ?? 10_000) + DELIVERY_MARGIN_MS;
    return new Promise((resolve, reject) => {
      const outstanding = {
        command: { id: ++this.sequence, ...command },
        launch: this.current,
        delivered: false,
        done: (result) => { clearTimeout(outstanding.timer); this.outstanding = null; resolve(result); },
        fail: (error) => { clearTimeout(outstanding.timer); this.outstanding = null; reject(error); },
      };
      outstanding.timer = setTimeout(() => outstanding.fail(new Error(
        `The page did not ${outstanding.delivered ? 'answer' : 'collect'} the ${command.type} command within ${limit} ms.`,
      )), limit);
      this.outstanding = outstanding;
      if (this.poll?.launch === this.current) this.deliver();
    });
  }

  deliver() {
    const { poll, outstanding } = this;
    if (!poll || !outstanding || outstanding.delivered || poll.launch !== outstanding.launch) return;
    outstanding.delivered = true;
    this.poll = null;
    clearTimeout(poll.timer);
    this.reply(poll, outstanding.command);
  }

  reply({ response }, body, status = 200) {
    if (response.writableEnded) return;
    response.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    response.end(JSON.stringify(body));
  }

  handle(request, response) {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method === 'OPTIONS') return this.reply({ response }, {}, 204);
    if (request.method === 'GET' && url.pathname === '/poll') return this.onPoll(url.searchParams.get('launch'), response);
    if (request.method === 'POST' && (url.pathname === '/hello' || url.pathname === '/result')) {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        let message;
        try {
          message = JSON.parse(body);
        } catch {
          return this.reply({ response }, { error: 'bad json' }, 400);
        }
        if (url.pathname === '/hello') this.onHello(message);
        else this.onResult(message);
        return this.reply({ response }, {});
      });
      return undefined;
    }
    return this.reply({ response }, { error: 'not found' }, 404);
  }

  onHello({ launch, environment }) {
    if (typeof launch !== 'string' || this.launches.has(launch)) return;
    this.launches.set(launch, { environment, at: Date.now() });
    const previous = this.current;
    this.current = launch;
    if (this.outstanding && this.outstanding.launch === previous) {
      this.outstanding.fail(new Error('The page reloaded or the app restarted before answering.'));
    }
    for (const waiter of this.launchWaiters.filter(({ known }) => !known.has(launch))) {
      clearTimeout(waiter.timer);
      waiter.resolve(launch);
    }
    this.launchWaiters = this.launchWaiters.filter(({ known }) => known.has(launch));
  }

  onPoll(launch, response) {
    const poll = { launch, response };
    if (launch !== this.current) {
      // A page this driver is not talking to: keep it idle, slowly.
      poll.timer = setTimeout(() => this.reply(poll, { type: 'idle' }), this.pollHoldMs);
      response.on('close', () => clearTimeout(poll.timer));
      return;
    }
    if (this.poll) {
      clearTimeout(this.poll.timer);
      this.reply(this.poll, { type: 'idle' });
    }
    // The page polls only when it is idle, so a poll while a delivered command
    // is unanswered means the page never got it (for example, the response
    // reached a request that iOS dropped while the app was suspended).
    if (this.outstanding?.delivered && this.outstanding.launch === launch) this.outstanding.delivered = false;
    this.poll = poll;
    poll.timer = setTimeout(() => {
      if (this.poll === poll) this.poll = null;
      this.reply(poll, { type: 'idle' });
    }, this.pollHoldMs);
    response.on('close', () => {
      if (this.poll === poll) {
        clearTimeout(poll.timer);
        this.poll = null;
      }
    });
    this.deliver();
  }

  onResult({ launch, id, result }) {
    const { outstanding } = this;
    if (!outstanding || outstanding.command.id !== id || outstanding.launch !== launch) return;
    outstanding.done(result ?? { ok: false, reason: 'The page sent no result.' });
  }
}

// ---- What scenarios call ----

export class StepError extends Error {
  constructor(message, result = {}) {
    super(message);
    this.result = result;
  }
}

/** Describes a target the way the page agent does, for the step log. */
export function describeTarget(target) {
  if (!target) return '';
  const base = target.css ? `css ${target.css}`
    : target.role ? `${target.role}${target.name !== undefined ? ` "${target.name}"` : ''}`
      : target.placeholder !== undefined ? `placeholder "${target.placeholder}"` : `text "${target.text}"`;
  return target.within ? `${base} in ${describeTarget(target.within)}` : base;
}

const describeConditions = (conditions) => conditions
  .map((condition) => (condition.hash !== undefined ? `hash ${condition.hash}` : `${describeTarget(condition.target)} ${condition.state ?? 'visible'}`))
  .join(' | ');

/** Sends DOM commands to the app's page; every call is a recorded step. */
export class AppDriver {
  constructor(channel, record) {
    this.channel = channel;
    this.record = record;
  }

  async command(action, description, command) {
    const started = Date.now();
    let result;
    try {
      result = await this.channel.send(command);
    } catch (error) {
      result = { ok: false, reason: error.message };
    }
    this.record({ action, target: description, ok: result.ok === true, ms: Date.now() - started, detail: result.ok ? undefined : result.reason, scrolled: result.scrolled || undefined });
    if (result.ok !== true) throw new StepError(`${action} ${description}: ${result.reason ?? 'failed'}`, result);
    return result;
  }

  /** Taps a single visible, enabled, unobstructed element; `then` waits in the page right after. */
  tap(target, { timeout, then, thenTimeout } = {}) {
    const after = then ? { conditions: [then].flat(), timeout: thenTimeout } : undefined;
    return this.command('tap', describeTarget(target), { type: 'tap', target, timeout, then: after });
  }

  fill(target, value, { timeout } = {}) {
    return this.command('fill', describeTarget(target), { type: 'fill', target, value, timeout });
  }

  /** Waits until any condition holds; resolves with its index and what it saw. */
  wait(conditions, { timeout } = {}) {
    const list = [conditions].flat();
    return this.command('wait', describeConditions(list), { type: 'wait', conditions: list, timeout });
  }

  /** Like wait, but resolves null instead of failing when nothing holds in time. */
  async waitIfAny(conditions, { timeout } = {}) {
    try {
      return await this.wait(conditions, { timeout });
    } catch (error) {
      if (error instanceof StepError) return null;
      throw error;
    }
  }

  read(target, { timeout } = {}) {
    return this.command('read', describeTarget(target), { type: 'read', target, timeout });
  }

  state() {
    return this.command('state', '', { type: 'state', timeout: 2_000 });
  }

  /** What is on screen. Never throws: it is used while reporting failures. */
  async snapshot() {
    try {
      return await this.channel.send({ type: 'snapshot', timeout: 3_000 });
    } catch (error) {
      return { ok: false, reason: error.message };
    }
  }
}

// ---- The Simulator ----

const xcrun = (...args) => execFileSync('xcrun', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * One app on one booted Simulator. Lifecycle goes through simctl:
 * background launches another app (Settings), foreground launches ours again
 * (iOS resumes the running process), kill is `simctl terminate`.
 */
export class Simulator {
  constructor({ udid, bundleId, app }) {
    Object.assign(this, { udid, bundleId, app });
    this.console = null;
  }

  boot() {
    try { xcrun('simctl', 'boot', this.udid); } catch { /* already booted */ }
    xcrun('simctl', 'bootstatus', this.udid, '-b');
    this.appearance('light');
  }

  /** A fresh install: no storage from a previous scenario. */
  async install() {
    await this.kill();
    try { xcrun('simctl', 'uninstall', this.udid, this.bundleId); } catch { /* not installed */ }
    xcrun('simctl', 'install', this.udid, this.app);
  }

  /** Launches the app with its stdout on a PTY (line-buffered), saved to `logPath` when it ends. */
  async launch(logPath) {
    await this.kill();
    const child = spawn('xcrun', ['simctl', 'launch', '--console-pty', '--terminate-running-process', this.udid, this.bundleId], {
      env: { ...process.env, SIMCTL_CHILD_NSUnbufferedIO: 'YES' },
    });
    const capture = { log: '', path: logPath, child };
    capture.exited = new Promise((resolve) => child.on('exit', resolve));
    const append = (chunk) => { capture.log += chunk; };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    this.console = capture;
    return capture;
  }

  /** Terminates the app, as a kill from the app switcher does, and saves its log. */
  async kill() {
    try { xcrun('simctl', 'terminate', this.udid, this.bundleId); } catch { /* not running */ }
    const capture = this.console;
    this.console = null;
    if (!capture) return null;
    // Lets the last console lines through before closing the PTY.
    await Promise.race([capture.exited, sleep(3_000)]);
    capture.child.kill();
    writeFileSync(capture.path, capture.log);
    return capture;
  }

  background() {
    xcrun('simctl', 'launch', this.udid, 'com.apple.Preferences');
  }

  foreground() {
    xcrun('simctl', 'launch', this.udid, this.bundleId);
  }

  screenshot(path) {
    xcrun('simctl', 'io', this.udid, 'screenshot', path);
  }

  appearance(mode) {
    xcrun('simctl', 'ui', this.udid, 'appearance', mode);
  }

  /** The device's name and runtime, e.g. "iPhone 17, iOS 26.5". */
  describe() {
    const { devices } = JSON.parse(xcrun('simctl', 'list', 'devices', '--json'));
    for (const [runtime, list] of Object.entries(devices)) {
      const device = list.find((candidate) => candidate.udid === this.udid);
      if (device) return `${device.name}, ${runtime.split('.').pop().replace(/^iOS-/, 'iOS ').replace(/-/g, '.')}`;
    }
    return 'unknown device';
  }
}

// ---- Judging the console logs ----

export const events = (log) => [...log.matchAll(/\[nfct-smoke\] (\{.*\})/g)].flatMap(([, json]) => {
  try {
    return [JSON.parse(json)];
  } catch {
    return [];
  }
});

/**
 * Judges every launch's console log (the app's stdout). Pure, so the Linux
 * test suite covers it with real Simulator logs.
 */
export function evaluateLaunches(logs) {
  const all = logs.join('\n');
  const environments = logs.map((log) => events(log).find(({ event }) => event === 'environment'));
  const everyLaunch = (check) => logs.length > 0 && environments.every((environment) => environment !== undefined && check(environment));
  // Capacitor evaluates JS from native code, for example its document
  // 'resume' event when the scene enters the foreground at launch, before the
  // page has loaded. Failures before "WebView loaded" are reported, not
  // failed: they are not errors in the app's code. Any later one fails.
  const evalErrors = logs.map((log) => {
    const loaded = log.indexOf('WebView loaded');
    const at = [...log.matchAll(/JS Eval error/g)].map(({ index }) => index);
    return { early: at.filter((index) => loaded < 0 || index < loaded).length, late: at.filter((index) => loaded >= 0 && index > loaded).length };
  });
  const checks = [
    ['Capacitor loads the bundled app from capacitor://localhost', logs.length > 0 && logs.every((log) => /Loading app at capacitor:\/\/localhost(?:\/|\.\.\.)/.test(log))],
    ['The web view finishes loading', logs.length > 0 && logs.every((log) => /WebView loaded/.test(log))],
    ['location.origin is capacitor://localhost', everyLaunch(({ origin }) => origin === 'capacitor://localhost')],
    ['The origin is a secure context', everyLaunch(({ secureContext }) => secureContext === true)],
    ['crypto.randomUUID is available', everyLaunch(({ randomUUID }) => randomUUID === 'function')],
    // Page errors, from the agent and from Capacitor's own window.onerror bridge.
    ['No uncaught JavaScript errors in the page', !events(all).some(({ event }) => event === 'uncaught-error') && !/STARTUP JS ERROR/.test(all)],
    ['No failed native-to-web evaluations after the page loaded', evalErrors.every(({ late }) => late === 0)],
  ];
  return {
    checks,
    environment: environments.find(Boolean) ?? {},
    consoleErrors: [...all.matchAll(/\[error\] - (.*)/g)].map(([, line]) => line.slice(0, 300)),
    unhandledRejections: events(all).filter(({ event }) => event === 'unhandled-rejection').map(({ message }) => String(message).slice(0, 300)),
    earlyEvalErrors: evalErrors.reduce((sum, { early }) => sum + early, 0),
  };
}

// ---- The emulators, read from the host ----

const EMULATOR_PROJECT = 'demo-neurasticity-protocol-e2e';

/** Firestore REST values to plain JSON. */
export function decodeValue(value) {
  if (value === undefined || value === null) return undefined;
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('stringValue' in value) return value.stringValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(decodeValue);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields ?? {});
  if ('referenceValue' in value) return value.referenceValue;
  if ('geoPointValue' in value) return value.geoPointValue;
  if ('bytesValue' in value) return value.bytesValue;
  return undefined;
}

export const decodeFields = (fields) => Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]));

/** Loopback emulator hosts and a demo project only: never a real Firebase project. */
export function emulatorTargets(env = process.env) {
  const auth = env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
  const firestore = env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  const project = env.GCLOUD_PROJECT || EMULATOR_PROJECT;
  for (const host of [auth, firestore]) {
    if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host)) throw new Error(`Refusing a non-loopback emulator host: ${host}`);
  }
  if (!project.startsWith('demo-')) throw new Error(`Refusing a project that is not a demo emulator project: ${project}`);
  return { auth, firestore, project };
}

export class Emulators {
  constructor(targets = emulatorTargets()) {
    this.targets = targets;
  }

  /** The uid of an account the scenario signed up through the UI. */
  async uid({ email, password }) {
    const response = await fetch(`http://${this.targets.auth}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-test-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    });
    const body = await response.json();
    if (!response.ok || !body.localId) throw new Error(`The Auth emulator has no account for ${email}: ${JSON.stringify(body.error ?? body)}`);
    return body.localId;
  }

  /** Every document in a collection, read past the rules (the emulator's owner token). */
  async list(path) {
    const { firestore, project } = this.targets;
    const response = await fetch(`http://${firestore}/v1/projects/${project}/databases/(default)/documents/${path}?pageSize=300`, {
      headers: { Authorization: 'Bearer owner' },
    });
    if (!response.ok) throw new Error(`Firestore emulator read of ${path} failed: ${response.status} ${await response.text()}`);
    const { documents = [] } = await response.json();
    return documents.map(({ name, fields = {} }) => ({ id: name.split('/').pop(), data: decodeFields(fields) }));
  }

  gameSessions(uid) {
    return this.list(`users/${uid}/gameSessions`);
  }

  /** Polls until `accept(documents)` is true; resolves with the last read. */
  async until(read, accept, timeout = 30_000) {
    const end = Date.now() + timeout;
    for (;;) {
      const documents = await read();
      if (accept(documents) || Date.now() >= end) return documents;
      await sleep(500);
    }
  }
}
