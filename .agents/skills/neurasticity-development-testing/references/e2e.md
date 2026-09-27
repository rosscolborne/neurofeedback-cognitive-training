# Neurasticity E2E testing

## Current test entry points

- `npm run test` runs Vitest.
- `npm run test:python` runs the pytest suite through `uv`.
- `npm run lint` and `npm run build` provide the repository's lint and TypeScript/build checks.
- Playwright tests are in `e2e/`; configuration is in `playwright.config.ts`.

Playwright uses the system Google Chrome at `/usr/bin/google-chrome`, keeps video disabled, and retains traces/screenshots only for ordinary test failures. It does not start a development server. Start the app manually at the URL configured by `E2E_BASE_URL`, which defaults to `http://localhost:5173`.

## Projects and authentication

Read-only projects (no Admin credential, no writes beyond what logging in and
browsing do):

```bash
npm run test:e2e             # public + patient + clinician
npm run test:e2e:auth
npm run test:e2e:patient     # e2e/patient.readonly.spec.ts
npm run test:e2e:clinician   # e2e/clinician.readonly.spec.ts
npm run test:e2e:rules       # probes whether deployed Firestore rules match firestore.rules
npm run test:e2e:harness     # offline unit tests for cleanup planning
npm run test:e2e:guard       # browser checks for the permission-denied guard
npm run test:e2e:preflight   # read-only Admin check of config, identities, leases, fixture
```

Auth setup reads credentials from the current process and saves storage states in a private OS temporary directory. Playwright removes it at the end of a standalone run; the session command uses its own temporary directory and removes that at the end. Auth setup runs as a dependency of each authenticated project, so storage states do not need to survive between commands. Never commit, print, attach, or inspect credentials or storage-state contents. Auth setup has trace and screenshot capture disabled.

Browser specs and auth setup import `test` from `e2e/fixtures.ts` so console, page, and Firestore network permission denials fail the test, including denials in additional browser contexts. Stateful specs inherit that guard through `e2e/helpers/statefulFixture.ts`. The cleanup-plan unit test imports directly from Playwright because it opens no browser. The fresh-account isolation spec calls `permissionErrorGuard.expectDenialsIn` only for the context running its deliberate cross-account denial probes; other contexts remain guarded and stateful cleanup still runs.

Tests that need a different local server may set `E2E_BASE_URL` for the command, for example `E2E_BASE_URL=http://localhost:5174 npm run test:e2e:patient`.

## Stateful persistence suites

Stateful specs (`*.stateful.spec.ts`) skip unless `E2E_RUN_STATEFUL=true`, which
only these scripts set; they share leases, so they run with one worker:

```bash
npm run test:e2e:stateful:patient     # Demo session save/reload
npm run test:e2e:stateful:clinician   # invitation + branding, messaging, appointments
npm run test:e2e:stateful:isolation   # disposable accounts + cross-tenant denial
npm run test:e2e:cleanup              # operator review of an unfinished run
```

Use `npm run test:e2e:session -- patient|clinician|isolation|preflight|reset` after a human `gcloud auth application-default login`. The command resets fixed test identities, mints ten-minute impersonated tokens for `waveable-e2e@brainwell-327dc.iam.gserviceaccount.com` in memory, runs auth setup and preflight, runs the selected suite, and resets again. It pins the development project and refuses key files and non-human ADC. The browser project, Admin project, browser identities, and Admin Auth records must agree. See [WB-44 credential and fixture setup](../../../../docs/e2e-credentials.md) for the one-time IAM steps and recovery. Do not use the test accounts manually during a run.

`E2E_CLEANUP_MODE` is required. `.env.e2e` may set it only to `plan`; the
config refuses `execute`, `E2E_RUN_STATEFUL`, `E2E_CLEANUP_RUN_ID`,
`E2E_CLEANUP_PLAN_SHA`, and `E2E_CLEANUP_ACCEPT_RETAINED` in the file, so they
must be given on the command line of a single run.

