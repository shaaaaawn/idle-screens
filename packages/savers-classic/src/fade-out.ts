import {
  sampleTrack,
  defaultParams,
  type ControlTrack,
  type ParamSpace,
  type SaverContext,
  type SaverInstance,
  type SaverManifest,
  type SaverPlugin,
} from '@idle-screens/core';

/**
 * Fade Out — descends from After Dark "Fade Away" (concept by Berkeley
 * Systems). The original CSS port faded a static field to black once over
 * 40s and stopped (`animation: ... 1 forwards`) — no loop, no scrub, and the
 * step from "not dissolved" to "fully black" banged because it was a single
 * opacity ramp on one full-screen layer.
 *
 * This canvas rebuild keeps the spirit — a field progressively dissolving to
 * black — but makes it a cell-by-cell dissolve that reforms and repeats
 * forever, and is fully closed-form in `t`: every cell's visibility is a
 * smooth function of (cyclePhase(t) - itsOwnThreshold), so the timeline can
 * scrub or seek backwards and reproduce the exact same frame. The "field" IS
 * the dissolve grid: each cell is a soft rectangle of the `ink` color tinted
 * by a per-cell seeded shade (a self-contained stand-in for the original's
 * desktop screenshot, since this port ships no image assets), and the same
 * grid doubles as the dissolve mask.
 *
 * `FADE_MS` (40s) preserves the original's one-way fade duration: at
 * `speed: 1`, dissolving to black takes 40s and reforming takes another 40s,
 * an 80s round trip — the same pacing as the CSS version's single fade, just
 * mirrored into a loop instead of stopping dead at the end.
 */

type Pattern = 'dissolve' | 'scan' | 'blinds';

const PARAM_SPACE = {
  /** Grid cell size in px. This is a build-time layout knob — it sets the
   *  dissolve grid's resolution, not a continuously-animated visual quantity.
   *  It's still sampled every frame (so renderFrame stays a pure function of
   *  t), but defaults to a step ease: re-gridding is a discrete change, not
   *  something that reads as motion when interpolated. */
  cellSize: { type: 'number', default: 40, min: 12, max: 160, ease: 'step' },
  /** 'dissolve' = seeded random per-cell order (the classic scatter);
   *  'scan' = a left-to-right sweep with a soft, jittered edge;
   *  'blinds' = a row-by-row sweep, top to bottom. */
  pattern: { type: 'enum', default: 'dissolve', options: ['dissolve', 'scan', 'blinds'] },
  speed: { type: 'number', default: 1, min: 0.25, max: 3, ease: 'smooth' },
  /** The field's base color (the "desktop" being dissolved). */
  ink: { type: 'color', default: '#3b3f4a' },
  /** Per-cell brightness variation of the field: 0 = flat color, 1 = a
   *  pronounced mosaic. This is what stands in for the original's screenshot
   *  texture without shipping any image asset. */
  contrast: { type: 'number', default: 0.4, min: 0, max: 1, ease: 'smooth' },
} satisfies ParamSpace;

export const fadeOutManifest: SaverManifest = {
  id: 'fade-out',
  label: 'Fade Out',
  description: 'Screen fades to black.',
  timeModel: 'closed-form',
  passthrough: false,
  minBackend: 'canvas2d',
  costTier: 'low',
  motionIntensity: 'calm',
  reducedMotionFallback: 'static',
  paramSpace: PARAM_SPACE,
  attribution: {
    source: 'After Dark "Fade Away" — concept by Berkeley Systems',
    license: 'MIT port; reference CSS MIT (Bryan Braun)',
    url: 'https://github.com/bryanbraun/after-dark-css',
  },
  a11y: {
    flashSafe: true,
    notes:
      'Cell-by-cell dissolve; each cell eases across the transition over ~200ms of phase and thresholds are spread across the whole cycle, so the field never flips in one frame.',
  },
  // Canvas-only (a single canvas surface, no other DOM) and worker-eligible —
  // left as workerReady: false for now; enabling it in the worker registry
  // is a separate change outside this rebuild's scope.
  workerReady: false,
};

interface Params {
  cellSize: number;
  pattern: Pattern;
  speed: number;
  ink: string;
  contrast: number;
}

