/// <reference types="@webgpu/types" />
import type { Rng, SaverContext, SaverInstance } from '@idle-screens/core';
import {
  DT,
  DENS_DECAY,
  VEL_DECAY,
  DYE_RATE,
  FORCE_RATE,
  buildEmitters,
  stepEmitters,
  type Emitter,
} from './fluid-shared';

const GPU_N = 256;
const GPU_STRIDE = GPU_N + 2;
const GPU_SZ = GPU_STRIDE * GPU_STRIDE;
const GPU_DIFF = 0.00003 * (96 / GPU_N) ** 2;
const GPU_VISC = 0.0003 * (96 / GPU_N) ** 2;
const GPU_INJECT_R = Math.round(4 * (GPU_N / 96));
const GPU_FORCE_RATE = FORCE_RATE * (96 / GPU_N);
const JACOBI_DIFF = 10;
const JACOBI_PRES = 40;

// --- WGSL shaders -----------------------------------------------------------

const COPY_WGSL = /* wgsl */ `
override SZ: u32;
@group(0) @binding(0) var<storage, read_write> dst: array<f32>;
@group(0) @binding(1) var<storage, read> src: array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= SZ) { return; }
  dst[gid.x] = src[gid.x];
}`;

const ADD_SOURCE_WGSL = /* wgsl */ `
override SZ: u32;
struct P { dt: f32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read_write> dst: array<f32>;
@group(0) @binding(2) var<storage, read> src: array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= SZ) { return; }
  dst[gid.x] += p.dt * src[gid.x];
}`;

const SCALE_WGSL = /* wgsl */ `
override SZ: u32;
struct P { factor: f32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read_write> field: array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= SZ) { return; }
  field[gid.x] *= p.factor;
}`;

const JACOBI_WGSL = /* wgsl */ `
override N: u32;
override STRIDE: u32;
struct P { a: f32, c: f32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read_write> dst: array<f32>;
@group(0) @binding(2) var<storage, read> x0: array<f32>;
@group(0) @binding(3) var<storage, read> prev: array<f32>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x + 1u;
  let j = gid.y + 1u;
  if (i > N || j > N) { return; }
  let idx = i + STRIDE * j;
  dst[idx] = (x0[idx] + p.a * (prev[idx - 1u] + prev[idx + 1u]
            + prev[idx - STRIDE] + prev[idx + STRIDE])) / p.c;
}`;

const BOUNDARY_WGSL = /* wgsl */ `
override N: u32;
override STRIDE: u32;
struct P { b: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read_write> x: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x + 1u;
  if (i > N) { return; }
  let s = STRIDE;
  let sl = select(1.0, -1.0, p.b == 1u);
  let st = select(1.0, -1.0, p.b == 2u);
  x[s * i] = sl * x[1u + s * i];
  x[(N + 1u) + s * i] = sl * x[N + s * i];
  x[i] = st * x[i + s];
  x[i + s * (N + 1u)] = st * x[i + s * N];
  if (i == 1u) {
    x[0u] = x[1u + s];
    x[s * (N + 1u)] = x[1u + s * N];
    x[N + 1u] = x[N + s];
    x[(N + 1u) + s * (N + 1u)] = x[N + s * N];
  }
}`;

const ADVECT_WGSL = /* wgsl */ `
override N: u32;
override STRIDE: u32;
struct P { dt0: f32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read_write> d: array<f32>;
@group(0) @binding(2) var<storage, read> d0: array<f32>;
@group(0) @binding(3) var<storage, read> u: array<f32>;
@group(0) @binding(4) var<storage, read> v: array<f32>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x + 1u;
  let j = gid.y + 1u;
  if (i > N || j > N) { return; }
  let idx = i + STRIDE * j;
  var bx = f32(i) - p.dt0 * u[idx];
  var by = f32(j) - p.dt0 * v[idx];
  bx = clamp(bx, 0.5, f32(N) + 0.5);
  by = clamp(by, 0.5, f32(N) + 0.5);
  let i0 = u32(floor(bx));
  let j0 = u32(floor(by));
  let s1 = bx - f32(i0);
  let s0 = 1.0 - s1;
  let t1 = by - f32(j0);
  let t0 = 1.0 - t1;
  let s = STRIDE;
  d[idx] = s0 * (t0 * d0[i0 + s * j0] + t1 * d0[i0 + s * (j0 + 1u)])
         + s1 * (t0 * d0[(i0 + 1u) + s * j0] + t1 * d0[(i0 + 1u) + s * (j0 + 1u)]);
}`;

