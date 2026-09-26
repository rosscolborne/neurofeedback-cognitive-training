#!/usr/bin/env python3
"""Generates the Waveable security/E2E backlog as Markdown and a Jira CSV import.

Single source of truth for docs/codex/security-backlog/BACKLOG.md and
jira-import.csv. Issue IDs (WB-*) are local; Jira assigns real keys on import.
"""
import csv
import io
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
OUT = REPO / 'docs/codex/security-backlog'
PROPOSALS = 'docs/codex/security-backlog/proposals'

GATES = {
    'merge': 'Blocks merging fill-in-mocked-data',
    'users': 'Blocks real users / real patient data (not a merge gate by itself)',
    'path': 'On the agreed pre-merge path (the final audit follows it), and blocks real users',
    'none': 'Safe to defer; blocks neither merge nor real users',
    'decision': 'Decision; blocks the listed tasks until resolved',
}

ISSUES = []


def issue(key, kind, summary, *, parent=None, gate='none', priority='Medium', labels=(), blocked_by=(), sections=()):
    ISSUES.append(dict(key=key, kind=kind, summary=summary, parent=parent, gate=gate, priority=priority,
                       labels=list(labels), blocked_by=list(blocked_by), sections=list(sections)))


COMMON = ('Context', 'Branch/worktree: `codex/mockdata-e2e-regression` at `../neurasticity-mockdata-e2e` '
          '(fill-in-mocked-data plus the E2E harness, rules-emulator suite and security fixes of 2026-09-25). '
          'Firebase project `brainwell-327dc` is shared and has no real users. Rules tests: '
          '`JAVA_HOME=~/.local/share/temurin-jre-21 PATH=$JAVA_HOME/bin:$PATH npm run test:rules` '
          '(emulator, demo project). Testing guidance: `.agents/skills/neurasticity-development-testing/`.')

# ---------------------------------------------------------------- EPIC 1
issue('WB-1', 'Epic', 'Identity: email verification and clinician authorization', gate='path', priority='Highest',
      labels=['security', 'identity'], sections=[
    ('Problem', 'Identity decisions in `firestore.rules` trust client-controlled data:\n'
     '- M1: invitation read/accept (`isInvitedPatient`) and the claim release trust `request.auth.token.email` '
     'without `email_verified`. Someone who registers the invited address first and obtains the code can read the '
     'invitation (patient name, condition) and take the clinician relationship.\n'
     '- M2: `users/{uid}.role` is written by the client (`AuthContext.selectRole`), and `isClinician()` trusts it. Any '
     'account, including an existing patient, can become a clinician, onboard a clinic and send invitations with an '
     'arbitrary, unvalidated `clinicianName`.\n'
     '- Revocation gap: relationship helpers (`isClinicMember`, `isCanonicalPatientClinician`, '
     '`isCurrentPatientClinician`) never re-check clinician status.'),
    ('Evidence', 'Track A (2026-09-25): 32 draft emulator tests; 19 fail on current rules, all pass on the proposal. '
     'Pinned current behavior: `tests/firestore-rules/policy/identity-and-roles.test.ts`. No trusted server exists '
     '(no `functions/`; brainflow_service has no Admin SDK).'),
    ('Recommended architecture', '- Require `email_verified == true` wherever rules trust a token email.\n'
     '- Clinician privilege from a server-written `clinicianAccess/{uid}` document (status, displayName, license), '
     'written by an operator Admin script now, Cloud Functions later (Blaze plan).\n'
     '- `users.role` becomes an immutable preference, set once.\n'
     f'- Proposal: `{PROPOSALS}/track-a-identity/` (rules patches stage 1 and 2, fixture patch, grant script sketch); '
     'draft tests `tests/firestore-rules/drafts/track-A/`.'),
    COMMON,
])

