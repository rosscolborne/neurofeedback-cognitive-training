#!/usr/bin/env node
// Fails if the iOS app, as last synced by `npx cap sync ios`, would ship
// development settings in a Release build or archive (NFCT-31). It checks:
//
// - the web bundle Capacitor copied into ios/App/App/public;
// - the synced ios/App/App/capacitor.config.json;
// - the Release build configurations, their xcconfig files and Info.plist.
//
// `npm run sync:ios` runs it, and CI runs it on a production build. The
// emulator bundle from `npm run sync:ios:emulators` fails it by design.
// ios/scripts/release-web-bundle-guard.sh repeats the web-bundle part inside
// Xcode; keep the two in step. See docs/nfct/ios.md.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildConfigurations, configurationLists, parsePlist } from './ios/xcode-project.mjs';

const PRODUCTION_MARKER = '<meta name="nfct-build" content="production">';
// Hosts compiled in only by emulator or local-service development builds.
const LOCAL_HOST = /127\.0\.0\.1|localhost:\d|0\.0\.0\.0:\d/;
// Vite inlines import.meta.env as an object literal wherever it is used whole.
const ENV_LITERAL = /\{BASE_URL:[^{}]*\}/g;
const ENV_ENTRY = /([A-Za-z_$][\w$]*):(`[^`]*`|"[^"]*"|'[^']*'|!0|!1|true|false|void 0|-?\d+(?:\.\d+)?)/g;

function envValue(raw) {
  if (raw === '!0' || raw === 'true') return true;
  if (raw === '!1' || raw === 'false') return false;
  if (raw === 'void 0') return undefined;
  if (/^[`"']/.test(raw)) return raw.slice(1, -1);
  return Number(raw);
}

/** Parses each inlined import.meta.env object literal in a script. */
export function inlinedEnvironments(script) {
  return [...script.matchAll(ENV_LITERAL)].map(([literal]) =>
    Object.fromEntries([...literal.matchAll(ENV_ENTRY)].map(([, key, raw]) => [key, envValue(raw)])));
}

/**
 * Checks the synced web bundle. `indexHtml` is null when it is missing;
 * `scripts` are its JavaScript files as { path, text }.
 */
export function checkWebBundle({ indexHtml, scripts }) {
  if (indexHtml === null) return ['ios/App/App/public/index.html is missing: there is no synced web bundle.'];
  const problems = [];
  if (!indexHtml.includes(PRODUCTION_MARKER)) {
    problems.push('ios/App/App/public is not a production build: index.html lacks the nfct-build production marker (vite.config.ts).');
  }
  for (const { path, text } of scripts) {
    const host = text.match(LOCAL_HOST);
    if (host) problems.push(`${path}: contains the local host "${host[0]}", which only emulator or local-service builds compile in.`);
    for (const env of inlinedEnvironments(text)) {
      if (env.DEV === true) problems.push(`${path}: import.meta.env.DEV is true (a development build).`);
      if (env.MODE === 'development' || env.MODE === 'test') problems.push(`${path}: built in ${env.MODE} mode.`);
      if (env.VITE_E2E_EMULATORS === 'true') problems.push(`${path}: VITE_E2E_EMULATORS is true (an emulator build).`);
      if (typeof env.VITE_FIREBASE_PROJECT_ID === 'string' && env.VITE_FIREBASE_PROJECT_ID.startsWith('demo-')) {
        problems.push(`${path}: VITE_FIREBASE_PROJECT_ID is the emulator-only project ${env.VITE_FIREBASE_PROJECT_ID}.`);
      }
      for (const [key, value] of Object.entries(env)) {
        if (key.startsWith('VITE_') && typeof value === 'string' && /^http:\/\//i.test(value.trim())) {
          problems.push(`${path}: ${key} is ${value}; a release build may only call HTTPS services.`);
        }
      }
    }
  }
  return problems;
}

/** Checks the synced capacitor.config.json (null when it is missing). */
export function checkCapacitorConfig(config) {
  if (config === null) return ['ios/App/App/capacitor.config.json is missing: run npx cap sync ios.'];
  const problems = [];
  const server = config.server ?? {};
  if (server.url) problems.push(`server.url (${server.url}) loads the app from a server instead of the bundled files.`);
  if (server.cleartext === true) problems.push('server.cleartext allows plain-HTTP loads.');
  if ((server.iosScheme ?? 'capacitor') !== 'capacitor' || (server.hostname ?? 'localhost') !== 'localhost') {
    problems.push(`The iOS origin must stay capacitor://localhost (ADR-002), not ${server.iosScheme ?? 'capacitor'}://${server.hostname ?? 'localhost'}.`);
  }
  if (config.ios?.webContentsDebuggingEnabled === true) problems.push('ios.webContentsDebuggingEnabled makes the Release web view inspectable.');
  if ((config.ios?.loggingBehavior ?? config.loggingBehavior) === 'production') {
    problems.push('loggingBehavior "production" writes web console output to the device log in Release builds.');
  }
  return problems;
}

