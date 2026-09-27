import { GoogleAuth, Impersonated, UserRefreshClient } from 'google-auth-library';
import type { Credential } from 'firebase-admin/app';

// This is the development Firebase project configured in src/services/firebase.ts.
// Deliberately keep the target out of operator-supplied environment variables.
export const E2E_PROJECT_ID = 'brainwell-327dc';
export const E2E_SERVICE_ACCOUNT = `waveable-e2e@${E2E_PROJECT_ID}.iam.gserviceaccount.com`;
export const TOKEN_LIFETIME_SECONDS = 600;

export function requireE2EAdminConfiguration(env: NodeJS.ProcessEnv = process.env): string {
    if (env.E2E_FIREBASE_PROJECT_ID !== E2E_PROJECT_ID) {
        throw new Error(`E2E_FIREBASE_PROJECT_ID must be the pinned development project ${E2E_PROJECT_ID}.`);
    }
    if (env.E2E_FIREBASE_SERVICE_ACCOUNT_EMAIL !== E2E_SERVICE_ACCOUNT) {
        throw new Error(`E2E_FIREBASE_SERVICE_ACCOUNT_EMAIL must be ${E2E_SERVICE_ACCOUNT}.`);
    }
    if (env.E2E_FIREBASE_SERVICE_ACCOUNT_PATH || env.GOOGLE_APPLICATION_CREDENTIALS) {
        throw new Error('Service-account key paths are refused. Use gcloud auth application-default login as a human.');
    }
    if (env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST) {
        throw new Error('The development-project E2E credential cannot run against emulators.');
    }
    if (env.E2E_ENABLE_PRIVILEGED_CLEANUP !== 'true') {
        throw new Error('Set E2E_ENABLE_PRIVILEGED_CLEANUP=true for privileged E2E work.');
    }
    if (env.E2E_CONFIRM_SHARED_PROJECT_TEST_ACCOUNTS !== 'true' || env.E2E_CONFIRM_DEDICATED_PROJECT === 'true') {
        throw new Error('Confirm exclusive test accounts in the pinned development project.');
    }
    return E2E_PROJECT_ID;
}

/** Both SDKs share one impersonated client; neither resolves ADC independently. */
export async function impersonatedE2ECredentials(): Promise<{ adminCredential: Credential; firestoreAuth: GoogleAuth<Impersonated> }> {
    requireE2EAdminConfiguration();
    let source;
    try {
        source = await new GoogleAuth({
            scopes: ['https://www.googleapis.com/auth/cloud-platform'],
        }).getClient();
    } catch {
        throw new Error('No human Application Default Credentials are available. Run gcloud auth application-default login.');
    }
    if (!(source instanceof UserRefreshClient)) {
        throw new Error('E2E impersonation requires human Application Default Credentials. Run gcloud auth application-default login.');
    }
    const target = new Impersonated({
        sourceClient: source,
        targetPrincipal: E2E_SERVICE_ACCOUNT,
        targetScopes: ['https://www.googleapis.com/auth/cloud-platform'],
        lifetime: TOKEN_LIFETIME_SECONDS,
    });
    // Fail before any fixture or lease write if ADC or getAccessToken is missing.
    try {
        if (!(await target.getAccessToken()).token) throw new Error('No impersonated token was returned.');
    } catch {
        throw new Error(`Could not impersonate ${E2E_SERVICE_ACCOUNT}. Check human ADC login, IAM Credentials API, and the getAccessToken grant on this service account.`);
    }
    const adminCredential: Credential = {
        async getAccessToken() {
            const { token } = await target.getAccessToken();
            if (!token) throw new Error('E2E impersonation returned no access token.');
            const remaining = Math.floor(((target.credentials.expiry_date ?? 0) - Date.now()) / 1000);
            return { access_token: token, expires_in: Math.max(1, remaining) };
        },
    };
    return {
        adminCredential,
        firestoreAuth: new GoogleAuth({ authClient: target, projectId: E2E_PROJECT_ID }),
    };
}