issue('WB-2', 'Decision', 'Decision: clinician approval policy and who grants clinician access', parent='WB-1',
      gate='decision', priority='Highest', labels=['decision', 'security', 'identity'], sections=[
    ('Question', 'Must a clinician be approved before getting clinician privileges, and who approves?'),
    ('Options', '1. Manual approval: an operator grants `clinicianAccess/{uid}` with an Admin script now; an '
     'approval UI/callable later (needs Cloud Functions on Blaze).\n'
     '2. Self-serve with verified email: anyone with a verified email becomes a clinician immediately; '
     'the UI labels them "unverified" everywhere patients see them.\n'
     '3. Invite-only clinicians: an existing admin/clinic owner issues clinician invitations (needs trusted code too).'),
    ('Recommendation', 'Option 1, operator script now. It is the only option that stops impersonation '
     '(fake "Dr A, Clinic A" invitations) without new server infrastructure, and the app has no users yet.'),
    ('Tradeoffs', 'Option 2 is cheapest but leaves phishing/impersonation open (victims still have to accept, '
     'but then share PHI). Option 3 needs a trusted backend and an admin role model.'),
])
issue('WB-3', 'Decision', 'Decision: when patients must verify their email', parent='WB-1', gate='decision',
      priority='High', labels=['decision', 'identity'], sections=[
    ('Question', 'At signup, or only before linking to a clinician (reading/accepting an invitation)?'),
    ('Options', '1. Before linking only (non-blocking banner before that).\n2. Hard gate at signup.\n'
     '3. Before any clinical data leaves the device.'),
    ('Recommendation', 'Option 1: it closes M1 exactly where the risk is, avoids blocking solo training, and saves '
     'email quota. Clinicians must always verify (they hold PHI).'),
    ('Tradeoffs', 'Signup gating adds friction and bounce handling; option 3 is broader than the known risk.'),
    ('Notes', 'After verification the client must `reload()` and `getIdToken(true)`, otherwise rules see the old '
     'token for up to an hour. Avoid `handleCodeInApp:true` without a link domain (likely why commit 6ff291d '
     'removed the earlier gate).'),
])
issue('WB-8', 'Decision', 'Decision: can an account change role, or be both clinician and patient?', parent='WB-1',
      gate='decision', priority='Medium', labels=['decision', 'identity'], sections=[
    ('Options', '1. Role fixed once chosen; support changes it.\n2. Switchable preference (privilege still from the '
     'grant).\n3. One account may hold both roles.'),
    ('Recommendation', 'Option 1. Fewest states; the privilege model does not depend on it once WB-5 lands.'),
])
issue('WB-9', 'Decision', 'Decision: should suspending a clinician cut existing patient access immediately?',
      parent='WB-1', gate='decision', priority='Medium', labels=['decision', 'security'], sections=[
    ('Options', '1. Yes: relationship helpers require an active grant (Track A stage 2; one extra rules read).\n'
     '2. No: suspension only blocks new actions (invitations, clinic onboarding).'),
    ('Recommendation', 'Option 1, for a clinical product.'),
])
issue('WB-4', 'Task', 'Require verified email for invitation read, accept and claim release', parent='WB-1',
      gate='path', priority='Highest', labels=['security', 'identity'], blocked_by=['WB-3'], sections=[
    ('Scope', '- Rules: `hasVerifiedEmail()` in `isInvitedPatient`, acceptance and the patient claim delete.\n'
     '- Client: `AuthContext` exposes `emailVerified`, `sendVerificationEmail()`, `refreshIdentity()`; verify banner; '
     '`storageEngine.acceptPatientInvitation` rejects unverified users with a friendly message and retries once after '
     '`getIdToken(true)` on permission-denied.\n'
     '- Non-scope: clinician grants (WB-5).'),
    ('Acceptance criteria', '- An unverified token cannot read or accept an invitation or release its claim '
     '(flip the POLICY test in `policy/identity-and-roles.test.ts`).\n'
     '- A verified invited patient still completes `client-transactions.test.ts` create→accept.\n'
     '- E2E fixed accounts are verified in provisioning (WB-42) and `auth.setup` is re-run.'),
    ('Tests', 'Rules emulator allow/deny (including missing and string-valued `email_verified`), unit tests for the '
     'AuthContext refresh path. Start from `tests/firestore-rules/drafts/track-A/identity-hardening.draft.ts`.'),
])
issue('WB-5', 'Task', 'Clinician privilege from a server-owned clinicianAccess grant', parent='WB-1', gate='path',
      priority='Highest', labels=['security', 'identity'], blocked_by=['WB-2', 'WB-8', 'WB-12'], sections=[
    ('Scope', '- Rules: `isClinician()` = verified email + `clinicianAccess/{uid}.status == "active"`; '
     '`clinicianAccess` readable by owner and linked patient, not listable, never client-writable; '
     '`users` fields allow-listed and `role` immutable once set; invitation `clinicianName` must equal the grant\'s '
     '`displayName`.\n'
     '- Client: `AuthContext` loads the grant; effective role is clinician only when preference, grant and '
     'verification agree; `App.tsx` uses the grant name for invitations (`storageEngine.ts` createPatientInvitation, '
     'drop the email fallback).\n'
     f'- Start from `{PROPOSALS}/track-a-identity/trackA-rules.patch`.'),
    ('Acceptance criteria', '- A patient cannot self-promote, onboard a clinic or invite (flip the POLICY test).\n'
     '- All existing emulator suites pass with the fixture patch applied (WB-12); Track A measured 104/109 before '
     'updating the 5 intended expectations it lists.\n'
     '- Read-only Playwright passes after provisioning.'),
    ('Tests', 'Emulator allow/deny for grant states pending/active/suspended/revoked; E2E preflight asserts the '
     'fixed clinician has an active grant.'),
])
issue('WB-12', 'Task', 'Rules-test fixture: verified tokens and seeded clinician grants', parent='WB-1', gate='none',
      priority='Medium', labels=['testing', 'identity'], sections=[
    ('Scope', f'Apply `{PROPOSALS}/track-a-identity/trackA-fixture.patch` to `tests/firestore-rules/fixture.ts` '
     '(tokens default to `email_verified: true`; five active `clinicianAccess` grants seeded).'),
    ('Why now', 'Neutral on the current rules (Track A: 109/109 still pass), and it removes churn from WB-4/WB-5.'),
    ('Acceptance criteria', 'Full rules suite still green; fixture documents the new defaults.'),
])
issue('WB-6', 'Task', 'Operator script to grant/suspend clinician access, and provisioning runbook', parent='WB-1',
      gate='path', priority='High', labels=['identity', 'ops'], blocked_by=['WB-2'], sections=[
    ('Scope', f'Harden `{PROPOSALS}/track-a-identity/grant-clinician.sketch.mjs` into a reviewed operator script '
     '(dry-run by default, explicit project confirmation, audit log line). Document who runs it and with which '
     'least-privilege credential (see WB-33).'),
    ('Acceptance criteria', 'Script refuses without confirmation; emulator smoke test; runbook in docs.'),
])
issue('WB-7', 'Task', 'Clinician pending/suspended states in the UI', parent='WB-1', gate='path', priority='Medium',
      labels=['identity', 'ux'], blocked_by=['WB-5'], sections=[
    ('Scope', 'New `clinician-pending` state from `AuthContext`; `ClinicianPending` page with checklist (verify email, '
     'awaiting approval, "Check again"); clear suspended/revoked messages; no roster, invitations or clinic setup '
     'until active.'),
    ('Tests', 'Component tests for each state; Playwright: disposable clinician lands on Pending '
     '(`e2e/account-isolation.stateful.spec.ts` needs a grant step via the harness/broker).'),
])
issue('WB-11', 'Task', 'Revocation: relationship access requires an active clinician grant', parent='WB-1',
      gate='users', priority='Medium', labels=['security', 'identity'], blocked_by=['WB-9', 'WB-5'], sections=[
    ('Scope', f'Track A stage 2 (`{PROPOSALS}/track-a-identity/trackA-rules-revocation.patch`): '
     '`isClinicMember` and `isCanonicalPatientClinician` require `isClinician()`; re-check rules read budgets.'),
    ('Tests', '`tests/firestore-rules/drafts/track-A/revocation.draft.ts` (6 tests).'),
])

