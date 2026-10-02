import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, normalize, relative } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// scripts/ci/classify-changes.sh decides which of ci.yml's gated jobs a pull
// request runs: `code` (the emulators job) and `backend` (the nfct-dev canary).

const directory = mkdtempSync(join(tmpdir(), 'classify-changes-'));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

let count = 0;
function classify(paths) {
  const file = join(directory, `changed-${count++}.txt`);
  if (paths !== null) writeFileSync(file, paths.map((path) => `${path}\n`).join(''));
  const result = spawnSync('bash', ['scripts/ci/classify-changes.sh', file], { encoding: 'utf8' });
  expect(result.status).toBe(0);
  return Object.fromEntries(result.stdout.trim().split('\n').map((line) => line.split('=')));
}

const RUNS_BOTH = { code: 'true', backend: 'true' };
const CODE_ONLY = { code: 'true', backend: 'false' };
const NEITHER = { code: 'false', backend: 'false' };

describe('classify-changes', () => {
  it.each([
    // Documentation and agent instructions skip both.
    ['README.md', NEITHER], ['AGENTS.md', NEITHER], ['docs/nfct/ios.md', NEITHER],
    ['.agents/skills/nfct-pr-review/SKILL.md', NEITHER], ['.claude/settings.json', NEITHER], ['ios/App/README.md', NEITHER],
    // Runtime code and backend configuration run both.
    ['src/pages/onboarding/RoleSelection.tsx', RUNS_BOTH], ['src/contexts/AuthContext.tsx', RUNS_BOTH],
    ['src/services/firebase.ts', RUNS_BOTH], ['src/consumer/repositories/gameSessionRepository.ts', RUNS_BOTH],
    ['src/index.css', RUNS_BOTH], ['shared/games/mental-math/v1/params.ts', RUNS_BOTH], ['index.html', RUNS_BOTH],
    ['package.json', RUNS_BOTH], ['package-lock.json', RUNS_BOTH], ['vite.config.ts', RUNS_BOTH],
    ['firestore.rules', RUNS_BOTH], ['firestore.indexes.json', RUNS_BOTH], ['firebase.json', RUNS_BOTH], ['.firebaserc', RUNS_BOTH],
    ['capacitor.config.ts', RUNS_BOTH], ['public/manifest.json', RUNS_BOTH], ['.nvmrc', RUNS_BOTH],
    ['.github/workflows/ci.yml', RUNS_BOTH], ['scripts/ci/classify-changes.sh', RUNS_BOTH],
    // The canary itself, its config and what it imports run it, although e2e/ is test-only.
    ['e2e/canary/nfct-dev.canary.spec.ts', RUNS_BOTH], ['e2e/canary/device.ts', RUNS_BOTH], ['e2e/fixtures.ts', RUNS_BOTH],
    ['e2e/helpers/auth.ts', RUNS_BOTH], ['e2e/helpers/journeys.ts', RUNS_BOTH],
    ['playwright.canary.config.ts', RUNS_BOTH], ['scripts/canary/canary.mjs', RUNS_BOTH],
    // Tests, native-only, BrainFlow, undeployed Functions and media skip the canary only.
    ['e2e/mental-math.lifecycle.local.spec.ts', CODE_ONLY], ['e2e/helpers/localEmulator.ts', CODE_ONLY],
    ['tests/firestore-rules/users.test.ts', CODE_ONLY], ['src/pages/onboarding/__tests__/RoleSelection.test.tsx', CODE_ONLY],
    ['scripts/__tests__/canary.test.mjs', CODE_ONLY], ['src/services/firebaseConfig.test.ts', CODE_ONLY],
    ['playwright.protocol.config.ts', CODE_ONLY], ['vitest.rules.config.ts', CODE_ONLY], ['tsconfig.e2e.json', CODE_ONLY],
    ['ios/App/App.xcodeproj/project.pbxproj', CODE_ONLY], ['ios/App/ci_scripts/ci_post_clone.sh', CODE_ONLY], ['ci_scripts/ci_post_clone.sh', CODE_ONLY],
    ['scripts/ios/simulator-probe.js', CODE_ONLY], ['brainflow_service/app.py', CODE_ONLY], ['pyproject.toml', CODE_ONLY], ['uv.lock', CODE_ONLY],
    ['functions/src/index.ts', CODE_ONLY], ['functions/scripts/canaryCleanup.ts', CODE_ONLY],
    ['.github/workflows/ios.yml', CODE_ONLY], ['.github/workflows/main-source-guard.yml', CODE_ONLY],
    ['public/icons/icon-512.png', CODE_ONLY], ['src/assets/logo.svg', CODE_ONLY], ['public/fonts/display.woff2', CODE_ONLY],
    // Anything unlisted runs both: a new top-level file, a quoted path git could not print plainly.
    ['narrative.json', RUNS_BOTH], ['scripts/check-clinical-isolation.mjs', RUNS_BOTH], ['"src/caf\\303\\251.ts"', RUNS_BOTH],
  ])('%s', (path, expected) => {
    expect(classify([path])).toEqual(expected);
  });

  it('runs a job if any one file needs it', () => {
    expect(classify(['docs/nfct/ios.md', 'README.md'])).toEqual(NEITHER);
    expect(classify(['docs/nfct/ios.md', 'e2e/protocol.local.spec.ts'])).toEqual(CODE_ONLY);
    expect(classify(['ios/App/App/Info.plist', 'functions/src/index.ts', 'e2e/persistence.local.spec.ts', 'docs/a.md'])).toEqual(CODE_ONLY);
    expect(classify(['ios/App/App/Info.plist', 'src/App.tsx'])).toEqual(RUNS_BOTH);
    expect(classify(['e2e/protocol.local.spec.ts', 'e2e/helpers/journeys.ts'])).toEqual(RUNS_BOTH);
  });

  it('fails safe: an empty, missing or unreadable listing runs everything', () => {
    expect(classify([])).toEqual(RUNS_BOTH);
    expect(classify(null)).toEqual(RUNS_BOTH);
    const result = spawnSync('bash', ['scripts/ci/classify-changes.sh'], { encoding: 'utf8' });
    expect(result.stdout).toBe('code=true\nbackend=true\n');
  });

  it('skips the same documentation paths as ios.yml', () => {
    const docsPaths = (text) => /docs_paths='([^']+)'/.exec(text)?.[1];
    const script = docsPaths(readFileSync('scripts/ci/classify-changes.sh', 'utf8'));
    expect(script).toBeTruthy();
    expect(docsPaths(readFileSync('.github/workflows/ios.yml', 'utf8'))).toBe(script);
  });
});

