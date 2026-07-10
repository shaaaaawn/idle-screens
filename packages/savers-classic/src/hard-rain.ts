import type {
  SaverContext,
  SaverInstance,
  SaverManifest,
  SaverPlugin,
} from '@idle-screens/core';

/**
 * Hard Rain — coloured ripples expanding across a dark desktop. Ported from the
 * After Dark CSS screensaver (MIT, github.com/bryanbraun/after-dark-css).
 *
 * The Angular original placed 60 drops (two out-of-sequence batches) at a fixed
 * grid of positions, each an SVG-ish ring that grew from 0 to its target size
 * over a 4.5s `drip` cycle then vanished, staggered by per-drop negative delays.
 * Re-authored dependency-free here: each drop is a stroked circle whose radius
 * and alpha follow the same grow-then-pop cycle, phase-offset per drop.
 */
export const hardRainManifest: SaverManifest = {
  id: 'hard-rain',
  label: 'Hard Rain',
  passthrough: false,
  minBackend: 'canvas2d',
  costTier: 'low',
  motionIntensity: 'moderate',
  reducedMotionFallback: 'static',
  a11y: { flashSafe: true, notes: 'Slow-expanding coloured rings on black; no flashing.' },
  workerReady: true,
};

const CYCLE = 4500; // ms — the original `drip` duration

/** Normalised drop positions (fractions of viewport), from the original .pN-M rules. */
const POSITIONS: Record<string, [number, number]> = {
  'p0-1': [0.05, -0.02], 'p0-2': [0.25, -0.17], 'p0-3': [0.45, 0.04], 'p0-4': [0.65, -0.04], 'p0-5': [0.85, 0.01],
  'p1-1': [0.05, 0.18], 'p1-2': [0.25, 0.07], 'p1-3': [0.45, 0.24], 'p1-4': [0.65, 0.16], 'p1-5': [0.85, 0.21],
  'p2-1': [0.15, 0.38], 'p2-2': [0.35, 0.27], 'p2-3': [0.55, 0.44], 'p2-4': [0.75, 0.36], 'p2-5': [0.95, 0.41],
  'p3-1': [0.05, 0.58], 'p3-2': [0.25, 0.47], 'p3-3': [0.45, 0.64], 'p3-4': [0.65, 0.56], 'p3-5': [0.85, 0.61],
  'p4-1': [0.15, 0.78], 'p4-2': [0.35, 0.67], 'p4-3': [0.55, 0.84], 'p4-4': [0.75, 0.76], 'p4-5': [0.95, 0.81],
  'p5-1': [0.15, 0.98], 'p5-2': [0.35, 0.87], 'p5-3': [0.55, 1.04], 'p5-4': [0.75, 0.96], 'p5-5': [0.95, 1.01],
};

/** Max ripple radius per size class (px), from the original .sNNN width/2. */
const SIZES: Record<string, number> = { s140: 70, s200: 100, s250: 125, s300: 150, s350: 175 };

/** Ring colours, from the original .colour rules. */
const COLOURS: Record<string, string> = {
  dkblue: '#00006e', lime: '#c8d354', ltgray: '#c2c2c2', red: '#861f23',
  ltblue: '#45a0cc', pink: '#9a3368', yellow: '#efda1d', green: '#397132',
};

/** Per-timing-class negative delay (s) → phase offset, mirroring .tN. Roughly
 *  even 0.15s steps; t30 is the base (0), so t1 leads by 4.35s, etc. */
function timingPhase(t: string): number {
  const map: Record<string, number> = {
    t1: -4.35, t2: -4.2, t3: -4.05, t4: -3.9, t5: -3.75, t6: -3.6, t7: -3.45,
    t8: -3.3, t9: -3.15, t10: -3.0, t11: -2.85, t12: -2.7, t13: -2.55, t14: -2.4,
    t15: -2.25, t16: -2.1, t17: -1.95, t18: -1.8, t19: -1.65, t20: -1.5, t21: -1.35,
    t22: -1.2, t23: -1.05, t24: -0.9, t25: -0.75, t26: -0.6, t27: -0.45, t28: 0.3,
    t29: -0.15, t30: 0,
  };
  return (map[t] ?? 0) * 1000; // ms
}

