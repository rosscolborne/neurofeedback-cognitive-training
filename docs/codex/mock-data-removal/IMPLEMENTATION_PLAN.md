# Production Data Replacement — Implementation Plan

Last reconciled: 2026-09-19  
Integration branch: `fill-in-mocked-data`  
Last application-code baseline: `8bab4b8699e30d1b81ea8426bf3173ab4f3d32dd`

## How to use and maintain this document

This file is the persistent source of truth for project intent, scope, ownership,
decisions, dependencies, and progress. It must be usable without prior chat
history.

- Every implementation agent must read this file completely, then reread its
  relevant workstream section before beginning.
- When an agent completes meaningful work, it must report what was implemented,
  tests and results, final commit(s), remaining caveats, and proposed status.
- To avoid merge conflicts, implementation agents should **not edit this shared
  file in their feature branches by default**. They should send the orchestrator
  the structured completion report above; the orchestrator applies it centrally
  on `fill-in-mocked-data`. An agent may edit only its uniquely owned workstream
  section when the orchestrator explicitly assigns that responsibility.
- Agents must not rewrite another agent's section unless integration requires it.
- The orchestrator updates this file after every review, merge, block,
  supersession, or other state transition.
- Git is authoritative for branch, commit, and worktree state. This document is
  authoritative for project intent, ownership, decisions, dependencies, and
  progress. If they disagree, investigate rather than blindly trusting either.
- Keep this file concise enough for a fresh Codex conversation to consume, but
  complete enough that no conversation history is required.

Allowed status values are: **NOT STARTED**, **IN PROGRESS**, **BLOCKED**,
**IMPLEMENTED**, **REVIEWED**, and **MERGED**.

## Objective and definition of done

Replace mock, hard-coded, placeholder, simulated, or otherwise misleading
production-facing data with authenticated persisted data, actual measured data,
product configuration, or an honest empty/unavailable state. Preserve intentional
training simulation features.

The project is done when:

1. Patient and clinician production paths do not present fabricated personal,
   clinical, training, telemetry, report, appointment, or messaging data.
2. Clinician/patient relationships are persistently established, enforced by
   Firestore rules, and used consistently by repositories and both UIs.
3. Data-derived displays are deterministic, explainable, and tested against
   empty, partial, legacy, and current documents.
4. Every write has explicit ownership, server-safe timestamps/identifiers where
   appropriate, visible error handling, and compatible authorization rules.
5. Existing production/Firestore documents remain readable through tolerant
   mappers and additive migrations; destructive bulk migration is not required.
6. Each workstream has passed focused tests and review, the integrated branch has
   passed the full test/build/rules checks and dual-account UI testing, and no
   work is merged directly to `main` before integrated review and approval.

## Scope and exclusions

### In scope

- Patient home/progress metrics and history.
- Clinician roster, patient detail, QEEG/brain-map data, telemetry, reports,
  practitioner/clinic settings, branding, messaging, appointments, and protocol
  runtime behavior.
- Enrollment/invitation linking and the authorization relationship underpinning
  all clinician access.
- Production/demo separation for the clinician sample workspace.
- Firestore contracts/rules and backward-compatible mappers required by those
  production paths.

### Explicitly excluded or treated as product configuration

- **Keep intentional patient training Demo mode.** It exists to test training
  games without a headset and should continue to generate simulated EEG/game
  input. Demo sessions should still save like headset sessions when the signed-in
  user chooses to save them.
- Keep explicitly labeled developer debug/replay/simulator tools and providers.
- Static educational copy, experience catalog metadata, evidence-based protocol
  catalog definitions, badge/milestone definitions, design tokens, and truthful
  empty-state copy are configuration/content, not mock user data.
- This project does not invent clinical algorithms, normative QEEG transforms,
  diagnoses, or efficacy claims. If a validated source does not exist, show an
  unavailable state.
- The clinician sample/demo cohort is **not** covered by the training Demo-mode
  exclusion. It must be removed from authenticated production paths or isolated
  behind a clearly labeled development/demo boundary.

## Repository and branch baseline

