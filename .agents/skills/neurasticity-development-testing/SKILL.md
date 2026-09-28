---
name: neurasticity-development-testing
description: Choose and run appropriate regression coverage for Neurasticity implementation, fix, refactor, and behavior-review tasks. Use when application behavior may need testing; do not require Playwright for every change.
---

# Neurasticity Development Testing

Use this skill when changing or reviewing Neurasticity behavior. Its purpose is to choose the lowest test layer that adequately protects the change, then leave the work with meaningful regression evidence.

## Choose coverage deliberately

| Layer | Use it for | Limit |
| --- | --- | --- |
| Python/pytest (`npm run test:python`) | BrainFlow service, backend API, and signal processing | Does not prove browser integration or physical acquisition. |
| Vitest (`npm test`) | TypeScript domain, service, state, and component behavior | Default suite is offline; it excludes the two BrainFlow service backed tests. Start the local service with `npm run brainflow`, then run `npm run test:brainflow:integration` separately for those assertions. |
| Static contract tests (Vitest) | Fast checks of source wiring and rules text where that contract is deliberate | Text checks do not prove runtime behavior or Firestore authorization. |
| Local Firestore rules emulator (`npm run test:rules`) | Allowed and denied reads/writes under `firestore.rules` | Does not prove deployed rules or the complete UI workflow. |
| Read-only Playwright projects | Authenticated navigation and observable UI behavior without a test-authored persistence change | Require provisioned identities and a running app; the app itself may back-fill signed-in profiles. |
| Stateful Playwright projects | Save/reload, cross-account, and other persistence workflows | Change shared fixture state and require the scoped session workflow below. |
| Physical hardware | Real Muse, Web Bluetooth, EEG acquisition, and signal quality | Demo Mode and simulated BLE cannot establish hardware behavior. |

Choose the lowest layer that observes the behavior at risk. Add another layer when a real integration boundary matters, such as client transactions plus rules, or persistence plus UI reload. Check existing `e2e/` coverage before adding a browser test; update a clear existing test where possible. A static contract test does not replace runtime or rules evidence, and Demo Mode does not replace hardware evidence. See the [README checks](../../../README.md#checks) for current test commands.

## Playwright behavior

Read [the E2E reference](references/e2e.md) before adding or running authenticated Playwright tests.

Local emulator and offline tests can be selected as routine coverage. For shared fixture writes or resets and stateful browser runs, require explicit scope in the task or session and use the documented session harness, lease, and cleanup workflow in the [E2E reference](references/e2e.md). Existing session authorization counts; do not demand a fresh confirmation for the same scoped action. Never use ambient ADC or a stored service-account key for privileged persistence. The [credential and fixture guide](../../../docs/e2e-credentials.md) is the authority for the pinned project, keyless impersonation, and recovery details. Do not infer that a successful read-only preflight proves reset or stateful cleanup.

For non-hardware patient flows, use the normal UI: choose **Skip to Dashboard** if the initial headset screen appears, and **Try Demo Mode** if an experience later asks for a headset. Demo Mode deliberately supplies synthetic Muse-like EEG for application-flow testing; do not remove it or report it as production mock-data leakage. State its limitation accurately: it tests the UI/workflow, not physical hardware, Bluetooth, acquisition, or signal quality.

Test observable behavior, including meaningful empty, error, and negative states when their regression risk warrants it. Reuse the repository's auth and navigation helpers. Never alter production behavior or bypass real authentication to make an E2E test pass.

## Definition of done

Before reporting an implementation or review complete:

1. Identify the appropriate test layer(s) and add or update coverage where warranted.
2. Run the changed tests and relevant nearby regression tests; include applicable typecheck, build, or lint checks from the repository workflow.
3. Report coverage changed, commands run and results, relevant checks not run with the reason, and any manual or hardware testing still required.

Compilation alone is not sufficient evidence of a complete feature. During review, apply this same policy to identify missing or inadequate coverage without mechanically demanding Playwright tests.