# ---------------------------------------------------------------- EPIC 2
issue('WB-13', 'Epic', 'Practitioner licence verification', gate='users', priority='Medium',
      labels=['security', 'identity'], sections=[
    ('Problem', 'M4: `practitioners/{uid}.credentials[].status` is client-written, so a practitioner can mark their '
     'own licence "verified". Rules cannot inspect list entries. Today the status is only shown to the practitioner '
     'and colleagues (`clinicSettingsState.ts`, `ClinicSettingsView.tsx`); it becomes a real vulnerability as soon '
     'as any patient-facing badge exists.'),
    ('Evidence', 'Pinned: `policy/identity-and-roles.test.ts` "practitioner can mark license verified". '
     'Practitioner records are now editable only by their owner (integrated 2026-09-25).'),
    COMMON,
])
issue('WB-10', 'Decision', 'Decision: what "licence verified" means and whether patients see it', parent='WB-13',
      gate='decision', priority='Medium', labels=['decision', 'identity'], sections=[
    ('Options', '1. Operator-verified licence stored on the server grant; patients see a badge.\n'
     '2. Self-reported identifier only, always labelled "self-reported"; no badge.\n'
     '3. Third-party verification integration later.'),
    ('Recommendation', 'Option 2 until a trusted operator process exists, then option 1 on the grant (WB-5).'),
])
issue('WB-14', 'Task', 'Freeze client-written credential status; show verification from the grant', parent='WB-13',
      gate='users', priority='Medium', labels=['security', 'identity'], blocked_by=['WB-10', 'WB-5'], sections=[
    ('Scope', '- Rules: practitioner create requires `credentials == []`; updates may not change `credentials`.\n'
     '- Client: `clinicSettingsRepository.saveSettings` stops writing `credentials` and writes '
     '`reportedLicenseIdentifier`; `clinicSettingsState` shows the grant\'s licence status only when identifiers '
     'match, otherwise "Unverified: pending review"; `storageEngine.savePractitioner` strips credentials.\n'
     '- Note: Track A found that stage-1 rules reject today\'s `saveSettings` batch when a licence is entered, so '
     'client and rules must land together.'),
    ('Tests', 'Flip the POLICY test; unit tests for `clinicSettingsState` labels.'),
])

# ---------------------------------------------------------------- EPIC 3
issue('WB-15', 'Epic', 'Care-plan field ownership (patient vs clinician)', gate='path', priority='High',
      labels=['security', 'data-model'], sections=[
    ('Problem', 'M3: a linked patient can rewrite clinician-owned care fields in `clients/{uid}` '
     '(assignedProtocol, customProtocolConfig, customThresholdBounds, prescribedSessionsPerWeek, condition, notes, '
     'the legacy embedded brainMaps array) and forge session aggregates, in three ways: a direct update, the '
     '`createSession` merge, and invitation acceptance. Custom templates and threshold bounds drive the training '
     'engine\'s reward thresholds, so this is safety-relevant. Root cause: patient-side code saves the whole '
     'normalized profile (`storageEngine.saveClient`, `createSession`, `acceptPatientInvitation`).'),
    ('Evidence', 'Track B: 44 draft tests, 28 fail on current rules, 44/44 pass on the proposal; full suite 105/109 on '
     'the proposal (4 tests encode the vulnerable shape). Writer map and ownership table in the Track B section of '
     'the session report.'),
    ('Proposed design', f'Field-level writes checked per role with `diff().affectedKeys()`; acceptance copies the plan '
     f'only from the invitation and rules verify every value; aggregates only change in the write that creates a new '
     f'session. Proposal: `{PROPOSALS}/track-b-care-plan/` (`firestore.rules.patch`, `client.patch`); draft tests '
     '`tests/firestore-rules/drafts/track-B/field-ownership.draft.ts`.'),
    COMMON,
])
issue('WB-16', 'Decision', 'Decision: care-plan ownership policies', parent='WB-15', gate='decision', priority='High',
      labels=['decision', 'data-model'], sections=[
    ('Questions and recommendations', '1. Can clinic colleagues edit a patient\'s care plan? Recommend yes (current '
     'behavior).\n2. Can an unlinked patient choose their own protocol? Recommend yes, only while unlinked.\n'
     '3. Can clinicians edit a linked patient\'s name or email? Recommend no.\n'
     '4. Does accepting an invitation clear plan fields the invitation omits (and stale custom templates, previous '
     'clinician notes)? Recommend yes; keep allowedExperiences.\n'
     '5. Should calibration reset status to active? Recommend no (current behavior is a bug).\n'
     '6. Can a patient pause themselves? Recommend no.\n'
     '7. Limits: weekly target 0-28, notes <= 10,000 characters are placeholders; confirm.\n'
     '8. Should `readClientProfile` keep force-adding `neuro-gambit` (clinicians cannot remove it today)?'),
])
issue('WB-18', 'Decision', 'Decision: session aggregates stored on the profile or derived from sessions',
      parent='WB-15', gate='decision', priority='Low', labels=['decision', 'data-model'], sections=[
    ('Options', '1. Keep stored, constrained by rules (Track B design).\n'
     '2. Derive at read time from `sessions`; drop the ledger and aggregate rules.'),
    ('Recommendation', 'Option 1 now (smaller change); revisit option 2 later.'),
])
issue('WB-17', 'Task', 'Implement field-level care-plan ownership in rules and client', parent='WB-15', gate='path',
      priority='High', labels=['security', 'data-model'], blocked_by=['WB-16'], sections=[
    ('Scope', '- Replace the `clients` rules block per the Track B proposal.\n'
     '- Client: `buildOwnedFieldPatch`, `savePatientProfile`, `saveCarePlan`; `saveClient` demo-only; '
     '`createSession` writes only aggregates; acceptance writes only relationship + invitation plan; callers in '
     '`App.tsx`, `HardwareSetup.tsx`, `ClientRosterView.tsx`.\n'
     '- Coordinate with WB-5 (identity) and WB-21 (lifecycle): all three edit the `clients` block; land one at a time '
     'and rerun the full emulator suite after each.\n'
     '- Deploy order: client first (current rules accept the new narrow writes), then rules.'),
    ('Acceptance criteria', '- All 44 Track B draft tests pass; the 4 existing tests that encode the vulnerable '
     'shape are updated as listed by Track B (data-policy POLICY test inverted; session merge uses +1/prepend; '
     'acceptance copies the plan).\n'
     '- Affected Vitest tests updated (storageEngine, firestoreRules.contract, HardwareSetup, ClientRosterView, '
     'AppDemoLifecycle).\n- Rules expression budget checked on heavy profiles (100-entry ledger).'),
])
issue('WB-19', 'Task', 'Bug: calibration resets patient status; neuro-gambit cannot be removed', parent='WB-15',
      gate='none', priority='Low', labels=['bug', 'data-model'], blocked_by=['WB-16'], sections=[
    ('Evidence', '- `src/pages/onboarding/HardwareSetup.tsx` (~L335-349) saves `status: "active"` with calibration, '
     'resetting a paused/completed patient.\n'
     '- `dataMappers.readClientProfile` re-adds `neuro-gambit`; full saves write it back, so a clinician can never '
     'remove it.'),
    ('Acceptance criteria', 'Calibration saves only `individualBaselineModel`; experience removal persists; unit tests.'),
])

