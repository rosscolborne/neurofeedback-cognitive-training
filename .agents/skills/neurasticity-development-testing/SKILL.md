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
| Cloud Functions emulator tests (`npm run test:functions`) | Trusted scoring in `functions/`: the processing core on the Firestore emulator and the `onGameSessionCreated` trigger on the Functions emulator, running the pure `shared/processing` decisions | Needs `npm ci --prefix functions` and Java 21; builds `functions/lib` first. `npm test` excludes `functions/**`, so run it (and `npm run functions:typecheck`) for any change to `shared/` or `functions/`. Emulators only: the Functions emulator never retries a delivery, and nothing proves deployed behavior. |
| Local emulator Playwright suite (`npm run test:e2e:protocol`) | Authenticated navigation, save/reload, cross-account and rules-backed UI workflows | Emulators only; proves nothing about a deployed project. |
| Physical hardware | Real Muse, Web Bluetooth, EEG acquisition, and signal quality | Demo Mode and simulated BLE cannot establish hardware behavior. |

Choose the lowest layer that observes the behavior at risk. Add another layer when a real integration boundary matters, such as client transactions plus rules, or persistence plus UI reload. Check existing `e2e/` coverage before adding a browser test; update a clear existing test where possible. A static contract test does not replace runtime or rules evidence, and Demo Mode does not replace hardware evidence. See the [README checks](../../../README.md#checks) for current test commands.

## Playwright behavior

Read [the E2E reference](references/e2e.md) before adding or running authenticated Playwright tests.

Local emulator and offline tests are routine coverage. This repository has no deployed-project E2E: never add tests, helpers or scripts that sign in to, read from or write to a real Firebase project, and never add service-account credentials. `npm run check:isolation` must stay green.

For non-hardware patient flows, use the normal UI: choose **Skip to Dashboard** if the initial headset screen appears, and **Try Demo Mode** if an experience later asks for a headset. Demo Mode deliberately supplies synthetic Muse-like EEG for application-flow testing; do not remove it or report it as production mock-data leakage. State its limitation accurately: it tests the UI/workflow, not physical hardware, Bluetooth, acquisition, or signal quality.

Test observable behavior, including meaningful empty, error, and negative states when their regression risk warrants it. Reuse the repository's auth and navigation helpers. Never alter production behavior or bypass real authentication to make an E2E test pass.

## Definition of done

Before reporting an implementation or review complete:

1. Identify the appropriate test layer(s) and add or update coverage where warranted.
2. Run the changed tests and relevant nearby regression tests; include applicable typecheck, build, or lint checks from the repository workflow.
3. Report coverage changed, commands run and results, relevant checks not run with the reason, and any manual or hardware testing still required.

Compilation alone is not sufficient evidence of a complete feature. During review, apply this same policy to identify missing or inadequate coverage without mechanically demanding Playwright tests.
