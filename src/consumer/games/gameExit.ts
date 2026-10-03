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

/** Before any handler on the page; an options object, which every EventTarget implementation honours on removal. */
const CAPTURE = { capture: true } as const;

/** How long a dropped press may wait for its click (a press held this long is not a tap). */
export const DROPPED_PRESS_CAP_MS = 1_000;

/** How long the keyboard guard waits for a key event at all (a click from assistive technology involves none). */
export const KEYBOARD_GUARD_CAP_MS = 10_000;

function drop(event: Event): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

type Listeners = ReadonlyArray<readonly [string, (event: Event) => void]>;

/** Adds `listeners` in the capture phase; returns a function that removes them and cancels `timers`. */
function listen(target: EventTarget, listeners: Listeners, timers: Array<ReturnType<typeof setTimeout>>): () => void {
  for (const [type, listener] of listeners) target.addEventListener(type, listener, CAPTURE);
  return () => {
    for (const timer of timers) clearTimeout(timer);
    for (const [type, listener] of listeners) target.removeEventListener(type, listener, CAPTURE);
  };
}

/**
 * Ignores a repeat of the input that just closed a screen, and nothing else:
 *
 * - after a tap or click: the next press, if it starts within `durationMs`
 *   near the same spot (the second tap of a double tap), and that press's
 *   click whenever it comes, even after the window. Only that one tap is
 *   dropped: a press anywhere else, or after the window, ends the guard and
 *   passes through, and keyboard clicks are never touched.
 * - after the keyboard: auto-repeats of the key still held down. The first
 *   fresh key press or release ends the guard.
 *
 * It works on the input itself, in the capture phase, before any handler sees
 * it, and also drops the press that would move focus to the control under the
 * finger. Call it from the handler that closes the screen: the click being
 * handled is already past the capture phase, so it is unaffected. Returns a
 * function that ends the guard early.
 */
export function ignoreRepeatInput(origin: InputOrigin, target: EventTarget = window, durationMs = REPEAT_INPUT_GUARD_MS): () => void {
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  let stop = () => {};

  if (origin.kind === 'keyboard') {
    // Enter activates on keydown, so its auto-repeat follows the closing click; Space activates on keyup, so the
    // next key event is already a fresh one.
    const onKeyDown = (event: Event) => {
      if ((event as KeyboardEvent).repeat) drop(event);
      else stop();
    };
    stop = listen(target, [['keydown', onKeyDown], ['keyup', () => stop()]], timers);
    timers.push(setTimeout(() => stop(), KEYBOARD_GUARD_CAP_MS));
    return () => stop();
  }

  const { x, y } = origin;
  const until = performance.now() + durationMs;
  /** A dropped press is waiting for its click, which is dropped too, whenever it comes. */
  let holding = false;
  const near = (event: Event) => {
    const pointer = event as MouseEvent;
    return Math.hypot(pointer.clientX - x, pointer.clientY - y) <= DOUBLE_TAP_SLOP_PX;
  };
  const onPress = (event: Event) => {
    // The compatibility mousedown of a press already dropped.
    if (event.type === 'mousedown' && holding) {
      drop(event);
      return;
    }
    if (performance.now() < until && near(event)) {
      drop(event);
      holding = true;
      timers.push(setTimeout(() => stop(), DROPPED_PRESS_CAP_MS));
      return;
    }
    // Elsewhere, or after the window: the player has moved on.
    stop();
  };
  const onClick = (event: Event) => {
    // A keyboard-activated click has no position (detail 0).
    if ((event as MouseEvent).detail === 0) return;
    if (holding || (performance.now() < until && near(event))) drop(event);
    // The second tap ends with its click; any later one is deliberate.
    stop();
  };
  const onCancel = () => { if (holding) stop(); };
  stop = listen(target, [['pointerdown', onPress], ['mousedown', onPress], ['click', onClick], ['pointercancel', onCancel]], timers);
  // The window closes unless a dropped press is still waiting for its click.
  timers.push(setTimeout(() => { if (!holding) stop(); }, durationMs));
  return () => stop();
}
