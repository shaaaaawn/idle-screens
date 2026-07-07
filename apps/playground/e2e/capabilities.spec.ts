import { test, expect, type Page } from '@playwright/test';

interface Caps {
  backends: { css: boolean; canvas2d: boolean; webgl2: boolean; webgpu: boolean; offscreenCanvas: boolean };
  reducedMotion?: boolean;
  dpr?: number;
  saveData?: boolean;
}
interface Eligibility {
  id: string;
  status: 'ok' | 'degraded' | 'blocked';
  reasons: string[];
}
declare global {
  interface Window {
    __caps?: {
      detect(): Promise<Caps>;
      tier(c: Caps): string;
      budget(c: Caps): string;
      evaluate(c: Caps): Eligibility[];
      real(): Caps;
    };
  }
}

const ready = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__caps);
};
const byId = (rs: Eligibility[]): Record<string, Eligibility> =>
  Object.fromEntries(rs.map((r) => [r.id, r]));

test('detect() reports real backends with the right shape (assertion-light)', async ({ page }) => {
  await ready(page);
  const c = await page.evaluate(() => window.__caps!.detect());
  expect(c.backends.css).toBe(true);
  expect(c.backends.canvas2d).toBe(true); // headless Chromium has canvas2d
  // Do NOT assert webgl2/webgpu are true — they're frequently off in headless. Just shape.
  expect(typeof c.backends.webgl2).toBe('boolean');
  expect(typeof c.backends.webgpu).toBe('boolean');
  expect(typeof c.reducedMotion).toBe('boolean');
  expect(typeof c.dpr).toBe('number');
});

test('a minimal (CSS-only) device blocks canvas2d + costly savers', async ({ page }) => {
  await ready(page);
  const out = await page.evaluate(() => {
    const minimal: Caps = { backends: { css: true, canvas2d: false, webgl2: false, webgpu: false, offscreenCanvas: false }, saveData: true };
    return { tier: window.__caps!.tier(minimal), budget: window.__caps!.budget(minimal), results: window.__caps!.evaluate(minimal) };
  });
  expect(out.tier).toBe('minimal');
  expect(out.budget).toBe('idle');
  const r = byId(out.results);
  expect(r['black-hole']!.status).toBe('blocked'); // needs canvas2d
  expect(r['black-hole']!.reasons.join(' ')).toMatch(/canvas2d/);
  expect(r['toasters']!.status).toBe('blocked'); // cost "low" > budget "idle"
  expect(r['bouncing-ball']!.status).toBe('ok'); // css + idle survives
});

test('reduced-motion DEGRADES moving savers (respects fallback, does not block)', async ({ page }) => {
  await ready(page);
  const results = await page.evaluate(() => {
    const caps: Caps = { backends: { css: true, canvas2d: true, webgl2: true, webgpu: false, offscreenCanvas: true }, reducedMotion: true };
    return window.__caps!.evaluate(caps);
  });
  const r = byId(results);
  expect(r['warp']!.status).toBe('degraded'); // energetic
  expect(r['toasters']!.status).toBe('degraded'); // moderate
  expect(r['globe']!.status).toBe('ok'); // calm stays full-fidelity
});

test('the panel visibly re-evaluates when you simulate a minimal device', async ({ page }) => {
  await ready(page);
  await page.locator('#cap-sim').scrollIntoViewIfNeeded();
  await page.locator('#cap-sim').selectOption('minimal');
  await expect.poll(() => page.locator('#cap-tier').textContent()).toBe('minimal');
  // the summary must now show some blocked savers (not "14 ok · 0 blocked")
  const summary = await page.locator('#cap-summary').textContent();
  expect(summary).toMatch(/blocked/);
  expect(summary).not.toMatch(/0 blocked/);
});
