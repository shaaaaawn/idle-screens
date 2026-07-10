import { test, expect, type Page } from '@playwright/test';

interface FlashReport {
  passes: boolean;
  general: { flashingAreaFraction: number };
}
interface ValidateResult {
  supported: boolean;
  flash?: FlashReport;
  perf?: { withinBudget: boolean; costTier: string };
}
declare global {
  interface Window {
    __schema?: {
      validate(json: string): { valid: boolean; errors: { path: string; message: string }[] };
      sample(json: string): Promise<ValidateResult>;
      examples: Record<string, string>;
    };
  }
}

const ready = async (page: Page): Promise<void> => {
  await page.goto('/#dev');
  await page.waitForFunction(() => !!window.__schema);
};

test('validateSpec accepts the aquarium example and rejects a broken spec', async ({ page }) => {
  await ready(page);
  const r = await page.evaluate(() => {
    const good = window.__schema!.validate(window.__schema!.examples.aquarium);
    const bad = window.__schema!.validate(JSON.stringify({ schemaVersion: 1, id: '', layers: [] }));
    return { good, bad };
  });
  expect(r.good.valid).toBe(true);
  expect(r.bad.valid).toBe(false);
  expect(r.bad.errors.map((e) => e.path)).toEqual(expect.arrayContaining(['id', 'layers']));
});

// The safety loop: compile a declarative spec, sample it through the flash validator,
// assert it passes. This is what makes "safety by construction" a checked property, not
// a claim — an agent-authored spec cannot ship a seizure risk.
test('a compiled spec is flash-safe (WCAG 2.3.1) and within the frame budget', async ({ page }) => {
  await ready(page);
  const aq = await page.evaluate(() => window.__schema!.sample(window.__schema!.examples.aquarium));
  expect(aq.supported).toBe(true);
  expect(aq.flash!.passes).toBe(true);
  expect(aq.flash!.general.flashingAreaFraction).toBeLessThan(0.25);
  expect(aq.perf!.withinBudget).toBe(true);

  const rain = await page.evaluate(() => window.__schema!.sample(window.__schema!.examples.rain));
  expect(rain.flash!.passes).toBe(true);
});

test('the panel compiles + previews the spec, and surfaces validation errors live', async ({ page }) => {
  await ready(page);
  // the default aquarium spec auto-compiles into the preview host
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector('#schema-host')?.querySelector('canvas') !== null),
    )
    .toBe(true);
  await expect(page.locator('#schema-status')).toHaveClass(/same/); // valid

  // break the JSON -> the panel flips to invalid with errors
  await page.locator('#schema-json').fill('{ "schemaVersion": 1, "id": "x", "layers": [] }');
  await page.locator('#schema-json').dispatchEvent('input');
  await expect(page.locator('#schema-status')).toHaveClass(/diff/);
  expect(await page.locator('#schema-errors').textContent()).toContain('layers');
});