/** One-way dissolve duration (ms) at speed 1 — the original CSS fade's length. */
const FADE_MS = 40_000;
/** How much of the cycle's phase a single cell's transition is softened over. */
const EASE_MS = 200;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

const clampSpeed = (s: number): number =>
  !Number.isFinite(s) || s <= 0 ? 1 : Math.min(3, Math.max(0.25, s));

/** Triangle wave in [0,1]: rises over `halfPeriodMs`, falls back over the next
 *  `halfPeriodMs` — the dissolve-then-reform cycle, forever. Pure in `t`. */
function cyclePhase(t: number, halfPeriodMs: number): number {
  const period = halfPeriodMs * 2;
  const k = ((t % period) + period) % period;
  return k < halfPeriodMs ? k / halfPeriodMs : 2 - k / halfPeriodMs;
}

/** Where in the cycle this cell starts dissolving, in [0,1] phase units.
 *  `fv` is the cell's own forked random draw, reused so every pattern still
 *  costs exactly one rng draw per cell. */
function cellThreshold(
  pattern: Pattern,
  row: number,
  col: number,
  rows: number,
  cols: number,
  fv: number,
): number {
  switch (pattern) {
    case 'scan': {
      const colFrac = cols > 1 ? col / (cols - 1) : 0;
      return clamp01(colFrac + (fv - 0.5) * 0.12);
    }
    case 'blinds': {
      const rowFrac = rows > 1 ? row / (rows - 1) : 0;
      return clamp01(rowFrac + (fv - 0.5) * 0.06);
    }
    case 'dissolve':
    default:
      return fv;
  }
}

/** 1 = cell shows its full field color, 0 = cell is fully black. Eases across
 *  a window of `2*halfWidth` phase units centered on `threshold` — never a
 *  hard step, so a cell's own transition can never bang. */
function easeCellVisibility(phase: number, threshold: number, halfWidth: number): number {
  const x = clamp01((phase - (threshold - halfWidth)) / (2 * halfWidth));
  const s = x * x * (3 - 2 * x); // smoothstep
  return 1 - s;
}

function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [59, 63, 74]; // fallback slate, matches the default ink
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

class FadeOutInstance implements SaverInstance {
  private readonly ctxSaver: SaverContext;
  private readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private readonly c2d: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

  private w = 0;
  private h = 0;
  private frameId: number | null = null;
  private paused = false;
  private startT = 0;
  private t = 0;

  private params: Params = defaultParams(PARAM_SPACE) as unknown as Params;
  private track: ControlTrack | null = null;

  constructor(ctx: SaverContext) {
    this.ctxSaver = ctx;
    if (ctx.surface) {
      this.canvas = ctx.surface;
    } else {
      const el = document.createElement('canvas');
      el.style.cssText = 'display:block;width:100%;height:100%;background:#000';
      ctx.host.appendChild(el);
      this.canvas = el;
    }
    const c2d = this.canvas.getContext('2d', { alpha: false }) as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!c2d) throw new Error('fade-out: no 2d context');
    this.c2d = c2d;
    this.w = ctx.width;
    this.h = ctx.height;
    this.sizeCanvas();

