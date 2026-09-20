import { BandPowers, ClientProfile, MetricProvenance, ProtocolTemplate, ProtocolType, SessionPhase } from '../types';
import { getClinicalProtocolTemplate } from './clinicalProtocolTemplates';
import { getDefaultProtocolThreshold, getProtocolTypeForTemplate } from './protocols';

export interface ProtocolRuntimeConfig {
  protocol: ProtocolType;
  durationSeconds: number;
  initialThreshold: number;
  adaptiveStep: number;
  lowerIsBetter: boolean;
  thresholdBounds: { min: number; max: number };
  source: 'canonical-default' | 'patient-override';
}

export type ProtocolRuntimeResolution =
  | { ok: true; config: ProtocolRuntimeConfig }
  | { ok: false; error: string };

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const hasSupportedThresholdPrecision = (value: number) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9;
const DEFAULT_THRESHOLD_BOUNDS = { min: 0, max: 1000 } as const;
const LOWER_IS_BETTER: Record<ProtocolType, boolean> = {
  'theta-beta-ratio': true,
  'smr-enhancement': false,
  'alpha-enhancement': false,
  'alpha-theta-crossover': false,
  'beta-downtraining': true,
  'individualized-upper-alpha': false,
};

export const PROTOCOL_RUNTIME_LIMITATIONS =
  'Runtime controls: canonical protocol mode, session duration, adaptive step, and validated threshold bounds. '
  + 'Canonical reward-band fields, inhibit bands, montage or device mapping, sensitivity, clinical notes or rationale, '
  + 'recommended experiences, and the custom alias are documentation/display-only. Reward-band frequency, condition, or threshold edits are unsupported and block training.';

function sameRewardDefinition(
  value: ProtocolTemplate['rewardBand'],
  canonical: ProtocolTemplate['rewardBand'],
): boolean {
  return value?.freqMin === canonical.freqMin
    && value?.freqMax === canonical.freqMax
    && value?.targetCondition === canonical.targetCondition
    && value?.targetThreshold === canonical.targetThreshold;
}

/** Resolve the persisted assignment without allowing its display alias to affect training semantics. */
export function resolveProtocolRuntime(client: ClientProfile): ProtocolRuntimeResolution {
  const custom = client.customProtocolConfig;
  if (!client.assignedProtocol) {
    return { ok: false, error: 'A clinician must assign a training protocol before this patient can begin training.' };
  }
  const canonical = getClinicalProtocolTemplate(client.assignedProtocol);
  if (!canonical) return { ok: false, error: 'The assigned protocol is not supported by this training engine.' };
  const initialThreshold = getDefaultProtocolThreshold(client.assignedProtocol);
  const requestedBounds = client.customThresholdBounds;
  const thresholdBounds = requestedBounds ?? DEFAULT_THRESHOLD_BOUNDS;
  if (!finite(thresholdBounds.min) || !finite(thresholdBounds.max)
    || thresholdBounds.min < 0 || thresholdBounds.max > 1000 || thresholdBounds.min >= thresholdBounds.max
    || initialThreshold < thresholdBounds.min || initialThreshold > thresholdBounds.max) {
    return { ok: false, error: 'Threshold bounds must be an increasing range from 0 to 1000 that contains the protocol threshold.' };
  }
  if (!custom) return {
    ok: true,
    config: {
      protocol: client.assignedProtocol,
      durationSeconds: Math.round(canonical.sessionDurationMinutes * 60),
      initialThreshold,
      adaptiveStep: canonical.adaptiveStep,
      lowerIsBetter: LOWER_IS_BETTER[client.assignedProtocol],
      thresholdBounds: { ...thresholdBounds },
      source: 'canonical-default',
    },
  };

  const protocol = getProtocolTypeForTemplate(custom, client.assignedProtocol);
  if (protocol !== client.assignedProtocol) {
    return { ok: false, error: 'The saved protocol template does not match the assigned training mode.' };
  }
  if (!custom.rewardBand || !sameRewardDefinition(custom.rewardBand, canonical.rewardBand)) {
    return {
      ok: false,
      error: 'Custom reward frequencies, conditions, and thresholds are not supported by this engine. Restore the canonical reward definition before training.',
    };
  }
  if (!finite(custom.sessionDurationMinutes) || custom.sessionDurationMinutes < 1 || custom.sessionDurationMinutes > 180) {
    return { ok: false, error: 'Session duration must be between 1 and 180 minutes.' };
  }
  if (!finite(custom.adaptiveStep) || custom.adaptiveStep < 0.01 || custom.adaptiveStep > 100
    || !hasSupportedThresholdPrecision(custom.adaptiveStep)) {
    return { ok: false, error: 'Adaptive step must be between 0.01 and 100 with at most two decimal places.' };
  }

  return {
    ok: true,
    config: {
      protocol,
      durationSeconds: Math.round(custom.sessionDurationMinutes * 60),
      initialThreshold,
      adaptiveStep: custom.adaptiveStep,
      lowerIsBetter: LOWER_IS_BETTER[protocol],
      thresholdBounds: { ...thresholdBounds },
      source: 'patient-override',
    },
  };
}

