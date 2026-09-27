import type { ClientProfile, ProtocolTemplate, ProtocolType } from '../types';

export const DEFAULT_PROTOCOL: ProtocolType = 'theta-beta-ratio';

/** Fixed overview bands and the frequency defaults used by training protocols. */
export const STANDARD_EEG_BANDS_HZ = {
  delta: { min: 1, max: 4 },
  theta: { min: 4, max: 8 },
  alpha: { min: 8, max: 13 },
  smr: { min: 12, max: 15 },
  beta: { min: 13, max: 30 },
  gamma: { min: 30, max: 45 },
} as const;
export const DEFAULT_BETA_BAND_HZ = STANDARD_EEG_BANDS_HZ.beta;

/** The assignment shown to both roles is the mode training initializes. */
export function resolvePatientProtocol(
  client: Pick<ClientProfile, 'assignedProtocol' | 'customProtocolConfig'>,
): ProtocolType {
  if (client.assignedProtocol) return client.assignedProtocol;
  if (client.customProtocolConfig) {
    return inferProtocolTypeForTemplate(client.customProtocolConfig) ?? DEFAULT_PROTOCOL;
  }
  return DEFAULT_PROTOCOL;
}

export interface ProtocolDefinition {
  value: ProtocolType;
  label: string;
  defaultThreshold: number;
}

export const protocolDefinitions: readonly ProtocolDefinition[] = [
  { value: 'theta-beta-ratio', label: 'Theta / Beta Ratio', defaultThreshold: 1.85 },
  { value: 'smr-enhancement', label: 'SMR Enhancement', defaultThreshold: 7.5 },
  { value: 'alpha-enhancement', label: 'Alpha Enhancement', defaultThreshold: 11 },
  { value: 'alpha-theta-crossover', label: 'Alpha / Theta Crossover', defaultThreshold: 1 },
  { value: 'beta-downtraining', label: 'Beta Downtraining', defaultThreshold: 14 },
  { value: 'individualized-upper-alpha', label: 'Individualized Upper Alpha', defaultThreshold: 11 },
];

export function getDefaultProtocolThreshold(protocol: ProtocolType): number {
  return protocolDefinitions.find((definition) => definition.value === protocol)?.defaultThreshold ?? 1.85;
}

export const DEFAULT_BETA_AMPLITUDE_REWARD_BAND: ProtocolTemplate['rewardBand'] = {
  name: 'Beta spectral amplitude',
  freqMin: DEFAULT_BETA_BAND_HZ.min,
  freqMax: DEFAULT_BETA_BAND_HZ.max,
  targetCondition: 'below',
  targetThreshold: getDefaultProtocolThreshold('beta-downtraining'),
};

export const DEFAULT_SINGLE_BAND_REWARDS: Partial<Record<ProtocolType, ProtocolTemplate['rewardBand']>> = {
  'smr-enhancement': { name: 'SMR spectral amplitude', freqMin: STANDARD_EEG_BANDS_HZ.smr.min, freqMax: STANDARD_EEG_BANDS_HZ.smr.max, targetCondition: 'above', targetThreshold: 7.5 },
  'alpha-enhancement': { name: 'Alpha spectral amplitude', freqMin: STANDARD_EEG_BANDS_HZ.alpha.min, freqMax: STANDARD_EEG_BANDS_HZ.alpha.max, targetCondition: 'above', targetThreshold: 11 },
  'beta-downtraining': DEFAULT_BETA_AMPLITUDE_REWARD_BAND,
};

export const DEFAULT_RATIO_REWARDS: Partial<Record<ProtocolType, NonNullable<ProtocolTemplate['ratioReward']>>> = {
  'theta-beta-ratio': {
    numerator: { freqMin: STANDARD_EEG_BANDS_HZ.theta.min, freqMax: STANDARD_EEG_BANDS_HZ.theta.max },
    denominator: { freqMin: STANDARD_EEG_BANDS_HZ.beta.min, freqMax: STANDARD_EEG_BANDS_HZ.beta.max },
    targetCondition: 'below', targetThreshold: 1.85,
  },
  'alpha-theta-crossover': {
    numerator: { freqMin: STANDARD_EEG_BANDS_HZ.theta.min, freqMax: STANDARD_EEG_BANDS_HZ.theta.max },
    denominator: { freqMin: STANDARD_EEG_BANDS_HZ.alpha.min, freqMax: STANDARD_EEG_BANDS_HZ.alpha.max },
    targetCondition: 'above', targetThreshold: 1,
  },
};

/**
 * Resolve a clinical template to the broad mode used by the training engine.
 * New templates persist protocolType explicitly. The text checks keep older
 * saved templates (created before protocolType existed) backward compatible.
 */
export function getProtocolTypeForTemplate(
  template: ProtocolTemplate,
  fallback: ProtocolType = DEFAULT_PROTOCOL
): ProtocolType {
  return inferProtocolTypeForTemplate(template) ?? fallback;
}

/**
 * Infer only values supported by persisted evidence. Unlike the UI-oriented
 * resolver above, this never invents a default for incomplete legacy records.
 */
export function inferProtocolTypeForTemplate(template: ProtocolTemplate): ProtocolType | undefined {
  if (template.protocolType) return template.protocolType;

  const identity = `${template.id} ${template.name} ${template.clinicalName}`.toLowerCase();
  if (identity.includes('sterman') || identity.includes('smr')) return 'smr-enhancement';
  if (
    identity.includes('peniston') ||
    identity.includes('alpha-theta') ||
    identity.includes('alphatheta') ||
    identity.includes('crossover')
  ) return 'alpha-theta-crossover';
  if (identity.includes('beta-down') || identity.includes('downtraining') || identity.includes('de-arousal')) {
    return 'beta-downtraining';
  }
  if (identity.includes('hardt') || identity.includes('alpha synchrony') || identity.includes('alpha enhancement')) {
    return 'alpha-enhancement';
  }
  if (identity.includes('lubar') || identity.includes('theta/beta') || identity.includes('theta-beta')) {
    return 'theta-beta-ratio';
  }
  return undefined;
}
