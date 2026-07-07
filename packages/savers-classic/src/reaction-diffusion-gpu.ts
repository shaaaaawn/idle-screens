/// <reference types="@webgpu/types" />
import type { Rng, SaverContext, SaverInstance } from '@idle-screens/core';
import {
  RD_DU, RD_DV, RD_F, RD_K, RD_DT,
  SEED_R, SEED_COUNT, RESEED_INTERVAL, RESEED_BATCH,
  generateSeeds,
} from './reaction-diffusion-shared';

const GPU_N = 512;
const GPU_SEED_R = Math.round(SEED_R * (GPU_N / 256));
const GPU_STEPS = 32;
const WG = 8;

const SIM_WGSL = /* wgsl */ `
override N: u32;

const Du = ${RD_DU};
const Dv = ${RD_DV};
const f  = ${RD_F};
const k  = ${RD_K};
const dt = ${RD_DT};

@group(0) @binding(0) var<storage, read>       src: array<vec2f>;
@group(0) @binding(1) var<storage, read_write> dst: array<vec2f>;

@compute @workgroup_size(${WG}, ${WG})
fn main(@builtin(global_invocation_id) id: vec3u) {
  let x = id.x;
  let y = id.y;
  if (x >= N || y >= N) { return; }

  let idx = x + y * N;
  let c = src[idx];

  let lx = ((x + N - 1u) % N) + y * N;
  let rx = ((x + 1u)     % N) + y * N;
  let uy = x + ((y + N - 1u) % N) * N;
  let dy = x + ((y + 1u)     % N) * N;

  let lap = src[lx] + src[rx] + src[uy] + src[dy] - 4.0 * c;

  let uvv = c.x * c.y * c.y;
  let nu = c.x + dt * (Du * lap.x - uvv + f * (1.0 - c.x));
  let nv = c.y + dt * (Dv * lap.y + uvv - (f + k) * c.y);

  dst[idx] = clamp(vec2f(nu, nv), vec2f(0.0), vec2f(1.0));
}`;

const RENDER_WGSL = /* wgsl */ `
override N: u32;

@group(0) @binding(0) var<storage, read> field: array<vec2f>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0)       uv:  vec2f,
}

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VOut {
  var p = array<vec2f, 3>(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
  var o: VOut;
  o.pos = vec4f(p[i], 0, 1);
  o.uv  = (p[i] + 1.0) * 0.5;
  o.uv.y = 1.0 - o.uv.y;
  return o;
}

@fragment
fn fs(v: VOut) -> @location(0) vec4f {
  let x = min(u32(v.uv.x * f32(N)), N - 1u);
  let y = min(u32(v.uv.y * f32(N)), N - 1u);
  let val = field[x + y * N];

  let t = clamp(val.y * 3.0, 0.0, 1.0);

  let c0 = vec3f(0.039, 0.039, 0.180);
  let c1 = vec3f(0.051, 0.302, 0.400);
  let c2 = vec3f(0.878, 0.439, 0.251);
  let c3 = vec3f(0.941, 0.820, 0.627);

  var color: vec3f;
  if (t < 0.33) {
    color = mix(c0, c1, t / 0.33);
  } else if (t < 0.66) {
    color = mix(c1, c2, (t - 0.33) / 0.33);
  } else {
    color = mix(c2, c3, (t - 0.66) / 0.34);
  }

  return vec4f(color, 1.0);
}`;

export class ReactionDiffusionGPU implements SaverInstance {
  private readonly device: GPUDevice;
  private readonly canvas: HTMLCanvasElement;
  private readonly gpuCtx: GPUCanvasContext;
  private readonly format: GPUTextureFormat;
  private dpr: number;
  private w: number;
  private h: number;

  private readonly bufA: GPUBuffer;
  private readonly bufB: GPUBuffer;
  private readonly simPL: GPUComputePipeline;
  private readonly renderPL: GPURenderPipeline;
  private readonly simBG_AB: GPUBindGroup;
  private readonly simBG_BA: GPUBindGroup;
  private readonly renderBG_A: GPUBindGroup;
  private readonly renderBG_B: GPUBindGroup;

  private parity = 0;
  private frameId: number | null = null;
  private frameCount = 0;
  private lost = false;
  private rng: Rng;