- `plan` — the suite runs, then reports its cleanup plan (document paths,
  expected versions, changed field names, reasons; never field values, though
  paths can contain the test accounts' UIDs and email) with a SHA-256 digest to
  the console, the Playwright report, and ignored `e2e/.cleanup-reports/`.
  Cleanup changes nothing; the run's lease is parked so no other stateful run
  starts until an operator reviews it.
- `execute` — the plan is applied in one Firestore transaction that re-checks
  every target's update time (all or nothing), then Firestore/Auth are re-read
  to verify that run data is gone and fixture documents equal their baseline.
  The lease is released only when clean.

Cleanup is owned by the `stateful` fixture (`e2e/helpers/statefulFixture.ts`):
it runs in fixture teardown with its own timeout and closes every browser
context first, so no app write lands after the run window is recorded. A lost
lease heartbeat closes the browser contexts immediately.

Cleanup deletes only documents with positive evidence of this run: the random
run marker in a field the test wrote (session notes, appointment notes,
invitation patient name, message text), the approved patient/clinician
ownership fields, and server create/update times inside the run window. New
documents without that evidence are reported and left untouched. Pre-existing
fixture documents (patient profile, pair message thread, pair invitation claim,
and the clinic for the branding scenario) are restored to the baseline only
when they were last modified inside the run window, every changed field is one
the run's own code path writes, and no related record (sessions/invitations for
the patient, messages for the thread, invitations for the claim) was left
unattributed. The clinic is restored only while the approved pair are its sole
members. Stateful care and isolation suites run only after
`npm run test:e2e:rules` passes.

These gates (pinned project, IAM, confirmation flags, leases, plan digests)
prevent accidents. A person who can impersonate the E2E service account can
also use its Admin permissions directly; grant Token Creator only to approved
developers on that service account.

A run that ends without clean cleanup leaves its lease in place. Stale
baselines are never restored automatically. Recovery is Admin-only and needs
no browser storage state or saved fixture passwords. Review it read-only with
`npm run test:e2e:recover -- <run> plan`, then execute with the digest that
plan printed: `npm run test:e2e:recover -- <run> execute <digest>`.
Execution refuses if the state no longer matches the reviewed plan. The window
ends where the run recorded it, or (for a crash before that) shortly after the
last heartbeat, so later manual activity is left alone. Recovery never
recreates deleted documents, and it refuses a run whose recorded clinic no
longer matches the clinician's practitioner record (a scenario that changes
practitioner onboarding mid-run would need that check revisited). Adding `E2E_CLEANUP_ACCEPT_RETAINED=<run>` to a
reviewed recovery (`--accept-retained` after the digest) releases the lease
while leaving the reported items untouched.

Read-only suites still load the real app, which may back-fill missing profile
fields for the signed-in account; cleanup then treats that document as
modified outside the window and leaves it alone.

Fresh-account isolation creates identities only in the
`neurasticity-e2e-(patient|clinician)-<32 hex>@example.com` namespace, registered
in an Admin-only registry (server timestamp) before signup. Cleanup deletes an
identity's own `users`/`clients`/`practitioners`/`clinics` records, then its
Auth user, then the registry entry, and only when the Auth account and every
record were created after registration and no other data links to it.
Leftover registry entries block new runs until reviewed with the same cleanup command. Credential-bearing
capture remains disabled.

## Reusable helpers

`e2e/helpers/auth.ts` provides:

- `loginThroughUi` for real login setup only;
- `arriveAtPatientDashboard`, which conditionally skips headset setup;
- `startPatientTrainingInDemoMode`, which conditionally selects supported Demo Mode;
- `arriveAtClinicianDashboard`;
- `identityFromStorageState`, which reads a saved role's Firebase identity.

`e2e/helpers/persistenceAssertions.ts` confirms through the signed-in patient or
clinician page that data the UI reports as saved reached Firestore. Its REST
reader uses the page's Firebase ID token, so the same Firestore rules authorize
the assertion and server create times remain available for run attribution.
The token stays inside the page. `e2e/helpers/cleanupPlan.ts` holds the pure
attribution rules covered by `npm run test:e2e:harness`. The local protocol E2E
suite includes `persistence.local.spec.ts`, which checks allowed and denied
reads against the emulators.

Authenticated specs should normally rely on the `patient` or `clinician` project state and use the dashboard/training helpers rather than handling credentials. Do not use the demo clinician shortcut as a substitute for the dedicated clinician E2E identity.

## Firestore rules tests

`tests/firestore-rules/` runs positive and adversarial cases against the local
Firestore emulator (project `demo-neurasticity-rules`; it cannot reach a real
project). It needs Java 21:

```bash
JAVA_HOME=~/.local/share/temurin-jre-21 PATH=$JAVA_HOME/bin:$PATH npm run test:rules
npm run test:rules:typecheck
```

`client-transactions.test.ts` replays the app's real transactions, including
reads of documents that do not exist yet; keep it in step with client write
paths. `policy/` pins behavior that is a product decision (unverified email,
self-selected clinician role, patient-editable care fields, credential status)
so a change to it is deliberate. Set `RULES_FILE=<path>` to run the same suite
against another ruleset, for example `main`'s, to compare behavior.