    this.paused = ctx.reducedMotion;
    if (this.paused) this.renderStill();
    else this.start();
  }

  private applyParams(t: number): void {
    const p = this.track ? sampleTrack(PARAM_SPACE, this.track, t) : this.params;
    for (const k of Object.keys(PARAM_SPACE) as Array<keyof typeof PARAM_SPACE>) {
      const v = (p as Record<string, unknown>)[k];
      if (v !== undefined) (this.params as unknown as Record<string, unknown>)[k] = v;
    }
  }

  private sizeCanvas(): void {
    const dpr = Math.min(this.ctxSaver.dpr, 2);
    this.canvas.width = Math.max(1, Math.round(this.w * dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * dpr));
    this.c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---- closed-form render ----

  private render(t: number): void {
    const ctx2d = this.c2d;
    const p = this.params;
    const w = this.w;
    const h = this.h;
    const cellPx = Math.max(4, p.cellSize);
    const cols = Math.max(1, Math.ceil(w / cellPx));
    const rows = Math.max(1, Math.ceil(h / cellPx));

    const oneWayMs = FADE_MS / clampSpeed(p.speed);
    const phase = cyclePhase(t, oneWayMs);
    const halfWidth = Math.max(0.001, EASE_MS / oneWayMs / 2);

    const [ir, ig, ib] = parseHex(p.ink);
    const rng = this.ctxSaver.rng;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        // Per-index fork, salted by row/col (not draw order): resize re-grids
        // never re-roll a cell that still exists at the same (row, col).
        const salt = row * 10_000 + col;
        const fv = rng.fork(salt).next();

        const shade = (fv - 0.5) * 2 * p.contrast * 0.4;
        const target = shade >= 0 ? 255 : 0;
        const k = Math.abs(shade);
        const cr = ir + (target - ir) * k;
        const cg = ig + (target - ig) * k;
        const cb = ib + (target - ib) * k;

        const threshold = cellThreshold(p.pattern, row, col, rows, cols, fv);
        const visible = easeCellVisibility(phase, threshold, halfWidth);
        const black = 1 - visible;

        const fr = Math.round(cr * (1 - black));
        const fg = Math.round(cg * (1 - black));
        const fb = Math.round(cb * (1 - black));
        ctx2d.fillStyle = `rgb(${fr}, ${fg}, ${fb})`;
        ctx2d.fillRect(col * cellPx, row * cellPx, cellPx, cellPx);
      }
    }
  }

  // ---- loop ----
  private start(): void {
    if (this.frameId !== null || typeof requestAnimationFrame === 'undefined') return;
    this.startT = 0;
    this.frameId = requestAnimationFrame((now) => this.loop(now));
  }

  private stop(): void {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }

  private loop(now: number): void {
    this.frameId = requestAnimationFrame((n) => this.loop(n));
    if (this.startT === 0) this.startT = now;
    this.renderFrame(now - this.startT, this.ctxSaver.seed);
  }

  private renderStill(): void {
    this.renderFrame(this.t, this.ctxSaver.seed);
  }

  // ---- SaverInstance ----
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      this.stop();
      this.renderStill();
    } else {
      this.start();
    }
  }

  resize(width: number, height: number, dpr?: number): void {
    this.w = width;
    this.h = height;
    if (dpr !== undefined) this.ctxSaver.dpr = dpr;
    this.sizeCanvas();
    if (this.paused) this.renderStill();
  }

  applyTrack(track: ControlTrack): void {
    this.track = track;
    if (this.paused) this.renderStill();
  }

  /** Pure, frame-addressable render at logical time `t`. */
  renderFrame(t: number, _seed: number): void {
    this.t = t;
    this.applyParams(t);
    this.render(t);
  }

  dispose(): void {
    this.stop();
    if (typeof HTMLCanvasElement !== 'undefined' && this.canvas instanceof HTMLCanvasElement) this.canvas.remove();
  }
}

/** The fade-out saver plugin. */
export const fadeOut: SaverPlugin = {
  manifest: fadeOutManifest,
  mount: (ctx: SaverContext) => new FadeOutInstance(ctx),
};

/** A demo control-track: dissolve gives way to a scan, then blinds, with a
 *  speed swell through the middle and a brief warm tint on the ink. ~14s,
 *  loops. Deterministic; not registered. */
export const fadeOutDemoTrack: ControlTrack = {
  program: 'fade-out',
  seed: 5,
  duration: 14_000,
  loop: true,
  deltas: [
    { t: 0, path: 'pattern', value: 'dissolve' },
    { t: 5000, path: 'pattern', value: 'scan' },
    { t: 9500, path: 'pattern', value: 'blinds' },
    { t: 0, path: 'speed', value: 1 },
    { t: 7000, path: 'speed', value: 2, ease: 'smooth' },
    { t: 14_000, path: 'speed', value: 1, ease: 'smooth' },
    { t: 0, path: 'ink', value: '#3b3f4a' },
    { t: 6000, path: 'ink', value: '#5a3b4a', ease: 'smooth' },
    { t: 12_000, path: 'ink', value: '#3b3f4a', ease: 'smooth' },
  ],
};
