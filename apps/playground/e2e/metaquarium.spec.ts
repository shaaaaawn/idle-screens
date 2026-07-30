import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window {
    __idleScreens?: { sleep: () => void; wake: () => void };
  }
}

/** The saver host inside <idle-screen>'s shadow root. */
async function surfaceDataset(page: Page): Promise<{ fish: number; backend: string }> {
  return page.evaluate(() => {
    const surface = document
      .querySelector('idle-screen')
      ?.shadowRoot?.querySelector<HTMLElement>('.surface');
    return {
      fish: Number(surface?.dataset.mqFish ?? 0),
      backend: surface?.dataset.mqBackend ?? '',
    };
  });
}

/**
 * Default metaquarium: mounts a WebGL2 tank, spawns the fish pool, and
 * survives wake/dispose cleanly.
 */
test('MQ1: default tank mounts and populates on WebGL2', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto('/?saver=metaquarium');
  await page.waitForFunction(() => !!window.__idleScreens);
  await page.evaluate(() => window.__idleScreens!.sleep());

  await expect
    .poll(async () => (await surfaceDataset(page)).backend, { timeout: 15_000 })
    .toBe('webgl2');

  await expect
    .poll(async () => (await surfaceDataset(page)).fish, { timeout: 20_000 })
    .toBeGreaterThanOrEqual(1);

  const isWebgl2Canvas = await page.evaluate(() => {
    const canvas = document
      .querySelector('idle-screen')
      ?.shadowRoot?.querySelector<HTMLCanvasElement>('.surface canvas');
    return !!canvas && !!canvas.getContext('webgl2');
  });
  expect(isWebgl2Canvas).toBe(true);

  await page.evaluate(() => window.__idleScreens!.wake());
  await expect
    .poll(() =>
      page.evaluate(
        () => !!document.querySelector('idle-screen')?.shadowRoot?.querySelector('.surface canvas'),
      ),
    )
    .toBe(false);
  expect(pageErrors).toEqual([]);
});

/**
 * School variant: fishCount=6, verifies all six are visible in the pool.
 */
test('MQ2: school variant spawns at least 6 fish', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto('/?saver=metaquarium-school');
  await page.waitForFunction(() => !!window.__idleScreens);
  await page.evaluate(() => window.__idleScreens!.sleep());

  await expect
    .poll(async () => (await surfaceDataset(page)).backend, { timeout: 15_000 })
    .toBe('webgl2');

  await expect
    .poll(async () => (await surfaceDataset(page)).fish, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(6);

  expect(pageErrors).toEqual([]);
});

/**
 * Workbench-churn stability: browsers cap live WebGL contexts (~16) and kill
 * the oldest past the cap. Every mount creates a context, so 18 mount/dispose
 * cycles crash unless dispose() force-releases via forceContextLoss().
 */
test('MQ3: 18 mount/dispose cycles never exhaust the GL context pool', async ({ page }) => {
  test.setTimeout(90_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  const contextErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /context/i.test(m.text())) contextErrors.push(m.text());
  });

  await page.goto('/?saver=metaquarium');
  await page.waitForFunction(() => !!window.__idleScreens);
  for (let i = 0; i < 18; i++) {
    await page.evaluate(() => window.__idleScreens!.sleep());
    await expect
      .poll(async () => (await surfaceDataset(page)).backend, { timeout: 15_000 })
      .not.toBe('');
    await page.evaluate(() => window.__idleScreens!.wake());
    await page.waitForTimeout(100);
  }
  await page.evaluate(() => window.__idleScreens!.sleep());
  await expect
    .poll(async () => (await surfaceDataset(page)).fish, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(1);
  expect(contextErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
