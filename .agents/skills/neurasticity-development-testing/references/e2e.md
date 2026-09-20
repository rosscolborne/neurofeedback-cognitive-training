# Neurasticity E2E testing

## Current test entry points

- `npm run test` runs Vitest.
- `npm run test:python` runs the pytest suite through `uv`.
- `npm run lint` and `npm run build` provide the repository's lint and TypeScript/build checks.
- Playwright tests are in `e2e/`; configuration is in `playwright.config.ts`.

Playwright uses the system Google Chrome at `/usr/bin/google-chrome`, keeps video disabled, and retains traces/screenshots only for ordinary test failures. It does not start a development server. Start the app manually at the URL configured by `E2E_BASE_URL`, which defaults to `http://localhost:5173`.

## Projects and authentication

`public` covers unauthenticated tests. `patient` and `clinician` depend on authentication setup projects and load their respective storage states. The commands are:

```bash
npm run test:e2e:auth
npm run test:e2e:patient
npm run test:e2e:clinician
```

Auth setup reads local `.env.e2e` and saves ignored storage states under `e2e/.auth/`. Never commit, print, attach, or inspect credentials or storage-state contents. Run `npm run test:e2e:auth` to refresh the states when they expire. Auth setup has trace and screenshot capture disabled to avoid credential exposure.

Tests that need a different local server may set `E2E_BASE_URL` for the command, for example `E2E_BASE_URL=http://localhost:5174 npm run test:e2e:patient`.

## Reusable helpers

`e2e/helpers/auth.ts` provides:

- `loginThroughUi` for real login setup only;
- `arriveAtPatientDashboard`, which conditionally skips headset setup;
- `startPatientTrainingInDemoMode`, which conditionally selects supported Demo Mode;
- `arriveAtClinicianDashboard`.

Authenticated specs should normally rely on the `patient` or `clinician` project state and use the dashboard/training helpers rather than handling credentials. Do not use the demo clinician shortcut as a substitute for the dedicated clinician E2E identity.
