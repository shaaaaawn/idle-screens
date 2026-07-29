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
 * The metaquarium fixture tank exercises the whole farm pipeline offline:
 * fetch the farm envelope JSON, resolve `ipfs://` model URLs through the
 * gateway param, stream GLBs in progressively, and swim them — on a WebGL2
 * canvas, with no page errors. `data-mq-fish` on the saver host reports the
 * spawned population; `data-mq-backend` reports which fidelity rung mounted
 * (headless runners without WebGL2 get the canvas-2d silhouette tank, which
 * skips the network pipeline by design).
 */
test('MQ1: fixture farm populates the tank through the ipfs gateway param', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto('/?saver=metaquarium-fixture');
  await page.waitForFunction(() => !!window.__idleScreens);
  await page.evaluate(() => window.__idleScreens!.sleep());

  // Async mount: capabilities probe + lazy three chunk — allow a cold start.
  await expect
    .poll(async () => (await surfaceDataset(page)).backend, { timeout: 15_000 })
    .not.toBe('');
  const { backend } = await surfaceDataset(page);

  if (backend === 'webgl2') {
    // All three fixture fish spawn (progressively, so poll), fetched through
    // the farm fixture + gateway-relative GLB URL.
    await expect
      .poll(async () => (await surfaceDataset(page)).fish, { timeout: 15_000 })
      .toBe(3);
    const isWebgl2Canvas = await page.evaluate(() => {
      const canvas = document
        .querySelector('idle-screen')
        ?.shadowRoot?.querySelector<HTMLCanvasElement>('.surface canvas');
      return !!canvas && !!canvas.getContext('webgl2');
    });
    expect(isWebgl2Canvas).toBe(true);
  } else {
    // No WebGL2 on this runner: the 2D silhouette fallback still renders a
    // populated tank (never blank) without touching the network.
    expect(backend).toBe('canvas2d');
    await expect.poll(async () => (await surfaceDataset(page)).fish).toBeGreaterThan(0);
  }

  expect(pageErrors).toEqual([]);
});

/**
 * Hero mode (no farm): the default metaquarium saver stages exactly ONE
 * textured hero fish — the pool is sized to the need, not MAX_FISH — and
 * survives wake/dispose cleanly.
 */
test('MQ2: hero tank stages a single textured fish and wakes cleanly', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto('/?saver=metaquarium');
  await page.waitForFunction(() => !!window.__idleScreens);
  await page.evaluate(() => window.__idleScreens!.sleep());

  await expect.poll(async () => (await surfaceDataset(page)).backend, { timeout: 15_000 }).not.toBe('');
  const { backend } = await surfaceDataset(page);
  if (backend === 'webgl2') {
    // Exactly one GLB clone — hero mode spawns what it needs, nothing more.
    await expect
      .poll(async () => (await surfaceDataset(page)).fish, { timeout: 20_000 })
      .toBe(1);
  } else {
    // 2D fallback seeds its silhouette pool up front.
    await expect.poll(async () => (await surfaceDataset(page)).fish).toBeGreaterThan(0);
  }

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
 * Workbench-churn stability: browsers cap live WebGL contexts (~16) and kill
 * the oldest past the cap. Every mount creates a context, so 18 mount/dispose
 * cycles crash unless dispose() force-releases via forceContextLoss(). This
 * is the "dev tools are janky and crash" regression gate.
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
