# Agent instructions: neurofeedback-cognitive-training (NFCT)

This is the **consumer cognitive-training product** (puzzle and cognitive
games with optional Muse EEG). It is **not** Waveable, the clinical product
it was forked from. See [docs/nfct/FORK.md](docs/nfct/FORK.md).

## Hard rules

- **Never use the Waveable clinical Firebase project** or any of its config,
  credentials, service accounts or deployed rules, and never add a default
  Firebase project. `src/services/firebaseConfig.ts` must keep failing closed.
  `npm run check:isolation` must stay green.
- **All Firebase-backed tests run against local emulators.** Do not add
  deployed-project E2E, service-account keys or `.env` files to the repo.
- **`brainflow_service/` is not owned here.** It is an inherited copy of the
  shared `brainflow-service` repository. Do not modify, refactor or extend it;
  backend changes go to `brainflow-service`.
- **The clinical data model is transitional.** Do not add fields to
  `clients/{uid}` / `ClientProfile` or `sessions/{id}` / `SessionRecord`, and do
  not extend `Protocol`, `Experience`, `allowedExperiences` or the self-directed
  plan to represent games. The consumer model (user profile, game session,
  separate EEG recording) is built new in `shared/` (`@nfct/shared`); see
  [ADR-001](docs/nfct/adr-001-consumer-domain-model.md). `shared/` imports
  only `zod` and its own modules.
- **EEG is optional.** It must never be required to play and must never drive
  game scores, progression, unlocks or achievements.
- Do not deploy anything (Firebase, Vercel, Render, App Store) or link this
  repository to Waveable's hosting, Render service or Xcode Cloud workflows.

## Working on a card

- Give each independent writable task or PR its own branch and git worktree,
  based on current `origin/main` unless it deliberately stacks on another PR.
  Never modify another task's worktree or uncommitted work.
- Stay within the Jira card's scope. Report meaningful unrelated work, or
  propose a card for it, instead of silently expanding the PR.
- Respect the canonical Stage 1 design, ADRs and the card's Jira contract. If
  the implementation conflicts with them, stop at that boundary and report the
  conflict; do not silently invent a new architecture.
- Do not add mock or fake data or silent fallbacks unless the card requires
  them. (Demo Mode's synthetic EEG is an existing, deliberate feature.) Never
  weaken production behavior just to make a test pass.
- Before opening or updating a PR, run the relevant [checks](#checks) and
  follow [Stage 1 test coverage](#stage-1-test-coverage).
- Do not merge your own PR. Independent reviews follow
  [nfct-pr-review](.agents/skills/nfct-pr-review/SKILL.md); exploratory
  browser QA follows [nfct-exploratory-qa](.agents/skills/nfct-exploratory-qa/SKILL.md).
- Finish with a report giving, where applicable: branch and worktree, commit
  SHA, PR URL, files and scope changed, checks and tests run with results, and
  unresolved risks, blockers or follow-ups.

## Checks

```bash
npm ci --legacy-peer-deps
npm run check:isolation && npm run lint && npm run build && npm test
npm run test:e2e:typecheck && npm run test:rules:typecheck
npm run test:rules            # needs Java 21
npm run test:e2e:protocol     # local emulator browser suite; needs Java 21
```

More detail: [.agents/skills/neurasticity-development-testing](.agents/skills/neurasticity-development-testing/SKILL.md).

## Stage 1 test coverage

Every user-facing Stage 1 card adds or updates deterministic Playwright
coverage of the behavior users see, or its PR explains why browser E2E does not
apply. Domain, security and backend cards use the lower layer that observes the
behavior instead of browser tests.

| Card | Coverage |
| --- | --- |
| NFCT-17 | Unit, property and simulation tests |
| NFCT-18 | Firestore emulator rules tests |
| NFCT-19 | Functions emulator integration tests |
| NFCT-20 | Repository tests against the emulators |
| NFCT-21, NFCT-22, NFCT-23, NFCT-6 | User-facing: update Playwright coverage |
| NFCT-10 | The canonical Stage 1 end-to-end Playwright journey |

- Keep Playwright tests deterministic. Where an injected or fake clock
  (`page.clock`) or another test seam exists, use it instead of real-time waits
  such as `page.waitForTimeout`.
- Keep the existing spec naming, so CI still discovers new specs: emulator
  specs are `*.local.spec.ts` matched by `testMatch` in
  `playwright.protocol.config.ts` (for example
  `session-history.persistence.local.spec.ts`).
- Cover the card's user-visible behavior. Do not add broad or flaky browser
  tests just to have E2E coverage.

## Running locally

Development is emulator-first. The NFCT dev Firebase project is `nfct-dev`
(Spark plan, `northamerica-northeast2`), but do not create a `.env.local` that
points ordinary development at it.

`.firebaserc` has a `dev` alias for `nfct-dev` and an `emulator` alias, and
deliberately no `default`. Keep at least two aliases: the Firebase CLI treats a
lone alias as the default. A bare `firebase deploy` therefore has no target.
Deploys to `nfct-dev` are manual, run by the owner after tests pass, and always
name it (`--project dev`). Never run `firebase use dev`: it saves an active
project for this directory, which a bare deploy would then use.

Run the app against the emulators:

```bash
npx firebase emulators:start --only auth,firestore --project demo-neurasticity-protocol-e2e
VITE_E2E_EMULATORS=true VITE_FIREBASE_PROJECT_ID=demo-neurasticity-protocol-e2e \
  VITE_FIREBASE_API_KEY=local-test-key npx vite --host 127.0.0.1 --port 5193
```