# ---------------------------------------------------------------- EPIC 4
issue('WB-20a', 'Epic', 'Consent, unlinking, account closure and data retention', gate='path', priority='High',
      labels=['privacy', 'lifecycle'], sections=[
    ('Problem', '- A linked patient cannot leave a relationship at all (rules deny it; no UI), even if the '
     'clinician disappears.\n'
     '- Account deletion (`PatientShell.tsx` ~L86) deletes `users/{uid}` before the Auth account; if Auth deletion '
     'fails (`requires-recent-login`) the account is left role-less and still linked. Even on success, clients, '
     'sessions, QEEG, messages, appointments and invitations remain, and the linked clinician keeps access. The '
     'confirmation copy implies erasure.\n'
     '- A new clinician inherits all prior history (including the previous clinician\'s notes); a former clinician '
     'loses all access, including records they authored.\n'
     '- Fixed 2026-09-25: clinician unlink now cancels future appointments and pending invitations atomically, and '
     'cannot carry other profile edits.'),
    ('Evidence', 'Track C: 27 draft tests (`tests/firestore-rules/drafts/track-C/lifecycle.draft.ts`), pass on both '
     'current and proposed rules; policy pins in `policy/data-policy.test.ts`. Proposal: '
     f'`{PROPOSALS}/track-c-lifecycle/`. Treat retention questions with counsel; this is not legal advice.'),
    COMMON,
])
issue('WB-21d', 'Decision', 'Decision: may patients disconnect from their clinician themselves?', parent='WB-20a',
      gate='decision', priority='High', labels=['decision', 'privacy'], sections=[
    ('Options', '1. Clinician-only unlink (today).\n2. Patient may clear the four link fields (Track C '
     '`patientWithdrawsFromRelationship`).\n3. Patient request plus clinician confirmation.'),
    ('Recommendation', 'Option 2. Without it patients can be locked in, and account closure cannot be made safe.'),
])
issue('WB-23d', 'Decision', 'Decision: does a new clinician see history recorded under a previous clinician?',
      parent='WB-20a', gate='decision', priority='Medium', labels=['decision', 'privacy'], sections=[
    ('Options', '1. Yes (today).\n2. Only records from the link date (needs `relationshipStartedAt` and rule checks).\n'
     '3. Patient opts in when accepting.'),
    ('Recommendation', 'Option 3; keep today\'s behavior meanwhile but disclose it on the accept screen.'),
])
issue('WB-24d', 'Decision', 'Decision: former clinician access to records they authored', parent='WB-20a',
      gate='decision', priority='Medium', labels=['decision', 'privacy'], sections=[
    ('Options', '1. Access ends completely at unlink (today).\n2. Read-only access to what they authored.\n'
     '3. Snapshot/export at unlink (needs server code).'),
    ('Recommendation', 'Keep option 1 for now; revisit option 3 if clinicians\' record-keeping duties require it.'),
])
issue('WB-26d', 'Decision', 'Decision: account closure and retention model', parent='WB-20a', gate='decision',
      priority='High', labels=['decision', 'privacy'], sections=[
    ('Questions', '- Soft close (Auth + own profile documents deleted, clinical records retained) vs real erasure or '
     'anonymization (needs trusted server code; rules deny client deletes of sessions/messages/appointments).\n'
     '- A closed-account marker the rules honor so clinicians can no longer message or write.\n'
     '- Past scheduled appointments: leave "scheduled" and show as past, or mark completed server-side.\n'
     '- Pending invitations to a closed account\'s email: cancel on close?'),
    ('Recommendation', 'Ship an honest soft close now (WB-22), then the marker, then server erasure before real users '
     'can request it.'),
])
issue('WB-21', 'Task', 'Patient-initiated disconnect (rules + UI)', parent='WB-20a', gate='path', priority='High',
      labels=['privacy', 'lifecycle'], blocked_by=['WB-21d', 'WB-17'], sections=[
    ('Scope', f'Rules `patientWithdrawsFromRelationship()` and the orphaned-appointment cancel from '
     f'`{PROPOSALS}/track-c-lifecycle/C-01-rules-lifecycle.patch` (rebase onto the clients block after WB-17; the '
     'patch was written against the pre-WB-17 block). UI: disconnect action with confirmation; cascade the same '
     'future-appointment/invitation cancellation the clinician unlink now does.'),
    ('Acceptance criteria', 'Draft tests with `TRACK_C_PROPOSED=1` pass; profiles.test.ts title updated; a partial '
     'withdrawal and bundled edits stay denied.'),
])
issue('WB-22', 'Task', 'Fix account closure ordering and honesty', parent='WB-20a', gate='path', priority='High',
      labels=['privacy', 'lifecycle', 'bug'], blocked_by=['WB-26d', 'WB-21d'], sections=[
    ('Scope', f'Start from `{PROPOSALS}/track-c-lifecycle/C-03-client-account-closure.patch`: re-authenticate before '
     'any write; refuse while linked (or disconnect first per WB-21d); delete deviceAssignments, clients, users, then '
     'Auth; copy that does not promise erasure. Replace `window.prompt` with a proper password dialog (works in '
     'the iOS/Capacitor shell).'),
    ('Acceptance criteria', 'No path leaves a role-less linked account; a failed step leaves the account usable; '
     'unit tests for each failure point; Playwright scenario in WB-35.'),
])
issue('WB-25', 'Task', 'Implement history-visibility rules after relinking', parent='WB-20a', gate='users',
      priority='Medium', labels=['privacy', 'lifecycle'], blocked_by=['WB-23d', 'WB-24d'], sections=[
    ('Scope', 'Implement the chosen options for WB-23d/WB-24d (for example `relationshipStartedAt`, opt-in consent '
     'recorded at acceptance) and update the POLICY tests in `policy/data-policy.test.ts`.'),
])
issue('WB-27', 'Task', 'Closed-account marker and server-side erasure path', parent='WB-20a', gate='users',
      priority='Medium', labels=['privacy', 'lifecycle'], blocked_by=['WB-26d'], sections=[
    ('Scope', 'Per WB-26d: a closed-account marker honored by messaging/appointment rules, and a trusted erasure or '
     'anonymization job (needs server infrastructure). Also decide legacy `clientId`-based appointments, which the '
     'unlink cascade does not cancel.'),
])
issue('WB-28', 'Task', 'Let an unlinked patient read their past message thread in the app', parent='WB-20a',
      gate='none', priority='Low', labels=['lifecycle', 'ux'], sections=[
    ('Evidence', 'Rules already allow the patient to read their old thread; '
     '`messageRepository.resolveAuthorizedRelationship` requires an active relationship, so the app hides it.'),
    ('Scope', 'Read-only history view for former relationships; sending stays disabled.'),
])

