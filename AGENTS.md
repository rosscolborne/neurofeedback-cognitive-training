# Agent instructions: neurofeedback-cognitive-training (NFCT)

This is the **consumer cognitive-training product** (puzzle and cognitive
games with optional Muse EEG). It is **not** Waveable, the clinical product
it was forked from. See [docs/nfct/FORK.md](docs/nfct/FORK.md).

## Hard rules

- **Never use the Waveable clinical Firebase project** or any of its config,
  credentials, service accounts or deployed rules, and never add a default
  Firebase project. `src/services/firebaseConfig.ts` must keep failing closed.
  `npm run check:isolation` must stay green.
- **All Firebase-backed tests run against local emulators**, with one
  exception: CI's [nfct-dev canary](docs/nfct/nfct-dev-canary.md), a single
  consumer journey against `nfct-dev` as an ordinary user, with no secrets and
  no Admin SDK. Do not add other deployed-project tests, service-account keys
  or `.env` files to the repo, and do not give a pull request job privileged
  Firebase credentials.
- **`brainflow_service/` is not owned here.** It is an inherited copy of the
  shared `brainflow-service` repository. Do not modify, refactor or extend it;
  backend changes go to `brainflow-service`.
- **The clinical data model is transitional.** Do not add fields to
  `clients/{uid}` / `ClientProfile` or `sessions/{id}` / `SessionRecord`, and do
  not extend `Protocol`, `Experience`, `allowedExperiences` or the self-directed
  plan to represent games. The consumer model (user profile, game session,
  separate EEG recording) is built new in `shared/` (`@nfct/shared`); see
  [ADR-001](docs/nfct/adr-001-consumer-domain-model.md). `shared/` imports
  only `zod` and its own modules.
- **EEG is optional.** It must never be required to play and must never drive
  game scores, progression, unlocks or achievements.
- Do not deploy anything (Firebase, Vercel, Render, App Store) or link this
  repository to Waveable's hosting, Render service or Xcode Cloud workflows.

## Prioritization

Favor:

1. user-facing product progress;
2. QA, CI, testing and automation that materially increase safe development
   velocity;
3. bugs that cause likely user-visible failure, realistic security, privacy or
   data-loss risk, or block near-term work.

