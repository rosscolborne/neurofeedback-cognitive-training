# E2E testing

This repository has **no deployed-project E2E**. Every signed-in browser test
runs against the local Firebase Auth and Firestore emulators. Never point a
test, helper or script at a real Firebase project; `npm run check:isolation`
and `src/services/firebaseConfig.ts` refuse the Waveable clinical project.

## Current test entry points

- `npm test` runs the default offline Vitest suite. It uses an inert
  `demo-nfct-unit` Firebase config and needs no `.env`.
- `npm run lint`, `npm run build` and `npm run check:isolation` are the lint,
  TypeScript/build and clinical-isolation checks.
- `npm run test:rules` runs the Firestore rules suite on the emulator (below).
- `npm run test:e2e:protocol` runs the local emulator browser suite (below).
- `npm run test:e2e:webkit` runs the specs listed in
  `playwright.webkit.config.ts` from the same suite in Playwright WebKit, as
  an iPhone SE (3rd gen) and an iPhone 17. Install WebKit once with
  `npx playwright install webkit`. See
  [Phones, WebKit and iOS](../SKILL.md#phones-webkit-and-ios).
- `npm run test:e2e` runs the Playwright projects that need no Firebase at all:
  `public` (smoke; needs an app on `E2E_BASE_URL`, default
  `http://localhost:5173`) and `permission-guard` (offline self-test of the
  permission-denied guard). `npm run test:e2e:messaging` runs the messaging
  layout harness.
- The embedded `brainflow_service/` and its pytest suite are inherited from the
  shared `brainflow-service` repository and are not owned by this repo. Do not
  change them here. `npm run test:brainflow:integration` (with a service on
  `127.0.0.1:8000`) runs the two service-backed Vitest files; see the
  [README checks](../../../../README.md#checks).

Playwright uses the system Google Chrome at `/usr/bin/google-chrome`, except
in the WebKit projects, keeps video disabled, and retains traces/screenshots
only for failures.

## Local emulator suite

`npm run test:e2e:protocol` starts the Auth and Firestore emulators (project
`demo-neurasticity-protocol-e2e`), Vite on port 5193 with
`VITE_E2E_EMULATORS=true`, and every `*.local.spec.ts` matched by
`playwright.protocol.config.ts`. It needs Java 21 on `PATH`. The browser
Firebase setup refuses any other project in emulator mode. Accounts are created
fresh in the emulators and disappear when they stop. See
[e2e/PROTOCOL.md](../../../../e2e/PROTOCOL.md).

Extra arguments to `npm run test:e2e:protocol` go to `firebase emulators:exec`,
not Playwright. For a single file or reporter flags, run
`npx firebase emulators:exec --only auth,firestore --project demo-neurasticity-protocol-e2e "npx playwright test --config playwright.protocol.config.ts <file>"`.

Browser specs import `test` from `e2e/fixtures.ts`, so console, page and
Firestore network permission denials fail the test, including denials in
additional browser contexts. Specs that probe a deliberate denial call
`permissionErrorGuard.expectDenialsIn` for that context only.

## Reusable helpers

- `e2e/helpers/auth.ts`: `loginThroughUi`, `arriveAtPatientDashboard` (skips
  headset setup when shown), `startPatientTrainingInDemoMode`,
  `arriveAtClinicianDashboard`.
- `e2e/helpers/localEmulator.ts`: emulator environment guard, Admin app and
  seeders for the local suite.
- `e2e/helpers/persistenceAssertions.ts` and `authorizedFirestore.ts`: confirm
  through the signed-in page, using its own ID token and the same Firestore
  rules, that data the UI reports as saved reached Firestore.
- `e2e/helpers/firestoreProbe.ts`: in-page allowed/denied read probes.
- `e2e/helpers/cacheIsolation.ts`: in-page probes of the persistent Firestore
  cache on the app's own instance (cached, listener and offline reads, an
  IndexedDB scan), used by `cache-isolation.persistence.local.spec.ts` to show
  that one account cannot read another's cached data after a sign-out,
  account switch or account deletion.

## Consumer repository tests

`tests/consumer-repositories/` runs the real consumer repositories
(`src/consumer/repositories/`) against the local Auth and Firestore emulators
(project `demo-nfct-repositories`), with the real `firestore.rules` loaded, so
the repositories and the rules are checked together. The harness refuses to
run without loopback emulator hosts. It needs Java 21:

```bash
JAVA_HOME=~/.local/share/temurin-jre-21 PATH=$JAVA_HOME/bin:$PATH npm run test:repositories
npm run test:repositories:typecheck
```

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
paths. `policy/` pins behavior that is a product decision so a change to it is
deliberate. Set `RULES_FILE=<path>` to run the same suite against another
ruleset.