# ---------------------------------------------------------------- EPIC 5
issue('WB-29', 'Epic', 'Firebase development-data audit and reset (brainwell-327dc)', gate='merge', priority='High',
      labels=['data', 'ops'], sections=[
    ('Problem', 'Data written under main\'s permissive rules may be trusted by the new rules: clinics at arbitrary IDs '
     'and members, patient-set links, split-brain `clinicianId`/`linkedClinicianCode`, legacy appointments and '
     'messages, invitations without expiry, self-assigned roles, forged session attribution.'),
    ('Evidence', f'Track D: read-only audit script `{PROPOSALS}/track-d-data-audit/audit-firestore-readonly.mjs` '
     '(write methods disabled and self-tested; bounded; outputs counts and paths only). Smoke-tested on a seeded '
     'emulator: 37 findings, every seeded defect detected, no personal data in output.'),
    COMMON,
])
issue('WB-30', 'Task', 'Run the read-only data audit (user action)', parent='WB-29', gate='merge', priority='High',
      labels=['data', 'ops'], sections=[
    ('Steps', 'Create a keyless service account with `roles/datastore.viewer` + `roles/firebaseauth.viewer`, grant '
     'yourself Token Creator on it, run the script with impersonated ADC in a throwaway `CLOUDSDK_CONFIG`, then '
     'revoke. Exact commands are in the Track D section of the session report and at the top of the script. '
     'Never use a key file; share only the anonymized JSON output.'),
    ('Acceptance criteria', '`truncated` is empty; the output is attached to WB-31.'),
])
issue('WB-31', 'Decision', 'Decision: wipe or migrate development data', parent='WB-29', gate='decision',
      priority='High', labels=['decision', 'data'], blocked_by=['WB-30'], sections=[
    ('Options', '1. Wipe and recreate fixtures through the UI.\n2. Migrate in place (only viable if the audit shows '
     'DANGEROUS 0 and BREAKS 0).'),
    ('Recommendation', 'Wipe, unless the audit suggests real users or irreplaceable history. Links and roles written '
     'under main\'s rules cannot be proven after the fact.'),
])
issue('WB-32', 'Task', 'Execute wipe/migration and recreate E2E fixtures through the app', parent='WB-29',
      gate='merge', priority='High', labels=['data', 'ops', 'destructive'], blocked_by=['WB-31', 'WB-40'], sections=[
    ('Scope', 'Requires explicit approval and owner credentials. Order: deploy rules (WB-40) first so nothing re-pollutes '
     'the data. Recreate: sign up clinician and patient (verified email), clinician onboarding, invitation, '
     'acceptance; update `.env.e2e` UIDs if accounts are recreated; re-run `npm run test:e2e:auth`.'),
])

# ---------------------------------------------------------------- EPIC 6
issue('WB-33', 'Epic', 'E2E credential isolation and trusted cleanup', gate='merge', priority='High',
      labels=['security', 'e2e'], sections=[
    ('Problem', 'The stateful E2E harness (`e2e/helpers/dataLifecycle.ts`) needs Firebase Admin. Its safety gates '
     '(flags, npm-script checks, plan digests) prevent accidents but are not a boundary: any agent that can run '
     'tests can run `firebase-admin` directly with the key. Track F threat model: a project Admin key allows reading '
     'and exfiltrating all data, deleting any collection, deleting or taking over Auth users; the console\'s '
     '`firebase-adminsdk` account can also switch rules releases and touch Storage/Hosting.'),
    ('Done 2026-09-25', 'ADC fallback removed; dedicated pinned service account required (`E2E_FIREBASE_SERVICE_'
     'ACCOUNT_EMAIL`), `firebase-adminsdk-*` refused, camelCase key aliases refused; baseline paths and run IDs '
     'validated; no user enumeration; recovery clinic cross-check.'),
    COMMON,
])
issue('WB-34d', 'Decision', 'Decision: E2E credential architecture', parent='WB-33', gate='decision', priority='High',
      labels=['decision', 'security', 'e2e'], sections=[
    ('Options', '1. Trusted cleanup broker (Cloud Function/Cloud Run, keyless service account with `datastore.user` '
     '+ custom Auth role `users.get`/`users.delete`); agents hold only test-account passwords; recovery execution '
     'is human-only. Needs Blaze for Functions.\n'
     '2. Keyless dedicated service account used via short-lived impersonated tokens handed over per session.\n'
     '3. A key file for a dedicated least-privilege account with the new safeguards (weakest).\n'
     'Optional add-on: a named `e2e` Firestore database with a database-level IAM condition.'),
    ('Recommendation', 'Option 1. It is the only option that bounds what an agent (or a prompt-injected agent, or a '
     'compromised dependency) can do.'),
    ('Tradeoffs', 'Option 1 adds a deployed function and review overhead; option 2 still grants full roles for an '
     'hour; option 3 keeps a long-lived exfiltration/destroy capability on disk.'),
])
issue('WB-35x', 'Task', 'Verify persistence through the rules as the test accounts (remove Admin reads from specs)',
      parent='WB-33', gate='merge', priority='High', labels=['security', 'e2e'], sections=[
    ('Scope', 'Rewrite `e2e/helpers/persistenceAssertions.ts` to read with the Firebase client SDK or Firestore REST '
     'as the test accounts (REST also returns createTime/updateTime); remove `adminFirestoreForRun`. Rules already '
     'permit every read the assertions make. Recommended by Track F regardless of the WB-34d outcome.'),
    ('Acceptance criteria', 'No spec imports firebase-admin; harness unit tests and typecheck green.'),
])
issue('WB-36', 'Task', 'Implement the chosen credential architecture', parent='WB-33', gate='merge', priority='High',
      labels=['security', 'e2e'], blocked_by=['WB-34d'], sections=[
    ('Scope', 'For the broker: move the privileged half of `dataLifecycle.ts` into `broker/` with the allow-list in '
     'deploy config; `e2e/helpers/brokerClient.ts`; keep `cleanupPlan.ts` and its unit tests; recovery execute '
     'restricted to the human identity. Also pin allow-listed UIDs/emails outside env vars (or require a '
     'human-set `e2eFixture` claim).'),
    ('Acceptance criteria', 'Agents need no Google credential; harness unit tests pass; preflight works through the '
     'chosen path.'),
])
issue('WB-37', 'Task', 'Disposable E2E accounts delete themselves via the client SDK', parent='WB-33', gate='none',
      priority='Medium', labels=['e2e'], sections=[
    ('Scope', '`e2e/account-isolation.stateful.spec.ts` keeps passwords in memory; delete the Auth user and own '
     '`users`/`clients` docs as the account itself right after the test. Clinic/practitioner docs still need the '
     'broker (rules deny their deletion).'),
])
issue('WB-38', 'Task', 'Project safety net: PITR/backups, audit logs, key audit (user action)', parent='WB-33',
      gate='merge', priority='High', labels=['ops', 'security'], sections=[
    ('Steps', 'Enable Firestore point-in-time recovery and scheduled backups; schedule `firebase auth:export`; enable '
     'Data Access audit logs for datastore and identitytoolkit; list and remove unneeded `firebase-adminsdk` keys; '
     'confirm billing plan (needed for WB-34d option 1).'),
])

