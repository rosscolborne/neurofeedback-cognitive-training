import { describe, expect, it } from 'vitest';
import { keyboardRevealDistance } from '../useKeepActionAboveKeyboard';

// An iPhone SE-sized layout viewport (667 px) with the keyboard and its
// accessory bar covering the bottom 330 px.
const keyboardOpen = { height: 337, offsetTop: 0, scale: 1 };
const layout = { fieldTop: 240, actionBottom: 420, layoutHeight: 667, viewport: keyboardOpen };

describe('keyboardRevealDistance', () => {
  it('scrolls the button up to just above the keyboard', () => {
    // 420 + 12 px margin - 337 visible.
    expect(keyboardRevealDistance(layout)).toBe(95);
  });

  it('measures from where the visual viewport has already been panned', () => {
    expect(keyboardRevealDistance({ ...layout, viewport: { ...keyboardOpen, offsetTop: 60 } })).toBe(35);
    expect(keyboardRevealDistance({ ...layout, viewport: { ...keyboardOpen, offsetTop: 100 } })).toBe(0);
  });

  it('never scrolls the focused field out of view, revealing as much as fits', () => {
    // The field may move up to 12 px below the top: 100 - 12.
    expect(keyboardRevealDistance({ ...layout, fieldTop: 100 })).toBe(88);
    expect(keyboardRevealDistance({ ...layout, fieldTop: 12 })).toBe(0);
    expect(keyboardRevealDistance({ ...layout, fieldTop: -40 })).toBe(0);
  });

  it('does nothing when the button is already visible', () => {
    expect(keyboardRevealDistance({ ...layout, actionBottom: 300 })).toBe(0);
    expect(keyboardRevealDistance({ ...layout, actionBottom: 325 })).toBe(0);
  });

  it('does nothing without an open keyboard or while the page is pinch-zoomed', () => {
    expect(keyboardRevealDistance({ ...layout, actionBottom: 700, viewport: { height: 667, offsetTop: 0, scale: 1 } })).toBe(0);
    // A desktop window slightly shorter than its page is not a keyboard.
    expect(keyboardRevealDistance({ ...layout, actionBottom: 700, viewport: { height: 600, offsetTop: 0, scale: 1 } })).toBe(0);
    expect(keyboardRevealDistance({ ...layout, viewport: { ...keyboardOpen, scale: 2 } })).toBe(0);
  });
});
