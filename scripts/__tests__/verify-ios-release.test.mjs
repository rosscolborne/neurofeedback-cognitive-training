import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { checkCapacitorConfig, checkReleaseProject, checkWebBundle, inlinedEnvironments } from '../verify-ios-release.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (path) => readFileSync(root + path, 'utf8');

// Excerpts of real `vite build` output (minified) for both kinds of bundle.
const PRODUCTION_HTML = '<head><meta name="nfct-build" content="production"></head>';
const DEVELOPMENT_HTML = '<head><meta name="nfct-build" content="development"></head>';
const PRODUCTION_JS = 'var gE=hE({BASE_URL:`/`,DEV:!1,MODE:`production`,PROD:!0,SSR:!1}),Sc=`http://localhost`;';
const EMULATOR_JS = 'var bE=yE({BASE_URL:`/`,DEV:!0,MODE:`development`,PROD:!1,SSR:!1,VITE_E2E_EMULATORS:`true`,'
  + 'VITE_FIREBASE_API_KEY:`local-test-key`,VITE_FIREBASE_PROJECT_ID:`demo-neurasticity-protocol-e2e`});'
  + 'pc(CE,`http://127.0.0.1:9099`,{disableWarnings:!0}),Zv(wE,`127.0.0.1`,8080);';

describe('web bundle check', () => {
  it('reads the inlined import.meta.env', () => {
    expect(inlinedEnvironments(EMULATOR_JS)).toEqual([expect.objectContaining({
      DEV: true, MODE: 'development', VITE_E2E_EMULATORS: 'true',
    })]);
  });

  it('passes a production bundle, including the Firebase SDK\'s bare http://localhost', () => {
    expect(checkWebBundle({ indexHtml: PRODUCTION_HTML, scripts: [{ path: 'index.js', text: PRODUCTION_JS }] })).toEqual([]);
  });

  it('fails the emulator development bundle on every signal', () => {
    const problems = checkWebBundle({ indexHtml: DEVELOPMENT_HTML, scripts: [{ path: 'index.js', text: EMULATOR_JS }] });
    expect(problems.join('\n')).toMatch(/not a production build/);
    expect(problems.join('\n')).toMatch(/local host "127\.0\.0\.1"/);
    expect(problems.join('\n')).toMatch(/DEV is true/);
    expect(problems.join('\n')).toMatch(/development mode/);
    expect(problems.join('\n')).toMatch(/VITE_E2E_EMULATORS is true/);
    expect(problems.join('\n')).toMatch(/emulator-only project demo-neurasticity-protocol-e2e/);
  });

  it('fails a missing bundle or a bundle without the production marker', () => {
    expect(checkWebBundle({ indexHtml: null, scripts: [] })).toHaveLength(1);
    expect(checkWebBundle({ indexHtml: '<head></head>', scripts: [] })).toEqual([expect.stringMatching(/production marker/)]);
  });

  it('allows only an empty or HTTPS BrainFlow service URL', () => {
    const bundle = (url) => checkWebBundle({
      indexHtml: PRODUCTION_HTML,
      scripts: [{ path: 'index.js', text: `x({BASE_URL:\`/\`,DEV:!1,MODE:\`production\`,VITE_BRAINFLOW_SERVICE_URL:\`${url}\`})` }],
    });
    expect(bundle('')).toEqual([]);
    expect(bundle('https://brainflow.example.com')).toEqual([]);
    expect(bundle('http://brainflow.example.com')).toEqual([expect.stringMatching(/VITE_BRAINFLOW_SERVICE_URL .* HTTPS/)]);
  });
});

describe('synced Capacitor config check', () => {
  const synced = JSON.parse(JSON.stringify({ appId: 'x', server: { iosScheme: 'capacitor', hostname: 'localhost' } }));

  it('passes the committed configuration', () => {
    expect(checkCapacitorConfig(synced)).toEqual([]);
  });

  it.each([
    ['live reload', { server: { url: 'http://192.168.1.10:5173' } }, /server\.url/],
    ['cleartext', { server: { cleartext: true } }, /cleartext/],
    ['another origin', { server: { iosScheme: 'https' } }, /capacitor:\/\/localhost/],
    ['an inspectable web view', { ios: { webContentsDebuggingEnabled: true } }, /inspectable/],
    ['release console logging', { loggingBehavior: 'production' }, /device log/],
    ['a missing config', null, /missing/],
  ])('fails %s', (_name, config, message) => {
    expect(checkCapacitorConfig(config)).toEqual([expect.stringMatching(message)]);
  });
});

