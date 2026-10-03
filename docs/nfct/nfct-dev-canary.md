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
to the (since retired) role selection when its first Firestore write was
refused. nfct-dev still served
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
- **Runs:** in [Pre-merge validation](ci.md), started by hand by the owner
  on a pull request's final head, after `web` passes and alongside `emulators`; or
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
   The app leaves its loading screen for the optional headset setup only once
   the server has accepted the new player's profile (`users/{uid}`), the
   account's first Firestore write. This is where the TestFlight incident
   failed.
3. **Skip to Dashboard** skips the optional headset setup and arrives home.
   Nothing asks what kind of account it is.
4. **Train > Mental Math** loads the new player's progress and recent sessions
   from the server. The check needs the "Reach higher levels…" help text,
   because a failed read still offers level 1. This read is the real
   `gameSessions` query, and real Firestore enforces the composite index that
   emulators do not.
5. Start a run, **Pause**, **Quit run**: "Run saved to your account." appears
   only after the server acknowledges the session write. No whole run is
   needed.
6. Sign in again in a new browser context with no cache: the account comes back
   home, reading its profile from the server. That the profile was saved is
   proven at sign-up (step 2 waits for the server to accept it); this step
   would pass even if the profile were missing, because the app then creates
   it again.

The permission-denied guard in `e2e/fixtures.ts` also fails the run on any
denied Firestore request. If the browser passes a generous ceiling of Auth or
Firestore requests (a listener or write loop), the spec closes the browser
context at once and fails, so a looping branch cannot spend the shared
project's quota. It writes the request counts to the job summary.

Not checked yet:

