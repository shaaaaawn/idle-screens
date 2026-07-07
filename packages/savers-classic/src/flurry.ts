import type { Rng, SaverContext, SaverInstance, SaverManifest, SaverPlugin } from '@idle-screens/core';

export const flurryManifest: SaverManifest = {
  id: 'flurry',
  label: 'Flurry',
  passthrough: false,
  minBackend: 'canvas2d',
  costTier: 'low',
  motionIntensity: 'calm',
  reducedMotionFallback: 'static',
  a11y: { flashSafe: true },
};

const STREAM_COUNT = 5;
const PARTICLES_PER_STREAM = 12;
const TRAIL_ALPHA = 0.06;
const BASE_RADIUS = 6;

interface Stream {
  hue: number;
  freqX1: number;
  freqY1: number;
  freqX2: number;
  freqY2: number;
  phaseX: number;
  phaseY: number;
  ampX: number;
  ampY: number;
  speed: number;
}

class FlurryInstance implements SaverInstance {
  private readonly ctxSaver: SaverContext;
  private readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private readonly ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private streams: Stream[];
  private frameId: number | null = null;
  private t = 0;
  private lastTime = 0;
  private paused = false;

  constructor(ctx: SaverContext) {
    this.ctxSaver = ctx;
    this.w = ctx.width;
    this.h = ctx.height;

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
    if (!c2d) throw new Error('flurry: no 2d context');
    this.ctx = c2d;

    this.streams = this.buildStreams(ctx.rng);
    this.sizeCanvas();
    this.clearFull();

    this.paused = ctx.reducedMotion;
    if (this.paused) {
      this.renderStill();
    } else {
      this.start();
    }
  }

  private buildStreams(rng: Rng): Stream[] {
    const out: Stream[] = [];
    for (let i = 0; i < STREAM_COUNT; i++) {
      out.push({
        hue: (i * 360 / STREAM_COUNT + rng.range(0, 30)) % 360,
        freqX1: rng.range(0.3, 0.9),
        freqY1: rng.range(0.3, 0.9),
        freqX2: rng.range(0.1, 0.4),
        freqY2: rng.range(0.1, 0.4),
        phaseX: rng.range(0, Math.PI * 2),
        phaseY: rng.range(0, Math.PI * 2),
        ampX: rng.range(0.2, 0.4),
        ampY: rng.range(0.2, 0.4),
        speed: rng.range(0.6, 1.2),
      });
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

  private streamPos(s: Stream, t: number): [number, number] {
    const cx = this.w / 2;
    const cy = this.h / 2;
    const x = cx + Math.sin(t * s.freqX1 + s.phaseX) * this.w * s.ampX
                  + Math.sin(t * s.freqX2 + s.phaseX * 1.7) * this.w * s.ampX * 0.3;
    const y = cy + Math.cos(t * s.freqY1 + s.phaseY) * this.h * s.ampY
                  + Math.cos(t * s.freqY2 + s.phaseY * 2.1) * this.h * s.ampY * 0.3;
    return [x, y];
  }

  private drawFrame(dt: number): void {
    const ctx = this.ctx;

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(0,0,0,${TRAIL_ALPHA})`;
    ctx.fillRect(0, 0, this.w, this.h);

    ctx.globalCompositeOperation = 'lighter';

    for (const s of this.streams) {
      const st = this.t * s.speed;
      for (let p = 0; p < PARTICLES_PER_STREAM; p++) {
        const offset = p * 0.012;
        const [x, y] = this.streamPos(s, st - offset);

        const hue = (s.hue + this.t * 8 + p * 3) % 360;
        const alpha = 0.15 + 0.1 * (1 - p / PARTICLES_PER_STREAM);
        const r = BASE_RADIUS * (1 - p * 0.04);

        const grad = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
        grad.addColorStop(0, `hsla(${hue},90%,60%,${alpha})`);
        grad.addColorStop(0.4, `hsla(${hue},80%,50%,${alpha * 0.5})`);
        grad.addColorStop(1, `hsla(${hue},70%,40%,0)`);

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.globalCompositeOperation = 'source-over';
  }

  private start(): void {
    if (this.frameId !== null || typeof requestAnimationFrame === 'undefined') return;
    this.lastTime = 0;
    this.loop(0);
  }

  private stop(): void {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }

  private loop(now: number): void {
    this.frameId = requestAnimationFrame((n) => this.loop(n));
    const dt = this.lastTime ? (now - this.lastTime) / 1000 : 1 / 60;
    this.lastTime = now;
    this.t += Math.min(dt, 0.1);
    this.drawFrame(dt);
  }

  private renderStill(): void {
    this.clearFull();
    for (let i = 0; i < 120; i++) {
      this.t += 1 / 60;
      this.drawFrame(1 / 60);
    }
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      this.stop();
    } else {
      this.start();
    }
  }

  resize(width: number, height: number, dpr?: number): void {
    this.w = width;
    this.h = height;
    if (dpr !== undefined) this.ctxSaver.dpr = dpr;
    this.sizeCanvas();
    this.clearFull();
  }

  dispose(): void {
    this.stop();
    if (this.canvas instanceof HTMLCanvasElement) this.canvas.remove();
  }
}

export const flurry: SaverPlugin = {
  manifest: flurryManifest,
  mount: (ctx: SaverContext) => new FlurryInstance(ctx),
};
