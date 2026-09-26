# Waveable security, data-lifecycle and E2E backlog

Generated 2026-09-25 from the E2E/Firestore security session. Local IDs (WB-*) become Jira keys on import (`jira-import.csv`). Decisions are separate issues that block their implementation tasks.

## Gates

- `merge`: Blocks merging fill-in-mocked-data
- `users`: Blocks real users / real patient data (not a merge gate by itself)
- `path`: On the agreed pre-merge path (the final audit follows it), and blocks real users
- `none`: Safe to defer; blocks neither merge nor real users
- `decision`: Decision; blocks the listed tasks until resolved

## Actionable now (no open blockers)

- WB-2 (Decision): Decision: clinician approval policy and who grants clinician access [decision]
- WB-3 (Decision): Decision: when patients must verify their email [decision]
- WB-4 (Decision): Decision: can an account change role, or be both clinician and patient? [decision]
- WB-5 (Decision): Decision: should suspending a clinician cut existing patient access immediately? [decision]
- WB-8 (Task): Rules-test fixture: verified tokens and seeded clinician grants [none]
- WB-13 (Decision): Decision: what "licence verified" means and whether patients see it [decision]
- WB-16 (Decision): Decision: care-plan ownership policies [decision]
- WB-17 (Decision): Decision: session aggregates stored on the profile or derived from sessions [decision]
- WB-21 (Decision): Decision: may patients disconnect from their clinician themselves? [decision]
- WB-22 (Decision): Decision: does a new clinician see history recorded under a previous clinician? [decision]
- WB-23 (Decision): Decision: former clinician access to records they authored [decision]
- WB-24 (Decision): Decision: account closure and retention model [decision]
- WB-29 (Task): Let an unlinked patient read their past message thread in the app [none]
- WB-31 (Task): Run the read-only data audit (user action) [merge]
- WB-35 (Decision): Decision: E2E credential architecture [decision]
- WB-36 (Task): Verify persistence through the rules as the test accounts (remove Admin reads from specs) [merge]
- WB-38 (Task): Disposable E2E accounts delete themselves via the client SDK [none]
- WB-39 (Task): Project safety net: PITR/backups, audit logs, key audit (user action) [merge]
- WB-41 (Task): Deploy the feature-branch Firestore rules (approval required) [merge]
- WB-47 (Task): RO-1: permission-error guard fixture for all Playwright specs [merge]
- WB-48 (Task): RO-2: extend the deployed-rules probe to every dashboard read [merge]
- WB-49 (Task): RO-3..RO-10: read-only acceptance scenarios [merge]
- WB-53 (Task): Update the testing skill for all test layers [none]
- WB-55 (Task): Remove dead legacy messages/appointments storage code [none]
- WB-56 (Task): Close protocolCatalog writes unless custom protocols are planned [none]
- WB-57 (Task): Clinic document size limits [none]
- WB-58 (Task): Superseded expired invitations stay "pending" [none]
- WB-59 (Task): Clinic membership cannot change after creation [none]
- WB-61 (Task): Make BrainFlow-backend Vitest tests explicit about their dependency [none]
- WB-63 (Task): Checkpoint commits for the 2026-09-25 E2E/rules/security work (approval required) [merge]

## Hierarchy

- **WB-1 Identity: email verification and clinician authorization** [path]
  - WB-2 Decision: Decision: clinician approval policy and who grants clinician access
  - WB-3 Decision: Decision: when patients must verify their email
  - WB-4 Decision: Decision: can an account change role, or be both clinician and patient?
  - WB-5 Decision: Decision: should suspending a clinician cut existing patient access immediately?
  - WB-6 Task: Require verified email for invitation read, accept and claim release (blocked by WB-3)
  - WB-7 Task: Clinician privilege from a server-owned clinicianAccess grant (blocked by WB-2, WB-4, WB-8)
  - WB-8 Task: Rules-test fixture: verified tokens and seeded clinician grants
  - WB-9 Task: Operator script to grant/suspend clinician access, and provisioning runbook (blocked by WB-2)
  - WB-10 Task: Clinician pending/suspended states in the UI (blocked by WB-7)
  - WB-11 Task: Revocation: relationship access requires an active clinician grant (blocked by WB-5, WB-7)
- **WB-12 Practitioner licence verification** [users]
  - WB-13 Decision: Decision: what "licence verified" means and whether patients see it
  - WB-14 Task: Freeze client-written credential status; show verification from the grant (blocked by WB-13, WB-7)
- **WB-15 Care-plan field ownership (patient vs clinician)** [path]
  - WB-16 Decision: Decision: care-plan ownership policies
  - WB-17 Decision: Decision: session aggregates stored on the profile or derived from sessions
  - WB-18 Task: Implement field-level care-plan ownership in rules and client (blocked by WB-16)
  - WB-19 Task: Bug: calibration resets patient status; neuro-gambit cannot be removed (blocked by WB-16)
- **WB-20 Consent, unlinking, account closure and data retention** [path]
  - WB-21 Decision: Decision: may patients disconnect from their clinician themselves?
  - WB-22 Decision: Decision: does a new clinician see history recorded under a previous clinician?
  - WB-23 Decision: Decision: former clinician access to records they authored
  - WB-24 Decision: Decision: account closure and retention model
  - WB-25 Task: Patient-initiated disconnect (rules + UI) (blocked by WB-21, WB-18)
  - WB-26 Task: Fix account closure ordering and honesty (blocked by WB-24, WB-21)
  - WB-27 Task: Implement history-visibility rules after relinking (blocked by WB-22, WB-23)
  - WB-28 Task: Closed-account marker and server-side erasure path (blocked by WB-24)
  - WB-29 Task: Let an unlinked patient read their past message thread in the app
- **WB-30 Firebase development-data audit and reset (brainwell-327dc)** [merge]
  - WB-31 Task: Run the read-only data audit (user action)
  - WB-32 Decision: Decision: wipe or migrate development data (blocked by WB-31)
  - WB-33 Task: Execute wipe/migration and recreate E2E fixtures through the app (blocked by WB-32, WB-41)
- **WB-34 E2E credential isolation and trusted cleanup** [merge]
  - WB-35 Decision: Decision: E2E credential architecture
  - WB-36 Task: Verify persistence through the rules as the test accounts (remove Admin reads from specs)
  - WB-37 Task: Implement the chosen credential architecture (blocked by WB-35)
  - WB-38 Task: Disposable E2E accounts delete themselves via the client SDK
  - WB-39 Task: Project safety net: PITR/backups, audit logs, key audit (user action)
- **WB-40 Rules deployment and stateful persistence validation** [merge]
  - WB-41 Task: Deploy the feature-branch Firestore rules (approval required)
  - WB-42 Task: Read-only validation after deployment (blocked by WB-41)
  - WB-43 Task: Provision E2E fixtures for stateful runs (blocked by WB-41)
  - WB-44 Task: First stateful run: patient Demo session in plan mode, then execute (blocked by WB-42, WB-43, WB-37)
  - WB-45 Task: Stateful clinician and fresh-account suites (blocked by WB-44)
