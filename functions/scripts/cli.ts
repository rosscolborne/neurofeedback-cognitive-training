import { parseArgs } from 'node:util';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { processingContext, type ProcessingContext } from '../src/context';
import { EXHAUSTIVE_RECONCILE } from '../src/policy';
import { rebuildableGames, rebuildUserProgress, type RebuildReport } from '../src/rebuild';
import { reconcileUser, redriveSessions, type RedriveState } from '../src/redrive';
import { rebuildUserStats, type StatsRebuildReport } from '../src/stats';

// Admin-only scripts for trusted scoring (NFCT-19) and its aggregates
// (progress; stats, daily stats and achievements, NFCT-13). They run with the
// Admin SDK from an operator's machine; they are not deployed endpoints.
//
// Safety: there is no default project. `--project` is required. With
// FIRESTORE_EMULATOR_HOST set, only a demo-* project is accepted (the
// emulator). Without it, the script refuses to run unless `--live` is given
// as well, and never with a demo-* project; credentials then come from the
// operator's Application Default Credentials, never from a key in the repo.

export type CliEnvironment = Readonly<Record<string, string | undefined>>;

export type Target = { readonly projectId: string; readonly emulator: boolean };

/** Decides which Firestore the script may touch, or throws. */
export function resolveTarget(projectId: string | undefined, live: boolean, env: CliEnvironment): Target {
  if (!projectId) throw new Error('--project is required; there is no default project');
  if (!/^[a-z][a-z0-9-]{4,62}$/.test(projectId)) throw new Error(`'${projectId}' is not a Firebase project ID`);
  const emulator = Boolean(env.FIRESTORE_EMULATOR_HOST);
  if (emulator) {
    if (!projectId.startsWith('demo-')) throw new Error('With FIRESTORE_EMULATOR_HOST set, use a demo-* project');
    if (live) throw new Error('--live makes no sense with FIRESTORE_EMULATOR_HOST set');
    return { projectId, emulator };
  }
  if (!live) throw new Error('Refusing to touch a real project without --live (or set FIRESTORE_EMULATOR_HOST for the emulator)');
  if (projectId.startsWith('demo-')) throw new Error('A demo-* project only exists in the emulator');
  return { projectId, emulator };
}

let appCount = 0;
function contextFor(target: Target): { context: ProcessingContext; app: App } {
  appCount += 1;
  const app = initializeApp({ projectId: target.projectId }, `nfct-admin-script-${appCount}`);
  // Admin runs reconcile with no budget, so they always finish what a trigger's budget left.
  return { app, context: processingContext(getFirestore(app), { limits: EXHAUSTIVE_RECONCILE }) };
}

export type Output = (line: string) => void;

/**
 * `rebuild-progress --project <id> --uid <uid> [--game <gameId>] [--live]`:
 * rebuilds the user's aggregates from their stored trusted results: progress
 * (every game with a module, or one), then the cross-game stats (summary,
 * daily stats and achievements), then runs the start-level upgrade with no
 * budget (whose upgrades update progress and stats in their own commits).
 */
export async function runRebuildProgress(
  argv: readonly string[],
  env: CliEnvironment,
  out: Output,
): Promise<{ progress: RebuildReport[]; stats: StatsRebuildReport }> {
  const { values } = parseArgs({
    args: [...argv],
    options: { project: { type: 'string' }, uid: { type: 'string' }, game: { type: 'string' }, live: { type: 'boolean', default: false } },
    strict: true,
  });
  const target = resolveTarget(values.project, values.live, env);
  if (!values.uid) throw new Error('--uid is required');
  const { context, app } = contextFor(target);
  try {
    const games = values.game ? [values.game] : await rebuildableGames(context, values.uid);
    const reports: RebuildReport[] = [];
    for (const gameId of games) {
      const report = await rebuildUserProgress(context, values.uid, gameId);
      reports.push(report);
      out(`${target.projectId} users/${values.uid}/progress/${gameId}: ${report.written}`);
    }
    const stats = await rebuildUserStats(context, values.uid);
    out(`${target.projectId} users/${values.uid}/stats: ${stats.written} (${stats.days} day(s), ${stats.achievements.length} achievement(s))`);
    for (const { gameId, modeId, report } of await reconcileUser(context, values.uid)) {
      if (report.upgraded.length > 0) out(`upgraded ${report.upgraded.length} session(s) in ${gameId}/${modeId}`);
    }
    return { progress: reports, stats };
  } finally {
    await deleteApp(app);
  }
}

/**
 * `redrive-sessions --project <id> [--uid <uid>] [--state pending,failed,unsupported]
 *  [--older-than-minutes 30] [--newer-than-days 7] [--limit 100] [--scan-budget 5000] [--dry-run] [--live]`:
 * re-drives sessions without a result through the trigger's pipeline, then
 * runs the admin reconcile (no budget) for every affected user. With --uid it
 * also finishes that user's start-level upgrades when nothing needs re-driving.
 */
export async function runRedriveSessions(argv: readonly string[], env: CliEnvironment, out: Output) {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      project: { type: 'string' },
      uid: { type: 'string' },
      state: { type: 'string', default: 'pending,failed,unsupported' },
      'older-than-minutes': { type: 'string', default: '30' },
      'newer-than-days': { type: 'string', default: '7' },
      limit: { type: 'string', default: '100' },
      'scan-budget': { type: 'string', default: '5000' },
      'dry-run': { type: 'boolean', default: false },
      live: { type: 'boolean', default: false },
    },
    strict: true,
  });
  const target = resolveTarget(values.project, values.live, env);
  const states = values.state.split(',').map((state) => state.trim());
  for (const state of states) {
    if (!['pending', 'failed', 'unsupported'].includes(state)) throw new Error(`Unknown --state '${state}'`);
  }
  const number = (name: string, value: string, min: number) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min) throw new Error(`--${name} must be an integer >= ${min}`);
    return parsed;
  };
  const olderThanMs = number('older-than-minutes', values['older-than-minutes'], 0) * 60_000;
  const newerThanMs = number('newer-than-days', values['newer-than-days'], 1) * 24 * 60 * 60_000;
  const { context, app } = contextFor(target);
  try {
    const now = context.now().toMillis();
    const report = await redriveSessions(context, {
      states: states as RedriveState[],
      createdBefore: Timestamp.fromMillis(now - olderThanMs),
      createdAfter: Timestamp.fromMillis(now - olderThanMs - newerThanMs),
      uid: values.uid,
      limit: number('limit', values.limit, 1),
      scanBudget: number('scan-budget', values['scan-budget'], 1),
      dryRun: values['dry-run'],
    });
    for (const { uid, sessionId, state } of report.targets) out(`${values['dry-run'] ? 'would re-drive' : 'target'} users/${uid}/gameSessions/${sessionId} (${state})`);
    for (const { uid, sessionId, now: state, error } of report.results) out(`users/${uid}/gameSessions/${sessionId}: ${state}${error ? ` (${error})` : ''}`);
    // Finish every affected user's start-level upgrades, with no budget.
    if (!values['dry-run']) {
      const users = new Set(values.uid ? [values.uid] : report.results.map(({ uid }) => uid));
      for (const uid of users) await reconcileUser(context, uid);
    }
    return report;
  } finally {
    await deleteApp(app);
  }
}

/** Runs a script entry point: prints errors and sets the exit code. */
export function main(run: (argv: readonly string[], env: CliEnvironment, out: Output) => Promise<unknown>): void {
  run(process.argv.slice(2), process.env, (line) => console.log(line)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