export function evaluateProtocolFeedback(
  protocol: ProtocolType,
  threshold: number,
  bands: BandPowers,
  availability: Partial<Record<keyof BandPowers, boolean>>,
): { ratio: number | null; inZone: boolean; zoneScore: number; available: boolean } {
  const available = (...keys: Array<keyof BandPowers>) => keys.every(key => availability[key] && finite(bands[key]));
  const ratio = available('theta', 'beta') ? bands.theta / Math.max(1e-9, bands.beta) : null;
  let metric: number | null = null;
  let lowerIsBetter = false;
  let width = 1;
  switch (protocol) {
    case 'theta-beta-ratio': metric = ratio; lowerIsBetter = true; width = 1.5; break;
    case 'smr-enhancement': metric = available('smr') ? bands.smr : null; width = 1.5; break;
    case 'alpha-enhancement':
    case 'individualized-upper-alpha': metric = available('alpha') ? bands.alpha : null; width = 2; break;
    case 'alpha-theta-crossover':
      metric = available('theta', 'alpha') ? bands.theta / Math.max(1e-9, bands.alpha) : null;
      width = 0.5;
      break;
    case 'beta-downtraining': metric = available('beta') ? bands.beta : null; lowerIsBetter = true; width = 5; break;
  }
  if (metric === null) return { ratio, inZone: false, zoneScore: 0, available: false };
  const inZone = lowerIsBetter ? metric <= threshold : metric >= threshold;
  const zoneScore = lowerIsBetter
    ? 1 - (metric - threshold) / width
    : (metric - threshold + width) / (2 * width);
  return { ratio, inZone, zoneScore: Math.max(0, Math.min(1, zoneScore)), available: true };
}

export function advanceSessionClock(elapsedSeconds: number, durationSeconds: number, demoMode: boolean) {
  const elapsed = elapsedSeconds + 1;
  return { elapsed, phase: getSessionPhaseAtElapsed(elapsed, durationSeconds, demoMode) };
}

export function getCompletedSessionDuration(completedDurationSeconds: number | undefined, elapsedSeconds: number): number {
  return completedDurationSeconds ?? elapsedSeconds;
}

/**
 * Completion identity is created once by the mounted runner and then reused for
 * every retry. There is deliberately no timestamp/random fallback: a weak or
 * changing identifier would make an ambiguous network result capable of
 * applying patient aggregates twice.
 */
export function createSessionCompletionId(): string {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error('Secure session completion IDs are unavailable in this browser.');
  }
  return `sess-${globalThis.crypto.randomUUID()}`;
}

export interface SessionMeasurementCoverage {
  isDemo: boolean;
  elapsedSeconds: number;
  verifiedSeconds: number;
  verifiedBandSamples: number;
  hardwareConnected: boolean;
  sourceFresh: boolean;
}

export type SessionCompletionReadiness =
  | { ok: true }
  | { ok: false; error: string };

/**
 * A real-hardware completion must be backed by verified EEG for at least 80%
 * of the elapsed training clock and include verified complete-band samples.
 * Demo sessions intentionally bypass this measurement rule because their
 * synthetic provenance is carried and presented explicitly.
 */
