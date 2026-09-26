# Coverage matrix — `fill-in-mocked-data` (+ E2 worktree harness)

Sources: `docs/codex/mock-data-removal/IMPLEMENTATION_PLAN.md` in the worktree (E2 status BLOCKED / "final re-review passed") and in the primary checkout (uncommitted, +26/-8: E2 status BLOCKED → IN PROGRESS; "Current state" rewritten for the user-approved shared-project manual-test accounts in `brainwell-327dc`; live `permission-denied` on the clinician's own `practitioners/{uid}` read; a 2026-09-25 log entry saying invitation/clinic/disposable-account cleanup is being narrowed; the Admin key is still absent. The E2 coverage-matrix table itself is unchanged in the diff). Worktree: `/home/rosscolborne/eeg_projects/neurasticity-mockdata-e2e`.

I checked coverage claims by opening the test files and by running `npx vitest run --reporter=verbose` (398 tests: 396 passed; 2 failed only because no local BrainFlow backend was running: `backendFitE2E.test.ts > checks backend health` and `eegPipelineIntegration.test.ts`). The full name list is in `names.txt` next to this file. Rules-emulator and Playwright titles come from the spec sources. None of those suites were run.

Legend: **Cov** = F (full: every clause of the criterion is asserted at some layer), P (partial), U (uncovered). "Static" means a Vitest `*.contract.test.ts` that pattern-matches source text (`firestore.rules` or `.tsx?raw`). It does not execute rules or render UI. "RO" = read-only Playwright, "SF" = stateful Playwright (written but **never executed**; it needs Admin and deployed rules). "Admin-verified" = `e2e/helpers/persistenceAssertions.ts`.

Stateful Playwright status as a caveat on every SF cell: no stateful spec has ever run. The primary-checkout plan also records that deployed rules deny a clinician reading its own `practitioners/{uid}` (`deployed-rules.readonly.spec.ts` would fail), so `stateful-clinician` and `stateful-isolation` cannot start until rules are deployed.

---

## F0 — Foundation (MERGED)

| # | Feature / acceptance (plan §F0, "Foundation conventions") | Implementation | Vitest / pytest | Rules emulator | Playwright | Persist? | Direct Firestore verification | Missing browser/E2E scenarios | Manual / hardware | Cov |
|---|---|---|---|---|---|---|---|---|---|---|
| F0.1 | Persisted account role (signup → role select → `users/{uid}.role`) | `src/contexts/AuthContext.tsx`, `pages/onboarding/*` | `AuthContextDemo.test.tsx` (role hydration races, 8 tests) | `profiles.test.ts` users/{uid}; `policy/identity-and-roles` (self-selected clinician role pinned) | SF `account-isolation` (UI signup both roles) | Y | Y: `expectDisposableRolePersisted` | Role survives logout/login (isolation only checks immediately after signup) | — | P |
| F0.2 | Tolerant legacy/current mappers | `src/services/dataMappers.ts` | `dataMappers.test.ts` (10) | n/a | none | N | n/a | none needed | — | F |
| F0.3 | Idempotent session saves, user-owned session reads | `storageEngine.ts` saveSession/getSessions | `storageEngine.test.ts` (idempotent compatibility, aggregate retry, role-aware repo) | `clinical-data.test.ts` sessions; `client-transactions` session aggregate merge | SF `patient-demo` (1 persisted Demo session) | Y | Y: `expectDemoSessionPersisted` (+ `recentCompletedSessionIds` ledger) | Double-click / retry of Save in the browser producing one doc | — | F (after SF runs) |
| F0.4 | Clinician sign-out; email-verification gate removed | `AuthContext.tsx`, `ClinicianShell.tsx` | `AuthContextDemo.test.tsx` (sign-out ordering) | `policy/identity-and-roles` (unverified email can accept invitation) | Indirect only (auth.setup logs in) | N | n/a | Clinician logout → login round trip (RO-safe) | — | P |
| F0.5 | Account deletion (patient Profile → Delete Account deletes `users/{uid}` + Auth user) | `PatientShell.tsx` `handleDeleteAccount` | none | `profiles.test.ts` (clients delete only when unlinked; users own doc) | none | Y | N | Only testable with disposable accounts; it deletes `users/` but not `clients/`, so an orphaned profile is likely (behavior gap, not only a test gap) | — | U |
| F0.6 | Password change | `components/account/ChangePasswordForm.tsx`, `passwordChange.ts` | `passwordChange.test.ts` (validation/error copy) | n/a | none | Auth | N | Disposable account only; low priority | — | P |

## R1 — Relationship integrity and enrollment (MERGED)

| # | Feature / acceptance (plan §R1) | Implementation | Vitest | Rules emulator | Playwright | Persist? | Direct Firestore verification | Missing browser/E2E scenarios | Manual | Cov |
|---|---|---|---|---|---|---|---|---|---|---|
| R1.1 | Clinician invites by email → pending invitation + uniqueness claim (atomic, no fake client) | `storageEngine.createPatientInvitation`, `ClientRosterView.tsx`, `App.tsx handleAddClient` | `storageEngine.test.ts` "creates a pending invitation…", "rejects self/duplicate", "reuses only an expired claim", collision-free claim paths; `ClientRosterView.test.tsx` "starts invitations unassigned…" | `invitations.test.ts` creation (5), claims; `client-transactions` create/accept/cancel; Static `firestoreRules.contract` | SF `care-collaboration` #1 | Y | Y: `expectInvitationAcceptedPersisted` (invitation, client, claim released) | — | — | F (after SF runs) |
| R1.2 | Discoverable patient accept flow (Home/Profile "Connect to Clinician") | `PatientShell.tsx` | Static `relationshipUi.contract` (string presence only) | `invitations.test.ts` acceptance | SF `care-collaboration` #1 | Y | Y | — | — | P→F after SF |
| R1.3 | Invitation deep link `/connect/:code` survives login and routes to patient | `App.tsx` (`waveable_pending_invitation`) | Static only (`relationshipUi.contract` "preserves invitation deep links") | n/a | none | Y | N | **Deep link logged-out → login → auto-filled accept** (never executed anywhere) | — | U (behavioral) |
| R1.4 | Both accounts see linked state after logout/login | App routing, roster | `AppDemoLifecycle.test.tsx` (account switching) | n/a | SF `care-collaboration` #1 (reload only, not logout/login) | Y | Y | True logout → login (storage state reuse skips it) | — | P |
| R1.5 | Linked patient appears only in the correct clinician's roster; unrelated clinician cannot read/write | `getClients`, rules `canManagePatient` | `storageEngine.test.ts` dedupe canonical/legacy roster, split-brain denial | `profiles.test.ts` reads/roster queries; `client-transactions` outsiders | SF `account-isolation` (UI absence + 6 direct denied reads) | Y | Y (browser-side probe as unrelated user, `firestoreProbe.probeUnrelatedClinicianReads`) | Unrelated clinician **write** attempts (only reads probed) | — | P |
| R1.6 | Expired / used / invalid / self / duplicate / already-linked / wrong-email states surfaced | `storageEngine.acceptPatientInvitation`, `PatientShell` alerts | `storageEngine.test.ts` "surfaces cancelled, expired, used, invalid, and self-acceptance states", "refuses…different account email", "turns rule-level privacy denials into…error" | `invitations.test.ts` rejects expired/other account/already linked/self | none | N (negative) | n/a | **Invalid code + reused (already-accepted) code error in the UI** (RO for invalid; SF for used) | — | P |
| R1.7 | Retries do not create duplicate links | `acceptPatientInvitation` idempotency | "returns the linked profile without writes when an accepted invitation is retried" | `policy/relationship-replay` | none | Y | — | Double-submit Accept (optional) | — | F (unit) |
| R1.8 | Cancel pending invitation releases claim | `cancelPatientInvitation`, roster "Cancel" | `storageEngine.test.ts` "atomically cancels…" | `invitations.test.ts` cancellation; `client-transactions` | none | Y | N | **Create → Cancel → pending list empty → re-invite** (cleanup: invitation attribution already exists) | — | P |
| R1.9 | Unlink (roster "Remove Patient") clears relationship without deleting profile; former clinician loses access | `unlinkPatient`, `ClientRosterView.handleDelete` | `storageEngine.test.ts` "removes a roster relationship without deleting the patient profile" | `client-transactions` unlink; `policy/data-policy` former clinician loses access; messaging "cuts former clinician" | none (SF #1 unlinks through Admin `prepareE2EPatientForInvitation`, not the UI) | Y | N | **UI unlink → both sides reflect unlinked → re-link**. The patient restore fields already cover it | — | P |
| R1.10 | Legacy link fields preserved on read (`linkedClinicianCode`, explicit-null query) | `dataMappers`, roster queries | `dataMappers.test.ts`, `storageEngine.test.ts` | `profiles.test.ts` legacy link; Static | none | N | n/a | Not practical in E2E (needs legacy seed) | Missing-field legacy rows need a trusted backfill (plan caveat) | F (lower layers) |
| R1.11 | Email normalization (case) | repo + rules `lower()` | storageEngine collision/normalized tests | `invitations` + `policy/identity` | none | — | — | Optional: invite with mixed-case email | — | F |

## P1 — Patient progress authenticity (MERGED)

| # | Feature / acceptance (plan §P1) | Implementation | Vitest | Rules | Playwright | Persist? | Direct FS | Missing E2E | Manual | Cov |
|---|---|---|---|---|---|---|---|---|---|---|
| P1.1 | New accounts show truthful empty states (no score 50, grace day, seeded garden) | `HomeScreen.tsx`, `ProgressHistory.tsx`, `patientMetrics.ts`, `dataMappers` blank profile | `patientMetrics.test.ts` (15), `dataMappers` "does not invent score, streak, or garden" | n/a | SF `account-isolation` (home "No measured sessions", Progress 0/0, Profile Unavailable) | Y | Y (role only) | Home Brain Capacity chart empty-state assertion, streak/badges locked (not asserted) | — | P |
| P1.2 | Session data changes every displayed metric predictably (streak, weekly activity, charts, totals) | `patientMetrics.ts` | patientMetrics streaks/weekly/timezone/rolling interval | n/a | RO `patient.readonly` (count only); SF `patient-demo` (count +1, All Time) | Y | Y | **Week / Month / All Time switch** with known counts; streak/weekly bars after a session | Multi-day real history | P |
| P1.3 | No fixed SVG trend; one session = point, no invented trend | `HomeScreen.tsx` | "represents one session as a point…" (model only; no mounted HomeScreen test) | n/a | none | N | n/a | Visual check of home chart after 0/1/2 sessions (low value; the model test covers the logic) | Visual review | P |
| P1.4 | Loading / error states don't render negative evidence | `ProgressHistory`, `patientMetrics` | "withholds all evidence conclusions while loading / after rejected read" | n/a | RO asserts "Session history unavailable" absent | N | n/a | Error state (would need network fault injection, e.g. `page.route` to block Firestore; optional) | — | F (unit) |
| P1.5 | Badges awarded only from real qualifying data | `patientMetrics.ts` | 3 badge tests | n/a | none | N | — | none needed | — | F |
| P1.6 | CSV export shares resolved-state boundary | `ProgressHistory.exportCSV`, `PatientShell.exportCSV` | "enables export only for resolved validated session data" (model) | n/a | none | N | — | **RO: download CSV and assert row count = session count, Demo provenance column** | — | P |
| P1.7 | Legacy/partial sessions don't crash | mappers | "does not substitute malformed or partial legacy values" | n/a | none | N | — | n/a | — | F |

## C1 — Patient detail, QEEG, telemetry (MERGED)

| # | Feature / acceptance (plan §C1) | Implementation | Vitest | Rules | Playwright | Persist? | Direct FS | Missing E2E | Manual/HW | Cov |
|---|---|---|---|---|---|---|---|---|---|---|
| C1.1 | Empty patient displays no measurements; valid zeros preserved; no `||` fallbacks | `ClientDetailView.tsx`, `clinicalDetailMetrics.ts` | `clinicalDetailMetrics.test.ts` (6) | n/a | SF `care-collaboration` #2 (QEEG empty-or-persisted only) | N | — | **RO clinician: open linked patient detail Overview, assert no fabricated band/score (Unavailable) when no measured sessions** | — | P |
| C1.2 | Manual QEEG entry: blank values, validation, persists via append, renders exactly | `BrainMapUploadModal.tsx`, `brainMapManualEntry.ts`, `storageEngine.appendBrainMap` | `brainMapManualEntry.test.ts` (15), storageEngine QEEG append/idempotent/collision | `clinical-data.test.ts` brainMaps (append, reject, immutable); `client-transactions` QEEG | none | Y | N | **SF: add a manual QEEG record → reload → values exact → patient cannot see edit controls**. Needs new cleanup rule (brainMaps) | Real QEEG file/parser (not implemented; manual entry by design) | P |
| C1.3 | Telemetry only from a real source, else "Not connected/Unavailable" | `ClientDetailView` telemetry tab | `clinicalDetailMetrics` (states) | n/a | SF `care-collaboration` #2 asserts Not connected + Unavailable | N | — | Could move to **RO** (it's read-only UI) so it runs without Admin | Live telemetry does not exist; hardware | P |
| C1.4 | Session measurement provenance (average bands only from measured non-Demo) | T1 provenance + detail | protocolRuntime "records provenance only when…", clinicalDetailMetrics "withholds band values without measured provenance" | Static sessions | none | Y | — | Detail shows "Not measured" for the Demo session (SF, can reuse patient-demo run) | Real Muse session showing measured bands | P |
| C1.5 | Malformed/partial data identified | `clinicalDetailMetrics` | yes | n/a | none | N | — | n/a | — | F |
| C1.6 | Archived session time-series / detail PDF export ("Export PDF" in detail) | `ClientDetailView.tsx` l.585 | none for this button specifically | n/a | none | N | — | RO: click Export PDF on a linked patient, assert download, no fabricated text | — | U |

## C2 — Clinical analytics and reports (MERGED)

| # | Feature / acceptance (plan §C2) | Implementation | Vitest | Rules | Playwright | Persist? | Direct FS | Missing E2E | Manual | Cov |
|---|---|---|---|---|---|---|---|---|---|---|
| C2.1 | Empty reports contain no fabricated values/claims | `ClinicalReportsView.tsx`, `clinicalReportAnalytics.ts` | analytics "returns unavailable measurements for an empty report…"; pdf "renders empty practice values as unavailable" | n/a | SF `account-isolation` (fresh clinician Reports all 0/Unavailable) | N | — | — | — | F (after SF) |
| C2.2 | Changing range changes eligible sessions and totals | analytics | "changes eligible totals when the selected range changes", interval tz tests | n/a | SF `care-collaboration` #2 (only asserts the Interval **label** changes) | N | — | **Assert totals differ between 30d / 90d / YTD for known sessions** (needs seeded dated sessions or relies on existing history; RO possible against dedicated account if history is stable) | — | P |
| C2.3 | UI and PDF agree; provenance + interval in export | `pdfReportGenerator.ts` | `pdfReportGenerator.test.ts` (5, text assertions) | n/a | none | N | — | **RO: export PDF from Reports, parse text, compare with on-screen totals/interval** | PDF visual comparison | P |
| C2.4 | Demo sessions included in aggregates with visible provenance; sample workspace separate | analytics | "includes intentional training Demo results…", "counts fictional sample-workspace activity separately" | n/a | SF isolation asserts "Training Demo Completions 0", "Sample Workspace Records 0" | N | — | After patient-demo run, clinician Reports shows Demo completion +1 (chain SF patient → clinician) | — | P |
| C2.5 | Adherence uses interval, not lifetime | analytics | "derives full aggregates, adherence…only from interval sessions" | n/a | none | N | — | none needed | — | F |
| C2.6 | Loading / error / retry distinct from empty | analytics display model | "keeps loading and rejected reads distinct…" | n/a | SF asserts loading text hidden | N | — | — | — | F (unit) |

## S1 — Clinic / practitioner settings and branding (MERGED)

| # | Feature / acceptance (plan §S1) | Implementation | Vitest | Rules | Playwright | Persist? | Direct FS | Missing E2E | Manual | Cov |
|---|---|---|---|---|---|---|---|---|---|---|
| S1.1 | Fresh clinician gets blank onboarding (no fake name/license) | `ClinicSettingsView.tsx`, `clinicSettingsRepository.ts`, `clinicSettingsState.ts` | repo "returns blank onboarding…", `clinicSettingsDisplay.test.tsx`, interactions "moves from loading to an honest empty onboarding form" | `clinics.test.ts` onboarding; Static `clinicSettingsRules.contract` | none (isolation signs up a clinician but never opens Settings) | Y | N | **Extend isolation: fresh clinician Settings shows blank form, no license, hardware copy not "ready"** (read-only within the disposable run) | — | P |
| S1.2 | Fresh clinic setup → atomic clinic + practitioner write → can invite immediately | repo `saveSettings` batch; App | repo "commits clinic and practitioner settings atomically"; `AppDemoLifecycle` "can invite immediately after completing fresh clinic setup" | `clinics.test.ts` onboarding batch; `client-transactions` | none | Y | N | **SF disposable: fresh clinician completes clinic setup → invite enabled**. Disposable cleanup already covers own `clinics`/`practitioners` (only if `practitionerIds==[uid]`) | — | P |
| S1.3 | Saved settings survive logout/reload (practitioner name, license, clinic name/timezone) | repo | repo/interactions save tests | `clinics.test.ts` practitioner freeze rules | SF `care-collaboration` #2 only re-reads existing clinic name after reload (no save) | Y | N | **SF: edit practitioner display name/license + clinic timezone → reload → persisted**. Needs new cleanup/restore rules: practitioner baseline + restorable fields; clinic `name`/`timezone` are only `whenBaselineEmpty` today | — | P |
| S1.4 | Branding persisted to clinic, applied after reload, patient sees linked clinic brand | `brandEngine.ts`, `ClinicCustomizerModal.tsx`, `App.tsx` hydration | interactions branding (9), repo contrast/validation, AppDemoLifecycle brand per account | `client-transactions` saveBrand; `clinics.test.ts` members update branding | SF `care-collaboration` #1 (save → reload → patient sees brand) | Y | Y: `expectClinicBrandPersisted` | — | Two-clinic visual isolation | F (after SF) |
| S1.5 | Another clinic cannot read settings/branding | rules | Static + repo "rejects cross-tenant clinic membership" | `clinics.test.ts` readable by practitioners/patients only | none (isolation does not probe `clinics/` or `practitioners/`) | N | — | **Add `clinics/{id}` and `practitioners/{uid}` to the unrelated-clinician probe** | — | P |
| S1.6 | Hardware never called "ready" from static copy | `ClinicSettingsView` | `clinicSettingsDisplay` "without fabricated…hardware readiness" | n/a | none | N | — | RO clinician Settings assertion (cheap) | — | P |
| S1.7 | Legacy local-settings migration (tenant-validated) | repo | "uses only validated tenant-bound migration data", interactions "migration notice" | n/a | none | Y | — | Not worth E2E | — | F |
| S1.8 | Credential status presentation (verified/legacy-invalid) | `clinicSettingsState` | several | `policy/identity-and-roles` (self-verify pinned as POLICY) | none | Y | — | — | Policy decision flagged: practitioner can mark own license verified | F (unit) |

## M1 — Production messaging (MERGED)

| # | Feature / acceptance (plan §M1) | Implementation | Vitest | Rules | Playwright | Persist? | Direct FS | Missing E2E | Manual | Cov |
|---|---|---|---|---|---|---|---|---|---|---|
| M1.1 | Linked participants exchange messages across reload | `messageRepository.ts`, `MessagingView.tsx`, `PatientMessagingView.tsx`, `useMessageConversation.ts` | messageRepository (12), mappers (4), useMessageConversation (6), messageSurfaces (2), messageUiState (3) | `messaging.test.ts` (9); `client-transactions` messaging | SF `care-collaboration` #2 | Y | Y: `expectMessagesPersisted` | — | — | F (after SF) |
| M1.2 | Stable ordering / pagination | repo | "keeps pagination ordered…", mappers ordering | messaging reading page query | SF checks presence, not order | Y | Y (sorted by text, not by time) | Order assertion (clinician msg above patient msg) — cheap addition | — | P |
| M1.3 | Unrelated users cannot discover/read/write thread | rules | Static messaging contract | messaging denies others/colleagues/anon, former clinician | SF `account-isolation` probes thread + messages reads | N | Y (probe) | Unrelated write attempt probe | — | P |
| M1.4 | Failures do not appear sent; retry stable id | `messageUiState` | yes | n/a | none | N | — | Offline send via `page.route` abort (optional) | — | F (unit) |
| M1.5 | No placeholder conversation; unlinked patient guidance | `PatientShell` `UnlinkedCareFeature` | Static `canonicalCareSurfaces.contract` | n/a | SF isolation (clinician "No linked patients…"); patient unlinked Messages not asserted | N | — | Fresh patient Messages tab shows "Connect your account…" (add to isolation) | — | P |

## A1 — Production appointments (MERGED)

| # | Feature / acceptance (plan §A1) | Implementation | Vitest | Rules | Playwright | Persist? | Direct FS | Missing E2E | Manual | Cov |
|---|---|---|---|---|---|---|---|---|---|---|
| A1.1 | Create/edit/cancel persists and appears to both accounts | `features/appointments/*`, `ClinicalCalendarView.tsx`, `PatientAppointmentsView.tsx` | appointmentRepository (12), mappers (8), viewState (4), ClinicalCalendarView (10) | `appointments.test.ts` (8), `client-transactions` | SF `care-collaboration` #3 | Y | Y: `expectAppointmentPersisted` (each step) | — | — | F (after SF) |
| A1.2 | Explicit timezone / DST behavior | `appointmentTime.ts` | appointmentTime (4), calendar DST save failure | rules validate timestamp | SF uses America/Toronto (no DST edge) | Y | partial (no `startsAt` asserted) | Assert `startsAt` instant in Admin check; optionally a DST-ambiguous time error in UI | Real timezone/DST visual | P |
| A1.3 | Unrelated users cannot access | rules | Static | appointments denies others/broad queries | SF isolation probe (read) | N | Y (probe) | — | — | F (after SF) |
| A1.4 | Empty calendars show no fabricated appointments | views | viewState/calendar empty | n/a | SF isolation (both roles) | N | — | — | — | F |
| A1.5 | Stale edit conflict (revision) | repo | "rejects stale edits…" | appointments skip revision | none | Y | — | Two-tab conflict (optional, low) | — | F (unit) |

## T1 — Protocol runtime consumption (MERGED)

| # | Feature / acceptance (plan §T1) | Implementation | Vitest | Rules | Playwright | Persist? | Direct FS | Missing E2E | Manual/HW | Cov |
|---|---|---|---|---|---|---|---|---|---|---|
| T1.1 | Each supported setting changes runtime calc/timing (range, threshold, duration, adaptive step) | `SessionRunner.tsx`, `adaptiveEngine.ts`, `eegEngine.ts` | `protocolRuntime.test.ts` (18) | n/a | none (correctly kept at lower layer) | N | — | — | Short real-device session with distinct assignments | F (unit) |
| T1.2 | Alias display-only; canonical/custom parity | `protocols.ts` | protocolRuntime parity x3, `protocols.test.ts` (8) | n/a | none | N | — | — | — | F |
| T1.3 | Invalid/unsupported configs fail visibly; limitations disclosed | runner | "blocks…", "discloses every valid-session limitation" | n/a | RO `patient.readonly` tolerates "Protocol unavailable" branch; SF patient-demo asserts "Runtime controls: canonical protocol mode" | N | — | **SF: assign a custom protocol through ProtocolBuilderModal → patient sees limitation/Protocol details reflect it** (patient restore fields already cover `customProtocolConfig`) | — | P |
| T1.4 | Clinician protocol assignment persists (ProtocolBuilderModal / roster edit) | `ProtocolBuilderModal.tsx`, `ClientRosterView` edit | `ProtocolBuilderModal.test.tsx` (1: failure stays open), ClientRosterView (5) | `profiles.test.ts` care-field updates; `policy/data-policy` patient-writable care fields | none (SF uses Admin `prepareE2EPatientForCanonicalTraining`) | Y | N | **SF: clinician changes protocol in UI → patient Protocol details shows it after reload**. Roster edit also writes `status`, which is **not** in `restorableFields.patient` → cleanup rule update needed | — | P |
| T1.5 | Demo and headset consume same assignment contract; missing non-Demo EEG never synthetic | runner, eegEngine | protocolRuntime "one canonical evaluator…", "keeps missing non-Demo EEG…"; eegDecoder "without leaking mock metrics into headset mode"; demoSessionLifecycle | n/a | SF `patient-demo` (headset gate after Demo) | N | Y (no extra session persisted) | — | Physical disconnect/stall/recovery | F (+HW) |
| T1.6 | Source freshness: stale/empty frames don't count as live EEG (browser Muse + BrainFlow) | `eegEngine.ts`, `brainflowService.ts` | eegDecoder freshness/heartbeat tests; demoSessionLifecycle stall pause; pytest `test_brainflow_pipeline.py`, `test_headset_fit*.py` | n/a | none | N | — | — | **Hardware only**: Muse BLE, BrainFlow live board | F (unit) + HW |

## D1 — Production/demo separation (MERGED)

| # | Feature / acceptance (plan §D1) | Implementation | Vitest | Rules | Playwright | Persist? | Direct FS | Missing E2E | Manual | Cov |
|---|---|---|---|---|---|---|---|---|---|---|
| D1.1 | Fresh real accounts show empty production data; no seeded fallback | `storageEngine.ts` demo sections, `clinicianDemoBoundary.ts` | storageEngine "never falls back to seeded records…", production/sample separation (14) | n/a | SF `account-isolation` | N | — | — | — | F (after SF) |
| D1.2 | Sample clinician workspace isolated/labelled; disabled in production build | `clinicianDemoBoundary.ts`, `Login.tsx` | clinicianDemoBoundary (5), Login.test (1), AuthContextDemo, AppDemoLifecycle | n/a | none | N | — | **RO public: production build/login page has no sample-workspace entry (or it is labelled fictional in dev)**; sample workspace makes no Firestore requests (network assertion) | — | P |
| D1.3 | Reset/wipe cannot target real tenant data | storageEngine | "blocks sample resets from a production account" | n/a | none | N | — | RO clinician Settings has no reset controls (cheap) | — | P |
| D1.4 | Try Demo Mode → complete → save → reload → Progress/History labeled + aggregate | runner, PostSessionSummary, ProgressHistory | demoSessionLifecycle "saves and reloads one synthetic session…", storageEngine, patientMetrics, postSessionSummary (2) | clinical-data sessions | SF `patient-demo` | Y | Y: `expectDemoSessionPersisted` | — | — | F (after SF) |
| D1.5 | Non-Demo missing EEG fails visibly, never synthetic | runner | demoSessionLifecycle (3 hardware tests), protocolRuntime | n/a | RO `patient.readonly` (headset gate); SF patient-demo (post-Demo gate, no extra doc) | N | Y | — | Physical disconnect | F (+HW) |
| D1.6 | Explicit mood / notes saved only on explicit action | `PostSessionSummary.tsx` | postSessionSummary "begins with mood unset…" | `clinical-data` note-only updates | SF patient-demo (notes + Focused mood) | Y | Partial (asserts isDemo/patientId; not mood/notes values) | Assert `mood` and `patientNotes` fields in Admin check | — | P |

## I1 — Integration cross-cutting (BLOCKED)

| # | Criterion (plan §I1) | Where | Vitest | Rules | Playwright | Persist? | Direct FS | Missing | Manual | Cov |
|---|---|---|---|---|---|---|---|---|---|---|
| I1.1 | Account-scoped state; no stale cross-account leakage | `App.tsx`, `AuthContext` | AppDemoLifecycle (9), AuthContextDemo (8) | n/a | none | N | — | Same-tab logout A → login B shows no A data (needs both creds in one context; auth-setup style) | — | P |
| I1.2 | Visible persistence errors, retryable patient profile failure | PatientShell, OnboardingFlow, HardwareSetup | patientProfileWrites (2), OnboardingFlow (1), HardwareSetup (1), AppDemoLifecycle "retryable patient-profile error" | n/a | none | — | — | Fault injection via `page.route` (optional) | — | F (unit) |
| I1.3 | Rules compile + emulator authorization suite | `firestore.rules` | Static contracts (4 files) | 109 emulator tests (never recorded as run in plan; Java 21 now documented) | `deployed-rules.readonly` (deployed ≠ branch, currently failing per plan) | — | — | Record a passing `npm run test:rules` run; `RULES_FILE` comparison against deployed/main | Rules deploy (external) | P |
| I1.4 | Review console/network for hidden permission errors | all | — | — | **none of the specs assert zero `permission-denied` console/network errors** | — | — | **Add a shared fixture that fails on `permission-denied` / FirebaseError console messages in RO + SF specs** | — | U |
| I1.5 | Onboarding assessment + hardware baseline persistence | `OnboardingFlow.tsx`, `HardwareSetup.tsx`, `NeuralImprintCard` | OnboardingFlow, HardwareSetup, onboarding.test (3) | profiles | none (auth helper skips to dashboard) | Y | N | Fresh patient onboarding assessment write (disposable) | Baseline needs headset | P |

## E2 harness (IN PROGRESS)

| # | Criterion | Where | Tests | Cov |
|---|---|---|---|---|
| E2.1 | Cleanup attribution/restore planning is correct | `e2e/helpers/cleanupPlan.ts` | `e2e/harness/cleanupPlan.test.ts` (398 lines, `npm run test:e2e:harness`, Playwright `harness-unit` project, not Vitest) | F for existing collections |
| E2.2 | Leases, baseline storage, recovery, digest-gated execute | `dataLifecycle.ts` | none offline (Admin I/O); only exercised by real stateful runs | U until first run |
| E2.3 | Deployed rules parity probe | `deployed-rules.readonly.spec.ts` | probes only 4 reads (thread, brainMaps, own role, own practitioner) | P (does not probe appointments/invitations/clinics) |

---

## Counts per workstream

| Workstream | Rows | F | P | U | Notes |
|---|---|---|---|---|---|
| F0 | 6 | 2 | 3 | 1 | account deletion untested and likely orphans `clients/` |
| R1 | 11 | 6 (2 contingent on SF) | 4 | 1 | deep link is static-only |
| P1 | 7 | 4 | 3 | 0 | range switching and CSV not in browser |
| C1 | 6 | 1 | 4 | 1 | QEEG write never exercised in browser; detail PDF button untested |
| C2 | 6 | 3 | 3 | 0 | range totals and UI/PDF agreement not in browser |
| S1 | 8 | 3 | 5 | 0 | settings save/persist never in browser; cross-tenant clinic/practitioner reads not probed |
| M1 | 5 | 2 | 3 | 0 | |
| A1 | 5 | 4 | 1 | 0 | |
| T1 | 6 | 4 | 2 | 0 | clinician protocol-assignment UI → patient never E2E |
| D1 | 6 | 3 | 3 | 0 | |
| I1 | 5 | 1 | 3 | 1 | no console/network permission-error guard |
| E2 | 3 | 1 | 1 | 1 | |
| **Total** | **74** | **34** | **35** | **5** | 10 of the "F" rows depend on stateful specs that have never run |

## Appendix: rules-only surfaces with no UI path

| Surface | Implementation | Lower-layer coverage | E2E status |
|---|---|---|---|
| `deviceAssignments/{patientId}` | `storageEngine.getDeviceAssignment` / `saveDeviceAssignment` (no component calls them; `grep` finds no UI caller) | `tests/firestore-rules/clinical-data.test.ts` `deviceAssignments/{patientId}`, `firestoreRules.contract` | None possible until a UI exists. No cleanup rule needed yet |
| `protocolCatalog/{protocolId}` | rules only; `src/services/protocolCatalog.ts` is `InMemoryProtocolCatalog` (no Firestore client reads) | `protocolCatalog.test.ts`, rules fixture seed, static slicing in contracts | None possible. No cleanup rule needed yet |
| `brands/{brandId}`, legacy `messages/{patientId}` | legacy rules blocks | static contracts / rules suite | Not app paths; no E2E |

## Top gaps

1. **No stateful spec has ever executed.** Every SF-dependent "F" is really a pending claim. Blockers are the Admin credential and the deployed-rules mismatch (`ownPractitionerRecord` denied live).
2. **Cleanup covers only** clients/thread/claim/clinic-branding/sessions(Demo)/appointments/invitations/messages. Browser coverage cannot be added for QEEG (`clients/{id}/brainMaps`), practitioner settings, clinic name/timezone, roster `status` edits, or device assignments without new attribution rules.
3. **Clinician write flows never driven through the UI:** protocol assignment/ProtocolBuilder, roster edit, unlink, cancel invitation, QEEG entry, settings save. The E2E uses Admin `prepare*` shortcuts for the relationship and protocol.
4. **Relationship negative paths** (invalid/used code, deep link through login) exist only at the unit/static layer.
5. **No automated check for hidden permission errors** in console/network (I1 acceptance explicitly asks for it).
6. **Read-only-capable checks are locked inside SF specs** (telemetry Unavailable, Reports interval, QEEG empty), so they cannot run while stateful is blocked.
7. **The rules emulator suite (109) has no recorded passing run** in the plan, and there is no `RULES_FILE` diff against deployed rules. The deployed-rules probe checks only 4 reads.
8. Hardware-only items remain manual: Muse BLE acquisition, BrainFlow live board, disconnect/stall/recovery, signal quality, headset fit, real QEEG import, live telemetry (does not exist).
