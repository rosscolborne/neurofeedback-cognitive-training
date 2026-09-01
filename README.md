# Neurasticity

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

The Chrome Bluetooth chooser appears before the app contacts Render. If Render
is cold or unavailable, the headband connection remains usable and the app
temporarily uses its browser-side metric fallback; it does not try to contact
the visitor's localhost.

## Checks

```bash
npm run build
npm test
npm run test:python
```

The browser integration tests expect the local service to be running.

## BrainFlow service

The FastAPI service source is in `brainflow_service/`; its endpoints and
signal-processing behavior are documented in
[brainflow_service/README.md](brainflow_service/README.md).
