import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window {
    __idleScreens?: { active(): string | null; menuOpen(): boolean; state(): string };
  }
}

const active = (page: Page) => page.evaluate(() => window.__idleScreens?.active() ?? null);

test.describe('config panel', () => {
  test('clicking a saver in the palette rebuilds the engine with the new active saver', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!window.__idleScreens);
    expect(await active(page)).toBe('black-hole');
    await page.locator('#dock-left .palette-item[data-id="dvd"]').click();
    await expect.poll(() => active(page)).toBe('dvd');
  });

  test('clicking a saver in the palette previews it INLINE in the viewport (not fullscreen)', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!window.__idleScreens);
    await page.locator('#dock-left .palette-item[data-id="fish"]').click();

    // it renders into the viewport host (canvas OR DOM saver), palette item active
    await expect.poll(() =>
      page.evaluate(() => {
        const host = document.getElementById('viewport-host');
        return (
          !!host?.classList.contains('active') &&
          host.querySelectorAll(':scope > :not(#viewport-label)').length > 0
        );
      }),
    ).toBe(true);
    await expect(page.locator('#dock-left .palette-item[data-id="fish"]')).toHaveClass(/active/);

    // and it did NOT go fullscreen (the saver overlay dialog is closed, engine awake)
    const fullscreen = await page.evaluate(() => {
      const d = document.querySelector('idle-screen')?.shadowRoot?.querySelector<HTMLDialogElement>('dialog.frame');
      return { dialogOpen: d?.open ?? false, state: window.__idleScreens!.state() };
    });
    expect(fullscreen.dialogOpen).toBe(false);
    expect(fullscreen.state).toBe('awake');
  });

  test('the panel selection wins over a persisted localStorage plugin (not a black stale saver)', async ({ page }) => {
    // Seed a previously-chosen (dark) saver, as if picked earlier. The engine restores
    // localStorage on construct; the panel/URL selection must override it, otherwise the
    // user picks "fish" and silently gets the stored saver — often a black screen.
    await page.addInitScript(() => localStorage.setItem('idleScreens.plugin', 'messages2'));
    await page.goto('/?saver=fish');
    await page.waitForFunction(() => !!window.__idleScreens);
    expect(await active(page)).toBe('fish'); // URL wins over the stored 'messages2'
    await page.locator('#dock-left .palette-item[data-id="globe"]').click();
    await expect.poll(() => active(page)).toBe('globe'); // palette wins too
  });

  test('unchecking ⌘K menu rebuilds with the hotkey disabled', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!window.__idleScreens);
    // enabled by default: hotkey opens the menu
    await page.keyboard.press('ControlOrMeta+KeyK');
    await expect.poll(() => page.evaluate(() => window.__idleScreens?.menuOpen())).toBe(true);
    await page.keyboard.press('ControlOrMeta+KeyK'); // close

    await page.locator('#cfg-menu').uncheck(); // rebuild with configMenu:false
    await page.waitForFunction(() => !!window.__idleScreens);
    await page.keyboard.press('ControlOrMeta+KeyK');
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.__idleScreens?.menuOpen())).toBe(false);
    const hasMenu = await page.evaluate(
      () => !!document.querySelector('idle-screen')?.shadowRoot?.querySelector('dialog.menu'),
    );
    expect(hasMenu).toBe(false);
  });

  test('changing selection to rotate advances the saver each sleep', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!window.__idleScreens);
    await page.locator('#cfg-selection').selectOption('rotate');
    await page.waitForFunction(() => !!window.__idleScreens);
    const first = await active(page);
    await page.evaluate(() => window.__idleScreens!.state()); // no-op read
    await page.evaluate(() => (window as unknown as { __idleScreens: { sleep(): void } }).__idleScreens.sleep());
    const afterSleep = await active(page);
    expect(afterSleep).not.toBe(first); // rotated to the next saver
  });
});

test.describe('workbench (web components)', () => {
  test('panels are <wb-dock> custom elements and the mount targets survived the upgrade', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!window.__idleScreens);
    const ok = await page.evaluate(() => {
      const dockIsCustom = document.getElementById('wb-left')?.tagName.toLowerCase() === 'wb-dock';
      // wb-dock moves its children into a .dock-body; the mount ids must still resolve
      const mounts = ['dock-left', 'dock-right', 'dock-bottom'].every(
        (id) => document.getElementById(id)?.closest('.dock-body') !== null,
      );
      return dockIsCustom && mounts;
    });
    expect(ok).toBe(true);
  });

  test('dragging the left splitter resizes the Savers dock', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!window.__idleScreens);
    const leftVar = () =>
      page.evaluate(() =>
        parseFloat(getComputedStyle(document.getElementById('workbench')!).getPropertyValue('--left')),
      );
    const before = await leftVar();
    const box = (await page.locator('#sp-left').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 90, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    const after = await leftVar();
    expect(after).toBeGreaterThan(before + 50); // dock grew
  });
});

test.describe('determinism demo', () => {
  const verdictClass = (page: Page) =>
    page.locator('#det-verdict').getAttribute('class');

  test('same seed → identical; desync → different; re-sync → identical', async ({ page }) => {
    await page.goto('/');
    await expect.poll(() => verdictClass(page)).toContain('same');

    await page.locator('#det-desync').check();
    await expect.poll(() => verdictClass(page)).toContain('diff');

    await page.locator('#det-desync').uncheck();
    await expect.poll(() => verdictClass(page)).toContain('same');
  });

  test('scrubbing t changes the rendered frame but keeps A and B identical', async ({ page }) => {
    await page.goto('/');
    await expect.poll(() => verdictClass(page)).toContain('same');
    const capBefore = await page.locator('#det-capa').textContent();

    await page.locator('#det-t').fill('3200');
    await page.locator('#det-t').dispatchEvent('input');

    await expect.poll(() => page.locator('#det-capa').textContent()).not.toBe(capBefore);
    expect(await verdictClass(page)).toContain('same'); // still identical across A/B
    expect(await page.locator('#det-capa').textContent()).toContain('t 3200');
  });

  test('the two frames actually differ across seeds (real pixels, not a stub)', async ({ page }) => {
    await page.goto('/');
    await expect.poll(() => verdictClass(page)).toContain('same');
    const hashSame = (await page.locator('#det-capa').textContent())?.split('·').pop()?.trim();
    await page.locator('#det-seed').fill('7');
    await page.locator('#det-seed').dispatchEvent('change');
    await expect
      .poll(() => page.locator('#det-capa').textContent().then((t) => t?.split('·').pop()?.trim()))
      .not.toBe(hashSame); // different seed → different pixels → different hash
  });
});
