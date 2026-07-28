import {
  sampleTrack,
  defaultParams,
  type ControlTrack,
  type ParamSpace,
  type Rng,
  type SaverContext,
  type SaverInstance,
  type SaverManifest,
  type SaverPlugin,
} from '@idle-screens/core';

/**
 * Pipes — the classic grid pipe-growth, restructured from "mutate a little
 * every frame" into a COMPILED PLAN evaluated at time t (the same trick the
 * catwalk uses for its itinerary):
 *
 *   - Each screen-filling run is an EPOCH. An epoch's entire growth history —
 *     every spawn, segment, and dead-end — is compiled up front from an
 *     epoch-keyed rng fork, using exactly the walk rules the accumulative
 *     version applied one frame at a time (same straight-bias, same fill
 *     threshold, same palette).
 *   - Steps advance on a fixed clock (the old code did 3 steps per rAF, i.e.
 *     ~180/s on a 60Hz display — and 360/s on a 120Hz one; the compiled clock
 *     pins the intended 180/s everywhere). `renderFrame(t)` maps t to
 *     (epoch, steps-done) and draws that prefix of the plan.
 *   - Canvas accumulation is kept as an OPTIMIZATION: moving forward within
 *     an epoch appends only the new events; seeking backwards or jumping
 *     repaints the background and replays the prefix. Either path lands on
 *     identical pixels, so the frame is a pure function of (t, seed) — pipes
 *     is now scrubbable, seek-back deterministic, and perception-readable.
 *
 * Epoch lengths differ (each run fills the grid its own way), so epoch start
 * times are a prefix sum: summaries are kept for every epoch seen, compiled
 * plans only for the recent few (an old epoch recompiles bit-identically on
 * demand from its fork).
 */
const PARAM_SPACE = {
  /** Growth speed multiplier. Sampled at each epoch's start — a run keeps its
   *  pace for its whole life, so the step clock stays a pure function of t. */
  tempo: { type: 'number', default: 1, min: 0.3, max: 3, ease: 'smooth' },
  /** Fraction of the grid a run fills before the screen clears. Sampled per
   *  epoch, like tempo. */
  density: { type: 'number', default: 0.65, min: 0.3, max: 0.9, ease: 'smooth' },
} satisfies ParamSpace;

type Params = Record<keyof typeof PARAM_SPACE, number>;

export const pipesManifest: SaverManifest = {
  id: 'pipes',
  label: 'Pipes',
  passthrough: false,
  minBackend: 'canvas2d',
  costTier: 'low',
  motionIntensity: 'moderate',
  reducedMotionFallback: 'static',
  paramSpace: PARAM_SPACE,
  a11y: { flashSafe: true },
  workerReady: true,
};

const CELL = 20;
const PIPE_WIDTH = 8;
/** The accumulative version stepped 3x per rAF frame — ~180/s at 60Hz. */
const STEP_MS = 1000 / 180;
/** Compiled plans kept in memory; older epochs recompile on demand. */
const PLAN_CACHE = 4;

const PALETTE = ['#c0392b', '#2980b9', '#27ae60', '#f39c12', '#8e44ad', '#d4a259', '#7f8c8d'];

type Dir = 0 | 1 | 2 | 3; // right, down, left, up
const DX: Record<Dir, number> = { 0: 1, 1: 0, 2: -1, 3: 0 };
const DY: Record<Dir, number> = { 0: 0, 1: 1, 2: 0, 3: -1 };

/** One growth step. `seg` carries its cells packed; -1 col marks spawn/end. */
interface Step {
  kind: 'spawn' | 'seg' | 'end';
  col: number;
  row: number;
  /** Segment destination (seg only). */
  c2: number;
  r2: number;
  /** Direction changed at (col,row) — draw the elbow joint (seg only). */
  turn: boolean;
  /** PALETTE index; -1 for 'end'. */
  color: number;
}

interface EpochPlan {
  steps: Step[];
  /** ms per step for this epoch — STEP_MS over the epoch's sampled tempo. */
  stepMs: number;
}

class PipesInstance implements SaverInstance {
  private readonly ctxSaver: SaverContext;
  private readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private readonly ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

  private w = 0;
  private h = 0;
  private cols = 0;
  private rows = 0;

  /** Prefix-sum of epoch start times (ms); index i = epoch i's start. */
  private epochStarts: number[] = [];
  /** Step counts per compiled-at-least-once epoch (start + count = summary). */
  private epochSteps: number[] = [];
  private plans = new Map<number, EpochPlan>();

  private track: ControlTrack | null = null;
  private readonly baseParams: Params = defaultParams(PARAM_SPACE) as Params;

  /** What the canvas currently shows: epoch index + steps drawn. -1 = dirty. */
  private paintedEpoch = -1;
  private paintedSteps = 0;

  private frameId: number | null = null;
  private paused = false;
  private startT = 0;
  private t = 0;

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
    if (!c2d) throw new Error('pipes: no 2d context');
    this.ctx = c2d;

    this.w = ctx.width;
    this.h = ctx.height;
    this.sizeCanvas();
    this.rebuild();