const DIVERGENCE_WGSL = /* wgsl */ `
override N: u32;
override STRIDE: u32;
@group(0) @binding(0) var<storage, read_write> div: array<f32>;
@group(0) @binding(1) var<storage, read> u: array<f32>;
@group(0) @binding(2) var<storage, read> v: array<f32>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x + 1u;
  let j = gid.y + 1u;
  if (i > N || j > N) { return; }
  let idx = i + STRIDE * j;
  let h = 1.0 / f32(N);
  div[idx] = -0.5 * h * (u[idx + 1u] - u[idx - 1u] + v[idx + STRIDE] - v[idx - STRIDE]);
}`;

const GRADIENT_SUB_WGSL = /* wgsl */ `
override N: u32;
override STRIDE: u32;
@group(0) @binding(0) var<storage, read_write> u: array<f32>;
@group(0) @binding(1) var<storage, read_write> v: array<f32>;
@group(0) @binding(2) var<storage, read> p: array<f32>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x + 1u;
  let j = gid.y + 1u;
  if (i > N || j > N) { return; }
  let idx = i + STRIDE * j;
  u[idx] -= 0.5 * f32(N) * (p[idx + 1u] - p[idx - 1u]);
  v[idx] -= 0.5 * f32(N) * (p[idx + STRIDE] - p[idx - STRIDE]);
}`;

const INJECT_WGSL = /* wgsl */ `
override N: u32;
override STRIDE: u32;
struct EmitterData { pos: vec4f, col: vec4f }
struct IP {
  inject_r: f32, dye_rate: f32, force_rate: f32, count: u32,
  data: array<EmitterData, 4>,
}
@group(0) @binding(0) var<uniform> p: IP;
@group(0) @binding(1) var<storage, read_write> u0: array<f32>;
@group(0) @binding(2) var<storage, read_write> v0: array<f32>;
@group(0) @binding(3) var<storage, read_write> dr0: array<f32>;
@group(0) @binding(4) var<storage, read_write> dg0: array<f32>;
@group(0) @binding(5) var<storage, read_write> db0: array<f32>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  let j = gid.y;
  if (i >= STRIDE || j >= STRIDE) { return; }
  let idx = i + STRIDE * j;
  u0[idx] = 0.0; v0[idx] = 0.0;
  dr0[idx] = 0.0; dg0[idx] = 0.0; db0[idx] = 0.0;
  if (i < 1u || i > N || j < 1u || j > N) { return; }
  let fi = f32(i);
  let fj = f32(j);
  for (var e = 0u; e < p.count; e = e + 1u) {
    let em = p.data[e];
    let dx = fi - em.pos.x;
    let dy = fj - em.pos.y;
    let dist = sqrt(dx * dx + dy * dy);
    if (dist > p.inject_r) { continue; }
    let w = 1.0 - dist / p.inject_r;
    dr0[idx] += em.col.x * p.dye_rate * w;
    dg0[idx] += em.col.y * p.dye_rate * w;
    db0[idx] += em.col.z * p.dye_rate * w;
    u0[idx] += em.pos.z * p.force_rate * w;
    v0[idx] += em.pos.w * p.force_rate * w;
  }
}`;