  constructor(ctx: SaverContext, device: GPUDevice) {
    this.device = device;
    this.w = ctx.width;
    this.h = ctx.height;
    this.dpr = Math.min(ctx.dpr, 2);
    this.rng = ctx.rng;

    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'display:block;width:100%;height:100%';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.setAttribute('data-rd-backend', 'webgpu');
    ctx.host.appendChild(this.canvas);
    this.sizeCanvas();

    this.gpuCtx = this.canvas.getContext('webgpu')!;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.gpuCtx.configure({ device, format: this.format, alphaMode: 'opaque' });

    const sz = GPU_N * GPU_N * 8;
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    this.bufA = device.createBuffer({ size: sz, usage });
    this.bufB = device.createBuffer({ size: sz, usage });

    this.initField();

    const simLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    const simModule = device.createShaderModule({ code: SIM_WGSL });
    this.simPL = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [simLayout] }),
      compute: { module: simModule, entryPoint: 'main', constants: { N: GPU_N } },
    });
    this.simBG_AB = device.createBindGroup({
      layout: simLayout,
      entries: [
        { binding: 0, resource: { buffer: this.bufA } },
        { binding: 1, resource: { buffer: this.bufB } },
      ],
    });
    this.simBG_BA = device.createBindGroup({
      layout: simLayout,
      entries: [
        { binding: 0, resource: { buffer: this.bufB } },
        { binding: 1, resource: { buffer: this.bufA } },
      ],
    });

    const renderLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ],
    });
    const renderModule = device.createShaderModule({ code: RENDER_WGSL });
    this.renderPL = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [renderLayout] }),
      vertex: { module: renderModule, entryPoint: 'vs' },
      fragment: {
        module: renderModule,
        entryPoint: 'fs',
        targets: [{ format: this.format }],
        constants: { N: GPU_N },
      },
    });
    this.renderBG_A = device.createBindGroup({
      layout: renderLayout,
      entries: [{ binding: 0, resource: { buffer: this.bufA } }],
    });
    this.renderBG_B = device.createBindGroup({
      layout: renderLayout,
      entries: [{ binding: 0, resource: { buffer: this.bufB } }],
    });

    device.lost.then(() => { this.lost = true; this.stop(); });

    if (ctx.reducedMotion) {
      this.renderStill();
    } else {
      this.start();
    }
  }

  private initField(): void {
    const data = new Float32Array(GPU_N * GPU_N * 2);
    for (let i = 0; i < GPU_N * GPU_N; i++) {
      data[i * 2] = 1.0;
      data[i * 2 + 1] = 0.0;
    }
    this.seedInto(data, SEED_COUNT);
    this.device.queue.writeBuffer(this.bufA, 0, data);
    this.device.queue.writeBuffer(this.bufB, 0, data);
    this.parity = 0;
  }

  private seedInto(data: Float32Array, count: number): void {
    const seeds = generateSeeds(this.rng, GPU_N, count);
    for (const s of seeds) {
      for (let di = -GPU_SEED_R; di <= GPU_SEED_R; di++) {
        for (let dj = -GPU_SEED_R; dj <= GPU_SEED_R; dj++) {
          if (di * di + dj * dj > GPU_SEED_R * GPU_SEED_R) continue;
          const x = (s.x + di + GPU_N) % GPU_N;
          const y = (s.y + dj + GPU_N) % GPU_N;
          const idx = (x + y * GPU_N) * 2;
          data[idx] = 0.5;
          data[idx + 1] = 0.25;
        }
      }
    }
  }

  private reseed(): void {
    const seeds = generateSeeds(this.rng, GPU_N, RESEED_BATCH);
    const buf = this.parity === 0 ? this.bufA : this.bufB;
    const cell = new Float32Array([0.5, 0.25]);
    for (const s of seeds) {
      for (let di = -GPU_SEED_R; di <= GPU_SEED_R; di++) {
        for (let dj = -GPU_SEED_R; dj <= GPU_SEED_R; dj++) {
          if (di * di + dj * dj > GPU_SEED_R * GPU_SEED_R) continue;
          const x = (s.x + di + GPU_N) % GPU_N;
          const y = (s.y + dj + GPU_N) % GPU_N;
          this.device.queue.writeBuffer(buf, (x + y * GPU_N) * 8, cell);
        }
      }
    }
  }

  private sizeCanvas(): void {
    this.canvas.width = Math.max(1, Math.round(this.w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * this.dpr));
  }

  private simStep(): void {
    if (this.lost) return;
    const wgCount = Math.ceil(GPU_N / WG);
    const enc = this.device.createCommandEncoder();
    for (let i = 0; i < GPU_STEPS; i++) {
      const bg = this.parity === 0 ? this.simBG_AB : this.simBG_BA;
      const pass = enc.beginComputePass();
      pass.setPipeline(this.simPL);
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(wgCount, wgCount);
      pass.end();
      this.parity ^= 1;
    }
    this.device.queue.submit([enc.finish()]);
  }

  private render(): void {
    if (this.lost) return;
    const tex = this.gpuCtx.getCurrentTexture();
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: tex.createView(),
        loadOp: 'clear' as GPULoadOp,
        storeOp: 'store' as GPUStoreOp,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }],
    });
    pass.setPipeline(this.renderPL);
    pass.setBindGroup(0, this.parity === 0 ? this.renderBG_A : this.renderBG_B);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([enc.finish()]);
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
    if (this.frameCount % RESEED_INTERVAL === 0) this.reseed();
    this.simStep();
    this.render();
  }

  private renderStill(): void {
    for (let i = 0; i < 200; i++) {
      this.simStep();
    }
    this.render();
  }

  setPaused(paused: boolean): void {
    if (paused) this.stop();
    else this.start();
  }

  resize(width: number, height: number, dpr?: number): void {
    this.w = width;
    this.h = height;
    if (dpr !== undefined) this.dpr = Math.min(dpr, 2);
    this.sizeCanvas();
    if (!this.lost) {
      this.gpuCtx.configure({
        device: this.device,
        format: this.format,
        alphaMode: 'opaque',
      });
      this.render();
    }
  }

  dispose(): void {
    this.stop();
    this.bufA.destroy();
    this.bufB.destroy();
    this.canvas.remove();
    this.device.destroy();
  }
}
