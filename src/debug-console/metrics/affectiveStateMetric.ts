import type { SignalFrame } from "../domain/eeg";
import {
  computeBrainflowsNeurofeedbackScores,
  smoothScore,
} from "./neurofeedbackRatios";
import { computeBandPowers, type FrequencyBand } from "../signalProcessing/bandPower";
import type { HeadsetFitSnapshot } from "../signalQuality/headsetFitProvider";

const vrchatStyleEmaDecay = 0.05;
const neutralRadius = 0.18;

const affectiveBands = [
  { id: "theta", label: "Theta", lowHz: 4, highHz: 8 },
  { id: "alpha", label: "Alpha", lowHz: 8, highHz: 13 },
  { id: "smr", label: "Sensorimotor Rhythm", lowHz: 12, highHz: 15 },
  { id: "beta", label: "Beta", lowHz: 13, highHz: 30 },
  { id: "gamma", label: "Gamma", lowHz: 30, highHz: 45 },
] satisfies FrequencyBand[];

export interface AffectiveEmotionRegion {
  label: string;
  valence: number;
  arousal: number;
}

export const affectiveEmotionRegions = [
  { label: "Tense", valence: -0.25, arousal: 0.78 },
  { label: "Angry", valence: -0.68, arousal: 0.55 },
  { label: "Frustrated", valence: -0.72, arousal: 0.25 },
  { label: "Depressed", valence: -0.74, arousal: -0.25 },
  { label: "Bored", valence: -0.58, arousal: -0.58 },
  { label: "Tired", valence: -0.25, arousal: -0.82 },
  { label: "Calm", valence: 0.25, arousal: -0.82 },
  { label: "Relaxed", valence: 0.58, arousal: -0.58 },
  { label: "Content", valence: 0.72, arousal: -0.25 },
  { label: "Happy", valence: 0.72, arousal: 0.25 },
  { label: "Delighted", valence: 0.62, arousal: 0.55 },
  { label: "Excited", valence: 0.32, arousal: 0.78 },
] satisfies AffectiveEmotionRegion[];

export interface AffectiveStateSample {
  atMs: number;
  valence: number;
  arousal: number;
  rawValence: number;
  rawArousal: number;
  calibrationActive: boolean;
  label: string;
  confidence: number;
  scoreSource: "eeg_band_power_proxy";
  thetaPower: number;
  alphaPower: number;
  betaPower: number;
  gammaPower: number;
  brainflowMindfulnessScore: number | null;
  brainflowRestfulnessScore: number | null;
  focusScore: number;
  relaxScore: number;
  smrPower: number | null;
  thetaBetaRatio: number | null;
  reliable: boolean;
}

export interface AffectiveCalibrationState {
  status: "off" | "collecting" | "active";
  progress: number;
  required: number;
}

export class AffectiveStateProvider {
  private smoothedValence: number | null = null;
  private smoothedArousal: number | null = null;
  private smoothedBrainflowMindfulnessScore: number | null = null;
  private smoothedBrainflowRestfulnessScore: number | null = null;
  private smoothedFocusScore: number | null = null;
  private smoothedRelaxScore: number | null = null;
  private calibrationStatus: AffectiveCalibrationState["status"] = "off";
  private readonly calibrationSampleCount = 24;
  private calibrationValenceValues: number[] = [];
  private calibrationArousalValues: number[] = [];
  private calibrationProfile: { valence: number; arousal: number } | null = null;

  constructor(private readonly smoothingAlpha = vrchatStyleEmaDecay) {}

  reset() {
    this.smoothedValence = null;
    this.smoothedArousal = null;
    this.smoothedBrainflowMindfulnessScore = null;
    this.smoothedBrainflowRestfulnessScore = null;
    this.smoothedFocusScore = null;
    this.smoothedRelaxScore = null;
    this.resetCalibration();
  }

  startCalibration() {
    this.calibrationStatus = "collecting";
    this.calibrationValenceValues = [];
    this.calibrationArousalValues = [];
    this.calibrationProfile = null;
    this.smoothedValence = null;
    this.smoothedArousal = null;
  }

  resetCalibration() {
    this.calibrationStatus = "off";
    this.calibrationValenceValues = [];
    this.calibrationArousalValues = [];
    this.calibrationProfile = null;
    this.smoothedValence = null;
    this.smoothedArousal = null;
  }

  getCalibrationState(): AffectiveCalibrationState {
    return {
      status: this.calibrationStatus,
      progress:
        this.calibrationStatus === "collecting"
          ? Math.min(this.calibrationValenceValues.length, this.calibrationSampleCount)
          : this.calibrationStatus === "active"
            ? this.calibrationSampleCount
            : 0,
      required: this.calibrationSampleCount,
    };
  }

