---
name: nfct-exploratory-qa
description: Test user-facing NFCT changes like a user by driving a real browser against the locally running app on the emulators, with scenarios derived from the card and diff, and report evidence-backed results. Use when asked for exploratory, manual-style or agent-driven browser QA of a card, PR, branch or integration result, including UI checks, or to replace a manual click-through. Writing deterministic Playwright tests belongs to neurasticity-development-testing.
---

# NFCT exploratory browser QA

Exploratory QA replaces most of the manual click-through a developer would
otherwise do. It drives the running app in a real browser as a user would,
derives its scenarios from the actual change, and reports what it verified
(with evidence), what failed (with repro steps), and the few checks that still
need a human.

It complements deterministic tests; it does not replace them:

| | Deterministic tests ([testing skill](../neurasticity-development-testing/SKILL.md)) | Exploratory QA (this skill) |
| --- | --- | --- |
| Scenarios | Fixed canonical journeys and regressions | Derived each run from the card, diff and risk |
| Execution | Repeatable and CI-safe, with fake clocks instead of real waits | An agent in a browser; real waits are fine |
| Finds | Regressions of behavior already encoded | Behavior no test encodes yet, edge cases, odd state combinations |
| Output | Passing tests in the PR | A QA report with evidence and repro steps |

## Roles

- **Independent QA** is the normal case and is preferred for an integration
  branch. You change no code; you may create emulator data, and scratch files
  outside the repository.
- **Self-QA** is the implementer or integrator checking their own branch, as
  [nfct-frontend-design](../nfct-frontend-design/SKILL.md) asks for UI work.
  The procedure is the same.

