# CI: what runs where

No push or pull request update starts a validation suite. Linux validation
runs locally first ([AGENTS.md "Checks"](../../AGENTS.md#checks)). GitHub-hosted
runs are started by hand, in two cases: where a clean machine, macOS or the
real backend adds something a local run cannot, and once on a pull request's
final head before it merges. The only automatic runs are a development →
main promotion's release checks and the weekly minimum-iOS run.

## Workflows

| Workflow (file) | Starts | Runs | Use it for |
| --- | --- | --- | --- |
| **Pre-merge validation** (`ci.yml`) | By hand | Web, Backend and iOS below, skipping what the branch's changes relative to `development` cannot affect; then `Pre-merge result`, which sets the `Pre-merge validation` commit status. Input `full` runs everything | The final head of a pull request into `development`, before it merges |
| **Web (Linux)** (`web.yml`) | By hand; called | `web`: `check:isolation`, lint, build, unit tests, the typechecks, the Functions build | A clean-machine run of the local Linux checks |
| **Backend (Firebase)** (`backend.yml`) | By hand; called | `emulators`: rules, repositories, Functions, the `permission-guard` and protocol Playwright suites, the canary's emulator rehearsal. `nfct-dev canary`: one journey against nfct-dev ([docs](nfct-dev-canary.md)). Inputs `emulators`, `canary` | The real-backend canary, which agents never run themselves; the emulator suites on a clean machine |
| **iOS** (`ios.yml`) | By hand; called; weekly | `Release-bundle safety` and `WebKit iPhone (Playwright)` on Linux; `Xcode build and Simulator smoke` on macOS ([docs](ios.md#the-macos-job-iosyml-native)). Inputs `webkit`, `native`, `simulator`, `scenarios`, `ios_runtimes` | The Xcode build and the Simulator scenarios, which need macOS |
| **Release (development → main)** (`release.yml`) | Promotion pull requests into `main`; by hand | iOS with only `Release-bundle safety` and the macOS Release build (no WebKit, no Simulator) | What TestFlight will build |
| **Main source guard** (`main-source-guard.yml`) | Pull requests into `main` | `Require development source` | Only `development` is promoted to `main` |

Pre-merge validation calls the other workflows; it does not copy their jobs.
Its job routing comes from `scripts/ci/classify-changes.sh`, which has its own
tests (`scripts/__tests__/classify-changes.test.mjs`):

- **Documentation or agent instructions only:** `web` only.
- **Otherwise:** the emulator suites, `Release-bundle safety` and the WebKit
  suite.
- **The canary:** unless every changed file clearly cannot change how the web
  app talks to the backend ([when it runs](nfct-dev-canary.md#when-it-runs)).
- **The macOS job:** only for files the Xcode build or the Simulator scenarios
  depend on ([list](ios.md#the-macos-job-iosyml-native)). It runs every
  scenario when Mental Math, the iOS scripts or `ios.yml` change, and `smoke`
  otherwise.

Every check fails safe: a failed or empty diff runs everything, and so does a
run on `development` itself. Backend waits for `web` to pass; iOS runs beside
it.

## Before a pull request into development merges

1. Run the local checks, and the journeys the change can affect
   ([AGENTS.md](../../AGENTS.md#completion-and-merge-readiness)).
2. Push the final head. If `development` has moved on, merge it into the branch
   first. The run tests the head alone, not the merge GitHub will make, so
   `Pre-merge result` fails a head that does not contain `development`'s
   latest commit at the time of the run.
3. Start **Pre-merge validation** on the branch. In the web UI: Actions >
   Pre-merge validation > Run workflow, then choose the branch. From a
   terminal: `gh workflow run ci.yml --ref <branch>`.
4. The pull request shows the `Pre-merge validation` status on that commit. It
   is pending while the run works, then success or failure, and links to the
   run. A later push leaves the new head without the status, so run it again
   on the new head.
5. Merge only with a green `Pre-merge validation` status on the exact head.
   `gh pr checks <n>` lists it.

The checks of a manually started run do not appear on the pull request:
GitHub leaves `workflow_dispatch` runs out of a commit's status rollup. On
`8f8330f`, a dispatched iOS run passed, but the pull request's checks show only
its `pull_request` runs. That is why Pre-merge validation sets a commit status
of its own.

### Enforcing it (owner)

As of 2026-10-02, neither the `development` nor the `main` ruleset requires
any status check, and this change does not alter them.

To enforce the step above, add one required status check to the `development`
ruleset: `Pre-merge validation`, from the GitHub Actions integration.

- Do not also require the per-job checks: a manual run's job checks are not on
  the pull request, so they would block every merge.
- The gate already fails a head that lacked `development`'s latest commit
  when it ran. "Require branches to be up to date before merging" would also
  cover `development` moving after the run, at the cost of a fresh run each
  time it moves.

Until the check is required, the rule above is a process rule
([AGENTS.md](../../AGENTS.md#completion-and-merge-readiness)), and a pull
request into `development` shows no checks at all: an unvalidated merge looks
like a validated one. Add the required check when this model lands.

### What a pull request can change

A run uses the branch's own copies of the workflows and the classifier, so a
pull request can change what its own validation runs, as `pull_request` runs
could before. Review changes under `.github/workflows/` and `scripts/ci/` as
security-sensitive.

Only people with write access can start a workflow. A fork's commits are
validated by pushing them to a branch here: the status then lands on those
exact commits, so it is visible on the fork's pull request too.

## Promotion: development → main

Release runs on the merge result whenever a promotion pull request is opened,
reopened, marked ready or updated; drafts skip it. It runs:

- `Release-bundle safety`;
- on macOS, the Xcode Cloud post-clone hook, the unsigned Release build, the
  built-app check, and the check that a Release build refuses the emulator
  bundle.

It does not rerun the development validation (Web, Backend, the WebKit suite,
the Simulator scenarios): each pull request into `development` already passed
Pre-merge validation. `Require development source` checks where the promotion
comes from. GitHub names a called workflow's checks `<caller job> / <job>`,
so the `main` ruleset can require:

- `Release / Release-bundle safety`;
- `Release / Xcode build and Simulator smoke`;
- `Require development source`.

`main-source-guard.yml` runs as it is on `main` (`pull_request_target`), and
`main` does not have it yet. It starts guarding with the first promotion after
it lands there.

## When the Run workflow buttons appear

GitHub starts a manual run, from the web UI or `gh workflow run`, only for a
workflow file that is on the default branch, `main`. The run itself uses the
chosen branch's copy.

- **Now:** `ci.yml` and `ios.yml` are on `main` already, so
  `gh workflow run ci.yml --ref <branch>` and `gh workflow run ios.yml --ref
  <branch> -f …` work today on any branch that has these files. Until the next
  promotion, the Actions page shows them as `CI` and `iOS`.
- **After the next promotion to `main`:** `web.yml`, `backend.yml` and
  `release.yml` get their own buttons. Until then, `gh workflow run` on them
  fails (HTTP 404); run them through Pre-merge validation instead, which calls
  them, and which runs the canary for any runtime or rules change. The
  Release workflow still runs on the first promotion pull request.

## Running one suite by hand

```bash
branch=$(git branch --show-current)
gh workflow run ci.yml --ref "$branch"                       # Pre-merge validation; -f full=true runs everything
gh workflow run ios.yml --ref "$branch" -f webkit=false -f scenarios=mental-math   # macOS only, one scenario
gh workflow run backend.yml --ref "$branch" -f emulators=false                       # the nfct-dev canary alone*
gh workflow run web.yml --ref "$branch"                                              # *
```

\* Only once `backend.yml` and `web.yml` are on `main`
([above](#when-the-run-workflow-buttons-appear)); until then, use
`gh workflow run ci.yml --ref "$branch"`.

macOS minutes cost ten times Linux minutes, so run only the scenarios you
need. The [iOS docs](ios.md#running-scenarios-from-an-agent-or-a-terminal)
show how to fetch a run's Simulator evidence.
