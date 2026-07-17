import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window {
    __idleScreens?: { active(): string | null; menuOpen(): boolean; state(): string };
  }
}

const active = (page: Page) => page.evaluate(() => window.__idleScreens?.active() ?? null);

async function pickSaver(page: Page, id: string): Promise<void> {
  await page.waitForSelector(`#dock-left .palette-item[data-id="${id}"]`, { state: 'attached' });
  await page.evaluate((saverId) => {
    const item = document.querySelector(`#dock-left .palette-item[data-id="${saverId}"]`);
    const group = item?.closest('details');
    if (group) (group as HTMLDetailsElement).open = true;
    (item as HTMLButtonElement)?.click();
  }, id);
}

test.describe('gallery view', () => {
  test('default view shows a grid of saver thumbnail cards', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!window.__idleScreens);
    const count = await page.locator('.gallery-card').count();
    expect(count).toBeGreaterThanOrEqual(14);
  });

  test('clicking a gallery card selects and sleeps the saver', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!window.__idleScreens);
    expect(await active(page)).toBe('black-hole');
    await page.locator('.gallery-card[data-id="dvd"]').click();
    await expect.poll(() => active(page)).toBe('dvd');
    await expect(page.locator('.gallery-card[data-id="dvd"]')).toHaveClass(/active/);
  });
});

test.describe('config panel (dev view)', () => {
  test('clicking a saver in the palette rebuilds the engine with the new active saver', async ({ page }) => {
    await page.goto('/#dev');
    await page.waitForFunction(() => !!window.__idleScreens);
    expect(await active(page)).toBe('black-hole');
    await pickSaver(page, 'dvd');
    await expect.poll(() => active(page)).toBe('dvd');
  });

  test('clicking a saver in the palette previews it INLINE in the viewport (not fullscreen)', async ({ page }) => {
    await page.goto('/#dev');
    await page.waitForFunction(() => !!window.__idleScreens);
    await pickSaver(page, 'fish');

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

    const fullscreen = await page.evaluate(() => {
      const d = document.querySelector('idle-screen')?.shadowRoot?.querySelector<HTMLDialogElement>('dialog.frame');
      return { dialogOpen: d?.open ?? false, state: window.__idleScreens!.state() };
    });
    expect(fullscreen.dialogOpen).toBe(false);
    expect(fullscreen.state).toBe('awake');
  });

  test('the panel selection wins over a persisted localStorage plugin (not a black stale saver)', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('idleScreens.plugin', 'messages2'));
    await page.goto('/?saver=fish#dev');
    await page.waitForFunction(() => !!window.__idleScreens);
    expect(await active(page)).toBe('fish');
    await pickSaver(page, 'globe');
    await expect.poll(() => active(page)).toBe('globe');
  });

  test('unchecking ⌘K menu rebuilds with the hotkey disabled', async ({ page }) => {
    await page.goto('/#dev');
    await page.waitForFunction(() => !!window.__idleScreens);
    await page.keyboard.press('ControlOrMeta+KeyK');
    await expect.poll(() => page.evaluate(() => window.__idleScreens?.menuOpen())).toBe(true);
    await page.keyboard.press('ControlOrMeta+KeyK');

    await page.locator('#cfg-menu').uncheck();
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
    await page.goto('/#dev');
    await page.waitForFunction(() => !!window.__idleScreens);
    await page.locator('#cfg-selection').selectOption('rotate');
    await page.waitForFunction(() => !!window.__idleScreens);
    const first = await active(page);
    await page.evaluate(() => window.__idleScreens!.state());
    await page.evaluate(() => (window as unknown as { __idleScreens: { sleep(): void } }).__idleScreens.sleep());
    const afterSleep = await active(page);
    expect(afterSleep).not.toBe(first);
  });
});

