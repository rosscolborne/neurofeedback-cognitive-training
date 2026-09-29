# Neurasticity

> **This is the `neurofeedback-cognitive-training` (NFCT) consumer fork.** It
> was forked from the Waveable clinical repository on 2026-09-29 and is being
> migrated; the text below still describes the inherited app. Read
> [AGENTS.md](AGENTS.md) and [docs/nfct/FORK.md](docs/nfct/FORK.md) first.

Neurasticity connects a Muse Athena directly from the user's Chrome or Edge
browser. It can send the browser-collected EEG windows to its BrainFlow
analysis service for the shared smoothing, mindfulness, restfulness, fit, and
training calculations. The service never attempts to use Bluetooth itself.

## Local development

Install the web app dependencies:

Neurasticity's current Vite toolchain requires Node.js 20.19+ (or 22.12+),
plus Python 3.11+ with `uv`.

```bash
npm install
```

Then start the complete app (the BrainFlow analysis service and Vite frontend)
with:

```bash
npm run dev
```

Vite prints the browser URL, normally `http://localhost:5173`. Press
`Ctrl+C` once to stop both processes.

To run only one side for troubleshooting:

```bash
npm run brainflow  # backend only
npm run dev:web    # frontend only
```

## EEG acquisition console

The development-only EEG Acquisition Console is a separate page for raw EEG
acquisition, hardware-provider validation, recording, replay, live plots, and
signal-quality debugging. It uses the same local BrainFlow service as
Neurasticity, but does not form part of the patient or clinician UI.

```bash
npm run debug_console
```

This opens the console at `http://127.0.0.1:5174/debug-console.html`. It
uses a healthy local service on port 8000 when one is already running;
otherwise it starts one. Stop it with `Ctrl+C`.

Local development defaults to `http://127.0.0.1:8000`. To use another address
or port, set `VITE_BRAINFLOW_SERVICE_URL` in `.env.local`. When that variable
is set, `npm run dev` health-checks the configured service, prints its URL, and
does not launch the local BrainFlow process. It exits instead of silently
falling back when the configured service is unavailable.

## Vercel + Render deployment

Deploy `render.yaml` as a Render web service. Then add
`VITE_BRAINFLOW_SERVICE_URL` to the Vercel project's environment variables,
using the public HTTPS URL of that Render service, and redeploy the frontend.
The URL is included when Vite builds the app, so setting it without a new
deployment does not update an already-published site.

The app verifies the Render service before opening the Chrome Bluetooth chooser.
If Render is unavailable, the headset connection does not start and no local or
browser-derived metrics are substituted.

## Checks

```bash
npm run build
npm test                 # offline Vitest suite
npm run test:python
```

`npm test` excludes the two service-backed Vitest files by name:
`backendFitE2E.test.ts` and `eegPipelineIntegration.test.ts`. They remain in
the dedicated BrainFlow integration suite. To run them, start the local service
in one terminal and request the suite in another:

```bash
npm run brainflow
npm run test:brainflow:integration
```

The dedicated command checks `/health` first and fails with a clear error if
the service is unavailable; it never silently skips either file. It uses
`http://127.0.0.1:8000` by default, regardless of `.env` or
`VITE_BRAINFLOW_SERVICE_URL`. For a service on another local port, set
`BRAINFLOW_TEST_URL=http://127.0.0.1:<port>` for that command. Only HTTP
loopback origins are accepted. The simulated BLE test does not use hardware.

Browser integration tests have their own service and environment requirements.

## BrainFlow service

The FastAPI service source is in `brainflow_service/`; its endpoints and
signal-processing behavior are documented in
[brainflow_service/README.md](brainflow_service/README.md).
