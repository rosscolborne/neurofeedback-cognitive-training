import { expect, test as base } from '../fixtures';
import {
    beginDisposableE2ERun,
    beginE2EPairRun,
    finishDisposableE2ERun,
    finishE2EPairRun,
    setLeaseLossHandler,
    type DisposableE2ERun,
    type E2EPairRun,
} from './dataLifecycle';

type StatefulRuns = {
    beginPairRun: typeof beginE2EPairRun;
    beginDisposableRun: typeof beginDisposableE2ERun;
};

/**
 * Owns the cleanup of every stateful run a test begins. Cleanup runs in fixture
 * teardown with its own time budget, so a test timeout cannot cut it short, and
 * every browser context is closed first so no app write lands after the run
 * window is recorded. A lost lease closes the browser contexts immediately.
 */
export const test = base.extend<{ stateful: StatefulRuns }>({
    stateful: [async ({ browser }, use, testInfo) => {
        const pairRuns: E2EPairRun[] = [];
        const disposableRuns: DisposableE2ERun[] = [];
        // A test that times out mid-begin still has its run finished once begin settles.
        const pendingBegins: Promise<unknown>[] = [];
        const track = <T>(started: Promise<T>, register: (run: T) => void): Promise<T> => {
            const registered = started.then((run) => {
                register(run);
                return run;
            });
            pendingBegins.push(registered.catch(() => {}));
            return registered;
        };
        const closeContexts = () => Promise.allSettled(browser.contexts().map((context) => context.close()));
        setLeaseLossHandler(() => { void closeContexts(); });
        // Playwright resumes after `use` when the test passes, fails, or times out.
        await use({
            beginPairRun: (...args) => track(beginE2EPairRun(...args), (run) => pairRuns.push(run)),
            beginDisposableRun: (...args) => track(beginDisposableE2ERun(...args), (run) => disposableRuns.push(run)),
        });
        await Promise.all(pendingBegins);
        setLeaseLossHandler(undefined);
        await closeContexts();
        const failures: string[] = [];
        for (const run of pairRuns) {
            await finishE2EPairRun(run, testInfo).catch((error) => failures.push(String(error?.message ?? error)));
        }
        for (const run of disposableRuns) {
            await finishDisposableE2ERun(run, testInfo).catch((error) => failures.push(String(error?.message ?? error)));
        }
        if (failures.length > 0) throw new Error(`Stateful E2E cleanup did not complete:\n${failures.join('\n')}`);
    }, { timeout: 180_000 }],
});

export { expect };
