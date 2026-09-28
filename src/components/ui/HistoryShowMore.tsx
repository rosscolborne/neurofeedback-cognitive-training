import React, { useEffect, useRef } from 'react';
import { historyCountText, showMoreText } from './boundedHistory';

interface HistoryShowMoreProps {
  shown: number;
  total: number;
  nextCount: number;
  onShowMore: () => void;
}

/**
 * Count plus one control that reveals the next page of a session history. Revealing only adds
 * rows. When the last page appears the button goes away and focus moves to the count, so a
 * keyboard or screen-reader user is not dropped at the top of the page.
 */
export const HistoryShowMore: React.FC<HistoryShowMoreProps> = ({ shown, total, nextCount, onShowMore }) => {
  const countRef = useRef<HTMLParagraphElement>(null);
  const focusCountWhenComplete = useRef(false);
  const complete = nextCount <= 0;

  useEffect(() => {
    if (!complete || !focusCountWhenComplete.current) return;
    focusCountWhenComplete.current = false;
    if (typeof document === 'undefined') return;
    // Only reclaim focus that was lost with the button, never take it from something else.
    if (document.activeElement == null || document.activeElement === document.body) countRef.current?.focus();
  }, [complete]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', paddingTop: '4px' }}>
      <p
        ref={countRef}
        tabIndex={-1}
        aria-live="polite"
        aria-atomic="true"
        style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'center', outline: 'none' }}
      >
        {historyCountText(shown, total)}
      </p>
      {!complete && (
        <button
          type="button"
          className="btn btn-secondary"
          style={{ padding: '9px 20px', fontSize: '14px', whiteSpace: 'nowrap' }}
          onClick={() => {
            focusCountWhenComplete.current = shown + nextCount >= total;
            onShowMore();
          }}
        >
          {showMoreText(nextCount)}
        </button>
      )}
    </div>
  );
};
