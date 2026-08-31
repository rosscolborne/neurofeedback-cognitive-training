import { BrainCircuit, RotateCcw, SlidersHorizontal } from "lucide-react";
import { InfoPopoverButton } from "./InfoPopoverButton";
import {
  affectiveEmotionRegions,
  type AffectiveCalibrationState,
  type AffectiveStateSample,
} from "../metrics/affectiveStateMetric";

interface AffectiveStatePanelProps {
  calibration: AffectiveCalibrationState;
  onCalibrate: () => void;
  onResetCalibration: () => void;
  sample: AffectiveStateSample | null;
}

export function AffectiveStatePanel({
  calibration,
  onCalibrate,
  onResetCalibration,
  sample,
}: AffectiveStatePanelProps) {
  const x = sample ? toPlotPercent(sample.valence) : 50;
  const y = sample ? 100 - toPlotPercent(sample.arousal) : 50;
  const calibrationLabel =
    calibration.status === "collecting"
      ? `Calibrating ${calibration.progress}/${calibration.required}`
      : calibration.status === "active"
        ? "Calibration active"
        : "Calibration off";

  return (
    <section className="panel affective-card" aria-label="Valence arousal state">
      <div className="panel-header">
        <div className="panel-title">
          <div className="icon-tile">
            <BrainCircuit aria-hidden="true" />
          </div>
          <div>
            <h2>Valence / Arousal — Experimental</h2>
            <p>Smoothed EEG band-power proxy, not a validated emotion measure.</p>
          </div>
        </div>
        <InfoPopoverButton ariaLabel="Explain valence and arousal" preferredSide="left">
          <p>
            Valence and arousal are experimental EEG band-power proxies, not
            BrainFlow emotion predictions and not validated emotion labels.
          </p>
          <p>
            Arousal rises when beta plus gamma power is high relative to alpha
            plus theta. Valence rises when alpha power is high relative to theta
            plus beta. Both axes are smoothed with a slow EMA.
          </p>
          <p>
            The state label is the nearest named region on the two-axis chart,
            so it is a rough visualization aid rather than a clinical or
            psychological classification.
          </p>
        </InfoPopoverButton>
      </div>

      <div className="affective-grid">
        <div className="affective-plane" role="img" aria-label="Valence arousal plot">
          <span className="axis-label axis-label-top">High arousal</span>
          <span className="axis-label axis-label-bottom">Low arousal</span>
          <span className="axis-label axis-label-left">Negative valence</span>
          <span className="axis-label axis-label-right">Positive valence</span>
          <span className="neutral-label">Neutral</span>
          {affectiveEmotionRegions.map((region) => (
            <span
              className={`emotion-label ${
                sample?.label === region.label ? "is-active" : ""
              }`}
              key={region.label}
              style={{
                left: `${((region.valence + 1) / 2) * 100}%`,
                top: `${(1 - (region.arousal + 1) / 2) * 100}%`,
              }}
            >
              {region.label}
            </span>
          ))}
          {sample ? (
            <span
              className="affective-point"
              style={{ left: `${x}%`, top: `${y}%` }}
            />
          ) : (
            <div className="empty-state affective-empty">
              <div className="icon-tile">
                <BrainCircuit aria-hidden="true" />
              </div>
              <strong>No affective proxy yet</strong>
              <span>Connect a provider with usable EEG band powers.</span>
            </div>
          )}
        </div>

        <div className="affective-readout">
          <div>
            <span>State label</span>
            <strong>{sample?.label ?? "--"}</strong>
          </div>
          <div>
            <span>Valence</span>
            <strong>{formatAxis(sample?.valence)}</strong>
          </div>
          <div>
            <span>Arousal</span>
            <strong>{formatAxis(sample?.arousal)}</strong>
          </div>
          <div>
            <span>Confidence</span>
            <strong>{sample ? `${Math.round(sample.confidence * 100)}%` : "--"}</strong>
          </div>
          <p>
            Derived from theta, alpha, beta, and gamma band-power ratios with slow
            EMA smoothing.
          </p>
          <div className="affective-neurofeedback">
            <span>
              <small>Mindfulness</small>
              <strong>{formatScore(sample?.brainflowMindfulnessScore)}</strong>
            </span>
            <span>
              <small>Restfulness</small>
              <strong>{formatScore(sample?.brainflowRestfulnessScore)}</strong>
            </span>
            <span>
              <small>Focus</small>
              <strong>{formatScore(sample?.focusScore)}</strong>
            </span>
            <span>
              <small>Relax</small>
              <strong>{formatScore(sample?.relaxScore)}</strong>
            </span>
            <span>
              <small>SMR power (µV²)</small>
              <strong>{formatPower(sample?.smrPower)}</strong>
            </span>
            <span>
              <small>Theta / Beta</small>
              <strong>{formatRatio(sample?.thetaBetaRatio)}</strong>
            </span>
          </div>
          <div className="affective-calibration-controls">
            <span>{calibrationLabel}</span>
            <div>
              <button
                className="secondary-button"
                disabled={calibration.status === "collecting"}
                onClick={onCalibrate}
              >
                <SlidersHorizontal aria-hidden="true" />
                Calibrate
              </button>
              <button
                className="secondary-button"
                disabled={calibration.status === "off"}
                onClick={onResetCalibration}
              >
                <RotateCcw aria-hidden="true" />
                Reset
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function formatAxis(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";

  return value.toFixed(2);
}

function formatScore(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";

  return String(Math.round(value));
}

function formatPower(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";

  return value.toPrecision(3);
}

function formatRatio(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";

  return value.toFixed(2);
}

function toPlotPercent(value: number) {
  return Math.min(96, Math.max(4, ((value + 1) / 2) * 100));
}
