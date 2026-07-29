import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window {
    __idleScreens?: { sleep: () => void; wake: () => void; state: () => string };
  }
}

/**
 * The screen must stay a screen. When the active saver faults at runtime
 * (the dev-only `chaos` saver throws from its loop 400ms after mount), core
 * swaps to the configured crash saver — the BSOD — instead of freezing on a
 * black rectangle. Any key still wakes.
 */
async function surfaceHtml(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      document.querySelector('idle-screen')?.shadowRoot?.querySelector('.surface')?.innerHTML ?? '',
  );
}

test('CR1: a saver runtime fault swaps to the BSOD crash saver, and wake still works', async ({
  page,
}) => {
  await page.goto('/?saver=chaos');
  await page.waitForFunction(() => !!window.__idleScreens);
  await page.evaluate(() => window.__idleScreens!.sleep());

  // The chaos saver mounts, then detonates; core swaps in the BSOD.
  await expect.poll(() => surfaceHtml(page), { timeout: 10_000 }).toContain('is-bsod-root');

  // The dialog is still the sleeping screen and input still wakes it.
  expect(await page.evaluate(() => window.__idleScreens!.state())).toBe('sleeping');
  await page.waitForTimeout(600); // past the wake arm-guard
  await page.keyboard.press('Space');
  await expect
    .poll(() => page.evaluate(() => window.__idleScreens!.state()))
    .toBe('awake');
});

/**
 * The floor of the ladder: with no crash saver registered under the
 * configured id, core renders its built-in DOM fault screen. Covered at the
 * unit level too (fault-screen.test.ts); this asserts the wiring end to end
 * by pointing the crash swap at the faulted saver itself (self-swap is
 * refused, so the built-in screen shows).
 */
test('CR2: the built-in fault screen appears when the crash saver cannot be used', async ({
  page,
}) => {
  // Point the crash ladder at the faulting saver itself — an invalid target,
  // so the ladder falls through to core's built-in floor.
  await page.goto('/?saver=chaos&crashSaver=chaos');
  await page.waitForFunction(() => !!window.__idleScreens);
  await page.evaluate(() => window.__idleScreens!.sleep());
  await expect.poll(() => surfaceHtml(page), { timeout: 10_000 }).toContain('is-fault-screen');
  await expect.poll(() => surfaceHtml(page)).toContain('SAVER_FAULT');
});
