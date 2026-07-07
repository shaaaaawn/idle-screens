/// <reference types="@webgpu/types" />
import type { Rng, SaverContext, SaverInstance, SaverManifest, SaverPlugin } from '@idle-screens/core';
import { FluidGPU } from './fluid-gpu';
import {
  DT,
  DENS_DECAY,
  VEL_DECAY,
  DYE_RATE,
  FORCE_RATE,
  EMITTER_N,
  hue2rgb,
  type Emitter,
} from './fluid-shared';

export const fluidManifest: SaverManifest = {
  id: 'fluid',
  label: 'Fluid',
  passthrough: false,
  minBackend: 'canvas2d',
  costTier: 'low',
  motionIntensity: 'calm',
  reducedMotionFallback: 'static',
  a11y: { flashSafe: true },
};

const N = 96;
const SZ = (N + 2) * (N + 2);
const DIFF = 0.00003;
const VISC = 0.0003;
const GS_ITER = 4;
const INJECT_R = 4;

function IX(i: number, j: number): number {
  return i + (N + 2) * j;
}

class FluidCPU implements SaverInstance {
  private readonly ctxSaver: SaverContext;
  private readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private readonly gc: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  private readonly buf: HTMLCanvasElement;
  private readonly bufCtx: CanvasRenderingContext2D;
  private readonly img: ImageData;
  private w = 0;
  private h = 0;

  private u = new Float32Array(SZ);
  private v = new Float32Array(SZ);
  private u0 = new Float32Array(SZ);
  private v0 = new Float32Array(SZ);
  private dr = new Float32Array(SZ);
  private dg = new Float32Array(SZ);
  private db = new Float32Array(SZ);
  private dr0 = new Float32Array(SZ);
  private dg0 = new Float32Array(SZ);
  private db0 = new Float32Array(SZ);
  private tmp = new Float32Array(SZ);

