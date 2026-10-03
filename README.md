# Neurasticity

> **This is `neurofeedback-cognitive-training` (NFCT)**, the consumer
> cognitive-training app: games with optional Muse EEG, on the web and as an
> iPhone app. It was forked from the Waveable clinical repository on
> 2026-09-29 ([docs/nfct/FORK.md](docs/nfct/FORK.md)). Read
> [AGENTS.md](AGENTS.md) first: it has the checks and emulator-first local
> development ([Running locally](AGENTS.md#running-locally)).

EEG is optional. A Muse Athena connects directly from the user's Chrome or
Edge browser, and the app can send the browser-collected EEG windows to its
BrainFlow analysis service for headset fit and the mindfulness and
restfulness metrics. The service never attempts to use Bluetooth itself.

## BrainFlow development

Use Node.js 22 (`.nvmrc`) and, for the BrainFlow service, Python 3.11+ with
`uv`:

```bash
npm ci --legacy-peer-deps
```

To start the BrainFlow analysis service and the Vite frontend together:

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

The app reads two EEG metrics from that service: BrainFlow's mindfulness and
restfulness. Without a configured service a headset still connects and its fit
is checked in the browser, but no metrics are shown: none are ever estimated
outside BrainFlow.

## Checks

The full list of checks is in [AGENTS.md](AGENTS.md#checks). The inherited
BrainFlow service's own suite is `npm run test:python`.

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
