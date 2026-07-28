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
 * Globe — a spinning wireframe globe bounces around the screen. Inspired by
 * the After Dark "Globe" screensaver (MIT port, github.com/bryanbraun/after-dark-css);
 * artwork © Berkeley Systems.
 *
 * The Angular original sprite-scrolled a `globe_240.jpg` to fake the spin and
 * drifted it corner-to-corner. Per the library's no-external-asset rule, the
 * globe is re-authored dependency-free on canvas2d: a lat/long lattice
 * (meridian half-ellipses + parallel rings) rotated about the vertical axis,
 * back-hemisphere dimmed, DVD-bouncing around the viewport.
 *
 * Modernized to the deep/steerable pattern (see messages.ts, saver-tide):
 * a typed `paramSpace`, a closed-form `renderFrame(t, seed)` — rotation angle
 * and bounce position are both pure functions of `t`, no accumulated state —
 * and a demo control-track. `RADIUS`, `SPIN_BASE` (rotation rate) and
 * `BOUNCE_SPEED` (bounce cadence) are carried over unchanged from the
 * original so the identity and feel are preserved; `density` defaults to the
 * original's exact lattice counts (11 parallels / 21 meridians).
 *
 * The original rendered the lattice as scattered dots, which alias hard at
 * dpr 1 (near-1px filled circles are blocky). This version strokes the
 * lattice as connected polylines with a sub-pixel line width that scales
 * with dpr (`LINE_W_DEVICE / dpr` keeps the *device*-pixel width constant
 * and under 1px, so the edge is always antialiased rather than snapped) and
 * a per-segment alpha falloff toward the back hemisphere for depth.
 */
const RADIUS = 120; // globe radius (px) — preserved from the original (matched the 240px diameter sprite)
const SPIN_BASE = 0.9; // rad/s at spin=1 — preserved rotation rate from the original
const BOUNCE_SPEED = 90; // px/s — preserved DVD-bounce cadence from the original
const SEG_LAT = 24; // latitude samples per meridian (curve resolution, not density)
const SEG_LON = 48; // longitude samples per parallel ring (curve resolution, not density)
const LINE_W_DEVICE = 0.85; // target *device*-pixel stroke width — always sub-pixel, dpr-independent look
const TAU = Math.PI * 2;

const PARAM_SPACE = {
  /** Meridian count (longitude lines); parallel count is derived proportionally
   *  (11 parallels : 21 meridians, the original's ratio). Read once at mount —
   *  the lattice is built at construction time and does not respond to a
   *  control-track delta, same convention as `bubbleCount` in saver-tide. */
  density: { type: 'number', default: 21, min: 8, max: 42 },
  /** Rotation-rate multiplier on the preserved 0.9 rad/s base. */
  spin: { type: 'number', default: 1, min: 0.25, max: 3, ease: 'smooth' },
  /** DVD-bounce amplitude. 1 = the original's full corner-to-corner bounce;
   *  0 = the globe floats motionless at viewport center. */
  bounce: { type: 'number', default: 1, min: 0, max: 1, ease: 'smooth' },
  /** Wireframe stroke color. */
  wire: { type: 'color', default: '#78c8ff' },
  /** Soft additive glow on the globe's limb. */
  glow: { type: 'number', default: 0.35, min: 0, max: 1, ease: 'smooth' },
  /** How much the far (back) hemisphere dims relative to the near hemisphere. */
  depthFade: { type: 'number', default: 0.8, min: 0, max: 1, ease: 'smooth' },
} satisfies ParamSpace;

export const globeManifest: SaverManifest = {
  id: 'globe',
  label: 'Globe',
  passthrough: false,
  minBackend: 'canvas2d',
  costTier: 'low',
  motionIntensity: 'calm',
  reducedMotionFallback: 'static',
  paramSpace: PARAM_SPACE,
  attribution: {
    source: 'After Dark "Globe" — concept by Berkeley Systems',
    license: 'MIT port; reference CSS MIT (Bryan Braun)',
    url: 'https://github.com/bryanbraun/after-dark-css',
  },
  a11y: { flashSafe: true, notes: 'A slowly spinning wireframe globe drifting on black; no flashing.' },
  workerReady: true,
};