  pushFrame(
    frame: SignalFrame,
    quality?: HeadsetFitSnapshot | null,
  ): AffectiveStateSample | null {
    if (quality?.excessiveArtifact) return null;

    // `brainflow_service` already smooths and calibrates these scores --
    // identically for a BrainFlow or a Bluetooth connection, both of which
    // always send a `features` object once they have one (see
    // `analysis.analyze_window`). Relay them as-is instead of recomputing
    // a second, independent smoothing pass here. The local computation
    // below only runs for sources with no server behind them at all (the
    // Mock provider, or a replay recording made before this field
    // existed).
    if (frame.features) {
      return this.fromServerFeatures(frame, frame.features, quality);
    }

    const powers = computeBandPowers(frame, affectiveBands)?.powers;
    if (!powers) return null;

    const thetaPower = finitePower(powers.theta);
    const alphaPower = finitePower(powers.alpha);
    const smrPower = finiteOptionalPower(powers.smr);
    const betaPower = finitePower(powers.beta);
    const gammaPower = finitePower(powers.gamma);
    if (thetaPower + alphaPower + betaPower + gammaPower <= 0) return null;

    const rawArousal = mapRatioToAxis((betaPower + gammaPower) / (alphaPower + thetaPower + 1e-9));
    const rawValence = mapRatioToAxis(alphaPower / (thetaPower + betaPower + 1e-9));
    this.acceptCalibrationSample(rawValence, rawArousal);
    const calibratedValence =
      this.calibrationProfile === null
        ? rawValence
        : clamp(rawValence - this.calibrationProfile.valence, -1, 1);
    const calibratedArousal =
      this.calibrationProfile === null
        ? rawArousal
        : clamp(rawArousal - this.calibrationProfile.arousal, -1, 1);
    const neurofeedbackScores = computeBrainflowsNeurofeedbackScores({
      thetaPower,
      alphaPower,
      betaPower,
    });
    const rawBrainflowMindfulnessScore = normalizeBrainflowMindfulness(
      readBrainflowMetric(frame, [
        "brainflowConcentration",
        "brainflow_concentration",
        "mindfulness",
      ]),
    );
    const rawBrainflowRestfulnessScore = normalizeBrainflowMindfulness(
      readBrainflowMetric(frame, [
        "brainflowRestfulness",
        "brainflow_restfulness",
        "restfulness",
      ]),
    );

    this.smoothedValence =
      this.smoothedValence === null
        ? calibratedValence
        : smooth(this.smoothedValence, calibratedValence, this.smoothingAlpha);
    this.smoothedArousal =
      this.smoothedArousal === null
        ? calibratedArousal
        : smooth(this.smoothedArousal, calibratedArousal, this.smoothingAlpha);
    this.smoothedBrainflowMindfulnessScore =
      rawBrainflowMindfulnessScore === null
        ? null
        : smoothScore(
            this.smoothedBrainflowMindfulnessScore,
            rawBrainflowMindfulnessScore,
            this.smoothingAlpha,
          );
    this.smoothedBrainflowRestfulnessScore =
      rawBrainflowRestfulnessScore === null
        ? null
        : smoothScore(
            this.smoothedBrainflowRestfulnessScore,
            rawBrainflowRestfulnessScore,
            this.smoothingAlpha,
          );
    this.smoothedFocusScore = smoothScore(
      this.smoothedFocusScore,
      neurofeedbackScores.focusScore,
      this.smoothingAlpha,
    );
    this.smoothedRelaxScore = smoothScore(
      this.smoothedRelaxScore,
      neurofeedbackScores.relaxScore,
      this.smoothingAlpha,
    );

    const valence = clamp(this.smoothedValence, -1, 1);
    const arousal = clamp(this.smoothedArousal, -1, 1);
    const brainflowMindfulnessScore =
      rawBrainflowMindfulnessScore === null ||
      this.smoothedBrainflowMindfulnessScore === null
        ? null
        : Math.round(clamp(this.smoothedBrainflowMindfulnessScore, 0, 100));
    const brainflowRestfulnessScore =
      rawBrainflowRestfulnessScore === null ||
      this.smoothedBrainflowRestfulnessScore === null
        ? null
        : Math.round(clamp(this.smoothedBrainflowRestfulnessScore, 0, 100));

    return {
      atMs: frame.receivedAtMs,
      valence,
      arousal,
      rawValence,
      rawArousal,
      calibrationActive: this.calibrationProfile !== null,
      label: classifyAffectiveState(valence, arousal),
      confidence: estimateConfidence(valence, arousal, quality),
      scoreSource: "eeg_band_power_proxy",
      thetaPower,
      alphaPower,
      betaPower,
      gammaPower,
      brainflowMindfulnessScore,
      brainflowRestfulnessScore,
      focusScore: Math.round(clamp(this.smoothedFocusScore, 0, 100)),
      relaxScore: Math.round(clamp(this.smoothedRelaxScore, 0, 100)),
      smrPower,
      thetaBetaRatio: thetaPower / Math.max(1e-9, betaPower),
      reliable: !quality?.excessiveArtifact,
    };
  }

