import { test, expect, type Page } from '@playwright/test';

interface ChannelReport {
  fails: boolean;
  worstTileFlashesPerSecond: number;
  flashingAreaFraction: number;
}
interface FlashReport {
  passes: boolean;
  tiles: number;
  general: ChannelReport;
  red: ChannelReport & { approximate: true };
}
interface ValidateResult {
  id: string;
  supported: boolean;
  flash?: FlashReport;
  perf?: { medianMs: number; p95Ms: number; costTier: string; withinBudget: boolean };
  declaredFlashSafe?: boolean;
}
declare global {
  interface Window {
    __validate?: {
      saver(id: string, opts?: Record<string, number>): Promise<ValidateResult>;
      strobe(hz: number, opts?: Record<string, number>): FlashReport;
    };
  }
}

const ready = async (page: Page): Promise<void> => {
  await page.goto('/?validate=1');
  await page.waitForFunction(() => !!window.__validate);
};

test('black hole passes the WCAG 2.3.1 flash gate and the frame budget', async ({ page }) => {
  await ready(page);
  const r = await page.evaluate(() => window.__validate!.saver('black-hole', { seconds: 1.5 }));
  expect(r.supported).toBe(true);
  expect(r.flash!.passes).toBe(true); // flash-safe
  // It's flash-safe by the AREA exemption, not by being static: some tiles change fast
  // (bright particles) but over well under 25% of the frame — proof per-tile analysis
  // works (a whole-frame average would hide those tiles entirely).
  expect(r.flash!.general.flashingAreaFraction).toBeLessThan(0.25);
  expect(r.flash!.red.approximate).toBe(true);
  expect(r.perf!.withinBudget).toBe(true);
  // Manifest honesty: declared a11y.flashSafe must match what we measured.
  expect(r.declaredFlashSafe === undefined || r.declaredFlashSafe === r.flash!.passes).toBe(true);
});

test('the gate FAILS a dangerous 15 Hz full-screen strobe (proves it bites)', async ({ page }) => {
  await ready(page);
  const s = await page.evaluate(() => window.__validate!.strobe(15, { seconds: 1.5 }));
  expect(s.passes).toBe(false);
  expect(s.general.worstTileFlashesPerSecond).toBeGreaterThan(3);
  expect(s.general.flashingAreaFraction).toBeGreaterThanOrEqual(0.25); // whole screen flashes
});

test('the gate PASSES a 3 Hz strobe (the WCAG boundary) end-to-end through canvas sampling', async ({ page }) => {
  await ready(page);
  const s = await page.evaluate(() => window.__validate!.strobe(3, { seconds: 2 }));
  expect(s.passes).toBe(true);
  expect(s.general.worstTileFlashesPerSecond).toBeLessThanOrEqual(3);
});
