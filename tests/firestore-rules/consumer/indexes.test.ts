import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The emulator does not enforce indexes, so this checks the deployable
// configuration itself: the design's composite indexes and field exemptions,
// wired into firebase.json.
const firebaseConfig = JSON.parse(readFileSync('firebase.json', 'utf8'));
const indexConfig = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'));

describe('firestore.indexes.json', () => {
    it('is wired into firebase.json next to the rules', () => {
        expect(firebaseConfig.firestore).toEqual({ rules: 'firestore.rules', indexes: 'firestore.indexes.json' });
    });

    it('defines exactly the Stage 1 composite indexes', () => {
        expect(indexConfig.indexes).toEqual([
            {
                collectionGroup: 'gameSessions',
                queryScope: 'COLLECTION',
                fields: [{ fieldPath: 'gameId', order: 'ASCENDING' }, { fieldPath: 'endedAt', order: 'DESCENDING' }],
            },
            {
                collectionGroup: 'accountDeletions',
                queryScope: 'COLLECTION',
                fields: [{ fieldPath: 'status', order: 'ASCENDING' }, { fieldPath: 'updatedAt', order: 'ASCENDING' }],
            },
        ]);
    });

    it('exempts never-queried bulk fields from single-field indexing', () => {
        expect(indexConfig.fieldOverrides).toEqual([
            { collectionGroup: 'gameSessions', fieldPath: 'trials', indexes: [] },
            { collectionGroup: 'gameSessions', fieldPath: 'summary.metrics', indexes: [] },
            { collectionGroup: 'gameSessions', fieldPath: 'result.reasons', indexes: [] },
            { collectionGroup: 'eegRecordings', fieldPath: 'timeline', indexes: [] },
            { collectionGroup: 'eegRecordings', fieldPath: 'quality.channelGoodFraction', indexes: [] },
            { collectionGroup: 'eegRecordings', fieldPath: 'summary', indexes: [] },
        ]);
    });
});