- Trusted scoring (a session `result`, progress). nfct-dev has no Functions
  deployed (Spark), so every real-backend run stays Pending
  ([trusted scoring on nfct-dev](#trusted-scoring-on-nfct-dev)). Extend the
  journey when they are.

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
profile (`users/{uid}`). A cleanup regression therefore shows up there, not as
residue on nfct-dev.

| Rehearsal | Canary | Meaning |
| --- | --- | --- |
| passes | fails | The backend or its configuration does not match the branch. Candidates: rules or indexes not deployed, or out of date; wrong repository variables; Email/Password sign-in disabled; quota |
| fails | fails | The app or the test is broken; fix it like any other failure |

Common messages:

- **"Firestore permission-denied errors surfaced"** or **"Creating the
  account should save its profile and reach headset setup"** with "Your
  account couldn't be loaded": nfct-dev's deployed rules deny what the branch
  writes.
- **"Mental Math should load the player's progress…"** with "Your progress
  couldn't be loaded": a denied read or a missing composite index.
- **Sign-up stays on the Create Account form:** check the failure screenshot
  for the form's error, such as Auth configuration or a quota.

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
| Auth | 1 account creation; about 9 operations, including saving the sign-up name, the account check before the profile is created, the second sign-in and cleanup's sign-in and delete |
| Firestore reads | about 30 client requests; about 15 to 30 billed document reads |
| Firestore writes | 2: the profile (`users/{uid}`) create, one `gameSessions` create |
| Firestore deletes | 1 user-level delete (the profile, `users/{uid}`) |
| Time | about 1 minute to install and build, and under a minute for the journey |

Spark's daily free quotas (50,000 reads, 20,000 writes, 20,000 deletes) allow
hundreds of runs a day. Firebase Auth limits new accounts per IP address, and
GitHub's runners share IP addresses. A sign-up quota error is a reason to
batch pushes, not to retry.

## Cleanup

The job's last step runs `node scripts/canary/canary.mjs cleanup` even after a
failure or cancellation. As the user, and as account deletion in the app
does, it deletes its profile (`users/{uid}`) and then the Auth account. It is
idempotent: an account that does not exist counts as clean. A cleanup problem
shows as a warning without changing the journey's result. Rules that refuse
the profile delete (nfct-dev's deployed rules before this was allowed; see
[below](#rules-and-index-changes)) leave it as residue, not a failure.

Deleting a document never deletes its subcollections, and the rules let no
client delete game sessions (server-side account deletion is NFCT-23), so the
profile's game sessions remain. Once the Auth account is gone nothing under
`users/{uid}` names the canary (consumer profiles hold no email), so cleanup
reads the account's UID before deleting anything and prints it, with the
owner-run command for that UID, in the job log and step summary:

```text
- uid: <uid>
- owner-run cleanup (dry run; add --delete): npx tsx … cleanup-canary-accounts.ts --project nfct-dev --live --uid <uid>
```

An account whose cleanup never ran also remains; the owner-run cleanup finds
it by its Auth account's canary email, without a UID.

The owner removes it from their own machine with Application Default
Credentials (`gcloud auth application-default login`), never from CI:

```bash
# Dry run: lists canary residue older than 2 hours
npx tsx --tsconfig functions/tsconfig.json functions/scripts/cleanup-canary-accounts.ts --project nfct-dev --live
# Also the leftover users/{uid} data of accounts the canary deleted, by the UIDs its reports printed
npx tsx --tsconfig functions/tsconfig.json functions/scripts/cleanup-canary-accounts.ts --project nfct-dev --live --uid <uid> [--uid <uid> …]
# Removes it: users/{uid} (recursively) and any Auth account
npx tsx --tsconfig functions/tsconfig.json functions/scripts/cleanup-canary-accounts.ts --project nfct-dev --live [--uid <uid> …] --delete
```

The cleanup's safety rules (`functions/scripts/canaryCleanup.ts`):

- There is no default project. The only real project it accepts is
  `nfct-dev`, and only with `--live`. It is a dry run without `--delete`.
- It touches an Auth account only if its email matches the exact canary
  pattern. An Auth account with any other email is refused, even when named
  with `--uid`, and is never printed.
- It touches data with no Auth account only under a UID named with `--uid`.
- `--older-than-minutes` defaults to 120 and is at least 30. It compares the
  server's creation time (the Auth account's, or else the earliest document
  left under `users/{uid}`) with the local clock.
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
   canary fails at sign-up's profile write, exactly as the TestFlight build did.
3. **Require the result.** As of 2026-10-02, the `development` ruleset has no
   required status checks at all, only deletion, non-fast-forward and
   pull-request rules. The canary is part of Pre-merge validation, whose
   single `Pre-merge validation` commit status is the check to require
   ([enforcing it](ci.md#enforcing-it-owner)). It fails when the canary fails,
   or when the canary is skipped for any reason other than the
   classification.
4. Keep the fork-workflow approval setting at its default or stricter
   (Settings > Actions > General).

## Trusted scoring on nfct-dev

Every run's score, records, unlocks, streak, activity and achievements come
from trusted scoring in `functions/` (NFCT-19, NFCT-13), never from the
client. On 2026-10-03 the Cloud Functions API was not even enabled on nfct-dev
(`npx firebase functions:list --project dev`: 403 `SERVICE_DISABLED`), and the
project is on Spark, which cannot run Functions. So nothing scores a run saved
there: it keeps a session without `result`, Home, Progress and Mental Math
history show it as **Pending** for ever, and the stats-driven cards keep
loading. The client is behaving correctly; this is the missing server path.

Nothing else in the repository blocks it (NFCT-66 traced the whole path):

| Piece | State |
| --- | --- |
| Trigger | `onGameSessionCreated` (Firestore `onDocumentCreated`, 2nd gen, retries on) writes `result`, `progress/{gameId}`, `stats/summary`, `dailyStats/*` and `achievements/*` in one transaction |
| Sweep | `sweepUnprocessedSessions` (every 60 minutes, Cloud Scheduler) re-drives `pending`, `failed` and `unsupported` sessions 1 hour to 7 days old, 100 per run |
| Region | `northamerica-northeast2`, the same as nfct-dev's Firestore (`functions/src/index.ts`) |
| Runtime and build | Node 22 (`firebase.json`, `functions/package.json`); the predeploy step bundles `src/` and `shared/` into `lib/index.js`, which is all that is uploaded; the CLI disables the buildpack's own build |
| Parameters and secrets | None |
| Rules | The client may read its own `gameSessions`, `progress`, `stats`, `dailyStats` and `achievements`, and may write none of the trusted fields |
| Indexes | `firestore.indexes.json` covers the client's history query and the Functions' queries, including the collection-group `processing.state` + `createdAt` index the sweep and re-drive use |
| Client | Live listeners on the session, progress and stats documents; each re-subscribes after a failure (`src/consumer/firestore/retryingSubscription.ts`), so the result shows without a reload once it is written |

### Owner steps

Run these from a clean checkout of the commit to deploy (normally
`development`'s head), on your own machine. Agents do not deploy.

1. **Upgrade nfct-dev to Blaze** (Firebase console > Usage and billing >
   Modify plan) and set a budget alert. `maxInstances: 10` bounds the trigger;
   the sweep runs 24 times a day.
2. **Confirm the database location** is `northamerica-northeast2`
   (Firebase console > Firestore > the `(default)` database). If it is not,
   stop: `REGION` in `functions/src/index.ts` must match it.
3. **Install and test:**
   `npm ci --legacy-peer-deps && npm ci --prefix functions && npm run test:functions`
   (Java 21).
4. **Deploy rules and indexes** if nfct-dev's are older than this commit:
   `npx firebase deploy --only firestore --project dev`. Answer **No** to
   deleting indexes, never pass `--force`, and wait until every index has
   built (Firebase console > Firestore > Indexes).

   **Mental Math gameVersion 2 (NFCT-60, the time bank).** Builds from that
   change on write sessions with `gameVersion: 2`, which rules older than it
   refuse (`supportedGameVersions()` now allows 1 to 2): deploy these rules
   before anyone plays on such a build, or its runs fail to save (the canary
   fails the same way). Older builds keep writing `gameVersion: 1`, which stays
   allowed. Functions from this commit register both versions: every run saved
   before the deploy is a fixed 90 s gameVersion 1 run and is judged by v1's
   own rules in step 7, exactly as before; time-bank runs are judged by v2's.
   A player's records restart with their first time-bank run (the v1 records
   are kept in `bestsArchive`), and unlocked start levels carry over.
5. **Deploy the Functions:** `npx firebase deploy --only functions --project dev`.
   The CLI enables the APIs it needs (Cloud Functions, Cloud Build, Artifact
   Registry, Cloud Run, Eventarc, Pub/Sub, Cloud Scheduler) and grants the
   service agents their roles. A first 2nd-gen deploy can fail while those
   permissions propagate; wait a few minutes and run it again. If only the
   scheduled sweep fails (for example, Cloud Scheduler in this region),
   deploy the trigger alone with
   `npx firebase deploy --only functions:onGameSessionCreated --project dev`
   and report the sweep's error.
6. **Verify:** `npx firebase functions:list --project dev` lists
   `onGameSessionCreated` and `sweepUnprocessedSessions` in
   `northamerica-northeast2`. Play a Mental Math run on a TestFlight or
   nfct-dev web build: within seconds the summary's tag changes from
   **Pending** to **Final**, Home's recent runs and Mental Math history show
   the score, and Home's streak and achievements appear. Reload, or sign in
   again: the same values come back. Errors go to
   `npx firebase functions:log --project dev`.
7. **Score the runs saved before the deploy.** A trigger fires only for new
   documents, so earlier sessions stay pending until something re-drives them.
   The sweep takes those from the last 7 days, 100 an hour. To do all of them
   at once, with your Application Default Credentials
   (`gcloud auth application-default login`):

   ```bash
   # Lists what it would re-drive (pending, failed and unsupported sessions)
   npm run functions:redrive-sessions -- --project nfct-dev --live --dry-run --older-than-minutes 0 --newer-than-days 365
   # Re-drives them through the trigger's pipeline, then finishes each user's start-level upgrades
   npm run functions:redrive-sessions -- --project nfct-dev --live --older-than-minutes 0 --newer-than-days 365
   ```

   Repeat while it reports targets (`--limit` defaults to 100). Each re-driven
   session updates its user's progress and stats as it commits. Should a
   user's aggregates ever look wrong, rebuild them from their stored results:
   `npm run functions:rebuild-progress -- --project nfct-dev --live --uid <uid>`.
8. **Afterwards:** remove `functions/` from the canary's skip list
   (`scripts/ci/classify-changes.sh` and [When it runs](#when-it-runs)), and
   extend the canary journey to wait for a **Final** score.

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

### Phase 2: the consumer profile only

The rules that retire the account role and the legacy `clients/{uid}` profile
(Phase 2) intentionally stop accepting pre-Phase-2 clients, which write a
legacy `users/{uid}` document (with `role`) and `clients/{uid}`. For that pull
request, step 3's run on `development` against the candidate rules is
expected to fail. The owner deploys those rules together with wiping
nfct-dev's existing accounts and shipping a new TestFlight build.

As verified on 2026-10-03, nfct-dev serves `firestore.rules` from commit
`60cfabb` (NFCT-20). Its consumer-profile create and update rules match
Phase 2's, so the Phase 2 app's sign-up works there, but they refuse to
delete a profile: until Phase 2's rules are deployed, account deletion in the
app fails there before deleting the Auth account, and the canary's cleanup
leaves the profile as residue.

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
- **Slow sign-in:** a slow real-backend profile lookup keeps the loading
  screen and, after 15 seconds or a failed read, shows a retryable "Your
  account couldn't be loaded" screen; it never treats the account as new, and
  creates a profile only when the server confirms there is none (NFCT-44,
  landed through PR #26). After a transient failure it also
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
