"""The one, shared window -> features pipeline behind every live EEG
connection this service serves -- a direct BrainFlow connection
(`runtime.BrainFlowSession`) and a Bluetooth connection (`AnalysisSessionStore`
below, driven by the `/headset-fit/sessions/*` endpoints in `app.py`).

`analyze_window` is now the *only* place that turns a raw EEG window into
those finished scores. `BrainFlowSession._normalize_frame` and the Bluetooth
`/headset-fit/sessions/{id}/analyze-window` endpoint both call it, each
handing it their connection's own `AnalysisProviders` -- so whichever
transport collected the EEG, the smoothing and headset-fit assessment are
the exact same code running against the exact same per-connection state.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field

import numpy as np

from .affective_state import FitQualityHint
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
from .models import SignalChannel, SignalFeatures, SignalQualityMetadata, TrainingMetricSampleModel
from .metrics import MetricCalculator, MetricInput
from .training import TrainingScoreProvider


@dataclass
class AnalysisProviders:
    """The stateful providers behind one live connection's whole lifetime --
    one instance per `BrainFlowSession` or per Bluetooth session. Keeping
    them bundled (rather than passed around separately) is what makes it
    natural for both connection paths to share `analyze_window` instead of
    each reimplementing which state goes with which score."""

    headset_fit: HeuristicHeadsetFitProvider
    training_score: TrainingScoreProvider = field(default_factory=TrainingScoreProvider)
    metrics: MetricCalculator = field(default_factory=MetricCalculator)


@dataclass(frozen=True)
class WindowAnalysis:
    fit_snapshot: HeadsetFitSnapshot
    quality: SignalQualityMetadata
    features: SignalFeatures | None
    training: TrainingMetricSampleModel | None


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
    in that case, just without features.
    """
    at_ms = time.time() * 1000.0 if at_ms is None else at_ms

    fit_snapshot = providers.headset_fit.update(channels=channels, samples=eeg_samples)
    quality = to_signal_quality_metadata(fit_snapshot)

    features: SignalFeatures | None = None
    training: TrainingMetricSampleModel | None = None

    if raw_window is not None:
        processed = preprocess_eeg_window(raw_window, sample_rate, processing)
        band_powers = extract_band_power_features(processed, sample_rate)
        interhemispheric_coherence = extract_interhemispheric_coherence(
            processed, sample_rate, [channel.id for channel in channels],
        )
        brainflow_mindfulness = extract_brainflow_mindfulness(raw_window, sample_rate)
        brainflow_restfulness = extract_brainflow_restfulness(raw_window, sample_rate)

        if band_powers or brainflow_mindfulness is not None or brainflow_restfulness is not None:
            reliable = not fit_snapshot.excessive_artifact
            snapshot = providers.metrics.push(MetricInput(
                absolute_bands=band_powers.absolute if band_powers else {},
                interhemispheric_coherence=interhemispheric_coherence,
                raw_mindfulness=brainflow_mindfulness,
                raw_restfulness=brainflow_restfulness,
                protocol=protocol,
                threshold=threshold,
                reliable=reliable,
                fit=FitQualityHint(ready=fit_snapshot.ready, state=fit_snapshot.state),
            ))
            if band_powers:
                band_powers = band_powers.model_copy(update={
                    "absolute": snapshot.absolute_bands,
                    "relative": snapshot.relative_bands,
                    "ratios": snapshot.ratios,
                })
            training_sample = providers.training_score.push(
                brainflow_mindfulness, reliable=reliable,
            )
            training = TrainingMetricSampleModel(
                score=training_sample.score,
                baselineReady=training_sample.baseline_ready,
            )
            features = SignalFeatures(
                bandPowers=band_powers,
                brainflowConcentration=brainflow_mindfulness,
                brainflowRestfulness=brainflow_restfulness,
                mindfulnessScore=snapshot.brainflow_scores.mindfulness_score,
                restfulnessScore=snapshot.brainflow_scores.restfulness_score,
                valence=snapshot.affective_state.valence if snapshot.affective_state else None,
                arousal=snapshot.affective_state.arousal if snapshot.affective_state else None,
                stateLabel=snapshot.affective_state.label if snapshot.affective_state else None,
                confidence=snapshot.affective_state.confidence if snapshot.affective_state else None,
                interhemisphericCoherence=snapshot.interhemispheric_coherence,
                primaryMetricName=snapshot.protocol_feedback.metric_name,
                primaryMetricValue=snapshot.protocol_feedback.value,
                inZone=snapshot.protocol_feedback.in_zone,
                zoneScore=snapshot.protocol_feedback.zone_score,
                calibrationStatus=snapshot.calibration_status,
                calibrationProgress=snapshot.calibration_progress,
                calibrationRequired=snapshot.calibration_required,
                rawMetrics=snapshot.raw_metrics,
                baselineRelativeMetrics=snapshot.baseline_relative_metrics,
            )

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
