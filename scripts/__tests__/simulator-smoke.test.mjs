import { describe, expect, it } from 'vitest';
import { evaluateSmoke } from '../ios/simulator-smoke.mjs';

// Trimmed from a real run on an iPhone 17 Simulator (iOS 26.5) in ios.yml:
// the app's stdout on a PTY, with CRLF line endings.
const ENVIRONMENT = '{"event":"environment","origin":"capacitor://localhost","secureContext":true,"randomUUID":"function","indexedDB":"object","userAgent":"Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)"}';
const launchLog = (result, { afterLoad = '' } = {}) => [
  '2026-10-01 03:56:08.644 App[8689:32330] DiskCookieStorage changing policy from 2 to 0',
  '⚡️  Loading app at capacitor://localhost...',
  '⚡️  JS Eval error A JavaScript exception occurred',
  `⚡️  [log] - [nfct-smoke] ${ENVIRONMENT}`,
  '⚡️  WebView loaded',
  afterLoad,
  `⚡️  [log] - [nfct-smoke] ${result}`,
].filter(Boolean).join('\r\n');
const FIRST = launchLog('{"event":"result","phase":"sign-up","ok":true,"email":"ios-smoke-1@example.test"}');
const SECOND = launchLog('{"event":"result","phase":"relaunch","ok":true,"screen":"signed-in","hash":""}');
const failed = (checks) => checks.filter(([, ok]) => !ok).map(([name]) => name);

describe('iOS Simulator smoke evaluation', () => {
  it('passes the real logs and reports, not fails, Capacitor\'s pre-load eval errors', () => {
    const outcome = evaluateSmoke(FIRST, SECOND);
    expect(failed(outcome.checks)).toEqual([]);
    expect(outcome.checks).toHaveLength(9);
    expect(outcome.earlyEvalErrors).toBe(2);
    expect(outcome.environment.origin).toBe('capacitor://localhost');
  });

  it('fails a native-to-web eval error after the page loaded', () => {
    const late = launchLog('{"event":"result","phase":"relaunch","ok":true}', { afterLoad: '⚡️  JS Eval error A JavaScript exception occurred' });
    expect(failed(evaluateSmoke(FIRST, late).checks)).toEqual(['No failed native-to-web evaluations after the page loaded']);
  });

  it('fails uncaught page errors, from the probe or from Capacitor', () => {
    const probe = launchLog('{"event":"result","phase":"relaunch","ok":true}', { afterLoad: '⚡️  [log] - [nfct-smoke] {"event":"uncaught-error","message":"boom"}' });
    const capacitor = launchLog('{"event":"result","phase":"relaunch","ok":true}', { afterLoad: '⚡️  ------ STARTUP JS ERROR ------' });
    for (const log of [probe, capacitor]) {
      expect(failed(evaluateSmoke(FIRST, log).checks)).toEqual(['No uncaught JavaScript errors in the page']);
    }
  });

  it('fails another origin in either launch, a missing result and a signed-out relaunch', () => {
    const otherOrigin = (log) => log.replaceAll('capacitor://localhost', 'https://localhost');
    for (const [first, second] of [[otherOrigin(FIRST), SECOND], [FIRST, otherOrigin(SECOND)]]) {
      expect(failed(evaluateSmoke(first, second).checks)).toEqual([
        'Capacitor loads the bundled app from capacitor://localhost',
        'location.origin is capacitor://localhost',
      ]);
    }
    expect(failed(evaluateSmoke(FIRST.split('\r\n').slice(0, -1).join('\r\n'), SECOND).checks))
      .toEqual(['Sign-up and role choice work against the emulators']);
    const signedOut = launchLog('{"event":"result","phase":"relaunch","ok":false,"screen":"signed-out"}');
    expect(failed(evaluateSmoke(FIRST, signedOut).checks)).toEqual(['A cold relaunch restores the session and role']);
  });
});
