import { useCallback, useState } from 'react';

/**
 * Session rows revealed per step. Ten summary rows are roughly two phone screens,
 * enough to scan recent training without rendering a whole long history at once.
 */
export const HISTORY_PAGE_SIZE = 10;

export interface BoundedHistory<T> {
  /** Rows to render: the first `shown` items, in the order given. */
  visible: T[];
  shown: number;
  total: number;
  /** Rows the next "show more" step would reveal; 0 once everything is shown. */
  nextCount: number;
  /** True when the history is longer than one page, so a count and control are needed. */
  paged: boolean;
}

/** Pure window over an ordered history. A limit below one page is raised to one page. */
export function boundHistory<T>(items: readonly T[], limit: number, pageSize = HISTORY_PAGE_SIZE): BoundedHistory<T> {
  const size = Number.isFinite(pageSize) ? Math.max(1, Math.floor(pageSize)) : HISTORY_PAGE_SIZE;
  const cap = Number.isFinite(limit) ? Math.max(size, Math.floor(limit)) : size;
  const visible = items.slice(0, cap);
  const total = items.length;
  return {
    visible,
    shown: visible.length,
    total,
    nextCount: Math.min(size, total - visible.length),
    paged: total > size,
  };
}

/** Calm count under a paged history: "Showing 10 of 43 sessions", then "Showing all 43 sessions". */
export function historyCountText(shown: number, total: number): string {
  const noun = total === 1 ? 'session' : 'sessions';
  return shown >= total ? `Showing all ${total} ${noun}` : `Showing ${shown} of ${total} ${noun}`;
}

export function showMoreText(nextCount: number): string {
  return `Show ${nextCount} more session${nextCount === 1 ? '' : 's'}`;
}

/**
 * Bounded rendering for one history. While `resetKey` stays the same the revealed count only
 * grows, so a row someone has opened (and any draft inside it) is never hidden or unmounted by
 * paging. A new key (another patient, another date range) starts again at one page.
 */
export function useBoundedHistory<T>(items: readonly T[], resetKey: string, pageSize = HISTORY_PAGE_SIZE) {
  const [reveal, setReveal] = useState({ key: resetKey, limit: pageSize });
  const limit = reveal.key === resetKey ? reveal.limit : pageSize;
  // Adjusting state while rendering (not in an effect) keeps the first paint for a new key bounded.
  if (reveal.key !== resetKey) setReveal({ key: resetKey, limit: pageSize });
  const showMore = useCallback(() => {
    setReveal((current) => ({
      key: resetKey,
      limit: (current.key === resetKey ? current.limit : pageSize) + pageSize,
    }));
  }, [resetKey, pageSize]);
  return { ...boundHistory(items, limit, pageSize), showMore };
}
