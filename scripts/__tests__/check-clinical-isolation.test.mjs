import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// This file is allowlisted in the check because it must name what it refuses.
const script = fileURLToPath(new URL('../check-clinical-isolation.mjs', import.meta.url));
const repos = [];

/** Runs the real check in a throwaway git repository holding only `files`. */
function runCheck(files) {
  const repo = mkdtempSync(join(tmpdir(), 'nfct-isolation-'));
  repos.push(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  execFileSync('git', ['add', '-A'], { cwd: repo });
  const result = spawnSync(process.execPath, [script], { cwd: repo, encoding: 'utf8' });
  return { status: result.status, output: result.stdout + result.stderr };
}

afterEach(() => {
  for (const repo of repos.splice(0)) rmSync(repo, { recursive: true, force: true });
});

describe('check:isolation', () => {
  it('passes a tree with only NFCT identity', () => {
    expect(runCheck({ 'capacitor.config.ts': "appId: 'io.github.rosscolborne.nfct'" }).status).toBe(0);
  });

  it.each([
    ['the Waveable bundle ID', 'ios/App/App.xcodeproj/project.pbxproj', 'PRODUCT_BUNDLE_IDENTIFIER = com.waveable.app;'],
    ['an earlier Waveable bundle ID', 'capacitor.config.ts', "appId: 'com.brainswell.app'"],
    ['the clinical Firebase project', 'src/config.ts', "projectId: 'brainwell-327dc'"],
  ])('fails on %s', (_name, path, content) => {
    const { status, output } = runCheck({ [path]: content });
    expect(status).toBe(1);
    expect(output).toContain(`${path}: matches`);
  });

  it.each([
    'certs/distribution.p12',
    'certs/Apple Development.cer',
    'ios/App/NFCT_Dev.mobileprovision',
    'ios/NFCT.provisionprofile',
    'AuthKey_ABC123DEFG.p8',
    'ios/signing.local.xcconfig',
  ])('fails when signing material %s is tracked', (path) => {
    const { status, output } = runCheck({ [path]: 'secret' });
    expect(status).toBe(1);
    expect(output).toContain(`${path}: file must not be tracked`);
  });

  it('lets the check itself name the identifiers it refuses', () => {
    expect(runCheck({ 'scripts/check-clinical-isolation.mjs': '// refuses com.waveable.app and com.brainswell.app' }).status).toBe(0);
    expect(runCheck({ 'scripts/other.mjs': '// refuses com.waveable.app' }).status).toBe(1);
  });
});