const RENDER_WGSL = /* wgsl */ `
override N: u32;
override STRIDE: u32;
struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VO {
  var o: VO;
  let x = f32(i32(vi) / 2) * 4.0 - 1.0;
  let y = f32(i32(vi) % 2) * 4.0 - 1.0;
  o.pos = vec4f(x, y, 0.0, 1.0);
  o.uv = vec2f((x + 1.0) * 0.5, (1.0 - y) * 0.5);
  return o;
}
@group(0) @binding(0) var<storage, read> dr: array<f32>;
@group(0) @binding(1) var<storage, read> dg: array<f32>;
@group(0) @binding(2) var<storage, read> db: array<f32>;
@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let gx = clamp(uv.x * f32(N) + 0.5, 1.0, f32(N));
  let gy = clamp(uv.y * f32(N) + 0.5, 1.0, f32(N));
  let i0 = u32(floor(gx));
  let j0 = u32(floor(gy));
  let s1 = gx - f32(i0);
  let s0 = 1.0 - s1;
  let t1 = gy - f32(j0);
  let t0 = 1.0 - t1;
  let s = STRIDE;
  let a00 = i0 + s * j0;
  let a01 = i0 + s * (j0 + 1u);
  let a10 = (i0 + 1u) + s * j0;
  let a11 = (i0 + 1u) + s * (j0 + 1u);
  let r = s0 * (t0 * dr[a00] + t1 * dr[a01]) + s1 * (t0 * dr[a10] + t1 * dr[a11]);
  let g = s0 * (t0 * dg[a00] + t1 * dg[a01]) + s1 * (t0 * dg[a10] + t1 * dg[a11]);
  let b = s0 * (t0 * db[a00] + t1 * db[a01]) + s1 * (t0 * db[a10] + t1 * db[a11]);
  return vec4f(clamp(r / 255.0, 0.0, 1.0), clamp(g / 255.0, 0.0, 1.0),
               clamp(b / 255.0, 0.0, 1.0), 1.0);
}`;

// --- Helpers -----------------------------------------------------------------

const WG1D = Math.ceil(GPU_SZ / 256);
const WG2D = Math.ceil(GPU_N / 8);
const WG_BND = Math.ceil(GPU_N / 64);
const WG_INJ = Math.ceil(GPU_STRIDE / 8);

