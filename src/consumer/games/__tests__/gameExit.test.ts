import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOUBLE_TAP_SLOP_PX, DROPPED_PRESS_CAP_MS, ignoreRepeatInput, inputOriginOf, KEYBOARD_GUARD_CAP_MS, REPEAT_INPUT_GUARD_MS } from '../gameExit';

// NFCT-52: once a game closes, the rest of the input that closed it (the
// second tap of a double tap, or a held key's auto-repeat) is dropped, and
// nothing else is.

/** A press, click or key event as the browser dispatches it, with the fields the guard reads. */
function input(type: string, fields: Record<string, number | boolean> = {}): Event {
  return Object.assign(new Event(type, { cancelable: true }), fields);
}

/** Dispatches `event` and reports whether a handler after the guard saw it, and whether its default was prevented. */
function dispatch(target: EventTarget, event: Event): { readonly reached: boolean; readonly prevented: boolean } {
  let reached = false;
  const after = () => { reached = true; };
  target.addEventListener(event.type, after);
  target.dispatchEvent(event);
  target.removeEventListener(event.type, after);
  return { reached, prevented: event.defaultPrevented };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }); });
afterEach(() => { vi.useRealTimers(); });

describe('ignoreRepeatInput', () => {
  it('drops the second tap of a double tap at the same spot, presses included', () => {
    const page = new EventTarget();
    ignoreRepeatInput({ kind: 'pointer', x: 300, y: 820 }, page);
    vi.advanceTimersByTime(150);
    for (const type of ['pointerdown', 'mousedown', 'click']) {
      expect(dispatch(page, input(type, { clientX: 304, clientY: 812, detail: 2 }))).toEqual({ reached: false, prevented: true });
    }
  });

  it('drops only that one tap: the next one at the same spot passes', () => {
    const page = new EventTarget();
    ignoreRepeatInput({ kind: 'pointer', x: 300, y: 820 }, page);
    vi.advanceTimersByTime(150);
    expect(dispatch(page, input('click', { clientX: 300, clientY: 820, detail: 2 })).reached).toBe(false);
    vi.advanceTimersByTime(100);
    expect(dispatch(page, input('click', { clientX: 300, clientY: 820, detail: 1 }))).toEqual({ reached: true, prevented: false });
  });

  it('lets a tap elsewhere through at once, and then any tap: the player has moved on', () => {
    const page = new EventTarget();
    ignoreRepeatInput({ kind: 'pointer', x: 300, y: 820 }, page);
    vi.advanceTimersByTime(50);
    expect(dispatch(page, input('pointerdown', { clientX: 300 - DOUBLE_TAP_SLOP_PX - 1, clientY: 820 }))).toEqual({ reached: true, prevented: false });
    expect(dispatch(page, input('click', { clientX: 300 - DOUBLE_TAP_SLOP_PX - 1, clientY: 820, detail: 1 }))).toEqual({ reached: true, prevented: false });
    expect(dispatch(page, input('click', { clientX: 300, clientY: 820, detail: 1 }))).toEqual({ reached: true, prevented: false });
  });

  it('lets a tap at the same spot through once the double-tap window has passed', () => {
    const page = new EventTarget();
    ignoreRepeatInput({ kind: 'pointer', x: 300, y: 820 }, page);
    vi.advanceTimersByTime(REPEAT_INPUT_GUARD_MS);
    expect(dispatch(page, input('click', { clientX: 300, clientY: 820, detail: 1 }))).toEqual({ reached: true, prevented: false });
  });

  it('drops a second press made inside the window and its click, even when it is released after the window', () => {
    const page = new EventTarget();
    ignoreRepeatInput({ kind: 'pointer', x: 300, y: 820 }, page);
    vi.advanceTimersByTime(350);
    expect(dispatch(page, input('pointerdown', { clientX: 300, clientY: 820 })).reached).toBe(false);
    vi.advanceTimersByTime(100);
    expect(dispatch(page, input('click', { clientX: 300, clientY: 820, detail: 2 }))).toEqual({ reached: false, prevented: true });
    // That click ended the guard.
    expect(dispatch(page, input('click', { clientX: 300, clientY: 820, detail: 1 })).reached).toBe(true);
  });

  it('stops waiting for a dropped press’s click when the engine cancels it (WebKit), or the press is cancelled', () => {
    const page = new EventTarget();
    ignoreRepeatInput({ kind: 'pointer', x: 300, y: 820 }, page);
    vi.advanceTimersByTime(150);
    expect(dispatch(page, input('pointerdown', { clientX: 300, clientY: 820 })).reached).toBe(false);
    // No click came; a press after the window is the player's.
    vi.advanceTimersByTime(500);
    expect(dispatch(page, input('pointerdown', { clientX: 300, clientY: 820 })).reached).toBe(true);

    const other = new EventTarget();
    ignoreRepeatInput({ kind: 'pointer', x: 300, y: 820 }, other);
    expect(dispatch(other, input('pointerdown', { clientX: 300, clientY: 820 })).reached).toBe(false);
    dispatch(other, input('pointercancel'));
    expect(dispatch(other, input('click', { clientX: 300, clientY: 820, detail: 1 })).reached).toBe(true);

    const held = new EventTarget();
    ignoreRepeatInput({ kind: 'pointer', x: 300, y: 820 }, held);
    expect(dispatch(held, input('pointerdown', { clientX: 300, clientY: 820 })).reached).toBe(false);
    vi.advanceTimersByTime(DROPPED_PRESS_CAP_MS);
    expect(dispatch(held, input('click', { clientX: 300, clientY: 820, detail: 1 })).reached).toBe(true);
  });

  it('after a tap, never drops a keyboard click', () => {
    const page = new EventTarget();
    ignoreRepeatInput({ kind: 'pointer', x: 0, y: 0 }, page);
    expect(dispatch(page, input('click', { clientX: 0, clientY: 0, detail: 0 }))).toEqual({ reached: true, prevented: false });
  });

  it('after the keyboard (Enter), drops only the held key’s auto-repeat, until the key is released', () => {
    const page = new EventTarget();
    ignoreRepeatInput({ kind: 'keyboard' }, page);
    expect(dispatch(page, input('keydown', { repeat: true }))).toEqual({ reached: false, prevented: true });
    expect(dispatch(page, input('keydown', { repeat: true }))).toEqual({ reached: false, prevented: true });
    expect(dispatch(page, input('click', { clientX: 0, clientY: 0, detail: 0 }))).toEqual({ reached: true, prevented: false });
    dispatch(page, input('keyup'));
    expect(dispatch(page, input('keydown', { repeat: true }))).toEqual({ reached: true, prevented: false });
  });

  it('after the keyboard (Space, which closes on release), a fresh key press ends the guard: a held arrow key repeats', () => {
    const page = new EventTarget();
    ignoreRepeatInput({ kind: 'keyboard' }, page);
    expect(dispatch(page, input('keydown', { repeat: false }))).toEqual({ reached: true, prevented: false });
    for (let index = 0; index < 3; index += 1) {
      expect(dispatch(page, input('keydown', { repeat: true }))).toEqual({ reached: true, prevented: false });
    }
  });

  it('after a click with no key or position (assistive technology), the keyboard guard ends on its own', () => {
    const page = new EventTarget();
    ignoreRepeatInput({ kind: 'keyboard' }, page);
    vi.advanceTimersByTime(KEYBOARD_GUARD_CAP_MS);
    expect(dispatch(page, input('keydown', { repeat: true }))).toEqual({ reached: true, prevented: false });
  });

  it('reads a keyboard click (detail 0) as keyboard input and a tap as a position', () => {
    expect(inputOriginOf({ detail: 0, clientX: 0, clientY: 0 } as MouseEvent)).toEqual({ kind: 'keyboard' });
    expect(inputOriginOf({ detail: 1, clientX: 12, clientY: 34 } as MouseEvent)).toEqual({ kind: 'pointer', x: 12, y: 34 });
  });
});
