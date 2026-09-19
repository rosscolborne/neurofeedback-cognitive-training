import { BandPowers, ClientProfile, ProtocolType, SessionPhase } from '../types';
import { getClinicalProtocolTemplate } from './clinicalProtocolTemplates';
import { getDefaultProtocolThreshold, getProtocolTypeForTemplate } from './protocols';

export interface RuntimeRewardBand {
  freqMin: number;
  freqMax: number;
  targetCondition: 'above' | 'below';
  targetThreshold: number;
}

export interface ProtocolRuntimeConfig {
  protocol: ProtocolType;
  durationSeconds: number;
  initialThreshold: number;
  adaptiveStep: number;
  rewardBand?: RuntimeRewardBand;
  source: 'canonical-default' | 'patient-override';
}

export type ProtocolRuntimeResolution =
  | { ok: true; config: ProtocolRuntimeConfig }
  | { ok: false; error: string };

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Resolve the persisted assignment without allowing its display alias to affect training semantics. */
export function resolveProtocolRuntime(client: ClientProfile): ProtocolRuntimeResolution {
  const custom = client.customProtocolConfig;
  if (!custom) {
    const canonical = getClinicalProtocolTemplate(client.assignedProtocol);
    if (!canonical) return { ok: false, error: 'The assigned protocol is not supported by this training engine.' };
    return {
      ok: true,
      config: {
        protocol: client.assignedProtocol,
        durationSeconds: Math.round(canonical.sessionDurationMinutes * 60),
        initialThreshold: getDefaultProtocolThreshold(client.assignedProtocol),
        adaptiveStep: canonical.adaptiveStep,
        source: 'canonical-default',
      },
    };
  }

  const protocol = getProtocolTypeForTemplate(custom, client.assignedProtocol);
  if (protocol !== client.assignedProtocol) {
    return { ok: false, error: 'The saved protocol template does not match the assigned training mode.' };
  }
  const reward = custom.rewardBand;
  if (!reward || !finite(reward.freqMin) || !finite(reward.freqMax)
    || reward.freqMin < 0.5 || reward.freqMax > 50 || reward.freqMin >= reward.freqMax) {
    return { ok: false, error: 'Reward frequencies must be a valid increasing range between 0.5 and 50 Hz.' };
  }
  if (!finite(reward.targetThreshold) || reward.targetThreshold < 0 || reward.targetThreshold > 1000) {
    return { ok: false, error: 'The reward threshold must be a finite value between 0 and 1000 µV.' };
  }
  if (reward.targetCondition !== 'above' && reward.targetCondition !== 'below') {
    return { ok: false, error: 'The saved reward condition is not supported.' };
  }
  if (!finite(custom.sessionDurationMinutes) || custom.sessionDurationMinutes < 1 || custom.sessionDurationMinutes > 180) {
    return { ok: false, error: 'Session duration must be between 1 and 180 minutes.' };
  }
  if (!finite(custom.adaptiveStep) || custom.adaptiveStep <= 0 || custom.adaptiveStep > 100) {
    return { ok: false, error: 'The saved adaptive step is invalid.' };
  }

  return {
    ok: true,
    config: {
      protocol,
      durationSeconds: Math.round(custom.sessionDurationMinutes * 60),
      initialThreshold: reward.targetThreshold,
      adaptiveStep: custom.adaptiveStep,
      rewardBand: {
        freqMin: reward.freqMin,
        freqMax: reward.freqMax,
        targetCondition: reward.targetCondition,
        targetThreshold: reward.targetThreshold,
      },
      source: 'patient-override',
    },
  };
}

const BAND_INTERVALS: Array<{ band: keyof BandPowers; min: number; max: number }> = [
  { band: 'delta', min: 0.5, max: 4 },
  { band: 'theta', min: 4, max: 8 },
  { band: 'alpha', min: 8, max: 12 },
  { band: 'smr', min: 12, max: 15 },
  { band: 'beta', min: 15, max: 30 },
  { band: 'gamma', min: 30, max: 50 },
];

export function calculateRewardBandMetric(
  bands: BandPowers,
  availability: Partial<Record<keyof BandPowers, boolean>>,
  reward: RuntimeRewardBand,
): number | null {
  let weightedTotal = 0;
  let coveredWidth = 0;
  for (const interval of BAND_INTERVALS) {
    const overlap = Math.max(0, Math.min(reward.freqMax, interval.max) - Math.max(reward.freqMin, interval.min));
    if (overlap === 0) continue;
    if (!availability[interval.band] || !finite(bands[interval.band])) return null;
    weightedTotal += bands[interval.band] * overlap;
    coveredWidth += overlap;
  }
  const requestedWidth = reward.freqMax - reward.freqMin;
  return coveredWidth >= requestedWidth - 1e-9 ? weightedTotal / coveredWidth : null;
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
    'theta-beta-ratio': { min: 1.1, max: 2.8, step: 0.08, lowerIsBetter: true },
    'smr-enhancement': { min: 4.0, max: 14.0, step: 0.5, lowerIsBetter: false },
    'alpha-enhancement': { min: 6.0, max: 18.0, step: 0.6, lowerIsBetter: false },
    'alpha-theta-crossover': { min: 0.7, max: 1.6, step: 0.05, lowerIsBetter: false },
    'beta-downtraining': { min: 8.0, max: 20.0, step: 0.8, lowerIsBetter: true },
    'individualized-upper-alpha': { min: 4.0, max: 15.0, step: 0.5, lowerIsBetter: false },
  };

  constructor(protocol: ProtocolType = 'theta-beta-ratio', initialThreshold?: number, runtime?: ProtocolRuntimeConfig) {
    this.reset(protocol, initialThreshold, runtime);
  }

  public reset(protocol: ProtocolType, initialThreshold?: number, runtime?: ProtocolRuntimeConfig) {
    this.protocol = protocol;
    this.windowSamples = [];
    this.adjustmentsCount = 0;
    this.adjustmentLogs = [];
    
    if (runtime?.rewardBand) {
      const step = runtime.adaptiveStep;
      const threshold = runtime.initialThreshold;
      this.bounds[protocol] = {
        min: Math.max(0, threshold - step * 10),
        max: threshold + step * 10,
        step,
        lowerIsBetter: runtime.rewardBand.targetCondition === 'below',
      };
      this.currentThreshold = threshold;
    } else if (initialThreshold !== undefined) {
      this.currentThreshold = initialThreshold;
    } else {
      const b = this.bounds[protocol];
      this.currentThreshold = (b.min + b.max) / 2;
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
        reason = `High time-in-zone (${percent.toFixed(0)}% > 80%). Challenge increased by 5%.`;
        adjusted = newThreshold !== this.currentThreshold;
      } else if (percent < 40) {
        // Patient struggling, ease difficulty (make target more achievable)
        direction = 'eased';
        if (config.lowerIsBetter) {
          newThreshold = Math.min(config.max, this.currentThreshold + config.step);
        } else {
          newThreshold = Math.max(config.min, this.currentThreshold - config.step);
        }
        reason = `Low time-in-zone (${percent.toFixed(0)}% < 40%). Target eased by 5% to support momentum.`;
        adjusted = newThreshold !== this.currentThreshold;
      }

      if (adjusted) {
        const log: AdaptiveAdjustmentLog = {
          timestamp: Date.now(),
          direction,
          previousThreshold: this.currentThreshold,
          newThreshold: Math.round(newThreshold * 100) / 100,
          timeInZoneWindowPercent: Math.round(percent),
          reason,
        };
        this.currentThreshold = newThreshold;
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
