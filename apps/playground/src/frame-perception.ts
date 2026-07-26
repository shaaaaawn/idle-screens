/**
 * Frame perception — "see" an IMPERATIVE saver by reading its pixels.
 *
 * `perceiveScene` (in @idle-screens/schema) is analytic: it walks a SaverSpec's
 * layers and computes luminance from geometry, never rasterizing. That is why
 * it is deterministic, cheap, and able to attribute per-layer dominance and
 * motion. It also means it cannot say anything at all about the 22 imperative
 * savers (classic, black-hole, tide, limelight) — there is no spec to walk.
 *
 * This module is the other half: mount the saver, read the canvas back, and
 * build the SAME `LuminanceGrid` shape from pixels so the identical braille /
 * density renderers apply. What you get is a real picture and real
 * whole-frame statistics.
 *
 * What it deliberately does NOT provide, because pixels cannot carry it:
 *   - dominance   (which LAYER owns the frame — a spec-level concept)
 *   - motion      (per-layer speeds — likewise)
 *   - text        (glyph strings)
 *   - advisories  (spec lints)
 * Those stay absent rather than being approximated, so a frame reading is never
 * mistaken for a spec reading.
 *
 * Determinism is reported, not assumed. A saver implementing `renderFrame(t,
 * seed)` gives a reproducible sample; everything else is a wall-clock grab and
 * is labelled as such, because an eval number that silently wobbles run to run
 * is worse than no number.
 */
import { createRng, type SaverInstance, type SaverPlugin } from '@idle-screens/core';
import { renderBrailleMap, renderDensityMap, type LuminanceGrid } from '@idle-screens/schema';

export type FrameSupport = 'deterministic' | 'sampled' | 'unsupported';

export interface FramePerception {
  /** Same braille language as spec perception — 2×4 px per character. */
  braille: string;
  density: string;
  coverage: number;
  meanLuminance: number;
  centroid: { x: number; y: number } | null;
  rowProfile: number[];
  colProfile: number[];
  /** ms the frame was sampled at (exact when deterministic). */
  t: number;
  support: FrameSupport;
  /** Why this saver is unsupported, when it is. */
  reason?: string;
}

const COLS = 80;
const ROWS = 48;
/** Cells deviating more than this from the row background count as covered —
 *  matches the analytic grid's threshold so the two are comparable. */
const COVERAGE_EPS = 0.03;

const twoFrames = (): Promise<void> =>
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

