/** Presentation adapter for the authoritative brainflow_service metrics.
 * The debug console deliberately performs no local EEG metric calculation. */
import type { SignalFrame } from "../domain/eeg";
import type { HeadsetFitSnapshot } from "../signalQuality/headsetFitProvider";

const neutralRadius = .18;

export interface AffectiveEmotionRegion { label: string; valence: number; arousal: number; }
export const affectiveEmotionRegions = [
  { label: "Tense", valence: -.25, arousal: .78 }, { label: "Angry", valence: -.68, arousal: .55 },
  { label: "Frustrated", valence: -.72, arousal: .25 }, { label: "Depressed", valence: -.74, arousal: -.25 },
  { label: "Bored", valence: -.58, arousal: -.58 }, { label: "Tired", valence: -.25, arousal: -.82 },
  { label: "Calm", valence: .25, arousal: -.82 }, { label: "Relaxed", valence: .58, arousal: -.58 },
  { label: "Content", valence: .72, arousal: -.25 }, { label: "Happy", valence: .72, arousal: .25 },
  { label: "Delighted", valence: .62, arousal: .55 }, { label: "Excited", valence: .32, arousal: .78 },
] satisfies AffectiveEmotionRegion[];

export interface AffectiveStateSample {
  atMs: number; valence: number; arousal: number; rawValence: number; rawArousal: number;
  calibrationActive: boolean; label: string; confidence: number; scoreSource: "eeg_band_power_proxy";
  thetaPower: number; alphaPower: number; betaPower: number; gammaPower: number;
  brainflowMindfulnessScore: number | null; brainflowRestfulnessScore: number | null;
  smrPower: number | null; thetaBetaRatio: number | null; ratios: Record<string, number>; reliable: boolean;
}
export interface AffectiveCalibrationState { status: "off" | "collecting" | "active"; progress: number; required: number; }

export class AffectiveStateProvider {
  private calibrationStatus: AffectiveCalibrationState["status"] = "off";
  private calibrationSamples = 0;
  private readonly calibrationRequired = 24;
  reset() {}
  startCalibration() { this.calibrationStatus = "collecting"; this.calibrationSamples = 0; }
  resetCalibration() { this.calibrationStatus = "off"; this.calibrationSamples = 0; }
  getCalibrationState(): AffectiveCalibrationState { return { status: this.calibrationStatus, progress: this.calibrationSamples, required: this.calibrationRequired }; }

  pushFrame(frame: SignalFrame, quality?: HeadsetFitSnapshot | null): AffectiveStateSample | null {
    if (quality?.excessiveArtifact) return null;
    const features = frame.features;
    if (features?.valence == null || features.arousal == null) return null;
    if (this.calibrationStatus === "collecting") {
      this.calibrationSamples = Math.min(this.calibrationRequired, this.calibrationSamples + 1);
      if (this.calibrationSamples === this.calibrationRequired) this.calibrationStatus = "active";
    }
    const powers = features.bandPowers?.absolute;
    return {
      atMs: frame.receivedAtMs, valence: features.valence, arousal: features.arousal,
      rawValence: features.valence, rawArousal: features.arousal,
      calibrationActive: false, label: features.stateLabel ?? classifyAffectiveState(features.valence, features.arousal),
      confidence: features.confidence ?? estimateConfidence(features.valence, features.arousal, quality),
      scoreSource: "eeg_band_power_proxy", thetaPower: finitePower(powers?.theta),
      alphaPower: finitePower(powers?.alpha), betaPower: finitePower(powers?.beta), gammaPower: finitePower(powers?.gamma),
      brainflowMindfulnessScore: features.mindfulnessScore ?? null,
      brainflowRestfulnessScore: features.restfulnessScore ?? null, smrPower: finiteOptionalPower(powers?.smr),
      thetaBetaRatio: finiteOptionalMetric(features.bandPowers?.ratios?.thetaBeta), ratios: features.bandPowers?.ratios ?? {}, reliable: true,
    };
  }
}

export function mapRatioToAxis(ratio: number) { return !Number.isFinite(ratio) || ratio <= 0 ? 0 : clamp(Math.tanh(Math.log2(ratio) / 2.5), -1, 1); }
export function classifyAffectiveState(valence: number, arousal: number) {
  if (Math.hypot(valence, arousal) < neutralRadius) return "Neutral";
  return affectiveEmotionRegions.reduce((nearest, region) => Math.hypot(valence - region.valence, arousal - region.arousal) < Math.hypot(valence - nearest.valence, arousal - nearest.arousal) ? region : nearest).label;
}
function estimateConfidence(valence: number, arousal: number, quality?: HeadsetFitSnapshot | null) { return clamp(Math.min(1, Math.hypot(valence, arousal)) * (quality?.ready ? 1 : .75), 0, 1); }
function finitePower(value: number | undefined) { return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0; }
function finiteOptionalPower(value: number | undefined) { return Number.isFinite(value) ? Math.max(0, value ?? 0) : null; }
function finiteOptionalMetric(value: number | undefined) { return Number.isFinite(value) ? value ?? null : null; }
function clamp(value: number, low: number, high: number) { return Math.min(high, Math.max(low, value)); }
