import { test, expect } from '@playwright/test';

declare global {
  interface Window {
    __frameReady?: boolean;
    __idleScreens?: { sleep(): void; wake(): void; state(): string; active(): string | null };
  }
}

/**
 * The headline proof: a saver is a seeded program steered by a deterministic
 * control track, so the SAME (program, seed, track, t) reproduces the SAME pixels.
 * We render frame 1500ms of the black hole with seed 42 and the demo track twice
 * (two fresh page loads) and assert the canvas pixels are byte-identical.
 */
async function renderFrame(pageUrl: string, page: import('@playwright/test').Page): Promise<string> {
  await page.goto(pageUrl);
  await page.waitForFunction(() => window.__frameReady === true, undefined, { timeout: 15_000 });
  return page.evaluate(() => (document.querySelector('#stage canvas') as HTMLCanvasElement).toDataURL());
}

const URL = '/?frame=1500&seed=42&track=demo';

test('black hole renderFrame is pixel-deterministic across loads', async ({ page }) => {
  const a = await renderFrame(URL, page);
  const b = await renderFrame(URL, page);
  expect(a.length).toBeGreaterThan(2000); // non-empty canvas
  expect(a).toBe(b); // identical pixels
});

test('a different seed produces a different frame', async ({ page }) => {
  const a = await renderFrame('/?frame=1500&seed=42&track=demo', page);
  const b = await renderFrame('/?frame=1500&seed=7&track=demo', page);
  expect(a).not.toBe(b);
});

test('the live overlay mounts the black hole on sleep', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__idleScreens);
  await page.evaluate(() => window.__idleScreens!.sleep());
  await expect
    .poll(() => page.evaluate(() => window.__idleScreens?.active() ?? null), { timeout: 10_000 })
    .toBe('black-hole');
  expect(await page.evaluate(() => window.__idleScreens?.state())).toBe('sleeping');
});

const SAVER_IDS = [
  'black-hole', 'toasters', 'dvd', 'warp', 'fish', 'rainstorm', 'hard-rain',
  'globe', 'spotlight', 'fade-out', 'bouncing-ball', 'logo', 'messages', 'messages2',
];

test('every saver mounts on sleep without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  for (const id of SAVER_IDS) {
    await page.goto(`/?saver=${id}`);
    await page.waitForFunction(() => !!window.__idleScreens);
    await page.evaluate(() => window.__idleScreens!.sleep());
    await expect
      .poll(() => page.evaluate(() => window.__idleScreens?.active() ?? null), { timeout: 8_000 })
      .toBe(id);
    const mounted = await page.evaluate(() => {
      const el = document.querySelector('idle-screen');
      const surface = el?.shadowRoot?.querySelector('.surface');
      return !!surface && surface.childElementCount > 0;
    });
    expect(mounted, `${id} should render into the host`).toBe(true);
  }
  expect(errors, 'no errors across all savers').toEqual([]);
});
