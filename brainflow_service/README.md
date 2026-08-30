# brainflow_service

A standalone Python package that turns raw EEG (via [BrainFlow](https://brainflow.org))
into finished, display-ready scores: **mindfulness**, **restfulness**,
**focus**, **relax**, a **valence/arousal** proxy with calibration, a
**baseline-relative training score**, and a **headset fit / signal
quality** assessment. It has no dependency on the bundled React app -- run
it as an HTTP/SSE service and call it from any front-end, or import its
modules directly into your own Python backend.

Both calibrated features (valence/arousal, and training) use the same
normalization strategy -- `baseline.py`'s median/MAD z-score, described
below. There is intentionally only this one normalization approach in the
package, not two.

For install/versioning instructions and a front-end-facing quick start, see
the [repo root README](../README.md#using-this-service-from-another-front-end).
This document is the module-by-module reference: what each file does and
exactly which functions/classes to call.

## Pipeline at a glance

```
raw EEG samples
  -> dsp.py             preprocessing, band-power extraction, BrainFlow ML metrics
  -> headset_fit.py      per-channel + overall signal quality
  -> baseline.py           shared median/MAD z-score normalization, used by both:
  -> metrics.py              focus/relax + mindfulness/restfulness smoothing
  -> affective_state.py      valence/arousal, calibration, state labelling
  -> training.py              baseline-relative training score
  -> analysis.py          analyze_window() ties the four boxes above into one
                           per-connection pipeline, shared by both transports:
  -> models.py           the pydantic response shapes above get returned as
  -> app.py                ...over HTTP/SSE, via runtime.py (BrainFlow) and
                              analysis.py's AnalysisSessionStore (Bluetooth)
```

`app.py`/`runtime.py`/`analysis.py` are the only pieces that know about
BrainFlow hardware sessions or HTTP. Everything else is plain,
dependency-light scoring math you can call directly.

**Both connection methods get identical smoothing.** A direct BrainFlow
connection (`runtime.BrainFlowSession`) and a Bluetooth connection
(`analysis.AnalysisSessionStore`, behind the `/headset-fit/sessions/*`
endpoints) each own one `analysis.AnalysisProviders` -- the same
`AffectiveStateProvider`/`AttentionBaselineProvider`/
`HeuristicHeadsetFitProvider` bundle -- and both push every window through
the same `analysis.analyze_window()`. There's exactly one implementation of
the EMA smoothing/calibration/baselines, not two that could drift apart;
the bundled front end doesn't recompute any of this itself, it just relays
whatever `features`/`training` a frame already carries.

## Running it as a service

```bash
uv sync
uv run uvicorn brainflow_service.app:app --host 0.0.0.0 --port 8000
```

Set `EEG_BRAINFLOW_CORS_ORIGINS` (comma-separated) to allow a front-end
running on a different origin; see the root README for the full install/run
walkthrough, including installing this package from GitHub into another
Python project.

### HTTP/SSE endpoints (`app.py`)

| Endpoint | What it does |
|---|---|
| `GET /health` | Liveness check. |
| `GET /devices` | Lists configured BrainFlow devices (`config.DEVICE_CONFIGS`). |
| `POST /analyze-window` | Stateless: score one raw EEG window. No smoothing/calibration/stability (there's no session to hold that state). Body: `{sampleRateHz, samples}` (`samples` row-major: one inner list per time sample, across channels). Returns `{features, quality}`. Its `quality` is calibrated for BrainFlow's own scale -- prefer the session-scoped Bluetooth endpoints below for a live connection, especially one collected over Web Bluetooth. |
| `POST /headset-fit/sessions` | Starts a stateful analysis session for one Muse Athena connected over Bluetooth (any Bluetooth stack, not just this repo's bundled provider) -- headset fit, plus the same smoothed scores and Training baseline a BrainFlow session gets, all via `analysis.AnalysisProviders`. Returns `{fitSessionId}`. |
| `POST /headset-fit/sessions/{id}/analyze-window` | The Bluetooth counterpart of `GET /sessions/{id}/stream`: runs one window through `analysis.analyze_window()` using this session's providers. Body: `{sampleRateHz, samples, channelIds}` (`channelIds` as below). Returns `{features, quality, training}`, all smoothed/calibrated the same way a BrainFlow session's frames are. Supersedes calling `/analyze-window` and `.../assess` separately. |
| `POST /headset-fit/sessions/{id}/assess` | Fit only, no smoothing: scores one window of raw Bluetooth-collected EEG against `headset_fit.BLUETOOTH_HEADSET_FIT_THRESHOLDS` -- a different scale than `/analyze-window`'s BrainFlow-calibrated default, because the Elata Web Bluetooth SDK's Athena decoder reports EEG in different absolute units than BrainFlow's board driver does for the same physical contact (see the doc comment on `BLUETOOTH_HEADSET_FIT_THRESHOLDS`). Body: `{samples, channelIds}` -- `channelIds` is one label per column of `samples` (e.g. `["TP9","AF7","AF8","TP10"]`, or that plus `AUX1`-`AUX4` for the raw 8-channel Athena stream; non-electrode channels are dropped server-side, see `select_scalp_electrode_indices`). Returns a `SignalQualityMetadata` with `state`/`ready`/`worn`/`blockers`/`channels` filled in -- `ready` only turns `true` after sustained good contact across repeated calls on the same `fitSessionId`, the way a BrainFlow session's does. |
| `POST /headset-fit/sessions/{id}/calibration/start` | Begin collecting this Bluetooth session's valence/arousal baseline (24 windows) -- the Bluetooth counterpart of `POST /sessions/{id}/calibration/start` below. |
| `POST /headset-fit/sessions/{id}/calibration/reset` | Clear the baseline and stop calibrating. |
| `GET /headset-fit/sessions/{id}/calibration` | Current `{status, progress, required}` for this Bluetooth session. |
| `DELETE /headset-fit/sessions/{id}` | Stops and releases an analysis session. Idle sessions are also evicted automatically after ~2 minutes of disuse. |
| `POST /sessions` | Starts a live BrainFlow board session. Body: `{deviceId, macAddress?, serialNumber?}`. Returns `{sessionId, state, deviceInfo}`. |
| `GET /sessions/{id}/stream` | Server-Sent Events stream of normalized `signalFrame` events (each with smoothed/calibrated `features` and `quality`), plus `state` and `error` events. |
| `DELETE /sessions/{id}` | Stops and releases a session. |
| `POST /sessions/{id}/calibration/start` | Begin collecting a valence/arousal baseline (24 windows). |
| `POST /sessions/{id}/calibration/reset` | Clear the baseline and stop calibrating. |
| `GET /sessions/{id}/calibration` | Current `{status, progress, required}` (`status`: `"off"` \| `"collecting"` \| `"active"`). |
| `GET /sessions/{id}/training/calibration-profile` | The Training feature's baseline snapshot (`CalibrationProfile`), or `null` until it fills. Collection starts automatically -- there's no start/reset control here. |

`features` (a `SignalFeatures`), `quality` (a `SignalQualityMetadata`), and
each SSE `signalFrame`'s `training` (an `AttentionMetricSampleModel`) are
the objects everything below produces. Field-by-field descriptions are in
`models.py`'s docstrings/comments and the root README's endpoint table.

## Using it as a library

Each module below is independently importable and has no BrainFlow/hardware
dependency unless noted.

### `dsp.py` -- preprocessing and feature extraction (needs `brainflow`, falls back gracefully if it's missing)

| Function | Call it when you have... | Returns |
|---|---|---|
| `build_eeg_window(data, eeg_channels, samples)` | a raw BoardShim `(channels, samples)` array and want the last N samples for just the EEG channels | `np.ndarray \| None` |
| `preprocess_eeg_window(window, sampling_rate, config=DEFAULT_PROCESSING)` | a raw EEG window and want it detrended + bandpass/notch filtered | filtered `np.ndarray` |
| `extract_band_power_features(window, sampling_rate, bands=DEFAULT_BANDS)` | a preprocessed window and want delta/theta/alpha/beta/gamma power | `BandPowerFeatures \| None` (absolute, relative, ratios) |
| `extract_brainflow_mindfulness(window, sampling_rate)` | a **raw, unfiltered** window and want BrainFlow's native mindfulness classifier score | `float \| None`, 0-1 |
| `extract_brainflow_restfulness(window, sampling_rate)` | same, for restfulness | `float \| None`, 0-1 |

`extract_brainflow_mindfulness`/`restfulness` must be called with the raw
window, not the output of `preprocess_eeg_window` -- see the docstring on
`extract_brainflow_mental_state` for why (BrainFlow's classifiers expect
their own internal filtering).

### `metrics.py` -- focus/relax and mindfulness/restfulness scoring (pure math, no dependencies)

| Function/class | Call it when you have... | Returns |
|---|---|---|
| `compute_neurofeedback_scores(theta_power, alpha_power, beta_power)` | band powers for one window and want focus/relax | `NeurofeedbackScores` (0-100 scores + signed pre-score values) |
| `normalize_brainflow_score(value)` | a raw 0-1 BrainFlow mindfulness/restfulness value and want it as 0-100 | `float \| None` |
| `smooth_score(current, target, weight)` | you're maintaining your own EMA state | smoothed `float` |
| `MindStateSmoother(smoothing_alpha=0.05)` | a **session** (repeated windows over time) and want all four headline scores smoothed the way the bundled app displays them | instantiate once per session; call `.push(theta_power=, alpha_power=, beta_power=, raw_mindfulness=, raw_restfulness=)` each window, returns `MindStateScores`; call `.reset()` to clear |

### `baseline.py` -- shared robust baseline normalization (pure math, no dependencies)

The one normalization strategy used everywhere a raw value gets compared
against a rolling baseline: collect up to `sample_count` values, compute a
**median center and MAD-based spread** (robust to outliers -- unlike a raw
mean/stddev, a few noisy windows don't distort the baseline), then map new
values to a z-score and squash that through `tanh`.

| Function/class | Call it when you have... | Returns |
|---|---|---|
| `median(values)` | a list of floats | `float` |
| `compute_robust_stats(values)` | a baseline's collected values | `RobustStats(center, spread) \| None` -- `None` if fewer than 4 values, or the baseline has no real spread (e.g. constant input) |
| `z_score(value, stats)` | a value and `RobustStats` (or `None`) | `float \| None` |
| `map_z_score_to_score(z, scale=1.5)` | a z-score, want a 0-100 score centered at 50 | `float \| None` |
| `BaselineCollector(sample_count=24)` | accumulating a baseline over a session | `.accept(value)`, `.median()`, `.stats()`, `.is_full`, `.collected`, `.reset()` -- collection freezes once full, matching the TS behavior of a fixed (not sliding) baseline window |

`affective_state.py` and `training.py` both build on this rather than each
having their own baseline math. The bundled app's `affectiveStateMetric.ts`
relays these already-calibrated scores straight through for a real
connection instead of recomputing them; its own local calibration (a
simpler flat-offset, not this module's z-score) only runs as a fallback for
sources with no server behind them at all, like the Mock provider.

### `affective_state.py` -- valence/arousal, calibration, state labelling (built on `metrics.py` and `baseline.py`)

| Function/class | Call it when you have... | Returns |
|---|---|---|
| `map_ratio_to_axis(ratio)` | a band-power ratio and want it mapped to a -1..1 axis | `float` |
| `classify_affective_state(valence, arousal)` | a valence/arousal point and want the nearest named region (`"Calm"`, `"Tense"`, ..., or `"Neutral"` near the origin) | `str` |
| `estimate_confidence(valence, arousal, quality_factor=1.0)` | a valence/arousal point (and optionally `confidence_quality_factor(fit)`) | `float`, 0-1 |
| `confidence_quality_factor(fit: FitQualityHint \| None)` | a `headset_fit.HeadsetFitSnapshot`'s `ready`/`state`, wrapped in a `FitQualityHint` | `float` multiplier for `estimate_confidence` |
| `compute_raw_affective_sample(theta_power, alpha_power, beta_power, gamma_power)` | band powers for **one window, no session** | `RawAffectiveSample \| None` (unsmoothed valence/arousal/label/confidence) |
| `AffectiveStateProvider(smoothing_alpha=0.05, calibration_sample_count=24, z_score_scale=1.5)` | a **session** and want the full set (valence/arousal + the four headline scores, smoothed and calibrated) | see below |

`AffectiveStateProvider` is the one class most integrations want for a live
session -- it wraps `MindStateSmoother` internally, so a single call gives
you everything:

```python
from brainflow_service.affective_state import AffectiveStateProvider, FitQualityHint

provider = AffectiveStateProvider()
provider.start_calibration()          # optional; collects a 24-window baseline

sample = provider.push(
    at_ms=..., theta_power=..., alpha_power=..., beta_power=..., gamma_power=...,
    raw_mindfulness=...,               # from dsp.extract_brainflow_mindfulness, or None
    raw_restfulness=...,               # from dsp.extract_brainflow_restfulness, or None
    reliable=True,                     # False (e.g. from a headset_fit excessive_artifact) skips this window
    fit=FitQualityHint(ready=..., state=...),  # optional, folds real signal quality into confidence
)
# sample.valence, .arousal, .label, .confidence, .calibration_active,
# .mindfulness_score, .restfulness_score, .focus_score, .relax_score

provider.get_calibration_state()   # -> AffectiveCalibrationState(status, progress, required)
provider.reset_calibration()
provider.reset()                   # clears everything, including the internal MindStateSmoother
```

Once calibration is active, `valence`/`arousal` are the raw axis' z-score
against the collected baseline (via `baseline.py`), mapped back into
`-1..1` with `tanh` -- not a flat `raw - median` offset. A perfectly flat
baseline (zero spread) never activates calibration; it just keeps
collecting, since `compute_robust_stats` returns `None` for that case
rather than a degenerate near-zero spread.

### `training.py` -- baseline-relative attention scoring, for the Training feature (built on `metrics.py` and `baseline.py`)

Answers a different question from `AffectiveStateProvider`: not "what's the
live score" but "relative to this session's own baseline, is it higher or
lower right now". Every score is `null` until its own baseline has enough
samples with real spread (typically a few seconds) -- there's no raw/
unbaselined fallback mode.

| Function/class | Call it when you have... | Returns |
|---|---|---|
| `AttentionBaselineProvider(smoothing_alpha=0.05, baseline_sample_count=24, z_score_scale=1.5)` | a **session** and want baseline-relative mindfulness/restfulness/focus/relax | instantiate once per session |
| `.push(at_ms=, theta_power=, alpha_power=, beta_power=, raw_mindfulness=, raw_restfulness=, reliable=True)` | one window | `AttentionMetricSample \| None` |
| `.get_calibration_profile()` | want the locked-in baseline snapshot | `AttentionCalibrationProfile \| None` -- non-`None` once the ratio baseline fills (24 windows); diagnostic metadata, doesn't gate scoring |
| `.reset()` | starting a new session | clears everything |
| `to_attention_metric_sample_model(sample)` / `to_calibration_profile_model(profile)` | converting to the pydantic shapes used on the wire | `AttentionMetricSampleModel` / `CalibrationProfile` |

Baseline collection starts automatically from the first pushed window --
unlike `AffectiveStateProvider`'s calibration, there's no explicit start/
reset call.

```python
from brainflow_service.training import AttentionBaselineProvider

provider = AttentionBaselineProvider()
sample = provider.push(
    at_ms=..., theta_power=..., alpha_power=..., beta_power=...,
    raw_mindfulness=..., raw_restfulness=...,
)
# sample.displayed_score, .restfulness_score, .focus_score, .relax_score  (each nullable)
# sample.baseline_z_score, .baseline_relative_value  -- diagnostics
```

### `headset_fit.py` -- signal quality / headset fit (pure math, no dependencies)

| Function/class | Call it when you have... | Returns |
|---|---|---|
| `HeuristicHeadsetFitProvider(thresholds=DEFAULT_HEADSET_FIT_THRESHOLDS)` | a **session** and want per-channel + overall fit quality, including a stability timer | instantiate once per session |
| `.update(channels=, samples=, now_ms=None)` | one window's channel list + raw samples | `HeadsetFitSnapshot` (`state`, `ready`, `worn`, `excessive_artifact`, `blockers`, per-channel `channels`, `stable_for_ms`) |
| `.reset()` | starting a new session/fit check | clears the stability timer |
| `to_signal_quality_metadata(snapshot)` | a `HeadsetFitSnapshot` and want the pydantic `SignalQualityMetadata` used on the wire | `SignalQualityMetadata` |

```python
from brainflow_service.headset_fit import HeuristicHeadsetFitProvider

fit_provider = HeuristicHeadsetFitProvider()
snapshot = fit_provider.update(channels=device_channels, samples=eeg_window_samples)
# snapshot.state: "poor" | "adjusting" | "good" | "ready"
# snapshot.excessive_artifact -> feed into AffectiveStateProvider.push(reliable=...)
# snapshot.ready / snapshot.state -> feed into FitQualityHint for confidence
```

For a **single, stateless** assessment (no session), just use a fresh
instance -- `ready` will always be `False` since readiness requires
sustained good contact over `thresholds.stable_ready_ms`, which one window
can't demonstrate. This is exactly what `/analyze-window` does.

`DEFAULT_HEADSET_FIT_THRESHOLDS` is calibrated for BrainFlow's own board
driver. `BLUETOOTH_HEADSET_FIT_THRESHOLDS` is a second profile for EEG
collected via the Elata Web Bluetooth SDK's Athena decoder instead, which
reports the same physical contact state at roughly 1/4-1/7th the absolute
scale (see the doc comment on `BLUETOOTH_HEADSET_FIT_THRESHOLDS` for the
paired worn/unworn measurements this was calibrated against) -- see
`analysis.py` below for what hands out
`HeuristicHeadsetFitProvider(BLUETOOTH_HEADSET_FIT_THRESHOLDS)` instances,
one per Bluetooth connection. `select_scalp_electrode_indices` drops
non-electrode channels (the Athena stream's AUX1-4) before scoring, given a
list of channel labels.

### `analysis.py` -- the shared per-connection pipeline (needs `brainflow` for full feature extraction, falls back gracefully)

The one place a raw EEG window becomes headset fit + smoothed scores +
Training's baseline score, used by *both* transports so their smoothing
can't drift apart.

| Function/class | Call it when you have... | Returns |
|---|---|---|
| `AnalysisProviders(headset_fit, affective_state=AffectiveStateProvider(), attention=AttentionBaselineProvider())` | one live connection's whole lifetime and want to bundle its stateful providers together | dataclass; construct once per connection |
| `analyze_window(providers=, channels=, eeg_samples=, raw_window=, sample_rate=, processing=DEFAULT_PROCESSING, at_ms=None)` | one window plus the connection's `AnalysisProviders` | `WindowAnalysis(fit_snapshot, quality, features, training)` -- `features`/`training` are `None` when `raw_window` is `None` (fit is still assessed) |
| `AnalysisSessionStore(idle_timeout_s=120.0)` | registering one `AnalysisProviders` per Bluetooth connection, keyed by an opaque id | `.create(thresholds=BLUETOOTH_HEADSET_FIT_THRESHOLDS)` -> `session_id`; `.get(session_id)` -> `AnalysisProviders` (raises `KeyError` if unknown/evicted); `.stop(session_id)` |

`runtime.BrainFlowSession` and `app.py`'s `/headset-fit/sessions/{id}/analyze-window`
both call `analyze_window()` with their own connection's `AnalysisProviders`
-- neither reimplements the smoothing/calibration/baseline math itself.

### `runtime.py` -- BrainFlow session lifecycle and HTTP/SSE wiring (needs `brainflow`)

| Class | Use it for |
|---|---|
| `BrainFlowSession(config, mac_address=None, serial_number=None, processing=DEFAULT_PROCESSING)` | Owns one BoardShim session end-to-end: `.prepare()` connects and returns `DeviceInfo`, `.start()` begins streaming, `.frames()` is an async generator of normalized `SignalFrame`s (each already scored via `analysis.analyze_window()` and its own internal `AnalysisProviders`), `.stop()` releases it. Also exposes `.start_calibration()`, `.reset_calibration()`, `.get_calibration_state()`, `.get_training_calibration_profile()`. |
| `SessionStore()` | In-memory registry of active sessions, used by `app.py`: `.create(device_id, **kwargs)`, `.get(session_id)`, `.stop(session_id)`, `.stop_all()`. |

If you want the raw hardware pipeline without running the HTTP service, use
`BrainFlowSession` directly:

```python
import asyncio
from brainflow_service.config import DEVICE_CONFIGS
from brainflow_service.runtime import BrainFlowSession

async def main():
    session = BrainFlowSession(DEVICE_CONFIGS["brainflow-synthetic"])  # or "brainflow-muse-athena"
    try:
        session.prepare()
        session.start()
        async for frame in session.frames():
            print(frame.features.mindfulness_score, frame.features.focus_score)
    finally:
        session.stop()

asyncio.run(main())
```

### `config.py` -- device and processing configuration (no dependencies)

- `DEVICE_CONFIGS`: dict of supported devices (`"brainflow-muse-athena"`, `"brainflow-synthetic"`).
- `DEFAULT_BANDS`: the delta/theta/alpha/beta/gamma `FrequencyBand`s used everywhere above.
- `ProcessingConfig`/`DEFAULT_PROCESSING`: window size, filter settings.

### `models.py` -- the pydantic response shapes

`SignalFrame`, `SignalFeatures`, `SignalQualityMetadata`,
`ChannelSignalQualityModel`, `DeviceInfo`, `AffectiveCalibrationStateResponse`,
`AttentionMetricSampleModel`, `CalibrationProfile` (the Training feature's
baseline snapshot), etc. These are what `app.py` serializes over HTTP/SSE (`by_alias=True`, so
JSON keys are camelCase even though the Python attributes are snake_case).
If you're consuming the HTTP API directly you mostly don't need to import
these; if you're embedding this package in another Python service, they're
the types your code will pass around.

## Quick recipes

- **"I have a live BrainFlow board and want scored frames"** -> `runtime.BrainFlowSession`, or just run the service and consume `/sessions/{id}/stream`.
- **"I have one window of raw samples and just want scores, no session"** -> `dsp.extract_band_power_features` + `metrics.compute_neurofeedback_scores` + `affective_state.compute_raw_affective_sample`, or just call `POST /analyze-window`.
- **"I already have band powers from somewhere else and just want the scoring math"** -> `metrics.py`/`affective_state.py`/`training.py`/`baseline.py` have no BrainFlow or hardware dependency; call them directly.
- **"I want to know if the headset is worn well enough to trust readings"** -> `headset_fit.HeuristicHeadsetFitProvider`.
- **"I want a session-relative training score, not just the live one"** -> `training.AttentionBaselineProvider`, or `GET /sessions/{id}/training/calibration-profile` for its baseline snapshot.

## Tests

```bash
uv sync --extra test
uv run pytest
```

Tests that exercise BrainFlow's native ML classifiers or the FastAPI
`TestClient` skip automatically if `brainflow`/`httpx` aren't installed
(`pytest.importorskip`).
