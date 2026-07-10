import { test, expect } from '@playwright/test';

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

const WORKER_SAVERS = ['warp', 'hard-rain', 'rainstorm', 'globe', 'spotlight'] as const;
const MAIN_THREAD_SAVERS = ['black-hole', 'toasters'] as const;

for (const saver of WORKER_SAVERS) {
  test(`worker-ready saver (${saver}) renders in a Worker and produces pixels`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await page.goto(`/?saver=${saver}`);
    await page.waitForFunction(() => !!window.__idleScreens);
    await page.evaluate(() => window.__idleScreens!.sleep());
    await expect
      .poll(() => page.evaluate(() => window.__idleScreens?.active()), { timeout: 8_000 })
      .toBe(saver);

    const isWorker = await page.evaluate(() => {
      const el = document.querySelector('idle-screen') as HTMLElement & { isWorker?: boolean };
      return el?.isWorker ?? false;
    });
    expect(isWorker, `${saver} should render in a Worker`).toBe(true);

    const hasCanvas = await page.evaluate(() => {
      const el = document.querySelector('idle-screen');
      const surface = el?.shadowRoot?.querySelector('.surface');
      return !!surface?.querySelector('canvas');
    });
    expect(hasCanvas, 'canvas element should exist in the surface').toBe(true);

    // Wait for the saver to render some frames then sample pixels via the Worker
    await page.waitForTimeout(2_000);
    const hasContent = await page.evaluate(() => {
      const el = document.querySelector('idle-screen') as HTMLElement & {
        sampleWorkerPixels?: () => Promise<boolean>;
      };
      return el?.sampleWorkerPixels?.() ?? false;
    });
    expect(hasContent, `${saver} Worker should have rendered visible content`).toBe(true);

    expect(errors, `no errors during Worker render of ${saver}`).toEqual([]);
  });
}

for (const saver of MAIN_THREAD_SAVERS) {
  test(`non-worker saver (${saver}) stays on main thread`, async ({ page }) => {
    await page.goto(`/?saver=${saver}`);
    await page.waitForFunction(() => !!window.__idleScreens);
    await page.evaluate(() => window.__idleScreens!.sleep());
    await expect
      .poll(() => page.evaluate(() => window.__idleScreens?.active()), { timeout: 8_000 })
      .toBe(saver);

    const isWorker = await page.evaluate(() => {
      const el = document.querySelector('idle-screen') as HTMLElement & { isWorker?: boolean };
      return el?.isWorker ?? false;
    });
    expect(isWorker, `${saver} should NOT be in a Worker`).toBe(false);
  });
}

test('forceRafPolyfill: Worker renders with setTimeout polyfill', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('/?saver=warp&forcePolyfill=1');
  await page.waitForFunction(() => !!window.__idleScreens);
  await page.evaluate(() => window.__idleScreens!.sleep());
  await expect
    .poll(() => page.evaluate(() => window.__idleScreens?.active()), { timeout: 8_000 })
    .toBe('warp');

  const isWorker = await page.evaluate(() => {
    const el = document.querySelector('idle-screen') as HTMLElement & { isWorker?: boolean };
    return el?.isWorker ?? false;
  });
  expect(isWorker, 'warp should render in a Worker with polyfill').toBe(true);

  await page.waitForTimeout(2_000);
  const hasContent = await page.evaluate(() => {
    const el = document.querySelector('idle-screen') as HTMLElement & {
      sampleWorkerPixels?: () => Promise<boolean>;
    };
    return el?.sampleWorkerPixels?.() ?? false;
  });
  expect(hasContent, 'polyfill-driven Worker should have rendered visible content').toBe(true);

  expect(errors, 'no errors during polyfill Worker render').toEqual([]);
});

test('worker resize: viewport change while asleep forwards resize to Worker', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('/?saver=warp');
  await page.waitForFunction(() => !!window.__idleScreens);
  await page.evaluate(() => window.__idleScreens!.sleep());
  await expect
    .poll(() => page.evaluate(() => window.__idleScreens?.active()), { timeout: 8_000 })
    .toBe('warp');

  const isWorker = await page.evaluate(() => {
    const el = document.querySelector('idle-screen') as HTMLElement & { isWorker?: boolean };
    return el?.isWorker ?? false;
  });
  expect(isWorker, 'warp should render in a Worker').toBe(true);

  await page.waitForTimeout(1_000);

  // Resize viewport — triggers the element's debounced resize forwarding
  await page.setViewportSize({ width: 640, height: 480 });
  // Wait for debounce (150ms) + a frame
  await page.waitForTimeout(300);

  // Verify the Worker is still rendering after resize
  const hasContent = await page.evaluate(() => {
    const el = document.querySelector('idle-screen') as HTMLElement & {
      sampleWorkerPixels?: () => Promise<boolean>;
    };
    return el?.sampleWorkerPixels?.() ?? false;
  });
  expect(hasContent, 'Worker should still render content after resize').toBe(true);

  expect(errors, 'no errors during Worker resize').toEqual([]);
});

test('worker reuse: second sleep cycle reuses the cached Worker', async ({ page }) => {
  await page.goto('/?saver=warp');
  await page.waitForFunction(() => !!window.__idleScreens);

  // First sleep cycle
  await page.evaluate(() => window.__idleScreens!.sleep());
  await expect
    .poll(() => page.evaluate(() => window.__idleScreens?.active()), { timeout: 8_000 })
    .toBe('warp');
  const isWorker1 = await page.evaluate(() => {
    const el = document.querySelector('idle-screen') as HTMLElement & { isWorker?: boolean };
    return el?.isWorker ?? false;
  });
  expect(isWorker1, 'first cycle should use Worker').toBe(true);

  // Wake, then sleep again
  await page.evaluate(() => window.__idleScreens!.wake());
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__idleScreens!.sleep());
  await expect
    .poll(() => page.evaluate(() => window.__idleScreens?.active()), { timeout: 8_000 })
    .toBe('warp');

  const isWorker2 = await page.evaluate(() => {
    const el = document.querySelector('idle-screen') as HTMLElement & { isWorker?: boolean };
    return el?.isWorker ?? false;
  });
  expect(isWorker2, 'second cycle should still use Worker').toBe(true);

  // Verify pixel rendering works after reuse
  await page.waitForTimeout(2_000);
  const hasContent = await page.evaluate(() => {
    const el = document.querySelector('idle-screen') as HTMLElement & {
      sampleWorkerPixels?: () => Promise<boolean>;
    };
    return el?.sampleWorkerPixels?.() ?? false;
  });
  expect(hasContent, 'reused Worker should still render content').toBe(true);
});
