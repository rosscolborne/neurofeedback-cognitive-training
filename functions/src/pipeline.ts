import type { ProcessingContext } from './context';
import { describeError, processingReasonOf } from './errors';
import { processSession, recordProcessingState, type ProcessOutcome } from './processSession';
import { reconcileUpgrades, type ReconcileReport, type ReconcileTarget } from './reconcile';

// The session pipeline (NFCT-19): what the trigger, the scheduled sweep and
// the admin re-drive run for one session. Process it in its exactly-once
// transaction (which also upgrades, in the same commit, the start-level-locked
// sessions its unlock reaches, within a bounded budget); then, only if that
// budget ran out or an already-valid session was redelivered, run the
// post-commit reconcile for its game mode.

export type PipelineReport = {
  readonly outcome: ProcessOutcome;
  readonly reconciled: readonly (ReconcileTarget & { readonly report: ReconcileReport })[];
};

export async function runSessionPipeline(context: ProcessingContext, uid: string, sessionId: string): Promise<PipelineReport> {
  const outcome = await processSession(context, uid, sessionId);
  const target = outcome.status === 'processed' || outcome.status === 'already-processed' ? outcome.reconcile : null;
  const reconciled = target ? [{ ...target, report: await reconcileUpgrades(context, uid, target) }] : [];
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
 * - while the event is younger than `retryWindowMs`, any error is rethrown and
 *   nothing is written, so the platform redelivers it with backoff (a
 *   transient fault, contention, or progress written by newer code);
 * - after that, the error's reason is recorded as processing.state = 'failed'
 *   (only while the session still has no result and the account is not being
 *   deleted), and the delivery ends successfully. That is not a result and not
 *   terminal: the scheduled sweep and the admin re-drive process it again, and
 *   a success deletes it in the same write that adds the result.
 *
 * A missing or unreadable event time counts as past the window, so the
 * failure is recorded rather than retried blindly.
 */
export async function handleSessionCreated(context: ProcessingContext, event: SessionCreatedEvent): Promise<PipelineReport | null> {
  const { uid, sessionId } = event.params;
  try {
    const report = await runSessionPipeline(context, uid, sessionId);
    if (report.outcome.status === 'account-deleted') context.log.info('session not processed: the account is being deleted', { uid, sessionId });
    return report;
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
