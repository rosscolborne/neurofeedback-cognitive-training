# Mock/Placeholder Data Removal — Orchestrator Handoff

## Purpose

This project is replacing misleading mock, placeholder, hard-coded, or simulated
production-facing data across the patient and clinician applications with real
persisted/measured data or truthful empty/unavailable states. Intentional patient
training Demo mode, used to test games without a headset, and explicitly labeled
debug/replay simulators must remain.

The persistent project state document is:

`docs/codex/mock-data-removal/IMPLEMENTATION_PLAN.md`

Maintain it throughout implementation. This handoff is only the bootstrap summary.

## What has happened

- Original foundation base: `905bb2927b1a6ed8084001ed100fa0b938c8c0ab`.
- `codex/production-data-foundation` completed at
  `f97f7e1139228a9802bb2024e673f6bf8e812654`.
- PR #16 merged the foundation with merge commit `68f415f`.
- The last application-code baseline before the coordination-document commit is
  `8bab4b8699e30d1b81ea8426bf3173ab4f3d32dd`. Use the live, clean
  `fill-in-mocked-data` HEAD containing these documents as the branch point.
- At handoff, local `main`, `origin/main`, and `fill-in-mocked-data` all point to
  `8bab4b8`; only the root worktree exists and no downstream agents were launched.
- The user has directed that every remaining branch start from
  `fill-in-mocked-data` and merge back into `fill-in-mocked-data`. Do not merge
  feature work directly into `main`. The final integration branch must be tested,
  reviewed, and approved before any later merge to `main`.

## Foundation state and verification

The foundation is merged and provides shared Firestore types/mappers/repositories,
tenant-aware rules, idempotent session persistence, persisted roles, invitation
and relationship primitives, clinician logout, Demo-session saving, and canonical
protocol assignment with aliases and patient-visible details.

Reported automated verification: the full Vitest suite passed (13 files, 107
tests), and the production build passed with pre-existing WASM export and
bundle-size warnings. The user manually exercised and approved the foundation,
including authentication/role behavior, clinician logout/enrollment, Demo session
saving after rules deployment, and protocol assignment/patient display. Treat this
as approval of the foundation, not proof of every edge case.

Remaining verification gaps include cross-tenant/emulator coverage in the final
deployed environment, real-headset parity, complete invitation acceptance and
relationship persistence, multi-timezone appointment behavior, and production
message/report workflows.

## Decisions not recoverable from Git alone

- Keep patient training Demo mode and debug simulators; remove/isolate only
  production-facing fabricated data, including the clinician sample cohort.
- Existing Firestore data must remain backward compatible through tolerant reads
  and additive canonical writes.
- Shared schemas, interfaces, repositories, and rules must not be independently
  redesigned by parallel agents.
- Parallel agents should send structured completion reports to the orchestrator;
  the orchestrator centrally updates the plan to avoid coordination-file conflicts.
- Keep agent worktrees available after completion for review/follow-up.
- The foundation's most important unresolved issue is that enrollment/linking UI
  does not reliably persist the clinician/patient relationship expected by
  `canManagePatient()` and Firestore authorization. R1 owns the repair.

## Remaining work and dependencies

Full scope, file ownership, acceptance criteria, and tests are in the plan.

- **R1 Relationship Integrity:** first-wave priority; owns shared relationship
  contracts/rules and enrollment/acceptance UI.
- **P1 Patient Progress:** independent first wave; removes static/fallback patient
  metrics and makes empty/data states truthful.
- **C1 Patient Detail/QEEG/Telemetry:** independent first wave; removes fabricated
  clinical measurements and fake live state.
- **C2 Clinical Analytics/Reports:** independent first wave; makes filters,
  aggregates, graphs, claims, and PDFs data-derived.
- **S1 Clinic Settings/Branding:** independent first wave; persists real tenant
  settings and removes fake clinician/hardware status.
- **T1 Protocol Runtime:** independent first wave; makes supported assigned values
  affect training while preserving Demo mode.
- **M1 Messaging:** isolated work can start in parallel; rules integration and E2E
  depend on R1.
- **A1 Appointments:** isolated work can start in parallel; rules integration and
  E2E depend on R1.
- **D1 Production/Demo Separation:** starts after R1 and S1 review because it
  overlaps shared storage/settings/routes.
- **I1 Integration/Review:** continuous merges into `fill-in-mocked-data`; final
  validation after all required workstreams.

First concurrent launch set: **R1, P1, C1, C2, S1, and T1**, limited only by
available agent slots. Start M1/A1 as additional slots open, preserving their R1
integration dependency.

## Risks and blockers

- Broken/missing persisted links can look like downstream missing data and cause
  Firestore permission failures.
- Firestore rules require an authorized deployment; committed rules alone do not
  change the live project.
- Mixed legacy documents require tolerant mappers; do not require destructive
  migration.
- QEEG input format, Brain Capacity formula, benchmark/significance definitions,
  and a live telemetry contract may need authoritative product/clinical decisions.
  Show unavailable rather than inventing them.
- Messaging/appointments may need coordinated collections, indexes, and rules.
- Verify whether `fill-in-mocked-data` has an intended remote/tracking branch before
  distributed work; it had none at this handoff.

## Coordination document paths

- `docs/codex/mock-data-removal/IMPLEMENTATION_PLAN.md`
- `docs/codex/mock-data-removal/HANDOFF.md`

## Instructions for the receiving orchestrator

1. Read both documents completely.
2. Inspect Git/worktrees and verify the documented state.
3. Report discrepancies before changing anything.
4. Ensure the approved foundation is present in the common base branch before launching dependent agents.
5. Launch the maximum number of independent implementation agents concurrently, each in an isolated branch/worktree based on the correct approved commit.
6. Give every agent its exact scope/file ownership and tell it to read `IMPLEMENTATION_PLAN.md`.
7. Prevent agents from independently changing shared foundation contracts. If a shared contract is insufficient, treat that as a coordinated foundation change rather than allowing divergent implementations.
8. Have each implementation agent run appropriate tests and update its section of `IMPLEMENTATION_PLAN.md` when it finishes.
9. Keep completed agent worktrees available until review/follow-up is complete.
10. Integrate work through `fill-in-mocked-data` rather than directly into `main`.
11. Update the plan after every review/merge/state transition.
12. Continue launching newly unblocked work as soon as dependencies are satisfied rather than waiting for unrelated agents.
