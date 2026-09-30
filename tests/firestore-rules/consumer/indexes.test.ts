import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// The emulator does not enforce indexes, so this checks the deployable
// configuration itself: it passes the Firebase CLI's own deploy-time spec
// validation (offline), and every query shape the consumer app and trusted
// processing (NFCT-19) issue has a covering index.

type Order = 'ASCENDING' | 'DESCENDING';
type Scope = 'COLLECTION' | 'COLLECTION_GROUP';
interface IndexField { fieldPath: string; order?: Order; arrayConfig?: string }
interface CompositeIndex { collectionGroup: string; queryScope: Scope; fields: IndexField[] }
interface FieldOverride {
    collectionGroup: string;
    fieldPath: string;
    indexes: { order?: Order; arrayConfig?: string; queryScope?: Scope }[];
}
interface IndexSpec { indexes: CompositeIndex[]; fieldOverrides: FieldOverride[] }
interface FirestoreApi {
    upgradeOldSpec(spec: unknown): IndexSpec;
    validateSpec(spec: IndexSpec): void;
}

const { FirestoreApi } = createRequire(import.meta.url)('firebase-tools/lib/firestore/api.js') as {
    FirestoreApi: new () => FirestoreApi;
};
const firebaseConfig = JSON.parse(readFileSync('firebase.json', 'utf8'));
const indexConfig = JSON.parse(readFileSync('firestore.indexes.json', 'utf8')) as IndexSpec;

/**
 * A query with equality filters, then a range filter or sort on one field,
 * needs a composite index on the equality fields (any order) followed by that
 * field in the query's direction.
 */
function compositeFor(query: { collection: string; scope: Scope; equality: string[]; ordered: string; order: Order }) {
    return indexConfig.indexes.find((index) => {
        if (index.collectionGroup !== query.collection || index.queryScope !== query.scope) return false;
        const fields = index.fields.filter((field) => field.fieldPath !== '__name__');
        const last = fields.at(-1);
        const leading = fields.slice(0, -1).map((field) => field.fieldPath).sort();
        return last?.fieldPath === query.ordered && last.order === query.order &&
            fields.slice(0, -1).every((field) => field.order !== undefined) &&
            JSON.stringify(leading) === JSON.stringify([...query.equality].sort());
    });
}

function override(collection: string, fieldPath: string) {
    return indexConfig.fieldOverrides.find((entry) => entry.collectionGroup === collection && entry.fieldPath === fieldPath);
}

describe('firestore.indexes.json', () => {
    it('is wired into firebase.json next to the rules', () => {
        expect(firebaseConfig.firestore).toEqual({ rules: 'firestore.rules', indexes: 'firestore.indexes.json' });
    });

    it("passes the Firebase CLI's deploy-time spec validation", () => {
        const api = new FirestoreApi();
        expect(() => api.validateSpec(api.upgradeOldSpec(indexConfig))).not.toThrow();
        expect(() => api.validateSpec(api.upgradeOldSpec({
            indexes: [{ collectionGroup: 'gameSessions', queryScope: 'EVERYWHERE', fields: [] }],
        }))).toThrow();
    });

    it('covers game history: gameId ==, orderBy endedAt desc', () => {
        expect(compositeFor({ collection: 'gameSessions', scope: 'COLLECTION', equality: ['gameId'], ordered: 'endedAt', order: 'DESCENDING' })).toBeDefined();
    });

    it("covers the upgrade scan of a user's sessions: gameId, modeId, result.validity ==, startLevel range", () => {
        expect(compositeFor({
            collection: 'gameSessions', scope: 'COLLECTION',
            equality: ['gameId', 'modeId', 'result.validity'], ordered: 'startLevel', order: 'ASCENDING',
        })).toBeDefined();
    });

    it('covers the processing sweep across users: processing.state ==, createdAt range', () => {
        expect(compositeFor({
            collection: 'gameSessions', scope: 'COLLECTION_GROUP',
            equality: ['processing.state'], ordered: 'createdAt', order: 'ASCENDING',
        })).toBeDefined();
    });

    it('covers the pending sweep across users (no result or processing to filter on): createdAt range', () => {
        const createdAt = override('gameSessions', 'createdAt');
        expect(createdAt?.indexes).toContainEqual({ order: 'ASCENDING', queryScope: 'COLLECTION_GROUP' });
        // Overriding a field replaces its automatic indexes, so the collection-scope defaults are kept.
        expect(createdAt?.indexes).toEqual(expect.arrayContaining([
            { order: 'ASCENDING', queryScope: 'COLLECTION' },
            { order: 'DESCENDING', queryScope: 'COLLECTION' },
            { arrayConfig: 'CONTAINS', queryScope: 'COLLECTION' },
        ]));
    });

    it("covers trusted scoring's per-user scans (NFCT-19) with single-field indexes", () => {
        // Pending-predecessor scan: createdAt >= T, orderBy createdAt desc.
        expect(override('gameSessions', 'createdAt')?.indexes).toContainEqual({ order: 'DESCENDING', queryScope: 'COLLECTION' });
        // Rebuild: gameId ==, no order; gameId keeps its automatic single-field index.
        expect(override('gameSessions', 'gameId')).toBeUndefined();
    });

    it('covers the account-deletion sweep: status ==, updatedAt range', () => {
        expect(compositeFor({ collection: 'accountDeletions', scope: 'COLLECTION', equality: ['status'], ordered: 'updatedAt', order: 'ASCENDING' })).toBeDefined();
    });

    it('has no composite index beyond those query shapes', () => {
        expect(indexConfig.indexes).toHaveLength(4);
    });

    it('exempts never-queried bulk fields from single-field indexing, including result.reasons', () => {
        const exempt = indexConfig.fieldOverrides.filter((entry) => entry.indexes.length === 0)
            .map((entry) => `${entry.collectionGroup}.${entry.fieldPath}`);
        expect(exempt).toEqual([
            'gameSessions.trials',
            'gameSessions.summary.metrics',
            'gameSessions.result.reasons',
            'eegRecordings.timeline',
            'eegRecordings.quality.channelGoodFraction',
            'eegRecordings.summary',
        ]);
    });
});
