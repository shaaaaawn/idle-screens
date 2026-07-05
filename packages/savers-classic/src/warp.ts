import type { SaverContext, SaverInstance, SaverManifest, SaverPlugin } from '@idle-screens/core';

/**
 * Warp — fly through the stars at hyperspace speed. The original was a stack of
 * CSS star-layer PNGs zooming outward; this port is a self-contained canvas2d
 * starfield: each star has an (x, y, z), z decreases toward the eye, projects to
 * screen and draws a motion-streak from its previous depth, giving the classic
 * radial warp. No external assets.
 *
 * Honours pause (freeze on last frame) + reducedMotion (a single still frame).
 */
export const warpManifest: SaverManifest = {
  id: 'warp',
  label: 'Warp',
  passthrough: false,
  minBackend: 'canvas2d',
  costTier: 'low',
  motionIntensity: 'energetic',
  reducedMotionFallback: 'static',
  a11y: { flashSafe: true },
};

interface Star {
  x: number; // -1..1 field position
  y: number;
  z: number; // depth, (0, 1]; smaller = closer
  pz: number; // previous z for streak length
}

const STAR_COUNT = 520;
const SPEED = 0.012; // depth travelled per frame

class WarpInstance implements SaverInstance {
  private readonly ctxSaver: SaverContext;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  private w = 0;
  private h = 0;
  private stars: Star[] = [];
  private frameId: number | null = null;
  private paused = false;

  constructor(ctx: SaverContext) {
    this.ctxSaver = ctx;
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:100%;height:100%';
    canvas.setAttribute('aria-hidden', 'true');
    ctx.host.appendChild(canvas);
    this.canvas = canvas;
    const c2d = canvas.getContext('2d', { alpha: false });
    if (!c2d) throw new Error('warp: no 2d context');
    this.ctx = c2d;

    this.w = ctx.width;
    this.h = ctx.height;
    this.sizeCanvas();
    this.buildStars();

    this.paused = ctx.reducedMotion;
    if (this.paused) this.renderStill();
    else this.start();
  }

  private sizeCanvas(): void {
    const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
    this.canvas.width = Math.max(1, Math.round(this.w * dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private buildStars(): void {
    const rng = this.ctxSaver.rng;
    this.stars = new Array(STAR_COUNT);
    for (let i = 0; i < STAR_COUNT; i++) {
      this.stars[i] = this.spawn(rng.range(0.01, 1));
    }
  }

  private spawn(z: number): Star {
    const rng = this.ctxSaver.rng;
    return {
      x: rng.range(-1, 1),
      y: rng.range(-1, 1),
      z,
      pz: z,
    };
  }

  private start(): void {
    if (this.frameId !== null || typeof requestAnimationFrame === 'undefined') return;
    this.loop();
  }

  private stop(): void {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }

  private loop(): void {
    this.frameId = requestAnimationFrame(() => this.loop());
    this.step();
    this.render();
  }

  private step(): void {
    for (const s of this.stars) {
      s.pz = s.z;
      s.z -= SPEED;
      if (s.z <= 0.01) {
        const respawned = this.spawn(1);
        s.x = respawned.x;
        s.y = respawned.y;
        s.z = 1;
        s.pz = 1;
      }
    }
  }

  private render(): void {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    const cx = w / 2;
    const cy = h / 2;
    const focal = Math.min(w, h) * 0.9;

    // Slight trail for a warm streaking feel.
    ctx.fillStyle = 'rgba(17,17,17,0.45)';
    ctx.fillRect(0, 0, w, h);

    ctx.lineCap = 'round';
    for (const s of this.stars) {
      const sx = cx + (s.x / s.z) * focal;
      const sy = cy + (s.y / s.z) * focal;
      const px = cx + (s.x / s.pz) * focal;
      const py = cy + (s.y / s.pz) * focal;
      if (sx < -50 || sx > w + 50 || sy < -50 || sy > h + 50) continue;
      const depth = 1 - s.z; // 0 far .. 1 near
      const alpha = Math.min(1, 0.15 + depth * 1.1);
      const size = Math.max(0.4, depth * 2.6);
      ctx.strokeStyle = `rgba(220,235,255,${alpha.toFixed(3)})`;
      ctx.lineWidth = size;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(sx, sy);
      ctx.stroke();
    }
  }

  private renderStill(): void {
    // Static frame: paint the field once with no motion streaks.
    const ctx = this.ctx;
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, this.w, this.h);
    const cx = this.w / 2;
    const cy = this.h / 2;
    const focal = Math.min(this.w, this.h) * 0.9;
    for (const s of this.stars) {
      const sx = cx + (s.x / s.z) * focal;
      const sy = cy + (s.y / s.z) * focal;
      if (sx < 0 || sx > this.w || sy < 0 || sy > this.h) continue;
      const depth = 1 - s.z;
      const alpha = Math.min(1, 0.15 + depth * 1.1);
      const size = Math.max(0.4, depth * 2.6);
      ctx.fillStyle = `rgba(220,235,255,${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(sx, sy, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      this.stop();
      this.renderStill();
    } else {
      this.start();
    }
  }

  resize(width: number, height: number): void {
    this.w = width;
    this.h = height;
    this.sizeCanvas();
    if (this.paused) this.renderStill();
  }

  dispose(): void {
    this.stop();
    this.canvas.remove();
  }
}

/** The Warp starfield saver plugin. */
export const warp: SaverPlugin = {
  manifest: warpManifest,
  mount: (ctx: SaverContext) => new WarpInstance(ctx),
};
