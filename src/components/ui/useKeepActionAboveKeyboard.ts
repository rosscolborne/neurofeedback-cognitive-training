import { useEffect, type RefObject } from 'react';

// On a phone the on-screen keyboard covers the bottom of the page without
// resizing it (iOS, and Chrome on Android by default), so a short form's
// primary button sits under the keyboard while the user types in the field
// above it. While a field in the form has focus and the keyboard is open, the
// page scrolls just enough to show the button above the keyboard too, as far
// as it can without moving the focused field out of view (NFCT-33). It never
// scrolls up, and does nothing while the page is pinch-zoomed.

/** Space kept between the button and the keyboard, and above the focused field. */
const MARGIN_PX = 12;
/** A visual viewport this much shorter than the layout viewport means the keyboard is open. */
const KEYBOARD_MIN_PX = 120;

export interface KeyboardRevealLayout {
  /** The focused field's top and the button's bottom, relative to the layout viewport. */
  readonly fieldTop: number;
  readonly actionBottom: number;
  /** The layout viewport's height, which the keyboard does not change. */
  readonly layoutHeight: number;
  readonly viewport: Pick<VisualViewport, 'height' | 'offsetTop' | 'scale'>;
}

/** How far to scroll down so the button shows above the keyboard; 0 when nothing should move. */
export function keyboardRevealDistance({ fieldTop, actionBottom, layoutHeight, viewport }: KeyboardRevealLayout): number {
  if (viewport.scale > 1.01) return 0;
  if (layoutHeight - viewport.height < KEYBOARD_MIN_PX) return 0;
  const hidden = actionBottom + MARGIN_PX - (viewport.offsetTop + viewport.height);
  const room = fieldTop - MARGIN_PX - viewport.offsetTop;
  return Math.max(0, Math.floor(Math.min(hidden, room)));
}

/** Keeps `actionRef` (the form's primary button) visible above the on-screen keyboard while a field in `formRef` is focused. */
export function useKeepActionAboveKeyboard(formRef: RefObject<HTMLElement | null>, actionRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const viewport = typeof window === 'undefined' ? undefined : window.visualViewport;
    const form = formRef.current;
    if (!viewport || !form) return undefined;
    const reveal = () => {
      const action = actionRef.current;
      const field = document.activeElement;
      if (!action || !(field instanceof HTMLElement) || !form.contains(field) || !field.matches('input, textarea, select')) return;
      const distance = keyboardRevealDistance({
        fieldTop: field.getBoundingClientRect().top,
        actionBottom: action.getBoundingClientRect().bottom,
        layoutHeight: document.documentElement.clientHeight,
        viewport,
      });
      if (distance > 0) window.scrollBy(0, distance);
    };
    // The keyboard opens after the first focus (a viewport resize); moving
    // between fields with it already open is a focus change only.
    let frame = 0;
    const onFocusIn = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(reveal);
    };
    form.addEventListener('focusin', onFocusIn);
    viewport.addEventListener('resize', reveal);
    return () => {
      cancelAnimationFrame(frame);
      form.removeEventListener('focusin', onFocusIn);
      viewport.removeEventListener('resize', reveal);
    };
  }, [formRef, actionRef]);
}