interface Params {
  density: number;
  spin: number;
  bounce: number;
  wire: string;
  glow: number;
  depthFade: number;
}

interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** Triangle-wave reflection of a linear position within [0, size] — an elastic
 *  DVD-style bounce off both walls, expressed closed-form (no per-frame
 *  accumulation). Pure function of `pos`. */
function reflect(pos: number, size: number): number {
  const period = size * 2;
  const k = ((pos % period) + period) % period;
  return k <= size ? k : period - k;
}

function lerp(a: number, b: number, p: number): number {
  return a + (b - a) * p;
}

/** Parse `#rrggbb`; falls back to the default wire blue on anything else so a
 *  malformed track value never throws. */
function parseHex(c: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return [120, 200, 255];
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const rgba = (r: number, g: number, b: number, a: number): string =>
  `rgba(${r.toFixed(0)},${g.toFixed(0)},${b.toFixed(0)},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

/** Alpha for a point at `depth` in [0 (back) .. 1 (front)], given how much the
 *  far hemisphere should dim (`depthFade` in [0,1]). */
function depthAlpha(depth: number, depthFade: number): number {
  const front = 0.82;
  const backMin = 0.04;
  const back = front - depthFade * (front - backMin);
  return back + (front - back) * depth;
}

class GlobeInstance implements SaverInstance {
  private readonly ctxSaver: SaverContext;
  private readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private readonly c2d: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

  private w = 0;
  private h = 0;
  private t = 0;

  private frameId: number | null = null;
  private paused = false;
  private startT = 0;

  private params: Params = defaultParams(PARAM_SPACE) as unknown as Params;
  private track: ControlTrack | null = null;

  // Seeded once at construction (never rebuilt on resize) — the exact analog
  // of saver-tide's `build()`. Determinism only requires the SAME instance to
  // reproduce a given t; these constants make the DVD-bounce path pure in t.
  private readonly x0Frac: number;
  private readonly y0Frac: number;
  private readonly dirAngle: number;

  // Lattice, built once from the manifest-default `density` (build-time param).
  private readonly meridians: Point3[][] = [];
  private readonly parallels: Point3[][] = [];

  constructor(ctx: SaverContext) {
    this.ctxSaver = ctx;
    let canvas: HTMLCanvasElement | OffscreenCanvas;
    if (ctx.surface) {
      canvas = ctx.surface;
    } else {
      const el = document.createElement('canvas');
      el.style.cssText = 'display:block;width:100%;height:100%';
      ctx.host.appendChild(el);
      canvas = el;
    }
    this.canvas = canvas;
    const c2d = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!c2d) throw new Error('globe: no 2d context');
    this.c2d = c2d;

    this.buildLattice(PARAM_SPACE.density.default as number);

    this.w = ctx.width;
    this.h = ctx.height;
    this.sizeCanvas();

    const rng = ctx.rng;
    this.x0Frac = rng.next();
    this.y0Frac = rng.next();
    this.dirAngle = rng.range(0, TAU);

    this.paused = ctx.reducedMotion;
    if (this.paused) this.renderStill();
    else this.start();
  }

  /** Meridian half-ellipses + parallel rings on the unit sphere. Pure geometry,
   *  no randomness — `density` is read once, at build time, per the paramSpace
   *  comment; a later control-track delta on `density` updates `params.density`
   *  but does not re-tessellate the lattice. */
  private buildLattice(density: number): void {
    const meridianCount = Math.max(4, Math.round(density));
    const parallelCount = Math.max(3, Math.round(density * (11 / 21)));

    for (let m = 0; m < meridianCount; m++) {
      const lon = (TAU * m) / meridianCount;
      const line: Point3[] = [];
      for (let s = 0; s <= SEG_LAT; s++) {
        const lat = -Math.PI / 2 + (Math.PI * s) / SEG_LAT;
        const ringR = Math.cos(lat);
        line.push({ x: ringR * Math.cos(lon), y: Math.sin(lat), z: ringR * Math.sin(lon) });
      }
      this.meridians.push(line);
    }

    for (let i = 1; i < parallelCount; i++) {
      const lat = -Math.PI / 2 + (Math.PI * i) / parallelCount;
      const ringR = Math.cos(lat);
      const y = Math.sin(lat);
      const line: Point3[] = [];
      for (let k = 0; k <= SEG_LON; k++) {
        const lon = (TAU * k) / SEG_LON;
        line.push({ x: ringR * Math.cos(lon), y, z: ringR * Math.sin(lon) });
      }
      this.parallels.push(line);
    }
  }

  private sizeCanvas(): void {
    const dpr = Math.min(this.ctxSaver.dpr, 2);
    this.canvas.width = Math.max(1, Math.round(this.w * dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * dpr));
    this.c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private applyParams(t: number): void {
    const p = this.track ? sampleTrack(PARAM_SPACE, this.track, t) : this.params;
    for (const k of Object.keys(PARAM_SPACE) as Array<keyof typeof PARAM_SPACE>) {
      const v = (p as Record<string, unknown>)[k];
      if (v !== undefined) (this.params as unknown as Record<string, unknown>)[k] = v;
    }
  }

  // ---- closed-form placement ----

  /** Globe center at time `t` (ms). `bounce` blends between the full
   *  DVD-bounce path and a fixed viewport center. Pure in `t` given the
   *  instance's current w/h and the seeded x0Frac/y0Frac/dirAngle. */
  private center(t: number): [number, number] {
    const p = this.params;
    const rangeX = Math.max(1, this.w - RADIUS * 2);
    const rangeY = Math.max(1, this.h - RADIUS * 2);
    const tSec = t / 1000;
    const vx = Math.cos(this.dirAngle) * BOUNCE_SPEED;
    const vy = Math.sin(this.dirAngle) * BOUNCE_SPEED;
    const bx = RADIUS + reflect(this.x0Frac * rangeX + vx * tSec, rangeX);
    const by = RADIUS + reflect(this.y0Frac * rangeY + vy * tSec, rangeY);
    return [lerp(this.w / 2, bx, p.bounce), lerp(this.h / 2, by, p.bounce)];
  }

  /** Rotation angle at time `t` (ms). Pure: the instantaneous `spin` sample
   *  times the preserved base rate, times elapsed seconds — same convention
   *  as saver-tide's `waveSpeed * t` (no integration across changing spin). */
  private angle(t: number): number {
    return (t / 1000) * SPIN_BASE * this.params.spin;
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

  /** Stroke one lattice polyline (a meridian or a parallel ring), rotated and
   *  projected at render time. `ctx.strokeStyle` is set by the caller;
   *  per-segment alpha/width vary with `depthFade`/`lineW` for a sense of
   *  depth on the back hemisphere. */
  private strokeLine(
    line: Point3[],
    cx: number,
    cy: number,
    cosA: number,
    sinA: number,
    lineW: number,
    depthFade: number,
  ): void {
    const ctx = this.c2d;
    let prevX = 0;
    let prevY = 0;
    let prevDepth = 0;
    for (let i = 0; i < line.length; i++) {
      const p = line[i]!;
      const rx = p.x * cosA + p.z * sinA;
      const rz = -p.x * sinA + p.z * cosA;
      const x = cx + rx * RADIUS;
      const y = cy + p.y * RADIUS;
      const depth = (rz + 1) / 2; // 0 back .. 1 front
      if (i > 0) {
        const avgDepth = (prevDepth + depth) / 2;
        ctx.globalAlpha = depthAlpha(avgDepth, depthFade);
        ctx.lineWidth = lineW * (0.55 + 0.65 * avgDepth);
        ctx.beginPath();
        ctx.moveTo(prevX, prevY);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      prevX = x;
      prevY = y;
      prevDepth = depth;
    }
    ctx.globalAlpha = 1;
  }

  private render(t: number): void {
    const ctx = this.c2d;
    const p = this.params;
    const [cx, cy] = this.center(t);
    const a = this.angle(t);
    const cosA = Math.cos(a);
    const sinA = Math.sin(a);
    const dpr = Math.min(this.ctxSaver.dpr, 2);
    const lineW = LINE_W_DEVICE / dpr;
    const [wr, wg, wb] = parseHex(p.wire);

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.w, this.h);

    // Subtle body disc so the globe reads as a solid sphere.
    const body = ctx.createRadialGradient(
      cx - RADIUS * 0.35, cy - RADIUS * 0.35, RADIUS * 0.1,
      cx, cy, RADIUS,
    );
    body.addColorStop(0, rgba(wr * 0.35, wg * 0.4, wb * 0.5, 0.5));
    body.addColorStop(1, rgba(wr * 0.1, wg * 0.14, wb * 0.2, 0.15));
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(cx, cy, RADIUS, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = rgba(wr, wg, wb, 1);
    for (const line of this.meridians) this.strokeLine(line, cx, cy, cosA, sinA, lineW, p.depthFade);
    for (const line of this.parallels) this.strokeLine(line, cx, cy, cosA, sinA, lineW, p.depthFade);

    // Rim to close the silhouette.
    ctx.globalAlpha = 1;
    ctx.strokeStyle = rgba(wr, wg, wb, 0.4);
    ctx.lineWidth = lineW;
    ctx.beginPath();
    ctx.arc(cx, cy, RADIUS, 0, TAU);
    ctx.stroke();

    // Soft additive glow on the limb.
    if (p.glow > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const glow = ctx.createRadialGradient(cx, cy, RADIUS * 0.82, cx, cy, RADIUS * 1.4);
      glow.addColorStop(0, rgba(wr, wg, wb, 0.4 * p.glow));
      glow.addColorStop(1, rgba(wr, wg, wb, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, RADIUS * 1.4, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
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

  /** Pure, frame-addressable render at logical time `t` (ms). Position and
   *  rotation are both closed-form in `t` — no accumulated state — so seeking
   *  to any `t`, in any order, reproduces the same frame. */
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

/** The globe saver plugin. */
export const globe: SaverPlugin = {
  manifest: globeManifest,
  mount: (ctx: SaverContext) => new GlobeInstance(ctx),
};

/** A demo control-track: spin winds up and eases back, bounce collapses to a
 *  centered float and returns, glow breathes across the cut. Deterministic,
 *  ~12s loop. Not registered anywhere — exported for the workbench/tests. */
export const globeDemoTrack: ControlTrack = {
  program: 'globe',
  seed: 3,
  duration: 12000,
  loop: true,
  deltas: [
    { t: 0, path: 'spin', value: 0.6 },
    { t: 4000, path: 'spin', value: 2.2, ease: 'smooth' },
    { t: 8000, path: 'spin', value: 0.6, ease: 'smooth' },
    { t: 12000, path: 'spin', value: 0.6 },
    { t: 0, path: 'bounce', value: 1 },
    { t: 5000, path: 'bounce', value: 0.1, ease: 'smooth' },
    { t: 9000, path: 'bounce', value: 1, ease: 'smooth' },
    { t: 12000, path: 'bounce', value: 1 },
    { t: 0, path: 'glow', value: 0.25 },
    { t: 6000, path: 'glow', value: 0.9, ease: 'smooth' },
    { t: 12000, path: 'glow', value: 0.25, ease: 'smooth' },
  ],
};
