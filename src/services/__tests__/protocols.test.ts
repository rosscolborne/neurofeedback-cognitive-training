import { describe, expect, it } from 'vitest';
import { CLINICAL_PROTOCOL_TEMPLATES } from '../clinicalProtocolTemplates';
import type { ProtocolTemplate, ProtocolType } from '../../types';
import { getDefaultProtocolThreshold, getProtocolTypeForTemplate, protocolDefinitions } from '../protocols';

describe('protocol definitions', () => {
  it('supplies each supported protocol and its default threshold', () => {
    expect(protocolDefinitions).toHaveLength(6);
    expect(getDefaultProtocolThreshold('theta-beta-ratio')).toBe(1.85);
    expect(getDefaultProtocolThreshold('smr-enhancement')).toBe(7.5);
    expect(getDefaultProtocolThreshold('alpha-enhancement')).toBe(11);
    expect(getDefaultProtocolThreshold('alpha-theta-crossover')).toBe(1);
    expect(getDefaultProtocolThreshold('beta-downtraining')).toBe(14);
    expect(getDefaultProtocolThreshold('individualized-upper-alpha')).toBe(11);
  });

  it('maps every clinician-selectable template to its explicit patient training mode', () => {
    const mappings = Object.fromEntries(
      CLINICAL_PROTOCOL_TEMPLATES.map((template) => [template.id, getProtocolTypeForTemplate(template)])
    );

    expect(mappings).toEqual({
      'proto-lubar-tbr': 'theta-beta-ratio',
      'proto-sterman-smr': 'smr-enhancement',
      'proto-hardt-alpha': 'alpha-enhancement',
      'proto-peniston-alphatheta': 'alpha-theta-crossover',
      'proto-beta-down': 'beta-downtraining',
    });
  });

  it.each<[string, ProtocolType]>([
    ['Sterman SMR Stillness Protocol', 'smr-enhancement'],
    ['Peniston Alpha-Theta Protocol', 'alpha-theta-crossover'],
    ['Hardt Alpha Synchrony Protocol', 'alpha-enhancement'],
    ['Beta De-arousal Downtraining', 'beta-downtraining'],
    ['Lubar Theta/Beta Ratio Protocol', 'theta-beta-ratio'],
  ])('keeps legacy custom templates backward compatible: %s', (name, expected) => {
    const legacy = {
      ...CLINICAL_PROTOCOL_TEMPLATES[0],
      id: 'custom-legacy',
      name,
      clinicalName: name,
      protocolType: undefined,
    } satisfies ProtocolTemplate;

    expect(getProtocolTypeForTemplate(legacy)).toBe(expected);
  });
});
