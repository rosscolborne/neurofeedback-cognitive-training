#!/usr/bin/env node
// The minimum-iOS check's Simulator (NFCT-39). Installs an older iOS
// Simulator runtime and creates an iPhone on it. It tries each requested
// version in order, oldest first, and uses the first that installs and
// boots, so a run on a newer runtime than requested says so instead of
// failing silently. Needs macOS with Xcode 16.1 or later.
//
//   node scripts/ios/simulator-runtime.mjs <report.json> 16.4 17.5 18.6
//
// Prints the booted device's UDID; the report records every attempt.
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** An installed, available iOS runtime of `version` (16.4 matches 16.4 and 16.4.1). */
export function findRuntime(runtimes, version) {
  return runtimes.find((runtime) => runtime.isAvailable !== false
    && /SimRuntime\.iOS-/.test(runtime.identifier)
    && (runtime.version === version || runtime.version.startsWith(`${version}.`))) ?? null;
}

/** The smallest supported iPhone first: the iPhone SE is also the smallest screen the app supports. */
export function pickDeviceType(runtime) {
  const iphones = (runtime.supportedDeviceTypes ?? []).filter((type) => type.productFamily === 'iPhone' || type.name.startsWith('iPhone'));
  const preferred = ['iPhone SE (3rd generation)', 'iPhone 14', 'iPhone 15', 'iPhone 16'];
  return preferred.map((name) => iphones.find((type) => type.name === name)).find(Boolean) ?? iphones[0] ?? null;
}

const xcrun = (...args) => execFileSync('xcrun', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const listRuntimes = () => JSON.parse(xcrun('simctl', 'list', 'runtimes', '--json')).runtimes;

/** Runs a long command with its output on stderr (stdout carries only the UDID). */
function run(command, args, timeoutMinutes) {
  const result = spawnSync(command, args, { stdio: ['ignore', process.stderr, process.stderr], timeout: timeoutMinutes * 60_000 });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.error?.message ?? `exit ${result.status}`})`);
}

function attempt(version) {
  let runtime = findRuntime(listRuntimes(), version);
  if (!runtime) {
    console.error(`Downloading the iOS ${version} Simulator runtime…`);
    try {
      run('xcodebuild', ['-downloadPlatform', 'iOS', '-buildVersion', version], 45);
    } catch (error) {
      // Some images need an administrator to install runtimes.
      console.error(`${error.message}; retrying with sudo.`);
      run('sudo', ['-n', 'xcodebuild', '-downloadPlatform', 'iOS', '-buildVersion', version], 45);
    }
    runtime = findRuntime(listRuntimes(), version);
    if (!runtime) throw new Error(`iOS ${version} is not listed as an available runtime after the download.`);
  }
  const type = pickDeviceType(runtime);
  if (!type) throw new Error(`iOS ${runtime.version} supports no iPhone this Xcode knows.`);
  const udid = xcrun('simctl', 'create', `NFCT minimum iOS ${runtime.version}`, type.identifier, runtime.identifier).trim();
  try {
    try { xcrun('simctl', 'boot', udid); } catch { /* already booted */ }
    run('xcrun', ['simctl', 'bootstatus', udid, '-b'], 10);
  } catch (error) {
    try { xcrun('simctl', 'delete', udid); } catch { /* best effort */ }
    throw error;
  }
  return { udid, device: type.name, runtime: runtime.identifier, runtimeVersion: runtime.version, build: runtime.buildversion };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [reportPath, ...versions] = process.argv.slice(2);
  if (!reportPath || versions.length === 0 || !versions.every((version) => /^\d+\.\d+$/.test(version))) {
    console.error('Usage: simulator-runtime.mjs <report.json> <major.minor> [<major.minor> ...]');
    process.exit(2);
  }
  const report = { requested: versions, used: null, attempts: [] };
  for (const version of versions) {
    const started = Date.now();
    try {
      report.used = { requested: version, ...attempt(version) };
      report.attempts.push({ version, ok: true, seconds: Math.round((Date.now() - started) / 1_000) });
      break;
    } catch (error) {
      report.attempts.push({ version, ok: false, seconds: Math.round((Date.now() - started) / 1_000), error: String(error.message).slice(0, 500) });
      console.error(`iOS ${version} is not usable here: ${error.message}`);
    }
  }
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  const lines = [
    '## Minimum iOS runtime',
    '',
    report.used
      ? `Used **iOS ${report.used.runtimeVersion}** (${report.used.build ?? 'unknown build'}) on ${report.used.device}${report.used.requested === versions[0] ? '' : `, **not the requested iOS ${versions[0]}**`}.`
      : `**No requested runtime (${versions.join(', ')}) could be installed and booted.**`,
    '',
    '| Runtime | Result | Time | Detail |',
    '| --- | --- | --- | --- |',
    ...report.attempts.map(({ version, ok, seconds, error }) => `| iOS ${version} | ${ok ? 'used' : '**not usable**'} | ${seconds} s | ${(error ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ')} |`),
    '',
  ];
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'), { flag: 'a' });
  console.error(lines.join('\n'));
  if (!report.used) process.exit(1);
  if (report.used.requested !== versions[0]) console.error(`::warning::The minimum-iOS check ran on iOS ${report.used.runtimeVersion}, not the requested iOS ${versions[0]}.`);
  console.log(report.used.udid);
}
