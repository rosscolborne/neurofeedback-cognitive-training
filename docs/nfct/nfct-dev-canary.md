# The nfct-dev canary

The canary is one narrow end-to-end check that runs a pull request's own
production build against **nfct-dev**, the Firebase project TestFlight builds
use. It checks one question before the pull request merges into
`development`: can this code complete the critical consumer journey against
the real backend?

The other test layers ([checks](ios.md#checks-and-where-they-run),
[testing skill](../../.agents/skills/neurasticity-development-testing/SKILL.md))
run against local emulators that load the repository's `firestore.rules`. On
2026-10-02 a TestFlight build let a new account sign up but then returned it
to role selection when "Train my brain" was pressed. nfct-dev still served
deny-all rules, so every Firestore write failed, and every CI layer had passed
because none of them used the deployed backend. The canary is the layer that
catches backend, configuration and rules mismatches while the original pull
request is still open.

It is a canary, not a second E2E suite. nfct-dev is on the Spark plan and
shared, so each run uses one account, one browser and one journey, with no
fixture seeding, no Firestore polling and no retries.

## The check

- **Workflow and job:** `Backend (Firebase)` / **`nfct-dev canary`**
  (`.github/workflows/backend.yml`, job `canary`).
- **Runs:** in [Pre-merge validation](ci.md), started by hand on a pull
  request's final head, after `web` passes and alongside `emulators`; or
  alone, by hand: `gh workflow run backend.yml --ref <branch> -f
  emulators=false`, once `backend.yml` is on `main`
  ([when the buttons appear](ci.md#when-the-run-workflow-buttons-appear));
  until then, through Pre-merge validation. No push starts it.
- **Code:** `e2e/canary/nfct-dev.canary.spec.ts` with
  `playwright.canary.config.ts`, the shared journey helpers in
  `e2e/helpers/journeys.ts`, and `scripts/canary/canary.mjs` for the build,
  identity and cleanup.
- **Browser:** one iPhone-sized Chromium profile (the iPhone 17 viewport). The
  WebKit and Simulator layers stay on the emulators.

The job builds the branch's production bundle (`vite build`) with nfct-dev's
web config, which is the same config the Xcode Cloud workflow compiles in. It
serves the bundle with `vite preview` and drives it as an ordinary user:

1. Start at `/` signed out: the Welcome screen.
2. **Begin Journey** creates a fresh disposable account through the real form.
3. **Train my brain** saves the role and arrives home, skipping the optional
   headset setup. This is where the TestFlight incident failed.
4. **Train > Mental Math** loads the new player's progress and recent sessions
   from the server. The check needs the "Reach higher levels…" help text,
   because a failed read still offers level 1. This read is the real
   `gameSessions` query, and real Firestore enforces the composite index that
   emulators do not.
5. Start a run, **Pause**, **Quit run**: "Run saved to your account." appears
   only after the server acknowledges the session write. No 90-second run is
   needed.
6. Sign in again in a new browser context with no cache: the account comes back
   home and is not sent to role selection, so the profile and role persisted on
   the server.

The permission-denied guard in `e2e/fixtures.ts` also fails the run on any
denied Firestore request. If the browser passes a generous ceiling of Auth or
Firestore requests (a listener or write loop), the spec closes the browser
context at once and fails, so a looping branch cannot spend the shared
project's quota. It writes the request counts to the job summary.

Not checked yet:

- Trusted scoring (a session `result`, progress). nfct-dev has no Functions
  deployed (Spark). Extend the journey when they are.
- The absence of the practitioner option. Add that assertion to
  `completeConsumerOnboarding` once NFCT-4 removes the option.

## When it runs

In Pre-merge validation, `scripts/ci/classify-changes.sh` sets the `backend`
output from the branch's changes relative to `development`. The canary is
skipped only when **every** changed file is on its skip list:

| Skipped | Paths |
| --- | --- |
| Documentation and agent instructions | `docs/`, `.agents/`, `.claude/`, top-level `*.md`, any `README.md` |
| Tests and test configuration | `e2e/` (except below), `tests/`, `__tests__/`, `*.test.{ts,tsx,js,mjs}`, `playwright.config.ts`, `playwright.protocol.config.ts`, `playwright.webkit.config.ts`, `vitest.<name>.config.ts`, the e2e, rules, repositories and shared-test `tsconfig`s |
| Native iOS and its tooling | `ios/`, `ci_scripts/`, `scripts/ios/` |
| The inherited BrainFlow service | `brainflow_service/`, `pyproject.toml`, `uv.lock` |
| Cloud Functions, while none are deployed to nfct-dev | `functions/` (remove it from the list once Functions are deployed) |
| Other workflows | `.github/workflows/ios.yml`, `.github/workflows/release.yml`, `.github/workflows/main-source-guard.yml` |
| Media | images, fonts, audio, video |

Everything else runs it: `src/`, `shared/`, styles, `index.html`,
`package.json` and the lockfile, `vite.config.ts`, `firestore.rules`,
`firestore.indexes.json`, `firebase.json`, `.firebaserc`,
`capacitor.config.ts`, `ci.yml`, `backend.yml`, the classifier itself, and any file not
listed. The canary's own files always run it, even under `e2e/`: the spec and
`device.ts`, `e2e/fixtures.ts`, and `e2e/helpers/auth.ts` and
`journeys.ts`. A test keeps this list in step with the spec's imports.

It fails safe toward more testing. A failed diff, a failed or empty
classification, or a failed change detection job runs the canary.

Other safety properties:

- **Superseded runs:** a newer run on the same branch cancels the older one.
  The cleanup step runs on cancellation too.
- **Forks:** only people with write access can start the workflow, so fork
  code reaches the shared backend only after a maintainer pushes it to a
  branch here. Should a `pull_request` trigger ever return, the job fails a
  fork's pull request instead of running it.

## Reading a failure

The `emulators` job also rehearses the same journey and cleanup on the
emulators ("Rehearse the nfct-dev canary on the emulators"). How the two
results combine:

The rehearsal also fails if cleanup did not remove the account and its
`clients/{uid}` profile. A cleanup regression therefore shows up there, not as
residue on nfct-dev.

| Rehearsal | Canary | Meaning |
| --- | --- | --- |
| passes | fails | The backend or its configuration does not match the branch. Candidates: rules or indexes not deployed, or out of date; wrong repository variables; Email/Password sign-in disabled; quota |
| fails | fails | The app or the test is broken; fix it like any other failure |

Common messages:

- **"Firestore permission-denied errors surfaced"** or **"Choosing 'Train my
  brain' should save the role…":** nfct-dev's deployed rules deny what the
  branch writes.
- **"Mental Math should load the player's progress…"** with "Your progress
  couldn't be loaded": a denied read or a missing composite index.
- **Sign-up never reaches role selection:** check the failure screenshot for
  the form's error, such as Auth configuration or a quota.

Do not bypass a red canary or work around it in the app. Report it as a
blocker with the failing step. If the deployed backend needs to change, that
is the owner's step ([rules and indexes](#rules-and-index-changes)).

Failure artifacts are **screenshots only** (`nfct-dev-canary-screenshots`).
Playwright's error context records typed values, including the password, and
this repository's artifacts are public. Traces and video are off for the same
reason.

## Disposable accounts

- **Identity:** each run creates
  `nfct-smoke+<run id>-<attempt>-<random>@example.test` with a random password.
  Local runs use `local-0`. Nothing is reused, so concurrent pull requests never
  share an account.
- **Identity file:** `prepare` writes the identity to
  `$RUNNER_TEMP/nfct-canary/identity.json` (mode 600) before the account
  exists, so cleanup can find a partial run.
- **Secrecy:** the password is masked in the job log and never printed, and
  neither is the ID token.
- **Data:** everything the journey writes belongs to that account's UID.
- **Credentials:** the job has no secrets and no Admin credentials. It uses only
  public client APIs: the web app, Firebase Auth's REST API with the public web
  API key, and Firestore's REST API with the account's own ID token. The
  deployed rules apply to every request.

nfct-dev's Auth accepted the `example.test` domain on 2026-10-02.

## Cost per run

Measured on the emulators (2026-10-02). Real-backend timings are larger.

| Item | Per run |
| --- | --- |
| Auth | 1 account creation; about 7 operations, including the second sign-in and cleanup's sign-in and delete |
| Firestore reads | about 30 client requests; about 15 to 30 billed document reads |
| Firestore writes | 4: the `users` create, the role update, `clients` create, one `gameSessions` create |
| Firestore deletes | 1 user-level delete (`clients/{uid}`) |
| Time | about 1 minute to install and build, and under a minute for the journey |

Spark's daily free quotas (50,000 reads, 20,000 writes, 20,000 deletes) allow
hundreds of runs a day. Firebase Auth limits new accounts per IP address, and
GitHub's runners share IP addresses. A sign-up quota error is a reason to
batch pushes, not to retry.

## Cleanup

The job's last step runs `node scripts/canary/canary.mjs cleanup` even after a
failure or cancellation. As the user, it deletes `clients/{uid}` and then the
Auth account. It is idempotent: an account that does not exist counts as
clean. A cleanup problem shows as a warning without changing the journey's
result.

The rules keep `users/{uid}` and its game sessions (`allow delete: if false`;
server-side account deletion is NFCT-23), so they remain. An account whose
cleanup never ran also remains. The profile's email marks this residue.

The owner removes it from their own machine with Application Default
Credentials (`gcloud auth application-default login`), never from CI:

```bash
# Dry run: lists canary residue older than 2 hours
npx tsx --tsconfig functions/tsconfig.json functions/scripts/cleanup-canary-accounts.ts --project nfct-dev --live
# Removes it: users/{uid} (recursively), clients/{uid} and any Auth account
npx tsx --tsconfig functions/tsconfig.json functions/scripts/cleanup-canary-accounts.ts --project nfct-dev --live --delete
```

The cleanup's safety rules (`functions/scripts/canaryCleanup.ts`):

- There is no default project. The only real project it accepts is
  `nfct-dev`, and only with `--live`. It is a dry run without `--delete`.
- It touches only accounts whose email matches the exact canary pattern: the
  Auth account's email when the account exists (that email decides), otherwise
  the profile's. An Auth account with any other email is refused, even if its
  profile claims a canary email, and is never printed.
- `--older-than-minutes` defaults to 120 and is at least 30. It compares the
  server's creation time (the Auth account's, or the profile's) with the local
  clock.
- A plan larger than `--max` (default 25) aborts before anything is deleted.

Scheduled cleanup can come later if the residue grows. It would run as a
protected, main-only job with keyless (Workload Identity Federation)
credentials, never from a pull request.

## Owner setup

1. **Repository variables** (Settings > Secrets and variables > Actions >
   Variables). These hold nfct-dev's web config, which is public, so they are
   variables rather than secrets. Use the same values as the Xcode Cloud
   workflow's environment. `npx firebase apps:sdkconfig WEB --project dev`
   prints them.

   | Variable | Value |
   | --- | --- |
   | `NFCT_DEV_FIREBASE_API_KEY` | `apiKey` |
   | `NFCT_DEV_FIREBASE_AUTH_DOMAIN` | `authDomain` (`nfct-dev.firebaseapp.com`) |
   | `NFCT_DEV_FIREBASE_PROJECT_ID` | `nfct-dev` (the job refuses anything else) |
   | `NFCT_DEV_FIREBASE_APP_ID` | `appId` |
   | `NFCT_DEV_FIREBASE_STORAGE_BUCKET` | `storageBucket` (optional) |
   | `NFCT_DEV_FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` (optional) |

   Without them, the canary fails at its build step and names the missing
   variables.
2. **Deploy the repository's rules and indexes to nfct-dev** (NFCT-24),
   following [rules and indexes](#rules-and-index-changes). Until then the
   canary fails at "Train my brain", exactly as the TestFlight build does.
3. **Require the result.** As of 2026-10-02, the `development` ruleset has no
   required status checks at all, only deletion, non-fast-forward and
   pull-request rules. The canary is part of Pre-merge validation, whose
   single `Pre-merge validation` commit status is the check to require
   ([enforcing it](ci.md#enforcing-it-owner)). It fails when the canary fails,
   or when the canary is skipped for any reason other than the
   classification.
4. Keep the fork-workflow approval setting at its default or stricter
   (Settings > Actions > General).

## Running it by hand

GitHub Actions runs the canary. The owner can run it against nfct-dev from their own
machine. The target is always explicit, and `run` builds the bundle first:

```bash
NFCT_CANARY_TARGET=nfct-dev VITE_FIREBASE_API_KEY=… VITE_FIREBASE_AUTH_DOMAIN=nfct-dev.firebaseapp.com \
  VITE_FIREBASE_PROJECT_ID=nfct-dev VITE_FIREBASE_APP_ID=… node scripts/canary/canary.mjs run
```

Agents run only the emulator rehearsal (AGENTS.md, Checks).

## Rules and index changes

The canary tests the branch's code against the rules and indexes deployed on
nfct-dev. It cannot test candidate rules that have not been deployed. A pull
request that changes `firestore.rules` or `firestore.indexes.json` keeps three
checks:

1. **Candidate rules on the emulators:** `npm run test:rules`, the
   repositories, Functions and Playwright suites. Pre-merge validation runs them.
2. **Old clients against the new rules:** rules deploy before clients ship, so
   the new rules must still accept what the current `development` and
   TestFlight clients write.
3. **The candidate rules on the real backend before merge.** While TestFlight
   is internal-only, the owner does this by hand:
   - Validate one rules pull request at a time; nfct-dev is shared.
   - Deploy only once the pull request's security review (DEEP tier for rules)
     has passed, and only from the reviewed head commit. A rules bypass would
     otherwise be live on a project that holds testers' data.
   - Deploy the candidate rules and indexes:
     `npx firebase deploy --only firestore --project dev`. Answer **No** to
     deleting indexes, and never pass `--force`.
   - Wait until the new indexes have finished building (Firebase console >
     Firestore > Indexes).
   - Run the canary on the pull request's branch: Pre-merge validation
     (`gh workflow run ci.yml --ref <branch>`, which runs it for a rules
     change), or, once `backend.yml` is on `main`, the canary alone
     (`gh workflow run backend.yml --ref <branch> -f emulators=false`).
   - Run it on `development` too, so the current client runs against the
     candidate rules: `gh workflow run ci.yml --ref development` (on
     `development` it runs everything), or the canary alone with `backend.yml`
     once it is on `main`.
   - Merge promptly. If the pull request is not merging, redeploy
     `development`'s rules.

Introduce a separate `nfct-staging` project when this stops being safe:
external TestFlight testers, deployed Functions or scoring, or frequent
backend changes. That is an owner decision.

## Rules and index parity (planned)

The canary shows that the deployed rules and indexes *work* for the branch's
client. It does not show that they *equal* the repository's. The planned
complement is a cheap, read-only comparison of nfct-dev's deployed Firestore
rules and indexes with the files in a pull request or release:

- **Where:** Pre-merge validation, and, cheaply, the development → main
  promotion's Release workflow (no development validation on `main`).
- **Credentials:** keyless GitHub OIDC (Workload Identity Federation) with
  read-only access to rules and index metadata only, never data or admin
  access.
- **Not** a committed "deployment record", which any branch could forge.

Until then, the owner can compare deployed rules in the Firebase console.

## Known limits

- **Self-editing workflow:** a manual run uses the branch's own
  `backend.yml`, `ci.yml` and classifier, so a pull request could weaken this
  job. Review workflow changes as security-sensitive. `main` is protected
  separately by `main-source-guard.yml`.
- **Slow sign-in:** a slow real-backend role lookup keeps the loading screen
  and, after 15 seconds or a failed read, shows a retryable "Your account
  couldn't be loaded" screen; it never treats the account as having no role
  (NFCT-44, landed through PR #26). After a transient failure it also
  retries by itself, backing off to every 10 s. If step 6 times out there, read it as a
  slow or failing backend, not a flaky test.
  `e2e/returning-user.auth-handoffs.local.spec.ts` covers the slow-lookup
  case on the emulators. The precondition for making the canary a required
  check is met.
- **Public configuration:** the repository variables appear in the public
  Actions logs. They are nfct-dev's web config, which every build of the app
  already contains.
- **Coverage:** the canary does not cover WebKit, the iOS shell or Bluetooth;
  the other layers do.