/**
 * Checks the Release build configurations of the App project, the xcconfig
 * files they can read (`xcconfigs`: { 'release.xcconfig': text, ... }) and
 * Info.plist, which Debug and Release share.
 */
export function checkReleaseProject({ pbxproj, xcconfigs, infoPlist }) {
  const problems = [];
  const configurations = buildConfigurations(pbxproj);
  const lists = configurationLists(pbxproj);
  const targetIds = new Set(lists['PBXNativeTarget App'] ?? []);
  const releases = configurations.filter((configuration) => configuration.name === 'Release');
  if (!releases.some(({ id }) => targetIds.has(id))) problems.push('The App target has no Release configuration.');
  for (const { id, base, settings } of releases) {
    const where = `${targetIds.has(id) ? 'App target' : 'Project'} Release configuration`;
    if (base !== 'release.xcconfig') problems.push(`${where} must be based on release.xcconfig, not ${base ?? 'nothing'}.`);
    if ('CAPACITOR_DEBUG' in settings) problems.push(`${where} sets CAPACITOR_DEBUG.`);
    if (/\bDEBUG=1\b/.test(settings.GCC_PREPROCESSOR_DEFINITIONS ?? '')) problems.push(`${where} defines DEBUG=1.`);
    if (/\bDEBUG\b/.test(settings.SWIFT_ACTIVE_COMPILATION_CONDITIONS ?? '')) problems.push(`${where} compiles Swift with DEBUG.`);
    if (/-D\s*"?DEBUG\b/.test(settings.OTHER_SWIFT_FLAGS ?? '')) problems.push(`${where} passes -DDEBUG to Swift.`);
  }
  for (const [file, text] of Object.entries(xcconfigs)) {
    if (file !== 'debug.xcconfig' && /^\s*CAPACITOR_DEBUG\s*=/m.test(text)) {
      problems.push(`ios/${file} sets CAPACITOR_DEBUG, which Release builds read.`);
    }
  }
  const plist = parsePlist(infoPlist);
  if ('NSAppTransportSecurity' in plist) {
    problems.push('Info.plist has NSAppTransportSecurity. Debug and Release share Info.plist, so the exception would ship; keep emulator exceptions Debug-only (docs/nfct/ios.md).');
  }
  if (plist.CAPACITOR_DEBUG !== '$(CAPACITOR_DEBUG)') {
    problems.push(`Info.plist must set CAPACITOR_DEBUG to $(CAPACITOR_DEBUG) so only Debug enables it, not ${JSON.stringify(plist.CAPACITOR_DEBUG)}.`);
  }
  return problems;
}

function javascriptFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => join(entry.parentPath, entry.name));
}

export function verifyIosRelease(root) {
  const read = (path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : null);
  const publicDir = join(root, 'ios/App/App/public');
  const synced = read('ios/App/App/capacitor.config.json');
  const xcconfigs = Object.fromEntries(['debug.xcconfig', 'release.xcconfig', 'signing.local.xcconfig']
    .map((file) => [file, read(`ios/${file}`)])
    .filter(([, text]) => text !== null));
  return [
    ...checkWebBundle({
      indexHtml: read('ios/App/App/public/index.html'),
      scripts: javascriptFiles(publicDir).map((path) => ({ path: relative(root, path), text: readFileSync(path, 'utf8') })),
    }),
    ...checkCapacitorConfig(synced === null ? null : JSON.parse(synced)),
    ...checkReleaseProject({
      pbxproj: read('ios/App/App.xcodeproj/project.pbxproj') ?? '',
      xcconfigs,
      infoPlist: read('ios/App/App/Info.plist') ?? '<dict></dict>',
    }),
  ];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const problems = verifyIosRelease(process.cwd());
  if (problems.length > 0) {
    console.error('iOS release check failed:\n  ' + problems.join('\n  ')
      + '\nRun npm run sync:ios to sync a production bundle. See docs/nfct/ios.md.');
    process.exit(1);
  }
  console.log('iOS release check passed: production web bundle, synced Capacitor config and Release configuration.');
}
