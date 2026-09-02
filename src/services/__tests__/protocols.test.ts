import { describe, expect, it } from 'vitest';
import { getDefaultProtocolThreshold, protocolDefinitions } from '../protocols';

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
});
