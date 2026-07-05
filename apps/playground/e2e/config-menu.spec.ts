import { test, expect } from '@playwright/test';

declare global {
  interface Window {
    __idleScreens?: {
      state(): string;
      menuOpen(): boolean;
      active(): string | null;
      sleep(): void;
      wake(): void;
    };
  }
}

const menuOpen = (page: import('@playwright/test').Page) =>
  page.evaluate(() => window.__idleScreens?.menuOpen() ?? false);
const active = (page: import('@playwright/test').Page) =>
  page.evaluate(() => window.__idleScreens?.active() ?? null);

/**
 * The built-in config menu is part of the library and opens on a configurable
 * hotkey (⌘K / Ctrl+K by default). These prove: it opens on the hotkey, picking
 * a saver changes + persists the active saver, and it can be disabled via config.
 */
test('the ⌘K / Ctrl+K hotkey toggles the built-in config menu', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__idleScreens);
  expect(await menuOpen(page)).toBe(false);

  await page.keyboard.press('ControlOrMeta+KeyK');
  await expect.poll(() => menuOpen(page)).toBe(true);
  // The menu dialog lives in the element's shadow root and is a real open dialog.
  const dialogOpen = await page.evaluate(
    () => document.querySelector('idle-screen')?.shadowRoot?.querySelector<HTMLDialogElement>('dialog.menu')?.open ?? false,
  );
  expect(dialogOpen).toBe(true);

  await page.keyboard.press('ControlOrMeta+KeyK');
  await expect.poll(() => menuOpen(page)).toBe(false);
});

test('picking a saver in the menu changes it and it sticks across sleeps', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__idleScreens);
  await page.keyboard.press('ControlOrMeta+KeyK');
  await expect.poll(() => menuOpen(page)).toBe(true);

  // Playwright's CSS engine pierces the open shadow root.
  await page.locator('idle-screen .menu-select').selectOption('dvd');

  // previewOnPick (default): the menu closes and the chosen saver shows now.
  await expect.poll(() => active(page)).toBe('dvd');
  await expect.poll(() => menuOpen(page)).toBe(false);
  expect(await page.evaluate(() => window.__idleScreens?.state())).toBe('sleeping');

  // The pick persists: wake, sleep again under selection 'fixed' -> still dvd
  // (regression guard for the old pickPlugin behavior that reverted to default).
  await page.evaluate(() => window.__idleScreens?.wake());
  await expect.poll(() => page.evaluate(() => window.__idleScreens?.state())).toBe('awake');
  await page.evaluate(() => window.__idleScreens?.sleep());
  await expect.poll(() => active(page)).toBe('dvd');
});

test('configMenu:false disables the hotkey and the built-in menu', async ({ page }) => {
  await page.goto('/?menu=off');
  await page.waitForFunction(() => !!window.__idleScreens);
  await page.keyboard.press('ControlOrMeta+KeyK');
  // Give it a moment; nothing should open.
  await page.waitForTimeout(200);
  expect(await menuOpen(page)).toBe(false);
  const hasMenu = await page.evaluate(
    () => !!document.querySelector('idle-screen')?.shadowRoot?.querySelector('dialog.menu'),
  );
  expect(hasMenu).toBe(false);
});
