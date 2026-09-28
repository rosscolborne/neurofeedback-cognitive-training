import type { ProtocolRuntimeConfig } from '../services/adaptiveEngine';
import { getRuntimeRewardDefinition } from '../services/rewardDefinition';
import type { Fact } from './ui/FactGrid';

const formatRange = (band: { freqMin: number; freqMax: number }) => `${band.freqMin}–${band.freqMax} Hz`;

export function formatSessionLength(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  if (remainder === 0) return `${minutes} minutes`;
  return minutes > 0 ? `${minutes} min ${remainder} s` : `${remainder} seconds`;
}

/** The training rule the session runner will actually apply: bands, reward condition and length. */
export function describeProtocolRule(config: ProtocolRuntimeConfig): Fact[] {
  const reward = getRuntimeRewardDefinition(config);
  const ruleFacts: Fact[] = reward?.kind === 'ratio'
    ? [
        { label: reward.numeratorName, value: formatRange(reward.numerator) },
        { label: reward.denominatorName, value: formatRange(reward.denominator) },
        { label: 'Reward when', value: `${reward.numeratorName}/${reward.denominatorName} ${reward.condition === 'below' ? 'below' : 'above'} ${config.initialThreshold}` },
      ]
    : [
        ...(reward?.kind === 'amplitude' ? [{ label: 'Training band', value: formatRange(reward.band) }] : []),
        { label: 'Reward when', value: `${config.lowerIsBetter ? 'Below' : 'Above'} ${config.initialThreshold}${reward?.unit ?? ''}` },
      ];
  return [...ruleFacts, { label: 'Session length', value: formatSessionLength(config.durationSeconds) }];
}
