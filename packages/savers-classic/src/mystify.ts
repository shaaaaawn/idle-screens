import type { Rng, SaverContext, SaverInstance, SaverManifest, SaverPlugin } from '@idle-screens/core';

/**
 * Mystify — bouncing polygon outlines that morph and leave fading trails. Inspired by
 * the Windows XP "Mystify" screensaver (clean-room recreation; concept is generic).
 * Each shape is a closed polygon whose vertices move independently and reflect off the
 * viewport edges; a light fade each frame leaves the classic ribbon trails. No external
 * assets.
 */
export const mystifyManifest: SaverManifest = {
  id: 'mystify',
  label: 'Mystify',
  passthrough: false,
  minBackend: 'canvas2d',
  costTier: 'low',
  motionIntensity: 'moderate',
  reducedMotionFallback: 'static',
  a11y: { flashSafe: true, notes: 'Slow-fade polygon trails on black; no strobing.' },
  workerReady: true,
};

const SHAPE_COUNT = 3;
const TRAIL_ALPHA = 0.12;

interface Vertex {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface Shape {
  hue: number;
  verts: Vertex[];
}

class MystifyInstance implements SaverInstance {
  private readonly ctxSaver: SaverContext;
  private readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private readonly ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private shapes: Shape[] = [];
  private frameId: number | null = null;
  private last = 0;
  private paused = false;

  constructor(ctx: SaverContext) {
    this.ctxSaver = ctx;
    let canvas: HTMLCanvasElement | OffscreenCanvas;
    if (ctx.surface) {
      canvas = ctx.surface;
    } else {
      const el = document.createElement('canvas');
      el.style.cssText = 'display:block;width:100%;height:100%';
      el.setAttribute('aria-hidden', 'true');
      ctx.host.appendChild(el);
      canvas = el;
    }
    this.canvas = canvas;
    const c2d = canvas.getContext('2d', { alpha: false }) as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!c2d) throw new Error('mystify: no 2d context');
    this.ctx = c2d;

    this.w = ctx.width;
    this.h = ctx.height;
    this.sizeCanvas();
    this.shapes = this.buildShapes(ctx.rng);
    this.clearFull();

    this.paused = ctx.reducedMotion;
    if (this.paused) this.renderStill();
    else this.start();
  }

  private buildShapes(rng: Rng): Shape[] {
    const out: Shape[] = [];
    for (let s = 0; s < SHAPE_COUNT; s++) {
      const vertCount = rng.int(3, 5);
      const hue = rng.int(0, 359);
      const verts: Vertex[] = [];
      for (let v = 0; v < vertCount; v++) {
        const x = rng.range(this.w * 0.15, this.w * 0.85);
        const y = rng.range(this.h * 0.15, this.h * 0.85);
        const dir = rng.range(0, Math.PI * 2);
        const speed = rng.range(70, 150);
        verts.push({
          x,
          y,
          vx: Math.cos(dir) * speed,
          vy: Math.sin(dir) * speed,
        });
      }
      out.push({ hue, verts });
    }
    return out;
  }

  private sizeCanvas(): void {
    const dpr = Math.min(this.ctxSaver.dpr, 2);
    this.canvas.width = Math.max(1, Math.round(this.w * dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private clearFull(): void {
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.w, this.h);
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
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.update(dt);
    this.render();
  }

  private update(dt: number): void {
    for (const shape of this.shapes) {
      for (const v of shape.verts) {
        v.x += v.vx * dt;
        v.y += v.vy * dt;
        if (v.x <= 0) {
          v.x = 0;
          v.vx = Math.abs(v.vx);
        } else if (v.x >= this.w) {
          v.x = this.w;
          v.vx = -Math.abs(v.vx);
        }
        if (v.y <= 0) {
          v.y = 0;
          v.vy = Math.abs(v.vy);
        } else if (v.y >= this.h) {
          v.y = this.h;
          v.vy = -Math.abs(v.vy);
        }
      }
    }
  }

  private drawShapes(): void {
    const ctx = this.ctx;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const shape of this.shapes) {
      const { verts } = shape;
      if (verts.length < 2) continue;
      ctx.strokeStyle = `hsla(${shape.hue}, 90%, 62%, 0.92)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(verts[0].x, verts[0].y);
      for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i].x, verts[i].y);
      ctx.closePath();
      ctx.stroke();
    }
  }

  private render(): void {
    this.ctx.fillStyle = `rgba(0,0,0,${TRAIL_ALPHA})`;
    this.ctx.fillRect(0, 0, this.w, this.h);
    this.drawShapes();
  }

  private renderStill(): void {
    this.clearFull();
    this.drawShapes();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      this.stop();
      this.renderStill();
    } else {
      this.clearFull();
      this.start();
    }
  }

  resize(width: number, height: number, dpr?: number): void {
    this.w = width;
    this.h = height;
    if (dpr !== undefined) this.ctxSaver.dpr = dpr;
    this.sizeCanvas();
    for (const shape of this.shapes) {
      for (const v of shape.verts) {
        v.x = Math.min(Math.max(v.x, 0), this.w);
        v.y = Math.min(Math.max(v.y, 0), this.h);
      }
    }
    if (this.paused) this.renderStill();
    else this.clearFull();
  }

  dispose(): void {
    this.stop();
    if (typeof HTMLCanvasElement !== 'undefined' && this.canvas instanceof HTMLCanvasElement) {
      this.canvas.remove();
    }
  }
}

/** The Mystify bouncing-polygon saver plugin. */
export const mystify: SaverPlugin = {
  manifest: mystifyManifest,
  mount: (ctx: SaverContext) => new MystifyInstance(ctx),
};
