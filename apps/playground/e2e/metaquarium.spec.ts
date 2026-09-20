import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window {
    __idleScreens?: { sleep: () => void; wake: () => void };
  }
}

/** The saver host inside <idle-screen>'s shadow root. */
async function surfaceDataset(page: Page): Promise<{ fish: number; env: string; backend: string; draco: boolean }> {
  return page.evaluate(() => {
    const surface = document
      .querySelector('idle-screen')
      ?.shadowRoot?.querySelector<HTMLElement>('.surface');
    return {
      fish: Number(surface?.dataset.mqFish ?? 0),
      env: surface?.dataset.mqEnv ?? '',
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
  // fishLighting defaults to 'lit' (studio.ts), so every one of the 18 mounts
  // now also builds a fresh PMREMGenerator environment — real per-mount GPU
  // work that cannot be cached across cycles (each cycle gets its own
  // WebGLRenderer/context, which is the whole point of this test). Measured
  // ~60-70s for the loop alone on an idle runner; under a loaded CI runner
  // running other WebGL-heavy specs concurrently that leaves too little
  // margin against the old 90s budget.
  test.setTimeout(150_000);
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

/**
 * Environments: `void` must render exactly the pre-environment scene (no room
 * objects at all), and a named environment must actually build one. The
 * dataset hook is the honest signal — a ceiling that silently failed to build
 * would still leave fish on screen and look fine in a screenshot.
 */
test('MQ7: void is a no-op and a named environment builds a room', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto('/?saver=metaquarium');
  await page.waitForFunction(() => !!window.__idleScreens);
  await page.evaluate(() => window.__idleScreens!.sleep());
  await expect
    .poll(async () => (await surfaceDataset(page)).env, { timeout: 20_000 })
    .toBe('void');

  await page.goto('/?saver=metaquarium-env-reef');
  await page.waitForFunction(() => !!window.__idleScreens);
  await page.evaluate(() => window.__idleScreens!.sleep());
  await expect
    .poll(async () => (await surfaceDataset(page)).env, { timeout: 20_000 })
    .toBe('reef');
  await expect
    .poll(async () => (await surfaceDataset(page)).fish, { timeout: 20_000 })
    .toBeGreaterThanOrEqual(1);

  expect(pageErrors).toEqual([]);
});

test('MQ8: the formation branch mounts and populates without errors', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  // MQ2 covers the six-fish population variant, which predates swimStyle and
  // never reaches the carrier code. This is the only test that RUNS the
  // carrier path at all — it proves the branch mounts and spawns, not that
  // the formation holds. The geometry (no two fish inside a body length,
  // extent bounds every slot) is asserted in swim.test.ts, where the maths is
  // reachable without a GPU.
  await page.goto('/?saver=metaquarium-swim-school');
  await page.waitForFunction(() => !!window.__idleScreens);
  await page.evaluate(() => window.__idleScreens!.sleep());
  await expect
    .poll(async () => (await surfaceDataset(page)).fish, { timeout: 20_000 })
    .toBeGreaterThanOrEqual(6);

  expect(pageErrors).toEqual([]);
});

test('MQ9: the whole unminted NPC cast mounts — all eight breeds, no errors', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  // Draco + WebP in one scene: six of the eight are Draco-compressed and the
  // jellyfish atlas is WebP - this is the test that catches a decoder or
  // extension regression across the NPC pipeline.
  await page.goto('/?saver=metaquarium-npc');
  await page.waitForFunction(() => !!window.__idleScreens);
  await page.evaluate(() => window.__idleScreens!.sleep());
  await expect
    .poll(async () => (await surfaceDataset(page)).fish, { timeout: 30_000 })
    .toBe(8);

  expect(pageErrors).toEqual([]);
});

test('MQ10: ?lofi=1 mounts the Apple TV 2D tank — icons, no three.js, capturable', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  // Hermetic: every transparent icon is the same 8x8 PNG served from here, so
  // the test proves the backend, not a gateway's mood. Solid opaque magenta —
  // a colour the tank's own palette/gradients never produce — so a fish's
  // presence in the pixels is verifiable, not just its icon being decoded.
  const icon = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAE0lEQVR4nGP4z/D/Pz7MMDIUAACD5r9BB2dd7wAAAABJRU5ErkJggg==',
    'base64',
  );
  await page.route('**/*_transparent_icon.png', (route) =>
    route.fulfill({ body: icon, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' } }),
  );
  const chunks: string[] = [];
  page.on('request', (r) => chunks.push(r.url()));

  await page.goto('/?saver=metaquarium&lofi=1');
  await page.waitForFunction(() => !!window.__idleScreens);
  await page.evaluate(() => window.__idleScreens!.sleep());

  await expect
    .poll(async () => (await surfaceDataset(page)).backend, { timeout: 15_000 })
    .toBe('lofi');
  // Exact parity count, like MQ9's WebGL check — but lofiRich() ties fish
  // count to the runner's capability tier (8 lean, 13 on 'high'), so accept
  // either rather than assuming this Chromium always resolves 'standard'.
  await expect
    .poll(async () => [8, 13].includes((await surfaceDataset(page)).fish), { timeout: 15_000 })
    .toBe(true);

  // A 2d canvas, one a thumbnail can read (blob-decoded icons never taint),
  // and — the actual point of "icons" — at least one drawn magenta pixel.
  const surface = await page.evaluate(() => {
    const canvas = document
      .querySelector('idle-screen')
      ?.shadowRoot?.querySelector<HTMLCanvasElement>('.surface canvas');
    if (!canvas) return { twoD: false, readable: false, fishVisible: false };
    let readable = false;
    try {
      readable = canvas.toDataURL('image/jpeg').startsWith('data:image/jpeg');
    } catch {
      readable = false;
    }
    let fishVisible = false;
    const g2d = canvas.getContext('2d');
    if (g2d) {
      // Fish draw at globalAlpha 0.55-1 over a dark tank, so a near fish
      // reads as pure magenta and a far one as magenta blended into the
      // background — check the blend, not an exact (255,0,255) match.
      const { data } = g2d.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < data.length; i += 4) {
        if (data[i]! > 150 && data[i + 1]! < 100 && data[i + 2]! > 150) {
          fishVisible = true;
          break;
        }
      }
    }
    return { twoD: !!g2d, readable, fishVisible };
  });
  expect(surface).toEqual({ twoD: true, readable: true, fishVisible: true });

  // The WebGL tank's chunk (and with it three.js) never loads on this path.
  expect(chunks.filter((u) => /saver-metaquarium\/src\/tank\.ts|\/tank-[\w-]+\.js|node_modules\/.*three/.test(u))).toEqual([]);

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
 * Crystals (propMix): generated scenery builds and reports itself, and a tank
 * that asked for none builds none — the "byte-identical when off" contract,
 * checked at the one place a viewer could see it break.
 */
test('MQ40: propMix grows crystals; a propless tank grows none', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  const props = (): Promise<string | null> => page.evaluate(() => document
    .querySelector('idle-screen')
    ?.shadowRoot?.querySelector<HTMLElement>('.surface')?.dataset.mqProps ?? null);

  await page.goto('/?saver=metaquarium-crystal-habits');
  await page.waitForFunction(() => !!window.__idleScreens);
  await page.evaluate(() => window.__idleScreens!.sleep());
  // 5 clusters requested, but a software-GL runner resolves the 'minimal'
  // tier (see MQ10's fish-count check for the same class of flakiness),
  // whose props.clusters budget of 4 clamps the layout — accept either.
  await expect
    .poll(async () => [4, 5].includes(Number(await props())), { timeout: 20_000 })
    .toBe(true);

  await page.goto('/?saver=metaquarium-school');
  await page.waitForFunction(() => !!window.__idleScreens);
  await page.evaluate(() => window.__idleScreens!.sleep());
  await expect.poll(async () => (await surfaceDataset(page)).fish, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  expect(await props()).toBeNull();
  expect(pageErrors).toEqual([]);
});
