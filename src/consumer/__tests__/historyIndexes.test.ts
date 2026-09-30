import { describe, expect, it } from 'vitest';
import indexesJson from '../../../firestore.indexes.json?raw';
import {
  boundedPageSize,
  DEFAULT_HISTORY_PAGE_SIZE,
  GAME_HISTORY_EQUALITY_FILTERS,
  GAME_HISTORY_ORDER,
  MAX_HISTORY_PAGE_SIZE,
} from '../repositories/gameSessionRepository';

// The Firestore emulator does not enforce indexes, so this ties the history
// queries the repositories build to firestore.indexes.json (NFCT-18). No new
// index is needed: game history uses the (gameId ↑, endedAt ↓) composite, and
// the other consumer queries use automatic single-field indexes.

interface IndexField { fieldPath: string; order?: 'ASCENDING' | 'DESCENDING' }
interface IndexConfig {
  indexes: { collectionGroup: string; queryScope: string; fields: IndexField[] }[];
  fieldOverrides: { collectionGroup: string; fieldPath: string; indexes: unknown[] }[];
}

const config = JSON.parse(indexesJson) as IndexConfig;
const direction = { asc: 'ASCENDING', desc: 'DESCENDING' } as const;

function hasAutomaticIndex(collectionGroup: string, fieldPath: string): boolean {
  // A field keeps its automatic single-field indexes unless an override replaces them.
  return !config.fieldOverrides.some((entry) => entry.collectionGroup === collectionGroup && entry.fieldPath === fieldPath);
}

describe('history queries and firestore.indexes.json', () => {
  it("serves one game's history (gameId ==, endedAt desc) from the composite index", () => {
    const expected = [
      ...GAME_HISTORY_EQUALITY_FILTERS.map((fieldPath) => ({ fieldPath, order: 'ASCENDING' })),
      ...GAME_HISTORY_ORDER.map(({ field, direction: order }) => ({ fieldPath: field, order: direction[order] })),
    ];

    expect(config.indexes).toContainEqual({ collectionGroup: 'gameSessions', queryScope: 'COLLECTION', fields: expected });
  });

  it('serves all-games history (endedAt desc) and the per-session EEG lookup from automatic indexes', () => {
    expect(GAME_HISTORY_ORDER).toEqual([{ field: 'endedAt', direction: 'desc' }]);
    expect(hasAutomaticIndex('gameSessions', 'endedAt')).toBe(true);
    expect(hasAutomaticIndex('eegRecordings', 'gameSessionId')).toBe(true);
  });

  it('bounds the page size', () => {
    expect(boundedPageSize(undefined)).toBe(DEFAULT_HISTORY_PAGE_SIZE);
    expect(boundedPageSize(0)).toBe(1);
    expect(boundedPageSize(12.7)).toBe(12);
    expect(boundedPageSize(10_000)).toBe(MAX_HISTORY_PAGE_SIZE);
    expect(boundedPageSize(Number.POSITIVE_INFINITY)).toBe(DEFAULT_HISTORY_PAGE_SIZE);
  });
});
