// Trusted scoring's operating limits (NFCT-19). Every loop over Firestore
// documents is bounded here, so one trigger invocation does bounded work
// however many sessions a user writes. Past a bound nothing is lost: the
// post-commit reconcile, the scheduled sweep and the admin scripts finish the
// work later, and progress never depends on the order work happens in.

export interface ProcessingLimits {
  /**
   * How long a failing trigger delivery rethrows so the platform retries it.
   * After this, the session is marked processing.state = 'failed' instead.
   */
  readonly retryWindowMs: number;
  /**
   * Most flagged session documents (projected, without trials) the processing
   * transaction itself reads to upgrade the sessions its commit unlocks. The
   * upgrades are written in that same commit. Past this, or past
   * `transactionUpgradeLimit`, the rest is left to the post-commit reconcile.
   */
  readonly transactionUpgradeScanBudget: number;
  /** Most sessions the processing transaction upgrades in its own commit. */
  readonly transactionUpgradeLimit: number;
  /**
   * Most flagged session documents (projected, without trials) one
   * post-commit reconcile call reads, over all start levels. Each level is
   * paged with cursors past sessions that are flagged for other reasons, so
   * none of them can hide an upgradable session unless this budget runs out;
   * the call then stops and reports 'budget'. The admin scripts reconcile
   * with no budget (EXHAUSTIVE_RECONCILE).
   */
  readonly reconcileScanBudget: number;
  /** Page size for the projected scans. */
  readonly scanPageSize: number;
  /** Most sessions one post-commit reconcile transaction upgrades. */
  readonly upgradeBatchSize: number;
  /** Most sessions upgraded by one post-commit reconcile call. */
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
  transactionUpgradeScanBudget: 100,
  transactionUpgradeLimit: 20,
  reconcileScanBudget: 1_000,
  scanPageSize: 50,
  upgradeBatchSize: 20,
  maxUpgradesPerReconcile: 100,
  maxReconcileRounds: 10,
});

/**
 * Reconcile limits for the admin scripts: every flagged session at every
 * unlocked start level is examined and every upgradable one upgraded, so a
 * reconcile an invocation's budget cut short is always completed there. The
 * processing transaction's own upgrade budget is unchanged: it bounds the
 * size of one transaction, and the reconcile finishes what it leaves.
 */
export const EXHAUSTIVE_RECONCILE: Partial<ProcessingLimits> = Object.freeze({
  reconcileScanBudget: Number.POSITIVE_INFINITY,
  maxUpgradesPerReconcile: Number.POSITIVE_INFINITY,
  maxReconcileRounds: Number.POSITIVE_INFINITY,
});

/**
 * The scheduled sweep (sweep.ts): what one run re-drives. A run does bounded
 * work; what it leaves is found by the next run.
 */
export interface SweepPolicy {
  /**
   * Only sessions created at least this long ago are re-driven (the cutoff is
   * on `createdAt`, for every state). A session still pending this long after
   * it was created missed its trigger: a delivery stops retrying after
   * `retryWindowMs` and records 'failed', so only a delivery that never ran
   * leaves a session pending. A failed or unsupported state was recorded by a
   * delivery that has already ended; should a redelivery still be running,
   * the processing transaction serialises the two and the second finds the
   * session processed, so the sweep needs no cutoff on the state's own time.
   */
  readonly settleAfterMs: number;
  /** Only sessions created this recently (bounds the pending scan). */
  readonly lookbackMs: number;
  /** Most sessions one run re-drives. */
  readonly maxSessions: number;
  /** Most session documents (projected) one run's pending scan reads. */
  readonly scanBudget: number;
  /**
   * A failed or unsupported session that already has this many recorded
   * attempts is left alone and reported (an alert): the admin re-drive, which
   * has no attempt cap, finishes it once the cause is fixed.
   */
  readonly maxAttempts: number;
}

export const SWEEP_POLICY: SweepPolicy = Object.freeze({
  settleAfterMs: 60 * 60_000,
  lookbackMs: 7 * 24 * 60 * 60_000,
  maxSessions: 100,
  scanBudget: 2_000,
  maxAttempts: 5,
});