- **WB-46 Expanded Playwright acceptance coverage** [merge]
  - WB-47 Task: RO-1: permission-error guard fixture for all Playwright specs
  - WB-48 Task: RO-2: extend the deployed-rules probe to every dashboard read
  - WB-49 Task: RO-3..RO-10: read-only acceptance scenarios
  - WB-50 Task: SF-2..SF-6: stateful scenarios using existing cleanup attribution (blocked by WB-44)
  - WB-51 Task: SF-7..SF-11: stateful scenarios needing new cleanup attribution (blocked by WB-44)
  - WB-52 Task: SF-12: account closure scenario (blocked by WB-26, WB-44)
  - WB-53 Task: Update the testing skill for all test layers
- **WB-54 Optional Firestore, data-model and legacy cleanup** [none]
  - WB-55 Task: Remove dead legacy messages/appointments storage code
  - WB-56 Task: Close protocolCatalog writes unless custom protocols are planned
  - WB-57 Task: Clinic document size limits
  - WB-58 Task: Superseded expired invitations stay "pending"
  - WB-59 Task: Clinic membership cannot change after creation
  - WB-60 Task: Pin displayed names to trusted values (blocked by WB-7)
  - WB-61 Task: Make BrainFlow-backend Vitest tests explicit about their dependency
- **WB-62 Final independent audit, acceptance run and merge of fill-in-mocked-data** [merge]
  - WB-63 Task: Checkpoint commits for the 2026-09-25 E2E/rules/security work (approval required)
  - WB-64 Task: Fresh independent whole-branch audit (blocked by WB-18, WB-6, WB-7, WB-25, WB-26, WB-45, WB-47, WB-49)
  - WB-65 Task: Fix substantive audit findings with regression tests (blocked by WB-64)
  - WB-66 Task: Final full acceptance run (blocked by WB-65)
  - WB-67 Task: Reconcile the implementation plan, open PR and merge (blocked by WB-66)

## Issues

### WB-1 — Identity: email verification and clinician authorization

- **Type:** Epic  **Priority:** Highest  **Gate:** On the agreed pre-merge path (the final audit follows it), and blocks real users
- **Labels:** security, identity

**Problem**

Identity decisions in `firestore.rules` trust client-controlled data:
- M1: invitation read/accept (`isInvitedPatient`) and the claim release trust `request.auth.token.email` without `email_verified`. Someone who registers the invited address first and obtains the code can read the invitation (patient name, condition) and take the clinician relationship.
- M2: `users/{uid}.role` is written by the client (`AuthContext.selectRole`), and `isClinician()` trusts it. Any account, including an existing patient, can become a clinician, onboard a clinic and send invitations with an arbitrary, unvalidated `clinicianName`.
- Revocation gap: relationship helpers (`isClinicMember`, `isCanonicalPatientClinician`, `isCurrentPatientClinician`) never re-check clinician status.

**Evidence**

Track A (2026-09-25): 32 draft emulator tests; 19 fail on current rules, all pass on the proposal. Pinned current behavior: `tests/firestore-rules/policy/identity-and-roles.test.ts`. No trusted server exists (no `functions/`; brainflow_service has no Admin SDK).

**Recommended architecture**

- Require `email_verified == true` wherever rules trust a token email.
- Clinician privilege from a server-written `clinicianAccess/{uid}` document (status, displayName, license), written by an operator Admin script now, Cloud Functions later (Blaze plan).
- `users.role` becomes an immutable preference, set once.
- Proposal: `docs/codex/security-backlog/proposals/track-a-identity/` (rules patches stage 1 and 2, fixture patch, grant script sketch); draft tests `tests/firestore-rules/drafts/track-A/`.

**Context**

Branch/worktree: `codex/mockdata-e2e-regression` at `../neurasticity-mockdata-e2e` (fill-in-mocked-data plus the E2E harness, rules-emulator suite and security fixes of 2026-09-25). Firebase project `brainwell-327dc` is shared and has no real users. Rules tests: `JAVA_HOME=~/.local/share/temurin-jre-21 PATH=$JAVA_HOME/bin:$PATH npm run test:rules` (emulator, demo project). Testing guidance: `.agents/skills/neurasticity-development-testing/`.

#### WB-2 — Decision: clinician approval policy and who grants clinician access

- **Type:** Decision  **Priority:** Highest  **Gate:** Decision; blocks the listed tasks until resolved
- **Labels:** decision, security, identity
- **Parent:** WB-1
- **Blocks:** WB-7, WB-9

**Question**

Must a clinician be approved before getting clinician privileges, and who approves?

**Options**

1. Manual approval: an operator grants `clinicianAccess/{uid}` with an Admin script now; an approval UI/callable later (needs Cloud Functions on Blaze).
2. Self-serve with verified email: anyone with a verified email becomes a clinician immediately; the UI labels them "unverified" everywhere patients see them.
3. Invite-only clinicians: an existing admin/clinic owner issues clinician invitations (needs trusted code too).

**Recommendation**

Option 1, operator script now. It is the only option that stops impersonation (fake "Dr A, Clinic A" invitations) without new server infrastructure, and the app has no users yet.

**Tradeoffs**

Option 2 is cheapest but leaves phishing/impersonation open (victims still have to accept, but then share PHI). Option 3 needs a trusted backend and an admin role model.

#### WB-3 — Decision: when patients must verify their email

- **Type:** Decision  **Priority:** High  **Gate:** Decision; blocks the listed tasks until resolved
- **Labels:** decision, identity
- **Parent:** WB-1
- **Blocks:** WB-6

**Question**

At signup, or only before linking to a clinician (reading/accepting an invitation)?

**Options**

1. Before linking only (non-blocking banner before that).
2. Hard gate at signup.
3. Before any clinical data leaves the device.

**Recommendation**

Option 1: it closes M1 exactly where the risk is, avoids blocking solo training, and saves email quota. Clinicians must always verify (they hold PHI).

**Tradeoffs**

Signup gating adds friction and bounce handling; option 3 is broader than the known risk.

**Notes**

After verification the client must `reload()` and `getIdToken(true)`, otherwise rules see the old token for up to an hour. Avoid `handleCodeInApp:true` without a link domain (likely why commit 6ff291d removed the earlier gate).

#### WB-4 — Decision: can an account change role, or be both clinician and patient?

- **Type:** Decision  **Priority:** Medium  **Gate:** Decision; blocks the listed tasks until resolved
- **Labels:** decision, identity
- **Parent:** WB-1
- **Blocks:** WB-7

**Options**

1. Role fixed once chosen; support changes it.
2. Switchable preference (privilege still from the grant).
3. One account may hold both roles.

**Recommendation**

Option 1. Fewest states; the privilege model does not depend on it once WB-7 lands.

#### WB-5 — Decision: should suspending a clinician cut existing patient access immediately?

- **Type:** Decision  **Priority:** Medium  **Gate:** Decision; blocks the listed tasks until resolved
- **Labels:** decision, security
- **Parent:** WB-1
- **Blocks:** WB-11

**Options**

1. Yes: relationship helpers require an active grant (Track A stage 2; one extra rules read).
2. No: suspension only blocks new actions (invitations, clinic onboarding).

**Recommendation**

Option 1, for a clinical product.

#### WB-6 — Require verified email for invitation read, accept and claim release

- **Type:** Task  **Priority:** Highest  **Gate:** On the agreed pre-merge path (the final audit follows it), and blocks real users
- **Labels:** security, identity
- **Parent:** WB-1
- **Blocked by:** WB-3
- **Blocks:** WB-64

**Scope**

