import type {
  SaverContext,
  SaverInstance,
  SaverManifest,
  SaverPlugin,
} from '@idle-screens/core';

/**
 * Globe — a spinning globe bounces around the screen. Inspired by the After Dark
 * "Globe" screensaver (MIT port, github.com/bryanbraun/after-dark-css); artwork
 * © Berkeley Systems.
 *
 * The Angular original sprite-scrolled a `globe_240.jpg` to fake the spin and
 * drifted it corner-to-corner. Per the library's no-external-asset rule, the
 * globe is re-authored dependency-free on canvas2d as a dotted wireframe sphere:
 * a lat/long grid of points rotated about the vertical axis, back-face dimmed,
 * bouncing around the viewport DVD-style.
 */
export const globeManifest: SaverManifest = {
  id: 'globe',
  label: 'Globe',
  passthrough: false,
  minBackend: 'canvas2d',
  costTier: 'low',
  motionIntensity: 'calm',
  reducedMotionFallback: 'static',
  a11y: { flashSafe: true, notes: 'A slowly spinning dotted globe drifting on black; no flashing.' },
  workerReady: true,
};

const RADIUS = 120; // globe radius (px) — matches the original 240px diameter
const SPIN = 0.9; // radians / second
const LAT_LINES = 11;
const LON_LINES = 21;

interface Point3 {
  x: number;
  y: number;
  z: number;
}

class GlobeInstance implements SaverInstance {
  private readonly ctx: SaverContext;
  private readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private readonly c2d: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

  private w = 0;
  private h = 0;

  // globe centre + velocity (DVD bounce)
  private cx = 0;
  private cy = 0;
  private vx = 0;
  private vy = 0;
  private spinPhase = 0;

  // precomputed unit-sphere lattice (spun about Y at render time)
  private readonly lattice: Point3[] = [];

  private frameId: number | null = null;
  private paused = false;
  private last = 0;

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
    if (!c2d) throw new Error('globe: no 2d context');
    this.c2d = c2d;

    this.buildLattice();

    this.w = ctx.width;
    this.h = ctx.height;
    this.sizeCanvas();

    const rng = ctx.rng;
    this.cx = rng.range(RADIUS, Math.max(RADIUS + 1, this.w - RADIUS));
    this.cy = rng.range(RADIUS, Math.max(RADIUS + 1, this.h - RADIUS));
    const dir = rng.range(0, Math.PI * 2);
    const speed = 90; // px/s
    this.vx = Math.cos(dir) * speed;
    this.vy = Math.sin(dir) * speed;

    this.setPaused(ctx.reducedMotion);
    if (this.paused) this.renderStill();
  }

  /** Dotted lat/long lattice on the unit sphere. */
  private buildLattice(): void {
    for (let i = 1; i < LAT_LINES; i++) {
      const lat = -Math.PI / 2 + (Math.PI * i) / LAT_LINES; // -90..+90
      const ringR = Math.cos(lat);
      const y = Math.sin(lat);
      const dots = Math.max(6, Math.round(LON_LINES * ringR + 4));
      for (let j = 0; j < dots; j++) {
        const lon = (Math.PI * 2 * j) / dots;
        this.lattice.push({ x: ringR * Math.cos(lon), y, z: ringR * Math.sin(lon) });
      }
    }
    // longitude meridians (denser dots so the "spin" reads clearly)
    for (let m = 0; m < LON_LINES; m++) {
      const lon = (Math.PI * 2 * m) / LON_LINES;
      for (let s = 0; s <= 24; s++) {
        const lat = -Math.PI / 2 + (Math.PI * s) / 24;
        const ringR = Math.cos(lat);
        this.lattice.push({ x: ringR * Math.cos(lon), y: Math.sin(lat), z: ringR * Math.sin(lon) });
      }
    }
  }

  private sizeCanvas(): void {
    const dpr = Math.min(this.ctx.dpr, 2);
    this.canvas.width = Math.max(1, Math.round(this.w * dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * dpr));
    this.c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.update(dt);
    this.render();
  }

  private update(dt: number): void {
    this.spinPhase += SPIN * dt;
    this.cx += this.vx * dt;
    this.cy += this.vy * dt;
    const minX = RADIUS;
    const maxX = this.w - RADIUS;
    const minY = RADIUS;
    const maxY = this.h - RADIUS;
    if (this.cx < minX) { this.cx = minX; this.vx = Math.abs(this.vx); }
    else if (this.cx > maxX) { this.cx = maxX; this.vx = -Math.abs(this.vx); }
    if (this.cy < minY) { this.cy = minY; this.vy = Math.abs(this.vy); }
    else if (this.cy > maxY) { this.cy = maxY; this.vy = -Math.abs(this.vy); }
  }

  private render(): void {
    const ctx = this.c2d;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.w, this.h);

    // Subtle body disc so the globe reads as a solid sphere.
    const body = ctx.createRadialGradient(
      this.cx - RADIUS * 0.35, this.cy - RADIUS * 0.35, RADIUS * 0.1,
      this.cx, this.cy, RADIUS,
    );
    body.addColorStop(0, 'rgba(30,60,90,0.55)');
    body.addColorStop(1, 'rgba(6,14,26,0.15)');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, RADIUS, 0, Math.PI * 2);
    ctx.fill();

    // Spun lattice → project (orthographic; +z toward viewer).
    const cos = Math.cos(this.spinPhase);
    const sin = Math.sin(this.spinPhase);
    for (const p of this.lattice) {
      const rx = p.x * cos + p.z * sin;
      const rz = -p.x * sin + p.z * cos;
      const x = this.cx + rx * RADIUS;
      const y = this.cy + p.y * RADIUS;
      // depth 0 (back) .. 1 (front)
      const depth = (rz + 1) / 2;
      const alpha = 0.12 + depth * 0.7;
      const size = 0.7 + depth * 1.2;
      ctx.fillStyle = `rgba(120,200,255,${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }

    // Rim to close the silhouette.
    ctx.strokeStyle = 'rgba(120,200,255,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, RADIUS, 0, Math.PI * 2);
    ctx.stroke();
  }

  private renderStill(): void {
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
    // keep the globe inside the new bounds
    this.cx = Math.min(Math.max(this.cx, RADIUS), Math.max(RADIUS, this.w - RADIUS));
    this.cy = Math.min(Math.max(this.cy, RADIUS), Math.max(RADIUS, this.h - RADIUS));
    if (this.paused) this.renderStill();
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
