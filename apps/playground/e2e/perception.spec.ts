import { test, expect, type Page } from '@playwright/test';

/**
 * The perception support matrix, pinned.
 *
 * Two mechanisms, not one:
 *   - schema savers are perceived ANALYTICALLY from their SaverSpec
 *     (`perceiveScene`) — deterministic, and layer-attributed;
 *   - imperative savers are perceived by reading PIXELS off a mounted frame
 *     (`perceiveSaverFrame`) — a real picture and real whole-frame stats, but
 *     no per-layer dominance or motion.
 *
 * A saver implementing `renderFrame(t, seed)` is reproducible; one that does
 * not is sampled from a live frame and its numbers move run to run. CSS/DOM
 * savers have no canvas at all and are reported as unsupported with a reason,
 * rather than silently returning zeros.
 */

interface Row {
  id: string;
  support: 'deterministic' | 'sampled' | 'unsupported';
  coverage: number;
  braille: string;
  reason?: string;
}

interface PerceiveHook {
  all(o: unknown): Promise<Row[]>;
  saver(id: string, o: unknown): Promise<Row>;
}

/** Frame-addressable imperative savers — reproducible pixel readings. */
const DETERMINISTIC_IMPERATIVE = ['black-hole', 'tide'];
/** No canvas to read: these draw with elements + CSS transforms. */
const CSS_SAVERS = ['toasters', 'dvd', 'fish', 'fade-out', 'bouncing-ball', 'logo', 'messages', 'messages2', 'bsod'];
/** Worker-ready savers must NOT be excluded — see the assertion below. */
const WORKER_READY = ['warp', 'rainstorm', 'globe', 'mystify', 'pipes', 'flurry'];

const ready = async (page: Page, url = '/#dev'): Promise<void> => {
  await page.goto(url);
  await page.waitForFunction(() => !!(window as unknown as { __perceive?: unknown }).__perceive);
};

test('every canvas saver yields a picture; CSS savers say why they cannot', async ({ page }) => {
  await ready(page);
  const rows = await page.evaluate(async () =>
    (window as unknown as { __perceive: PerceiveHook }).__perceive.all({
      width: 320, height: 200, seed: 42, t: 5000,
    }),
  );
  const by = new Map(rows.map((r) => [r.id, r]));
  expect(rows.length).toBeGreaterThan(20);

  for (const id of CSS_SAVERS) {
    const r = by.get(id);
    if (!r) continue; // catalogue churn must not fail the matrix
    expect(r.support, `${id} draws with CSS — no pixels to read`).toBe('unsupported');
    expect(r.reason, `${id} must explain why, never a silent zero`).toMatch(/CSS\/DOM|canvas/i);
    expect(r.braille).toBe('');
  }

  for (const id of DETERMINISTIC_IMPERATIVE) {
    const r = by.get(id);
    if (!r) continue;
    expect(r.support, `${id} implements renderFrame — its reading is reproducible`).toBe('deterministic');
    expect(r.braille.length).toBeGreaterThan(100);
  }

  // `manifest.workerReady` describes an ENGINE capability; a direct
  // saver.mount() renders on the main thread, so the canvas is readable.
  // Guarding on the manifest would wrongly drop ~10 savers.
  for (const id of WORKER_READY) {
    const r = by.get(id);
    if (!r) continue;
    expect(r.support, `${id} is worker-ready but must still read when mounted directly`).not.toBe('unsupported');
  }

  // Anything claiming support must have produced real signal.
  for (const r of rows.filter((x) => x.support !== 'unsupported')) {
    expect(r.braille.length, `${r.id} claimed support but drew nothing`).toBeGreaterThan(100);
    expect(r.coverage).toBeGreaterThanOrEqual(0);
    expect(r.coverage).toBeLessThanOrEqual(1);
  }
});

test('a frame-addressable saver reads identically for the same (t, seed)', async ({ page }) => {
  await ready(page);
  const [a, b] = await page.evaluate(async () => {
    const p = (window as unknown as { __perceive: PerceiveHook }).__perceive;
    const opts = { width: 320, height: 200, seed: 42, t: 5000 };
    return [await p.saver('black-hole', opts), await p.saver('black-hole', opts)];
  });
  // The property that makes a pixel reading usable in an eval at all.
  expect(a.support).toBe('deterministic');
  expect(a.braille).toBe(b.braille);
  expect(a.coverage).toBe(b.coverage);
});

test('the Dev Tools panel labels which perception it is showing', async ({ page }) => {
  await page.goto('/?saver=snowfall#dev');
  await page.waitForFunction(() => !!window.__idleScreens);
  const perc = page
    .locator('#dock-right .wb-panel')
    .filter({ has: page.locator('.wb-panel-head', { hasText: 'Perception' }) });
  await perc.locator('.wb-panel-head').click();
  await expect(page.locator('.perc-mode')).toContainText('spec perception');

  // An imperative saver switches the panel to the pixel path rather than the
  // old "select a schema saver" dead end.
  await page.evaluate(() => {
    const item = document.querySelector('#dock-left .palette-item[data-id="black-hole"]');
    (item as HTMLButtonElement)?.click();
  });
  await expect(page.locator('.perc-mode')).toContainText('frame perception');
  await expect(page.locator('.perc-braille')).not.toBeEmpty();
  // ...and is explicit that layer-level data is not recoverable from pixels.
  await expect(page.locator('.perc-dominance')).toContainText('n/a');
});
