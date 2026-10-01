import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ignoreRepeatInput, inputOriginOf, type InputOrigin } from './gameExit';
import type { GameScreenView } from './gameScreens';

const CAPTURE = { capture: true } as const;

/** Input that means the player has moved on while focus waits for a late opener. */
const PLAYER_INPUT = ['pointerdown', 'keydown', 'wheel'] as const;

/** How long focus waits for an opener that renders a moment after the tabs return (a card shown once its data loads). */
export const OPENER_WAIT_MS = 1_000;

/** Whether the centre of `element` is on screen and not under anything else (a sticky header or tab bar). */
function uncovered(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
  const hit = document.elementFromPoint(x, y);
  return hit !== null && (hit === element || element.contains(hit));
}

/** Focuses the opener without the browser's own scrolling, and brings it into view only when it is not visible. */
function reveal(element: HTMLElement): void {
  element.focus({ preventScroll: true });
  if (!uncovered(element)) element.scrollIntoView({ block: 'center' });
}

/** A catalogue game open in place of the app's tabs. */
export interface OpenGame {
  readonly gameId: string;
  /** The signed-in player it was opened for. */
  readonly ownerId: string;
  /** The view it opens on; its start screen by default. */
  readonly initialView?: GameScreenView;
  /** The id of the control that opened it, which gets focus back when it closes. */
  readonly returnFocusTo?: string;
}

/**
 * The open game and how it closes (NFCT-52):
 *
 * - The rest of the input that closed it is ignored for a moment, so the
 *   second tap of a double tap on Done never lands on the tab that appears
 *   under the finger (see gameExit.ts).
 * - The game and the tabs are separate screens: each starts at the top of the
 *   page, so the tabs never come back part-way down a long summary.
 * - Focus returns to the control that opened the game once the tabs are back,
 *   instead of dropping to the page body. An opener that renders a moment
 *   later (once its card's data loads) is waited for briefly; one that never
 *   comes back gives way to `fallbackFocus()`. The wait ends as soon as the
 *   player presses or scrolls anything (a tap in WebKit focuses nothing, so
 *   focus alone cannot tell), and focus is never taken from a control focused
 *   meanwhile. The opener is scrolled into view only when it is off screen or
 *   covered.
 *   `fallbackFocus` should be a stable function.
 */
export function useOpenGame(fallbackFocus: () => HTMLElement | null): readonly [OpenGame | null, (game: OpenGame) => void, () => void] {
  const [openGame, setOpenGame] = useState<OpenGame | null>(null);
  /** Where focus goes once the closed game's screen is gone. */
  const pendingFocus = useRef<{ readonly id: string | null } | null>(null);
  /** The last click while the game is open: the one that closes it, when a click does. */
  const lastClick = useRef<InputOrigin | null>(null);
  const isOpen = openGame !== null;

  // Before paint, so neither screen ever shows at the other's scroll position.
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    if (wasOpen.current === isOpen) return;
    wasOpen.current = isOpen;
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') window.scrollTo(0, 0);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    lastClick.current = null;
    // Capture phase on window: recorded before the game's own handler runs and closes it.
    const record = (event: MouseEvent) => { lastClick.current = inputOriginOf(event); };
    window.addEventListener('click', record, CAPTURE);
    return () => window.removeEventListener('click', record, CAPTURE);
  }, [isOpen]);

  const open = useCallback((game: OpenGame) => {
    pendingFocus.current = null;
    setOpenGame(game);
  }, []);

  const close = useCallback(() => {
    const origin = lastClick.current;
    lastClick.current = null;
    if (origin) ignoreRepeatInput(origin);
    pendingFocus.current = { id: openGame?.returnFocusTo ?? null };
    setOpenGame(null);
  }, [openGame]);

  useEffect(() => {
    const pending = pendingFocus.current;
    if (isOpen || pending === null) return undefined;
    pendingFocus.current = null;
    // No DOM to move focus in (a test renderer).
    if (typeof document === 'undefined') return undefined;
    const find = () => (pending.id === null ? null : document.getElementById(pending.id));
    const opener = find();
    if (opener !== null || pending.id === null) {
      const target = opener ?? fallbackFocus();
      if (target) reveal(target);
      return undefined;
    }
    let settled = false;
    const end = () => {
      settled = true;
      observer.disconnect();
      clearTimeout(timer);
      for (const type of PLAYER_INPUT) window.removeEventListener(type, end, CAPTURE);
    };
    const settle = (target: HTMLElement | null) => {
      if (settled) return;
      end();
      const current = document.activeElement;
      if (target && (current === null || current === document.body)) reveal(target);
    };
    const observer = new MutationObserver(() => {
      const found = find();
      if (found) settle(found);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(() => settle(fallbackFocus()), OPENER_WAIT_MS);
    // The player has moved on (a press, a key or a scroll): leave focus and the page to them.
    for (const type of PLAYER_INPUT) window.addEventListener(type, end, CAPTURE);
    return end;
  }, [isOpen, fallbackFocus]);

  return [openGame, open, close] as const;
}
