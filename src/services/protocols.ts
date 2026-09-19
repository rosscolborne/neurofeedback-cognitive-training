import type { ProtocolTemplate, ProtocolType } from '../types';

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

/**
 * Resolve a clinical template to the broad mode used by the training engine.
 * New templates persist protocolType explicitly. The text checks keep older
 * saved templates (created before protocolType existed) backward compatible.
 */
export function getProtocolTypeForTemplate(
  template: ProtocolTemplate,
  fallback: ProtocolType = 'theta-beta-ratio'
): ProtocolType {
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
  return fallback;
}
