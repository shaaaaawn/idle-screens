import { test, expect } from '@playwright/test';

interface HarnessResult {
  id: string;
  passthrough: boolean;
  mounted: boolean;
  survivedOps: boolean;
  victimMutatedDuring: boolean;
  victimRestored: boolean;
  errors: string[];
}
declare global {
  interface Window {
    __harness?: { run(id: string): Promise<HarnessResult> };
  }
}

const ALL_IDS = [
  'black-hole', 'toasters', 'dvd', 'warp', 'fish', 'rainstorm', 'hard-rain',
  'globe', 'spotlight', 'fade-out', 'bouncing-ball', 'logo', 'messages', 'messages2',
  'pipes', 'bsod', 'flurry', 'fluid', 'reaction-diffusion', 'snowfall', 'lanterns',
];

/**
 * Every saver must honor the SaverInstance interface (S1-S5): mount into the
 * host, survive resize + setPaused, dispose without errors, and — for the one
 * passthrough saver (black-hole) — mutate the live page's victims while running
 * and restore them on dispose, while the 13 non-passthrough savers touch nothing
 * outside their host.
 */
test('all 21 savers honor the full SaverInstance lifecycle', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/?harness=1');
  await page.waitForFunction(() => !!window.__harness);

  for (const id of ALL_IDS) {
    const r = await page.evaluate((sid) => window.__harness!.run(sid), id);
    expect(r.mounted, `${id}: mounts into the host`).toBe(true); // S1
    expect(r.survivedOps, `${id}: survives resize + setPaused with no error`).toBe(true); // S2
    expect(r.errors, `${id}: no runtime errors`).toEqual([]); // S3/S4
    if (r.passthrough && r.victimMutatedDuring) {
      // Passthrough savers that mutate victims (e.g. black hole) must restore them.
      expect(r.victimRestored, `${id}: restores victims on dispose`).toBe(true); // S5
    } else if (!r.passthrough) {
      expect(r.victimMutatedDuring, `${id}: must not touch anything outside its host`).toBe(false); // S5
      expect(r.victimRestored).toBe(true);
    }
  }

  expect(pageErrors, 'no page errors across all savers').toEqual([]);
});

/**
 * Content regression: Flying Toasters must render the original Berkeley Systems
 * TOASTER sprites (a 4-frame wing-flap GIF driven by background-position, embedded
 * as a data URI), that fly — never the airplane glyph (U+2708) a port once used as
 * a stand-in, and never an external URL.
 */
test('S-toasters: flying toasters use the original sprite, not airplanes', async ({ page }) => {
  await page.goto('/?saver=toasters');
  await page.waitForFunction(() => !!window.__idleScreens);
  await page.evaluate(() => window.__idleScreens!.sleep());
  await expect
    .poll(() =>
      page.evaluate(() => {
        const sr = document.querySelector('idle-screen')?.shadowRoot;
        return sr?.querySelectorAll('.surface .toaster').length ?? 0;
      }),
    )
    .toBeGreaterThan(0);

  const result = await page.evaluate(() => {
    const surface = document.querySelector('idle-screen')!.shadowRoot!.querySelector('.surface')!;
    let airplane = false;
    surface.querySelectorAll('.toaster, .toast').forEach((el) => {
      for (const pseudo of ['::before', '::after', '']) {
        const c = getComputedStyle(el, pseudo || undefined).content;
        if (c && c.includes('✈')) airplane = true;
      }
    });
    const toaster = surface.querySelector('.toaster');
    const cs = toaster ? getComputedStyle(toaster) : null;
    return {
      toasterCount: surface.querySelectorAll('.toaster').length,
      toastCount: surface.querySelectorAll('.toast').length,
      hasEmbeddedSprite: !!cs && cs.backgroundImage.includes('data:image/gif'),
      externalUrl: !!cs && /url\(["']?(https?:|\/)/.test(cs.backgroundImage),
      flaps: !!cs && cs.animationName.includes('t-flap'),
      flies: !!cs && cs.animationName.includes('t-fly'),
      airplane,
    };
  });

  expect(result.toasterCount).toBeGreaterThan(0);
  expect(result.toastCount).toBeGreaterThan(0);
  expect(result.hasEmbeddedSprite, 'toasters use the embedded GIF sprite (self-contained)').toBe(true);
  expect(result.externalUrl, 'no external asset URL (library must be self-contained)').toBe(false);
  expect(result.flaps, 'wings flap via the sprite frames').toBe(true);
  expect(result.flies, 'pieces fly diagonally').toBe(true);
  expect(result.airplane, 'no airplane glyph anywhere').toBe(false);
});
