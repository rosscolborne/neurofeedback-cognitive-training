# Local protocol and reward Playwright coverage

Run `npm run test:e2e:protocol` from the repository root. The command starts local Firebase Auth and Firestore emulators, Vite on port 5193, and the isolated `protocol.local.spec.ts` suite. Java 21 is required for Firestore; set `PATH` to include a local JRE when necessary.

The suite uses the `demo-neurasticity-protocol-e2e` project ID, creates fresh clinician and patient accounts in the emulators, and signs in through the normal UI. It never uses `.env.e2e`, stored authentication states, shared Firebase accounts, or deployed rules. The browser Firebase setup and fixture helper both reject other project IDs or missing emulator settings. Data disappears when the emulators stop.

This suite covers assignment, reload, patient details, Demo training, telemetry, and malformed persisted rules. Exact spectral calculations, frequency boundaries, and rolling percentage math remain in Vitest. Headset acquisition and signal quality require manual hardware testing.
