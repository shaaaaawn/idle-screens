/// <reference types="@webgpu/types" />
import type { Rng, SaverContext, SaverInstance, SaverManifest, SaverPlugin } from '@idle-screens/core';
import { ReactionDiffusionGPU } from './reaction-diffusion-gpu';
import {
  RD_DU, RD_DV, RD_F, RD_K, RD_DT,
  SEED_R, SEED_COUNT, RESEED_INTERVAL, RESEED_BATCH,
  generateSeeds, applySeedsCPU, colorV,
} from './reaction-diffusion-shared';

export const reactionDiffusionManifest: SaverManifest = {
  id: 'reaction-diffusion',
  label: 'Reaction Diffusion',
  passthrough: false,
  minBackend: 'canvas2d',
  costTier: 'low',
  motionIntensity: 'calm',
  reducedMotionFallback: 'static',
  a11y: { flashSafe: true },
};

const N = 256;
const STEPS = 32;

class ReactionDiffusionCPU implements SaverInstance {
  private readonly ctxSaver: SaverContext;
  private readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private readonly gc: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  private readonly buf: HTMLCanvasElement;
  private readonly bufCtx: CanvasRenderingContext2D;
  private readonly img: ImageData;
  private w: number;
  private h: number;

  private u = new Float32Array(N * N);
  private v = new Float32Array(N * N);
  private uN = new Float32Array(N * N);
  private vN = new Float32Array(N * N);

  private rng: Rng;
  private frameId: number | null = null;
  private frameCount = 0;

  constructor(ctx: SaverContext) {
    this.ctxSaver = ctx;
    this.w = ctx.width;
    this.h = ctx.height;
    this.rng = ctx.rng;

    let canvas: HTMLCanvasElement | OffscreenCanvas;
    if (ctx.surface) {
      canvas = ctx.surface;
    } else {
      const el = document.createElement('canvas');
      el.style.cssText = 'display:block;width:100%;height:100%';
      el.setAttribute('aria-hidden', 'true');
      el.setAttribute('data-rd-backend', 'canvas2d');
      ctx.host.appendChild(el);
      canvas = el;
    }
    this.canvas = canvas;
    const gc = canvas.getContext('2d', { alpha: false }) as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!gc) throw new Error('reaction-diffusion: no 2d context');
    this.gc = gc;

    this.buf = document.createElement('canvas');
    this.buf.width = N;
    this.buf.height = N;
    this.bufCtx = this.buf.getContext('2d')!;
    this.img = new ImageData(N, N);

    this.u.fill(1);
    applySeedsCPU(this.u, this.v, N, generateSeeds(this.rng, N, SEED_COUNT), SEED_R);

    this.sizeCanvas();

    if (ctx.reducedMotion) {
      this.renderStill();
    } else {
      this.start();
    }
  }

  private sizeCanvas(): void {
    const dpr = Math.min(this.ctxSaver.dpr, 2);
    this.canvas.width = Math.max(1, Math.round(this.w * dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * dpr));
    this.gc.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private simStep(): void {
    const { u, v, uN, vN } = this;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const idx = x + y * N;
        const lx = ((x - 1 + N) % N) + y * N;
        const rx = ((x + 1) % N) + y * N;
        const uy = x + ((y - 1 + N) % N) * N;
        const dy = x + ((y + 1) % N) * N;

        const lapU = u[lx]! + u[rx]! + u[uy]! + u[dy]! - 4 * u[idx]!;
        const lapV = v[lx]! + v[rx]! + v[uy]! + v[dy]! - 4 * v[idx]!;
        const uvv = u[idx]! * v[idx]! * v[idx]!;

        uN[idx] = Math.max(0, Math.min(1,
          u[idx]! + RD_DT * (RD_DU * lapU - uvv + RD_F * (1 - u[idx]!))));
        vN[idx] = Math.max(0, Math.min(1,
          v[idx]! + RD_DT * (RD_DV * lapV + uvv - (RD_F + RD_K) * v[idx]!)));
      }
    }
    [this.u, this.uN] = [this.uN, this.u];
    [this.v, this.vN] = [this.vN, this.v];
  }

  private render(): void {
    const data = this.img.data;
    for (let i = 0; i < N * N; i++) {
      const [r, g, b] = colorV(this.v[i]!);
      const pi = i * 4;
      data[pi] = r;
      data[pi + 1] = g;
      data[pi + 2] = b;
      data[pi + 3] = 255;
    }
    this.bufCtx.putImageData(this.img, 0, 0);
    this.gc.imageSmoothingEnabled = true;
    this.gc.drawImage(this.buf, 0, 0, this.w, this.h);
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
    this.frameCount++;
    if (this.frameCount % RESEED_INTERVAL === 0) {
      applySeedsCPU(this.u, this.v, N,
        generateSeeds(this.rng, N, RESEED_BATCH), SEED_R);
    }
    for (let i = 0; i < STEPS; i++) this.simStep();
    this.render();
  }

  private renderStill(): void {
    for (let i = 0; i < 200; i++) this.simStep();
    this.render();
  }

  setPaused(paused: boolean): void {
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

export const reactionDiffusion: SaverPlugin = {
  manifest: reactionDiffusionManifest,
  async mount(ctx: SaverContext): Promise<SaverInstance> {
    try {
      const adapter = await navigator.gpu?.requestAdapter();
      if (adapter) {
        const device = await adapter.requestDevice();
        return new ReactionDiffusionGPU(ctx, device);
      }
    } catch {
      /* WebGPU unavailable — fall through to canvas2d */
    }
    return new ReactionDiffusionCPU(ctx);
  },
};
