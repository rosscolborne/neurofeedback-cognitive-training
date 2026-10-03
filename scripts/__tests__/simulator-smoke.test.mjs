import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AGENT_PORT, evaluateLaunches } from '../ios/simulator-driver.mjs';
import { scenarioNames, summarize } from '../ios/simulator-smoke.mjs';
import { DEFAULT_SCENARIOS } from '../ios/simulator-scenarios.mjs';

// Trimmed from a real run on an iPhone 17 Simulator (iOS 26.5) in ios.yml:
// the app's stdout on a PTY, with CRLF line endings.
const ENVIRONMENT = '{"event":"environment","origin":"capacitor://localhost","secureContext":true,"randomUUID":"function","indexedDB":"object","userAgent":"Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)"}';
const launchLog = ({ afterLoad = '' } = {}) => [
  '2026-10-01 03:56:08.644 App[8689:32330] DiskCookieStorage changing policy from 2 to 0',
  '⚡️  Loading app at capacitor://localhost...',
  '⚡️  JS Eval error A JavaScript exception occurred',
  `⚡️  [log] - [nfct-smoke] ${ENVIRONMENT}`,
  '⚡️  WebView loaded',
  afterLoad,
].filter(Boolean).join('\r\n');
const FIRST = launchLog();
const SECOND = launchLog();
const failed = (checks) => checks.filter(([, ok]) => !ok).map(([name]) => name);

describe('iOS Simulator launch evaluation', () => {
  it('passes the real logs and reports, not fails, Capacitor\'s pre-load eval errors', () => {
    const outcome = evaluateLaunches([FIRST, SECOND]);
    expect(failed(outcome.checks)).toEqual([]);
    expect(outcome.checks).toHaveLength(7);
    expect(outcome.earlyEvalErrors).toBe(2);
    expect(outcome.environment.origin).toBe('capacitor://localhost');
  });

  it('fails a native-to-web eval error after the page loaded', () => {
    const late = launchLog({ afterLoad: '⚡️  JS Eval error A JavaScript exception occurred' });
    expect(failed(evaluateLaunches([FIRST, late]).checks)).toEqual(['No failed native-to-web evaluations after the page loaded']);
  });

  it('fails uncaught page errors, from the agent or from Capacitor, and reports unhandled rejections', () => {
    const agent = launchLog({ afterLoad: '⚡️  [log] - [nfct-smoke] {"event":"uncaught-error","message":"boom"}' });
    const capacitor = launchLog({ afterLoad: '⚡️  ------ STARTUP JS ERROR ------' });
    for (const log of [agent, capacitor]) {
      expect(failed(evaluateLaunches([FIRST, log]).checks)).toEqual(['No uncaught JavaScript errors in the page']);
    }
    const rejection = launchLog({ afterLoad: '⚡️  [log] - [nfct-smoke] {"event":"unhandled-rejection","message":"later"}' });
    const outcome = evaluateLaunches([rejection]);
    expect(failed(outcome.checks)).toEqual([]);
    expect(outcome.unhandledRejections).toEqual(['later']);
  });

  it('fails another origin in any launch, a launch that never reported, and no launches at all', () => {
    const otherOrigin = FIRST.replaceAll('capacitor://localhost', 'https://localhost');
    expect(failed(evaluateLaunches([FIRST, otherOrigin]).checks)).toEqual([
      'Capacitor loads the bundled app from capacitor://localhost',
      'location.origin is capacitor://localhost',
    ]);
    const silent = FIRST.split('\r\n').filter((line) => !line.includes('nfct-smoke')).join('\r\n');
    expect(failed(evaluateLaunches([FIRST, silent]).checks)).toEqual([
      'location.origin is capacitor://localhost',
      'The origin is a secure context',
      'crypto.randomUUID is available',
    ]);
    expect(failed(evaluateLaunches([]).checks)).toHaveLength(5);
  });
});

describe('iOS Simulator scenario runner', () => {
  it('runs every scenario by default and refuses unknown names', () => {
    expect(scenarioNames([])).toEqual(DEFAULT_SCENARIOS);
    expect(scenarioNames(['all'])).toEqual(DEFAULT_SCENARIOS);
    expect(scenarioNames(['smoke,lifecycle', 'smoke'])).toEqual(['smoke', 'lifecycle']);
    expect(scenarioNames(['mental-math lifecycle'])).toEqual(['mental-math', 'lifecycle']);
    expect(() => scenarioNames(['smoke', 'rm -rf'])).toThrow(/Unknown scenario\(s\): rm, -rf/);
  });

  it('summarizes each scenario\'s checks, failures and screenshots', () => {
    const base = { ms: 61_000, notes: [], consoleErrors: [], unhandledRejections: [], earlyEvalErrors: 1, environment: {} };
    const summary = summarize({
      device: 'iPhone 17, iOS 26.5',
      bundleId: 'com.example',
      userAgent: 'UA',
      results: [
        { ...base, name: 'smoke', summary: 'Smoke.', ok: true, checks: [['Signs up', true]], screenshots: ['smoke/01-welcome.png'], error: null, screen: null },
        { ...base, name: 'lifecycle', summary: 'Lifecycle.', ok: false, checks: [['Pauses', false, 'a | b']], screenshots: [], error: 'tap button "Pause": covered', screen: { hash: '#/' } },
      ],
    });
    expect(summary).toContain('| smoke | PASS | 1/1 | 61 s |');
    expect(summary).toContain('| lifecycle | **FAIL** | 0/1 | 61 s |');
    expect(summary).toContain('| Pauses | **FAIL** | a \\| b |');
    expect(summary).toContain('Stopped at: `tap button "Pause": covered`');
    expect(summary).toContain('`smoke/01-welcome.png`');
  });

  it('keeps the page agent and the host on the same port', () => {
    const probe = readFileSync(new URL('../ios/simulator-probe.js', import.meta.url), 'utf8');
    expect(probe).toContain(`const HOST = 'http://127.0.0.1:${AGENT_PORT}';`);
  });
});
