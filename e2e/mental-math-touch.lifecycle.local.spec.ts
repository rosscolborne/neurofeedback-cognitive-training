import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { answer, hud, key, openMentalMath, startRun, waitForQuestion } from './helpers/mentalMath';

// NFCT-33: the Mental Math run screen on phone-sized screens. It runs in the
// WebKit iPhone projects (playwright.webkit.config.ts) and in desktop Chromium
// with the protocol suite; the widths it checks are set explicitly, so both
// measure the same layouts. Playwright cannot press and hold a touch, so the
// long-press check uses what WebKit and Chromium can show on Linux: the double
// and triple clicks that select a word and a line select nothing. A real
// long-press, its callout and double-tap zoom stay on the device checklist.

const PHONE_WIDTHS = [
  { width: 320, height: 568 }, // iPhone SE (1st gen) class: the narrowest supported layout
  { width: 375, height: 667 }, // iPhone SE (2nd and 3rd gen)
  { width: 390, height: 844 }, // iPhone 12 to 14
];

const scoreOf = async (page: Page) => Number((await hud(page, 'score').innerText()).replace(/\D/g, ''));

/** How the HUD lays out at the current viewport; every overflow is in CSS px and must be <= 0. */
function hudLayout(page: Page) {
  return page.evaluate(() => {
    const hudElement = document.querySelector<HTMLElement>('.mm-hud')!;
    const shown = (element: Element) => getComputedStyle(element).display !== 'none';
    const items = [...hudElement.querySelectorAll<HTMLElement>('.mm-hud-item')].filter(shown);
    const pause = hudElement.querySelector<HTMLElement>('.mm-pause')!;
    const boxes = [...items, pause].map((element) => element.getBoundingClientRect());
    return {
      labels: items.map((item) => item.querySelector('dt')?.textContent ?? ''),
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      hudOverflow: hudElement.scrollWidth - hudElement.clientWidth,
      // Labels never wrap, so text wider than its item would spill into the next one.
      itemOverflow: Math.max(...items.map((item) => item.scrollWidth - item.clientWidth)),
      // Each box must end before the next begins (the Pause button last).
      overlap: Math.max(...boxes.slice(1).map((box, index) => boxes[index]!.right - box.left)),
      pauseOverflow: pause.scrollWidth - pause.clientWidth,
      hudRight: hudElement.getBoundingClientRect().right - window.innerWidth,
    };
  });
}

async function expectSubmitInView(page: Page): Promise<void> {
  const viewport = page.viewportSize()!;
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const submit = await key(page, 'Submit').boundingBox();
  expect(submit, 'Submit has a layout box').not.toBeNull();
  expect(submit!.y).toBeGreaterThanOrEqual(0);
  expect(submit!.y + submit!.height, `Submit is fully visible without scrolling at ${viewport.width} x ${viewport.height}`).toBeLessThanOrEqual(viewport.height);
}

async function selectionAfter(page: Page, action: () => Promise<void>): Promise<string> {
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await action();
  return page.evaluate(() => window.getSelection()?.toString() ?? '');
}

test('the run screen selects nothing on a press, fits phone widths with a 4-digit score and keeps Submit in view', async ({ page }) => {
  await openMentalMath(page);
  await startRun(page, 1);
  await waitForQuestion(page);

  // The settings iOS needs, where this engine exposes them (iOS-only properties are not parsed on Linux).
  const touch = await page.locator('.mm-run').evaluate((run) => {
    const style = getComputedStyle(run);
    const read = (property: string) => (CSS.supports(property, 'none') ? style.getPropertyValue(property) : 'unsupported');
    return {
      touchAction: style.touchAction,
      userSelect: CSS.supports('user-select', 'none') ? style.getPropertyValue('user-select') : style.getPropertyValue('-webkit-user-select'),
      touchCallout: read('-webkit-touch-callout'),
      tapHighlight: CSS.supports('-webkit-tap-highlight-color', 'transparent') ? style.getPropertyValue('-webkit-tap-highlight-color') : 'unsupported',
    };
  });
  expect(touch.touchAction).toBe('manipulation');
  expect(touch.userSelect).toBe('none');
  expect(['none', 'unsupported']).toContain(touch.touchCallout);
  expect(['rgba(0, 0, 0, 0)', 'transparent', 'unsupported']).toContain(touch.tapHighlight);

  // Selecting the question, the typed entry or a key by word or line selects nothing.
  const question = page.locator('.mm-question');
  expect(await selectionAfter(page, () => question.dblclick())).toBe('');
  expect(await selectionAfter(page, () => question.click({ clickCount: 3 }))).toBe('');
  expect(await selectionAfter(page, () => page.locator('.mm-entry').dblclick())).toBe('');
  // Submit does nothing while nothing is typed (aria-disabled, hence force), so pressing it changes no state.
  expect(await selectionAfter(page, () => key(page, 'Submit').click({ clickCount: 3, force: true }))).toBe('');
  await expect(page.locator('.mm-feedback')).toHaveText('');

  // Answer until the score has four digits (about a dozen correct answers from level 1).
  for (let answered = 0; answered < 40 && (await scoreOf(page)) < 1_000; answered += 1) await answer(page, true, 1_000);
  expect(await scoreOf(page)).toBeGreaterThanOrEqual(1_000);
  await waitForQuestion(page);

  const projectViewport = page.viewportSize()!;
  for (const size of [...PHONE_WIDTHS, projectViewport]) {
    await page.setViewportSize(size);
    const layout = await hudLayout(page);
    const at = `${size.width} x ${size.height}: ${JSON.stringify(layout)}`;
    expect(layout.labels, at).toEqual(expect.arrayContaining(['Time left', 'Level', 'Score']));
    expect(layout.pageOverflow, at).toBeLessThanOrEqual(0);
    expect(layout.hudOverflow, at).toBeLessThanOrEqual(0);
    expect(layout.itemOverflow, at).toBeLessThanOrEqual(0);
    expect(layout.overlap, at).toBeLessThanOrEqual(0);
    expect(layout.pauseOverflow, at).toBeLessThanOrEqual(0);
    expect(layout.hudRight, at).toBeLessThanOrEqual(0);
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    if (size.height >= 667) await expectSubmitInView(page);
  }
});
