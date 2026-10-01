import { describe, expect, it } from 'vitest';
import {
  DOMAIN_CATALOG,
  DOMAIN_LABELS,
  GAME_CATALOGUE,
  GAME_ICON_KEYS,
  GAME_MODULE_REGISTRY,
  domainWeightsSchema,
  mentalMath,
  slugIdSchema,
} from '@nfct/shared';

describe('game catalogue', () => {
  it('lists Mental Math, the one Stage 1 game, at the version new sessions play', () => {
    expect(GAME_CATALOGUE.map((listing) => listing.definition.id)).toEqual(['mental-math']);
    expect(GAME_CATALOGUE[0]!.definition).toBe(mentalMath.definition);
    expect(GAME_CATALOGUE[0]).toMatchObject({ name: 'Mental Math', icon: 'calculator' });
  });

  it('gives every listing a unique game, a name, one short sentence and a known icon', () => {
    const ids = GAME_CATALOGUE.map((listing) => listing.definition.id);
    expect(new Set(ids).size).toBe(ids.length);
    const names = GAME_CATALOGUE.map((listing) => listing.name);
    expect(new Set(names).size).toBe(names.length);
    for (const listing of GAME_CATALOGUE) {
      expect(slugIdSchema.safeParse(listing.definition.id).success).toBe(true);
      expect(listing.name.trim()).toBe(listing.name);
      expect(listing.name.length).toBeGreaterThan(0);
      expect(listing.summary).toMatch(/^[A-Z].{9,79}\.$/);
      expect(GAME_ICON_KEYS).toContain(listing.icon);
      expect(domainWeightsSchema.safeParse(listing.definition.domainWeights).success).toBe(true);
    }
  });

  it('lists each game at the version trusted scoring treats as current', () => {
    for (const listing of GAME_CATALOGUE) {
      expect(GAME_MODULE_REGISTRY.current(listing.definition.id)?.definition).toBe(listing.definition);
    }
  });

  it('labels every domain in the catalogue, and nothing else', () => {
    expect(Object.keys(DOMAIN_LABELS).sort()).toEqual([...DOMAIN_CATALOG.domains].sort());
    const labels = Object.values(DOMAIN_LABELS);
    expect(new Set(labels).size).toBe(labels.length);
    expect(DOMAIN_LABELS['processing-speed']).toBe('Processing speed');
  });
});