  /** Adapts an already-smoothed `SignalFeatures` from `brainflow_service`
   * (see `analysis.analyze_window`) into this module's `AffectiveStateSample`
   * shape, without recomputing anything -- the smoothing, calibration, and
   * classification already happened server-side. `null` when the server
   * hasn't produced a valence/arousal reading yet for this connection
   * (e.g. still gathering its first window). */
  private fromServerFeatures(
    frame: SignalFrame,
    features: NonNullable<SignalFrame["features"]>,
    quality?: HeadsetFitSnapshot | null,
  ): AffectiveStateSample | null {
    if (
      features.valence == null ||
      features.arousal == null ||
      features.rawValence == null ||
      features.rawArousal == null
    ) {
      return null;
    }

    const powers = features.bandPowers?.absolute;
    return {
      atMs: frame.receivedAtMs,
      valence: features.valence,
      arousal: features.arousal,
      rawValence: features.rawValence,
      rawArousal: features.rawArousal,
      calibrationActive: features.calibrationActive ?? false,
      label: features.stateLabel ?? classifyAffectiveState(features.valence, features.arousal),
      confidence:
        features.confidence ?? estimateConfidence(features.valence, features.arousal, quality),
      scoreSource: "eeg_band_power_proxy",
      thetaPower: finitePower(powers?.theta),
      alphaPower: finitePower(powers?.alpha),
      betaPower: finitePower(powers?.beta),
      gammaPower: finitePower(powers?.gamma),
      brainflowMindfulnessScore: features.mindfulnessScore ?? null,
      brainflowRestfulnessScore: features.restfulnessScore ?? null,
      focusScore: features.focusScore ?? 50,
      relaxScore: features.relaxScore ?? 50,
      smrPower: finiteOptionalPower(powers?.smr),
      thetaBetaRatio:
        finiteOptionalMetric(features.thetaBetaRatio) ??
        finiteOptionalRatio(powers?.theta, powers?.beta),
      reliable: !quality?.excessiveArtifact,
    };
  }

  private acceptCalibrationSample(rawValence: number, rawArousal: number) {
    if (this.calibrationStatus !== "collecting") return;

    this.calibrationValenceValues.push(rawValence);
    this.calibrationArousalValues.push(rawArousal);

    if (this.calibrationValenceValues.length < this.calibrationSampleCount) return;

    this.calibrationProfile = {
      valence: median(this.calibrationValenceValues),
      arousal: median(this.calibrationArousalValues),
    };
    this.calibrationStatus = "active";
    this.smoothedValence = null;
    this.smoothedArousal = null;
  }
}

function finitePower(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

function finiteOptionalPower(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : null;
}

function finiteOptionalMetric(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function finiteOptionalRatio(
  numerator: number | undefined,
  denominator: number | undefined,
) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || (denominator ?? 0) <= 0) {
    return null;
  }

  return (numerator ?? 0) / (denominator ?? 1);
}

function mapRatioToAxis(ratio: number) {
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;

  return clamp(Math.tanh(Math.log2(ratio) / 2.5), -1, 1);
}

function smooth(current: number, target: number, weight: number) {
  return current * (1 - weight) + target * weight;
}

function normalizeBrainflowMindfulness(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;

  return clamp(value * 100, 0, 100);
}

function readBrainflowMetric(frame: SignalFrame, keys: string[]) {
  const features = frame.features as
    | (SignalFrame["features"] & Record<string, number | null | undefined>)
    | null
    | undefined;

  for (const key of keys) {
    const value = features?.[key];
    if (value !== null && value !== undefined) return value;
  }

  return null;
}

function classifyAffectiveState(valence: number, arousal: number) {
  if (Math.hypot(valence, arousal) < neutralRadius) return "Neutral";

  let nearest = affectiveEmotionRegions[0];
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const region of affectiveEmotionRegions) {
    const distance = Math.hypot(
      valence - region.valence,
      arousal - region.arousal,
    );
    if (distance < nearestDistance) {
      nearest = region;
      nearestDistance = distance;
    }
  }

  return nearest.label;
}

function estimateConfidence(
  valence: number,
  arousal: number,
  quality?: HeadsetFitSnapshot | null,
) {
  const distance = Math.min(1, Math.hypot(valence, arousal));
  const qualityFactor = quality?.ready ? 1 : quality?.state === "good" ? 0.75 : 0.45;

  return clamp(distance * qualityFactor, 0, 1);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
