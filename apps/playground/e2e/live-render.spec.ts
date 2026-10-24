import { test, expect, type Page } from '@playwright/test';

/**
 * F129 — live-render bugs the preview cannot see, checked on real canvas
 * pixels (`?spec=<json>&frame=<ms>`, see `frameMode()` in src/main.ts).
 *
 * Perception and the advisories share the renderer's own tables, so they agree
 * with it even when all three are wrong (X614: the anchor offset, the
 * luminance grid and `text-off-screen` all used the same too-narrow CJK
 * width). Only pixels from Chromium's real glyphs and rasteriser catch that.
 *
 * X540 (dark `emit` ghosts under `lighter`) and X411 (1 px dark hairlines over
 * stacked soft multiply layers) did not reproduce in the engine on 2026-10-24.
 * Their cases stay here as guards on the invariants the reports broke.
 */

interface Frame {
  width: number;
  height: number;
  /** RGB per pixel, row-major. */
  rgb: Uint8Array;
}

async function renderFrame(page: Page, spec: unknown, frame = 0, seed = 42): Promise<Frame> {
  await page.goto(`/?frame=${frame}&seed=${seed}&spec=${encodeURIComponent(JSON.stringify(spec))}`);
  await page.waitForFunction(() => window.__frameReady === true, undefined, { timeout: 15_000 });
  const { width, height, b64 } = await page.evaluate(() => {
    const canvas = document.querySelector('#stage canvas') as HTMLCanvasElement;
    const { data, width, height } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0, o = 0; i < data.length; i += 4) { rgb[o++] = data[i]!; rgb[o++] = data[i + 1]!; rgb[o++] = data[i + 2]!; }
    let bin = '';
    for (let i = 0; i < rgb.length; i += 0x8000) bin += String.fromCharCode(...rgb.subarray(i, i + 0x8000));
    return { width, height, b64: btoa(bin) };
  });
  return { width, height, rgb: new Uint8Array(Buffer.from(b64, 'base64')) };
}

const lum = (f: Frame, x: number, y: number): number => {
  const i = (y * f.width + x) * 3;
  return (f.rgb[i]! + f.rgb[i + 1]! + f.rgb[i + 2]!) / 3;
};

const scene = (background: unknown, layers: unknown[]) => ({ schemaVersion: 1, id: 'f129', label: 'F129', background, layers });

test.describe('F129 live render', () => {
  test('X566: a linear stroke with few long segments keeps its corners', async ({ page }) => {
    // Three segments: 24 uniform samples skipped both inner corners, cutting each
    // by ~11 px at this size — far more than the 3 px line's half width.
    const spec = scene({ type: 'solid', color: '#000000' }, [
      {
        count: 1,
        sprite: { kind: 'stroke', length: [0.4, 0.4], points: [[-1, -1], [1, -1], [1, 1], [-1, 1]], color: '#ffffff', width: 0.004, curve: 'linear' },
        alpha: [1, 1],
        motion: { type: 'static' },
        position: { x: 0.5, y: 0.5 },
      },
    ]);
    const f = await renderFrame(page, spec);
    const half = 0.2 * Math.min(f.width, f.height);
    const cx = f.width / 2;
    const cy = f.height / 2;
    for (const [ux, uy] of [[1, -1], [1, 1]]) {
      const x = Math.round(cx + ux * half);
      const y = Math.round(cy + uy * half);
      // Brightest pixel within 1 px of the authored vertex: the corner is drawn.
      let best = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) best = Math.max(best, lum(f, x + dx, y + dy));
      expect(best, `corner (${ux}, ${uy}) at ${x},${y}`).toBeGreaterThan(128);
    }
  });

  test('X614: a centre-anchored katakana line is centred on the canvas and stays on it', async ({ page }) => {
    const spec = scene({ type: 'solid', color: '#000000' }, [
      {
        count: 1,
        sprite: { kind: 'textBlock', text: 'アイドルスクリーンの夜明け', maxWidth: 0.95, fontSize: 0.06, anchor: 'center', color: '#ffffff' },
        motion: { type: 'static' },
        position: { x: 0.5, y: 0.5 },
      },
    ]);
    const f = await renderFrame(page, spec);
    let x0 = Infinity;
    let x1 = -Infinity;
    for (let y = 0; y < f.height; y++)
      for (let x = 0; x < f.width; x++)
        if (lum(f, x, y) > 96) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
    expect(x1).toBeGreaterThan(x0);
    // Ink is ~0.78 of the short side wide; at 0.55 em a glyph the anchor put
    // its centre ~0.15 of the short side right of the frame centre.
    const mid = (x0 + x1 + 1) / 2;
    expect(Math.abs(mid - f.width / 2) / Math.min(f.width, f.height)).toBeLessThan(0.03);
    expect(x0).toBeGreaterThan(0);
    expect(x1).toBeLessThan(f.width - 1);
  });

  test('X540 guard: an emit fade under lighter never paints below the background', async ({ page }) => {
    const bg = [0x10, 0x1a, 0x3a];
    const spec = scene({ type: 'solid', color: '#101a3a' }, [
      { count: 6, sprite: { kind: 'ring', radius: [0.05, 0.08], color: '#ffd27a', width: 0.004 }, alpha: [0.8, 1], blend: 'lighter', motion: { type: 'static' }, emit: { every: 2000, life: 1800, jitter: 0, grow: [0.2, 2] } },
      { count: 6, sprite: { kind: 'stroke', length: [0.1, 0.16], points: [[-1, 0], [0, 0.3], [1, 0]], color: '#9fd8ff', width: 0.004 }, alpha: [0.8, 1], blend: 'lighter', motion: { type: 'static' }, emit: { every: 2000, life: 1800, jitter: 0 } },
    ]);
    // Across the slow fade-out of the window: additive ink only ever adds.
    for (const t of [700, 1200, 1700]) {
      const f = await renderFrame(page, spec, t);
      let below = 0;
      for (let i = 0; i < f.rgb.length; i += 3)
        if (f.rgb[i]! < bg[0]! - 2 || f.rgb[i + 1]! < bg[1]! - 2 || f.rgb[i + 2]! < bg[2]! - 2) below++;
      expect(below, `t=${t}`).toBe(0);
    }
  });

  test('X411 guard: stacked soft multiply discs draw no 1 px dark columns', async ({ page }) => {
    const cols = ['#fffaf0', '#f8f0e0', '#e8d8c0', '#ffffff', '#f0e8ff', '#fff8e8', '#d8c8b0', '#fffff8'];
    const spec = scene(
      { type: 'solid', color: '#f2ece0' },
      cols.map((color, i) => ({
        count: 3,
        sprite: { kind: 'circle', radius: [0.25, 0.4], color, soft: true },
        alpha: [0.5, 0.8],
        ...(i % 2 === 0 ? { blend: 'multiply' } : {}),
        motion: { type: 'static' },
      })),
    );
    const f = await renderFrame(page, spec);
    // The vj-playbook detector: a pixel darker than the median of its ±2..3 px
    // neighbours, on the same column across several rows, is a hairline.
    const hits = new Map<number, number>();
    for (const fy of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
      const y = Math.round(f.height * fy);
      for (let x = 4; x < f.width - 4; x++) {
        const nb = [lum(f, x - 3, y), lum(f, x - 2, y), lum(f, x + 2, y), lum(f, x + 3, y)].sort((a, b) => a - b);
        if ((nb[1]! + nb[2]!) / 2 - lum(f, x, y) > 4) hits.set(x, (hits.get(x) ?? 0) + 1);
      }
    }
    expect([...hits].filter(([, n]) => n >= 2)).toEqual([]);
  });
});