- Rules: `hasVerifiedEmail()` in `isInvitedPatient`, acceptance and the patient claim delete.
- Client: `AuthContext` exposes `emailVerified`, `sendVerificationEmail()`, `refreshIdentity()`; verify banner; `storageEngine.acceptPatientInvitation` rejects unverified users with a friendly message and retries once after `getIdToken(true)` on permission-denied.
- Non-scope: clinician grants (WB-7).

**Acceptance criteria**

- An unverified token cannot read or accept an invitation or release its claim (flip the POLICY test in `policy/identity-and-roles.test.ts`).
- A verified invited patient still completes `client-transactions.test.ts` create→accept.
- E2E fixed accounts are verified in provisioning (WB-43) and `auth.setup` is re-run.

**Tests**

Rules emulator allow/deny (including missing and string-valued `email_verified`), unit tests for the AuthContext refresh path. Start from `tests/firestore-rules/drafts/track-A/identity-hardening.draft.ts`.

#### WB-7 — Clinician privilege from a server-owned clinicianAccess grant

- **Type:** Task  **Priority:** Highest  **Gate:** On the agreed pre-merge path (the final audit follows it), and blocks real users
- **Labels:** security, identity
- **Parent:** WB-1
- **Blocked by:** WB-2, WB-4, WB-8
- **Blocks:** WB-10, WB-11, WB-14, WB-60, WB-64

**Scope**

- Rules: `isClinician()` = verified email + `clinicianAccess/{uid}.status == "active"`; `clinicianAccess` readable by owner and linked patient, not listable, never client-writable; `users` fields allow-listed and `role` immutable once set; invitation `clinicianName` must equal the grant's `displayName`.
- Client: `AuthContext` loads the grant; effective role is clinician only when preference, grant and verification agree; `App.tsx` uses the grant name for invitations (`storageEngine.ts` createPatientInvitation, drop the email fallback).
- Start from `docs/codex/security-backlog/proposals/track-a-identity/trackA-rules.patch`.

**Acceptance criteria**

- A patient cannot self-promote, onboard a clinic or invite (flip the POLICY test).
- All existing emulator suites pass with the fixture patch applied (WB-8); Track A measured 104/109 before updating the 5 intended expectations it lists.
- Read-only Playwright passes after provisioning.

**Tests**

Emulator allow/deny for grant states pending/active/suspended/revoked; E2E preflight asserts the fixed clinician has an active grant.

#### WB-8 — Rules-test fixture: verified tokens and seeded clinician grants

- **Type:** Task  **Priority:** Medium  **Gate:** Safe to defer; blocks neither merge nor real users
- **Labels:** testing, identity
- **Parent:** WB-1
- **Blocks:** WB-7

**Scope**

Apply `docs/codex/security-backlog/proposals/track-a-identity/trackA-fixture.patch` to `tests/firestore-rules/fixture.ts` (tokens default to `email_verified: true`; five active `clinicianAccess` grants seeded).

**Why now**

Neutral on the current rules (Track A: 109/109 still pass), and it removes churn from WB-6/WB-7.

**Acceptance criteria**

Full rules suite still green; fixture documents the new defaults.

#### WB-9 — Operator script to grant/suspend clinician access, and provisioning runbook

- **Type:** Task  **Priority:** High  **Gate:** On the agreed pre-merge path (the final audit follows it), and blocks real users
- **Labels:** identity, ops
- **Parent:** WB-1
- **Blocked by:** WB-2

**Scope**

Harden `docs/codex/security-backlog/proposals/track-a-identity/grant-clinician.sketch.mjs` into a reviewed operator script (dry-run by default, explicit project confirmation, audit log line). Document who runs it and with which least-privilege credential (see WB-34).

**Acceptance criteria**

Script refuses without confirmation; emulator smoke test; runbook in docs.

#### WB-10 — Clinician pending/suspended states in the UI

- **Type:** Task  **Priority:** Medium  **Gate:** On the agreed pre-merge path (the final audit follows it), and blocks real users
- **Labels:** identity, ux
- **Parent:** WB-1
- **Blocked by:** WB-7

**Scope**

New `clinician-pending` state from `AuthContext`; `ClinicianPending` page with checklist (verify email, awaiting approval, "Check again"); clear suspended/revoked messages; no roster, invitations or clinic setup until active.

**Tests**

Component tests for each state; Playwright: disposable clinician lands on Pending (`e2e/account-isolation.stateful.spec.ts` needs a grant step via the harness/broker).

#### WB-11 — Revocation: relationship access requires an active clinician grant

- **Type:** Task  **Priority:** Medium  **Gate:** Blocks real users / real patient data (not a merge gate by itself)
- **Labels:** security, identity
- **Parent:** WB-1
- **Blocked by:** WB-5, WB-7

**Scope**

Track A stage 2 (`docs/codex/security-backlog/proposals/track-a-identity/trackA-rules-revocation.patch`): `isClinicMember` and `isCanonicalPatientClinician` require `isClinician()`; re-check rules read budgets.

**Tests**

`tests/firestore-rules/drafts/track-A/revocation.draft.ts` (6 tests).

### WB-12 — Practitioner licence verification

- **Type:** Epic  **Priority:** Medium  **Gate:** Blocks real users / real patient data (not a merge gate by itself)
- **Labels:** security, identity

**Problem**

M4: `practitioners/{uid}.credentials[].status` is client-written, so a practitioner can mark their own licence "verified". Rules cannot inspect list entries. Today the status is only shown to the practitioner and colleagues (`clinicSettingsState.ts`, `ClinicSettingsView.tsx`); it becomes a real vulnerability as soon as any patient-facing badge exists.

**Evidence**

Pinned: `policy/identity-and-roles.test.ts` "practitioner can mark license verified". Practitioner records are now editable only by their owner (integrated 2026-09-25).

**Context**

Branch/worktree: `codex/mockdata-e2e-regression` at `../neurasticity-mockdata-e2e` (fill-in-mocked-data plus the E2E harness, rules-emulator suite and security fixes of 2026-09-25). Firebase project `brainwell-327dc` is shared and has no real users. Rules tests: `JAVA_HOME=~/.local/share/temurin-jre-21 PATH=$JAVA_HOME/bin:$PATH npm run test:rules` (emulator, demo project). Testing guidance: `.agents/skills/neurasticity-development-testing/`.

#### WB-13 — Decision: what "licence verified" means and whether patients see it

- **Type:** Decision  **Priority:** Medium  **Gate:** Decision; blocks the listed tasks until resolved
- **Labels:** decision, identity
- **Parent:** WB-12
- **Blocks:** WB-14

**Options**

1. Operator-verified licence stored on the server grant; patients see a badge.
2. Self-reported identifier only, always labelled "self-reported"; no badge.
3. Third-party verification integration later.

**Recommendation**

Option 2 until a trusted operator process exists, then option 1 on the grant (WB-7).

#### WB-14 — Freeze client-written credential status; show verification from the grant

- **Type:** Task  **Priority:** Medium  **Gate:** Blocks real users / real patient data (not a merge gate by itself)
- **Labels:** security, identity
- **Parent:** WB-12
- **Blocked by:** WB-13, WB-7

**Scope**