- Original audit/foundation base: `905bb2927b1a6ed8084001ed100fa0b938c8c0ab`.
- Foundation branch: `codex/production-data-foundation`.
- Foundation final commit: `f97f7e1139228a9802bb2024e673f6bf8e812654`.
- Foundation merge commit: `68f415f` (merged through PR #16).
- Last application-code HEAD before this coordination-document commit: `8bab4b8`.
- At last reconciliation, local `main`, `origin/main`, and
  `fill-in-mocked-data` also pointed to `8bab4b8`; only the root worktree existed.

All remaining branches must be created from the then-current, clean
`fill-in-mocked-data` HEAD **including this committed plan** and merged back into
`fill-in-mocked-data`. Do not use `8bab4b8` as a fixed branch point after the plan
commit. Do not merge
feature branches directly to `main`. Do not merge `fill-in-mocked-data` to `main`
until integrated changes are tested, reviewed, and approved.

Suggested worktrees are sibling directories named
`../neurasticity-<workstream>`. Keep completed worktrees available for review and
follow-up until the orchestrator explicitly retires them.

## Foundation conventions already established

The merged production-data foundation provides the shared contracts downstream
work must use rather than independently reinvent:

- Authenticated, role-aware Firestore repositories in `storageEngine.ts`.
- Tolerant legacy/current document mappers and additive fields.
- Idempotent session saves and user-owned session reads.
- Clinician/patient authorization through a persisted relationship checked by
  `canManagePatient()` and Firestore rules.
- Invitation records for clinician-to-patient enrollment.
- Persisted account roles, clinician logout, and removal of the broken email
  verification gate.
- Persisted canonical protocol templates plus a separate custom alias and custom
  reward settings; limited, intentional patient-facing protocol details.
- Demo training completion follows the same save/notes flow as a headset session.

Shared files are reserved for coordinated ownership:

- `src/types/index.ts`
- `src/services/storageEngine.ts`
- `src/services/dataMappers.ts`
- `firestore.rules`
- `src/App.tsx`
- `src/components/patient/PatientShell.tsx`

R1 owns relationship-specific changes in those files. The orchestrator owns
cross-workstream integration changes. Other agents must not change shared
interfaces, schemas, or rules independently. If a contract is insufficient, the
agent must submit a structured change request describing the field/API, callers,
rules, compatibility behavior, and tests.

## Audit findings grouped by workstream

### Relationship and authorization

The clinician enrollment UI can create an invitation/code, but the complete UI
journey does not reliably establish the persisted client relationship expected by
`canManagePatient()`, `getClients()`, and Firestore rules. The expected client
document must identify the clinician with `clinicianId` (and tolerate the legacy
`linkedClinicianCode` form). This is the highest-priority unresolved contract gap.

### Patient progress

- The home Brain Capacity mini-chart is a fixed SVG curve.
- Blank profiles carry placeholder-like defaults such as score `50`, one grace
  day, an external avatar, and seeded garden/biome values.
- Progress is substantially session-backed, but empty/partial data and score
  semantics need a truthful presentation; session time-in-zone is sometimes
  labeled generically as “Score.”

### Patient detail, QEEG, and live telemetry

- Patient detail generates fallback band powers, score `50`, and hard-coded
  protocol/channel/rationale values when data is absent. `||` fallbacks also turn
  valid zero measurements into fake nonzero values.
- Brain-map “upload” only records a filename and prepopulates invented Z-scores,
  PAF, notes, and hidden metrics; it does not upload or parse a file.
- The Live Telemetry tab displays fixed contact quality, impedance numbers,
  waveform, sample rate, transport state, and packet loss.

### Clinical analytics and reports

- Date-range controls do not actually filter the underlying sessions.
- Empty data falls back to averages such as `80` and `75`.
- Duration, benchmark, trajectory, Muse monitoring, TBR graph, percentage change,
  and significance statements are hard-coded.
- Adherence uses a lifetime session count against a four-week prescription rather
  than the selected interval.
- PDF narrative can imply clinical outcomes/recommendations not justified by the
  stored data.

### Clinic/practitioner settings and branding

- Settings initialize with a fabricated clinician name and license and “save” only
  changes local UI state.
- Hardware readiness and device facts are presented like live status even when no
  device state was read.
- Branding is local-storage-backed even though the foundation added persisted
  clinic support.
- Production settings expose sample/demo clinician workspace controls.

### Messaging

Basic Firestore persistence exists, but whole message arrays, client-generated
timestamps/IDs, “Just now” strings, limited error handling, and the lack of a
patient messaging surface are not production-ready. Relationship authorization
must apply to both participants.

### Appointments

Basic Firestore persistence exists, but appointment IDs/date/time are
client-generated strings, timezone/server timestamp semantics are unclear,
errors can be swallowed, and no reliable patient appointment view is present.

### Protocol runtime

Assignment and patient display are persisted, but the training runtime does not
yet demonstrably consume every clinician-entered reward min/max/threshold/duration
value. UI display alone must not imply those settings affect training.

### Production/demo separation

`storageEngine.ts` still contains seeded demo clients, messages, sessions, and
appointments plus reset/wipe helpers. Those clinician/sample data paths must be
isolated from authenticated production use while preserving training Demo mode
and explicit debug simulators.

## Dependency graph and parallelization

```text
F0 Production Data Foundation (MERGED into fill-in-mocked-data)
 ├─ R1 Relationship Integrity ─┬─ M1 Messaging integration/E2E
 │                             └─ A1 Appointments integration/E2E
 ├─ P1 Patient Progress Authenticity
 ├─ C1 Patient Detail / QEEG / Telemetry
 ├─ C2 Clinical Analytics / Reports
 ├─ S1 Clinic Settings / Branding ──┐
 └─ T1 Protocol Runtime             ├─ D1 Production/Demo Separation
                                   └─ I1 Integrated Review → approval → main
```

Safe first wave: R1, P1, C1, C2, S1, and T1 can execute concurrently from the
same clean `fill-in-mocked-data` commit because their primary file ownership is
disjoint. M1 and A1 may also start in parallel if they stay within their new/local
repositories and UI files; their rules/shared-contract integration and final E2E
approval remain blocked on R1. D1 waits for R1 and S1 because it overlaps shared
storage/settings surfaces. I1 waits for all reviewed workstreams.

Do not serialize independent UI/derivation work merely for convenience. If the
orchestration environment has fewer slots, keep a queue and launch the next
independent workstream immediately when a slot opens.

## Workstreams

### F0 — Production Data Foundation

- **Status:** MERGED
- **Branch:** `codex/production-data-foundation`
- **Worktree:** removed after merge (none at last reconciliation)
- **Final commit:** `f97f7e1139228a9802bb2024e673f6bf8e812654`
- **Merged by:** `68f415f` into the lineage now at `fill-in-mocked-data@8bab4b8`
- **Scope delivered:** shared types/mappers/repository contracts; tenant-aware
  rules; role persistence; invitation/link primitives; session persistence,
  including Demo sessions; clinician sign-out; protocol catalog, alias, persisted
  assignment, and patient details; removal of email-verification gate.
- **Tests reported:** full Vitest suite passed (13 files, 107 tests); production
  build passed with pre-existing WASM export and bundle-size warnings. The user
  manually tested the foundation flows before approving/merging it.
- **Remaining caveat:** the persisted relationship contract exists, but the
  complete enrollment/linking UI journey is not reliable; assigned to R1.

### R1 — Relationship Integrity and Enrollment

- **Status:** MERGED
- **Parallelizable:** yes; first wave and highest priority
- **Branch:** `codex/mockdata-relationship-integrity`
- **Worktree:** `../neurasticity-mockdata-relationship`
- **Final commit:** `7dc01823cdee79e127fe18a0f70a8804d20da385`,
  `b78fa36452ba25732059e382fc50b1991967241b`,
  `fe194ba9baf32290e3761bc4f3a3954a2b9586d5`,
  `4c398c1210b2d6359393b330b1d73c685878f5b7`; merged by
  `bf215a832ee8a0cbf9046fb7ba66fcf9113d0833`
- **Owned files:** relationship/invitation sections of `firestore.rules`,
  `src/services/storageEngine.ts`, `src/services/dataMappers.ts`, and
  `src/types/index.ts`; `src/components/clinician/ClientRosterView.tsx`;
  invitation acceptance/connection UI in `src/components/patient/PatientShell.tsx`;
  relationship routing in `src/App.tsx`; focused tests.
- **Dependencies:** F0 only.
- **Requirements:** provide a discoverable patient flow to accept an invitation;
  atomically and idempotently persist the clinician/patient link; make the linked
  patient appear in only the correct clinician's roster; prevent cross-clinician
  reads/writes; handle expired, used, invalid, self, duplicate, and already-linked
  invitations; surface actionable errors; preserve legacy link fields on read.
- **Acceptance:** a clinician enrolls by email, the correct patient accepts the
  code, both accounts see the linked state after logout/login, the clinician can
  manage that patient, an unrelated clinician cannot, and retries do not create
  duplicate links.
- **Tests:** repository transaction/idempotency tests; mapper legacy tests; rules
  emulator/contract tests for patient, owning clinician, and unrelated clinician;
  UI tests for all code states; manual two-patient/two-clinician browser test.
- **Caveat/report:** document whether email matching is case-normalized and how
  invitations for not-yet-created accounts are resolved.
- **Implementation report:** atomic/idempotent invitation acceptance, persisted
  relationship routing, canonical/legacy roster reads, ownership rules, and
  actionable enrollment states implemented. Emails are stored/compared normalized
  in the repository; rules lowercase the Firebase token email before comparison.
  Pre-account invitations resolve after authenticated patient profile
  creation. Focused tests passed (47/47), full Vitest passed (119/119), and the
  production build passed. Rules emulator execution is pending because Java is
  unavailable locally; static rules contract tests passed. Independent review
  required security fixes for canonical/legacy ownership precedence, tenant-field
  immutability, direct self-linking, email normalization, audit/deletion bypasses,
  concurrent duplicate invitations, and visible lifecycle errors. First fixes
  completed with 55/55 focused and 127/127 full tests passing. Re-review found the
  legacy roster query incompatible with canonical-precedence rules and a
  delimiter-collision risk in deterministic claim IDs. Follow-up fixes use a
  rules-provable explicit-null legacy query with independent canonical retrieval
  and collision-free nested claim paths. Focused tests passed 58/58 and full tests
  passed 130/130. Missing-field legacy records require a
  trusted canonical/null backfill before they can be safely enumerated. Final
  security review passed, the branch merged, and integrated focused tests passed
  58/58. Emulator execution remains pending on a Java-capable environment.

### P1 — Patient Progress Authenticity

- **Status:** MERGED
- **Parallelizable:** yes; first wave
- **Branch:** `codex/mockdata-patient-progress`
- **Worktree:** `../neurasticity-mockdata-patient-progress`
- **Final commit:** `1a632bf62bf88536023ad8687444092c69703d0e`,
  `fb2e48a4c221e7d8705170e1f047cb7f7afb82c9`,
  `fdb5e84c7d4a4b579abbddd6be7089e04d7361f3`,
  `b825919a824f8a7bd0d57cc619ca2c7f011f4301`; merged by
  `fcce66c4565bc04e04bd71e2191222bbc5aafe8d`
- **Owned files:** `src/components/patient/HomeScreen.tsx`,
  `src/components/patient/ProgressHistory.tsx`, a new isolated patient-metrics
  helper and its tests. Do not edit shared storage/types without approval.
- **Dependencies:** F0 only.
- **Requirements:** derive streak, weekly activity, capacity/score charts, totals,
  and history only from owned persisted sessions or explicitly documented product
  rules; replace fabricated default profile metrics with unavailable/empty UI;
  preserve legitimate zeros; label metrics accurately; keep static badge
  definitions but award them only from real qualifying data.
- **Acceptance:** new accounts show truthful empty states; session data changes
  every displayed metric predictably; no fixed SVG trend or arbitrary baseline is
  presented as measured; legacy/partial sessions do not crash.
- **Tests:** pure metric tests for empty, zero, partial, mixed-date, and timezone
  cases; component empty/data/error states; manual new-account and multi-session
  checks across Week/Month/All Time.
- **Shared change request:** if blank-profile defaults must change, submit a small
  orchestrator-owned patch request rather than editing `storageEngine.ts`.
- **Implementation report:** session-derived home/progress metrics and truthful
  empty/error states implemented without shared-file changes. Focused metrics tests
  passed (7/7), targeted lint passed, and the production build passed. Full Vitest
  reported 112 passing tests and two BrainFlow-service-dependent timeouts while the
  local backend was unavailable; review later reproduced a clean 114/114 pass.
  Independent review required fixes for unsupported badge evidence, swallowed read
  errors, an undefined trend rule, loading/single-point states, and component-state
  coverage. Owned fixes were completed with 8/8 focused and 115/115 full tests;
  re-review cleared the original findings but found session evidence still rendered
  as negative/empty during loading and error states. The final owned display-state
  fix completed with 13 focused and 120 full tests passing; re-review passed with a
  low finding that CSV export must share the resolved-state boundary. The final
  fix passed independent review with no findings and merged into the integration
  branch. Integrated focused tests passed (14/14). The central session-read error
  contract landed in `d445528` and now makes P1's error state reachable.
  The shared read-error contract remains reserved for the orchestrator and must
  reject failures while successful empty queries resolve `[]`.

### C1 — Patient Detail, QEEG, and Telemetry Authenticity

- **Status:** MERGED
- **Parallelizable:** yes; first wave
- **Branch:** `codex/mockdata-clinical-detail`
- **Worktree:** `../neurasticity-mockdata-clinical-detail`
- **Final commit:** `c2c4fa4c4377dfcd494b4cd4611f2fcd3c591fca`,
  `6a6a5e6e7061754ba9539d2964140e6e2337d482`,
  `ba9369a41c33e40351dd77758c9cc92ba8df2aa5`,
  `1a36f5923387ab72e3050a73243dc633673fc53b`,
  `5fcb1bf3a0d22016e98375b6437aacbe2e99ef6f`,
  `82e3e86d466087670366f5f64aed3c98a4f49fb5`,
  `c2bc9eb6014feaad46e73f885b6527dbbf8202b4`; merged by
  `c8255492b71a3c85215d9f9b124aa8d77c4ea4be`
- **Owned files:** `src/components/clinician/ClientDetailView.tsx`,
  `src/components/clinician/BrainMapUploadModal.tsx`, new isolated brain-map and
  clinical-metric helpers/tests.
- **Dependencies:** F0; R1 only for final authorization/E2E.
- **Requirements:** remove invented band, score, protocol, rationale, impedance,
  waveform, connection, packet-loss, and device values; preserve valid zeros;
  show honest unavailable states. Brain-map input must either genuinely upload,
  parse, validate, and persist a supported format or be clearly renamed as manual
  entry with all clinical values blank until entered. Never infer QEEG transforms
  without a validated algorithm/source.
- **Acceptance:** an empty patient displays no measurements; persisted session or
  QEEG values render exactly; malformed/partial data is identified; telemetry is
  shown only from a real active source, otherwise “not connected/unavailable.”
- **Tests:** mapper/derivation boundary and zero tests; modal validation/persistence
  tests; detail empty/loading/error/data states; manual linked-patient review.
- **Implementation report:** removed fabricated clinical/telemetry values, added
  truthful unavailable states and a validated manual QEEG-entry path, with no
  shared-contract changes. Full Vitest passed (15 files, 113 tests) and the
  production build passed with existing warnings. Independent review required
  fixes for persistence failure/concurrency, measurement provenance, swallowed
  read errors, malformed legacy data, incorrect units, chart order, and test
  coverage. Owned fixes completed with 14 focused and 121 full tests passing;
  re-review is pending. Dedicated brain-map persistence, query error propagation,
  and session measurement provenance remain centrally reserved integration
  dependencies. Second-round owned fixes eliminated the redundant stale profile
  write, gated learning/count evidence states, tolerated valid legacy dates, and
  strengthened handler/display tests. Focused tests passed 18/18 and full tests
  passed 125/125. A final review finding for impossible normalized legacy dates was
  fixed with explicit format/component validation; final re-review passed without
  findings and the branch merged. Integrated focused tests passed 18/18. Central
  append and session-error wiring landed in `d445528`; average-band provenance
  remains coordinated with T1 before full manual testing.

### C2 — Clinical Analytics and Reports

- **Status:** IMPLEMENTED
- **Parallelizable:** yes; first wave
- **Branch:** `codex/mockdata-clinical-reports`
- **Worktree:** `../neurasticity-mockdata-clinical-reports`
- **Final commit:** `09d2c086ac0c654b730b6f81365eb98a0de5d34e`
- **Owned files:** `src/components/clinician/ClinicalReportsView.tsx`,
  `src/services/pdfReportGenerator.ts`, a new isolated analytics helper/tests.
- **Dependencies:** F0; R1 only for final authorization/E2E.
- **Requirements:** apply selected date ranges; derive all aggregates, adherence,
  device coverage, trends, and PDF claims from qualifying sessions; do not display
  benchmark/significance/outcome/recommendation claims without an explicit
  validated source; distinguish zero from unavailable; include provenance and
  interval in exports.
- **Acceptance:** empty reports contain no fabricated values or claims; changing
  the range changes eligible sessions and totals; UI and PDF agree; partial data
  reduces coverage or shows unavailable rather than silently substituting values.
- **Tests:** date-boundary/timezone and aggregation unit tests; empty/partial/full
  component tests; deterministic PDF text assertions; manual range and export
  comparison for a linked patient.
- **Implementation report:** one interval-aware analytics model now drives UI and
  PDF values, coverage, provenance, and adherence; unsupported clinical claims and
  fabricated report values were removed. Focused analytics/PDF tests passed 9/9,
  full tests passed 130/130, focused lint was clean, and the production build
  passed. The requested shared session-read rejection contract landed centrally in
  `d445528`; independent review is pending.

### S1 — Clinic/Practitioner Settings and Branding

- **Status:** IN PROGRESS
- **Parallelizable:** yes; first wave
- **Branch:** `codex/mockdata-clinic-settings`
- **Worktree:** `../neurasticity-mockdata-clinic-settings`
- **Final commit:** pending
- **Owned files:** `src/components/clinician/ClinicSettingsView.tsx`,
  `src/components/brand/ClinicCustomizerModal.tsx`, `src/services/brandEngine.ts`,
  new dedicated clinic/practitioner repository/helper/tests. `App.tsx` wiring is
  reserved for orchestrator integration.
- **Dependencies:** F0.
- **Requirements:** load/save authenticated clinic and practitioner data; never
  initialize with a fake name/license; persist branding to the clinic with a safe
  fallback/migration from existing local settings; separate device capability
  documentation from live assignment/connectivity; provide honest save/error/
  unavailable states.
- **Acceptance:** fresh clinician has blank/onboarding state; saved settings and
  branding survive logout/device reload and remain tenant-scoped; another clinic
  cannot read them; hardware is never called ready from static copy alone.
- **Tests:** repository tenant/rules tests; local-settings migration; component
  loading/empty/save/error states; manual two-clinic persistence/isolation test.

### M1 — Production Messaging

- **Status:** NOT STARTED
- **Parallelizable:** implementation may start in first wave if isolated; shared
  authorization integration and E2E depend on R1
- **Branch:** `codex/mockdata-messaging`
- **Worktree:** `../neurasticity-mockdata-messaging`
- **Final commit:** pending
- **Owned files:** `src/components/clinician/MessagingView.tsx`, a new patient
  messaging surface, new message repository/mappers/tests. No independent changes
  to shared rules/types/storage.
- **Dependencies:** F0; R1 before rules integration/review.
- **Requirements:** persisted participant-scoped threads/messages, stable IDs,
  server timestamps, ordering/pagination, send/error/retry state, and a patient
  surface. Quick-reply templates may remain as explicit authored content. Define
  read state only if supported consistently.
- **Acceptance:** linked participants exchange messages across logout/reload;
  ordering is stable; unrelated users cannot discover/read/write the thread;
  failures do not appear sent; no placeholder conversation is shown.
- **Tests:** repository/order/auth tests, component empty/send/failure tests,
  rules integration after R1, manual two-account exchange.

### A1 — Production Appointments

- **Status:** NOT STARTED
- **Parallelizable:** implementation may start in first wave if isolated; shared
  authorization integration and E2E depend on R1
- **Branch:** `codex/mockdata-appointments`
- **Worktree:** `../neurasticity-mockdata-appointments`
- **Final commit:** pending
- **Owned files:** `src/components/clinician/ClinicalCalendarView.tsx`, a new
  patient appointment surface, new appointment repository/mappers/tests. No
  independent changes to shared rules/types/storage.
- **Dependencies:** F0; R1 before rules integration/review.
- **Requirements:** normalized appointment instants plus timezone, server-owned
  metadata, stable IDs, validation, visible persistence errors, linked-patient
  authorization, and consistent clinician/patient rendering.
- **Acceptance:** create/edit/cancel persists across sessions and appears correctly
  to both linked accounts; timezone behavior is explicit; unrelated users cannot
  access it; empty calendars contain no fabricated appointments.
- **Tests:** timezone/DST/validation and repository tests; component state tests;
  rules integration after R1; manual dual-account scheduling.

### T1 — Protocol Runtime Consumption

- **Status:** IMPLEMENTED
- **Parallelizable:** yes; first wave
- **Branch:** `codex/mockdata-protocol-runtime`
- **Worktree:** `../neurasticity-mockdata-protocol-runtime`
- **Final commit:** `8963f02a04e15943ef27df7fb884776596e3a6d8`
- **Owned files:** protocol-consumption portions of
  `src/components/patient/SessionRunner.tsx`, `src/services/adaptiveEngine.ts`, and
  `src/services/eegEngine.ts`; focused tests. Do not change the catalog or shared
  protocol schema without a coordinated request. Do not remove Demo simulation.
- **Dependencies:** F0.
- **Requirements:** resolve the persisted canonical protocol and use every
  supported clinician-entered reward min/max/threshold/duration value in the
  applicable runtime behavior; validate ranges; explicitly identify settings the
  engine cannot yet support; preserve the alias as display-only; use safe catalog
  defaults only when assignment fields are legitimately omitted.
- **Acceptance:** controlled input proves each supported setting changes the
  intended runtime calculation/timing; custom alias never changes semantics;
  headset and Demo paths consume the same assignment contract; unsupported or
  invalid configurations fail visibly/safely rather than pretending to apply.
- **Tests:** deterministic engine tests per setting and boundary; legacy assignment
  fallback; Demo/headset parity contract; manual short session with visibly
  distinct valid assignments.
- **Implementation report:** validated persisted reward range, threshold, condition,
  duration, and adaptive-step settings now drive runtime behavior; alias is
  display-only, invalid assignments block visibly, and Demo/headset acquisition
  shares the evaluator. Aggregate-band resolution is explicit; inhibit/montage/
  mapping/notes remain unsupported runtime controls. Average-band provenance is
  written only for complete consistently sourced non-Demo measurements. Focused
  tests passed 9/9, full tests passed 171/171, and the production build passed.
  Independent review is pending.

### D1 — Production/Demo Data Separation

- **Status:** NOT STARTED
- **Parallelizable:** no; begin after R1 and S1 review due to overlapping files
- **Branch:** `codex/mockdata-demo-separation`
- **Worktree:** `../neurasticity-mockdata-demo-separation`
- **Final commit:** pending
- **Owned files:** seeded-demo/reset sections of `src/services/storageEngine.ts`;
  clinician sample-entry controls/routes in login/settings/App as assigned by the
  orchestrator after R1/S1 integration; focused tests.
- **Dependencies:** reviewed R1 and S1; coordinate with M1/A1 if demo messages or
  appointments remain.
- **Requirements:** authenticated production accounts never fall back to seeded
  clients/messages/sessions/appointments; reset/wipe actions cannot target real
  tenant data from ordinary UI; if the sample clinician portal remains, isolate it
  behind an explicit non-production/demo boundary and label it. Preserve patient
  training Demo mode and developer debug simulators.
- **Acceptance:** fresh real accounts show empty production data; no sample cohort
  can leak into Firestore-backed views; production reset controls are absent or
  protected; training games still work without a headset.
- **Tests:** production-mode no-fallback tests; explicit demo-boundary tests;
  regression test for training Demo mode; manual fresh clinician/patient checks.

### I1 — Integration, Review, and Release Candidate

- **Status:** IN PROGRESS
- **Parallelizable:** no; continuous branch integration can occur after each
  review, but final validation waits for all required workstreams
- **Branch:** `fill-in-mocked-data` (integration target; no separate feature work)
- **Worktree:** repository root
- **Final commit:** pending
- **Owned files:** shared wiring and plan updates only after reviewing incoming
  branches; conflict resolution must preserve original ownership decisions.
- **Dependencies:** all applicable workstreams REVIEWED.
- **Requirements:** review diffs/commits/tests before merge; merge only into
  `fill-in-mocked-data`; update this plan after each state change; retain feature
  worktrees for follow-up; perform shared-contract changes centrally; do not merge
  to `main` without user approval.
- **Acceptance/testing:** clean install as appropriate; full unit/component suite;
  production build/typecheck/lint commands present in the repository; Firestore
  rules compilation and emulator authorization suite; dual-account manual tests
  for role persistence, linking, roster/detail/protocol, messaging, appointments,
  reports, settings, Demo and headset-equivalent save flow, empty accounts, and
  cross-tenant denial. Review browser console/network for hidden permission errors.

## Integration and review procedure

1. Reconcile Git and make sure `fill-in-mocked-data` is clean and contains F0.
2. Create every feature branch/worktree from the same recorded
   `fill-in-mocked-data` base unless its declared dependency requires a later
   reviewed commit.
3. Assign exact owned files and shared-file prohibitions. Agents commit only their
   branch and return a structured completion report.
4. Review each branch's diff, assumptions, tests, compatibility, failure states,
   and security implications before integration. Request follow-up in the same
   retained worktree when needed.
5. Merge a reviewed branch into `fill-in-mocked-data`, resolve shared wiring
   centrally, run proportionate integration tests, and update this document.
6. When a dependency lands, immediately start newly unblocked work from the new
   clean integration HEAD; do not wait for unrelated workstreams.
7. After all required work is integrated, run I1. Only then propose a merge request
   from `fill-in-mocked-data` to `main`; do not merge it without approval.

## Known risks and unresolved decisions

- The enrollment/link UI mismatch with `canManagePatient()` can cause both
  permission errors and apparently missing data; R1 must resolve it before judging
  downstream empty states.
- Firestore rules deployment is an external operation. Local code/rules changes do
  not affect the project until an authorized owner deploys them; record the exact
  project and deployed rules revision during integration.
- Current production documents may contain mixed timestamps, IDs, role/link fields,
  or protocol shapes. Mappers must be additive/tolerant and writes canonical.
- Messaging and appointments may need new collections/indexes. Their agents must
  propose coordinated schemas rather than modifying shared contracts independently.
- QEEG upload format and validated parsing requirements are not yet defined. Choose
  truthful manual entry if no authoritative format/parser is available.
- “Brain Capacity Index,” score aggregation, clinical benchmarks, and significance
  thresholds require product/clinical definitions. Absence of a definition means
  unavailable—not a guessed formula.
- Live device telemetry requires an actual stream contract; static hardware specs
  must never masquerade as live connection state.
- Protocol runtime support may be narrower than the assignment UI. Unsupported
  values must be called out rather than silently ignored.
- `fill-in-mocked-data` was published to `origin/fill-in-mocked-data` and configured
  to track it when the first implementation wave started.

## Project log

- **2026-09-19:** Handoff reconciled against Git. The integration worktree was
  clean at `fill-in-mocked-data@414f507`; `main` and `origin/main` remained at
  `8bab4b8`; the foundation history was present; no downstream worktrees or remote
  `fill-in-mocked-data` branch existed. First-wave R1, P1, and C1 started from the
  same recorded integration base, limited by the four-slot orchestration capacity.
- **2026-09-19:** Published `fill-in-mocked-data` as
  `origin/fill-in-mocked-data` and configured the local integration branch to track
  it. No change was made to `main`.
- **2026-09-19:** P1 completed at `1a632bf` and C1 completed at `c2c4fa4` plus
  `6a6a5e6`; both remained in retained clean worktrees and entered independent
  review. No shared-contract changes were requested by either workstream.
- **2026-09-19:** Corrected a non-material P1 full-hash transcription error after
  verifying the retained clean branch at `1a632bf62bf88536023ad8687444092c69703d0e`.
  R1 completed at `7dc0182` and entered independent review; rules emulator execution
  remains pending because Java is unavailable locally.
- **2026-09-19:** Independent Sol/High review returned P1 and C1 to IN PROGRESS.
  Their original agents received owned-file fixes. Cross-cutting session-read error
  propagation, brain-map persistence, and measurement provenance changes were held
  for one orchestrator-owned shared-contract implementation.
- **2026-09-19:** R1 independent security review required fixes and returned the
  workstream to IN PROGRESS. P1 completed owned review fixes at `fb2e48a`, with
  115/115 full tests passing, and entered independent re-review while awaiting the
  central session-read error contract.
- **2026-09-19:** P1 re-review cleared the metric/badge findings but found loading
  and error states still rendered some negative session evidence. P1 returned to
  IN PROGRESS for a narrow display-state fix and comprehensive display-model tests.
- **2026-09-19:** C1 completed owned review fixes at `ba9369a` and `1a36f59`, with
  121/121 full tests passing, and entered independent re-review. Its shared
  persistence/error/provenance dependencies remain reserved for central integration.
- **2026-09-19:** P1 completed the remaining evidence-state fix at `fdb5e84`, with
  13/13 focused and 120/120 full tests passing, and re-entered independent review.
- **2026-09-19:** R1 completed security review fixes at `b78fa36`, with 55/55
  focused and 127/127 full tests passing, and entered re-review. P1 review passed
  with one low export-state finding sent for repair. C1 re-review required one more
  owned fix round for stale-write removal and truthful session/QEEG legacy states.
- **2026-09-19:** P1's export-state fix at `b825919` passed independent review
  without findings. P1 merged into `fill-in-mocked-data` via `fcce66c`; integrated
  focused tests passed 14/14. The central session-read error contract remains an
  integration dependency before manual failure-state testing.
- **2026-09-19:** C2 started from the clean post-P1 integration branch as the next
  available independent first-wave workstream.
- **2026-09-19:** R1 re-review found two remaining Firestore query/keying blockers
  and returned the stream to IN PROGRESS. C1 completed its second owned fix round at
  `5fcb1bf` and `82e3e86`, with 18/18 focused and 125/125 full tests passing, then
  re-entered independent review.
- **2026-09-19:** R1 fixed the legacy list-query and claim-key blockers at
  `fe194ba`, with 58/58 focused and 130/130 full tests passing, and entered another
  independent security re-review.
- **2026-09-19:** C1 fixed its final legacy-date parser finding at `c2bc9eb`; 18/18
  focused and 125/125 full tests passed before final re-review.
- **2026-09-19:** C1 final review passed without findings and merged into
  `fill-in-mocked-data` via `c825549`; integrated focused tests passed 18/18. Its
  central append/error/provenance dependencies remain open integration work.
- **2026-09-19:** S1 started from the clean post-C1 integration branch as the next
  unblocked first-wave workstream.
- **2026-09-19:** R1 passed final independent security review and merged into
  `fill-in-mocked-data` via `bf215a8`; integrated focused tests passed 58/58. Java
  remains required for dynamic Firestore emulator validation. T1 started from the
  clean post-R1 integration branch.
- **2026-09-19:** Orchestrator-owned shared contract commit `d445528` made session
  query failures reject distinctly from successful empty reads and added append-only
  canonical QEEG persistence/loading with linked-clinician rules, server timestamps,
  actor provenance, and retained legacy reads. Focused integration tests passed
  81/81 and the production build passed; independent review is pending.
- **2026-09-19:** C2 completed at `09d2c08`, with 9/9 focused and 130/130 full
  tests passing, and entered the independent-review queue. Its session-read error
  dependency was satisfied by central commit `d445528`.
- **2026-09-19:** T1 completed at `8963f02`, with 9/9 focused and 171/171 full
  tests passing, and entered independent review. It uses the existing session
  provenance contract, so no shared type change was requested.
- **2026-09-19:** Original production-data foundation based on `905bb29` completed
  at `f97f7e1`; automated tests/build and user manual testing reported complete.
- **2026-09-19:** Foundation merged by PR #16 (`68f415f`); subsequent sync commit
  placed `fill-in-mocked-data`, `main`, and `origin/main` at `8bab4b8`.
- **2026-09-19:** User directed all remaining work to branch from and merge into
  `fill-in-mocked-data`; no remaining work may merge directly to `main` before
  integrated test/review.
- **2026-09-19:** Persistent plan created. No downstream implementation agents or
  application-code changes were made as part of this documentation task.

## NEXT ACTIONS

1. In a fresh orchestration conversation, read this file and `HANDOFF.md`, inspect
   Git/worktrees, and report any discrepancy.
2. Confirm/publish the intended remote `fill-in-mocked-data` branch if needed.
3. From the same clean current integration HEAD, launch the maximum available
   first-wave agents: **R1, P1, C1, C2, S1, and T1**. If capacity remains, launch
   isolated M1/A1 work, while keeping their authorization integration blocked on
   R1.
4. Reserve shared contracts for R1/orchestrator ownership and require structured
   completion reports instead of competing edits to this file.
5. Review and merge completed branches into `fill-in-mocked-data`, update statuses,
   and launch D1 only after R1 and S1 are reviewed.