/** Every repository file a module imports, followed through relative imports; and the packages. */
function importGraph(entries) {
  const files = new Set();
  const packages = new Set();
  const pending = [...entries];
  while (pending.length > 0) {
    const file = pending.pop();
    if (files.has(file)) continue;
    files.add(file);
    const text = readFileSync(file, 'utf8');
    for (const [, specifier] of text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      // An absolute specifier is an app module the page imports in the browser.
      if (specifier.startsWith('/')) continue;
      if (!specifier.startsWith('.')) {
        packages.add(specifier);
        continue;
      }
      const base = normalize(join(dirname(file), specifier));
      const resolved = [base, `${base}.ts`, `${base}.mjs`, `${base}.js`].find((candidate) => existsSync(candidate) && !candidate.endsWith('/'));
      if (!resolved) throw new Error(`${file}: cannot resolve ${specifier}`);
      pending.push(relative('.', resolved));
    }
  }
  return { files: [...files].sort(), packages: [...packages].sort() };
}

describe('the canary', () => {
  const graph = importGraph(['e2e/canary/nfct-dev.canary.spec.ts', 'playwright.canary.config.ts', 'scripts/canary/canary.mjs']);

  it('runs whenever a file it is built from changes', () => {
    expect(graph.files).toEqual(expect.arrayContaining(['e2e/fixtures.ts', 'e2e/helpers/auth.ts', 'e2e/helpers/journeys.ts', 'e2e/canary/device.ts']));
    for (const file of graph.files) expect(classify([file]).backend, file).toBe('true');
  });

  it('uses only public client APIs: no Admin SDK and no emulator fixtures', () => {
    expect(graph.files.filter((file) => /localEmulator|authorizedFirestore|firestoreProbe/.test(file))).toEqual([]);
    expect(graph.packages.filter((name) => !/^(node:|@playwright\/test$)/.test(name))).toEqual([]);
  });
});

describe('ci.yml', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  const canaryJob = ci.slice(ci.indexOf('\n  canary:\n'));

  it('gates the canary on the backend classification, failing safe', () => {
    expect(ci).toContain('backend: ${{ steps.filter.outputs.backend }}');
    expect(ci).toContain('bash scripts/ci/classify-changes.sh "$RUNNER_TEMP/changed.txt"');
    expect(canaryJob).toContain('name: nfct-dev canary');
    expect(canaryJob).toContain('needs: [changes, web]');
    expect(canaryJob).toContain("(needs.changes.result == 'failure' || needs.changes.outputs.backend == 'true')");
  });

  it('gives the canary no secrets, refuses forks and publishes screenshots only', () => {
    expect(ci).not.toMatch(/\$\{\{[^}]*\bsecrets\b/);
    expect(ci).toMatch(/^permissions:\n {2}contents: read\n/m);
    expect(canaryJob).toContain("github.event.pull_request.head.repo.full_name != github.repository");
    expect(canaryJob).toMatch(/if: always\(\) && steps\.identity\.outcome != 'skipped'\n\s+continue-on-error: true/);
    expect(canaryJob).toContain('path: test-results/canary/**/*.png');
  });
});