# ---------------------------------------------------------------- EPIC 7
issue('WB-39', 'Epic', 'Rules deployment and stateful persistence validation', gate='merge', priority='Highest',
      labels=['e2e', 'deployment'], sections=[
    ('Background', 'Live `brainwell-327dc` runs main-era rules (read-only probe `npm run test:e2e:rules` fails: the '
     'patient cannot read their own message thread or QEEG records; the clinician cannot read their own practitioner '
     'record). Feature-branch rules: 113/113 emulator tests; 51 of 109 original tests behave differently under '
     'main\'s rules. No stateful Playwright suite has ever run.'),
    COMMON,
])
issue('WB-40', 'Task', 'Deploy the feature-branch Firestore rules (approval required)', parent='WB-39', gate='merge',
      priority='Highest', labels=['deployment', 'destructive'], sections=[
    ('Scope', '`npx firebase deploy --only firestore:rules --project brainwell-327dc` with explicit approval; keep '
     'main\'s rules for rollback. Include whichever security tasks (WB-1/15/20a) have landed. Note: a build of '
     'main\'s client pointed at the project loses legacy message/appointment writes.'),
])
issue('WB-41', 'Task', 'Read-only validation after deployment', parent='WB-39', gate='merge', priority='Highest',
      labels=['e2e'], blocked_by=['WB-40'], sections=[
    ('Scope', '`npm run test:e2e:rules` (must pass), `npm run test:e2e`, `npm run test:e2e:preflight`.'),
])
issue('WB-42', 'Task', 'Provision E2E fixtures for stateful runs', parent='WB-39', gate='merge', priority='High',
      labels=['e2e', 'ops'], blocked_by=['WB-40'], sections=[
    ('Scope', 'Clinician completes clinic onboarding in the app (creates `clinics/{uid}` and `practitioners/{uid}`); '
     'pair linked through invitation; email verification and clinician grant if WB-4/WB-5 have landed. Preflight '
     'blockers must be empty.'),
])
issue('WB-43', 'Task', 'First stateful run: patient Demo session in plan mode, then execute', parent='WB-39',
      gate='merge', priority='High', labels=['e2e'], blocked_by=['WB-41', 'WB-42', 'WB-36'], sections=[
    ('Steps', '`npm run test:e2e:stateful:patient` (plan mode) → review the cleanup report → '
     '`E2E_CLEANUP_RUN_ID=<run> E2E_CLEANUP_MODE=plan npm run test:e2e:cleanup` → execute with '
     '`E2E_CLEANUP_PLAN_SHA=<digest>`; verification must be clean. Each destructive step needs approval.'),
])
issue('WB-44', 'Task', 'Stateful clinician and fresh-account suites', parent='WB-39', gate='merge', priority='High',
      labels=['e2e'], blocked_by=['WB-43'], sections=[
    ('Scope', '`test:e2e:stateful:clinician` and `test:e2e:stateful:isolation`, plan first then execute.'),
])

# ---------------------------------------------------------------- EPIC 8
issue('WB-45', 'Epic', 'Expanded Playwright acceptance coverage', gate='merge', priority='High',
      labels=['e2e', 'testing'], sections=[
    ('Background', f'Track G coverage matrix (`{PROPOSALS}/track-g-coverage/coverage-matrix.md`): 74 acceptance rows; '
     '34 fully covered (10 only by never-run stateful specs), 35 partly, 5 uncovered. Specification: '
     '`docs/codex/mock-data-removal/IMPLEMENTATION_PLAN.md` acceptance criteria. Scenario details: '
     f'`{PROPOSALS}/track-g-coverage/e2e-additions.md`.'),
    COMMON,
])
issue('WB-46', 'Task', 'RO-1: permission-error guard fixture for all Playwright specs', parent='WB-45', gate='merge',
      priority='High', labels=['e2e'], sections=[
    ('Scope', 'Fail any spec on console or network Firestore `permission-denied` errors (I1 acceptance criteria ask '
     'for it; no spec listens today).'),
])
issue('WB-47', 'Task', 'RO-2: extend the deployed-rules probe to every dashboard read', parent='WB-45', gate='merge',
      priority='Medium', labels=['e2e'], sections=[('Scope', 'Today `deployed-rules.readonly` probes only 4 reads.')])
