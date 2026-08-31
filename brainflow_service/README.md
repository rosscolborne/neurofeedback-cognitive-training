# Neurasticity BrainFlow Service

The local FastAPI service that acquires Muse Athena EEG through BrainFlow, or
accepts EEG collected by another Bluetooth client. Both paths use the same
window-analysis pipeline.

## What it provides

- BrainFlow board lifecycle and SSE streaming for Muse Athena and the
  synthetic development board.
- EEG preprocessing and Welch band powers: delta, theta, alpha, SMR, beta,
  and gamma.
- BrainFlow mindfulness and restfulness classifiers, plus smoothed focus and
  relax scores.
- Smoothed valence/arousal estimates, affective label, and confidence.
- Headset-fit and artifact assessment.
- Interhemispheric coherence for Muse AF7↔AF8 and TP9↔TP10 pairs.
- Protocol feedback: theta/beta ratio, in-zone state, and zone score.

The service deliberately has no calibration or baseline-relative training
score. Its values are live measurements; consumers must not substitute a
placeholder when one cannot be computed.

## API

| Endpoint | Purpose |
|---|---|
| `GET /health` | Service availability check. |
| `GET /devices` | Available BrainFlow board configurations. |
| `POST /sessions` | Start a direct BrainFlow board session. |
| `GET /sessions/{id}/stream` | Receive state and scored `signalFrame` SSE events. |
| `DELETE /sessions/{id}` | Stop and release a direct session. |
| `POST /analyze-window` | Analyze one stateless, row-major EEG window. |
| `POST /headset-fit/sessions` | Start a stateful analysis session for externally acquired Bluetooth EEG. |
| `POST /headset-fit/sessions/{id}/assess` | Run a fit-only assessment. |
| `POST /headset-fit/sessions/{id}/analyze-window` | Run stateful analysis for a Bluetooth EEG window. |
| `DELETE /headset-fit/sessions/{id}` | Stop a Bluetooth analysis session. |

The stateless endpoint has no channel labels, so it cannot produce
Muse-specific side guidance or interhemispheric coherence. Use one of the
session endpoints for live EEG.

## Structure

- `runtime.py` — BrainFlow board lifecycle and SSE frames.
- `analysis.py` — shared live window-to-features pipeline.
- `dsp.py` — filtering, band powers, BrainFlow classifiers, and coherence.
- `affective_state.py` — live smoothing for the headline and affective
  metrics; no calibration state.
- `headset_fit.py` — contact-quality assessment.
- `metrics.py` — protocol feedback calculations.
- `app.py` — HTTP API.

## Tests

```bash
uv run --extra test pytest tests/test_brainflow_pipeline.py
```
