import { useCallback, useEffect, useRef, useState } from 'react';
import { ignoreRepeatInput, inputOriginOf, type InputOrigin } from './gameExit';
import type { GameScreenView } from './gameScreens';

const CAPTURE = { capture: true } as const;

/** How long focus waits for an opener that renders a moment after the tabs return (a card shown once its data loads). */
export const OPENER_WAIT_MS = 1_000;

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
 * - Focus returns to the control that opened the game once the tabs are back,
 *   instead of dropping to the page body. An opener that renders a moment
 *   later (once its card's data loads) is waited for briefly; one that never
 *   comes back gives way to `fallbackFocus()`. Focus is never taken back from
 *   a control the player has focused meanwhile. `fallbackFocus` should be a
 *   stable function.
 */
export function useOpenGame(fallbackFocus: () => HTMLElement | null): readonly [OpenGame | null, (game: OpenGame) => void, () => void] {
  const [openGame, setOpenGame] = useState<OpenGame | null>(null);
  /** Where focus goes once the closed game's screen is gone. */
  const pendingFocus = useRef<{ readonly id: string | null } | null>(null);
  /** The last click while the game is open: the one that closes it, when a click does. */
  const lastClick = useRef<InputOrigin | null>(null);
  const isOpen = openGame !== null;

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
    if (lastClick.current) ignoreRepeatInput(lastClick.current);
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
      (opener ?? fallbackFocus())?.focus();
      return undefined;
    }
    let settled = false;
    const settle = (target: HTMLElement | null) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timer);
      const current = document.activeElement;
      if (current === null || current === document.body) target?.focus();
    };
    const observer = new MutationObserver(() => {
      const found = find();
      if (found) settle(found);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(() => settle(fallbackFocus()), OPENER_WAIT_MS);
    return () => {
      settled = true;
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [isOpen, fallbackFocus]);

  return [openGame, open, close] as const;
}