describe('Release configuration check', () => {
  const project = {
    pbxproj: read('ios/App/App.xcodeproj/project.pbxproj'),
    xcconfigs: { 'debug.xcconfig': read('ios/debug.xcconfig'), 'release.xcconfig': read('ios/release.xcconfig') },
    infoPlist: read('ios/App/App/Info.plist'),
  };

  it('passes the committed project', () => {
    expect(checkReleaseProject(project)).toEqual([]);
  });

  it('fails a Release configuration that reads debug.xcconfig or sets CAPACITOR_DEBUG', () => {
    const debugBase = project.pbxproj.replaceAll(/(baseConfigurationReference = \w{24}) \/\* release\.xcconfig \*\//g, '$1 /* debug.xcconfig */');
    expect(checkReleaseProject({ ...project, pbxproj: debugBase }).join('\n')).toMatch(/must be based on release\.xcconfig/);
    const debugFlag = project.pbxproj.replace('VALIDATE_PRODUCT = YES;', 'VALIDATE_PRODUCT = YES;\n\t\t\t\tCAPACITOR_DEBUG = true;');
    expect(checkReleaseProject({ ...project, pbxproj: debugFlag })).toEqual([expect.stringMatching(/sets CAPACITOR_DEBUG/)]);
  });

  it('fails CAPACITOR_DEBUG in an xcconfig that Release reads, including local signing', () => {
    for (const file of ['release.xcconfig', 'signing.local.xcconfig']) {
      const problems = checkReleaseProject({ ...project, xcconfigs: { ...project.xcconfigs, [file]: 'CAPACITOR_DEBUG = true' } });
      expect(problems).toEqual([expect.stringMatching(new RegExp(`ios/${file} sets CAPACITOR_DEBUG`))]);
    }
  });

  it('fails an App Transport Security exception in the shared Info.plist', () => {
    const infoPlist = project.infoPlist.replace('<dict>', '<dict>\n\t<key>NSAppTransportSecurity</key>\n\t<dict>\n\t\t<key>NSAllowsLocalNetworking</key>\n\t\t<true/>\n\t</dict>');
    expect(checkReleaseProject({ ...project, infoPlist })).toEqual([expect.stringMatching(/NSAppTransportSecurity/)]);
  });
});

describe('Xcode Release guard (ios/scripts/release-web-bundle-guard.sh)', () => {
  const dirs = [];
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

  function guard(configuration, files) {
    const srcroot = mkdtempSync(join(tmpdir(), 'nfct-guard-'));
    dirs.push(srcroot);
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(srcroot, 'App/public/assets'), { recursive: true });
      writeFileSync(join(srcroot, 'App/public', path), content);
    }
    return spawnSync('sh', [root + 'ios/scripts/release-web-bundle-guard.sh'], {
      env: { ...process.env, CONFIGURATION: configuration, SRCROOT: srcroot },
      encoding: 'utf8',
    });
  }

  it('lets Release package a production bundle', () => {
    expect(guard('Release', { 'index.html': PRODUCTION_HTML, 'assets/index.js': PRODUCTION_JS }).status).toBe(0);
  });

  it.each([
    ['a development bundle', { 'index.html': DEVELOPMENT_HTML, 'assets/index.js': EMULATOR_JS }, /not a production build/],
    ['an unmarked bundle', { 'index.html': '<head></head>', 'assets/index.js': PRODUCTION_JS }, /not a production build/],
    ['emulator hosts', { 'index.html': PRODUCTION_HTML, 'assets/index.js': EMULATOR_JS }, /local emulator or service hosts/],
    ['no bundle', {}, /no web bundle/],
  ])('refuses %s in Release', (_name, files, message) => {
    const result = guard('Release', files);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^error: /);
    expect(result.stderr).toMatch(message);
  });

  it('does not check Debug builds', () => {
    expect(guard('Debug', { 'index.html': DEVELOPMENT_HTML, 'assets/index.js': EMULATOR_JS }).status).toBe(0);
  });
});
