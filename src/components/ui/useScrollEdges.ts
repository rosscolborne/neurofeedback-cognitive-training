import { useCallback, useRef } from 'react';

/**
 * Callback ref that marks a horizontal scroller with data-scroll-start / data-scroll-end
 * ("true" | "false") so CSS can fade only the edges that still have content beyond them.
 * Written to the DOM directly, so scrolling never re-renders; works for scrollers that mount late.
 */
export function useScrollEdges<T extends HTMLElement>() {
  const cleanup = useRef<(() => void) | null>(null);
  return useCallback((element: T | null) => {
    cleanup.current?.();
    cleanup.current = null;
    // Test renderers can hand back plain mock nodes; only real elements are tracked.
    if (!element?.dataset || typeof element.addEventListener !== 'function') return;
    const update = () => {
      const maxScroll = element.scrollWidth - element.clientWidth;
      element.dataset.scrollStart = String(element.scrollLeft <= 1);
      element.dataset.scrollEnd = String(element.scrollLeft >= maxScroll - 1);
    };
    update();
    element.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(element);
    cleanup.current = () => {
      element.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, []);
}
