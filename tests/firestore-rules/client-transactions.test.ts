import { assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { afterAll, beforeEach, describe, it } from 'vitest';
import { as, closeEnvironment, emailOf, resetWorld } from './fixture';

// Replays the app's real transactions, including their reads of documents that
// may not exist yet, so rules that only pass batch-shaped writes cannot hide a
// broken client flow. Shapes mirror src/services/storageEngine.ts.

beforeEach(resetWorld);
afterAll(closeEnvironment);

describe('profile transactions', () => {
    it('storageEngine.getCurrentClient creates a missing profile for the signed-in user', async () => {
        const fresh = 'fresh-patient';
        const database = await as(fresh);
        await assertSucceeds(getDoc(doc(database, `clients/${fresh}`)));
        await assertSucceeds(setDoc(doc(database, `clients/${fresh}`), { id: fresh, email: emailOf(fresh), name: 'New', status: 'active', brainMaps: [], isDemo: false }));
    });
});