export function assessSessionCompletionReadiness(
  coverage: SessionMeasurementCoverage,
): SessionCompletionReadiness {
  if (coverage.isDemo) return { ok: true };
  if (!coverage.hardwareConnected) {
    return { ok: false, error: 'Your headset is disconnected. Reconnect it before saving this session.' };
  }
  if (!coverage.sourceFresh) {
    return { ok: false, error: 'Live EEG data has stopped. Resume only after new headset data is arriving.' };
  }
  if (coverage.elapsedSeconds < 1) {
    return { ok: false, error: 'No verified training time was recorded yet.' };
  }
  const requiredSeconds = Math.max(1, Math.ceil(coverage.elapsedSeconds * 0.8));
  if (coverage.verifiedSeconds < requiredSeconds || coverage.verifiedBandSamples < 1) {
    return {
      ok: false,
      error: `Verified EEG covered ${coverage.verifiedSeconds} of ${coverage.elapsedSeconds} seconds. Resume with a valid signal before saving.`,
    };
  }
  return { ok: true };
}

export interface VerifiedBandAccumulator {
  sums: BandPowers;
  sampleCount: number;
  provenance: MetricProvenance | null;
  consistent: boolean;
}

export function createVerifiedBandAccumulator(): VerifiedBandAccumulator {
  return {
    sums: { delta: 0, theta: 0, alpha: 0, smr: 0, beta: 0, gamma: 0 },
    sampleCount: 0,
    provenance: null,
    consistent: true,
  };
}

export function accumulateVerifiedBands(
  accumulator: VerifiedBandAccumulator,
  bands: BandPowers,
  availability: Partial<Record<keyof BandPowers, boolean>>,
  provenance: MetricProvenance | null,
): void {
  const keys = Object.keys(accumulator.sums) as Array<keyof BandPowers>;
  if (!provenance || !keys.every(key => availability[key] && finite(bands[key]))) return;
  if (accumulator.provenance && (
    accumulator.provenance.source !== provenance.source
    || accumulator.provenance.algorithm !== provenance.algorithm
    || accumulator.provenance.version !== provenance.version
  )) {
    accumulator.consistent = false;
    return;
  }
  accumulator.provenance ??= provenance;
  keys.forEach(key => { accumulator.sums[key] += bands[key]; });
  accumulator.sampleCount += 1;
}

export function summarizeVerifiedBands(accumulator: VerifiedBandAccumulator): {
  bands?: BandPowers;
  provenance?: MetricProvenance;
} {
  if (!accumulator.sampleCount || !accumulator.provenance || !accumulator.consistent) {
    return {};
  }
  const bands = Object.fromEntries(
    (Object.keys(accumulator.sums) as Array<keyof BandPowers>)
      .map(key => [key, Math.round((accumulator.sums[key] / accumulator.sampleCount) * 10) / 10]),
  ) as unknown as BandPowers;
  return { bands, provenance: accumulator.provenance };
}

export function getSessionPhaseAtElapsed(
  elapsedSeconds: number,
  durationSeconds: number,
  demoMode: boolean,
): SessionPhase | 'complete' {
  if (elapsedSeconds >= durationSeconds) return 'complete';
  if (demoMode) return 'training';
  const progress = elapsedSeconds / durationSeconds;
  if (progress < 0.04) return 'calibration';
  if (progress < 0.12) return 'warmup';
  if (progress < 0.88) return 'training';
  if (progress < 0.96) return 'cooldown';
  return 'debrief';
}

export interface AdaptiveAdjustmentLog {
  timestamp: number;
  direction: 'tightened' | 'eased' | 'held';
  previousThreshold: number;
  newThreshold: number;
  timeInZoneWindowPercent: number;
  reason: string;
}

export class AdaptiveDifficultyEngine {
  private windowSamples: boolean[] = [];
  private maxWindowLength = 900; // 90 seconds @ 10Hz sampling (100ms)
  private adjustmentsCount = 0;
  private maxAdjustments = 3;
  private currentThreshold = 1.85;
  private protocol: ProtocolType = 'theta-beta-ratio';
  public adjustmentLogs: AdaptiveAdjustmentLog[] = [];

  // Protocol safety bounds
  private bounds: Record<ProtocolType, { min: number; max: number; step: number; lowerIsBetter: boolean }> = {
    'theta-beta-ratio': { min: 0, max: 1000, step: 0.08, lowerIsBetter: true },
    'smr-enhancement': { min: 0, max: 1000, step: 0.5, lowerIsBetter: false },
    'alpha-enhancement': { min: 0, max: 1000, step: 0.6, lowerIsBetter: false },
    'alpha-theta-crossover': { min: 0, max: 1000, step: 0.05, lowerIsBetter: false },
    'beta-downtraining': { min: 0, max: 1000, step: 0.8, lowerIsBetter: true },
    'individualized-upper-alpha': { min: 0, max: 1000, step: 0.5, lowerIsBetter: false },
  };