Do not spend significant effort on speculative hardening, architectural
cleanup, or low-probability edge cases unless they cause meaningful user harm,
data loss, security/privacy exposure, block upcoming work, or materially
improve safe development velocity.
When a non-feature finding has no concrete near-term impact, create or update
a Jira follow-up ([out-of-scope work](#out-of-scope-work)) and continue with
higher-value work.

## Working on a card

- Give each independent writable task or PR its own branch and git worktree,
  based on current `origin/development` unless it deliberately stacks on
  another PR. Pull requests target `development`; only `development` is
  promoted to `main`.
  Never modify another task's worktree or uncommitted work.
- An open PR keeps its worktree. It becomes eligible for cleanup only once the
  PR is merged or abandoned **and** the worktree is clean and fully pushed.
  Detached review, QA and integration-check worktrees have no PR lifecycle:
  remove them, once clean, as soon as their pass ends. An integration branch
  is a task branch.
  [nfct-worktrees](.agents/skills/nfct-worktrees/SKILL.md) covers creating,
  naming, diagnosing and removing worktrees.
- Stay within the Jira card's scope. Handle unrelated work as
  [out-of-scope work](#out-of-scope-work) instead of silently expanding the
  PR.
- Respect the canonical Stage 1 design, ADRs and the card's Jira contract. If
  the implementation conflicts with them, stop at that boundary and report the
  conflict; do not silently invent a new architecture.
- Do not add mock or fake data or silent fallbacks to production code paths
  unless the card requires them. Test fixtures, seeded emulator data and
  deliberate test doubles are fine, and Demo Mode's synthetic EEG is an
  existing, deliberate feature. Never weaken production behavior just to make a
  test pass.
- Before opening a PR, run the relevant [checks](#checks), follow
  [Stage 1 test coverage](#stage-1-test-coverage), and leave only intended
  files in the diff ([hand-off hygiene](.agents/skills/nfct-worktrees/SKILL.md#hand-off-hygiene)).
  Before pushing a fix, rerun the checks that cover what it changed
  ([revalidation](#revalidation)).
- When one objective is split into parallel streams, finishing the streams
  does not finish the objective. Its agent work is complete only when
  [nfct-integration](.agents/skills/nfct-integration/SKILL.md) has combined
  and validated them in one pushed integration PR, unless the user explicitly
  asked for independent PRs. It is merge-ready once Pre-merge validation is green too
  (see [completion and merge readiness](#completion-and-merge-readiness)).
- Do not merge your own PR. Merging is the owner's decision; an agent merges
  only when explicitly delegated, and never a PR it implemented or
  integrated.
- Finish with a report giving, where applicable: branch and worktree, commit
  SHA, PR URL, remote validation state, files and scope changed, checks and tests run
  with results, review and QA results, and unresolved risks, blockers or follow-ups.

## Completion and merge readiness

Finishing an agent task and a PR being ready to merge are separate states:

- **Agent task complete**: every [ready checkpoint](#ready-checkpoint) item
  that applies to the PR holds, the PR is marked ready for review, and the
  report says what has and has not run. The review and QA gates routed for
  the PR are part of the task, not later work. Under a separate orchestrator,
  your task is your brief: routing, reviews, QA by other agents,
  native-sensitive validation, follow-up cards and marking the PR ready are
  its items unless it delegates them to you.
- **Merge-ready**: the task is complete and every merge gate is satisfied on
  the PR's current head, including a green `Pre-merge validation` status.

Stopping earlier because the user said to, or at a [checkpoint](#checkpoints),
is not completion: keep the PR draft and report the items still open.

### Ready checkpoint

Before marking a PR ready for review or reporting its task complete, confirm
each item that applies:

1. **Local checks** pass on the final head ([checks](#checks),
   [revalidation](#revalidation)), and the diff holds only intended files.
2. **Exploratory QA** has passed for a user-facing, auth, onboarding,
   navigation, persistence or training-flow change
   ([user-facing and stateful changes](#user-facing-and-stateful-changes)).
3. **Review routing** is recorded in the PR body: the security tier and its
   reason, or why review was skipped
   ([which PRs get review](#which-prs-get-review)).
4. **Independent review**, and a separate **security review** when the tier
   is STANDARD or DEEP, have finished within the [review budget](#review-budget):
   fixes verified, no BLOCKER open.
5. **Native-sensitive validation** (remote validation, step 3 below) has
   passed, or is named as an owner action.
6. **Owner actions** are listed: what only the owner can do, such as a deploy
   to `nfct-dev`, human visual or hardware checks, or a validation you could
   not run.
7. **Follow-up cards** are filed for FOLLOW-UP and still-open SHOULD-FIX
   findings ([out-of-scope work](#out-of-scope-work)).
8. **PR state** matches: draft while any item above is open, ready for review
   once all hold.

### Lifecycle and remote validation

No push or pull request update starts CI ([docs/nfct/ci.md](docs/nfct/ci.md)).
Remote validation is started by hand: the full suite once on a PR's final
head before it merges, and single workflows where they add something a local
run cannot (macOS, the Simulator, the real-backend canary).

1. Run every required local check, then push and open the PR as a draft
   (`gh pr create --draft`), or update it.
2. Run the PR's routed exploratory QA and reviews, fix and revalidate within
   the [review budget](#review-budget), and push the fixes as one batch.
3. Do not start remote validation yourself unless the user asks for it, or
   the task needs what only a remote run gives. A native-sensitive change
   does: one that changes what the native app builds or calls, such as
   `ios/` (including `Package.swift`), Capacitor plugin dependencies, native
   API integrations or native build configuration
   ([full list](docs/nfct/ios.md#the-macos-job-iosyml-native)). Run `ios.yml`
   on its pushed head
   ([how](docs/nfct/ios.md#running-scenarios-from-an-agent-or-a-terminal))
   and wait for it, or, if you cannot, name it as an owner action. Otherwise
   run only the workflow that gives what you need, on a pushed head that has
   passed the local checks. Other remote validation, Pre-merge validation
   included, stays manual and risk-based.
4. Pass the [ready checkpoint](#ready-checkpoint), then mark the PR ready for
   review (`gh pr ready <n>`).
5. Report the PR URL, the review and QA results, and the remote validation
   state of the head, and finish. Usually that is "Pre-merge validation not
   run", with the command to run it: `gh workflow run ci.yml --ref <branch>`.
   Report any other run you started as *pending*; do not poll or `--watch` it.

Keep the PR draft while implementation, review, QA and local testing
continue. Before substantial rework of a ready PR, such as merging its
base with conflicts or a review fix pass, convert it back to draft
(`gh pr ready --undo <n>`), cancel any validation run of the head being
replaced (`gh run cancel <id>`), and mark it ready again once the reworked
batch passes locally. Test locally, batch related changes, and push when a
coherent batch is ready, not after each small edit: each new head needs its
own Pre-merge validation. After a remote failure, diagnose and fix it locally
and batch the next push where practical.

The report says plainly what has and has not run, for example:

- Agent work: complete
- Review and QA: independent review passed; security review (STANDARD)
  passed; exploratory QA passed
- Remote validation: Pre-merge validation not run on `<sha>`
  (`gh workflow run ci.yml --ref <branch>`)
- Merge readiness: NOT YET — needs a green Pre-merge validation on this head

Pre-merge validation is a merge gate. Whoever merges, and any later
integration or merge check, first confirms a green `Pre-merge validation`
status on the exact head being merged (`gh pr checks <n>`). A PR whose
validation failed is not merge-ready; the branch owner fixes the failure
before it merges. A development → main promotion instead needs its Release
checks and `Require development source`
([promotion](docs/nfct/ci.md#promotion-development--main)).

Wait for CI only when the user explicitly asks you to wait, when your PR
needs native-sensitive validation (step 3 above), or when the task is to
diagnose a CI failure or to change CI itself and only a run can verify it.
Asking for a PR to be merge-ready or safe to merge, or for its CI status, is
not a request to wait: report what has run and finish. While you do wait,
stop as soon as a required job fails and act on that job's log; do not wait
for the other jobs first.

## Bounded review

Work is complete when its objective is met and no BLOCKER remains, not when
nothing more could be improved. Reviews converge within a fixed budget unless
the user explicitly asks for a [deep audit](#deep-audit-mode).

The orchestrator owns agent topology and review routing: which agents run,
which review gates apply, and at which security tier
([nfct-orchestration](.agents/skills/nfct-orchestration/SKILL.md#review-routing)).
If a separate orchestrator started you, it routes and starts the reviews; do
not start duplicates. Otherwise the agent handling the user's task is the
orchestrator, even when it also implemented the change: before reporting the
task complete, it routes the PR and starts the routed reviewers as separate
agents, never reviewing its own work. If its tooling cannot start agents, it
asks the user to start them and keeps the PR draft.

### Finding severity

Reviewers, security reviewers and exploratory QA label every finding:

| Severity | Use for | Effect |
| --- | --- | --- |
| **BLOCKER** | Wrong behavior, a regression or a broken acceptance criterion in this change, or a realistic security, privacy or data-integrity problem | Blocks completion until it is fixed and verified |
| **SHOULD-FIX** | A real defect or gap in this change, small enough to fix here | Fixed within the [review budget](#review-budget). If still open after that, carded and reported as open; it then blocks neither completion nor merge readiness, and the owner decides at merge |
| **FOLLOW-UP** | Hardening, polish, technical debt, and problems that predate the change and that it does not make worse | Carded as [out-of-scope work](#out-of-scope-work); never blocks |

Severity reflects the impact on this change, not effort or interest. Budget
limits never downgrade a BLOCKER. A gate passes once no BLOCKER is open.

### Which PRs get review

Route by the boundaries a diff affects, not by whether it adds, changes or
removes code. Removing authorization logic, auth or account behavior,
Firestore rules, a Function or a native dependency is routed like adding one;
"only cleanup" is not a reason to skip review or lower the tier.

- A PR that changes product code, Firestore rules or indexes, Functions or
  other backend behavior, auth or account behavior, native or iOS code or
  configuration, or CI and infrastructure gets one independent review and a
  security review at its
  [routed tier](.agents/skills/nfct-orchestration/SKILL.md#security-tier).
- A docs-only or genuinely test-only PR may skip review. A test change that
  weakens a guard (such as the e2e permission guard or the isolation check)
  or changes what CI runs is not test-only.
- Record the decision in the PR body either way.

### Review budget

By default, each PR routed for review has:

1. One independent review
   ([nfct-pr-review](.agents/skills/nfct-pr-review/SKILL.md)) and one
   security review at its routed tier
   ([nfct-security-review](.agents/skills/nfct-security-review/SKILL.md#review-tiers)).
   A LIGHT security review is part of the independent review.
2. At most one fix pass per review, by the branch owner, for its BLOCKER and
   SHOULD-FIX findings.
3. One verification pass per review, by the role that raised the findings. It
   checks those fixes and the code they touched; it is not a fresh audit.

After verification:

- An open BLOCKER, including one a fix introduced, still blocks. It gets one
  more targeted fix, which the role that raised it checks narrowly; if it is
  still open, [checkpoint](#checkpoints).
- An open SHOULD-FIX gets at most one targeted repair, proven by its targeted
  check. If that does not close it, card it and report it as open.
- FOLLOW-UPs are carded.
- A new minor finding never restarts the review.

When a fix for any gate touches a security boundary, the security reviewer
checks that fix diff narrowly: in its verification pass, or as a targeted
check for a later repair. For a LIGHT tier, the independent reviewer does.
This is not a new round. With that, a gate stays passed when later commits
only fix verified findings. Substantive new work after review, such as a
feature change, a newly merged stream or a rebuilt branch, gets a review
scoped to that work, not a full re-review.
Exploratory QA works the same way: one fix pass, then one re-run of the
affected scenarios.

### Agent topology

Only the orchestrator starts agents, or an agent it has explicitly delegated
that to. Implementers, integrators, reviewers, security reviewers and QA
return results and recommendations to the agent that started them instead of
starting agents themselves:

- Reviewers do not start more reviewers, and security reviewers do not start
  deeper security reviews. A reviewer that thinks a gate or a higher tier is
  missing says so in its findings.
- Implementers under an orchestrator check their own work (targeted tests,
  UI self-QA) but do not start reviews; the orchestrator does. A solo agent
  is the orchestrator ([above](#bounded-review)) and starts them.
- More reviewers is not more safety. Add an agent only for a distinct risk
  that no planned gate covers.

A short-lived, read-only lookup inside your own task, such as a code search,
is not a new role and is fine. A review, a QA pass, implementation work, or an
agent that would start others is.

### Revalidation

After a fix, rerun the checks that cover what it changed, not every suite.
Run the full required suite once on the final head before reporting the work
complete. [neurasticity-development-testing](.agents/skills/neurasticity-development-testing/SKILL.md#revalidation-after-a-fix)
has the detail.

### Checkpoints

Stopping at a checkpoint is intended, bounded autonomy, not a failure. Start
no new agents or review rounds when any of these happens:

- a gate would need a round beyond its [budget](#review-budget), or the same
  category of finding keeps coming back after fixes;
- a verification pass or any later round finds mostly new FOLLOW-UPs rather
  than BLOCKERs;
- agents started, review rounds or full-suite runs have grown far beyond the
  plan, for example twice the planned agents or a third full-suite run on one
  PR;
- the work has grown beyond the objective: another card's worth of work, or
  files and boundaries the plan did not include;
- the effort is clearly out of proportion to the risk, such as a LIGHT change
  that has needed several review rounds.

Do not estimate cost in money; count what you can observe (review rounds,
agents started, full-suite runs, steps or elapsed time, scope growth). If the
work already meets its [completion](#completion-and-merge-readiness) criteria
with no BLOCKER open, finish normally. Otherwise stop and report a
checkpoint: the work completed, the remaining blockers, the
FOLLOW-UPs deferred and carded, why execution stopped, and the recommended
next action. The user decides whether to continue.

### Deep audit mode

Enter deep audit mode only when the user explicitly asks for it: an
exhaustive review, finding every issue, security hardening, an adversarial
audit or a release-readiness deep dive. Routing a risky change to the DEEP
security tier does not enter it.

- Say that you are entering deep audit mode, and name its scope.
- The review budget and the round, agent and suite-run checkpoints are
  relaxed: rounds may continue while they find BLOCKER or SHOULD-FIX issues
  within the scope.
- For a hardening request, FOLLOW-UP hardening within the scope may be fixed
  instead of carded.
- The scope stays tied to the requested objective, and the scope checkpoint
  still applies.
- Agent topology still applies: the orchestrator may run more review passes,
  but other agents still start none.

Deep audit mode ends when a full pass over the scope finds no new BLOCKER or
SHOULD-FIX, or when the user stops it.

## Out-of-scope work

A bug, gap or improvement found outside the current card (or, during
integration, outside the combined objective), and every FOLLOW-UP finding,
becomes a follow-up card, not part of the PR. Something that breaks the card's
acceptance criteria is in scope: fix it, or report it as a blocker.

- Write it up Jira-ready: a summary; bug or task; steps to reproduce or
  context; expected and actual behavior; branch, SHA and environment;
  evidence; whether it is a regression or pre-existing; and the card or PR
  where it was found.
- Read-only roles (reviewers and independent QA) put it in their report and
  do not change Jira.
- The orchestrator files it, or, without one, the agent running the task.
  Search the NFCT project for an existing card first, then create the card in
  the NFCT project and link it to the card where the work was found. Without
  Jira access, list it in the report for the owner to file.
- Group related findings into one card per coherent piece of work, such as
  "game-session rules hardening", rather than one card per finding, and file
  them when the gate ends. A nit not worth a card stays in the report.
- A follow-up does not block the current objective. If the objective
  genuinely depends on it, or leaving it is a real risk, it is a BLOCKER or
  SHOULD-FIX instead.

## Skills

Procedures live in `.agents/skills/`, the single source of truth for every
agent tool. `.claude/skills` is a symlink to it so Claude Code discovers the
same files; add or edit skills only under `.agents/skills/`. Use the skill that
owns the task; the others link to it rather than restating it. This file takes
precedence over any skill: if they conflict, follow this file and report the
conflict.

| Skill | Use it to |
| --- | --- |
| [nfct-worktrees](.agents/skills/nfct-worktrees/SKILL.md) | Create, hand off and clean up task, review, QA and integration worktrees and branches |
| [neurasticity-development-testing](.agents/skills/neurasticity-development-testing/SKILL.md) | Choose and run the right test layers |
| [nfct-pr-review](.agents/skills/nfct-pr-review/SKILL.md) | Independently review a PR (read-only) |
| [nfct-security-review](.agents/skills/nfct-security-review/SKILL.md) | Review security at a routed LIGHT, STANDARD or DEEP tier, for auth, rules, Functions, deletion, trusted scoring, EEG data, secrets or ownership (read-only) |
| [nfct-frontend-design](.agents/skills/nfct-frontend-design/SKILL.md) | Design and build user-facing UI and game HUDs within the existing visual language |
| [nfct-exploratory-qa](.agents/skills/nfct-exploratory-qa/SKILL.md) | Test user-facing changes like a user in a real browser against the local app, including UI checks |
| [nfct-orchestration](.agents/skills/nfct-orchestration/SKILL.md) | Plan, assign and track multi-stream work through integration into one validated PR; own agent topology and review routing |
| [nfct-integration](.agents/skills/nfct-integration/SKILL.md) | Converge finished parallel streams into one validated integration PR |

## Checks

```bash
npm ci --legacy-peer-deps
npm ci --prefix functions
npm run check:isolation && npm run lint && npm run build && npm test
npm run test:e2e:typecheck && npm run test:rules:typecheck && npm run test:repositories:typecheck
npm run functions:typecheck && npm run functions:build
npm run test:rules            # needs Java 21
npm run test:repositories     # consumer repositories on the emulators; needs Java 21
npm run test:functions        # Cloud Functions on the emulators; needs Java 21
npx playwright test --project=permission-guard   # the e2e permission guard's own tests
npm run test:e2e:protocol     # local emulator browser suite; needs Java 21
```

`npm test` excludes `functions/**`, so a change to `shared/` or `functions/`
also needs the Functions checks.

More detail: [.agents/skills/neurasticity-development-testing](.agents/skills/neurasticity-development-testing/SKILL.md).

iOS ([docs/nfct/ios.md](docs/nfct/ios.md)): `npm test` includes the iOS
project contract tests, and `npm run sync:ios` builds, syncs and runs the
release check (`npm run verify:ios-release`). Run the WebKit iPhone suite
locally: `npm run test:e2e:webkit`, after `npx playwright install webkit` and
`npm ci --prefix functions`; it starts the Functions emulator and needs Java
21. The unsigned Xcode build and the iOS Simulator scenarios need GitHub-hosted
macOS: `.github/workflows/ios.yml`, run by hand on any branch or from
Pre-merge validation for native or iOS-sensitive changes only
([Simulator scenarios](docs/nfct/ios.md#simulator-scenarios)). On a Mac,
`npm run sync:ios && npm run ios:build` runs the same Xcode build.

Remote runs ([docs/nfct/ci.md](docs/nfct/ci.md)) are all manual, apart from
a promotion's release checks and the weekly minimum-iOS run: Pre-merge
validation (`ci.yml`) calls Web
(`web.yml`), Backend (`backend.yml`) and iOS (`ios.yml`), skipping what a
branch's changes cannot affect.

nfct-dev canary ([docs/nfct/nfct-dev-canary.md](docs/nfct/nfct-dev-canary.md)):
`backend.yml`'s `nfct-dev canary` job builds the branch's production bundle
with `nfct-dev`'s web config and runs the critical consumer journey (sign-up,
Train my brain, Mental Math, a saved run, signing in again) against the real
backend TestFlight uses. Pre-merge validation runs it unless every changed
file is clearly non-runtime (`scripts/ci/classify-changes.sh`). The
`emulators` job rehearses the same journey on the emulators; run that
rehearsal locally (needs Java 21):

```bash
NFCT_CANARY_TARGET=emulators npx firebase emulators:exec --only auth,firestore \
  --project demo-neurasticity-protocol-e2e "node scripts/canary/canary.mjs run"
```

Agents do not run the canary against `nfct-dev` themselves; GitHub Actions does. A red
canary with a green rehearsal means the deployed backend or its configuration
does not match the branch: report it as a blocker with the failing step, and
never work around it in the app. Deploying rules or indexes to `nfct-dev` is
the owner's step; for a PR that changes them, follow
[rules and index changes](docs/nfct/nfct-dev-canary.md#rules-and-index-changes).

## Stage 1 test coverage

Every user-facing card, in Stage 1 and after it, adds or updates deterministic
Playwright coverage of the behavior users see, or its PR explains why browser
E2E does not apply. Domain, security and backend cards use the lower layer that
observes the behavior instead of browser tests. The table lists Stage 1's
cards.

| Card | Coverage |
| --- | --- |
| NFCT-17 | Unit, property and simulation tests |
| NFCT-18 | Firestore emulator rules tests |
| NFCT-19 | Functions emulator integration tests |
| NFCT-20 | Repository tests against the emulators |
| NFCT-21, NFCT-22, NFCT-23, NFCT-6 | User-facing: update Playwright coverage |
| NFCT-10 | The canonical Stage 1 end-to-end Playwright journey |

- Keep Playwright tests deterministic. Where an injected or fake clock
  (`page.clock`) or another test seam exists, use it instead of real-time waits
  such as `page.waitForTimeout`.
- Make sure CI runs every new spec. `playwright.protocol.config.ts` does not
  match every `*.local.spec.ts`: its `testMatch` lists fixed suite suffixes
  (for example `persistence` in `session-history.persistence.local.spec.ts`).
  Give a new emulator spec a suffix `testMatch` already matches, or extend
  `testMatch` in the same PR. Then confirm the file is listed:

  ```bash
  GCLOUD_PROJECT=demo-neurasticity-protocol-e2e FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
    FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx playwright test -c playwright.protocol.config.ts --list
  ```

  The variables satisfy the guard in `e2e/helpers/localEmulator.ts`; no
  emulators need to be running. Without them, specs that import that helper
  fail to load with the guard error, so the discovery check is invalid.
  From `playwright.config.ts`, CI runs only the `permission-guard` project, so
  a spec there also needs a project CI runs
  (check with `npx playwright test --list --project=<name>`).
- Cover the card's user-visible behavior. Do not add broad or flaky browser
  tests just to have E2E coverage.

### User-facing and stateful changes

Green existing tests and a page that renders do not prove a user-facing change
works. For any change to user-facing, navigation, authentication, onboarding,
persistence, training-flow or other stateful behavior:

- Exercise it through the real UI, using
  [neurasticity-development-testing](.agents/skills/neurasticity-development-testing/SKILL.md)
  and [nfct-exploratory-qa](.agents/skills/nfct-exploratory-qa/SKILL.md);
  they are required procedure, not optional reading.
- Run the nearest realistic end-to-end journey from a real entry state, not
  by jumping to the changed route or component. Auth or onboarding work starts
  signed out and goes through account creation or sign-in and onboarding;
  training-entry work navigates through the user-facing entry point and
  confirms the training experience is reached.
- Assert the outcome of each interaction (navigation, persisted state,
  enabled or disabled controls, visible roles or options, successful
  completion), not only that something rendered. When the change saves data,
  reload and confirm it persisted.
- Check whether existing tests actually exercise the changed journey and
  assertions. Where the behavior suits deterministic automation, add or update
  Playwright coverage instead of relying only on exploratory QA.
- Treat critical user journeys as regression boundaries: a change that touches
  or can affect one verifies that journey before the PR is marked ready for
  review. Drive the fresh consumer journey with the shared helpers in
  `e2e/helpers/journeys.ts` (`signUpFreshAccountThroughUi`,
  `completeConsumerOnboarding`, `openGameFromTrain`). The nfct-dev canary and
  its emulator rehearsal already use them. A spec that seeds a
  clinician-linked patient does not cover consumer sign-up and onboarding.
- If missing test infrastructure blocks a realistic journey (for example, no
  deterministic way to create a fresh test account), do not bypass that part
  silently or claim it was verified. Report the gap as a blocker and create or
  recommend the infrastructure it needs.

## Running locally

Development is emulator-first. The NFCT dev Firebase project is `nfct-dev`
(Spark plan, `northamerica-northeast2`), but do not create a `.env.local` that
points ordinary development at it.

`.firebaserc` has a `dev` alias for `nfct-dev` and an `emulator` alias, and
deliberately no `default`. Keep at least two aliases: the Firebase CLI treats a
lone alias as the default. A bare `firebase deploy` therefore has no target.
Deploys to `nfct-dev` are manual, run by the owner after tests pass, and always
name it (`--project dev`). Never run `firebase use dev`: it saves an active
project for this directory, which a bare deploy would then use.

Run the app against the emulators. Trusted scoring runs in the Functions
emulator: without `functions`, sessions never get a `result` and progress is
never written. Build it first (after the installs in [Checks](#checks)), and
again after changing `functions/` or `shared/`:

```bash
npm run functions:build
npx firebase emulators:start --only auth,firestore,functions --project demo-neurasticity-protocol-e2e
VITE_E2E_EMULATORS=true VITE_FIREBASE_PROJECT_ID=demo-neurasticity-protocol-e2e \
  VITE_FIREBASE_API_KEY=local-test-key npx vite --host 127.0.0.1 --port 5193
```

The scheduled sweep does not run locally, because there is no Pub/Sub
emulator. The CLI's Node-version and Application Default Credentials warnings
are expected: with a `demo-` project, anything not emulated fails rather than
reaching a real project.

### Parallel agents: QA lanes

The emulator and Vite ports are fixed, so on a shared machine each agent runs
the emulators, Vite, emulator-backed suites and its browser in its own QA
lane: a private loopback network (Linux, no root, no port or config changes).
Name the lane after your stream or run; `exec` works from any later shell
call, the environment (such as `JAVA_HOME`) passes through, and servers you
start in the background stay in the lane:

```bash
scripts/qa-lane.sh up nfct22
scripts/qa-lane.sh exec nfct22 -- npm run test:rules        # any suite, unchanged
scripts/qa-lane.sh exec nfct22 -- npx firebase emulators:start --only auth,firestore,functions --project demo-neurasticity-protocol-e2e
scripts/qa-lane.sh exec nfct22 -- env VITE_E2E_EMULATORS=true VITE_FIREBASE_PROJECT_ID=demo-neurasticity-protocol-e2e \
  VITE_FIREBASE_API_KEY=local-test-key npx vite --host 127.0.0.1 --port 5193
scripts/qa-lane.sh list
scripts/qa-lane.sh down nfct22                              # stops everything in the lane
```

- A lane has no internet: requests off the machine fail fast. Run installs,
  `npx playwright install`, downloads, `git` and `gh` outside it. The app's
  fonts are bundled, so pages render as they do online. Browsers in it still report
  online (a dummy interface with no route), so offline and reconnect behavior
  can be tested there.
- Its servers are reachable only from inside it, so run the browser there too
  ([interactive browser QA](.agents/skills/nfct-exploratory-qa/SKILL.md#drive-the-browser)).
- Processes appear as root inside (your files stay yours), so Chrome there
  needs its sandbox off: `scripts/qa-browser.sh` passes
  `scripts/qa/playwright-cli.json` for that, and Playwright's test runner
  already does.
- `down` your lane when you finish. It stops only processes in that lane.

Without lanes (not Linux, or unprivileged user namespaces disabled; the script
says which), run emulator-backed work one at a time per machine.
