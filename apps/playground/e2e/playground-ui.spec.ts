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

const previewOpen = (page: Page) =>
  page.evaluate(() => document.body.classList.contains('pv-open') && !document.getElementById('stage')!.hidden);

test.describe('gallery view', () => {
  test('default view shows a grid of saver thumbnail cards', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!window.__idleScreens);
    const count = await page.locator('.gallery-card').count();
    expect(count).toBeGreaterThanOrEqual(14);
  });

  test('clicking a gallery card selects the saver and opens the fullscreen preview', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!window.__idleScreens);
    expect(await active(page)).toBe('black-hole');
    await page.locator('.gallery-card[data-id="dvd"]').click();
    await expect.poll(() => active(page)).toBe('dvd');
    await expect(page.locator('.gallery-card[data-id="dvd"]')).toHaveClass(/active/);
    await expect.poll(() => previewOpen(page)).toBe(true);
    await expect(page.locator('.pv-name')).toHaveText('DVD Bouncing Logo');
    // The preview is a VIEWER, not the screensaver: the engine stays awake.
    expect(await page.evaluate(() => window.__idleScreens!.state())).toBe('awake');
  });

  test('the preview survives mouse movement and exits on Escape', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!window.__idleScreens);
    await page.locator('.gallery-card[data-id="dvd"]').click();
    await expect.poll(() => previewOpen(page)).toBe(true);

    // This is the whole point of the overlay: pointer movement must not dismiss.
    for (const [x, y] of [[200, 200], [640, 380], [900, 150], [420, 500]] as const) {
      await page.mouse.move(x, y, { steps: 8 });
    }
    await page.waitForTimeout(150);
    expect(await previewOpen(page)).toBe(true);

    await page.keyboard.press('Escape');
    await expect.poll(() => previewOpen(page)).toBe(false);
  });

  test('the preview exits on a click, but not on the click that opened it', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!window.__idleScreens);
    await page.locator('.gallery-card[data-id="globe"]').click();
    await expect.poll(() => previewOpen(page)).toBe(true);
    await page.waitForTimeout(150); // opening gesture is over; overlay is armed
    expect(await previewOpen(page)).toBe(true);

    await page.mouse.click(640, 420);
    await expect.poll(() => previewOpen(page)).toBe(false);
  });

  test('arrow keys step through savers without leaving the preview', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!window.__idleScreens);
    // Don't hardcode the catalogue size — it grows every time a saver lands.
    const total = await page.locator('.gallery-card').count();
    await page.locator('.gallery-card[data-id="black-hole"]').click();
    await expect(page.locator('.pv-pos')).toHaveText(`1 / ${total}`);

    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.pv-pos')).toHaveText(`2 / ${total}`);
    expect(await previewOpen(page)).toBe(true);

    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.pv-pos')).toHaveText(`1 / ${total}`);
  });

  test('the idle screensaver does not fire on top of an open preview', async ({ page }) => {
    // 1500ms, not 600: boot + first click has to finish before the timer can
    // fire, or the engine sleeps before the preview is even open.
    await page.goto('/?timeout=1500');
    await page.waitForFunction(() => !!window.__idleScreens);
    await page.locator('.gallery-card[data-id="dvd"]').click();
    await expect.poll(() => previewOpen(page)).toBe(true);
    expect(await page.evaluate(() => window.__idleScreens!.state())).toBe('awake');

    await page.waitForTimeout(2600); // well past the idle timeout
    expect(await page.evaluate(() => window.__idleScreens!.state())).toBe('awake');
    expect(await previewOpen(page)).toBe(true);

    // ...and it resumes sleeping normally once the preview is dismissed.
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => window.__idleScreens!.state()), { timeout: 5000 }).toBe('sleeping');
  });

  test('offscreen cards are paused and resume as they scroll into view', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!window.__idleScreens);

    const top = page.locator('.gallery-card[data-id="black-hole"]');
    const last = page.locator('.gallery-card').last();

    // On load: the first card runs, the bottom of the list does not.
    await expect(top).toHaveAttribute('data-playing', 'true');
    await expect(last).toHaveAttribute('data-playing', 'false');

    await last.scrollIntoViewIfNeeded();
    await expect(last).toHaveAttribute('data-playing', 'true');
    await expect(top).toHaveAttribute('data-playing', 'false');
  });

  test('opening the preview pauses the grid behind it, and closing resumes it', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!window.__idleScreens);
    const top = page.locator('.gallery-card[data-id="black-hole"]');
    await expect(top).toHaveAttribute('data-playing', 'true');

    await page.locator('.gallery-card[data-id="dvd"]').click();
    await expect(top).toHaveAttribute('data-playing', 'false');

    await page.keyboard.press('Escape');
    await expect(top).toHaveAttribute('data-playing', 'true');
  });

  test('the preview blocks tabbing into the page behind it', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!window.__idleScreens);
    await page.locator('.gallery-card[data-id="dvd"]').click();
    await expect.poll(() => previewOpen(page)).toBe(true);

    for (let i = 0; i < 6; i += 1) await page.keyboard.press('Tab');
    const inOverlay = await page.evaluate(
      () => !!document.activeElement?.closest('#stage') || document.activeElement === document.body,
    );
    expect(inOverlay).toBe(true);
  });

  test('the filter narrows the grid and hides empty package sections', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!window.__idleScreens);
    await page.locator('#gallery-search').fill('rain');
    await expect(page.locator('.gallery-card:not([hidden])')).toHaveCount(3);
    await expect(page.locator('.gal-section[data-group="saver-black-hole"]')).toBeHidden();

    await page.locator('#gallery-search').fill('');
    await expect(page.locator('.gal-section[data-group="saver-black-hole"]')).toBeVisible();
  });

  test('the card shortcut hands the saver off to Dev Tools', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!window.__idleScreens);
    await page.locator('.gallery-card[data-id="globe"] .gallery-card-dev').click();
    await expect(page).toHaveURL(/#dev/);
    await expect(page.locator('#dock-left .palette-item[data-id="globe"]')).toHaveClass(/active/);
    await expect.poll(() => active(page)).toBe('globe');
  });
});

