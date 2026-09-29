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
  separate EEG recording) will be built new.
- **EEG is optional.** It must never be required to play and must never drive
  game scores, progression, unlocks or achievements.
- Do not deploy anything (Firebase, Vercel, Render, App Store) or link this
  repository to Waveable's hosting, Render service or Xcode Cloud workflows.

## Checks

```bash
npm ci --legacy-peer-deps
npm run check:isolation && npm run lint && npm run build && npm test
npm run test:e2e:typecheck && npm run test:rules:typecheck
npm run test:rules            # needs Java 21
npm run test:e2e:protocol     # local emulator browser suite; needs Java 21
```

More detail: [.agents/skills/neurasticity-development-testing](.agents/skills/neurasticity-development-testing/SKILL.md).

## Running locally

There is no NFCT Firebase project configured yet, so the app runs only against
the emulators until one is set up in `.env.local`:

```bash
npx firebase emulators:start --only auth,firestore --project demo-neurasticity-protocol-e2e
VITE_E2E_EMULATORS=true VITE_FIREBASE_PROJECT_ID=demo-neurasticity-protocol-e2e \
  VITE_FIREBASE_API_KEY=local-test-key npx vite --host 127.0.0.1 --port 5193
```