- Rules: practitioner create requires `credentials == []`; updates may not change `credentials`.
- Client: `clinicSettingsRepository.saveSettings` stops writing `credentials` and writes `reportedLicenseIdentifier`; `clinicSettingsState` shows the grant's licence status only when identifiers match, otherwise "Unverified: pending review"; `storageEngine.savePractitioner` strips credentials.
- Note: Track A found that stage-1 rules reject today's `saveSettings` batch when a licence is entered, so client and rules must land together.

**Tests**

Flip the POLICY test; unit tests for `clinicSettingsState` labels.

### WB-15 — Care-plan field ownership (patient vs clinician)

- **Type:** Epic  **Priority:** High  **Gate:** On the agreed pre-merge path (the final audit follows it), and blocks real users
- **Labels:** security, data-model

**Problem**

M3: a linked patient can rewrite clinician-owned care fields in `clients/{uid}` (assignedProtocol, customProtocolConfig, customThresholdBounds, prescribedSessionsPerWeek, condition, notes, the legacy embedded brainMaps array) and forge session aggregates, in three ways: a direct update, the `createSession` merge, and invitation acceptance. Custom templates and threshold bounds drive the training engine's reward thresholds, so this is safety-relevant. Root cause: patient-side code saves the whole normalized profile (`storageEngine.saveClient`, `createSession`, `acceptPatientInvitation`).

**Evidence**

Track B: 44 draft tests, 28 fail on current rules, 44/44 pass on the proposal; full suite 105/109 on the proposal (4 tests encode the vulnerable shape). Writer map and ownership table in the Track B section of the session report.

**Proposed design**

Field-level writes checked per role with `diff().affectedKeys()`; acceptance copies the plan only from the invitation and rules verify every value; aggregates only change in the write that creates a new session. Proposal: `docs/codex/security-backlog/proposals/track-b-care-plan/` (`firestore.rules.patch`, `client.patch`); draft tests `tests/firestore-rules/drafts/track-B/field-ownership.draft.ts`.

**Context**

Branch/worktree: `codex/mockdata-e2e-regression` at `../neurasticity-mockdata-e2e` (fill-in-mocked-data plus the E2E harness, rules-emulator suite and security fixes of 2026-09-25). Firebase project `brainwell-327dc` is shared and has no real users. Rules tests: `JAVA_HOME=~/.local/share/temurin-jre-21 PATH=$JAVA_HOME/bin:$PATH npm run test:rules` (emulator, demo project). Testing guidance: `.agents/skills/neurasticity-development-testing/`.

#### WB-16 — Decision: care-plan ownership policies

- **Type:** Decision  **Priority:** High  **Gate:** Decision; blocks the listed tasks until resolved
- **Labels:** decision, data-model
- **Parent:** WB-15
- **Blocks:** WB-18, WB-19

**Questions and recommendations**

1. Can clinic colleagues edit a patient's care plan? Recommend yes (current behavior).
2. Can an unlinked patient choose their own protocol? Recommend yes, only while unlinked.
3. Can clinicians edit a linked patient's name or email? Recommend no.
4. Does accepting an invitation clear plan fields the invitation omits (and stale custom templates, previous clinician notes)? Recommend yes; keep allowedExperiences.
5. Should calibration reset status to active? Recommend no (current behavior is a bug).
6. Can a patient pause themselves? Recommend no.
7. Limits: weekly target 0-28, notes <= 10,000 characters are placeholders; confirm.
8. Should `readClientProfile` keep force-adding `neuro-gambit` (clinicians cannot remove it today)?

#### WB-17 — Decision: session aggregates stored on the profile or derived from sessions

- **Type:** Decision  **Priority:** Low  **Gate:** Decision; blocks the listed tasks until resolved
- **Labels:** decision, data-model
- **Parent:** WB-15

**Options**

1. Keep stored, constrained by rules (Track B design).
2. Derive at read time from `sessions`; drop the ledger and aggregate rules.

**Recommendation**

Option 1 now (smaller change); revisit option 2 later.

#### WB-18 — Implement field-level care-plan ownership in rules and client

- **Type:** Task  **Priority:** High  **Gate:** On the agreed pre-merge path (the final audit follows it), and blocks real users
- **Labels:** security, data-model
- **Parent:** WB-15
- **Blocked by:** WB-16
- **Blocks:** WB-25, WB-64

**Scope**

- Replace the `clients` rules block per the Track B proposal.
- Client: `buildOwnedFieldPatch`, `savePatientProfile`, `saveCarePlan`; `saveClient` demo-only; `createSession` writes only aggregates; acceptance writes only relationship + invitation plan; callers in `App.tsx`, `HardwareSetup.tsx`, `ClientRosterView.tsx`.
- Coordinate with WB-7 (identity) and WB-25 (lifecycle): all three edit the `clients` block; land one at a time and rerun the full emulator suite after each.
- Deploy order: client first (current rules accept the new narrow writes), then rules.

**Acceptance criteria**

- All 44 Track B draft tests pass; the 4 existing tests that encode the vulnerable shape are updated as listed by Track B (data-policy POLICY test inverted; session merge uses +1/prepend; acceptance copies the plan).
- Affected Vitest tests updated (storageEngine, firestoreRules.contract, HardwareSetup, ClientRosterView, AppDemoLifecycle).
- Rules expression budget checked on heavy profiles (100-entry ledger).

#### WB-19 — Bug: calibration resets patient status; neuro-gambit cannot be removed

- **Type:** Task  **Priority:** Low  **Gate:** Safe to defer; blocks neither merge nor real users
- **Labels:** bug, data-model
- **Parent:** WB-15
- **Blocked by:** WB-16

**Evidence**

- `src/pages/onboarding/HardwareSetup.tsx` (~L335-349) saves `status: "active"` with calibration, resetting a paused/completed patient.
- `dataMappers.readClientProfile` re-adds `neuro-gambit`; full saves write it back, so a clinician can never remove it.

**Acceptance criteria**

Calibration saves only `individualBaselineModel`; experience removal persists; unit tests.

### WB-20 — Consent, unlinking, account closure and data retention

- **Type:** Epic  **Priority:** High  **Gate:** On the agreed pre-merge path (the final audit follows it), and blocks real users
- **Labels:** privacy, lifecycle

**Problem**