  private emitters: Emitter[];
  private t = 0;
  private frameId: number | null = null;
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
      el.setAttribute('data-fluid-backend', 'canvas2d');
      ctx.host.appendChild(el);
      canvas = el;
    }
    this.canvas = canvas;
    const gc = canvas.getContext('2d', { alpha: false }) as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!gc) throw new Error('fluid: no 2d context');
    this.gc = gc;

    this.buf = document.createElement('canvas');
    this.buf.width = N;
    this.buf.height = N;
    this.bufCtx = this.buf.getContext('2d')!;
    this.img = new ImageData(N, N);

    this.emitters = this.buildEmitters(ctx.rng);
    this.sizeCanvas();

    this.paused = ctx.reducedMotion;
    if (this.paused) {
      this.renderStill();
    } else {
      this.start();
    }
  }

  private buildEmitters(rng: Rng): Emitter[] {
    const out: Emitter[] = [];
    for (let i = 0; i < EMITTER_N; i++) {
      const cx = N / 2 + 1;
      out.push({
        hue: ((i * 360) / EMITTER_N + rng.range(0, 40)) % 360,
        fx: rng.range(0.3, 0.8),
        fy: rng.range(0.3, 0.8),
        px: rng.range(0, Math.PI * 2),
        py: rng.range(0, Math.PI * 2),
        speed: rng.range(0.5, 1.0),
        prevGx: cx,
        prevGy: cx,
      });
    }
    return out;
  }

  private sizeCanvas(): void {
    const dpr = Math.min(this.ctxSaver.dpr, 2);
    this.canvas.width = Math.max(1, Math.round(this.w * dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * dpr));
    this.gc.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // --- Stam stable-fluids solver ---

  private setBnd(b: number, x: Float32Array): void {
    for (let i = 1; i <= N; i++) {
      x[IX(0, i)] = b === 1 ? -x[IX(1, i)] : x[IX(1, i)];
      x[IX(N + 1, i)] = b === 1 ? -x[IX(N, i)] : x[IX(N, i)];
      x[IX(i, 0)] = b === 2 ? -x[IX(i, 1)] : x[IX(i, 1)];
      x[IX(i, N + 1)] = b === 2 ? -x[IX(i, N)] : x[IX(i, N)];
    }
    x[IX(0, 0)] = 0.5 * (x[IX(1, 0)] + x[IX(0, 1)]);
    x[IX(0, N + 1)] = 0.5 * (x[IX(1, N + 1)] + x[IX(0, N)]);
    x[IX(N + 1, 0)] = 0.5 * (x[IX(N, 0)] + x[IX(N + 1, 1)]);
    x[IX(N + 1, N + 1)] = 0.5 * (x[IX(N, N + 1)] + x[IX(N + 1, N)]);
  }

  private diffuse(b: number, x: Float32Array, x0: Float32Array, diff: number): void {
    const a = DT * diff * N * N;
    if (a === 0) {
      x.set(x0);
      return;
    }
    const denom = 1 + 4 * a;
    for (let k = 0; k < GS_ITER; k++) {
      for (let j = 1; j <= N; j++) {
        for (let i = 1; i <= N; i++) {
          const idx = IX(i, j);
          x[idx] =
            (x0[idx] + a * (x[IX(i - 1, j)] + x[IX(i + 1, j)] + x[IX(i, j - 1)] + x[IX(i, j + 1)])) /
            denom;
        }
      }
      this.setBnd(b, x);
    }
  }

  private advect(b: number, d: Float32Array, d0: Float32Array, u: Float32Array, v: Float32Array): void {
    const dt0 = DT * N;
    for (let j = 1; j <= N; j++) {
      for (let i = 1; i <= N; i++) {
        const idx = IX(i, j);
        let x = i - dt0 * u[idx];
        let y = j - dt0 * v[idx];
        if (x < 0.5) x = 0.5;
        if (x > N + 0.5) x = N + 0.5;
        if (y < 0.5) y = 0.5;
        if (y > N + 0.5) y = N + 0.5;
        const i0 = Math.floor(x);
        const j0 = Math.floor(y);
        const s1 = x - i0;
        const s0 = 1 - s1;
        const t1 = y - j0;
        const t0 = 1 - t1;
        d[idx] =
          s0 * (t0 * d0[IX(i0, j0)] + t1 * d0[IX(i0, j0 + 1)]) +
          s1 * (t0 * d0[IX(i0 + 1, j0)] + t1 * d0[IX(i0 + 1, j0 + 1)]);
      }
    }
    this.setBnd(b, d);
  }

  private project(u: Float32Array, v: Float32Array, p: Float32Array, div: Float32Array): void {
    const h = 1 / N;
    for (let j = 1; j <= N; j++) {
      for (let i = 1; i <= N; i++) {
        const idx = IX(i, j);
        div[idx] = -0.5 * h * (u[IX(i + 1, j)] - u[IX(i - 1, j)] + v[IX(i, j + 1)] - v[IX(i, j - 1)]);
        p[idx] = 0;
      }
    }
    this.setBnd(0, div);
    this.setBnd(0, p);
    for (let k = 0; k < GS_ITER; k++) {
      for (let j = 1; j <= N; j++) {
        for (let i = 1; i <= N; i++) {
          const idx = IX(i, j);
          p[idx] = (div[idx] + p[IX(i - 1, j)] + p[IX(i + 1, j)] + p[IX(i, j - 1)] + p[IX(i, j + 1)]) / 4;
        }
      }
      this.setBnd(0, p);
    }
    for (let j = 1; j <= N; j++) {
      for (let i = 1; i <= N; i++) {
        const idx = IX(i, j);
        u[idx] -= 0.5 * N * (p[IX(i + 1, j)] - p[IX(i - 1, j)]);
        v[idx] -= 0.5 * N * (p[IX(i, j + 1)] - p[IX(i, j - 1)]);
      }
    }
    this.setBnd(1, u);
    this.setBnd(2, v);
  }

  private velStep(): void {
    for (let i = 0; i < SZ; i++) {
      this.u[i] += DT * this.u0[i];
      this.v[i] += DT * this.v0[i];
    }
    [this.u, this.u0] = [this.u0, this.u];
    this.diffuse(1, this.u, this.u0, VISC);
    [this.v, this.v0] = [this.v0, this.v];
    this.diffuse(2, this.v, this.v0, VISC);
    this.project(this.u, this.v, this.u0, this.v0);
    [this.u, this.u0] = [this.u0, this.u];
    [this.v, this.v0] = [this.v0, this.v];
    this.advect(1, this.u, this.u0, this.u0, this.v0);
    this.advect(2, this.v, this.v0, this.u0, this.v0);
    this.project(this.u, this.v, this.u0, this.v0);
    for (let i = 0; i < SZ; i++) {
      this.u[i] *= VEL_DECAY;
      this.v[i] *= VEL_DECAY;
    }
  }

  private densStep(d: Float32Array, d0: Float32Array): void {
    for (let i = 0; i < SZ; i++) d[i] += DT * d0[i];
    this.tmp.set(d);
    this.diffuse(0, d, this.tmp, DIFF);
    this.tmp.set(d);
    this.advect(0, d, this.tmp, this.u, this.v);
    for (let i = 0; i < SZ; i++) d[i] *= DENS_DECAY;
  }

  // --- Source injection ---

  private injectSources(): void {
    this.u0.fill(0);
    this.v0.fill(0);
    this.dr0.fill(0);
    this.dg0.fill(0);
    this.db0.fill(0);

    for (const e of this.emitters) {
      const st = this.t * e.speed;
      const gx = (Math.sin(st * e.fx + e.px) * 0.35 + 0.5) * N + 1;
      const gy = (Math.cos(st * e.fy + e.py) * 0.35 + 0.5) * N + 1;
      const dx = gx - e.prevGx;
      const dy = gy - e.prevGy;

      const ci = Math.round(gx);
      const cj = Math.round(gy);
      const [cr, cg, cb] = hue2rgb(e.hue + this.t * 15);

      for (let di = -INJECT_R; di <= INJECT_R; di++) {
        for (let dj = -INJECT_R; dj <= INJECT_R; dj++) {
          const ii = ci + di;
          const jj = cj + dj;
          if (ii < 1 || ii > N || jj < 1 || jj > N) continue;
          const dist = Math.sqrt(di * di + dj * dj);
          if (dist > INJECT_R) continue;
          const s = 1 - dist / INJECT_R;
          const idx = IX(ii, jj);
          this.dr0[idx] += cr * DYE_RATE * s;
          this.dg0[idx] += cg * DYE_RATE * s;
          this.db0[idx] += cb * DYE_RATE * s;
          this.u0[idx] += dx * FORCE_RATE * s;
          this.v0[idx] += dy * FORCE_RATE * s;
        }
      }
      e.prevGx = gx;
      e.prevGy = gy;
    }
  }

  // --- Simulation step ---

  private simStep(): void {
    this.injectSources();
    this.velStep();
    this.densStep(this.dr, this.dr0);
    this.densStep(this.dg, this.dg0);
    this.densStep(this.db, this.db0);
  }

  // --- Rendering ---

  private render(): void {
    const data = this.img.data;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const si = IX(i + 1, j + 1);
        const pi = (j * N + i) * 4;
        data[pi] = Math.min(255, this.dr[si] | 0);
        data[pi + 1] = Math.min(255, this.dg[si] | 0);
        data[pi + 2] = Math.min(255, this.db[si] | 0);
        data[pi + 3] = 255;
      }
    }
    this.bufCtx.putImageData(this.img, 0, 0);
    this.gc.imageSmoothingEnabled = true;
    this.gc.drawImage(this.buf, 0, 0, this.w, this.h);
  }

  // --- Animation ---

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
    this.t += DT;
    this.simStep();
    this.render();
  }

  private renderStill(): void {
    for (let i = 0; i < 200; i++) {
      this.t += DT;
      this.simStep();
    }
    this.render();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.stop();
    else this.start();
  }

  resize(width: number, height: number, dpr?: number): void {
    this.w = width;
    this.h = height;
    if (dpr !== undefined) this.ctxSaver.dpr = dpr;
    this.sizeCanvas();
    this.render();
  }

  dispose(): void {
    this.stop();
    if (this.canvas instanceof HTMLCanvasElement) this.canvas.remove();
  }
}

export const fluid: SaverPlugin = {
  manifest: fluidManifest,
  async mount(ctx: SaverContext): Promise<SaverInstance> {
    try {
      const adapter = await navigator.gpu?.requestAdapter();
      if (adapter) {
        const device = await adapter.requestDevice();
        return new FluidGPU(ctx, device);
      }
    } catch {
      /* WebGPU unavailable — fall through to canvas2d */
    }
    return new FluidCPU(ctx);
  },
};
