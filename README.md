# Neurasticity

Neurasticity includes its BrainFlow acquisition and analysis service. The
application talks to that service locally; it does not require the former
Render deployment.

## Local development

Install the web app dependencies:

Neurasticity's current Vite toolchain requires Node.js 20.19+ (or 22.12+),
plus Python 3.11+ with `uv`.

```bash
npm install
```

Then start the complete app (the BrainFlow service and Vite frontend) with:

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

The frontend calls `http://127.0.0.1:8000` by default. To use another local
address or port, set `VITE_BRAINFLOW_SERVICE_URL` in `.env.local`.

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
