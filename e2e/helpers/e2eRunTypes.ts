import type { PairBaseline, PairScope } from './cleanupPlan';

// Run shapes shared by the local emulator persistence specs. The deployed-project
// lifecycle harness that used to define them was removed from this repository.
export type E2EPairRun = {
    runId: string;
    runMarker: string;
    runStartMs: number;
    scope: PairScope;
    clinicId: string;
    restoreClinic: boolean;
    baseline: PairBaseline;
};

export type DisposableE2EAccount = { uid: string; email: string };

export type DisposableE2ERun = { runId: string; projectId: string; emails: string[] };
