import { ProtocolType } from '../types';

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
  };

  constructor(protocol: ProtocolType = 'theta-beta-ratio', initialThreshold?: number) {
    this.reset(protocol, initialThreshold);
  }

  public reset(protocol: ProtocolType, initialThreshold?: number) {
    this.protocol = protocol;
    this.windowSamples = [];
    this.adjustmentsCount = 0;
    this.adjustmentLogs = [];
    
    if (initialThreshold !== undefined) {
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
