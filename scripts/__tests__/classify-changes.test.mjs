import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, normalize, relative } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// scripts/ci/classify-changes.sh decides which gated jobs Pre-merge validation
// (ci.yml) runs for a branch: `code` (the emulator suites and the Linux iOS
// jobs), `backend` (the nfct-dev canary), `native` (the macOS job) and
// `scenarios` (its Simulator scenarios; empty runs them all).

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
    const { code, backend } = classify([path]);
    expect({ code, backend }).toEqual(expected);
  });

  it('runs a job if any one file needs it', () => {
    const jobs = (paths) => { const { code, backend } = classify(paths); return { code, backend }; };
    expect(jobs(['docs/nfct/ios.md', 'README.md'])).toEqual(NEITHER);
    expect(jobs(['docs/nfct/ios.md', 'e2e/protocol.local.spec.ts'])).toEqual(CODE_ONLY);
    expect(jobs(['ios/App/App/Info.plist', 'functions/src/index.ts', 'e2e/persistence.local.spec.ts', 'docs/a.md'])).toEqual(CODE_ONLY);
    expect(jobs(['ios/App/App/Info.plist', 'src/App.tsx'])).toEqual(RUNS_BOTH);
    expect(jobs(['e2e/protocol.local.spec.ts', 'e2e/helpers/journeys.ts'])).toEqual(RUNS_BOTH);
  });

  const SMOKE = { native: 'true', scenarios: 'smoke' };
  const ALL_SCENARIOS = { native: 'true', scenarios: '' };
  const NO_MAC = { native: 'false', scenarios: 'smoke' };
  it.each([
    // The native build's own inputs start the macOS job.
    ['ios/App/App/Info.plist', SMOKE], ['ios/App/App.xcodeproj/project.pbxproj', SMOKE], ['ios/App/ci_scripts/ci_post_clone.sh', SMOKE],
    ['ci_scripts/ci_post_clone.sh', SMOKE], ['capacitor.config.ts', SMOKE], ['package.json', SMOKE], ['package-lock.json', SMOKE],
    ['.nvmrc', SMOKE], ['vite.config.ts', SMOKE], ['scripts/verify-ios-release.mjs', SMOKE],
    // So does app code that calls native APIs through Capacitor.
    ['src/consumer/games/mentalMath/MentalMathGame.tsx', SMOKE], ['src/services/eegEngine.ts', SMOKE], ['src/services/pdfReportGenerator.ts', SMOKE],
    // The scenario driver and the iOS workflow run every scenario.
    ['scripts/ios/simulator-smoke.mjs', ALL_SCENARIOS], ['scripts/ios/simulator-scenarios.mjs', ALL_SCENARIOS], ['.github/workflows/ios.yml', ALL_SCENARIOS],
    // Ordinary feature work does not, even on screens the scenarios drive.
    ['src/App.tsx', NO_MAC], ['src/main.tsx', NO_MAC], ['src/contexts/AuthContext.tsx', NO_MAC], ['src/services/firebase.ts', NO_MAC],
    ['src/services/firebaseConfig.ts', NO_MAC], ['src/pages/onboarding/RoleSelection.tsx', NO_MAC],
    ['src/consumer/games/mentalMath/MentalMathScreen.tsx', NO_MAC], ['src/consumer/catalogue/GameCatalogue.tsx', NO_MAC], ['src/index.css', NO_MAC],
    ['shared/games/mental-math/v1/params.ts', NO_MAC], ['firestore.rules', NO_MAC], ['e2e/mental-math.lifecycle.local.spec.ts', NO_MAC],
    // Nor do tests, documentation (even under ios/) or the other workflows.
    ['src/consumer/games/mentalMath/__tests__/MentalMathScreen.test.tsx', NO_MAC], ['src/services/__tests__/eegEngine.test.ts', NO_MAC],
    ['ios/App/README.md', NO_MAC], ['docs/nfct/ios.md', NO_MAC], ['.github/workflows/ci.yml', NO_MAC],
    ['.github/workflows/web.yml', NO_MAC], ['.github/workflows/backend.yml', NO_MAC], ['.github/workflows/release.yml', NO_MAC],
    // A file that no longer exists is judged by its path alone.
    ['src/services/removedNativeBridge.ts', NO_MAC],
  ])('macOS job for %s', (path, expected) => {
    const { native, scenarios } = classify([path]);
    expect({ native, scenarios }).toEqual(expected);
  });

  it('runs the macOS job if any one file needs it, and every scenario only for the driver or the workflow', () => {
    const mac = (paths) => { const { native, scenarios } = classify(paths); return { native, scenarios }; };
    expect(mac(['src/App.tsx', 'ios/App/README.md', 'src/contexts/AuthContext.tsx'])).toEqual(NO_MAC);
    expect(mac(['src/App.tsx', 'src/services/eegEngine.ts'])).toEqual(SMOKE);
    expect(mac(['src/App.tsx', 'capacitor.config.ts', 'scripts/ios/simulator-runtime.mjs'])).toEqual(ALL_SCENARIOS);
  });

  it('counts every app file that uses Capacitor as native', () => {
    const tracked = spawnSync('git', ['ls-files', 'src'], { encoding: 'utf8' }).stdout.trim().split('\n')
      .filter((path) => /\.(ts|tsx)$/.test(path) && !/(^|\/)__tests__\/|\.test\.tsx?$/.test(path));
    const native = tracked.filter((path) => /@capacitor\/|@capacitor-community\/|\bCapacitor\./.test(readFileSync(path, 'utf8')));
    expect(native).toEqual(expect.arrayContaining(['src/services/eegEngine.ts', 'src/services/pdfReportGenerator.ts']));
    for (const path of native) expect(classify([path]).native, path).toBe('true');
  });

  it('fails safe: an empty, missing or unreadable listing runs everything', () => {
    const everything = 'code=true\nbackend=true\nnative=true\nscenarios=\n';
    expect(classify([])).toEqual({ ...RUNS_BOTH, ...ALL_SCENARIOS });
    expect(classify(null)).toEqual({ ...RUNS_BOTH, ...ALL_SCENARIOS });
    const result = spawnSync('bash', ['scripts/ci/classify-changes.sh'], { encoding: 'utf8' });
    expect(result.stdout).toBe(everything);
    // grep fails (status 2) on a directory: that runs everything too.
    const unreadable = spawnSync('bash', ['scripts/ci/classify-changes.sh', directory], { encoding: 'utf8' });
    expect(unreadable.stdout).toBe(everything);
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

const workflow = (name) => readFileSync(`.github/workflows/${name}`, 'utf8');
/** The workflow's top-level `on:` block. */
const triggers = (text) => /^on:\n((?: {2}.*\n|\s*\n)+)/m.exec(text)?.[1] ?? '';

describe('workflow triggers', () => {
  it('runs no validation suite on a push or pull request update', () => {
    for (const name of ['ci.yml', 'web.yml', 'backend.yml', 'ios.yml']) {
      expect(triggers(workflow(name)), name).toBeTruthy();
      expect(triggers(workflow(name)), name).not.toMatch(/^ {2}(push|pull_request|pull_request_target):/m);
    }
    expect(triggers(workflow('ci.yml'))).toMatch(/^ {2}workflow_dispatch:/m);
    for (const name of ['web.yml', 'backend.yml', 'ios.yml']) {
      expect(triggers(workflow(name)), name).toMatch(/^ {2}workflow_dispatch:/m);
      expect(triggers(workflow(name)), name).toMatch(/^ {2}workflow_call:/m);
    }
  });

  it('runs only the release checks on development → main promotions', () => {
    const release = workflow('release.yml');
    expect(triggers(release)).toMatch(/^ {2}pull_request:\n {4}branches: \[main\]\n/m);
    expect(release).toContain('uses: ./.github/workflows/ios.yml');
    expect(release).toMatch(/webkit: false\n\s+native: true\n\s+simulator: false/);
    expect(release).not.toMatch(/web\.yml|backend\.yml/);
  });
});

describe('Pre-merge validation (ci.yml)', () => {
  const ci = workflow('ci.yml');

  it('calls each suite once and gates the canary on the backend classification, failing safe', () => {
    expect(ci).toContain('bash scripts/ci/classify-changes.sh "$RUNNER_TEMP/changed.txt"');
    for (const name of ['web.yml', 'backend.yml', 'ios.yml']) expect(ci.split(`uses: ./.github/workflows/${name}`)).toHaveLength(2);
    expect(ci).toContain("canary: ${{ needs.changes.result != 'success' || needs.changes.outputs.backend == 'true' }}");
    expect(ci).toContain("native: ${{ needs.changes.result != 'success' || needs.changes.outputs.native == 'true' }}");
  });

  it('reports one commit status on the validated head, and lets a job skip only for documentation-only changes', () => {
    const result = ci.slice(ci.indexOf('\n  result:\n'));
    expect(result).toContain('needs: [changes, web, backend, ios]');
    expect(result).toMatch(/if: always\(\)\n/);
    expect(result).toContain('[ "$result" = skipped ] && [ "$CHANGES" = success ] && [ "$CODE" = false ]');
    expect(result).toContain("context='Pre-merge validation'");
    // The head alone is tested: one without development's latest commit fails.
    expect(result).toContain('if [ "$BEHIND" != false ]; then failed="$failed behind-development"; fi');
    expect(result).toContain('statuses/$GITHUB_SHA');
  });
});

describe('Backend (backend.yml)', () => {
  const backend = workflow('backend.yml');
  const canaryJob = backend.slice(backend.indexOf('\n  canary:\n'));

  it('gives the canary no secrets, refuses forks and publishes screenshots only', () => {
    expect(canaryJob).toContain('name: nfct-dev canary');
    expect(canaryJob).toContain('if: inputs.canary');
    expect(backend).not.toMatch(/\$\{\{[^}]*\bsecrets\b/);
    expect(backend).toMatch(/^permissions:\n {2}contents: read\n/m);
    expect(canaryJob).toContain("github.event.pull_request.head.repo.full_name != github.repository");
    expect(canaryJob).toMatch(/if: always\(\) && steps\.identity\.outcome != 'skipped'\n\s+continue-on-error: true/);
    expect(canaryJob).toContain('path: test-results/canary/**/*.png');
  });
});
