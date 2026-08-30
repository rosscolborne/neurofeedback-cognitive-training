"""The one, shared window -> features pipeline behind every live EEG
connection this service serves -- a direct BrainFlow connection
(`runtime.BrainFlowSession`) and a Bluetooth connection (`AnalysisSessionStore`
below, driven by the `/headset-fit/sessions/*` endpoints in `app.py`).

Before this module existed, a direct BrainFlow connection got its headline
scores (mindfulness/restfulness/focus/relax, valence/arousal, and Training's
baseline-relative attention score) from stateful, per-session smoothing
(`affective_state.AffectiveStateProvider`, `training.AttentionBaselineProvider`),
while a Bluetooth connection was served by the stateless `/analyze-window`
endpoint, which has no session to smooth or calibrate across and so returned
raw, single-window scores. Both the frontend's `HeuristicHeadsetFitProvider`
sat on the same live-vs-stateless gap for headset fit until
`HeadsetFitSessionStore` closed it; `AnalysisSessionStore` here is the same
fix, extended to cover the rest of what a live connection needs.

`analyze_window` is now the *only* place that turns a raw EEG window into
those finished scores. `BrainFlowSession._normalize_frame` and the Bluetooth
`/headset-fit/sessions/{id}/analyze-window` endpoint both call it, each
handing it their connection's own `AnalysisProviders` -- so whichever
transport collected the EEG, the smoothing, calibration, and baselines are
the exact same code running against the exact same per-connection state,
not two implementations that can drift apart.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field

import numpy as np

from .affective_state import AffectiveStateProvider, FitQualityHint
from .config import DEFAULT_PROCESSING, ProcessingConfig
from .dsp import (
    extract_band_power_features,
    extract_brainflow_mindfulness,
    extract_brainflow_restfulness,
    extract_interhemispheric_coherence,
    preprocess_eeg_window,
)
from .headset_fit import (
    BLUETOOTH_HEADSET_FIT_THRESHOLDS,
    HeadsetFitSnapshot,
    HeadsetFitThresholds,
    HeuristicHeadsetFitProvider,
    to_signal_quality_metadata,
)
from .models import AttentionMetricSampleModel, SignalChannel, SignalFeatures, SignalQualityMetadata
from .training import AttentionBaselineProvider, to_attention_metric_sample_model
from .metrics import compute_training_feedback


@dataclass
class AnalysisProviders:
    """The stateful providers behind one live connection's whole lifetime --
    one instance per `BrainFlowSession` or per Bluetooth session. Keeping
    them bundled (rather than passed around separately) is what makes it
    natural for both connection paths to share `analyze_window` instead of
    each reimplementing which state goes with which score."""

    headset_fit: HeuristicHeadsetFitProvider
    affective_state: AffectiveStateProvider = field(default_factory=AffectiveStateProvider)
    attention: AttentionBaselineProvider = field(default_factory=AttentionBaselineProvider)


@dataclass(frozen=True)
class WindowAnalysis:
    fit_snapshot: HeadsetFitSnapshot
    quality: SignalQualityMetadata
    features: SignalFeatures | None
    training: AttentionMetricSampleModel | None


def analyze_window(
    *,
    providers: AnalysisProviders,
    channels: list[SignalChannel],
    eeg_samples: list[list[float]],
    raw_window: np.ndarray | None,
    sample_rate: int,
    processing: ProcessingConfig = DEFAULT_PROCESSING,
    at_ms: float | None = None,
    protocol: str = "theta-beta-ratio",
    threshold: float = 1.85,
) -> WindowAnalysis:
    """Turns one raw EEG window into a headset-fit assessment plus (when
    `raw_window` has enough samples) the finished, smoothed scores.

    `eeg_samples` is row-major (samples, channels) -- what the headset-fit
    heuristic wants. `raw_window` is the same data as a (channels, samples)
    array ready for band-power/BrainFlow-classifier extraction, or `None`
    when the caller doesn't yet have a full analysis window (e.g. a
    BrainFlow session's ring buffer hasn't filled) -- fit is still assessed
    in that case, just without features/training.
    """
    at_ms = time.time() * 1000.0 if at_ms is None else at_ms

    fit_snapshot = providers.headset_fit.update(channels=channels, samples=eeg_samples)
    quality = to_signal_quality_metadata(fit_snapshot)

    features: SignalFeatures | None = None
    training: AttentionMetricSampleModel | None = None

    if raw_window is not None:
        processed = preprocess_eeg_window(raw_window, sample_rate, processing)
        band_powers = extract_band_power_features(processed, sample_rate)
        theta_beta_ratio, in_zone, zone_score = compute_training_feedback(
            band_powers.absolute if band_powers else {}, protocol, threshold,
        )
        interhemispheric_coherence = extract_interhemispheric_coherence(
            processed, sample_rate, [channel.id for channel in channels],
        )
        brainflow_mindfulness = extract_brainflow_mindfulness(raw_window, sample_rate)
        brainflow_restfulness = extract_brainflow_restfulness(raw_window, sample_rate)

        if band_powers or brainflow_mindfulness is not None or brainflow_restfulness is not None:
            theta_power = band_powers.absolute.get("theta", 0.0) if band_powers else 0.0
            alpha_power = band_powers.absolute.get("alpha", 0.0) if band_powers else 0.0
            beta_power = band_powers.absolute.get("beta", 0.0) if band_powers else 0.0
            gamma_power = band_powers.absolute.get("gamma", 0.0) if band_powers else 0.0
            reliable = not fit_snapshot.excessive_artifact

            sample = providers.affective_state.push(
                at_ms=at_ms,
                theta_power=theta_power,
                alpha_power=alpha_power,
                beta_power=beta_power,
                gamma_power=gamma_power,
                raw_mindfulness=brainflow_mindfulness,
                raw_restfulness=brainflow_restfulness,
                reliable=reliable,
                fit=FitQualityHint(ready=fit_snapshot.ready, state=fit_snapshot.state),
            )
            calibration = providers.affective_state.get_calibration_state()
            features = SignalFeatures(
                bandPowers=band_powers,
                brainflowConcentration=brainflow_mindfulness,
                brainflowRestfulness=brainflow_restfulness,
                mindfulnessScore=sample.mindfulness_score if sample else None,
                restfulnessScore=sample.restfulness_score if sample else None,
                focusScore=sample.focus_score if sample else None,
                relaxScore=sample.relax_score if sample else None,
                valence=sample.valence if sample else None,
                arousal=sample.arousal if sample else None,
                rawValence=sample.raw_valence if sample else None,
                rawArousal=sample.raw_arousal if sample else None,
                stateLabel=sample.label if sample else None,
                confidence=sample.confidence if sample else None,
                calibrationActive=sample.calibration_active if sample else False,
                calibrationStatus=calibration.status,
                calibrationProgress=calibration.progress,
                calibrationRequired=calibration.required,
                interhemisphericCoherence=interhemispheric_coherence,
                thetaBetaRatio=theta_beta_ratio,
                inZone=in_zone,
                zoneScore=zone_score,
            )

            attention = providers.attention.push(
                at_ms=at_ms,
                theta_power=theta_power,
                alpha_power=alpha_power,
                beta_power=beta_power,
                raw_mindfulness=brainflow_mindfulness,
                raw_restfulness=brainflow_restfulness,
                reliable=reliable,
            )
            training = to_attention_metric_sample_model(attention) if attention else None

    return WindowAnalysis(fit_snapshot=fit_snapshot, quality=quality, features=features, training=training)


class AnalysisSessionStore:
    """In-memory registry of per-Bluetooth-connection `AnalysisProviders`,
    keyed by an opaque session id -- the Bluetooth counterpart of the state
    a `BrainFlowSession` carries for its own connection's lifetime for free.
    Create one per connection (`POST /headset-fit/sessions`), push every
    analyzed window through `analyze_window` with that session's providers
    (`POST /headset-fit/sessions/{id}/analyze-window`), and `stop` it on
    disconnect -- see `app.py`.

    Idle entries are evicted after `idle_timeout_s`, as a backstop for
    callers that never explicitly `stop()` (e.g. a closed browser tab) --
    same policy as `runtime.SessionStore`.
    """

    def __init__(self, idle_timeout_s: float = 120.0) -> None:
        self._sessions: dict[str, AnalysisProviders] = {}
        self._last_used_s: dict[str, float] = {}
        self._idle_timeout_s = idle_timeout_s

    def create(self, thresholds: HeadsetFitThresholds = BLUETOOTH_HEADSET_FIT_THRESHOLDS) -> str:
        self._evict_idle()
        session_id = str(uuid.uuid4())
        self._sessions[session_id] = AnalysisProviders(headset_fit=HeuristicHeadsetFitProvider(thresholds))
        self._last_used_s[session_id] = time.monotonic()
        return session_id

    def get(self, session_id: str) -> AnalysisProviders:
        self._evict_idle()
        session = self._sessions.get(session_id)
        if session is None:
            raise KeyError(session_id)
        self._last_used_s[session_id] = time.monotonic()
        return session

    def stop(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)
        self._last_used_s.pop(session_id, None)

    def _evict_idle(self) -> None:
        now = time.monotonic()
        stale_ids = [
            session_id
            for session_id, last_used_s in self._last_used_s.items()
            if now - last_used_s > self._idle_timeout_s
        ]
        for session_id in stale_ids:
            self._sessions.pop(session_id, None)
            self._last_used_s.pop(session_id, None)