/** The 60 drops: "timing position size colour", two batches (verbatim). */
const DROP_SPECS: string[] = [
  't7 p0-1 s200 dkblue', 't23 p0-2 s350 lime', 't17 p0-3 s140 ltgray', 't11 p0-4 s300 red', 't14 p0-5 s250 ltblue',
  't29 p1-1 s350 pink', 't18 p1-2 s300 yellow', 't30 p1-3 s140 green', 't12 p1-4 s200 ltgray', 't27 p1-5 s250 dkblue',
  't10 p2-1 s140 pink', 't4 p2-2 s200 red', 't8 p2-3 s300 ltblue', 't22 p2-4 s350 yellow', 't1 p2-5 s250 lime',
  't3 p3-1 s300 green', 't6 p3-2 s250 dkblue', 't15 p3-3 s350 ltgray', 't24 p3-4 s140 pink', 't21 p3-5 s200 ltblue',
  't13 p4-1 s250 yellow', 't28 p4-2 s140 red', 't2 p4-3 s200 ltgray', 't19 p4-4 s300 green', 't25 p4-5 s350 lime',
  't5 p5-1 s350 dkblue', 't26 p5-2 s300 pink', 't20 p5-3 s140 ltblue', 't16 p5-4 s250 yellow', 't9 p5-5 s200 ltgray',
  't22 p0-1 s200 dkblue', 't8 p0-2 s350 lime', 't2 p0-3 s140 ltgray', 't26 p0-4 s300 red', 't29 p0-5 s250 ltblue',
  't14 p1-1 s350 pink', 't3 p1-2 s300 yellow', 't15 p1-3 s140 green', 't27 p1-4 s200 ltgray', 't12 p1-5 s250 dkblue',
  't25 p2-1 s140 pink', 't19 p2-2 s200 red', 't23 p2-3 s300 ltblue', 't7 p2-4 s350 yellow', 't16 p2-5 s250 lime',
  't18 p3-1 s300 green', 't21 p3-2 s250 dkblue', 't30 p3-3 s350 ltgray', 't9 p3-4 s140 pink', 't6 p3-5 s200 ltblue',
  't28 p4-1 s250 yellow', 't13 p4-2 s140 red', 't17 p4-3 s200 ltgray', 't4 p4-4 s300 green', 't10 p4-5 s350 lime',
  't20 p5-1 s350 dkblue', 't11 p5-2 s300 pink', 't5 p5-3 s140 ltblue', 't1 p5-4 s250 yellow', 't24 p5-5 s200 ltgray',
];

interface Drop {
  fx: number; // fractional x
  fy: number; // fractional y
  maxR: number; // target radius (px, scaled by viewport)
  rgb: string; // 'r,g,b'
  phase: number; // ms offset into the cycle
}

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

class HardRainInstance implements SaverInstance {
  private readonly ctx: SaverContext;
  private readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private readonly c2d: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

  private w = 0;
  private h = 0;
  private scale = 1;
  private drops: Drop[] = [];

  private frameId: number | null = null;
  private paused = false;
  private last = 0;
  private clock = 0;

  constructor(ctx: SaverContext) {
    this.ctx = ctx;
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
    if (!c2d) throw new Error('hard-rain: no 2d context');
    this.c2d = c2d;

    this.w = ctx.width;
    this.h = ctx.height;
    this.buildDrops();
    this.sizeCanvas();

    this.setPaused(ctx.reducedMotion);
    if (this.paused) this.renderStill();
  }

  private buildDrops(): void {
    this.drops = DROP_SPECS.map((spec) => {
      const parts = spec.split(' ');
      const [tCls, pCls, sCls, cCls] = parts as [string, string, string, string];
      const pos = POSITIONS[pCls] ?? [0.5, 0.5];
      return {
        fx: pos[0],
        fy: pos[1],
        maxR: SIZES[sCls] ?? 100,
        rgb: hexToRgb(COLOURS[cCls] ?? '#c2c2c2'),
        phase: timingPhase(tCls),
      };
    });
  }

  private sizeCanvas(): void {
    const dpr = Math.min(this.ctx.dpr, 2);
    this.canvas.width = Math.max(1, Math.round(this.w * dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * dpr));
    this.c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.scale = Math.min(this.w, this.h * 1.4) / 900;
  }

  // ---- loop ----
  private start(): void {
    if (this.frameId !== null || typeof requestAnimationFrame === 'undefined') return;
    this.last = 0;
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
    if (this.last === 0) this.last = now;
    const dt = now - this.last;
    this.last = now;
    this.clock += Math.min(50, dt);
    this.render();
  }

  private render(): void {
    const ctx = this.c2d;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.w, this.h);

    for (const d of this.drops) {
      // Cycle progress 0..1, phase-offset (negative delays advance the drop).
      let k = ((this.clock - d.phase) % CYCLE) / CYCLE;
      if (k < 0) k += 1;
      // `drip`: grows 0→89% (border darkens near the end), then pops to 0 by 90%,
      // gone by 100%. Model as expand+fade over the first 89%, blank after.
      if (k >= 0.89) continue;
      const g = k / 0.89; // 0..1 growth
      const r = g * d.maxR * this.scale;
      if (r < 0.5) continue;
      // fade in quickly, hold, then dim as the ring approaches its pop
      const alpha = Math.min(1, g * 4) * (1 - g * 0.55);
      ctx.strokeStyle = `rgba(${d.rgb},${alpha.toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(d.fx * this.w, d.fy * this.h, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private renderStill(): void {
    this.clock = CYCLE * 0.4; // a mid-cycle frame so rings are visible when frozen
    this.render();
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
    if (dpr !== undefined) this.ctx.dpr = dpr;
    this.sizeCanvas();
    if (this.paused) this.renderStill();
  }

  dispose(): void {
    this.stop();
    if (typeof HTMLCanvasElement !== 'undefined' && this.canvas instanceof HTMLCanvasElement) this.canvas.remove();
  }
}

/** The hard-rain saver plugin. */
export const hardRain: SaverPlugin = {
  manifest: hardRainManifest,
  mount: (ctx: SaverContext) => new HardRainInstance(ctx),
};
