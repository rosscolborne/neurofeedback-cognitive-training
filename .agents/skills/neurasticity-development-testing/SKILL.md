---
name: neurasticity-development-testing
description: Choose and run appropriate regression coverage for Neurasticity implementation, fix, refactor, and behavior-review tasks. Use when application behavior may need testing; do not require Playwright for every change.
---

# Neurasticity Development Testing

Use this skill when changing or reviewing Neurasticity behavior. Its purpose is to choose the lowest test layer that adequately protects the change, then leave the work with meaningful regression evidence.

## Choose coverage deliberately

| Layer | Use it for | Limit |
| --- | --- | --- |
| Python/pytest (`npm run test:python`) | Inherited copy of the shared `brainflow-service` backend | Not owned by this repo: change the backend in `brainflow-service`, not here. Does not prove browser integration or physical acquisition. |
| Vitest (`npm test`) | TypeScript domain, service, state, and component behavior | Default suite is offline; it excludes the two BrainFlow service backed tests. Start the local service with `npm run brainflow`, then run `npm run test:brainflow:integration` separately for those assertions. |
| Static contract tests (Vitest) | Fast checks of source wiring and rules text where that contract is deliberate | Text checks do not prove runtime behavior or Firestore authorization. |
| Local Firestore rules emulator (`npm run test:rules`) | Allowed and denied reads/writes under `firestore.rules` | Does not prove deployed rules or the complete UI workflow. |
| Consumer repository emulator tests (`npm run test:repositories`) | The consumer repositories in `src/consumer/` against the Auth and Firestore emulators with `firestore.rules` loaded: writes, tolerant reads, paging, offline queueing | Node has no IndexedDB, so the persistent cache's restart behavior is not observable there. |
| Cloud Functions emulator tests (`npm run test:functions`) | Trusted scoring in `functions/`: the processing core on the Firestore emulator and the `onGameSessionCreated` trigger on the Functions emulator, running the pure `shared/processing` decisions | Needs `npm ci --prefix functions` and Java 21; builds `functions/lib` first. `npm test` excludes `functions/**`, so run it (and `npm run functions:typecheck`) for any change to `shared/` or `functions/`. Emulators only: the Functions emulator never retries a delivery, and nothing proves deployed behavior. |
| Local emulator Playwright suite (`npm run test:e2e:protocol`) | Authenticated navigation, save/reload, cross-account and rules-backed UI workflows | Emulators only; proves nothing about a deployed project. |
| nfct-dev canary (`backend.yml`'s `nfct-dev canary` job; [docs](../../../docs/nfct/nfct-dev-canary.md)) | The fresh consumer journey (sign-up, Train my brain, Mental Math, a saved run, signing in again) with the PR's production build against the real backend TestFlight uses: deployed rules, indexes and configuration | One narrow journey on a shared Spark project, so never a place for broader coverage. It tests the deployed rules, not a PR's candidate rules, and no scoring while Functions are not deployed. Agents rehearse it on the emulators; GitHub Actions runs it for real ([CI](../../../docs/nfct/ci.md)). |
| Physical hardware | Real Muse, Web Bluetooth, EEG acquisition, and signal quality | Demo Mode and simulated BLE cannot establish hardware behavior. |

Choose the lowest layer that observes the behavior at risk. Add another layer when a real integration boundary matters, such as client transactions plus rules, or persistence plus UI reload. Check existing `e2e/` coverage before adding a browser test; update a clear existing test where possible. A static contract test does not replace runtime or rules evidence, and Demo Mode does not replace hardware evidence. See the [README checks](../../../README.md#checks) for current test commands.

The emulator suites use fixed ports. When other agents share the machine, run them in your own [QA lane](../../../AGENTS.md#parallel-agents-qa-lanes) (`scripts/qa-lane.sh exec <lane> -- npm run test:rules`): lanes run in parallel, suites within one lane one at a time.

## Playwright behavior

Read [the E2E reference](references/e2e.md) before adding or running authenticated Playwright tests.

Local emulator and offline tests are routine coverage. The nfct-dev canary is the only deployed-project test: never add other tests, helpers or scripts that sign in to, read from or write to a real Firebase project, never widen the canary into a second suite, and never add service-account credentials. `npm run check:isolation` must stay green. A change to a critical consumer journey updates the shared helpers in `e2e/helpers/journeys.ts`, which both the emulator suites and the canary use.

For non-hardware patient flows, use the normal UI: choose **Skip to Dashboard** if the initial headset screen appears, and **Try Demo Mode** if an experience later asks for a headset. Demo Mode deliberately supplies synthetic Muse-like EEG for application-flow testing; do not remove it or report it as production mock-data leakage. State its limitation accurately: it tests the UI/workflow, not physical hardware, Bluetooth, acquisition, or signal quality.

Test observable behavior, including meaningful empty, error, and negative states when their regression risk warrants it. Reuse the repository's auth and navigation helpers. Never alter production behavior or bypass real authentication to make an E2E test pass.

## Phones, WebKit and iOS

NFCT ships as a responsive web app and as an iPhone app. Coverage runs in six device layers, cheapest first; each proves less than the next, and none substitutes for a higher one ([docs/nfct/ios.md](../../../docs/nfct/ios.md#checks-and-where-they-run)):

1. **Desktop Chromium**: the Playwright suites above.
2. **Interactive Chromium at iPhone sizes**: exploratory and agent-driven. An agent operates the changed UI in real Chrome with the iPhone SE (3rd gen) and iPhone 17 device profiles ([exploratory QA](../nfct-exploratory-qa/SKILL.md#drive-the-browser)). Chromium mobile emulation: not iOS or Safari evidence.
3. **Playwright WebKit with iPhone profiles**: `npm run test:e2e:webkit` runs the specs in `IOS_WEBKIT_SPECS` (`playwright.webkit.config.ts`) in Playwright WebKit as an iPhone SE (3rd gen, 375 × 667) and an iPhone 17 (402 pt wide). Install the browser once with `npx playwright install webkit`. Pre-merge validation also runs it (`ios.yml`; [CI](../../../docs/nfct/ci.md)).
4. **iOS Simulator and the native build**: `ios.yml` on GitHub-hosted macOS compiles the app, checks the Release build, and runs the [Simulator scenarios](../../../docs/nfct/ios.md#simulator-scenarios) through the real UI in WKWebView at `capacitor://localhost`: sign-up and relaunch, a whole Mental Math run saved, backgrounding and killing mid-run, and weekly on the oldest supported iOS. It needs no local Mac: `gh workflow run ios.yml --ref <branch> -f webkit=false -f scenarios='<names>'` runs chosen scenarios on any branch and returns screenshots, logs and a summary ([how](../../../docs/nfct/ios.md#running-scenarios-from-an-agent-or-a-terminal)). macOS minutes are expensive, so run only the scenarios you need.
5. **A physical iPhone**: suspension, interruptions, the keyboard and offline durability (NFCT-32's checklist).
6. **A physical iPhone with a Muse headset**: real Bluetooth EEG on the device; see the hardware layer above.

Playwright WebKit is current WebKit on Linux, not iOS WKWebView: never report it as iOS or Simulator evidence. Simulator evidence is not device evidence. When a change alters a screen the Simulator scenarios drive (onboarding, the Train tab, Mental Math), update `scripts/ios/simulator-scenarios.mjs` in the same PR, as for `e2e/helpers/auth.ts`. Changing the Train tab or navigation does not start the macOS job in Pre-merge validation: dispatch `gh workflow run ios.yml --ref <branch> -f webkit=false -f scenarios=mental-math`.

For user-facing UI work:

- Check the changed screens at phone sizes as well as desktop: in portrait at 375 × 667 and about 400 pt wide. Look for horizontal overflow, clipped or overlapping text, primary actions below the fold, and touch targets under 44 pt. [Exploratory QA](../nfct-exploratory-qa/SKILL.md) does this interactively (layer 2) for every user-facing change; screenshots alone do not count.
- If a changed flow is in `IOS_WEBKIT_SPECS`, run `npm run test:e2e:webkit`. When a new spec covers a flow that matters on iPhone (sign-in and account, a game run, offline or persistence), add it to the list and confirm with `--list` that both iPhone projects discover it. Keep the list focused rather than running every spec in WebKit.
- Treat a failure that happens only in WebKit as a finding until shown otherwise, not as flakiness.
- Keep product code responsive, not phone-specific: the native target is iPhone-only, but the web app serves every size.

## Deterministic tests and exploratory QA

This skill owns deterministic, repeatable coverage. Driving the running app in a browser to find what no test encodes yet belongs to [nfct-exploratory-qa](../nfct-exploratory-qa/SKILL.md), which never substitutes for the coverage required here. When exploratory QA hands over a defect that reproduces reliably, the owner of the branch adds its regression test at the lowest layer that observes it; that is Playwright when only the UI shows it.

On an integration branch, the relevant suite is everything the merged checks and CI run, plus deterministic tests for behavior that crosses streams; see [nfct-integration](../nfct-integration/SKILL.md#validate-the-combined-result).

## Revalidation after a fix

Fit the checks to what a fix changed:

- After a fix, rerun the tests that cover the changed code and the finding's own repro (the probe, test or scenario that showed it), plus the fast checks the fix can break: lint, typecheck and build for code, or the changed links for docs. Run an emulator suite (rules, Functions, repositories or Playwright) only when the fix touches what that suite covers.
- For a security fix, the minimum proof is the probe or test that demonstrated the finding, now showing it is closed, kept as a regression test at the lowest layer that observes it (a rules test for a rules bypass).
- Do not rerun every expensive suite after each small correction. Run the full required suite once on the final head before reporting the work complete: the relevant [Checks](../../../AGENTS.md#checks) or, for an integration branch, everything the merged checks and CI run.

## Definition of done

Before reporting an implementation or review complete:

1. Identify the appropriate test layer(s) and add or update coverage where warranted.
2. Run the changed tests and relevant nearby regression tests; include applicable typecheck, build, or lint checks from the repository workflow.
3. Report coverage changed, commands run and results, relevant checks not run with the reason, and any manual or hardware testing still required.

Compilation alone is not sufficient evidence of a complete feature. During review, apply this same policy to identify missing or inadequate coverage without mechanically demanding Playwright tests.