/** Rec. 709 luma on 0..1, matching the schema package's hexLuma. */
function luma(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * Downsample an ImageData into the same LuminanceGrid the analytic path emits,
 * so `renderBrailleMap` / `renderDensityMap` can be reused verbatim.
 *
 * Background is estimated PER ROW as that row's median luminance. The analytic
 * path knows the declared background; here it has to be inferred, and a median
 * is robust to sprites covering part of the row in a way a mean is not.
 */
export function gridFromImageData(img: ImageData, cols = COLS, rows = ROWS): LuminanceGrid {
  const cells = new Array<number>(cols * rows).fill(0);
  const cellW = img.width / cols;
  const cellH = img.height / rows;

  for (let ry = 0; ry < rows; ry++) {
    for (let cx = 0; cx < cols; cx++) {
      const x0 = Math.floor(cx * cellW);
      const x1 = Math.max(x0 + 1, Math.floor((cx + 1) * cellW));
      const y0 = Math.floor(ry * cellH);
      const y1 = Math.max(y0 + 1, Math.floor((ry + 1) * cellH));
      let sum = 0;
      let n = 0;
      // Stride so a large canvas doesn't cost more than a small one.
      const sx = Math.max(1, Math.floor((x1 - x0) / 4));
      const sy = Math.max(1, Math.floor((y1 - y0) / 4));
      for (let y = y0; y < y1; y += sy) {
        for (let x = x0; x < x1; x += sx) {
          const i = (y * img.width + x) * 4;
          const a = img.data[i + 3]! / 255;
          // Alpha-weighted: a transparent passthrough canvas reads as its own
          // marks, not as an opaque black frame.
          sum += luma(img.data[i]!, img.data[i + 1]!, img.data[i + 2]!) * a;
          n++;
        }
      }
      cells[ry * cols + cx] = n ? sum / n : 0;
    }
  }

  const background = new Array<number>(rows).fill(0);
  for (let ry = 0; ry < rows; ry++) {
    const row = cells.slice(ry * cols, ry * cols + cols).sort((a, b) => a - b);
    background[ry] = row[Math.floor(row.length / 2)] ?? 0;
  }

  let covered = 0;
  let lumSum = 0;
  let wSum = 0;
  let cxSum = 0;
  let cySum = 0;
  const rowProfile = new Array<number>(rows).fill(0);
  const colProfile = new Array<number>(cols).fill(0);

  for (let ry = 0; ry < rows; ry++) {
    const bg = background[ry]!;
    for (let cx = 0; cx < cols; cx++) {
      const v = cells[ry * cols + cx]!;
      const dev = Math.abs(v - bg);
      lumSum += v;
      if (dev > COVERAGE_EPS) covered++;
      rowProfile[ry] = rowProfile[ry]! + dev / cols;
      colProfile[cx] = colProfile[cx]! + dev / rows;
      wSum += dev;
      cxSum += dev * ((cx + 0.5) / cols);
      cySum += dev * ((ry + 0.5) / rows);
    }
  }

  const total = cols * rows;
  return {
    cols,
    rows,
    cells,
    background,
    meanLuminance: lumSum / total,
    coverage: covered / total,
    centroid: wSum > 1e-6 ? { x: cxSum / wSum, y: cySum / wSum } : null,
    rowProfile,
    colProfile,
  };
}

/** The canvas a mounted saver drew into, if it produced one. */
function canvasIn(host: HTMLElement): HTMLCanvasElement | null {
  return host.querySelector('canvas');
}

/**
 * Dev hook, in the same family as `__validate` / `__harness`: lets a test or an
 * agent ask what any registered saver looks like without going through the UI.
 */
export function wirePerceptionHarness(savers: SaverPlugin[]): void {
  (window as unknown as { __perceive?: unknown }).__perceive = {
    list: (): Array<{ id: string; label: string; hasSpec: boolean }> =>
      savers.map((s) => ({ id: s.manifest.id, label: s.manifest.label, hasSpec: false })),
    saver: (id: string, opts?: PerceiveFrameOptions): Promise<FramePerception> => {
      const saver = savers.find((s) => s.manifest.id === id);
      if (!saver) return Promise.reject(new Error(`unknown saver: ${id}`));
      return perceiveSaverFrame(saver, opts);
    },
    all: async (opts?: PerceiveFrameOptions): Promise<Array<{ id: string } & FramePerception>> => {
      const out: Array<{ id: string } & FramePerception> = [];
      for (const s of savers) out.push({ id: s.manifest.id, ...(await perceiveSaverFrame(s, opts)) });
      return out;
    },
  };
}

export interface PerceiveFrameOptions {
  width?: number;
  height?: number;
  seed?: number;
  /** Sample time in ms — honoured exactly when the saver is frame-addressable. */
  t?: number;
}

/**
 * Mount `saver` off-screen, sample one frame, and read it back.
 * Always disposes the instance and removes the host, including on failure.
 */
export async function perceiveSaverFrame(
  saver: SaverPlugin,
  opts: PerceiveFrameOptions = {},
): Promise<FramePerception> {
  const width = opts.width ?? 640;
  const height = opts.height ?? 400;
  const seed = opts.seed ?? 42;
  const t = opts.t ?? 5000;

  const empty = (support: FrameSupport, reason: string): FramePerception => ({
    braille: '',
    density: '',
    coverage: 0,
    meanLuminance: 0,
    centroid: null,
    rowProfile: [],
    colProfile: [],
    t,
    support,
    reason,
  });

  // NB: `manifest.workerReady` is not a disqualifier. The Worker path is engine
  // plumbing (the element passes a workerUrl); a direct `saver.mount()` like
  // this one renders on the main thread, so its canvas is readable. Whether a
  // canvas was actually transferred is discovered below by trying to read it,
  // rather than assumed from the manifest.
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px;pointer-events:none;`;
  document.body.append(host);

  let inst: SaverInstance | null = null;
  try {
    inst = await Promise.resolve(
      saver.mount({
        host,
        dpr: 1, // read back at CSS size; no need to pay for retina here
        width,
        height,
        rng: createRng((seed >>> 0) || 1),
        seed,
        reducedMotion: false,
        page: saver.manifest.passthrough
          ? { palette: () => [], victims: () => [] }
          : undefined,
      }),
    );

    const addressable = typeof inst.renderFrame === 'function';
    if (addressable) {
      inst.setPaused(true);
      inst.renderFrame!(t, seed);
    } else {
      // Let it run briefly so the first frame exists, then freeze.
      await twoFrames();
      await twoFrames();
      inst.setPaused(true);
    }

    const canvas = canvasIn(host);
    if (!canvas) {
      return empty(
        'unsupported',
        'CSS/DOM saver: it draws with elements and transforms, not a canvas, so there are no pixels to read.',
      );
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return empty(
        'unsupported',
        'Canvas has no readable 2D context (WebGL/WebGPU readback needs the renderer’s cooperation).',
      );
    }

    let img: ImageData;
    try {
      img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch (err) {
      return empty('unsupported', `Pixel read blocked: ${err instanceof Error ? err.message : String(err)}`);
    }

    const grid = gridFromImageData(img);
    return {
      braille: renderBrailleMap(grid),
      density: renderDensityMap(grid),
      coverage: grid.coverage,
      meanLuminance: grid.meanLuminance,
      centroid: grid.centroid,
      rowProfile: grid.rowProfile,
      colProfile: grid.colProfile,
      t,
      support: addressable ? 'deterministic' : 'sampled',
    };
  } catch (err) {
    return empty('unsupported', `Mount failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    try {
      inst?.dispose();
    } catch {
      /* a saver that throws on dispose must not break perception */
    }
    host.remove();
  }
}
