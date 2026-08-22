import { test, expect, type Page } from '@playwright/test';

/**
 * G6 — textBlock `reveal`, verified at the PIXEL level on a real browser canvas.
 *
 * The unit suite pins `revealState`/`graphemeClusters` analytically; the web
 * renderer was browser-verified by hand in the playground when it landed. This
 * file makes that verification durable: `?spec=<json>&frame=<ms>` (see
 * `frameMode()` in src/main.ts) compiles an arbitrary SaverSpec and renders one
 * frame-addressable frame, so typing/caret/layout can be asserted from actual
 * canvas pixels — no live channel required.
 *
 * All assertions rest on the design invariant: layout always runs on the FULL
 * text; reveal only masks which glyphs are painted (docs: text-reveal-design.md).
 */

interface Capture {
  /** Pixels brighter than the #05050a background (text + caret ink). */
  ink: number;
  width: number;
  height: number;
  /** Ink bitmask, 1 bit per pixel, row-major, base64 — for subset/diff math. */
  mask: string;
  dataURL: string;
}

async function renderSpec(page: Page, spec: unknown, frame = 0, seed = 42): Promise<Capture> {
  const url = `/?frame=${frame}&seed=${seed}&spec=${encodeURIComponent(JSON.stringify(spec))}`;
  await page.goto(url);
  await page.waitForFunction(() => window.__frameReady === true, undefined, { timeout: 15_000 });
  return page.evaluate(() => {
    const canvas = document.querySelector('#stage canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const n = width * height;
    const bits = new Uint8Array((n + 7) >> 3);
    let ink = 0;
    for (let i = 0; i < n; i++) {
      // Background is #05050a (~5/255 per channel); text is near-white.
      // Threshold 40 sits far from both, and tolerant of antialiased edges.
      if (data[i * 4]! > 40 || data[i * 4 + 1]! > 40 || data[i * 4 + 2]! > 40) {
        ink++;
        bits[i >> 3] |= 1 << (i & 7);
      }
    }
    let bin = '';
    for (let i = 0; i < bits.length; i += 0x8000) bin += String.fromCharCode(...bits.subarray(i, i + 0x8000));
    return { ink, width, height, mask: btoa(bin), dataURL: canvas.toDataURL() };
  });
}

const decodeMask = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)!;
  return out;
};

const isLit = (m: Uint8Array, i: number): boolean => (m[i >> 3]! & (1 << (i & 7))) !== 0;

function textBlockSpec(text: string, reveal?: Record<string, unknown>): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'text-reveal-e2e',
    label: 'Text Reveal E2E',
    background: { type: 'solid', color: '#05050a' },
    layers: [
      {
        count: 1,
        sprite: {
          kind: 'textBlock',
          text,
          maxWidth: 0.6,
          fontSize: 0.05,
          lineHeight: 1.5,
          color: '#e6e8ef',
          align: 'left',
          ...(reveal ? { reveal } : {}),
        },
        motion: { type: 'static' },
        position: { x: 0.2, y: 0.2 },
      },
    ],
  };
}

const LONG_TEXT =
  'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs again and again.';

test('progress 0 paints no ink; progress 1 paints the full block', async ({ page }) => {
  const hidden = await renderSpec(page, textBlockSpec(LONG_TEXT, { progress: 0 }));
  expect(hidden.ink, 'nothing but background at progress 0').toBe(0);
  const full = await renderSpec(page, textBlockSpec(LONG_TEXT, { progress: 1 }));
  expect(full.ink, 'the text block paints real pixels').toBeGreaterThan(500);
  expect(full.dataURL).not.toBe(hidden.dataURL);
});

test('typewriter ink grows monotonically with progress', async ({ page }) => {
  const a = await renderSpec(page, textBlockSpec(LONG_TEXT, { progress: 0.3 }));
  const b = await renderSpec(page, textBlockSpec(LONG_TEXT, { progress: 0.6 }));
  const c = await renderSpec(page, textBlockSpec(LONG_TEXT, { progress: 1 }));
  expect(a.ink).toBeGreaterThan(0);
  expect(b.ink).toBeGreaterThan(a.ink);
  expect(c.ink).toBeGreaterThan(b.ink);
});

test('revealing more only ADDS ink — lines never reflow mid-type', async ({ page }) => {
  // The load-bearing invariant: because layout runs on the full text, the
  // pixels painted at progress 0.5 are a strict subset of those at 1.0.
  // If the block re-wrapped while typing, earlier ink would MOVE and this
  // subset test would fail.
  const half = await renderSpec(page, textBlockSpec(LONG_TEXT, { progress: 0.5 }));
  const full = await renderSpec(page, textBlockSpec(LONG_TEXT, { progress: 1 }));
  const mHalf = decodeMask(half.mask);
  const mFull = decodeMask(full.mask);
  expect(mHalf.length).toBe(mFull.length);
  let moved = 0;
  for (let i = 0; i < half.width * half.height; i++) {
    // Antialiasing can shave a hair off a shared edge, but any real reflow
    // moves thousands of pixels — so the budget is ~zero, not zero.
    if (isLit(mHalf, i) && !isLit(mFull, i)) moved++;
  }
  expect(moved, 'ink painted at p=0.5 must still be painted at p=1').toBeLessThan(8);
});

test('the caret blinks as a square wave of t', async ({ page }) => {
  const spec = textBlockSpec(LONG_TEXT, { progress: 0.5, caret: { blink: 1 } });
  // blink 1 Hz: on during t∈[0,500), off during [500,1000), …
  const on = await renderSpec(page, spec, 100);
  const off = await renderSpec(page, spec, 750);
  expect(on.ink).toBeGreaterThan(off.ink);
  // The extra ink is the caret only: a narrow block, not a text-sized region
  // (fsPx ≈ 0.05 × 720 = 36px; caret ≈ 3px × 36px ≈ 108 ink pixels).
  const delta = on.ink - off.ink;
  expect(delta).toBeGreaterThan(16);
  expect(delta).toBeLessThan(600);
});

test('line mode at 0.5 paints exactly line one — pixel-identical to a one-line block', async ({ page }) => {
  const two = await renderSpec(page, textBlockSpec('First line of text\nSecond line here', { progress: 0.5, mode: 'line' }));
  const one = await renderSpec(page, textBlockSpec('First line of text'));
  expect(one.ink).toBeGreaterThan(0);
  expect(two.dataURL).toBe(one.dataURL);
});

test('word mode at 0.25 paints exactly the first word', async ({ page }) => {
  const revealing = await renderSpec(page, textBlockSpec('Hello world foo bar', { progress: 0.25, mode: 'word' }));
  const only = await renderSpec(page, textBlockSpec('Hello'));
  expect(only.ink).toBeGreaterThan(0);
  expect(revealing.dataURL).toBe(only.dataURL);
});

test('the same spec and frame reproduce identical pixels', async ({ page }) => {
  const spec = textBlockSpec(LONG_TEXT, { progress: 0.7, caret: { blink: 1.5 } });
  const a = await renderSpec(page, spec, 1200);
  const b = await renderSpec(page, spec, 1200);
  expect(a.dataURL).toBe(b.dataURL);
});
