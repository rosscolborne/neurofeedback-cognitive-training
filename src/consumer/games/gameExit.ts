// Leaving a game screen (NFCT-52). A game replaces the app's tabs while it is
// open, so closing it swaps the whole screen under the player's finger: the
// summary's sticky Done sits right over the bottom navigation. The second tap
// of a double tap on Done must not activate the tab that appears under it,
// and a held Enter key must not reopen the game from the control that gets
// focus back.

/**
 * How long after a tap closes a screen a second tap at the same spot is
 * ignored: longer than the gap between the two taps of a double tap (about
 * 300 ms on iOS and Android).
 */
export const REPEAT_INPUT_GUARD_MS = 400;

/** How far from the first tap the second tap of a double tap may land, in CSS pixels. */
export const DOUBLE_TAP_SLOP_PX = 48;

/** Where the input that closed a screen came from. */
export type InputOrigin =
  | { readonly kind: 'pointer'; readonly x: number; readonly y: number }
  /** A click the keyboard (Enter or Space on a button) or a script produced: it has no position. */
  | { readonly kind: 'keyboard' };

/** The origin of a click: a keyboard-activated click has `detail` 0. */
export function inputOriginOf(event: MouseEvent): InputOrigin {
  return event.detail === 0 ? { kind: 'keyboard' } : { kind: 'pointer', x: event.clientX, y: event.clientY };
}

const POINTER_EVENTS = ['pointerdown', 'mousedown', 'click'] as const;
/** Before any handler on the page; an options object, which every EventTarget implementation honours on removal. */
const CAPTURE = { capture: true } as const;

function drop(event: Event): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

/**
 * Ignores a repeat of the input that just closed a screen, and nothing else:
 *
 * - after a tap or click: the next tap, if it comes within `durationMs` and
 *   lands near the same spot (the second tap of a double tap). Only that one
 *   tap is dropped: input anywhere else ends the guard and passes through,
 *   and keyboard clicks are never touched.
 * - after the keyboard: auto-repeated key presses of the key still held down,
 *   until it is released. A fresh key press passes through.
 *
 * It works on the input itself, in the capture phase, before any handler sees
 * it, and also drops the press that would move focus to the control under the
 * finger. Call it from the handler that closes the screen: the click being
 * handled is already past the capture phase, so it is unaffected. Returns a
 * function that ends the guard early.
 */
export function ignoreRepeatInput(origin: InputOrigin, target: EventTarget = window, durationMs = REPEAT_INPUT_GUARD_MS): () => void {
  if (origin.kind === 'keyboard') {
    const onKeyDown = (event: Event) => { if ((event as KeyboardEvent).repeat) drop(event); };
    const stop = () => {
      target.removeEventListener('keydown', onKeyDown, CAPTURE);
      target.removeEventListener('keyup', stop, CAPTURE);
    };
    target.addEventListener('keydown', onKeyDown, CAPTURE);
    target.addEventListener('keyup', stop, CAPTURE);
    return stop;
  }

  const { x, y } = origin;
  const until = performance.now() + durationMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (timer !== undefined) clearTimeout(timer);
    for (const type of POINTER_EVENTS) target.removeEventListener(type, onPointer, CAPTURE);
  };
  function onPointer(event: Event): void {
    if (performance.now() >= until) {
      stop();
      return;
    }
    const pointer = event as MouseEvent;
    // A keyboard-activated click has no position (detail 0).
    if (pointer.type === 'click' && pointer.detail === 0) return;
    if (Math.hypot(pointer.clientX - x, pointer.clientY - y) > DOUBLE_TAP_SLOP_PX) {
      // The player has moved on: everything from here is deliberate.
      stop();
      return;
    }
    drop(event);
    // The second tap ends with its click; a later one is deliberate.
    if (event.type === 'click') stop();
  }
  for (const type of POINTER_EVENTS) target.addEventListener(type, onPointer, CAPTURE);
  timer = setTimeout(stop, durationMs);
  return stop;
}