Either way, the owner of the branch under test makes every fix, in their own
worktree: you, for self-QA; otherwise hand the finding to them. On an
integration branch, hand it to the integrator, who decides whether it is an
integration defect or belongs to one stream
([nfct-integration](../nfct-integration/SKILL.md#fix-what-belongs-here)).
Out-of-scope defects become
[follow-up cards](../../../AGENTS.md#out-of-scope-work), never part of this
change.

## Plan before opening the browser

1. Read the card; for an integration branch, read the integration report and
   every stream's card. List the acceptance criteria and the flows they name.
2. Read the diff against its target: the PR's base, or `origin/main` for an
   integration branch (`git diff origin/<base>...HEAD`).
   Note the routes, components, state, data paths, rules and Functions it
   touches.
3. Map what the change can affect: user roles and account states, screens,
   state transitions, and neighboring flows that share its data or
   components.
4. Read the existing tests for those flows (`e2e/`, Vitest, rules, repository
   and Functions tests). Spend browser time on what they do not already prove.
5. Write a short scenario matrix ordered by risk (scenario, role, why it is
   risky, expected result), including the [smoke path](#smoke-path).

Derive scope from the card, the changed files, their dependencies and known
high-risk neighbors. Do not test the whole product for every change.

## Smoke path

Every run includes a short canonical path, so breakage outside the edited
component still shows: sign up or sign in with a fresh account, reach the home
screen, open each main navigation area once, complete the changed feature's
primary flow once, reload, confirm its result persisted, then sign out and
back in. Watch the console throughout.

## Set up

1. Run the exact commit under test and record its SHA: in the branch's own
   worktree for self-QA, otherwise in a detached
   [QA worktree](../nfct-worktrees/SKILL.md#review-worktrees) at the head (for
   an unpushed integration check, at the check's local SHA).
   Install what the branch's [Checks](../../../AGENTS.md#checks) install.
2. Start the emulators and app per
   [Running locally](../../../AGENTS.md#running-locally). Also start every
   emulator the branch's `firebase.json` configures that the flow depends on,
   building what it loads first (for example `functions`, where trusted
   processing runs). Without it, server-side results never appear; that is a
   gap in your environment, not a product bug.
3. The emulator and Vite ports are fixed, so only one QA environment can run
   per machine. If a port is taken, find out whose process holds it; never
   stop another agent's processes.
4. Create accounts through the UI where you can, since that also exercises
   sign-up. Seed only preconditions that are slow or impossible to reach
   through the UI, and only in the emulators: for example with the seeders in
   `e2e/helpers/localEmulator.ts`, called from a scratch script outside the
   repository with the environment that file requires. Give accounts a
   run-unique marker so repro steps can name them.

## Guardrails

Test the real product. Do not:

- add fake or mock product behavior, test-only branches or silent fallbacks
  to make a flow testable;
- weaken rules or authorization, or bypass product logic, for example by
  writing the outcome under test straight into Firestore or driving a step by
  calling app internals from the console;
- point anything at a real Firebase project, including `nfct-dev`, or at any
  deployed service;
- hide a failure: a step you could not complete is BLOCKED, not PASS, and an
  intermittent failure is reported with how often it happened.

Demo Mode's synthetic EEG is a deliberate feature and is fine for flow
testing; it proves nothing about hardware.

## Drive the browser

When a browser-control tool is available (such as Claude in Chrome, a
Playwright MCP server, or your agent's built-in browser), use it; reading the
source is not a substitute. Without one, drive a real browser from a scratch
Playwright script kept outside the repository. If you cannot drive a browser
at all, report the run BLOCKED. Never mark a scenario PASS from code alone.

At each step, observe:

- the visible UI state and the URL;
- which controls are enabled, disabled or loading;
- the resulting state, including after navigation and reload, and from a
  second account where ownership matters;
- console errors and failed network requests, where the tool exposes them;
- behavior specific to the role under test.

Where no screen shows a result yet (for example, server-side processing), you
may read it from the emulator (the Emulator UI or its REST API) as
observation only. Never write the outcome there.

For every FAIL and any ambiguous visual state, keep the evidence: account,
URL, steps, a console excerpt, and a screenshot where useful. Store it outside
the repository.

## What to explore

Choose from these by risk; not every item applies to every change.

- **Core flows**: happy paths; create, edit, delete and cancel; form
  validation; navigation, deep links and the back button.
- **State**: empty states; state after navigating away and back, reloading,
  and signing out and in; stale state across two tabs or an account switch.
- **Roles and access**: signed-out access to signed-in routes; a second
  account never seeing or changing the first's data; views that differ by
  role, including the inherited patient and clinician views while they exist
  and assigned versus unassigned content; permission-denied errors in the
  console.
- **Hand-offs between features**: data one feature writes and another reads,
  such as a saved session, its trusted result and the user's progress.
- **Failure and repetition**: error states you can reproduce safely, such as
  invalid input, an unauthorized URL, or stopping an emulator you started;
  disabled and loading states; rapid and double inputs, double submits and
  idempotency.
- **Game and session flows**: correct and incorrect answers; pause and
  resume; backgrounding and foregrounding the tab; timer boundaries (acting
  just before, at and after a limit); repeated sessions in a row.
- **EEG is optional**: every flow works with no headset connected. If Demo
  Mode or other simulated EEG changes cognitive scores, progression, unlocks
  or achievements, that is a bug.
- **UI**: spacing, alignment, overflow and clipping; layout shifts when
  scores, feedback, timers or messages change; keyboard navigation, visible
  focus and where focus lands after each step; a small window and a narrow,
  phone-like width; stale UI after state changes; whether the journey is
  coherent from start to finish.

## When something fails

1. Reproduce it from a clean start (a fresh account or tab) before treating
   it as real, and reduce it to exact steps.
2. Where the flow exists on `origin/main` (or the change's base), repeat it
   there, and label the defect a *regression*, *pre-existing* or *unknown*.
3. Decide scope. In scope means within the card or, on an integration branch,
   within the combined objective. A pre-existing defect is out of scope unless
   it breaks an acceptance criterion. Label an in-scope FAIL BLOCKER or
   SHOULD-FIX and an out-of-scope one FOLLOW-UP
   ([finding severity](../../../AGENTS.md#finding-severity)).
4. **In scope**: the branch owner fixes it. Afterwards, re-run the failing
   scenario, its neighbors and the smoke path once, not the whole matrix.
5. **Out of scope**: write it up as a
   [follow-up card](../../../AGENTS.md#out-of-scope-work). Do not widen the
   change.
6. **Reproducible**: when fixed steps reproduce it reliably, ask the branch
   owner for a deterministic regression test under the
   [testing skill](../neurasticity-development-testing/SKILL.md), at the
   lowest layer that observes it; that is Playwright when only the UI shows
   it. Give the steps, the account setup and the assertion, so later runs no
   longer rely on exploratory QA for that case.

## Leave only what needs a human

Separate what you verified functionally from what needs human judgment, and
keep the second list short. Reserve HUMAN CHECK for what a browser agent
cannot judge reliably:

- visual polish, subjective UX quality, animation feel and design preference;
- a real Muse headset, Bluetooth, physical sensors, and hardware timing or
  latency that cannot be simulated faithfully;
- iOS and Capacitor builds.

For each item give the account, the screen, the steps and the question to
answer, so the human pass is a short, targeted check rather than a replay of
the app.

## Finish

Stop the emulators and dev server you started, so the next run or test suite
can use the ports, then remove your QA worktree per
[nfct-worktrees](../nfct-worktrees/SKILL.md#clean-up-review-qa-and-integration-check-worktrees).
Keep the evidence until the findings are handed over.

## Report

Start with the branch and SHA tested, the emulators, the browser tooling and
the accounts used. Then give one row per scenario:

| Scenario | Role | Result | Evidence / Notes | Follow-up |
| --- | --- | --- | --- | --- |

Result is **PASS**, **FAIL**, **BLOCKED** (could not be run; say why) or
**HUMAN CHECK**. For each FAIL, add the steps to reproduce, expected and
actual behavior, evidence, whether it is a regression, its scope and its
severity.

Then summarize:

- **Functional confidence**: high, medium or low, and why.
- **Regressions found.**
- **Fixes made**: by whom, the commit SHAs, and the re-run results.
- **Deterministic tests** added or requested.
- **Jira cards** created or proposed.
- **Remaining human checks.**
- **Not tested**, and why: for example physical hardware, iOS or Capacitor
  builds, or tooling that could not observe the console.