test.describe('saver outliner (dev view)', () => {
  test('the filter narrows the tree and hides empty groups', async ({ page }) => {
    await page.goto('/#dev');
    await page.waitForFunction(() => !!window.__idleScreens);
    await page.locator('#palette-search').fill('rain');
    await expect(page.locator('#dock-left .palette-item:not([hidden])')).toHaveCount(3);
    await expect(page.locator('#dock-left .palette-group').first()).toBeHidden();
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

test.describe('evals view', () => {
  test('only one mode panel lays out at a time', async ({ page }) => {
    await page.goto('/#evals');
    await page.waitForFunction(() => !!document.querySelector('.evals-shell'));
    // Both modes used to render stacked because `.evals-body { display: grid }`
    // outranks [hidden], producing a ~3800px column inside an overflow:hidden box.
    await expect(page.locator('.evals-body')).toHaveCount(1);
    const h = await page.evaluate(
      () => document.querySelector('.evals-shell')!.getBoundingClientRect().height,
    );
    expect(h).toBeLessThan(page.viewportSize()!.height + 2);
  });

  test('the benchmark rubric is stated up front, not hidden behind a run', async ({ page }) => {
    await page.goto('/#evals');
    await page.waitForFunction(() => !!document.querySelector('.evals-tile'));
    await expect(page.locator('.evals-intent-title')).toContainText('shared intent');
    await expect(page.locator('.evals-check-chip').first()).toBeVisible();
    // Inspector defaults to Test and is populated without pressing "New run".
    await expect(page.locator('.insp-tab.active')).toHaveText('Test');
    await expect(page.locator('.insp-body')).toContainText('Hypothesis');
  });

  test('score decomposes into weighted terms with measured vs wanted', async ({ page }) => {
    await page.goto('/#evals');
    await page.waitForFunction(() => !!document.querySelector('.evals-tile'));
    await page.locator('.insp-tab[data-tab="score"]').click();
    await expect(page.locator('.insp-score')).toHaveText(/^0\.\d{3}$/);
    await expect(page.locator('.insp-body')).toContainText('perception · ×0.35');
    await expect(page.locator('.insp-term-detail').first()).toContainText('measured');
    await expect(page.locator('.insp-term-detail').first()).toContainText('wanted');
  });

  test('perception shows the braille map the scores are built on', async ({ page }) => {
    await page.goto('/#evals');
    await page.waitForFunction(() => !!document.querySelector('.evals-tile'));
    await page.locator('.insp-tab[data-tab="perception"]').click();
    const braille = page.locator('.insp-braille');
    await expect(braille).toBeVisible();
    expect((await braille.textContent())!.length).toBeGreaterThan(200);
    await expect(page.locator('.insp-body')).toContainText('Coverage');
  });

  test('by-artist is a gallery of that artist’s work, grouped by kind', async ({ page }) => {
    await page.goto('/#evals');
    await page.waitForFunction(() => !!document.querySelector('.evals-tile'));
    await page.locator('.evals-mode-btn[data-mode="artist"]').click();
    await expect(page.locator('.evals-grid-label')).toHaveText([
      'Benchmarks — shared intents',
      'Signatures — artist-owned',
    ]);
    expect(await page.locator('.evals-tile').count()).toBeGreaterThan(5);
    // Same card component as compare mode — one interaction model everywhere.
    await expect(page.locator('.evals-tile').first()).toHaveAttribute('data-screen-id', /.+/);
  });

  test('a new run scores every tile, lands on the timeline, and keeps its provenance line', async ({ page }) => {
    await page.goto('/#evals');
    await page.waitForFunction(() => !!document.querySelector('.evals-tile'));
    const runNodes = page.locator('.evals-tl-node:not(.evals-tl-slot)');
    const before = await runNodes.count();

    await page.locator('[data-act="new-run"]').click();
    await page.locator('.evals-modal [name="label"]').fill('e2e run');
    await page.locator('.evals-modal [name="note"]').fill('regression coverage');
    await page.locator('.evals-modal').evaluate((f: HTMLFormElement) => f.requestSubmit());

    await expect(runNodes).toHaveCount(before + 1);
    // Scores reach the grid: every tile picks up its number.
    await expect(page.locator('.evals-tile-meta').first()).toContainText(/·\s\d\.\d{2}/);
    // renderGrid rewrites the subtitle, so applyRun has to set provenance AFTER it.
    await expect(page.locator('[data-role="subtitle"]')).toContainText('e2e run');
    await expect(page.locator('[data-role="subtitle"]')).toContainText('median');
    await expect(page.locator('[data-act="export"]')).toBeEnabled();
  });

  // Mock OpenRouter so CI never depends on the network. A fake, non-secret
  // placeholder stands in for a key — no real credential is ever used here.
  const FAKE_KEY = 'sk-or-v1-FAKE000000000000000000000000000000000000000000000000000abcd';
  const mockOpenRouter = async (page: Page) => {
    await page.route('https://openrouter.ai/api/v1/models', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            { id: 'anthropic/claude-opus-4', name: 'Claude Opus 4', context_length: 200000 },
            { id: 'openai/gpt-5', name: 'GPT-5', context_length: 400000 },
          ],
        }),
      }),
    );
    await page.route('https://openrouter.ai/api/v1/key', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ data: { label: 'evals', usage: 1.5, limit: 10 } }),
      }),
    );
  };

  const openRunDialog = async (page: Page) => {
    await page.goto('/#evals');
    await page.waitForFunction(() => !!document.querySelector('.evals-tile'));
    await page.locator('[data-act="new-run"]').click();
    await expect(page.locator('.evals-modal')).toBeVisible();
  };

  test('the model picker loads OpenRouter models and derives the provider', async ({ page }) => {
    await mockOpenRouter(page);
    await openRunDialog(page);

    await expect(page.locator('[data-role="model-hint"]')).toContainText('2 models');
    await expect(page.locator('#or-model-list option')).toHaveCount(2);

    await page.locator('input[name="model"]').fill('anthropic/claude-opus-4');
    // Provider is derived from the canonical id, never typed a second time.
    await expect(page.locator('input[name="provider"]')).toHaveValue('anthropic');
    await expect(page.locator('input[name="provider"]')).toHaveAttribute('readonly', '');
  });

  test('the API key is stored client-side and never reaches the run record', async ({ page }) => {
    await mockOpenRouter(page);
    await openRunDialog(page);

    const keyField = page.locator('[data-role="or-key"]');
    await expect(keyField).toHaveAttribute('type', 'password');
    // No name= means FormData cannot carry it into RunRequest by accident.
    expect(await keyField.evaluate((el) => el.hasAttribute('name'))).toBe(false);
    await expect(page.locator('[data-role="conn-state"]')).toHaveText('not set');

    await page.locator('.evals-conn > summary').click();
    await keyField.fill(FAKE_KEY);
    await page.locator('[data-act="key-save"]').click();

    // Stored, masked, and the field is cleared so it can't be shoulder-read.
    await expect(page.locator('[data-role="conn-state"]')).toContainText('stored');
    await expect(page.locator('[data-role="conn-state"]')).not.toContainText('FAKE000');
    await expect(keyField).toHaveValue('');
    expect(
      await page.evaluate(() => localStorage.getItem('idleScreens.evals.openrouterKey')),
    ).toBe(FAKE_KEY);

    await page.locator('[data-act="key-verify"]').click();
    await expect(page.locator('[data-role="conn-msg"]')).toContainText('Key valid');

    // Submit a run, then prove the key is in exactly one place and no run record.
    await page.locator('.evals-modal [name="label"]').fill('key isolation');
    await page.locator('input[name="model"]').fill('openai/gpt-5');
    await page.locator('.evals-modal').evaluate((f: HTMLFormElement) => f.requestSubmit());
    await expect(page.locator('[data-role="subtitle"]')).toContainText('key isolation');
    await expect(page.locator('[data-role="subtitle"]')).toContainText('openai/gpt-5');

    const leaks = await page.evaluate((needle) => {
      const hits: string[] = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i)!;
        if ((localStorage.getItem(k) ?? '').includes(needle)) hits.push(k);
      }
      return hits;
    }, 'FAKE000');
    expect(leaks).toEqual(['idleScreens.evals.openrouterKey']);

    // Reopening shows the key as already stored; clearing removes it.
    await page.locator('[data-act="new-run"]').click();
    await page.locator('.evals-conn > summary').click();
    await expect(page.locator('[data-role="conn-state"]')).toContainText('stored');
    await page.locator('[data-act="key-clear"]').click();
    await expect(page.locator('[data-role="conn-state"]')).toHaveText('not set');
    expect(await page.evaluate(() => localStorage.getItem('idleScreens.evals.openrouterKey'))).toBeNull();
  });

  test('an unreachable OpenRouter degrades to free text instead of blocking', async ({ page }) => {
    await page.route('https://openrouter.ai/api/v1/models', (route) => route.abort());
    await openRunDialog(page);
    await expect(page.locator('[data-role="model-hint"]')).toContainText('Could not reach OpenRouter');
    // The run is still submittable with a typed model name.
    await page.locator('input[name="model"]').fill('local/handwritten');
    await expect(page.locator('input[name="provider"]')).toHaveValue('local');
  });

  /** Submit the run dialog and return the id of the run it created. */
  const submitRun = async (page: Page, label: string, model?: string) => {
    await page.locator('[data-act="new-run"]').click();
    await page.locator('.evals-modal [name="label"]').fill(label);
    if (model) {
      await page.locator('input[name="model"]').fill(model);
      await page.locator('input[name="model"]').dispatchEvent('input');
    }
    await page.locator('.evals-modal').evaluate((f: HTMLFormElement) => f.requestSubmit());
    await expect(page.locator('[data-role="subtitle"]')).toContainText(label);
    return page.evaluate(
      () => (JSON.parse(localStorage.getItem('idle-screens:style-eval:run-index')!) as Array<{ runId: string }>)[0]!.runId,
    );
  };

  test('the version strip records what produced the run', async ({ page }) => {
    await mockOpenRouter(page);
    await openRunDialog(page);
    await page.locator('.evals-modal [data-act="cancel"]').click();
    await submitRun(page, 'versioned', 'anthropic/claude-opus-4');

    const chips = page.locator('.evals-ver-chip');
    await expect(chips.filter({ hasText: 'model' })).toContainText('anthropic/claude-opus-4');
    await expect(chips.filter({ hasText: 'harness' })).toContainText('playground-ui');
    await expect(chips.filter({ hasText: 'SaverSpec format' })).toContainText('v1');
    // The package version is a distinct axis from the format number: perceive /
    // advise semantics can move while schemaVersion stays 1.
    await expect(chips.filter({ hasText: 'schema pkg' })).toContainText(/\d+\.\d+\.\d+/);
    await expect(chips.filter({ hasText: 'Scorer' })).toContainText('style-eval-score@');

    // Nothing drifted, so no banner.
    await expect(page.locator('[data-role="drift"]')).toBeHidden();
  });

  test('a run fingerprints every screen it scored', async ({ page }) => {
    await openRunDialog(page);
    await page.locator('.evals-modal [data-act="cancel"]').click();
    const runId = await submitRun(page, 'fingerprinted');

    const stored = await page.evaluate(
      (id) => JSON.parse(localStorage.getItem('idle-screens:style-eval:run:' + id)!),
      runId,
    );
    // The property that matters: every screen on screen has a recorded
    // fingerprint, so drift can be resolved per tile rather than run-wide.
    const visibleIds = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.evals-tile')].map((t) => t.dataset.screenId!),
    );
    expect(visibleIds.length).toBeGreaterThan(0);
    for (const id of visibleIds) expect(stored.summary.screenFingerprints[id]).toMatch(/^[0-9a-f]{8}$/);
    // ...and the whole catalogue is covered, not just the visible benchmark.
    expect(Object.keys(stored.summary.screenFingerprints).length).toBeGreaterThan(visibleIds.length);
    expect(stored.summary.provenance.versions.schemaPackage).toMatch(/\d+\.\d+\.\d+/);
  });

  test('a run scored against older versions is marked, not silently shown as current', async ({ page }) => {
    await openRunDialog(page);
    await page.locator('.evals-modal [data-act="cancel"]').click();
    const runId = await submitRun(page, 'aged run');

    // Simulate the catalogue evolving after the run was taken.
    await page.evaluate((id) => {
      const k = 'idle-screens:style-eval:run:' + id;
      const stored = JSON.parse(localStorage.getItem(k)!);
      const targets = Object.keys(stored.summary.screenFingerprints)
        .filter((s: string) => s.includes('calm-horizon'))
        .slice(0, 3);
      for (const t of targets) stored.summary.screenFingerprints[t] = 'deadbeef';
      stored.summary.provenance.versions.styleDnaHash = '00000001';
      stored.summary.provenance.versions.schemaPackage = '0.0.1';
      localStorage.setItem(k, JSON.stringify(stored));
    }, runId);

    await page.reload();
    await page.waitForFunction(() => !!document.querySelector('.evals-tile'));
    await page.locator(`.evals-tl-node[data-run-id="${runId}"]`).click();

    // Drifted versions are called out on the chips...
    await expect(page.locator('.evals-ver-chip.is-drift')).toHaveCount(2);
    // ...the banner says what is actually on screen...
    await expect(page.locator('.evals-tl-drift-text')).toContainText("Showing today's screens");
    await expect(page.locator('.evals-tl-drift-text')).toContainText('3 screens changed');
    await expect(page.locator('[data-act="rescore"]')).toBeVisible();
    // ...and the affected tiles carry it, because their score badge is stale.
    await expect(page.locator('.evals-tile[data-drift="changed"]')).toHaveCount(3);
    await expect(page.locator('.evals-tile-drift').first()).toHaveText('changed since scored');
  });

  test('runs predating fingerprints report unknown rather than crashing', async ({ page }) => {
    await page.goto('/#evals');
    await page.waitForFunction(() => !!document.querySelector('.evals-tile'));
    // The disk baseline has no screenFingerprints and no schemaPackage.
    await page.locator('.evals-tl-node').first().click();
    await expect(page.locator('.evals-ver-chip').filter({ hasText: 'schema pkg' })).toContainText(
      'not recorded',
    );
    await expect(page.locator('.evals-tl-drift-text')).toContainText('predates per-screen fingerprints');
    await expect(page.locator('.evals-tile').first()).toBeVisible();
  });

  test('the chamber closes when the route changes', async ({ page }) => {
    await page.goto('/#evals');
    await page.waitForFunction(() => !!document.querySelector('.evals-tile'));
    await page.locator('[data-act="chamber"]').click();
    await expect(page.locator('#evals-chamber')).toBeVisible();

    // The host router has no handle on this overlay; a stranded chamber also
    // leaves #topbar inert and the idle screensaver suppressed.
    await page.goto('/#dev');
    await expect(page.locator('#evals-chamber')).toBeHidden();
    expect(await page.evaluate(() => document.getElementById('topbar')!.inert)).toBe(false);
  });

  test('a selected tile steps into the chamber, and Escape leaves', async ({ page }) => {
    await page.goto('/#evals');
    await page.waitForFunction(() => !!document.querySelector('.evals-tile'));
    // The first tile is already selected on load, so use a second one to
    // exercise both steps: one click selects, the next enters.
    const tile = page.locator('.evals-tile').nth(1);
    await tile.click();
    await expect(tile).toHaveClass(/active/);
    await expect(page.locator('#evals-chamber')).toBeHidden();

    await tile.click();
    await expect(page.locator('#evals-chamber')).toBeVisible();
    await expect(page.locator('.ch-strip-item')).toHaveCount(15);
    await expect(page.locator('.ch-pos')).toHaveText('2 / 15'); // entered on the 2nd artist

    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.ch-pos')).toHaveText('3 / 15');

    await page.keyboard.press('Escape');
    await expect(page.locator('#evals-chamber')).toBeHidden();
  });
});