issue('WB-48', 'Task', 'RO-3..RO-10: read-only acceptance scenarios', parent='WB-45', gate='merge', priority='Medium',
      labels=['e2e'], sections=[
    ('Scope', 'Detail tabs show no fabricated values (incl. PDF export); Reports totals per range and PDF matches '
     'screen; Settings shows no false "ready" hardware state; invalid invitation code error; deep link survives '
     'login; Progress range switching and CSV row count; sample workspace absent from production login; '
     'logout/login round trip without cross-account data. Also move read-only checks out of stateful specs '
     '(telemetry Unavailable, QEEG empty state, Reports interval) so they run without Admin.'),
])
issue('WB-49', 'Task', 'SF-2..SF-6: stateful scenarios using existing cleanup attribution', parent='WB-45',
      gate='merge', priority='Medium', labels=['e2e'], blocked_by=['WB-43'], sections=[
    ('Scope', 'Cancel invitation; reused-code error; fresh-clinician isolation extensions; extra persistence field '
     'checks; Demo session appears in clinician Reports.'),
])
issue('WB-50', 'Task', 'SF-7..SF-11: stateful scenarios needing new cleanup attribution', parent='WB-45',
      gate='merge', priority='Medium', labels=['e2e'], blocked_by=['WB-43'], sections=[
    ('Scope', 'QEEG entry (brainMaps rule; marker in technicianNotes), protocol assignment through the UI (patient '
     '`status` restorable), unlink/relink, practitioner/clinic settings save (new restore lists), onboarding '
     'assessment on a disposable account. Each needs attribution rules in `e2e/helpers/cleanupPlan.ts` plus harness '
     'unit tests before the spec.'),
])
issue('WB-35', 'Task', 'SF-12: account closure scenario', parent='WB-45', gate='merge', priority='Low',
      labels=['e2e'], blocked_by=['WB-22', 'WB-43'], sections=[
    ('Scope', 'After WB-22 defines behavior: closure end-to-end, including cleanup of any orphaned `clients` doc.'),
])
issue('WB-51', 'Task', 'Update the testing skill for all test layers', parent='WB-45', gate='none', priority='Medium',
      labels=['docs', 'testing'], sections=[
    ('Scope', f'Apply/adapt `{PROPOSALS}/track-g-coverage/skill-update.patch` (applies cleanly as of 2026-09-25): '
     'table of layers (pytest, Vitest, static contract, rules emulator, read-only Playwright, stateful Playwright, '
     'hardware), decision rules, privileged persistence and credential section.'),
])

# ---------------------------------------------------------------- EPIC 9
issue('WB-52', 'Epic', 'Optional Firestore, data-model and legacy cleanup', gate='none', priority='Low',
      labels=['cleanup'], sections=[
    ('Background', 'Low-severity items from Track E and the rules reviews. Integrated already: legacy invitations '
     'without expiry cannot be accepted (and the client reports them as expired); `brands` closed.'),
    COMMON,
])
issue('WB-53', 'Task', 'Remove dead legacy messages/appointments storage code', parent='WB-52', gate='none',
      priority='Low', labels=['cleanup'], sections=[
    ('Scope', f'`{PROPOSALS}/track-e-low/storageEngine-dead-code.patch` (~280 lines incl. demo seeds; only callers '
     'are two unit tests). Afterwards nothing reads `/messages`, so that rule could be closed.'),
])
issue('WB-54', 'Task', 'Close protocolCatalog writes unless custom protocols are planned', parent='WB-52',
      gate='none', priority='Low', labels=['cleanup', 'decision'], sections=[
    ('Decision inline', 'The app never uses Firestore `protocolCatalog` (in-memory catalog). Close writes '
     f'(`{PROPOSALS}/track-e-low/rules-optional.patch` + `tests-optional.patch`) unless a custom-protocol feature '
     'is planned.'),
])
issue('WB-55', 'Task', 'Clinic document size limits', parent='WB-52', gate='none', priority='Low',
      labels=['cleanup', 'security'], sections=[
    ('Scope', '`validClinicSizes` in the optional patch (name <= 120, logoUrl <= 700000, tagline <= 180). Note: a '
     'clinic that already exceeds limits could no longer be updated.'),
])
issue('WB-56', 'Task', 'Superseded expired invitations stay "pending"', parent='WB-52', gate='none', priority='Low',
      labels=['cleanup', 'ux'], sections=[
    ('Evidence', 'After an expired claim is replaced, the old invitation cannot be cancelled (its claim now belongs '
     'to the new invitation). The roster hides it (`ClientRosterView` lists only pending). Pinned by '
     '`policy/data-policy.test.ts`. Needs a client change plus rule tweak if it ever matters.'),
])
issue('WB-57', 'Task', 'Clinic membership cannot change after creation', parent='WB-52', gate='none', priority='Low',
      labels=['product-gap'], sections=[
    ('Evidence', '`clinics.practitionerIds` is frozen; new clinics start with only the creator. Adding colleagues '
     'needs a server-side invite flow (letting clients edit the list would let an owner grant anyone clinic-wide '
     'patient access).'),
])
issue('WB-58', 'Task', 'Pin displayed names to trusted values', parent='WB-52', gate='none', priority='Low',
      labels=['security'], blocked_by=['WB-5'], sections=[
    ('Scope', 'Appointments `clinicianDisplayName` from the grant name; `clients.email` pinned to the token email.'),
])
issue('WB-59', 'Task', 'Make BrainFlow-backend Vitest tests explicit about their dependency', parent='WB-52',
      gate='none', priority='Low', labels=['testing'], sections=[
    ('Evidence', '`src/services/__tests__/backendFitE2E.test.ts` and `eegPipelineIntegration.test.ts` fail when the '
     'local BrainFlow service (127.0.0.1:8000, `npm run brainflow`) is not running and pass when it is. Make them '
     'skip with a clear message, or document the requirement.'),
])

# ---------------------------------------------------------------- EPIC 10
issue('WB-60', 'Epic', 'Final independent audit, acceptance run and merge of fill-in-mocked-data', gate='merge',
      priority='Highest', labels=['release'], sections=[
    ('Background', 'Agreed sequence: resolve known findings (security epics) and expand Playwright coverage, then a '
     'fresh independent whole-branch audit, fix its substantive findings, a full acceptance run, then merge.'),
    COMMON,
])
issue('WB-61', 'Task', 'Checkpoint commits for the 2026-09-25 E2E/rules/security work (approval required)',
      parent='WB-60', gate='merge', priority='High', labels=['release'], sections=[
    ('Scope', 'Commit the currently uncommitted worktree in the proposed conceptual commits (see '
     '`docs/codex/security-backlog/README.md`). Recovery ref for the pre-session Codex state: '
     '`refs/backups/codex-e2e-2026-09-25`.'),
])
issue('WB-62', 'Task', 'Fresh independent whole-branch audit', parent='WB-60', gate='merge', priority='Highest',
      labels=['release', 'security'], blocked_by=['WB-17', 'WB-4', 'WB-5', 'WB-21', 'WB-22', 'WB-44', 'WB-46', 'WB-48'],
      sections=[
    ('Scope', 'An independent reviewer (fresh context) audits the whole branch against `main`: rules, client write '
     'paths, E2E harness, and the implementation plan acceptance criteria. Starts only after the known findings '
     'on the pre-merge path and the expanded Playwright coverage have landed.'),
])
issue('WB-63', 'Task', 'Fix substantive audit findings with regression tests', parent='WB-60', gate='merge',
      priority='Highest', labels=['release'], blocked_by=['WB-62'])
