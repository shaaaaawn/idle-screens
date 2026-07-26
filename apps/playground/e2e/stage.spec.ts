import { test, expect } from '@playwright/test';

/**
 * The stage system: passthrough savers in the Dev Tools viewport perform on a
 * swappable, deterministic mock document (an iframe), so (stage, seed) always
 * reproduces the identical performance — and the saver's page mutations land
 * on the STAGE, never on the workbench.
 */
test.describe('passthrough stages', () => {
  test('a passthrough saver mounts onto the default article stage and deforms it', async ({ page }) => {
    await page.goto('/#dev');
    await page.waitForFunction(() => !!window.__idleScreens);
    await page.evaluate(() => {
      const item = document.querySelector<HTMLButtonElement>('#dock-left .palette-item[data-id="catwalk"]');
      item?.closest('details')?.setAttribute('open', '');
      item?.click();
    });

    const frame = page.frameLocator('iframe.stage-frame');
    await expect(frame.locator('h1')).toHaveText('On the Quiet Machinery of Attention');

    // The timeline auto-plays; within a few seconds a landing must spring a
    // stage block — and only stage blocks, never the workbench's own DOM.
    await expect
      .poll(
        () =>
          page
            .frameLocator('iframe.stage-frame')
            .locator('main :is(h1,h2,p,li,img)')
            .evaluateAll((els) => els.filter((e) => (e as HTMLElement).style.transform.startsWith('translateY')).length),
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);
    const workbenchTouched = await page.evaluate(
      () => document.querySelectorAll('#topbar [style*="translateY"], #dock-left [style*="translateY"]').length,
    );
    expect(workbenchTouched, 'the workbench itself is never a victim').toBe(0);
  });

  test('swapping the stage swaps the landscape the saver performs on', async ({ page }) => {
    await page.goto('/#dev');
    await page.waitForFunction(() => !!window.__idleScreens);
    await page.evaluate(() => {
      const item = document.querySelector<HTMLButtonElement>('#dock-left .palette-item[data-id="catwalk"]');
      item?.closest('details')?.setAttribute('open', '');
      item?.click();
    });
    await expect(page.locator('iframe.stage-frame')).toBeVisible();

    await page.selectOption('#stage-pick', 'dashboard');
    await expect(page.frameLocator('iframe.stage-frame').locator('h1')).toHaveText('Fleet overview');

    // The choice survives a reload — repeatability includes the setup.
    await page.reload();
    await page.waitForFunction(() => !!window.__idleScreens);
    await expect(page.locator('#stage-pick')).toHaveValue('dashboard');
  });

  test('the Layers panel shows the composition stack, and the page deck solos off', async ({ page }) => {
    await page.goto('/#dev');
    await page.waitForFunction(() => !!window.__idleScreens);
    await page.evaluate(() => {
      const item = document.querySelector<HTMLButtonElement>('#dock-left .palette-item[data-id="catwalk"]');
      item?.closest('details')?.setAttribute('open', '');
      item?.click();
    });
    await expect(page.locator('iframe.stage-frame')).toBeVisible();
    await expect(page.locator('.layers-runtime')).toContainText('PAGE');
    await expect(page.locator('.layers-runtime')).toContainText('SURFACE');
    await expect(page.locator('.layers-runtime')).toContainText('PASS');

    // Toggling the page deck hides the stage content but never the saver —
    // the classic compositor "solo the overlay" move.
    await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.layers-runtime > div'));
      rows.find((r) => r.textContent?.includes('PAGE'))?.querySelector('button')?.click();
    });
    const frame = page.frameLocator('iframe.stage-frame');
    await expect
      .poll(() => frame.locator('body').evaluate((b) => b.style.visibility))
      .toBe('hidden');
    await expect
      .poll(() => frame.locator('#stage-saver-overlay canvas').evaluate((c) => getComputedStyle(c).visibility))
      .toBe('visible');
  });

  test('non-passthrough savers keep the plain void (no stage, no picker)', async ({ page }) => {
    await page.goto('/#dev');
    await page.waitForFunction(() => !!window.__idleScreens);
    await page.evaluate(() => {
      const item = document.querySelector<HTMLButtonElement>('#dock-left .palette-item[data-id="warp"]');
      item?.closest('details')?.setAttribute('open', '');
      item?.click();
    });
    await expect(page.locator('#viewport-host canvas')).toBeVisible();
    await expect(page.locator('iframe.stage-frame')).toHaveCount(0);
    await expect(page.locator('#stage-pick')).toBeHidden();
  });
});