- A linked patient cannot leave a relationship at all (rules deny it; no UI), even if the clinician disappears.
- Account deletion (`PatientShell.tsx` ~L86) deletes `users/{uid}` before the Auth account; if Auth deletion fails (`requires-recent-login`) the account is left role-less and still linked. Even on success, clients, sessions, QEEG, messages, appointments and invitations remain, and the linked clinician keeps access. The confirmation copy implies erasure.
- A new clinician inherits all prior history (including the previous clinician's notes); a former clinician loses all access, including records they authored.
- Fixed 2026-09-25: clinician unlink now cancels future appointments and pending invitations atomically, and cannot carry other profile edits.

**Evidence**

Track C: 27 draft tests (`tests/firestore-rules/drafts/track-C/lifecycle.draft.ts`), pass on both current and proposed rules; policy pins in `policy/data-policy.test.ts`. Proposal: `docs/codex/security-backlog/proposals/track-c-lifecycle/`. Treat retention questions with counsel; this is not legal advice.

**Context**

Branch/worktree: `codex/mockdata-e2e-regression` at `../neurasticity-mockdata-e2e` (fill-in-mocked-data plus the E2E harness, rules-emulator suite and security fixes of 2026-09-25). Firebase project `brainwell-327dc` is shared and has no real users. Rules tests: `JAVA_HOME=~/.local/share/temurin-jre-21 PATH=$JAVA_HOME/bin:$PATH npm run test:rules` (emulator, demo project). Testing guidance: `.agents/skills/neurasticity-development-testing/`.

#### WB-21 — Decision: may patients disconnect from their clinician themselves?

- **Type:** Decision  **Priority:** High  **Gate:** Decision; blocks the listed tasks until resolved
- **Labels:** decision, privacy
- **Parent:** WB-20
- **Blocks:** WB-25, WB-26

**Options**

1. Clinician-only unlink (today).
2. Patient may clear the four link fields (Track C `patientWithdrawsFromRelationship`).
3. Patient request plus clinician confirmation.

**Recommendation**

Option 2. Without it patients can be locked in, and account closure cannot be made safe.

#### WB-22 — Decision: does a new clinician see history recorded under a previous clinician?

- **Type:** Decision  **Priority:** Medium  **Gate:** Decision; blocks the listed tasks until resolved
- **Labels:** decision, privacy
- **Parent:** WB-20
- **Blocks:** WB-27

**Options**

1. Yes (today).
2. Only records from the link date (needs `relationshipStartedAt` and rule checks).
3. Patient opts in when accepting.

**Recommendation**

Option 3; keep today's behavior meanwhile but disclose it on the accept screen.

#### WB-23 — Decision: former clinician access to records they authored

- **Type:** Decision  **Priority:** Medium  **Gate:** Decision; blocks the listed tasks until resolved
- **Labels:** decision, privacy
- **Parent:** WB-20
- **Blocks:** WB-27

**Options**

1. Access ends completely at unlink (today).
2. Read-only access to what they authored.
3. Snapshot/export at unlink (needs server code).

**Recommendation**

Keep option 1 for now; revisit option 3 if clinicians' record-keeping duties require it.

#### WB-24 — Decision: account closure and retention model

- **Type:** Decision  **Priority:** High  **Gate:** Decision; blocks the listed tasks until resolved
- **Labels:** decision, privacy
- **Parent:** WB-20
- **Blocks:** WB-26, WB-28

**Questions**

- Soft close (Auth + own profile documents deleted, clinical records retained) vs real erasure or anonymization (needs trusted server code; rules deny client deletes of sessions/messages/appointments).
- A closed-account marker the rules honor so clinicians can no longer message or write.
- Past scheduled appointments: leave "scheduled" and show as past, or mark completed server-side.
- Pending invitations to a closed account's email: cancel on close?

**Recommendation**

Ship an honest soft close now (WB-26), then the marker, then server erasure before real users can request it.

#### WB-25 — Patient-initiated disconnect (rules + UI)

- **Type:** Task  **Priority:** High  **Gate:** On the agreed pre-merge path (the final audit follows it), and blocks real users
- **Labels:** privacy, lifecycle
- **Parent:** WB-20
- **Blocked by:** WB-21, WB-18
- **Blocks:** WB-64

**Scope**

Rules `patientWithdrawsFromRelationship()` and the orphaned-appointment cancel from `docs/codex/security-backlog/proposals/track-c-lifecycle/C-01-rules-lifecycle.patch` (rebase onto the clients block after WB-18; the patch was written against the pre-WB-18 block). UI: disconnect action with confirmation; cascade the same future-appointment/invitation cancellation the clinician unlink now does.

**Acceptance criteria**

Draft tests with `TRACK_C_PROPOSED=1` pass; profiles.test.ts title updated; a partial withdrawal and bundled edits stay denied.

#### WB-26 — Fix account closure ordering and honesty

- **Type:** Task  **Priority:** High  **Gate:** On the agreed pre-merge path (the final audit follows it), and blocks real users
- **Labels:** privacy, lifecycle, bug
- **Parent:** WB-20
- **Blocked by:** WB-24, WB-21
- **Blocks:** WB-52, WB-64

**Scope**

Start from `docs/codex/security-backlog/proposals/track-c-lifecycle/C-03-client-account-closure.patch`: re-authenticate before any write; refuse while linked (or disconnect first per WB-21); delete deviceAssignments, clients, users, then Auth; copy that does not promise erasure. Replace `window.prompt` with a proper password dialog (works in the iOS/Capacitor shell).

**Acceptance criteria**

No path leaves a role-less linked account; a failed step leaves the account usable; unit tests for each failure point; Playwright scenario in WB-52.

#### WB-27 — Implement history-visibility rules after relinking

- **Type:** Task  **Priority:** Medium  **Gate:** Blocks real users / real patient data (not a merge gate by itself)
- **Labels:** privacy, lifecycle
- **Parent:** WB-20
- **Blocked by:** WB-22, WB-23

**Scope**

Implement the chosen options for WB-22/WB-23 (for example `relationshipStartedAt`, opt-in consent recorded at acceptance) and update the POLICY tests in `policy/data-policy.test.ts`.

#### WB-28 — Closed-account marker and server-side erasure path

- **Type:** Task  **Priority:** Medium  **Gate:** Blocks real users / real patient data (not a merge gate by itself)
- **Labels:** privacy, lifecycle
- **Parent:** WB-20
- **Blocked by:** WB-24

**Scope**

Per WB-24: a closed-account marker honored by messaging/appointment rules, and a trusted erasure or anonymization job (needs server infrastructure). Also decide legacy `clientId`-based appointments, which the unlink cascade does not cancel.

#### WB-29 — Let an unlinked patient read their past message thread in the app

- **Type:** Task  **Priority:** Low  **Gate:** Safe to defer; blocks neither merge nor real users
- **Labels:** lifecycle, ux
- **Parent:** WB-20

**Evidence**

Rules already allow the patient to read their old thread; `messageRepository.resolveAuthorizedRelationship` requires an active relationship, so the app hides it.

**Scope**

Read-only history view for former relationships; sending stays disabled.

### WB-30 — Firebase development-data audit and reset (brainwell-327dc)

- **Type:** Epic  **Priority:** High  **Gate:** Blocks merging fill-in-mocked-data
- **Labels:** data, ops

**Problem**

Data written under main's permissive rules may be trusted by the new rules: clinics at arbitrary IDs and members, patient-set links, split-brain `clinicianId`/`linkedClinicianCode`, legacy appointments and messages, invitations without expiry, self-assigned roles, forged session attribution.

**Evidence**

Track D: read-only audit script `docs/codex/security-backlog/proposals/track-d-data-audit/audit-firestore-readonly.mjs` (write methods disabled and self-tested; bounded; outputs counts and paths only). Smoke-tested on a seeded emulator: 37 findings, every seeded defect detected, no personal data in output.

**Context**

Branch/worktree: `codex/mockdata-e2e-regression` at `../neurasticity-mockdata-e2e` (fill-in-mocked-data plus the E2E harness, rules-emulator suite and security fixes of 2026-09-25). Firebase project `brainwell-327dc` is shared and has no real users. Rules tests: `JAVA_HOME=~/.local/share/temurin-jre-21 PATH=$JAVA_HOME/bin:$PATH npm run test:rules` (emulator, demo project). Testing guidance: `.agents/skills/neurasticity-development-testing/`.

#### WB-31 — Run the read-only data audit (user action)

- **Type:** Task  **Priority:** High  **Gate:** Blocks merging fill-in-mocked-data
- **Labels:** data, ops
- **Parent:** WB-30
- **Blocks:** WB-32

**Steps**

Create a keyless service account with `roles/datastore.viewer` + `roles/firebaseauth.viewer`, grant yourself Token Creator on it, run the script with impersonated ADC in a throwaway `CLOUDSDK_CONFIG`, then revoke. Exact commands are in the Track D section of the session report and at the top of the script. Never use a key file; share only the anonymized JSON output.

**Acceptance criteria**

`truncated` is empty; the output is attached to WB-32.

#### WB-32 — Decision: wipe or migrate development data

- **Type:** Decision  **Priority:** High  **Gate:** Decision; blocks the listed tasks until resolved
- **Labels:** decision, data
- **Parent:** WB-30
- **Blocked by:** WB-31
- **Blocks:** WB-33

**Options**

1. Wipe and recreate fixtures through the UI.
2. Migrate in place (only viable if the audit shows DANGEROUS 0 and BREAKS 0).

**Recommendation**

Wipe, unless the audit suggests real users or irreplaceable history. Links and roles written under main's rules cannot be proven after the fact.

#### WB-33 — Execute wipe/migration and recreate E2E fixtures through the app

- **Type:** Task  **Priority:** High  **Gate:** Blocks merging fill-in-mocked-data
- **Labels:** data, ops, destructive
- **Parent:** WB-30
- **Blocked by:** WB-32, WB-41

**Scope**

Requires explicit approval and owner credentials. Order: deploy rules (WB-41) first so nothing re-pollutes the data. Recreate: sign up clinician and patient (verified email), clinician onboarding, invitation, acceptance; update `.env.e2e` UIDs if accounts are recreated; re-run `npm run test:e2e:auth`.

### WB-34 — E2E credential isolation and trusted cleanup

- **Type:** Epic  **Priority:** High  **Gate:** Blocks merging fill-in-mocked-data
- **Labels:** security, e2e

**Problem**

The stateful E2E harness (`e2e/helpers/dataLifecycle.ts`) needs Firebase Admin. Its safety gates (flags, npm-script checks, plan digests) prevent accidents but are not a boundary: any agent that can run tests can run `firebase-admin` directly with the key. Track F threat model: a project Admin key allows reading and exfiltrating all data, deleting any collection, deleting or taking over Auth users; the console's `firebase-adminsdk` account can also switch rules releases and touch Storage/Hosting.

**Done 2026-09-25**

ADC fallback removed; dedicated pinned service account required (`E2E_FIREBASE_SERVICE_ACCOUNT_EMAIL`), `firebase-adminsdk-*` refused, camelCase key aliases refused; baseline paths and run IDs validated; no user enumeration; recovery clinic cross-check.

**Context**

Branch/worktree: `codex/mockdata-e2e-regression` at `../neurasticity-mockdata-e2e` (fill-in-mocked-data plus the E2E harness, rules-emulator suite and security fixes of 2026-09-25). Firebase project `brainwell-327dc` is shared and has no real users. Rules tests: `JAVA_HOME=~/.local/share/temurin-jre-21 PATH=$JAVA_HOME/bin:$PATH npm run test:rules` (emulator, demo project). Testing guidance: `.agents/skills/neurasticity-development-testing/`.

#### WB-35 — Decision: E2E credential architecture

- **Type:** Decision  **Priority:** High  **Gate:** Decision; blocks the listed tasks until resolved
- **Labels:** decision, security, e2e
- **Parent:** WB-34
- **Blocks:** WB-37

**Options**

1. Trusted cleanup broker (Cloud Function/Cloud Run, keyless service account with `datastore.user` + custom Auth role `users.get`/`users.delete`); agents hold only test-account passwords; recovery execution is human-only. Needs Blaze for Functions.
2. Keyless dedicated service account used via short-lived impersonated tokens handed over per session.
3. A key file for a dedicated least-privilege account with the new safeguards (weakest).
Optional add-on: a named `e2e` Firestore database with a database-level IAM condition.

**Recommendation**

Option 1. It is the only option that bounds what an agent (or a prompt-injected agent, or a compromised dependency) can do.

**Tradeoffs**

Option 1 adds a deployed function and review overhead; option 2 still grants full roles for an hour; option 3 keeps a long-lived exfiltration/destroy capability on disk.

#### WB-36 — Verify persistence through the rules as the test accounts (remove Admin reads from specs)

- **Type:** Task  **Priority:** High  **Gate:** Blocks merging fill-in-mocked-data
- **Labels:** security, e2e
- **Parent:** WB-34

**Scope**

Rewrite `e2e/helpers/persistenceAssertions.ts` to read with the Firebase client SDK or Firestore REST as the test accounts (REST also returns createTime/updateTime); remove `adminFirestoreForRun`. Rules already permit every read the assertions make. Recommended by Track F regardless of the WB-35 outcome.

**Acceptance criteria**

No spec imports firebase-admin; harness unit tests and typecheck green.

#### WB-37 — Implement the chosen credential architecture

- **Type:** Task  **Priority:** High  **Gate:** Blocks merging fill-in-mocked-data
- **Labels:** security, e2e
- **Parent:** WB-34
- **Blocked by:** WB-35
- **Blocks:** WB-44

**Scope**

For the broker: move the privileged half of `dataLifecycle.ts` into `broker/` with the allow-list in deploy config; `e2e/helpers/brokerClient.ts`; keep `cleanupPlan.ts` and its unit tests; recovery execute restricted to the human identity. Also pin allow-listed UIDs/emails outside env vars (or require a human-set `e2eFixture` claim).

**Acceptance criteria**

Agents need no Google credential; harness unit tests pass; preflight works through the chosen path.

#### WB-38 — Disposable E2E accounts delete themselves via the client SDK

- **Type:** Task  **Priority:** Medium  **Gate:** Safe to defer; blocks neither merge nor real users
- **Labels:** e2e
- **Parent:** WB-34

**Scope**

`e2e/account-isolation.stateful.spec.ts` keeps passwords in memory; delete the Auth user and own `users`/`clients` docs as the account itself right after the test. Clinic/practitioner docs still need the broker (rules deny their deletion).

#### WB-39 — Project safety net: PITR/backups, audit logs, key audit (user action)

- **Type:** Task  **Priority:** High  **Gate:** Blocks merging fill-in-mocked-data
- **Labels:** ops, security
- **Parent:** WB-34

**Steps**

Enable Firestore point-in-time recovery and scheduled backups; schedule `firebase auth:export`; enable Data Access audit logs for datastore and identitytoolkit; list and remove unneeded `firebase-adminsdk` keys; confirm billing plan (needed for WB-35 option 1).

### WB-40 — Rules deployment and stateful persistence validation

- **Type:** Epic  **Priority:** Highest  **Gate:** Blocks merging fill-in-mocked-data
- **Labels:** e2e, deployment

**Background**

Live `brainwell-327dc` runs main-era rules (read-only probe `npm run test:e2e:rules` fails: the patient cannot read their own message thread or QEEG records; the clinician cannot read their own practitioner record). Feature-branch rules: 113/113 emulator tests; 51 of 109 original tests behave differently under main's rules. No stateful Playwright suite has ever run.

**Context**

Branch/worktree: `codex/mockdata-e2e-regression` at `../neurasticity-mockdata-e2e` (fill-in-mocked-data plus the E2E harness, rules-emulator suite and security fixes of 2026-09-25). Firebase project `brainwell-327dc` is shared and has no real users. Rules tests: `JAVA_HOME=~/.local/share/temurin-jre-21 PATH=$JAVA_HOME/bin:$PATH npm run test:rules` (emulator, demo project). Testing guidance: `.agents/skills/neurasticity-development-testing/`.

#### WB-41 — Deploy the feature-branch Firestore rules (approval required)

- **Type:** Task  **Priority:** Highest  **Gate:** Blocks merging fill-in-mocked-data
- **Labels:** deployment, destructive
- **Parent:** WB-40
- **Blocks:** WB-33, WB-42, WB-43

**Scope**

`npx firebase deploy --only firestore:rules --project brainwell-327dc` with explicit approval; keep main's rules for rollback. Include whichever security tasks (WB-1/15/20a) have landed. Note: a build of main's client pointed at the project loses legacy message/appointment writes.

#### WB-42 — Read-only validation after deployment

- **Type:** Task  **Priority:** Highest  **Gate:** Blocks merging fill-in-mocked-data
- **Labels:** e2e
- **Parent:** WB-40
- **Blocked by:** WB-41
- **Blocks:** WB-44

**Scope**

`npm run test:e2e:rules` (must pass), `npm run test:e2e`, `npm run test:e2e:preflight`.

#### WB-43 — Provision E2E fixtures for stateful runs

- **Type:** Task  **Priority:** High  **Gate:** Blocks merging fill-in-mocked-data
- **Labels:** e2e, ops
- **Parent:** WB-40
- **Blocked by:** WB-41
- **Blocks:** WB-44

**Scope**

Clinician completes clinic onboarding in the app (creates `clinics/{uid}` and `practitioners/{uid}`); pair linked through invitation; email verification and clinician grant if WB-6/WB-7 have landed. Preflight blockers must be empty.

#### WB-44 — First stateful run: patient Demo session in plan mode, then execute

- **Type:** Task  **Priority:** High  **Gate:** Blocks merging fill-in-mocked-data
- **Labels:** e2e
- **Parent:** WB-40
- **Blocked by:** WB-42, WB-43, WB-37
- **Blocks:** WB-45, WB-50, WB-51, WB-52

**Steps**

`npm run test:e2e:stateful:patient` (plan mode) → review the cleanup report → `E2E_CLEANUP_RUN_ID=<run> E2E_CLEANUP_MODE=plan npm run test:e2e:cleanup` → execute with `E2E_CLEANUP_PLAN_SHA=<digest>`; verification must be clean. Each destructive step needs approval.

#### WB-45 — Stateful clinician and fresh-account suites

- **Type:** Task  **Priority:** High  **Gate:** Blocks merging fill-in-mocked-data
- **Labels:** e2e
- **Parent:** WB-40
- **Blocked by:** WB-44
- **Blocks:** WB-64

**Scope**

`test:e2e:stateful:clinician` and `test:e2e:stateful:isolation`, plan first then execute.

### WB-46 — Expanded Playwright acceptance coverage

- **Type:** Epic  **Priority:** High  **Gate:** Blocks merging fill-in-mocked-data
- **Labels:** e2e, testing

**Background**

Track G coverage matrix (`docs/codex/security-backlog/proposals/track-g-coverage/coverage-matrix.md`): 74 acceptance rows; 34 fully covered (10 only by never-run stateful specs), 35 partly, 5 uncovered. Specification: `docs/codex/mock-data-removal/IMPLEMENTATION_PLAN.md` acceptance criteria. Scenario details: `docs/codex/security-backlog/proposals/track-g-coverage/e2e-additions.md`.

**Context**

Branch/worktree: `codex/mockdata-e2e-regression` at `../neurasticity-mockdata-e2e` (fill-in-mocked-data plus the E2E harness, rules-emulator suite and security fixes of 2026-09-25). Firebase project `brainwell-327dc` is shared and has no real users. Rules tests: `JAVA_HOME=~/.local/share/temurin-jre-21 PATH=$JAVA_HOME/bin:$PATH npm run test:rules` (emulator, demo project). Testing guidance: `.agents/skills/neurasticity-development-testing/`.

#### WB-47 — RO-1: permission-error guard fixture for all Playwright specs

- **Type:** Task  **Priority:** High  **Gate:** Blocks merging fill-in-mocked-data
- **Labels:** e2e
- **Parent:** WB-46
- **Blocks:** WB-64

**Scope**

Fail any spec on console or network Firestore `permission-denied` errors (I1 acceptance criteria ask for it; no spec listens today).

#### WB-48 — RO-2: extend the deployed-rules probe to every dashboard read

- **Type:** Task  **Priority:** Medium  **Gate:** Blocks merging fill-in-mocked-data
- **Labels:** e2e
- **Parent:** WB-46

**Scope**

Today `deployed-rules.readonly` probes only 4 reads.

#### WB-49 — RO-3..RO-10: read-only acceptance scenarios

- **Type:** Task  **Priority:** Medium  **Gate:** Blocks merging fill-in-mocked-data
- **Labels:** e2e
- **Parent:** WB-46
- **Blocks:** WB-64

**Scope**

Detail tabs show no fabricated values (incl. PDF export); Reports totals per range and PDF matches screen; Settings shows no false "ready" hardware state; invalid invitation code error; deep link survives login; Progress range switching and CSV row count; sample workspace absent from production login; logout/login round trip without cross-account data. Also move read-only checks out of stateful specs (telemetry Unavailable, QEEG empty state, Reports interval) so they run without Admin.

#### WB-50 — SF-2..SF-6: stateful scenarios using existing cleanup attribution

- **Type:** Task  **Priority:** Medium  **Gate:** Blocks merging fill-in-mocked-data
- **Labels:** e2e
- **Parent:** WB-46
- **Blocked by:** WB-44

**Scope**

Cancel invitation; reused-code error; fresh-clinician isolation extensions; extra persistence field checks; Demo session appears in clinician Reports.

#### WB-51 — SF-7..SF-11: stateful scenarios needing new cleanup attribution

- **Type:** Task  **Priority:** Medium  **Gate:** Blocks merging fill-in-mocked-data
- **Labels:** e2e
- **Parent:** WB-46
- **Blocked by:** WB-44

**Scope**

QEEG entry (brainMaps rule; marker in technicianNotes), protocol assignment through the UI (patient `status` restorable), unlink/relink, practitioner/clinic settings save (new restore lists), onboarding assessment on a disposable account. Each needs attribution rules in `e2e/helpers/cleanupPlan.ts` plus harness unit tests before the spec.

#### WB-52 — SF-12: account closure scenario

- **Type:** Task  **Priority:** Low  **Gate:** Blocks merging fill-in-mocked-data
- **Labels:** e2e
- **Parent:** WB-46
- **Blocked by:** WB-26, WB-44

**Scope**

After WB-26 defines behavior: closure end-to-end, including cleanup of any orphaned `clients` doc.

#### WB-53 — Update the testing skill for all test layers

- **Type:** Task  **Priority:** Medium  **Gate:** Safe to defer; blocks neither merge nor real users
- **Labels:** docs, testing
- **Parent:** WB-46

**Scope**

Apply/adapt `docs/codex/security-backlog/proposals/track-g-coverage/skill-update.patch` (applies cleanly as of 2026-09-25): table of layers (pytest, Vitest, static contract, rules emulator, read-only Playwright, stateful Playwright, hardware), decision rules, privileged persistence and credential section.

### WB-54 — Optional Firestore, data-model and legacy cleanup

- **Type:** Epic  **Priority:** Low  **Gate:** Safe to defer; blocks neither merge nor real users
- **Labels:** cleanup

**Background**

Low-severity items from Track E and the rules reviews. Integrated already: legacy invitations without expiry cannot be accepted (and the client reports them as expired); `brands` closed.

**Context**

Branch/worktree: `codex/mockdata-e2e-regression` at `../neurasticity-mockdata-e2e` (fill-in-mocked-data plus the E2E harness, rules-emulator suite and security fixes of 2026-09-25). Firebase project `brainwell-327dc` is shared and has no real users. Rules tests: `JAVA_HOME=~/.local/share/temurin-jre-21 PATH=$JAVA_HOME/bin:$PATH npm run test:rules` (emulator, demo project). Testing guidance: `.agents/skills/neurasticity-development-testing/`.

#### WB-55 — Remove dead legacy messages/appointments storage code

- **Type:** Task  **Priority:** Low  **Gate:** Safe to defer; blocks neither merge nor real users
- **Labels:** cleanup
- **Parent:** WB-54

**Scope**

`docs/codex/security-backlog/proposals/track-e-low/storageEngine-dead-code.patch` (~280 lines incl. demo seeds; only callers are two unit tests). Afterwards nothing reads `/messages`, so that rule could be closed.

#### WB-56 — Close protocolCatalog writes unless custom protocols are planned

- **Type:** Task  **Priority:** Low  **Gate:** Safe to defer; blocks neither merge nor real users
- **Labels:** cleanup, decision
- **Parent:** WB-54

**Decision inline**

The app never uses Firestore `protocolCatalog` (in-memory catalog). Close writes (`docs/codex/security-backlog/proposals/track-e-low/rules-optional.patch` + `tests-optional.patch`) unless a custom-protocol feature is planned.

#### WB-57 — Clinic document size limits

- **Type:** Task  **Priority:** Low  **Gate:** Safe to defer; blocks neither merge nor real users
- **Labels:** cleanup, security
- **Parent:** WB-54

**Scope**

`validClinicSizes` in the optional patch (name <= 120, logoUrl <= 700000, tagline <= 180). Note: a clinic that already exceeds limits could no longer be updated.

#### WB-58 — Superseded expired invitations stay "pending"

- **Type:** Task  **Priority:** Low  **Gate:** Safe to defer; blocks neither merge nor real users
- **Labels:** cleanup, ux
- **Parent:** WB-54

**Evidence**

After an expired claim is replaced, the old invitation cannot be cancelled (its claim now belongs to the new invitation). The roster hides it (`ClientRosterView` lists only pending). Pinned by `policy/data-policy.test.ts`. Needs a client change plus rule tweak if it ever matters.

#### WB-59 — Clinic membership cannot change after creation

- **Type:** Task  **Priority:** Low  **Gate:** Safe to defer; blocks neither merge nor real users
- **Labels:** product-gap
- **Parent:** WB-54

**Evidence**

`clinics.practitionerIds` is frozen; new clinics start with only the creator. Adding colleagues needs a server-side invite flow (letting clients edit the list would let an owner grant anyone clinic-wide patient access).

#### WB-60 — Pin displayed names to trusted values

- **Type:** Task  **Priority:** Low  **Gate:** Safe to defer; blocks neither merge nor real users
- **Labels:** security
- **Parent:** WB-54
- **Blocked by:** WB-7

**Scope**

Appointments `clinicianDisplayName` from the grant name; `clients.email` pinned to the token email.

#### WB-61 — Make BrainFlow-backend Vitest tests explicit about their dependency

- **Type:** Task  **Priority:** Low  **Gate:** Safe to defer; blocks neither merge nor real users
- **Labels:** testing
- **Parent:** WB-54

**Evidence**

`src/services/__tests__/backendFitE2E.test.ts` and `eegPipelineIntegration.test.ts` fail when the local BrainFlow service (127.0.0.1:8000, `npm run brainflow`) is not running and pass when it is. Make them skip with a clear message, or document the requirement.

### WB-62 — Final independent audit, acceptance run and merge of fill-in-mocked-data

- **Type:** Epic  **Priority:** Highest  **Gate:** Blocks merging fill-in-mocked-data
- **Labels:** release

**Background**

Agreed sequence: resolve known findings (security epics) and expand Playwright coverage, then a fresh independent whole-branch audit, fix its substantive findings, a full acceptance run, then merge.

**Context**

Branch/worktree: `codex/mockdata-e2e-regression` at `../neurasticity-mockdata-e2e` (fill-in-mocked-data plus the E2E harness, rules-emulator suite and security fixes of 2026-09-25). Firebase project `brainwell-327dc` is shared and has no real users. Rules tests: `JAVA_HOME=~/.local/share/temurin-jre-21 PATH=$JAVA_HOME/bin:$PATH npm run test:rules` (emulator, demo project). Testing guidance: `.agents/skills/neurasticity-development-testing/`.

#### WB-63 — Checkpoint commits for the 2026-09-25 E2E/rules/security work (approval required)

- **Type:** Task  **Priority:** High  **Gate:** Blocks merging fill-in-mocked-data
- **Labels:** release
- **Parent:** WB-62

**Scope**

Commit the currently uncommitted worktree in the proposed conceptual commits (see `docs/codex/security-backlog/README.md`). Recovery ref for the pre-session Codex state: `refs/backups/codex-e2e-2026-09-25`.

#### WB-64 — Fresh independent whole-branch audit

- **Type:** Task  **Priority:** Highest  **Gate:** Blocks merging fill-in-mocked-data
- **Labels:** release, security
- **Parent:** WB-62
- **Blocked by:** WB-18, WB-6, WB-7, WB-25, WB-26, WB-45, WB-47, WB-49
- **Blocks:** WB-65

**Scope**

An independent reviewer (fresh context) audits the whole branch against `main`: rules, client write paths, E2E harness, and the implementation plan acceptance criteria. Starts only after the known findings on the pre-merge path and the expanded Playwright coverage have landed.

#### WB-65 — Fix substantive audit findings with regression tests

- **Type:** Task  **Priority:** Highest  **Gate:** Blocks merging fill-in-mocked-data
- **Labels:** release
- **Parent:** WB-62
- **Blocked by:** WB-64
- **Blocks:** WB-66

#### WB-66 — Final full acceptance run

- **Type:** Task  **Priority:** Highest  **Gate:** Blocks merging fill-in-mocked-data
- **Labels:** release
- **Parent:** WB-62
- **Blocked by:** WB-65
- **Blocks:** WB-67

**Scope**

Rules emulator, Vitest (with the BrainFlow service running), pytest, typechecks, lint, harness, read-only and stateful Playwright (plan then execute), hardware items from the plan done manually.

#### WB-67 — Reconcile the implementation plan, open PR and merge

- **Type:** Task  **Priority:** Highest  **Gate:** Blocks merging fill-in-mocked-data
- **Labels:** release
- **Parent:** WB-62
- **Blocked by:** WB-66

**Scope**

Reconcile `IMPLEMENTATION_PLAN.md` (including the uncommitted 2026-09-25 edit in the primary `neurasticity` checkout), open the PR, merge after approval.

