// Trusted scoring's operating limits (NFCT-19). Every loop over Firestore
// documents is bounded here, so one trigger invocation does bounded work
// however many sessions a user writes. Past a bound nothing is lost: the
// start-level upgrade (reconcile) and the admin re-drive script finish the
// work later, and progress never depends on the order work happens in.

export interface ProcessingLimits {
  /**
   * How long a failing trigger delivery rethrows so the platform retries it.
   * After this, the session is marked processing.state = 'failed' instead.
   */
  readonly retryWindowMs: number;
  /** Pending predecessors are looked for among sessions created this recently. */
  readonly predecessorLookbackMs: number;
  /** Most session documents (projected, without trials) read while looking for pending predecessors. */
  readonly predecessorScanBudget: number;
  /** Most pending predecessors processed inline before the session itself. */
  readonly maxInlinePredecessors: number;
  /**
   * Most flagged session documents (projected, without trials) one reconcile
   * call reads, over all start levels. Each level is paged with cursors past
   * sessions that are flagged for other reasons, so none of them can hide an
   * upgradable session unless this budget runs out; the call then stops and
   * reports 'budget'. The admin scripts reconcile with no budget
   * (EXHAUSTIVE_RECONCILE).
   */
  readonly reconcileScanBudget: number;
  /** Page size for the projected scans. */
  readonly scanPageSize: number;
  /** Most sessions upgraded in one transaction. */
  readonly upgradeBatchSize: number;
  /** Most sessions upgraded by one reconcile call. */
  readonly maxUpgradesPerReconcile: number;
  /**
   * Most reconcile rounds. A round only follows one that raised the unlocked
   * start level, which can rise at most once per level, so the mode's level
   * count bounds it anyway.
   */
  readonly maxReconcileRounds: number;
}

export const PROCESSING_LIMITS: ProcessingLimits = Object.freeze({
  retryWindowMs: 30 * 60_000,
  predecessorLookbackMs: 24 * 60 * 60_000,
  predecessorScanBudget: 200,
  maxInlinePredecessors: 10,
  reconcileScanBudget: 1_000,
  scanPageSize: 50,
  upgradeBatchSize: 20,
  maxUpgradesPerReconcile: 100,
  maxReconcileRounds: 10,
});

/**
 * Reconcile limits for the admin scripts: every flagged session at every
 * unlocked start level is examined and every upgradable one upgraded, so a
 * reconcile an invocation's budget cut short is always completed there.
 */
export const EXHAUSTIVE_RECONCILE: Partial<ProcessingLimits> = Object.freeze({
  reconcileScanBudget: Number.POSITIVE_INFINITY,
  maxUpgradesPerReconcile: Number.POSITIVE_INFINITY,
  maxReconcileRounds: Number.POSITIVE_INFINITY,
});
