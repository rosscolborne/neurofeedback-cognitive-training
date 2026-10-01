import { Timestamp } from 'firebase-admin/firestore';
import type { ProcessingContext } from './context';
import { SWEEP_POLICY, type SweepPolicy } from './policy';
import { redriveSessions, type RedriveReport } from './redrive';

// The scheduled sweep (NFCT-19): a thin caller of the re-drive core, so a
// session whose trigger never ran, or whose processing failed or found no
// module, is processed without an operator. Exported as a scheduled function
// in index.ts; nothing in this repository deploys it.
//
// One run, bounded by SWEEP_POLICY:
// - pending sessions created more than `settleAfterMs` ago (a delivery stops
//   retrying after the trigger's retry window and records 'failed', so a
//   session still pending this long missed its trigger);
// - failed sessions, while they have fewer than `maxAttempts` recorded
//   attempts;
// - unsupported sessions that this build now has a module for, under the same
//   attempt cap (a session whose only fault is an unknown envelope field
//   cannot be told apart cheaply, so the cap bounds how often it is tried);
// - at most `maxSessions` sessions and `scanBudget` documents read per state;
//   what is left is found by the next run.
//
// Sessions at the attempt cap are left for the admin re-drive (which has no
// cap) and reported as an error, which is what an alert should watch.

export type SweepReport = RedriveReport;

export async function sweepSessions(context: ProcessingContext, policy: SweepPolicy = SWEEP_POLICY): Promise<SweepReport> {
  const now = context.now().toMillis();
  const report = await redriveSessions(context, {
    states: ['pending', 'failed', 'unsupported'],
    createdBefore: Timestamp.fromMillis(now - policy.settleAfterMs),
    createdAfter: Timestamp.fromMillis(now - policy.lookbackMs),
    limit: policy.maxSessions,
    scanBudget: policy.scanBudget,
    dryRun: false,
    maxAttempts: policy.maxAttempts,
    onlyProcessable: true,
  });
  const failed = report.results.filter(({ now: state }) => state === 'failed');
  context.log.info('session sweep finished', {
    redriven: report.results.length,
    failed: failed.length,
    capped: report.capped.length,
  });
  if (report.capped.length > 0) {
    context.log.error('sessions left unprocessed at the sweep attempt cap; run redrive-sessions after fixing the cause', {
      count: report.capped.length,
      sessions: report.capped.slice(0, 50).map(({ uid, sessionId, state, attempts }) => ({ uid, sessionId, state, attempts })),
    });
  }
  return report;
}
