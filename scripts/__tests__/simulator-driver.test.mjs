import { afterEach, describe, expect, it } from 'vitest';
import { formatQuestion, questionAt } from '../../shared/games/mental-math/v1/questions';
import { MAX_LEVEL } from '../../shared/games/mental-math/v1/params';
import { AppDriver, PageChannel, StepError, decodeFields, emulatorTargets } from '../ios/simulator-driver.mjs';
import { clockSeconds, solveQuestion } from '../ios/simulator-scenarios.mjs';
import { findRuntime, pickDeviceType } from '../ios/simulator-runtime.mjs';

describe('the Mental Math solver used by the Simulator scenario', () => {
  it('answers every displayed question the way the shared game evaluates it, at every level', () => {
    let checked = 0;
    for (let level = 1; level <= MAX_LEVEL; level += 1) {
      for (let position = 0; position < 60; position += 1) {
        for (const seed of [1, 20_260_930, 987_654_321]) {
          const question = questionAt(seed, position, position % 16, level);
          expect(solveQuestion(`${formatQuestion(question)} =`)).toBe(question.expected);
          checked += 1;
        }
      }
    }
    expect(checked).toBe(1_800);
  });

  it('reads precedence and brackets, and refuses anything that is not a question', () => {
    expect(solveQuestion('12 + 3 × 4 =')).toBe(24);
    expect(solveQuestion('(12 + 3) × 4')).toBe(60);
    expect(solveQuestion('20 - 8 ÷ 4')).toBe(18);
    expect(solveQuestion('20 ÷ 4 - 2')).toBe(3);
    expect(solveQuestion('9 − 4')).toBe(5);
    for (const text of ['', 'No more questions this run', '3 +', '3 ^ 4', '1 + 2 + 3 + 4']) expect(() => solveQuestion(text)).toThrow();
    expect(clockSeconds('1:27')).toBe(87);
    expect(clockSeconds('0:05')).toBe(5);
  });
});

