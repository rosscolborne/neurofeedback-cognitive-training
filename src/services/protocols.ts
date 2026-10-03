// Protocol identifiers of the transitional clinical data model
// (clients/{uid}.assignedProtocol, legacy sessions): the default a new profile
// stores, display names for legacy history, and inference for legacy records.
// The consumer app has no EEG protocols and nothing here drives EEG feedback.
import type { ProtocolTemplate, ProtocolType } from '../types';

export const DEFAULT_PROTOCOL: ProtocolType = 'theta-beta-ratio';

const PROTOCOL_LABELS: Record<ProtocolType, string> = {
  'theta-beta-ratio': 'Theta / Beta Ratio',
  'smr-enhancement': 'SMR Enhancement',
  'alpha-enhancement': 'Alpha Enhancement',
  'alpha-theta-crossover': 'Alpha / Theta Crossover',
  'beta-downtraining': 'Beta Downtraining',
  'individualized-upper-alpha': 'Individualized Upper Alpha',
};

/** Human-readable protocol name for legacy records; unknown stored identifiers are title-cased rather than shown raw. */
export function protocolDisplayName(protocol: ProtocolType | string): string {
  return PROTOCOL_LABELS[protocol as ProtocolType]
    ?? protocol.split(/[-_\s]+/).filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');
}

/**
 * Infer only values supported by persisted evidence. It never invents a default for
 * incomplete legacy records.
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
