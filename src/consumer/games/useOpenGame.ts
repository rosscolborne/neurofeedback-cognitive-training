import { useCallback, useEffect, useRef, useState } from 'react';
import { ignoreRepeatInput, inputOriginOf, type InputOrigin } from './gameExit';
import type { GameScreenView } from './gameScreens';

const CAPTURE = { capture: true } as const;

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
 *   or to `fallbackFocus()` when that control is gone, instead of dropping to
 *   the page body. `fallbackFocus` should be a stable function.
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
    if (isOpen || pending === null) return;
    pendingFocus.current = null;
    // No DOM to move focus in (a test renderer).
    if (typeof document === 'undefined') return;
    const opener = pending.id === null ? null : document.getElementById(pending.id);
    (opener ?? fallbackFocus())?.focus();
  }, [isOpen, fallbackFocus]);

  return [openGame, open, close] as const;
}