  constructor(protocol: ProtocolType = 'theta-beta-ratio', initialThreshold?: number, runtime?: ProtocolRuntimeConfig) {
    this.reset(protocol, initialThreshold, runtime);
  }

  public reset(protocol: ProtocolType, initialThreshold?: number, runtime?: ProtocolRuntimeConfig) {
    this.protocol = protocol;
    this.windowSamples = [];
    this.adjustmentsCount = 0;
    this.adjustmentLogs = [];
    
    if (runtime) {
      this.bounds[protocol] = {
        min: runtime.thresholdBounds.min,
        max: runtime.thresholdBounds.max,
        step: runtime.adaptiveStep,
        lowerIsBetter: runtime.lowerIsBetter,
      };
      this.currentThreshold = runtime.initialThreshold;
    } else if (initialThreshold !== undefined) {
      this.currentThreshold = initialThreshold;
    } else {
      this.currentThreshold = getDefaultProtocolThreshold(protocol);
    }
  }

  public addSample(inZone: boolean): { adjusted: boolean; log?: AdaptiveAdjustmentLog } {
    this.windowSamples.push(inZone);
    if (this.windowSamples.length > this.maxWindowLength) {
      this.windowSamples.shift();
    }

    // Evaluate window every 900 samples (or every ~450 if at least 45s have passed)
    if (this.windowSamples.length >= this.maxWindowLength && this.adjustmentsCount < this.maxAdjustments) {
      const inZoneCount = this.windowSamples.filter(Boolean).length;
      const percent = (inZoneCount / this.windowSamples.length) * 100;
      
      const config = this.bounds[this.protocol];
      let adjusted = false;
      let newThreshold = this.currentThreshold;
      let direction: 'tightened' | 'eased' | 'held' = 'held';
      let reason = 'Performance in optimal training flow (40% - 80%)';

      if (percent > 80) {
        // Patient is mastering the state, tighten difficulty (make target harder)
        direction = 'tightened';
        if (config.lowerIsBetter) {
          newThreshold = Math.max(config.min, this.currentThreshold - config.step);
        } else {
          newThreshold = Math.min(config.max, this.currentThreshold + config.step);
        }
        adjusted = newThreshold !== this.currentThreshold;
      } else if (percent < 40) {
        // Patient struggling, ease difficulty (make target more achievable)
        direction = 'eased';
        if (config.lowerIsBetter) {
          newThreshold = Math.min(config.max, this.currentThreshold + config.step);
        } else {
          newThreshold = Math.max(config.min, this.currentThreshold - config.step);
        }
        adjusted = newThreshold !== this.currentThreshold;
      }

      if (adjusted) {
        const appliedThreshold = Math.round(newThreshold * 100) / 100;
        const absoluteChange = Math.round(Math.abs(appliedThreshold - this.currentThreshold) * 100) / 100;
        reason = direction === 'tightened'
          ? `High time-in-zone (${percent.toFixed(0)}% > 80%). Threshold changed by ${absoluteChange} absolute units.`
          : `Low time-in-zone (${percent.toFixed(0)}% < 40%). Threshold changed by ${absoluteChange} absolute units to ease the target.`;
        const log: AdaptiveAdjustmentLog = {
          timestamp: Date.now(),
          direction,
          previousThreshold: this.currentThreshold,
          newThreshold: appliedThreshold,
          timeInZoneWindowPercent: Math.round(percent),
          reason,
        };
        this.currentThreshold = appliedThreshold;
        this.adjustmentsCount++;
        this.adjustmentLogs.push(log);
        // Clear half the window to let the brain adapt to new threshold before next test
        this.windowSamples = this.windowSamples.slice(Math.floor(this.maxWindowLength / 2));
        return { adjusted: true, log };
      }
    }

    return { adjusted: false };
  }

  public getCurrentThreshold(): number {
    return Math.round(this.currentThreshold * 100) / 100;
  }

  public getAdjustmentsCount(): number {
    return this.adjustmentsCount;
  }
}
