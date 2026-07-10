import type {
  SaverContext,
  SaverInstance,
  SaverManifest,
  SaverPlugin,
} from '@idle-screens/core';

// Ported from the After Dark "Spotlight" screensaver (c) Berkeley Systems.
// HTML/CSS reference: after-dark-css (MIT, github.com/bryanbraun/after-dark-css).
export const spotlightManifest: SaverManifest = {
  id: 'spotlight',
  label: 'Spotlight',
  passthrough: true,
  minBackend: 'canvas2d',
  costTier: 'low',
  motionIntensity: 'calm',
  reducedMotionFallback: 'static',
  a11y: { flashSafe: true, notes: 'A soft light circle drifting over the live page; no flashing.' },
  workerReady: true,
};

const HOLE_RADIUS = 220;
const SPEED_X = 5000;
const SPEED_Y = 5600;

class SpotlightInstance implements SaverInstance {
  private readonly ctx: SaverContext;
  private readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private readonly c2d: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

  private w = 0;
  private h = 0;

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
    const c2d = canvas.getContext('2d', { alpha: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!c2d) throw new Error('spotlight: no 2d context');
    this.c2d = c2d;

    this.w = ctx.width;
    this.h = ctx.height;
    this.sizeCanvas();

    this.setPaused(ctx.reducedMotion);
    if (this.paused) this.render();
  }

  private sizeCanvas(): void {
    const dpr = Math.min(this.ctx.dpr, 2);
    this.canvas.width = Math.max(1, Math.round(this.w * dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * dpr));
    this.c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private centre(): [number, number] {
    const tri = (t: number, period: number): number => {
      const p = ((t % (period * 2)) + period * 2) % (period * 2);
      return p < period ? p / period : 2 - p / period;
    };
    const kx = tri(this.clock, SPEED_X);
    const ky = tri(this.clock, SPEED_Y);
    const x = HOLE_RADIUS + kx * (this.w - HOLE_RADIUS * 2);
    const y = HOLE_RADIUS + ky * (this.h - HOLE_RADIUS * 2);
    return [x, y];
  }

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
    this.clock += Math.min(50, now - this.last);
    this.last = now;
    this.render();
  }

  private render(): void {
    const ctx = this.c2d;
    const [sx, sy] = this.centre();

    ctx.clearRect(0, 0, this.w, this.h);

    // Dark mask everywhere with a transparent hole at the spotlight position.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.92)';
    ctx.fillRect(0, 0, this.w, this.h);

    // Punch the hole: erase to transparent in a soft radial.
    ctx.globalCompositeOperation = 'destination-out';
    const hole = ctx.createRadialGradient(sx, sy, 0, sx, sy, HOLE_RADIUS * 1.15);
    hole.addColorStop(0, 'rgba(0,0,0,1)');
    hole.addColorStop(0.62, 'rgba(0,0,0,1)');
    hole.addColorStop(0.85, 'rgba(0,0,0,0.5)');
    hole.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = hole;
    ctx.fillRect(sx - HOLE_RADIUS * 1.2, sy - HOLE_RADIUS * 1.2, HOLE_RADIUS * 2.4, HOLE_RADIUS * 2.4);
    ctx.globalCompositeOperation = 'source-over';

    // Soft warm glow inside the lit circle.
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, HOLE_RADIUS);
    glow.addColorStop(0, 'rgba(255,250,230,0.12)');
    glow.addColorStop(1, 'rgba(255,250,230,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(sx, sy, HOLE_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      this.stop();
      this.render();
    } else {
      this.start();
    }
  }

  resize(width: number, height: number, dpr?: number): void {
    this.w = width;
    this.h = height;
    if (dpr !== undefined) this.ctx.dpr = dpr;
    this.sizeCanvas();
    if (this.paused) this.render();
  }

  dispose(): void {
    this.stop();
    if (typeof HTMLCanvasElement !== 'undefined' && this.canvas instanceof HTMLCanvasElement) this.canvas.remove();
  }
}

export const spotlight: SaverPlugin = {
  manifest: spotlightManifest,
  mount: (ctx: SaverContext) => new SpotlightInstance(ctx),
};
