import { afterAll, expect, test, vi } from 'vitest';
import { deleteApp } from 'firebase-admin/app';
import { GoogleAuth, Impersonated, UserRefreshClient } from 'google-auth-library';
import { adminServices } from '../../e2e/helpers/dataLifecycle';
import { E2E_PROJECT_ID, E2E_SERVICE_ACCOUNT } from '../../e2e/helpers/adminCredential';

const settings = {
    E2E_FIREBASE_PROJECT_ID: E2E_PROJECT_ID,
    E2E_FIREBASE_SERVICE_ACCOUNT_EMAIL: E2E_SERVICE_ACCOUNT,
    E2E_ENABLE_PRIVILEGED_CLEANUP: 'true',
    E2E_CONFIRM_SHARED_PROJECT_TEST_ACCOUNTS: 'true',
};
const blockedAmbient = ['GOOGLE_APPLICATION_CREDENTIALS', 'E2E_FIREBASE_SERVICE_ACCOUNT_PATH',
    'E2E_CONFIRM_DEDICATED_PROJECT', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST'];
const previous = Object.fromEntries([...Object.keys(settings), ...blockedAmbient].map((name) => [name, process.env[name]]));
let services: Awaited<ReturnType<typeof adminServices>> | undefined;

afterAll(async () => {
    if (services) {
        await services.database.terminate();
        await deleteApp(services.authentication.app);
    }
    for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    }
    vi.restoreAllMocks();
});

test('Firestore and Admin Auth use the same impersonated client, never independent ADC', async () => {
    Object.assign(process.env, settings);
    for (const name of blockedAmbient) delete process.env[name];
    const source = new UserRefreshClient();
    const sourceLookup = vi.spyOn(GoogleAuth.prototype, 'getClient').mockResolvedValue(source);
    const mintedToken = vi.spyOn(Impersonated.prototype, 'getAccessToken')
        .mockResolvedValue({ token: 'local-impersonated-test-token' } as never);

    services = await adminServices();
    sourceLookup.mockRestore();

    const firestoreSettings = services.database as unknown as {
        _settings: { auth?: GoogleAuth<Impersonated>; credentials?: unknown; keyFilename?: string };
        _clientPool: { run: (tag: string, grpc: boolean, callback: (client: { auth: GoogleAuth<Impersonated> }) => Promise<boolean>) => Promise<boolean> };
    };
    const firestoreAuth = firestoreSettings._settings.auth;
    expect(firestoreAuth).toBeInstanceOf(GoogleAuth);
    expect(firestoreSettings._settings.credentials).toBeUndefined();
    expect(firestoreSettings._settings.keyFilename).toBeUndefined();
    const target = await firestoreAuth!.getClient();
    expect(target).toBeInstanceOf(Impersonated);
    expect((target as unknown as { targetPrincipal: string }).targetPrincipal).toBe(E2E_SERVICE_ACCOUNT);
    expect((target as unknown as { sourceClient: UserRefreshClient }).sourceClient).toBe(source);
    target.setCredentials({ access_token: 'local-impersonated-test-token', expiry_date: Date.now() + 600_000 });
    // The installed Firestore transport enumerates this object when attaching
    // authorization metadata. A Headers instance would silently yield no keys.
    const headers = await target.getRequestHeaders('https://firestore.googleapis.com');
    expect(Object.keys(headers)).toContain('Authorization');
    expect(headers.Authorization).toBe('Bearer local-impersonated-test-token');
    expect(await firestoreSettings._clientPool.run('credential-test', false, async (client) =>
        client.auth === firestoreAuth && await client.auth.getClient() === target)).toBe(true);

    expect(services.authentication.app.options.projectId).toBe(E2E_PROJECT_ID);
    expect(await services.authentication.app.options.credential?.getAccessToken()).toMatchObject({
        access_token: 'local-impersonated-test-token',
    });
    expect(mintedToken.mock.contexts.every((context) => context === target)).toBe(true);
});
