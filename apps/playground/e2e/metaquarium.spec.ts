import { test, expect } from '@playwright/test';

declare global {
  interface Window {
    __idleScreens?: { sleep: () => void; wake: () => void };
  }
}

/**
 * The metaquarium fixture tank exercises the whole farm pipeline offline:
 * fetch the farm envelope JSON, resolve `ipfs://` model URLs through the
 * gateway param, stream GLBs in progressively, and swim them — on a WebGL2
 * canvas, with no page errors. `data-mq-fish` on the saver host reports the
 * spawned population.
 */
test('MQ1: fixture farm populates the tank through the ipfs gateway param', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  const farmRequest = page.waitForRequest('**/assets/metaquarium/farm-fixture.json');
  const glbRequest = page.waitForRequest('**/assets/metaquarium/beta-fish.glb');
  await page.goto('/?saver=metaquarium-fixture');
  await page.waitForFunction(() => !!window.__idleScreens);
  await page.evaluate(() => window.__idleScreens!.sleep());

  await farmRequest;
  await glbRequest;

  // All three fixture fish spawn (progressively, so poll).
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const surface = document.querySelector('idle-screen')?.shadowRoot?.querySelector<HTMLElement>('.surface');
          return Number(surface?.dataset.mqFish ?? 0);
        }),
      { timeout: 15_000 },
    )
    .toBe(3);

  // Renders on a WebGL2 canvas sized to the surface.
  const backend = await page.evaluate(() => {
    const canvas = document
      .querySelector('idle-screen')
      ?.shadowRoot?.querySelector<HTMLCanvasElement>('.surface canvas');
    if (!canvas) return 'no-canvas';
    return canvas.getContext('webgl2') ? 'webgl2' : 'other';
  });
  expect(backend).toBe('webgl2');

  expect(pageErrors).toEqual([]);
});

/**
 * Bundled mode (no farm): the default metaquarium saver fills the tank from
 * the single fishUrl breed and survives wake/dispose cleanly.
 */
test('MQ2: bundled tank spawns the full school and wakes cleanly', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto('/?saver=metaquarium');
  await page.waitForFunction(() => !!window.__idleScreens);
  await page.evaluate(() => window.__idleScreens!.sleep());

  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const surface = document.querySelector('idle-screen')?.shadowRoot?.querySelector<HTMLElement>('.surface');
          return Number(surface?.dataset.mqFish ?? 0);
        }),
      { timeout: 20_000 },
    )
    .toBe(24); // MAX_FISH: bundled mode fills every slot from one template

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
