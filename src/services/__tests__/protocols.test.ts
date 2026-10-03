import { describe, expect, it } from 'vitest';
import { CLINICAL_PROTOCOL_TEMPLATES } from '../clinicalProtocolTemplates';
import type { ProtocolTemplate, ProtocolType } from '../../types';
import { DEFAULT_PROTOCOL, inferProtocolTypeForTemplate, protocolDisplayName } from '../protocols';

// What remains of the protocol catalogue serves the transitional clinical data
// model only: the default stored on new profiles, legacy record inference and
// legacy history labels.
describe('legacy protocol identifiers', () => {
  it('stores theta-beta-ratio as the default on new profiles, from a template that exists', () => {
    expect(DEFAULT_PROTOCOL).toBe('theta-beta-ratio');
    expect(CLINICAL_PROTOCOL_TEMPLATES.some((template) => template.protocolType === DEFAULT_PROTOCOL)).toBe(true);
  });

  it('labels every stored protocol, and title-cases an unknown identifier instead of showing it raw', () => {
    expect(protocolDisplayName('theta-beta-ratio')).toBe('Theta / Beta Ratio');
    expect(protocolDisplayName('individualized-upper-alpha')).toBe('Individualized Upper Alpha');
    expect(protocolDisplayName('retired_mode-x')).toBe('Retired Mode X');
  });

  it('reads each catalogue template as its explicit training mode', () => {
    expect(Object.fromEntries(CLINICAL_PROTOCOL_TEMPLATES.map((template) => [template.id, inferProtocolTypeForTemplate(template)])))
      .toEqual({
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
  ])('reads legacy templates saved before protocolType existed: %s', (name, expected) => {
    const legacy = {
      ...CLINICAL_PROTOCOL_TEMPLATES[0], id: 'custom-legacy', name, clinicalName: name, protocolType: undefined,
    } satisfies ProtocolTemplate;
    expect(inferProtocolTypeForTemplate(legacy)).toBe(expected);
  });

  it('never invents a mode for an unrecognised legacy template', () => {
    expect(inferProtocolTypeForTemplate({
      ...CLINICAL_PROTOCOL_TEMPLATES[0], id: 'custom-x', name: 'Mystery', clinicalName: 'Mystery', protocolType: undefined,
    })).toBeUndefined();
  });
});
