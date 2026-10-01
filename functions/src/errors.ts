import { PROCESSING_REASONS, type ProcessingReason } from '@nfct/shared';

/**
 * A known reason trusted scoring cannot process a session now. It is thrown,
 * so the trigger's delivery is retried; past the retry window the reason is
 * recorded as processing.state = 'failed'.
 */
export class ProcessingError extends Error {
  readonly reason: ProcessingReason;

  constructor(reason: ProcessingReason, message: string) {
    super(message);
    this.name = 'ProcessingError';
    this.reason = reason;
  }
}

/** The processing reason to record for any error: a known one, or 'internal-error'. */
export function processingReasonOf(error: unknown): ProcessingReason {
  return error instanceof ProcessingError ? error.reason : PROCESSING_REASONS.internalError;
}

export function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
