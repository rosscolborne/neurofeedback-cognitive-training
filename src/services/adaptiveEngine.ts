// Validation and resolution of the clinical protocol data model, used only by
// the clinician screens (retired in the Phase 1 cleanup). The consumer app has
// no EEG protocols: nothing here drives EEG feedback, training or scoring.

import { ClientProfile, ProtocolTemplate, ProtocolType } from '../types';
import { getClinicalProtocolTemplate, hasCanonicalRewardDefinition } from './clinicalProtocolTemplates';
import { getDefaultProtocolThreshold, getProtocolTypeForTemplate, inferProtocolTypeForTemplate, resolvePatientProtocol } from './protocols';

export interface ProtocolRuntimeConfig {
  protocol: ProtocolType;
  durationSeconds: number;
  initialThreshold: number;
  adaptiveStep: number;
  lowerIsBetter: boolean;
  rewardBand?: ProtocolTemplate['rewardBand'];
  ratioReward?: ProtocolTemplate['ratioReward'];
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
  'Runtime controls: protocol mode, session duration, adaptive step, validated threshold bounds, and clinician-enabled reward frequency, condition, and threshold. '
  + 'Custom reward feedback uses the selected frequency range in raw EEG, not an approximation from broad band totals. '
  + 'Inhibit bands, montage or device mapping, sensitivity, clinical notes or rationale, recommended experiences, and the custom alias are documentation/display-only.';

export function validateCustomRewardBand(reward: ProtocolTemplate['rewardBand'] | undefined): string | null {
  if (!reward || !finite(reward.freqMin) || !finite(reward.freqMax)) {
    return 'Reward frequencies must span at least 0.5 Hz within the measured 3–45 Hz range.';
  }
  if (reward.freqMin >= reward.freqMax) {
    return 'Min Frequency must be below Max Frequency.';
  }
  if (reward.freqMin < 3 || reward.freqMax > 45 || reward.freqMax - reward.freqMin < 0.5) {
    return 'Reward frequencies must span at least 0.5 Hz within the measured 3–45 Hz range.';
  }
  if (reward.targetCondition !== 'above' && reward.targetCondition !== 'below') {
    return 'Reward condition must be above or below.';
  }
  if (!finite(reward.targetThreshold) || reward.targetThreshold < 0 || reward.targetThreshold > 1000
    || !hasSupportedThresholdPrecision(reward.targetThreshold)) {
    return 'Reward threshold must be a finite value from 0 to 1000 µV with at most two decimal places.';
  }
  return null;
}

export function validateCustomRatioReward(reward: ProtocolTemplate['ratioReward'] | undefined): string | null {
  if (!reward) return 'The saved ratio reward definition is missing.';
  for (const band of [reward.numerator, reward.denominator]) {
    if (!band || !finite(band.freqMin) || !finite(band.freqMax)) {
      return 'Ratio frequencies must span at least 0.5 Hz within the measured 3–45 Hz range.';
    }
    if (band.freqMin >= band.freqMax) {
      return 'Each ratio band’s Min Frequency must be below its Max Frequency.';
    }
    if (band.freqMin < 3 || band.freqMax > 45 || band.freqMax - band.freqMin < 0.5) {
      return 'Ratio frequencies must span at least 0.5 Hz within the measured 3–45 Hz range.';
    }
  }
  if (reward.targetCondition !== 'above' && reward.targetCondition !== 'below') {
    return 'Ratio reward condition must be above or below.';
  }
  if (!finite(reward.targetThreshold) || reward.targetThreshold < 0 || reward.targetThreshold > 1000
    || !hasSupportedThresholdPrecision(reward.targetThreshold)) {
    return 'Ratio threshold must be a finite unitless value from 0 to 1000 with at most two decimal places.';
  }
  return null;
}

/** Resolve the persisted assignment without allowing its display alias to affect training semantics. */
export function resolveProtocolRuntime(client: ClientProfile): ProtocolRuntimeResolution {
  const custom = client.customProtocolConfig;
  const assignedProtocol = resolvePatientProtocol(client);
  const canonical = getClinicalProtocolTemplate(assignedProtocol);
  if (!canonical) return { ok: false, error: 'The assigned protocol is not supported by this training engine.' };
  if (custom && !client.assignedProtocol && !inferProtocolTypeForTemplate(custom)) {
    return { ok: false, error: 'The saved protocol template has no supported training mode.' };
  }
  const rewardIsCustom = Boolean(custom && (
    custom.customRewardEnabled === true
    || (custom.customRewardEnabled === undefined && (
      custom.ratioReward
      || !hasCanonicalRewardDefinition(custom.rewardBand, canonical.rewardBand, assignedProtocol)
    ))
  ));
  if (custom?.customRewardEnabled !== undefined && typeof custom.customRewardEnabled !== 'boolean') {
    return { ok: false, error: 'The saved reward mode is invalid.' };
  }
  if (custom && custom.ratioReward !== undefined && custom.customRewardEnabled !== false) {
    if (assignedProtocol !== 'theta-beta-ratio' && assignedProtocol !== 'alpha-theta-crossover') {
      return { ok: false, error: 'Ratio rewards are only supported by ratio protocols.' };
    }
    const ratioError = validateCustomRatioReward(custom.ratioReward);
    if (ratioError) return { ok: false, error: ratioError };
  }
  if (rewardIsCustom) {
    const error = custom?.ratioReward
      ? validateCustomRatioReward(custom.ratioReward)
      : validateCustomRewardBand(custom?.rewardBand);
    if (error) return { ok: false, error };
  }
  const initialThreshold = rewardIsCustom
    ? custom?.ratioReward?.targetThreshold ?? custom!.rewardBand.targetThreshold
    : getDefaultProtocolThreshold(assignedProtocol);
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
      protocol: assignedProtocol,
      durationSeconds: Math.round(canonical.sessionDurationMinutes * 60),
      initialThreshold,
      adaptiveStep: canonical.adaptiveStep,
      lowerIsBetter: LOWER_IS_BETTER[assignedProtocol],
      thresholdBounds: { ...thresholdBounds },
      source: 'canonical-default',
    },
  };

  const protocol = getProtocolTypeForTemplate(custom, assignedProtocol);
  if (protocol !== assignedProtocol) {
    return { ok: false, error: 'The saved protocol template does not match the assigned training mode.' };
  }
  if (!custom.rewardBand) return { ok: false, error: 'The saved reward definition is missing.' };
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
      lowerIsBetter: rewardIsCustom
        ? (custom.ratioReward?.targetCondition ?? custom.rewardBand.targetCondition) === 'below'
        : LOWER_IS_BETTER[protocol],
      rewardBand: rewardIsCustom && !custom.ratioReward ? { ...custom.rewardBand } : undefined,
      ratioReward: rewardIsCustom && custom.ratioReward ? { ...custom.ratioReward } : undefined,
      thresholdBounds: { ...thresholdBounds },
      source: 'patient-override',
    },
  };
}
