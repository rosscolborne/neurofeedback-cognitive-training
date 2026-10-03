import { describe, expect, it } from 'vitest';
import { GAME_CATALOGUE, mentalMath, sequenceMemory, type GameListing, type GameModeDefinition } from '@nfct/shared';
import { catalogueGames, maxRunLengthLabel, runLengthLabel, toCatalogueGame } from '../catalogueGames';

const mode = (id: string, levels: number, runDurationMs?: number | null): GameModeDefinition => ({
  id,
  levels: Array.from({ length: levels }, (_, index) => ({ level: index + 1, label: `Level ${index + 1}`, params: {} })),
  adaptive: false,
  runDurationMs,
  initiallyUnlockedStartLevel: 1,
  unlockPolicy: ({ bestPeakLevel }) => bestPeakLevel,
});

const listing = (definition: Partial<GameListing['definition']>): GameListing => ({
  definition: { id: 'fixture-game', domainWeights: { reasoning: 1 }, modes: [mode('classic', 3)], ...definition },
  name: 'Fixture Game',
  summary: 'A game used only by these tests.',
  icon: 'calculator',
});

describe('catalogue games', () => {
  it('derives the Mental Math and Sequence Memory cards from their listings and current definitions', () => {
    expect(catalogueGames()).toEqual([{
      id: 'mental-math',
      name: 'Mental Math',
      summary: GAME_CATALOGUE[0]!.summary,
      icon: 'calculator',
      domains: [
        { id: 'math', label: 'Math', weight: 0.7, percent: 70 },
        { id: 'processing-speed', label: 'Processing speed', weight: 0.2, percent: 20 },
        { id: 'memory', label: 'Memory', weight: 0.1, percent: 10 },
      ],
      // The time bank (NFCT-60): no fixed length, at most MAX_RUN_MS.
      runLengthMs: null,
      maxRunLengthMs: mentalMath.MAX_RUN_MS,
      levels: 10,
    }, {
      id: 'sequence-memory',
      name: 'Sequence Memory',
      summary: GAME_CATALOGUE[1]!.summary,
      icon: 'grid',
      // NFCT-93: the owner's weights, shown as whole percentages.
      domains: [
        { id: 'memory', label: 'Memory', weight: 0.6, percent: 60 },
        { id: 'spatial', label: 'Spatial', weight: 0.4, percent: 40 },
      ],
      // A fixed number of trials: no fixed length, at most every trial at its longest.
      runLengthMs: null,
      maxRunLengthMs: sequenceMemory.MAX_RUN_MS,
      levels: 10,
    }]);
    expect(maxRunLengthLabel(mentalMath.MAX_RUN_MS)).toBe('Up to 3 minutes');
    expect(maxRunLengthLabel(sequenceMemory.MAX_RUN_MS)).toBe('Up to 6 minutes');
    expect(maxRunLengthLabel(90_000)).toBe('Up to 90 seconds');
  });

  it('keeps catalogue order', () => {
    const first = listing({ id: 'first-game' });
    const second = listing({ id: 'second-game' });
    expect(catalogueGames([second, first]).map((game) => game.id)).toEqual(['second-game', 'first-game']);
  });

  it('files a game under its weighted domains, heaviest first, ties in domain-catalogue order, zero weights left out', () => {
    const game = toCatalogueGame(listing({ domainWeights: { verbal: 0.2, spatial: 0.4, memory: 0, reasoning: 0.4 } }));
    expect(game.domains.map((domain) => domain.id)).toEqual(['reasoning', 'spatial', 'verbal']);
    expect(game.domains.map((domain) => domain.label)).toEqual(['Reasoning', 'Spatial', 'Verbal']);
    expect(game.domains.map((domain) => domain.percent)).toEqual([40, 40, 20]);
  });

  it('shows each game\'s weights as whole percentages that sum to 100, the leftover point to the heavier domain on a tie', () => {
    const game = toCatalogueGame(listing({ domainWeights: { memory: 1 / 3, verbal: 1 / 3, reasoning: 1 / 3 } }));
    expect(game.domains.map(({ id, percent }) => [id, percent])).toEqual([['reasoning', 34], ['memory', 33], ['verbal', 33]]);
    for (const catalogueGame of catalogueGames()) {
      expect(catalogueGame.domains.reduce((total, domain) => total + domain.percent, 0)).toBe(100);
    }
  });

  it('reads the run length from timed modes only, and the level count from the longest mode', () => {
    expect(toCatalogueGame(listing({ modes: [mode('a', 3), mode('b', 5, null)] }))).toMatchObject({ runLengthMs: null, levels: 5 });
    expect(toCatalogueGame(listing({ modes: [mode('a', 4, 120_000), mode('b', 2), mode('c', 6, 60_000)] })))
      .toMatchObject({ runLengthMs: { min: 60_000, max: 120_000 }, levels: 6 });
  });

  it('labels run lengths in plain words', () => {
    expect(runLengthLabel({ min: 90_000, max: 90_000 })).toBe('90 seconds');
    expect(runLengthLabel({ min: 1_000, max: 1_000 })).toBe('1 second');
    expect(runLengthLabel({ min: 120_000, max: 120_000 })).toBe('2 minutes');
    expect(runLengthLabel({ min: 150_000, max: 150_000 })).toBe('150 seconds');
    expect(runLengthLabel({ min: 60_000, max: 180_000 })).toBe('60 seconds to 3 minutes');
  });
});