test.describe('workbench (web components)', () => {
  test('panels are <wb-dock> custom elements and the mount targets survived the upgrade', async ({ page }) => {
    await page.goto('/#dev');
    await page.waitForFunction(() => !!window.__idleScreens);
    const ok = await page.evaluate(() => {
      const dockIsCustom = document.getElementById('wb-left')?.tagName.toLowerCase() === 'wb-dock';
      const mounts = ['dock-left', 'dock-right', 'dock-bottom'].every(
        (id) => document.getElementById(id)?.closest('.dock-body') !== null,
      );
      return dockIsCustom && mounts;
    });
    expect(ok).toBe(true);
  });

  test('dragging the left splitter resizes the Savers dock', async ({ page }) => {
    await page.goto('/#dev');
    await page.waitForFunction(() => !!window.__idleScreens);
    const leftVar = () =>
      page.evaluate(() =>
        parseFloat(getComputedStyle(document.getElementById('view-dev')!).getPropertyValue('--left')),
      );
    const before = await leftVar();
    const box = (await page.locator('#sp-left').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 90, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    const after = await leftVar();
    expect(after).toBeGreaterThan(before + 50);
  });
});

test.describe('debug panel', () => {
  test('shows capability tier and fps while preview runs', async ({ page }) => {
    await page.goto('/#dev');
    await page.waitForFunction(() => !!window.__idleScreens);
    await expect(page.locator('.dbg-grid .dbg-k', { hasText: 'tier' }).first()).toBeVisible();
    await expect.poll(() => page.locator('.dbg-grid .dbg-v').filter({ hasText: /^(minimal|basic|standard|high)$/ }).count()).toBeGreaterThan(0);
    await expect.poll(() => {
      const fps = page.locator('.dbg-grid .dbg-stat').filter({ has: page.locator('.dbg-k', { hasText: 'fps' }) }).locator('.dbg-v');
      return fps.textContent();
    }).not.toBe('—');
  });
});

test.describe('timeline panel', () => {
  test('black hole shows steer lanes and demo track', async ({ page }) => {
    await page.goto('/#dev');
    await page.waitForFunction(() => !!window.__idleScreens);
    await expect.poll(() => page.locator('.tl-mode').textContent()).toBe('steer');
    await expect(page.locator('.tl-track-info')).toContainText('Black Hole');
    await expect(page.locator('.tl-track-info')).toContainText('6.0s');
    await expect(page.locator('.tl-lane')).toHaveCount(10);
  });

  test('classic savers show a compact live preview timeline', async ({ page }) => {
    await page.goto('/#dev');
    await page.waitForFunction(() => !!window.__idleScreens);
    await pickSaver(page, 'hard-rain');
    await expect.poll(() => page.locator('.tl-mode').textContent()).toBe('live');
    await expect(page.locator('.tl-lane')).toHaveCount(2);
    await expect(page.locator('.tl-lane-label').first()).toHaveText('playback');
  });

  test('selecting a saver auto-plays the timeline preview', async ({ page }) => {
    await page.goto('/#dev');
    await page.waitForFunction(() => !!window.__idleScreens);
    await pickSaver(page, 'hard-rain');
    await expect.poll(() => page.locator('.tl-btn').textContent()).toBe('⏸');
  });

  test('scrubbing the timeline updates black hole steer values', async ({ page }) => {
    await page.goto('/#dev');
    await page.waitForFunction(() => !!window.__idleScreens);
    const lane = page.locator('.tl-lane').filter({ has: page.locator('.tl-lane-label', { hasText: 'diskBrightness' }) });
    await expect(lane).toBeVisible();
    const readVal = () => lane.locator('.tl-lane-value').textContent();

    const area = page.locator('.tl-track-area');
    const box = (await area.boundingBox())!;
    await page.mouse.click(box.x + 8, box.y + box.height * 0.5);
    const atStart = await readVal();

    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    const atMid = await readVal();

    expect(atStart).not.toBe(atMid);
  });
});

test.describe('dev API docs', () => {
  test('docs tab renders API reference from catalog', async ({ page }) => {
    await page.goto('/#docs');
    await page.waitForFunction(() => !!window.__idleScreens);
    await expect(page.locator('#docs-main h1')).toHaveText('Dev API');
    await expect(page.locator('#docs-main')).toContainText('window.__idleScreens');
    await expect(page.locator('#docs-main')).toContainText('window.__caps');
    await expect(page.locator('#docs-main')).toContainText('window.__schema');
    await expect(page.locator('#docs-main')).toContainText('dev-api-catalog.ts');
    await expect(page.locator('#topbar nav a[data-view="docs"]')).toHaveClass(/active/);
  });

  test('toc links stay on docs view and scroll to section', async ({ page }) => {
    await page.goto('/#docs');
    await page.waitForFunction(() => !!window.__idleScreens);
    await page.locator('.dev-docs-toc a[href="#docs/api-caps"]').click();
    await expect(page).toHaveURL(/#docs\/api-caps/);
    await expect(page.locator('#view-docs')).toBeVisible();
    await expect(page.locator('#topbar nav a[data-view="docs"]')).toHaveClass(/active/);
    await expect(page.locator('#api-caps')).toBeInViewport();
  });
});
