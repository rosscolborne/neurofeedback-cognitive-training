import { expect, test as base, type BrowserContext, type ConsoleMessage, type Request, type Response } from '@playwright/test';

// Import test and expect from this module in browser specs and setup.

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

export type PermissionErrorGuard = {
    expectDenialsIn: (context: BrowserContext) => void;
};

export const test = base.extend<{ permissionErrorGuard: PermissionErrorGuard }>({
    permissionErrorGuard: [async ({ browser, context }, use) => {
        const errors: string[] = [];
        const pendingResponses = new Set<Promise<void>>();
        const expectedDenialContexts = new Set<BrowserContext>();
        const watchedContexts = new Map<BrowserContext, {
            onConsole: (message: ConsoleMessage) => void;
            onWebError: (webError: { error(): Error }) => void;
            onResponse: (response: Response) => void;
            onRequestFailed: (request: Request) => void;
            onRequestFinished: (request: Request) => void;
        }>();

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

        const watchContext = (context: BrowserContext) => {
            if (watchedContexts.has(context)) return;
            const guarded = () => !expectedDenialContexts.has(context);
            const listeners = {
                onConsole: (message: ConsoleMessage) => { if (guarded()) onConsole(message); },
                onWebError: (webError: { error(): Error }) => { if (guarded()) onWebError(webError); },
                onResponse: (response: Response) => { if (guarded()) onResponse(response); },
                onRequestFailed: (request: Request) => { if (guarded()) onRequestFailed(request); },
                onRequestFinished: (request: Request) => { if (guarded()) onRequestFinished(request); },
            };
            watchedContexts.set(context, listeners);
            context.on('console', listeners.onConsole);
            context.on('weberror', listeners.onWebError);
            context.on('response', listeners.onResponse);
            context.on('requestfailed', listeners.onRequestFailed);
            context.on('requestfinished', listeners.onRequestFinished);
        };
        // Read-only probes and stateful scenarios open contexts through browser.newContext().
        // The default page fixture is also covered when Playwright creates its context.
        browser.on('context', watchContext);
        browser.contexts().forEach(watchContext);
        watchContext(context);

        await use({
            expectDenialsIn: (targetContext) => {
                watchContext(targetContext);
                expectedDenialContexts.add(targetContext);
            },
        });

        browser.off('context', watchContext);
        for (const [watchedContext, listeners] of watchedContexts) {
            watchedContext.off('console', listeners.onConsole);
            watchedContext.off('weberror', listeners.onWebError);
            watchedContext.off('response', listeners.onResponse);
            watchedContext.off('requestfailed', listeners.onRequestFailed);
            watchedContext.off('requestfinished', listeners.onRequestFinished);
        }
        await Promise.all(pendingResponses);
        expect(errors, 'Firestore permission-denied errors surfaced during this Playwright test').toEqual([]);
    }, { auto: true }],
});

export { expect };
