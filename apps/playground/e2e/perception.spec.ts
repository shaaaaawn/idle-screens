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
  colors: Array<{ hex: string; share: number }>;
  motion: { rate: number; changedFraction: number; dtMs: number } | null;
  reason?: string;
}

interface PerceiveHook {
  all(o: unknown): Promise<Row[]>;
  saver(id: string, o: { width?: number; height?: number; seed?: number; t?: number; dpr?: number }): Promise<Row>;
  list(): Array<{ id: string; label: string; timeModel?: 'closed-form' | 'simulated' }>;
}

/** Frame-addressable imperative savers — reproducible pixel readings.
 *  `pipes` and `mystify` joined with the July 2026 closed-form rewrites. */
const DETERMINISTIC_IMPERATIVE = ['black-hole', 'tide', 'dvd', 'fade-out', 'pipes', 'mystify'];
/** No canvas to read: these draw with elements + CSS transforms. */
const CSS_SAVERS = ['toasters', 'fish', 'bouncing-ball', 'bsod'];
/** Worker-ready savers must NOT be excluded — see the assertion below. */
const WORKER_READY = ['warp', 'rainstorm', 'globe', 'mystify', 'pipes', 'flurry'];

const ready = async (page: Page, url = '/#dev'): Promise<void> => {
  await page.goto(url);
  await page.waitForFunction(() => !!(window as unknown as { __perceive?: unknown }).__perceive);
};

test('support verdicts agree with each manifest\'s timeModel claim', async ({ page }) => {
  await ready(page);
  const { models, rows } = await page.evaluate(async () => {
    const p = (window as unknown as { __perceive: PerceiveHook }).__perceive;
    return {
      models: p.list(),
      rows: await p.all({ width: 320, height: 200, seed: 42, t: 5000 }),
    };
  });
  const modelOf = new Map(models.map((m) => [m.id, m.timeModel]));
  // The whole catalog declares its time model — a new saver cannot slip in
  // without stating one (this is the derived replacement for hand lists).
  for (const m of models) {
    expect(m.timeModel, `${m.id} must declare a timeModel`).toMatch(/^(closed-form|simulated)$/);
  }
  for (const r of rows) {
    if (modelOf.get(r.id) === 'simulated') {
      // A simulated saver may be read, but never certified deterministic —
      // and it must say why the numbers wobble.
      expect(r.support, `${r.id} is simulated`).not.toBe('deterministic');
      if (r.support === 'sampled') {
        expect(r.reason, `${r.id} explains its sampling`).toMatch(/simulat/i);
      }
    }
    if (r.support === 'deterministic') {
      expect(modelOf.get(r.id), `${r.id} is certified deterministic, so it must claim closed-form`).toBe('closed-form');
    }
  }
});

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

test('pixels report colour and whole-frame motion — signal the spec path lacks', async ({ page }) => {
  await ready(page);
  const rows = await page.evaluate(async () => {
    const p = (window as unknown as { __perceive: PerceiveHook }).__perceive;
    const o = { width: 320, height: 200, seed: 42, t: 5000 };
    return {
      tide: await p.saver('tide', o),
      blackHole: await p.saver('black-hole', o),
      globe: await p.saver('globe', o),
      pipes: await p.saver('pipes', o),
      fluid: await p.saver('fluid', o),
    };
  });

  for (const [name, r] of Object.entries(rows)) {
    // A dominant colour must actually dominate. 5-bit buckets splintered
    // gradients so the top entry sat near 6% and said nothing.
    expect(r.colors.length, `${name} produced no palette`).toBeGreaterThan(0);
    expect(r.colors[0]!.share, `${name} has no dominant colour`).toBeGreaterThan(0.08);
    expect(r.colors[0]!.hex).toMatch(/^#[0-9a-f]{6}$/);
    // Shares are fractions of ink and must be ordered.
    for (let i = 1; i < r.colors.length; i++) {
      expect(r.colors[i]!.share).toBeLessThanOrEqual(r.colors[i - 1]!.share);
    }
  }

  // Motion needs a frame-addressable saver. Globe joined that club in the
  // July 2026 modernization batch and pipes in the compiled-plan rewrite;
  // fluid (a true simulation) is the saver that legitimately stays sampled,
  // so it carries the null-motion assertion now.
  expect(rows.tide.motion, 'tide is frame-addressable').not.toBeNull();
  expect(rows.tide.motion!.rate).toBeGreaterThan(0);
  expect(rows.blackHole.motion).not.toBeNull();
  expect(rows.globe.motion, 'globe is frame-addressable since the P3 modernization').not.toBeNull();
  expect(rows.pipes.motion, 'pipes is frame-addressable since the compiled-plan rewrite').not.toBeNull();
  expect(rows.fluid.motion, 'fluid is a real simulation — only sampled, so motion would be meaningless').toBeNull();
});

/**
 * Thumbnail proportionality.
 *
 * A gallery card renders a saver far smaller than it was authored for, and that
 * broke in BOTH directions at once: classic savers use absolute pixel constants
 * so they read far too dense (warp was 20× fullsize ink), while schema savers
 * scale entity count by `min(w,h)/referenceViewport` so they read far too sparse
 * (polygons was 0.01×). The gallery now hands each saver a REF-sized logical
 * viewport with a card-sized backing store (dpr below 1), which costs nothing.
 */
test('savers keep their proportions when rendered at thumbnail scale', async ({ page }) => {
  test.setTimeout(120_000);
  await ready(page);
  const rows = await page.evaluate(async () => {
    const p = (window as unknown as { __perceive: PerceiveHook }).__perceive;
    const ids = ['warp', 'globe', 'pipes', 'flurry', 'spotlight', 'dev-dashboard', 'matrix-rain', 'sakura'];
    const out: Array<{ id: string; ratio: number }> = [];
    for (const id of ids) {
      const full = await p.saver(id, { width: 1280, height: 800, seed: 42, t: 5000 });
      // Same geometry the gallery uses: REF viewport, card-sized buffer.
      const thumb = await p.saver(id, { width: 960, height: 600, seed: 42, t: 5000, dpr: 1 / 3 });
      out.push({ id, ratio: full.coverage > 0.0001 ? thumb.coverage / full.coverage : 1 });
    }
    return out;
  });

  for (const { id, ratio } of rows) {
    // Was 0.01×–20× before; anything inside this band reads as the same scene.
    expect(ratio, `${id} is out of proportion at thumbnail scale (${ratio.toFixed(2)}×)`).toBeGreaterThan(0.35);
    expect(ratio, `${id} is out of proportion at thumbnail scale (${ratio.toFixed(2)}×)`).toBeLessThan(2.6);
  }

  // The dashboard is the tightest case: its px fonts used to ignore the
  // viewport entirely, so its text overlapped itself in a card.
  const dash = rows.find((r) => r.id === 'dev-dashboard')!;
  expect(dash.ratio).toBeGreaterThan(0.7);
  expect(dash.ratio).toBeLessThan(1.4);
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
  // Open by default — it used to be collapsed, which hid the readout behind a
  // click most people never made.
  await expect(perc).toHaveAttribute('open', '');
  await expect(page.locator('.perc-braille')).toBeVisible();
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
