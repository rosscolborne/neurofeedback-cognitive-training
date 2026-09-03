import type { ProtocolType } from '../types';

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
