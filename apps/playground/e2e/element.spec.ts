import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window {
    __idleScreens?: {
      sleep(): void;
      wake(): void;
      setPlugin(id: string): void;
      state(): string;
      active(): string | null;
    };
  }
}

/** Read the shadow-DOM saver dialog's observable state in one hop. */
const frame = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('idle-screen');
    const sr = el?.shadowRoot;
    const d = sr?.querySelector<HTMLDialogElement>('dialog.frame');
    const surface = sr?.querySelector('.surface');
    const clock = sr?.querySelector<HTMLElement>('.clock');
    return {
      open: d?.open ?? false,
      passthrough: d?.classList.contains('passthrough') ?? false,
      reduced: d?.classList.contains('reduced') ?? false,
      bg: d ? getComputedStyle(d).backgroundColor : '',
      surfaceCount: surface?.childElementCount ?? 0,
      clockDisplay: clock ? clock.style.display : 'missing',
    };
  });

const ready = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => !!window.__idleScreens);
};
const sleep = (page: Page) => page.evaluate(() => window.__idleScreens!.sleep());
const state = (page: Page) => page.evaluate(() => window.__idleScreens!.state());
const openDialog = (page: Page) => expect.poll(() => frame(page).then((f) => f.open)).toBe(true);

test('L2/L9: sleep opens the modal + mounts the saver; wake closes it + empties the host', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await sleep(page);
  await openDialog(page);
  const asleep = await frame(page);
  expect(asleep.surfaceCount).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__idleScreens!.active())).toBe('black-hole');

  await page.evaluate(() => window.__idleScreens!.wake());
  await expect.poll(() => frame(page).then((f) => f.open)).toBe(false);
  expect((await frame(page)).surfaceCount).toBe(0); // host emptied, no leak
});

test('L3: 450ms wake arm-guard — input during the guard does not wake; after it, it does', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await sleep(page);
  await openDialog(page);

  // Immediately (well within the 450ms guard) an input must NOT wake.
  const stillAsleep = await page.evaluate(() => {
    const d = document.querySelector('idle-screen')!.shadowRoot!.querySelector('dialog.frame')!;
    d.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    return window.__idleScreens!.state();
  });
  expect(stillAsleep).toBe('sleeping');

  await page.waitForTimeout(600); // past the guard
  const awake = await page.evaluate(() => {
    const d = document.querySelector('idle-screen')!.shadowRoot!.querySelector('dialog.frame')!;
    d.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    return window.__idleScreens!.state();
  });
  expect(awake).toBe('awake');
});

test('L4: Escape wakes (cancels) the saver', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await sleep(page);
  await openDialog(page);
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await expect.poll(() => state(page)).toBe('awake');
});

test('L5: passthrough saver is transparent; non-passthrough has an opaque backdrop', async ({ page }) => {
  await page.goto('/'); // black-hole (passthrough)
  await ready(page);
  await sleep(page);
  await openDialog(page);
  const pass = await frame(page);
  expect(pass.passthrough).toBe(true);
  expect(pass.bg).toBe('rgba(0, 0, 0, 0)'); // transparent

  await page.goto('/?saver=dvd'); // non-passthrough
  await ready(page);
  await sleep(page);
  await openDialog(page);
  const opaque = await frame(page);
  expect(opaque.passthrough).toBe(false);
  expect(opaque.bg).toBe('rgb(10, 10, 15)'); // #0a0a0f
});

test('L6: clock shows only while asleep + showClock + non-passthrough', async ({ page }) => {
  // non-passthrough + clock on -> visible while asleep, hidden when awake
  await page.goto('/?saver=dvd&clock=1');
  await ready(page);
  await sleep(page);
  await openDialog(page);
  await expect.poll(() => frame(page).then((f) => f.clockDisplay)).toBe('block');
  await page.evaluate(() => window.__idleScreens!.wake());
  await expect.poll(() => frame(page).then((f) => f.clockDisplay)).toBe('none');

  // passthrough hides the clock even with showClock on
  await page.goto('/?clock=1');
  await ready(page);
  await sleep(page);
  await openDialog(page);
  expect((await frame(page)).clockDisplay).toBe('none');
});

test('L7: reduced-motion adds the "reduced" (no-animation) class', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await ready(page);
  await sleep(page);
  await openDialog(page);
  expect((await frame(page)).reduced).toBe(true);
});

test('L8: setPlugin while asleep remounts the newly-active saver', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await sleep(page);
  await openDialog(page);
  await page.evaluate(() => window.__idleScreens!.setPlugin('dvd'));
  await expect.poll(() => page.evaluate(() => window.__idleScreens!.active())).toBe('dvd');
  expect((await frame(page)).surfaceCount).toBeGreaterThan(0); // remounted, host still populated
});

test('L10: external-engine handoff — the element drives the caller-owned engine', async ({ page }) => {
  await page.goto('/?engine=external');
  await ready(page); // hook is installed by the external engine's init()
  await sleep(page);
  await openDialog(page);
  expect(await state(page)).toBe('sleeping');
  expect(await page.evaluate(() => window.__idleScreens!.active())).toBe('black-hole');
});
