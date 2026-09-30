import type { ProcessingContext } from './context';
import { describeError, processingReasonOf } from './errors';
import { processSession, recordProcessingState, type ProcessOutcome, type ReconcileTarget } from './processSession';
import { reconcileUpgrades, type ReconcileReport } from './reconcile';

// The session pipeline (NFCT-19): what the trigger, and the admin re-drive,
// run for one session. Process it (first processing any truly pending earlier
// session it depends on), then run the start-level upgrade once for every
// (game, mode) whose unlocks the run raised, after all of its commits.

export type PipelineReport = {
  readonly outcome: ProcessOutcome;
  readonly reconciled: readonly (ReconcileTarget & { readonly report: ReconcileReport })[];
};

function reconcileTargets(outcome: ProcessOutcome): ReconcileTarget[] {
  const targets: ReconcileTarget[] = [];
  const visit = (next: ProcessOutcome) => {
    if (next.status === 'processed') next.predecessors.forEach(({ outcome: predecessor }) => visit(predecessor));
    if ((next.status === 'processed' || next.status === 'already-processed') && next.reconcile) targets.push(next.reconcile);
  };
  visit(outcome);
  const unique = new Map(targets.map((target) => [`${target.gameId}/${target.modeId}`, target]));
  return [...unique.values()];
}

export async function runSessionPipeline(context: ProcessingContext, uid: string, sessionId: string): Promise<PipelineReport> {
  const outcome = await processSession(context, uid, sessionId, { predecessors: true });
  const reconciled = [];
  for (const target of reconcileTargets(outcome)) {
    reconciled.push({ ...target, report: await reconcileUpgrades(context, uid, target) });
  }
  return { outcome, reconciled };
}

/** The part of the trigger's event the handler uses. */
export type SessionCreatedEvent = {
  readonly params: { readonly uid: string; readonly sessionId: string };
  /** When the session was created (the CloudEvent time); the same on every redelivery. */
  readonly time: string;
};

/**
 * The trigger handler. Delivery is at least once and retried on error, so:
 *
 * - the pipeline is idempotent (the processing transaction skips a session
 *   that already has a result; upgrades re-check in their own transactions);
 * - while the event is younger than `retryWindowMs`, any error is rethrown,
 *   so the platform redelivers it with backoff;
 * - after that, the error's reason is recorded as processing.state = 'failed'
 *   (only while the session still has no result), and the delivery ends
 *   successfully. The admin re-drive processes failed sessions later.
 *
 * A missing or unreadable event time counts as past the window, so the
 * failure is recorded rather than retried blindly.
 */
export async function handleSessionCreated(context: ProcessingContext, event: SessionCreatedEvent): Promise<PipelineReport | null> {
  const { uid, sessionId } = event.params;
  try {
    return await runSessionPipeline(context, uid, sessionId);
  } catch (error) {
    const created = Date.parse(event.time);
    const ageMs = context.now().toMillis() - created;
    const reason = processingReasonOf(error);
    if (Number.isFinite(created) && ageMs < context.limits.retryWindowMs) {
      context.log.warn('session processing failed; the delivery will be retried', { uid, sessionId, reason, error: describeError(error) });
      throw error;
    }
    const recorded = await recordProcessingState(context, uid, sessionId, 'failed', reason);
    context.log.error('session processing failed past its retry window', {
      uid, sessionId, reason, recorded, error: describeError(error),
    });
    return null;
  }
}
