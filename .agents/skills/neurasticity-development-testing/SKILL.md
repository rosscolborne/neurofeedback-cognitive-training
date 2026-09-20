---
name: neurasticity-development-testing
description: Choose and run appropriate regression coverage for Neurasticity implementation, fix, refactor, and behavior-review tasks. Use when application behavior may need testing; do not require Playwright for every change.
---

# Neurasticity Development Testing

Use this skill when changing or reviewing Neurasticity behavior. Its purpose is to choose the lowest test layer that adequately protects the change, then leave the work with meaningful regression evidence.

## Choose coverage deliberately

- Use the Python/pytest suite for BrainFlow service, backend API, signal-processing, and other Python-domain behavior.
- Use the existing Vitest suites for TypeScript services, domain logic, state transformations, and component behavior that does not require a browser workflow.
- Use Playwright for meaningful user-visible workflows and frontend/backend integration where the important result is observed through the real UI. Check existing `e2e/` coverage first; update a clear existing test before adding a narrowly scoped one.
- A feature can warrant multiple layers. Do not add redundant E2E coverage for a detail adequately protected by a lower-level test.
- Treat real Muse, Web Bluetooth, physical EEG acquisition, and signal-quality validation as hardware testing. Ordinary browser tests, including Demo Mode, cannot validate that category.

## Playwright behavior

Read [the E2E reference](references/e2e.md) before adding or running authenticated Playwright tests.

For non-hardware patient flows, use the normal UI: choose **Skip to Dashboard** if the initial headset screen appears, and **Try Demo Mode** if an experience later asks for a headset. Demo Mode deliberately supplies synthetic Muse-like EEG for application-flow testing; do not remove it or report it as production mock-data leakage. State its limitation accurately: it tests the UI/workflow, not physical hardware, Bluetooth, acquisition, or signal quality.

Test observable behavior, including meaningful empty, error, and negative states when their regression risk warrants it. Reuse the repository's auth and navigation helpers. Never alter production behavior or bypass real authentication to make an E2E test pass.

## Definition of done

Before reporting an implementation or review complete:

1. Identify the appropriate test layer(s) and add or update coverage where warranted.
2. Run the changed tests and relevant nearby regression tests; include applicable typecheck, build, or lint checks from the repository workflow.
3. Report coverage changed, commands run and results, relevant checks not run with the reason, and any manual or hardware testing still required.

Compilation alone is not sufficient evidence of a complete feature. During review, apply this same policy to identify missing or inadequate coverage without mechanically demanding Playwright tests.