function mkUniform(dev: GPUDevice, data: Float32Array | Uint32Array): GPUBuffer {
  const size = Math.ceil(Math.max(data.byteLength, 16) / 16) * 16;
  const buf = dev.createBuffer({
    size,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  dev.queue.writeBuffer(buf, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
  return buf;
}

function mkStorage(dev: GPUDevice): GPUBuffer {
  return dev.createBuffer({
    size: GPU_SZ * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
}

function mkPipeline(
  dev: GPUDevice,
  code: string,
  constants: Record<string, number>,
): GPUComputePipeline {
  return dev.createComputePipeline({
    layout: 'auto',
    compute: { module: dev.createShaderModule({ code }), constants },
  });
}

// --- FluidGPU ----------------------------------------------------------------

const FIELDS = [
  'u',
  'v',
  'dr',
  'dg',
  'db',
  'u0',
  'v0',
  'dr0',
  'dg0',
  'db0',
  'sA',
  'sB',
  'div',
  'p',
] as const;
type FName = (typeof FIELDS)[number];

export class FluidGPU implements SaverInstance {
  private device: GPUDevice;
  private readonly rng: Rng;
  private canvas: HTMLCanvasElement;
  private gpuCtx: GPUCanvasContext;
  private format: GPUTextureFormat;
  private dpr: number;

  private f: Record<FName, GPUBuffer>;

  private copyPL!: GPUComputePipeline;
  private addSrcPL!: GPUComputePipeline;
  private scalePL!: GPUComputePipeline;
  private jacobiPL!: GPUComputePipeline;
  private bndPL!: GPUComputePipeline;
  private advectPL!: GPUComputePipeline;
  private divPL!: GPUComputePipeline;
  private gradPL!: GPUComputePipeline;
  private injectPL!: GPUComputePipeline;
  private renderPL!: GPURenderPipeline;

  private dtUni!: GPUBuffer;
  private viscUni!: GPUBuffer;
  private diffUni!: GPUBuffer;
  private presUni!: GPUBuffer;
  private densDecUni!: GPUBuffer;
  private velDecUni!: GPUBuffer;
  private zeroUni!: GPUBuffer;
  private bndUni!: [GPUBuffer, GPUBuffer, GPUBuffer];
  private advUni!: GPUBuffer;
  private emitterUni!: GPUBuffer;

  private emitters: Emitter[];
  private t = 0;
  private w: number;
  private h: number;
  private frameId: number | null = null;
  private lost = false;
  private lastPreviewMs = -1;
  private static readonly PREVIEW_FRAME_MS = 1000 / 60;

  constructor(ctx: SaverContext, device: GPUDevice) {
    this.device = device;
    this.rng = ctx.rng;
    this.w = ctx.width;
    this.h = ctx.height;
    this.dpr = Math.min(ctx.dpr, 2);

    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'display:block;width:100%;height:100%';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.setAttribute('data-fluid-backend', 'webgpu');
    ctx.host.appendChild(this.canvas);
    this.canvas.width = Math.max(1, Math.round(this.w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * this.dpr));

    this.gpuCtx = this.canvas.getContext('webgpu')!;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.gpuCtx.configure({
      device,
      format: this.format,
      alphaMode: 'opaque',
    });

    this.f = {} as Record<FName, GPUBuffer>;
    for (const n of FIELDS) this.f[n] = mkStorage(device);

    this.initPipelines();
    this.initUniforms();

    this.emitters = buildEmitters(ctx.rng, GPU_N);

    device.lost.then(() => {
      this.lost = true;
      this.stop();
    });

    if (ctx.reducedMotion) {
      this.renderStill();
    } else {
      this.start();
    }
  }

  // --- pipeline creation -----------------------------------------------------

  private initPipelines(): void {
    const dev = this.device;
    const ov1 = { SZ: GPU_SZ };
    const ov2 = { N: GPU_N, STRIDE: GPU_STRIDE };

    this.copyPL = mkPipeline(dev, COPY_WGSL, ov1);
    this.addSrcPL = mkPipeline(dev, ADD_SOURCE_WGSL, ov1);
    this.scalePL = mkPipeline(dev, SCALE_WGSL, ov1);
    this.jacobiPL = mkPipeline(dev, JACOBI_WGSL, ov2);
    this.bndPL = mkPipeline(dev, BOUNDARY_WGSL, ov2);
    this.advectPL = mkPipeline(dev, ADVECT_WGSL, ov2);
    this.divPL = mkPipeline(dev, DIVERGENCE_WGSL, ov2);
    this.gradPL = mkPipeline(dev, GRADIENT_SUB_WGSL, ov2);
    this.injectPL = mkPipeline(dev, INJECT_WGSL, ov2);

    const renderMod = dev.createShaderModule({ code: RENDER_WGSL });
    this.renderPL = dev.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: renderMod,
        entryPoint: 'vs',
        constants: ov2,
      },
      fragment: {
        module: renderMod,
        entryPoint: 'fs',
        targets: [{ format: this.format }],
        constants: ov2,
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  // --- uniform creation ------------------------------------------------------

  private initUniforms(): void {
    const dev = this.device;
    this.dtUni = mkUniform(dev, new Float32Array([DT]));
    const aDiff = DT * GPU_DIFF * GPU_N * GPU_N;
    this.diffUni = mkUniform(dev, new Float32Array([aDiff, 1 + 4 * aDiff]));
    const aVisc = DT * GPU_VISC * GPU_N * GPU_N;
    this.viscUni = mkUniform(dev, new Float32Array([aVisc, 1 + 4 * aVisc]));
    this.presUni = mkUniform(dev, new Float32Array([1, 4]));
    this.densDecUni = mkUniform(dev, new Float32Array([DENS_DECAY]));
    this.velDecUni = mkUniform(dev, new Float32Array([VEL_DECAY]));
    this.zeroUni = mkUniform(dev, new Float32Array([0]));
    this.bndUni = [
      mkUniform(dev, new Uint32Array([0])),
      mkUniform(dev, new Uint32Array([1])),
      mkUniform(dev, new Uint32Array([2])),
    ];
    this.advUni = mkUniform(dev, new Float32Array([DT * GPU_N]));
    this.emitterUni = dev.createBuffer({
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  // --- bind-group helper -----------------------------------------------------

  private bg(pl: GPUComputePipeline | GPURenderPipeline, ...bufs: GPUBuffer[]): GPUBindGroup {
    return this.device.createBindGroup({
      layout: pl.getBindGroupLayout(0),
      entries: bufs.map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
  }

  // --- encoding helpers (each creates its own compute pass for barriers) -----

  private eCopy(enc: GPUCommandEncoder, dst: GPUBuffer, src: GPUBuffer): void {
    const p = enc.beginComputePass();
    p.setPipeline(this.copyPL);
    p.setBindGroup(0, this.bg(this.copyPL, dst, src));
    p.dispatchWorkgroups(WG1D);
    p.end();
  }

  private eAddSrc(enc: GPUCommandEncoder, dst: GPUBuffer, src: GPUBuffer): void {
    const p = enc.beginComputePass();
    p.setPipeline(this.addSrcPL);
    p.setBindGroup(0, this.bg(this.addSrcPL, this.dtUni, dst, src));
    p.dispatchWorkgroups(WG1D);
    p.end();
  }

  private eScale(enc: GPUCommandEncoder, field: GPUBuffer, uni: GPUBuffer): void {
    const p = enc.beginComputePass();
    p.setPipeline(this.scalePL);
    p.setBindGroup(0, this.bg(this.scalePL, uni, field));
    p.dispatchWorkgroups(WG1D);
    p.end();
  }

  private eJacobi(
    enc: GPUCommandEncoder,
    dst: GPUBuffer,
    x0: GPUBuffer,
    prev: GPUBuffer,
    uni: GPUBuffer,
  ): void {
    const p = enc.beginComputePass();
    p.setPipeline(this.jacobiPL);
    p.setBindGroup(0, this.bg(this.jacobiPL, uni, dst, x0, prev));
    p.dispatchWorkgroups(WG2D, WG2D);
    p.end();
  }

  private eBnd(enc: GPUCommandEncoder, field: GPUBuffer, b: 0 | 1 | 2): void {
    const p = enc.beginComputePass();
    p.setPipeline(this.bndPL);
    p.setBindGroup(0, this.bg(this.bndPL, this.bndUni[b], field));
    p.dispatchWorkgroups(WG_BND);
    p.end();
  }

  private eAdvect(
    enc: GPUCommandEncoder,
    d: GPUBuffer,
    d0: GPUBuffer,
    u: GPUBuffer,
    v: GPUBuffer,
  ): void {
    const p = enc.beginComputePass();
    p.setPipeline(this.advectPL);
    p.setBindGroup(0, this.bg(this.advectPL, this.advUni, d, d0, u, v));
    p.dispatchWorkgroups(WG2D, WG2D);
    p.end();
  }

  private eDiv(enc: GPUCommandEncoder): void {
    const p = enc.beginComputePass();
    p.setPipeline(this.divPL);
    p.setBindGroup(0, this.bg(this.divPL, this.f.div, this.f.u, this.f.v));
    p.dispatchWorkgroups(WG2D, WG2D);
    p.end();
  }

  private eGrad(enc: GPUCommandEncoder): void {
    const p = enc.beginComputePass();
    p.setPipeline(this.gradPL);
    p.setBindGroup(0, this.bg(this.gradPL, this.f.u, this.f.v, this.f.p));
    p.dispatchWorkgroups(WG2D, WG2D);
    p.end();
  }

  private eInject(enc: GPUCommandEncoder): void {
    const p = enc.beginComputePass();
    p.setPipeline(this.injectPL);
    p.setBindGroup(
      0,
      this.bg(this.injectPL, this.emitterUni, this.f.u0, this.f.v0, this.f.dr0, this.f.dg0, this.f.db0),
    );
    p.dispatchWorkgroups(WG_INJ, WG_INJ);
    p.end();
  }

  // --- composite steps -------------------------------------------------------

  private encodeDiffuse(enc: GPUCommandEncoder, field: GPUBuffer, uni: GPUBuffer, b: 0 | 1 | 2): void {
    this.eCopy(enc, this.f.sA, field);
    this.eCopy(enc, this.f.sB, this.f.sA);
    for (let k = 0; k < JACOBI_DIFF; k++) {
      if (k % 2 === 0) {
        this.eJacobi(enc, field, this.f.sA, this.f.sB, uni);
      } else {
        this.eJacobi(enc, this.f.sB, this.f.sA, field, uni);
      }
    }
    if (JACOBI_DIFF % 2 === 0) this.eCopy(enc, field, this.f.sB);
    this.eBnd(enc, field, b);
  }

  private encodeProject(enc: GPUCommandEncoder): void {
    this.eDiv(enc);
    this.eBnd(enc, this.f.div, 0);
    this.eScale(enc, this.f.p, this.zeroUni);
    this.eScale(enc, this.f.sA, this.zeroUni);
    for (let k = 0; k < JACOBI_PRES; k++) {
      if (k % 2 === 0) {
        this.eJacobi(enc, this.f.sA, this.f.div, this.f.p, this.presUni);
      } else {
        this.eJacobi(enc, this.f.p, this.f.div, this.f.sA, this.presUni);
      }
    }
    if (JACOBI_PRES % 2 !== 0) this.eCopy(enc, this.f.p, this.f.sA);
    this.eBnd(enc, this.f.p, 0);
    this.eGrad(enc);
    this.eBnd(enc, this.f.u, 1);
    this.eBnd(enc, this.f.v, 2);
  }

  private encodeVelStep(enc: GPUCommandEncoder): void {
    this.eAddSrc(enc, this.f.u, this.f.u0);
    this.eAddSrc(enc, this.f.v, this.f.v0);
    this.encodeDiffuse(enc, this.f.u, this.viscUni, 1);
    this.encodeDiffuse(enc, this.f.v, this.viscUni, 2);
    this.encodeProject(enc);
    this.eCopy(enc, this.f.sA, this.f.u);
    this.eCopy(enc, this.f.sB, this.f.v);
    this.eAdvect(enc, this.f.u, this.f.sA, this.f.sA, this.f.sB);
    this.eAdvect(enc, this.f.v, this.f.sB, this.f.sA, this.f.sB);
    this.eBnd(enc, this.f.u, 1);
    this.eBnd(enc, this.f.v, 2);
    this.encodeProject(enc);
    this.eScale(enc, this.f.u, this.velDecUni);
    this.eScale(enc, this.f.v, this.velDecUni);
  }

  private encodeDensStep(enc: GPUCommandEncoder, d: FName, d0: FName): void {
    this.eAddSrc(enc, this.f[d], this.f[d0]);
    this.encodeDiffuse(enc, this.f[d], this.diffUni, 0);
    this.eCopy(enc, this.f.sA, this.f[d]);
    this.eAdvect(enc, this.f[d], this.f.sA, this.f.u, this.f.v);
    this.eBnd(enc, this.f[d], 0);
    this.eScale(enc, this.f[d], this.densDecUni);
  }

  // --- emitter upload --------------------------------------------------------

  private writeEmitters(): void {
    const frames = stepEmitters(this.t, this.emitters, GPU_N);
    const buf = new ArrayBuffer(256);
    const fv = new Float32Array(buf);
    const uv = new Uint32Array(buf);
    fv[0] = GPU_INJECT_R;
    fv[1] = DYE_RATE;
    fv[2] = GPU_FORCE_RATE;
    uv[3] = frames.length;
    for (let i = 0; i < frames.length; i++) {
      const off = 4 + i * 8;
      const fr = frames[i];
      fv[off] = fr.gx;
      fv[off + 1] = fr.gy;
      fv[off + 2] = fr.dx;
      fv[off + 3] = fr.dy;
      fv[off + 4] = fr.r;
      fv[off + 5] = fr.g;
      fv[off + 6] = fr.b;
      fv[off + 7] = 0;
    }
    this.device.queue.writeBuffer(this.emitterUni, 0, buf);
  }

  // --- simulation step -------------------------------------------------------

  private simStep(): void {
    this.writeEmitters();
    const enc = this.device.createCommandEncoder();
    this.eInject(enc);
    this.encodeVelStep(enc);
    this.encodeDensStep(enc, 'dr', 'dr0');
    this.encodeDensStep(enc, 'dg', 'dg0');
    this.encodeDensStep(enc, 'db', 'db0');
    this.device.queue.submit([enc.finish()]);
  }

  // --- render ----------------------------------------------------------------

  private render(): void {
    if (this.lost) return;
    const tex = this.gpuCtx.getCurrentTexture();
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [
        {
          view: tex.createView(),
          loadOp: 'clear' as GPULoadOp,
          storeOp: 'store' as GPUStoreOp,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    });
    pass.setPipeline(this.renderPL);
    pass.setBindGroup(0, this.bg(this.renderPL, this.f.dr, this.f.dg, this.f.db));
    pass.draw(3);
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  // --- animation loop --------------------------------------------------------

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

  private hardReset(): void {
    if (this.lost) return;
    const enc = this.device.createCommandEncoder();
    for (const n of FIELDS) {
      this.eScale(enc, this.f[n], this.zeroUni);
    }
    this.device.queue.submit([enc.finish()]);
    this.t = 0;
    this.emitters = buildEmitters(this.rng, GPU_N);
    this.lastPreviewMs = -1;
  }

  previewAt(ms: number): void {
    if (this.lost) return;
    this.stop();
    const frameMs = FluidGPU.PREVIEW_FRAME_MS;
    if (ms < this.lastPreviewMs || this.lastPreviewMs < 0) {
      this.hardReset();
    }
    const fromFrame = Math.floor(Math.max(0, this.lastPreviewMs) / frameMs);
    const toFrame = Math.floor(ms / frameMs);
    if (toFrame === 0 && fromFrame === 0) {
      for (let i = 0; i < 200; i++) {
        this.t += DT;
        this.simStep();
      }
    } else {
      for (let f = fromFrame; f < toFrame; f++) {
        this.t += DT;
        this.simStep();
      }
    }
    this.lastPreviewMs = ms;
    this.render();
  }

  // --- SaverInstance interface ------------------------------------------------

  setPaused(paused: boolean): void {
    if (paused) this.stop();
    else this.start();
  }

  resize(width: number, height: number, dpr?: number): void {
    this.w = width;
    this.h = height;
    if (dpr !== undefined) this.dpr = Math.min(dpr, 2);
    this.canvas.width = Math.max(1, Math.round(this.w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * this.dpr));
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
    for (const b of Object.values(this.f)) b.destroy();
    this.dtUni.destroy();
    this.diffUni.destroy();
    this.viscUni.destroy();
    this.presUni.destroy();
    this.densDecUni.destroy();
    this.velDecUni.destroy();
    this.zeroUni.destroy();
    for (const b of this.bndUni) b.destroy();
    this.advUni.destroy();
    this.emitterUni.destroy();
    this.canvas.remove();
    this.device.destroy();
  }
}