describe('Firestore emulator reads', () => {
  it('decodes REST values to plain JSON', () => {
    expect(decodeFields({
      status: { stringValue: 'completed' },
      activeDurationMs: { integerValue: '90000' },
      ratio: { doubleValue: 0.5 },
      ok: { booleanValue: true },
      none: { nullValue: null },
      at: { timestampValue: '2026-10-01T00:00:00Z' },
      client: { mapValue: { fields: { platform: { stringValue: 'ios' } } } },
      trials: { arrayValue: { values: [{ mapValue: { fields: { response: { integerValue: '7' }, timedOut: { booleanValue: false } } } }] } },
      empty: { arrayValue: {} },
    })).toEqual({
      status: 'completed', activeDurationMs: 90_000, ratio: 0.5, ok: true, none: null, at: '2026-10-01T00:00:00Z',
      client: { platform: 'ios' }, trials: [{ response: 7, timedOut: false }], empty: [],
    });
  });

  it('only ever talks to loopback emulators and a demo project', () => {
    expect(emulatorTargets({})).toEqual({ auth: '127.0.0.1:9099', firestore: '127.0.0.1:8080', project: 'demo-neurasticity-protocol-e2e' });
    expect(() => emulatorTargets({ FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' })).toThrow(/non-loopback/);
    expect(() => emulatorTargets({ GCLOUD_PROJECT: 'nfct-dev' })).toThrow(/not a demo/);
  });
});

/** A stand-in for the page agent: the same HTTP protocol, scripted results. */
function fakePage(port, launch, handle) {
  const base = `http://127.0.0.1:${port}`;
  let running = true;
  const seen = [];
  const loop = (async () => {
    await fetch(`${base}/hello`, { method: 'POST', body: JSON.stringify({ launch, environment: { origin: 'capacitor://localhost' } }) });
    while (running) {
      const command = await (await fetch(`${base}/poll?launch=${launch}`)).json();
      if (command.type === 'idle') continue;
      seen.push(command);
      const result = await handle(command);
      if (result === undefined) continue; // Drop it, as a suspended page would.
      await fetch(`${base}/result`, { method: 'POST', body: JSON.stringify({ launch, id: command.id, result }) });
    }
  })();
  return { seen, stop: () => { running = false; return loop.catch(() => {}); } };
}

describe('the page channel', () => {
  let channel;
  afterEach(async () => {
    await channel?.stop();
    channel = undefined;
  });

  it('sends commands to the connected page and resolves with its results; failed steps throw with the reason', async () => {
    channel = new PageChannel({ port: 0, pollHoldMs: 100 });
    const port = await channel.start();
    const page = fakePage(port, 'launch-1', async (command) => (command.type === 'tap'
      ? { ok: false, reason: 'covered by <div.overlay>' }
      : { ok: true, text: `read ${command.target.css}` }));
    const launch = await channel.waitForLaunch(new Set(), 2_000);
    expect(launch).toBe('launch-1');
    const steps = [];
    const app = new AppDriver(channel, (step) => steps.push(step));
    // Idle polls come and go while nothing is sent.
    await new Promise((resolve) => setTimeout(resolve, 250));
    await expect(app.read({ css: '.mm-question' })).resolves.toMatchObject({ ok: true, text: 'read .mm-question' });
    const failure = await app.tap({ role: 'button', name: 'Pause' }).catch((error) => error);
    expect(failure).toBeInstanceOf(StepError);
    expect(failure.message).toBe('tap button "Pause": covered by <div.overlay>');
    expect(steps.map(({ action, ok }) => [action, ok])).toEqual([['read', true], ['tap', false]]);
    expect(page.seen.map(({ id }) => id)).toEqual([1, 2]);
    await page.stop();
  });

  it('answers CORS preflights and refuses unknown paths', async () => {
    channel = new PageChannel({ port: 0, pollHoldMs: 100 });
    const port = await channel.start();
    const preflight = await fetch(`http://127.0.0.1:${port}/result`, { method: 'OPTIONS' });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
    expect((await fetch(`http://127.0.0.1:${port}/elsewhere`)).status).toBe(404);
  });

  it('redelivers a command the page never received, and fails one cut off by a relaunch', async () => {
    channel = new PageChannel({ port: 0, pollHoldMs: 100 });
    const port = await channel.start();
    let drops = 1;
    const page = fakePage(port, 'launch-1', async () => {
      if (drops > 0) {
        drops -= 1;
        return undefined;
      }
      return { ok: true };
    });
    await channel.waitForLaunch(new Set(), 2_000);
    await expect(channel.send({ type: 'state', timeout: 100 })).resolves.toEqual({ ok: true });
    expect(page.seen.map(({ id }) => id)).toEqual([1, 1]);
    await page.stop();

    // The app is killed mid-command and a new launch connects.
    const hanging = fakePage(port, 'launch-2', async () => new Promise(() => {}));
    await channel.waitForLaunch(new Set(['launch-1']), 2_000);
    const pending = channel.send({ type: 'wait', timeout: 100 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const relaunch = fakePage(port, 'launch-3', async () => ({ ok: true }));
    await expect(pending).rejects.toThrow('The page reloaded or the app restarted before answering.');
    expect(channel.current).toBe('launch-3');
    void hanging.stop();
    await relaunch.stop();
  });

  it('times out waiting for a launch that never connects', async () => {
    channel = new PageChannel({ port: 0, pollHoldMs: 100 });
    await channel.start();
    await expect(channel.waitForLaunch(new Set(), 50)).rejects.toThrow('did not connect within 50 ms');
  });
});

describe('the minimum-iOS runtime choice', () => {
  const iPhone = (name) => ({ name, identifier: `com.apple.CoreSimulator.SimDeviceType.${name.replace(/\W+/g, '-')}`, productFamily: 'iPhone' });
  const runtimes = [
    { identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5', version: '26.5', isAvailable: true, supportedDeviceTypes: [iPhone('iPhone 17')] },
    { identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-16-4', version: '16.4.1', isAvailable: true, supportedDeviceTypes: [
      { name: 'iPad (10th generation)', identifier: 'ipad', productFamily: 'iPad' }, iPhone('iPhone 14'), iPhone('iPhone SE (3rd generation)'),
    ] },
    { identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-17-5', version: '17.5', isAvailable: false, supportedDeviceTypes: [] },
    { identifier: 'com.apple.CoreSimulator.SimRuntime.watchOS-10-5', version: '10.5', isAvailable: true, supportedDeviceTypes: [] },
  ];

  it('finds an available iOS runtime by major.minor, and nothing else', () => {
    expect(findRuntime(runtimes, '16.4')?.identifier).toBe('com.apple.CoreSimulator.SimRuntime.iOS-16-4');
    expect(findRuntime(runtimes, '26.5')?.version).toBe('26.5');
    expect(findRuntime(runtimes, '16.')).toBeNull();
    expect(findRuntime(runtimes, '17.5')).toBeNull();
    expect(findRuntime(runtimes, '10.5')).toBeNull();
  });

  it('prefers the iPhone SE, the smallest supported screen, then any iPhone', () => {
    expect(pickDeviceType(runtimes[1]).name).toBe('iPhone SE (3rd generation)');
    expect(pickDeviceType(runtimes[0]).name).toBe('iPhone 17');
    expect(pickDeviceType({ supportedDeviceTypes: [{ name: 'iPad Air', productFamily: 'iPad' }] })).toBeNull();
    // A runtime that does not list its device types falls back to the ones Xcode knows.
    expect(pickDeviceType({}, [iPhone('iPhone 14'), iPhone('iPhone 17')]).name).toBe('iPhone 14');
  });
});
