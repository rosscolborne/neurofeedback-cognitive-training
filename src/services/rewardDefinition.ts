import type { ProtocolRuntimeConfig } from './adaptiveEngine';
import { DEFAULT_RATIO_REWARDS, DEFAULT_SINGLE_BAND_REWARDS } from './protocols';

/** One description of the measurement and comparison used by training. */
export function getRuntimeRewardDefinition(config: ProtocolRuntimeConfig) {
  const ratio = config.ratioReward ?? (config.rewardBand ? undefined : DEFAULT_RATIO_REWARDS[config.protocol]);
  if (ratio) {
    const names = config.protocol === 'theta-beta-ratio' ? ['Theta', 'Beta'] : ['Theta', 'Alpha'];
    return {
      kind: 'ratio' as const,
      label: config.ratioReward
        ? `${names[0].toUpperCase()}/${names[1].toUpperCase()} (${ratio.numerator.freqMin}–${ratio.numerator.freqMax} / ${ratio.denominator.freqMin}–${ratio.denominator.freqMax} Hz)`
        : `${names[0].toUpperCase()}/${names[1].toUpperCase()}`,
      numeratorName: names[0], denominatorName: names[1],
      numerator: ratio.numerator, denominator: ratio.denominator,
      condition: ratio.targetCondition, threshold: config.initialThreshold, unit: '',
    };
  }
  const band = config.rewardBand ?? DEFAULT_SINGLE_BAND_REWARDS[config.protocol];
  if (!band) return null;
  const label = config.rewardBand ? 'REWARD'
    : config.protocol === 'smr-enhancement' ? 'SMR'
    : config.protocol === 'alpha-enhancement' ? 'ALPHA' : 'BETA';
  return {
    kind: 'amplitude' as const, label: `${label} (${band.freqMin}–${band.freqMax} Hz)`,
    band, condition: band.targetCondition, threshold: config.initialThreshold, unit: ' µV',
  };
}