    this.paused = ctx.reducedMotion;
    if (this.paused) this.renderStill();
    else this.start();
  }

  private sizeCanvas(): void {
    const dpr = Math.min(this.ctxSaver.dpr, 2);
    this.canvas.width = Math.max(1, Math.round(this.w * dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private rebuild(): void {
    this.cols = Math.max(2, Math.floor(this.w / CELL));
    this.rows = Math.max(2, Math.floor(this.h / CELL));
    this.epochStarts = [];
    this.epochSteps = [];
    this.plans.clear();
    this.paintedEpoch = -1;
    this.paintedSteps = 0;
    this.paintBackground();
  }

  private paintBackground(): void {
    this.ctx.fillStyle = '#111';
    this.ctx.fillRect(0, 0, this.w, this.h);
  }

  // ---- the compiled plan ----

  /** Params at `t` — track-driven when a track is applied, defaults otherwise. */
  private paramsAt(t: number): Params {
    if (!this.track) return this.baseParams;
    const p = sampleTrack(PARAM_SPACE, this.track, t);
    const out = { ...this.baseParams };
    for (const k of Object.keys(PARAM_SPACE) as Array<keyof typeof PARAM_SPACE>) {
      const v = p[k];
      if (typeof v === 'number') out[k] = v;
    }
    return out;
  }

  /**
   * Compile one epoch's full growth history. Pure in (seed, epoch, cols,
   * rows, params-at-epoch-start): the rng is an epoch-keyed fork, and the
   * walk is exactly the old per-frame algorithm — spawn on an empty cell,
   * grow with a 0.65 bias to continue straight, die when boxed in, stop at
   * the fill threshold. tempo/density are sampled once at the epoch's start,
   * so a run keeps its pace and appetite for its whole life.
   */
  private compileEpoch(epoch: number, start: number): EpochPlan {
    const p = this.paramsAt(start);
    const rng: Rng = this.ctxSaver.rng.fork(0x919e5 + epoch * 7919);
    const size = this.cols * this.rows;
    const grid = new Uint8Array(size);
    let filled = 0;
    let pipe: { col: number; row: number; dir: Dir; color: number } | null = null;
    const steps: Step[] = [];

    // Each iteration is one clock step, exactly like one growStep() call.
    while (filled / size <= p.density) {
      if (!pipe) {
        const empty: number[] = [];
        for (let i = 0; i < size; i++) if (!grid[i]) empty.push(i);
        if (empty.length === 0) break;
        const cell = rng.pick(empty);
        const col = cell % this.cols;
        const row = Math.floor(cell / this.cols);
        pipe = { col, row, dir: rng.int(0, 3) as Dir, color: PALETTE.indexOf(rng.pick(PALETTE)) };
        grid[cell] = 1;
        filled++;
        steps.push({ kind: 'spawn', col, row, c2: -1, r2: -1, turn: false, color: pipe.color });
        continue;
      }

      const candidates: Dir[] = [];
      for (let d = 0; d < 4; d++) {
        const nc = pipe.col + DX[d as Dir];
        const nr = pipe.row + DY[d as Dir];
        if (nc >= 0 && nc < this.cols && nr >= 0 && nr < this.rows && !grid[nr * this.cols + nc]) {
          candidates.push(d as Dir);
        }
      }
      // Bias toward continuing straight — same draw order as the original.
      const pool =
        candidates.includes(pipe.dir) && rng.next() < 0.65 ? [pipe.dir] : candidates;
      if (pool.length === 0) {
        pipe = null;
        steps.push({ kind: 'end', col: -1, row: -1, c2: -1, r2: -1, turn: false, color: -1 });
        continue;
      }
      const newDir = rng.pick(pool);
      const turn = newDir !== pipe.dir;
      const nc = pipe.col + DX[newDir];
      const nr = pipe.row + DY[newDir];
      steps.push({ kind: 'seg', col: pipe.col, row: pipe.row, c2: nc, r2: nr, turn, color: pipe.color });
      pipe.col = nc;
      pipe.row = nr;
      pipe.dir = newDir;
      grid[nr * this.cols + nc] = 1;
      filled++;
    }
    return { steps, stepMs: STEP_MS / Math.max(0.05, p.tempo) };
  }

  /** The plan for an epoch, via the small cache. Recompiles are bit-identical. */
  private planFor(epoch: number, start: number): EpochPlan {
    let plan = this.plans.get(epoch);
    if (!plan) {
      plan = this.compileEpoch(epoch, start);
      this.plans.set(epoch, plan);
      if (this.plans.size > PLAN_CACHE) {
        // Drop the entry farthest from the one just requested.
        let worst = epoch;
        let worstD = -1;
        for (const k of this.plans.keys()) {
          const d = Math.abs(k - epoch);
          if (d > worstD) {
            worstD = d;
            worst = k;
          }
        }
        this.plans.delete(worst);
      }
    }
    // Summaries are append-only; record the step count the first time.
    if (this.epochSteps.length === epoch) this.epochSteps.push(plan.steps.length);
    return plan;
  }

  /** Epoch containing `t`, extending the prefix sum as needed. */
  private epochAt(t: number): { epoch: number; start: number; plan: EpochPlan } {
    if (this.epochStarts.length === 0) this.epochStarts.push(0);
    let e = 0;
    // Fast path: the painted epoch (or a neighbour) usually contains t.
    for (e = this.epochStarts.length - 1; e > 0; e--) {
      if (t >= this.epochStarts[e]!) break;
    }
    for (;;) {
      const start = this.epochStarts[e]!;
      const plan = this.planFor(e, start);
      const dur = Math.max(1, plan.steps.length) * plan.stepMs;
      if (t < start + dur) return { epoch: e, start, plan };
      if (this.epochStarts.length === e + 1) this.epochStarts.push(start + dur);
      e++;
    }
  }

  // ---- drawing (identical marks to the accumulative version) ----

  private cellCenter(col: number, row: number): [number, number] {
    return [col * CELL + CELL / 2, row * CELL + CELL / 2];
  }

  private drawSegment(c1: number, r1: number, c2: number, r2: number, color: string): void {
    const [x1, y1] = this.cellCenter(c1, r1);
    const [x2, y2] = this.cellCenter(c2, r2);
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = PIPE_WIDTH;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  private drawJoint(col: number, row: number, color: string): void {
    const [x, y] = this.cellCenter(col, row);
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, PIPE_WIDTH * 0.65, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawSteps(plan: EpochPlan, from: number, to: number): void {
    for (let i = from; i < to; i++) {
      const s = plan.steps[i]!;
      if (s.kind === 'spawn') {
        this.drawJoint(s.col, s.row, PALETTE[s.color]!);
      } else if (s.kind === 'seg') {
        this.drawSegment(s.col, s.row, s.c2, s.r2, PALETTE[s.color]!);
        if (s.turn) this.drawJoint(s.col, s.row, PALETTE[s.color]!);
      }
    }
  }

  // ---- loop ----

  private start(): void {
    if (this.frameId !== null || typeof requestAnimationFrame === 'undefined') return;
    this.startT = 0;
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
    if (this.startT === 0) this.startT = now;
    this.renderFrame(now - this.startT, this.ctxSaver.seed);
  }

  private renderStill(): void {
    // A paused audience at t=0 would see a bare background; park the still a
    // few dozen steps in, like the accumulative version's 80-step preview.
    const t = this.t === 0 ? 80 * STEP_MS : this.t;
    this.renderFrame(t, this.ctxSaver.seed);
  }

  /**
   * Pure, frame-addressable render: the canvas after this call is a function
   * of (t, seed, size) only. Forward motion within an epoch appends new
   * steps; anything else repaints and replays the prefix.
   */
  renderFrame(t: number, _seed: number): void {
    this.t = t;
    const { epoch, start, plan } = this.epochAt(Math.max(0, t));
    const stepsDone = Math.min(plan.steps.length, Math.floor((t - start) / plan.stepMs));
    if (epoch === this.paintedEpoch && stepsDone >= this.paintedSteps) {
      this.drawSteps(plan, this.paintedSteps, stepsDone);
    } else {
      this.paintBackground();
      this.drawSteps(plan, 0, stepsDone);
    }
    this.paintedEpoch = epoch;
    this.paintedSteps = stepsDone;
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

  applyTrack(track: ControlTrack): void {
    this.track = track;
    // Plans depend on the sampled params; everything derived must recompute.
    this.epochStarts = [];
    this.epochSteps = [];
    this.plans.clear();
    this.paintedEpoch = -1;
    this.paintedSteps = 0;
    this.paintBackground();
    if (this.paused) this.renderStill();
  }

  resize(width: number, height: number, dpr?: number): void {
    this.w = width;
    this.h = height;
    if (dpr !== undefined) this.ctxSaver.dpr = dpr;
    this.sizeCanvas();
    this.rebuild();
    if (this.paused) this.renderStill();
  }

  dispose(): void {
    this.stop();
    if (typeof HTMLCanvasElement !== 'undefined' && this.canvas instanceof HTMLCanvasElement) this.canvas.remove();
  }
}

export const pipes: SaverPlugin = {
  manifest: pipesManifest,
  mount: (ctx: SaverContext) => new PipesInstance(ctx),
};

/** A demo control-track: a leisurely build accelerates into a frantic dense
 *  fill and settles back — several epochs' worth, so the scrubber shows the
 *  clear-and-regrow rhythm. tempo/density land at epoch boundaries. */
export const pipesDemoTrack: ControlTrack = {
  program: 'pipes',
  seed: 7,
  duration: 30_000,
  loop: true,
  deltas: [
    { t: 0, path: 'tempo', value: 0.8 },
    { t: 15_000, path: 'tempo', value: 2.4, ease: 'smooth' },
    { t: 30_000, path: 'tempo', value: 0.8, ease: 'smooth' },
    { t: 0, path: 'density', value: 0.55 },
    { t: 15_000, path: 'density', value: 0.8, ease: 'smooth' },
    { t: 30_000, path: 'density', value: 0.55, ease: 'smooth' },
  ],
};
