import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window {
    __idleScreens?: { sleep: () => void; wake: () => void };
  }
}

/** The saver host inside <idle-screen>'s shadow root. */
async function surfaceDataset(page: Page): Promise<{ fish: number; backend: string; draco: boolean }> {
  return page.evaluate(() => {
    const surface = document
      .querySelector('idle-screen')
      ?.shadowRoot?.querySelector<HTMLElement>('.surface');
    return {
      fish: Number(surface?.dataset.mqFish ?? 0),
      backend: surface?.dataset.mqBackend ?? '',
      draco: surface?.dataset.mqDraco === '1',
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

/**
 * Mix variant: "257:2,100:1" against the local-asset catalog — three fish
 * from two distinct GLB templates, no network. Steering-independence of the
 * population is covered by unit tests; this proves the wired path end-to-end.
 */
test('MQ4: fishMix spawns the expanded population from mixed templates', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto('/?saver=metaquarium-mix');
  await page.waitForFunction(() => !!window.__idleScreens);
  await page.evaluate(() => window.__idleScreens!.sleep());

  await expect
    .poll(async () => (await surfaceDataset(page)).fish, { timeout: 20_000 })
    .toBe(3);

  const mix = await page.evaluate(() => {
    const surface = document
      .querySelector('idle-screen')
      ?.shadowRoot?.querySelector<HTMLElement>('.surface');
    return surface?.dataset.mqMix ?? '';
  });
  expect(mix).toBe('257:2,100:1');
  expect(pageErrors).toEqual([]);
});

/**
 * Atmosphere variant: motes active (dataset-verified), fog depth + floor
 * steered — the Phase 2 params live at non-defaults.
 */
test('MQ5: atmosphere variant activates motes and mounts clean', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto('/?saver=metaquarium-atmosphere');
  await page.waitForFunction(() => !!window.__idleScreens);
  await page.evaluate(() => window.__idleScreens!.sleep());

  await expect
    .poll(async () => (await surfaceDataset(page)).fish, { timeout: 20_000 })
    .toBeGreaterThanOrEqual(3);

  const motes = await page.evaluate(() => {
    const surface = document
      .querySelector('idle-screen')
      ?.shadowRoot?.querySelector<HTMLElement>('.surface');
    return Number(surface?.dataset.mqMotes ?? 0);
  });
  expect(motes).toBeGreaterThan(100); // 0.85 × tier cap
  expect(pageErrors).toEqual([]);
});

/**
 * Draco: bundled shark3.glb is KHR_draco_mesh_compression-REQUIRED (62KB vs
 * the 2MB plain shark). Before the decoder shipped, this rendered fallback
 * blobs with no error anywhere — so the assertion that matters is a decoded
 * mesh (`data-mq-draco`), not a network sniff of the worker-fetched wasm.
 */
test('MQ6: a Draco-compressed model decodes and mounts', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto('/?saver=metaquarium-draco');
  await page.waitForFunction(() => !!window.__idleScreens);
  await page.evaluate(() => window.__idleScreens!.sleep());

  await expect
    .poll(async () => (await surfaceDataset(page)).fish, { timeout: 25_000 })
    .toBeGreaterThanOrEqual(1);

  await expect
    .poll(async () => (await surfaceDataset(page)).draco, { timeout: 45_000 })
    .toBe(true);
  expect(pageErrors).toEqual([]);
});