test.describe('right dock panels', () => {
  // <details> wraps its content in an anonymous box, so the old
  // `flex: 1 1 auto; min-height: 0` never shrank a panel body — it overflowed
  // its panel and got clipped, hiding whatever sat at the bottom (the Engine
  // action buttons, the Layers "+ Add Layer" button).
  const openOnly = async (page: Page, names: string[]) =>
    page.evaluate((want) => {
      for (const p of document.querySelectorAll<HTMLDetailsElement>('#dock-right .wb-panel')) {
        p.open = want.includes(p.querySelector('.wb-panel-head')!.textContent ?? '');
      }
    }, names);

  const fits = (page: Page, label: string) =>
    page.evaluate((name) => {
      const panel = [...document.querySelectorAll<HTMLDetailsElement>('#dock-right .wb-panel')].find(
        (p) => p.querySelector('.wb-panel-head')!.textContent === name,
      )!;
      const body = panel.querySelector('.wb-panel-body')!;
      const p = panel.getBoundingClientRect();
      const b = body.getBoundingClientRect();
      return { withinPanel: b.bottom <= p.bottom + 1 && b.top >= p.top - 1, bodyH: b.height };
    }, label);

  const ALL = ['Properties', 'Engine', 'Layers', 'Perception', 'Debug'];

  test('every panel body stays inside its panel instead of overflowing', async ({ page }) => {
    await page.goto('/?saver=snowfall#dev');
    await page.waitForFunction(() => !!window.__idleScreens);

    // Worst case: all five open at once, so each gets a small share of the
    // column and every body has to actually shrink.
    await openOnly(page, ALL);
    for (const name of ALL) {
      const r = await fits(page, name);
      expect(r.withinPanel, `${name} body escapes its panel`).toBe(true);
      expect(r.bodyH, `${name} body collapsed`).toBeGreaterThan(40);
    }

    // ...and one at a time, where each body gets the full column.
    for (const name of ALL) {
      await openOnly(page, [name]);
      const r = await fits(page, name);
      expect(r.withinPanel, `${name} body escapes its panel when solo`).toBe(true);
      expect(r.bodyH, `${name} body collapsed when solo`).toBeGreaterThan(80);
    }
  });

  test('the Engine actions and the Layers add button are reachable', async ({ page }) => {
    await page.goto('/?saver=snowfall#dev');
    await page.waitForFunction(() => !!window.__idleScreens);

    await openOnly(page, ['Engine']);
    // Sticky footer: visible without scrolling.
    await expect(page.locator('.wb-actions button', { hasText: 'Preview' })).toBeInViewport();

    await openOnly(page, ['Layers']);
    const add = page.locator('.layers-add');
    await expect(add).toHaveText(/Add Layer/i);
    await add.scrollIntoViewIfNeeded();
    await expect(add).toBeInViewport();
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
    // The two fullscreen surfaces must stay documented — they are easy to confuse.
    await expect(page.locator('#api-surfaces')).toContainText('Preview');
    await expect(page.locator('#api-surfaces')).toContainText('Idle demo');
    await expect(page.locator('#api-surfaces')).toContainText('Esc, or click anywhere outside the chrome bar');
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
