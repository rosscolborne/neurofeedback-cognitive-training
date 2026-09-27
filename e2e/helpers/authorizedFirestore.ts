import { auth } from '../../src/services/firebase';

/** Browser-only Firestore REST reads. The Firebase ID token stays in this page. */
export type AuthorizedDocument = {
    id: string;
    fields: Record<string, unknown>;
    createTimeMs: number;
};

export type AuthorizedRead =
    | { kind: 'document'; path: string }
    | { kind: 'collection'; path: string; where?: { field: string; equals: string } };

type FirestoreValue = Record<string, unknown>;
type RestDocument = {
    name: string;
    fields?: Record<string, FirestoreValue>;
    createTime?: string;
};

function decode(value: FirestoreValue): unknown {
    if ('nullValue' in value) return null;
    if ('stringValue' in value) return value.stringValue;
    if ('booleanValue' in value) return value.booleanValue;
    if ('integerValue' in value) return Number(value.integerValue);
    if ('doubleValue' in value) return Number(value.doubleValue);
    if ('timestampValue' in value) return value.timestampValue;
    if ('referenceValue' in value) return value.referenceValue;
    if ('arrayValue' in value) {
        const array = value.arrayValue as { values?: FirestoreValue[] };
        return (array.values ?? []).map(decode);
    }
    if ('mapValue' in value) {
        const map = value.mapValue as { fields?: Record<string, FirestoreValue> };
        return Object.fromEntries(Object.entries(map.fields ?? {}).map(([key, entry]) => [key, decode(entry)]));
    }
    throw new Error('Unsupported Firestore value in an authorized persistence read.');
}

function documentFromRest(document: RestDocument): AuthorizedDocument {
    if (!document.name || !document.createTime) throw new Error('Firestore response lacks document metadata.');
    const createTimeMs = Date.parse(document.createTime);
    if (!Number.isFinite(createTimeMs)) throw new Error('Firestore response has an invalid createTime.');
    return {
        id: document.name.slice(document.name.lastIndexOf('/') + 1),
        fields: Object.fromEntries(Object.entries(document.fields ?? {}).map(([key, value]) => [key, decode(value)])),
        createTimeMs,
    };
}

function encodedPath(path: string): string {
    const segments = path.split('/');
    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
        throw new Error('Invalid Firestore document or collection path.');
    }
    return segments.map(encodeURIComponent).join('/');
}

/** Runs as the signed-in browser account, subject to the deployed Firestore rules. */
export async function authorizedFirestoreRead(
    expectedUid: string,
    read: AuthorizedRead,
    expectedProjectId?: string,
): Promise<AuthorizedDocument | AuthorizedDocument[] | null> {
    await auth.authStateReady();
    const user = auth.currentUser;
    if (!user || user.uid !== expectedUid) throw new Error('Persistence read is not using the expected test account.');
    const projectId = auth.app.options.projectId;
    if (!projectId) throw new Error('Authenticated Firebase app has no project ID.');
    if (expectedProjectId && projectId !== expectedProjectId) {
        throw new Error('Persistence read is using the wrong Firebase project.');
    }
    const emulator = import.meta.env.VITE_E2E_EMULATORS === 'true';
    if (emulator && projectId !== 'demo-neurasticity-protocol-e2e') {
        throw new Error('Persistence reads require the local E2E emulator project.');
    }
    const root = `${emulator ? 'http://127.0.0.1:8080' : 'https://firestore.googleapis.com'}/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
    const headers = { Authorization: `Bearer ${await user.getIdToken()}` };
    let response: Response;
    if (read.kind === 'document') {
        if (read.path.split('/').length % 2 !== 0) throw new Error('Expected a document path.');
        response = await fetch(`${root}/${encodedPath(read.path)}`, { headers });
        if (response.status === 404) return null;
    } else {
        const parts = read.path.split('/');
        if (parts.length % 2 !== 1) throw new Error('Expected a collection path.');
        const collectionId = parts.at(-1)!;
        const parent = parts.length === 1 ? root : `${root}/${encodedPath(parts.slice(0, -1).join('/'))}`;
        response = await fetch(`${parent}:runQuery`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ structuredQuery: {
                from: [{ collectionId }],
                ...(read.where && { where: { fieldFilter: {
                    field: { fieldPath: read.where.field },
                    op: 'EQUAL',
                    value: { stringValue: read.where.equals },
                } } }),
            } }),
        });
    }
    if (!response.ok) {
        // Never include the response body, URL, or authorization header in errors.
        throw new Error(`Firestore authorized read failed (${response.status === 403 ? 'permission-denied' : response.status}).`);
    }
    if (read.kind === 'document') return documentFromRest(await response.json() as RestDocument);
    const rows = await response.json() as { document?: RestDocument }[];
    if (!Array.isArray(rows)) throw new Error('Firestore query returned an invalid response.');
    return rows.flatMap((row) => row.document ? [documentFromRest(row.document)] : []);
}
