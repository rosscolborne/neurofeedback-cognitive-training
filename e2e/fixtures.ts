import { expect, test as base, type ConsoleMessage, type Request, type Response } from '@playwright/test';

// Import test and expect from this module in every Playwright spec and setup.

function permissionError(text: string, firestoreRequest = false): string | undefined {
    const match = text.match(/\bpermission[-_]denied\b|missing or insufficient permissions|(?:firestore|firebase)[^\n]{0,120}\bpermission denied\b/i)
        ?? (firestoreRequest ? text.match(/\bpermission denied\b/i) : null);
    return match?.[0];
}

function isFirestoreRequest(request: Request): boolean {
    const url = new URL(request.url());
    return url.hostname === 'firestore.googleapis.com'
        || url.hostname.endsWith('.firestore.googleapis.com')
        || url.pathname.includes('/google.firestore.v1.Firestore/')
        || /\/databases\/[^/]+\/documents(?:\/|$)/.test(url.pathname);
}

function responsePermissionError(body: string, status: number): string | undefined {
    if (status >= 400) return permissionError(body, true);

    // Successful Firestore responses can contain user data. Inspect only error
    // envelopes, including WebChannel target-change causes on HTTP 200.
    const envelopes = body.match(/"(?:error|cause)"\s*:\s*\{[^{}]{0,1000}\}/gi) ?? [];
    for (const envelope of envelopes) {
        const match = permissionError(envelope, true);
        if (match) return match;
        if (/"code"\s*:\s*7\b/.test(envelope)) return 'gRPC code 7';
    }
    return undefined;
}

export const test = base.extend<{ permissionErrorGuard: void }>({
    permissionErrorGuard: [async ({ context }, use) => {
        const errors: string[] = [];
        const pendingResponses = new Set<Promise<void>>();

        const onConsole = (message: ConsoleMessage) => {
            if (message.type() !== 'error' && message.type() !== 'warning') return;
            const match = permissionError(message.text());
            if (match) errors.push(`console: ${match}`);
        };
        const onWebError = (webError: { error(): Error }) => {
            const match = permissionError(webError.error().message);
            if (match) errors.push(`uncaught page error: ${match}`);
        };
        const onRequestFailed = (request: Request) => {
            if (!isFirestoreRequest(request)) return;
            const match = permissionError(request.failure()?.errorText ?? '', true);
            if (match) errors.push(`failed Firestore request: ${match}`);
        };
        const track = (check: Promise<void>) => {
            pendingResponses.add(check);
            void check.finally(() => pendingResponses.delete(check));
        };
        const inspectResponse = async (response: Response) => {
            try {
                const match = responsePermissionError(await response.text(), response.status());
                if (match) errors.push(`Firestore response (${response.status()}): ${match}`);
            } catch {
                // Some completed requests have no readable response body.
            }
        };
        const onResponse = (response: Response) => {
            if (response.status() >= 400 && isFirestoreRequest(response.request())) track(inspectResponse(response));
        };
        const onRequestFinished = (request: Request) => {
            if (!isFirestoreRequest(request)) return;
            const check = (async () => {
                try {
                    const response = await request.response();
                    if (response && response.status() < 400) await inspectResponse(response);
                } catch {
                    // A completed request can still lose its response during teardown.
                }
            })();
            track(check);
        };

        context.on('console', onConsole);
        context.on('weberror', onWebError);
        context.on('response', onResponse);
        context.on('requestfailed', onRequestFailed);
        context.on('requestfinished', onRequestFinished);

        await use();

        context.off('console', onConsole);
        context.off('weberror', onWebError);
        context.off('response', onResponse);
        context.off('requestfailed', onRequestFailed);
        context.off('requestfinished', onRequestFinished);
        await Promise.all(pendingResponses);
        expect(errors, 'Firestore permission-denied errors surfaced during this Playwright test').toEqual([]);
    }, { auto: true }],
});

export { expect };