issue('WB-64', 'Task', 'Final full acceptance run', parent='WB-60', gate='merge', priority='Highest',
      labels=['release'], blocked_by=['WB-63'], sections=[
    ('Scope', 'Rules emulator, Vitest (with the BrainFlow service running), pytest, typechecks, lint, harness, '
     'read-only and stateful Playwright (plan then execute), hardware items from the plan done manually.'),
])
issue('WB-65', 'Task', 'Reconcile the implementation plan, open PR and merge', parent='WB-60', gate='merge',
      priority='Highest', labels=['release'], blocked_by=['WB-64'], sections=[
    ('Scope', 'Reconcile `IMPLEMENTATION_PLAN.md` (including the uncommitted 2026-09-25 edit in the primary '
     '`neurasticity` checkout), open the PR, merge after approval.'),
])


# ---------------------------------------------------------------- renumber
import re
renumber = {i['key']: f'WB-{n}' for n, i in enumerate(ISSUES, start=1)}
def remap(text):
    return re.sub(r'WB-[0-9]+[a-z]?\b', lambda m: renumber[m.group(0)], text)
for i in ISSUES:
    i['key'] = renumber[i['key']]
    i['parent'] = renumber[i['parent']] if i['parent'] else None
    i['blocked_by'] = [renumber[b] for b in i['blocked_by']]
    i['sections'] = [(h, remap(t)) for h, t in i['sections']]

# ---------------------------------------------------------------- rendering
by_key = {i['key']: i for i in ISSUES}
for i in ISSUES:
    for b in i['blocked_by']:
        assert b in by_key, (i['key'], b)
    if i['parent']:
        assert by_key[i['parent']]['kind'] == 'Epic', i['key']
blocks = {k: [] for k in by_key}
for i in ISSUES:
    for b in i['blocked_by']:
        blocks[b].append(i['key'])


def md_body(i):
    out = [f"- **Type:** {i['kind']}  **Priority:** {i['priority']}  **Gate:** {GATES[i['gate']]}",
           f"- **Labels:** {', '.join(i['labels']) or '-'}"]
    if i['parent']:
        out.append(f"- **Parent:** {i['parent']}")
    if i['blocked_by']:
        out.append(f"- **Blocked by:** {', '.join(i['blocked_by'])}")
    if blocks[i['key']]:
        out.append(f"- **Blocks:** {', '.join(blocks[i['key']])}")
    for heading, text in i['sections']:
        out.append(f"\n**{heading}**\n\n{text}")
    return '\n'.join(out)


def wiki(text):
    return '\n'.join(('* ' + l[2:]) if l.startswith('- ') else l for l in text.split('\n'))


def jira_body(i):
    parts = [f"*Gate:* {GATES[i['gate']]}"]
    if i['blocked_by']:
        parts.append(f"*Blocked by:* {', '.join(i['blocked_by'])} (local IDs; see links)")
    for heading, text in i['sections']:
        parts.append(f"h3. {heading}\n{wiki(text)}")
    parts.append('_Source: docs/codex/security-backlog/BACKLOG.md (local ID ' + i['key'] + ')._')
    return '\n\n'.join(parts)


epics = [i for i in ISSUES if i['kind'] == 'Epic']
lines = ['# Waveable security, data-lifecycle and E2E backlog', '',
         'Generated 2026-09-25 from the E2E/Firestore security session. Local IDs (WB-*) become Jira keys on import '
         '(`jira-import.csv`). Decisions are separate issues that block their implementation tasks.', '',
         '## Gates', '']
for g, text in GATES.items():
    lines.append(f'- `{g}`: {text}')
lines += ['', '## Actionable now (no open blockers)', '']
for i in ISSUES:
    if i['kind'] != 'Epic' and not i['blocked_by']:
        lines.append(f"- {i['key']} ({i['kind']}): {i['summary']} [{i['gate']}]")
lines += ['', '## Hierarchy', '']
for e in epics:
    lines.append(f"- **{e['key']} {e['summary']}** [{e['gate']}]")
    for c in ISSUES:
        if c['parent'] == e['key']:
            dep = f" (blocked by {', '.join(c['blocked_by'])})" if c['blocked_by'] else ''
            lines.append(f"  - {c['key']} {c['kind']}: {c['summary']}{dep}")
lines += ['', '## Issues', '']
for e in epics:
    lines += [f"### {e['key']} — {e['summary']}", '', md_body(e), '']
    for c in ISSUES:
        if c['parent'] == e['key']:
            lines += [f"#### {c['key']} — {c['summary']}", '', md_body(c), '']
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'BACKLOG.md').write_text('\n'.join(lines) + '\n')

max_links = max(len(i['blocked_by']) for i in ISSUES)
header = ['Issue ID', 'Parent ID', 'Issue Type', 'Summary', 'Priority', 'Labels', 'Description'] + \
         ['Inward issue link (Blocks)'] * max_links
buf = io.StringIO()
w = csv.writer(buf)
w.writerow(header)
for i in ISSUES:
    kind = 'Task' if i['kind'] == 'Decision' else i['kind']
    labels = ' '.join(i['labels'] + ([f"gate-{i['gate']}"] if i['gate'] != 'decision' else []))
    row = [i['key'], i['parent'] or '', kind, i['summary'], i['priority'], labels, jira_body(i)]
    row += i['blocked_by'] + [''] * (max_links - len(i['blocked_by']))
    w.writerow(row)
(OUT / 'jira-import.csv').write_text(buf.getvalue())
print(len(ISSUES), 'issues;', len(epics), 'epics;', sum(1 for i in ISSUES if i['kind'] == 'Decision'), 'decisions;',
      sum(len(i['blocked_by']) for i in ISSUES), 'blocking links')
