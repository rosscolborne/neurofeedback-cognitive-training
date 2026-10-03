// Whole-number percentages for showing a set of shares, such as a game's
// domain weights (NFCT-65).

/** Shares closer than this to a whole percentage count as that percentage, so float noise (0.29 * 100) cannot tip rounding. */
const PRECISION = 1e6;

/**
 * Splits 100 between the shares in proportion to them, as whole numbers that
 * always sum to 100 (largest-remainder method): every share gets its exact
 * percentage rounded down, then the points left over go one each to the
 * shares with the largest remainders. Equal remainders go to the earlier
 * share, so callers order shares by priority.
 *
 * Shares need not sum to 1. Returns all zeros when there is nothing to share
 * (no positive share), and throws on a negative or non-finite share.
 */
export function largestRemainderPercentages(shares: readonly number[]): number[] {
  for (const share of shares) {
    if (!Number.isFinite(share) || share < 0) {
      throw new RangeError(`largestRemainderPercentages: shares must be finite and non-negative, got ${share}`);
    }
  }
  const total = shares.reduce((sum, share) => sum + share, 0);
  if (total === 0) return shares.map(() => 0);

  const exact = shares.map((share) => Math.round((share / total) * 100 * PRECISION) / PRECISION);
  const percentages = exact.map(Math.floor);
  const leftOver = 100 - percentages.reduce((sum, percentage) => sum + percentage, 0);
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let given = 0; given < leftOver; given += 1) percentages[byRemainder[given]!.index]! += 1;
  return percentages;
}
