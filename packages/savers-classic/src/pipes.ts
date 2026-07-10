import type { Rng, SaverContext, SaverInstance, SaverManifest, SaverPlugin } from '@idle-screens/core';

export const pipesManifest: SaverManifest = {
  id: 'pipes',
  label: 'Pipes',
  passthrough: false,
  minBackend: 'canvas2d',
  costTier: 'low',
  motionIntensity: 'moderate',
  reducedMotionFallback: 'static',
  a11y: { flashSafe: true },
};

const CELL = 20;
const PIPE_WIDTH = 8;
const STEPS_PER_FRAME = 3;
const FILL_THRESHOLD = 0.65;

const PALETTE = ['#c0392b', '#2980b9', '#27ae60', '#f39c12', '#8e44ad', '#d4a259', '#7f8c8d'];

type Dir = 0 | 1 | 2 | 3; // right, down, left, up
const DX: Record<Dir, number> = { 0: 1, 1: 0, 2: -1, 3: 0 };
const DY: Record<Dir, number> = { 0: 0, 1: 1, 2: 0, 3: -1 };

interface Pipe {
  col: number;
  row: number;
  dir: Dir;
  color: string;
}

class PipesInstance implements SaverInstance {
  private readonly ctxSaver: SaverContext;
  private readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private readonly ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

  private w = 0;
  private h = 0;
  private cols = 0;
  private rows = 0;
  private grid: boolean[] = [];
  private filled = 0;
  private pipe: Pipe | null = null;
  private rng: Rng;
  private frameId: number | null = null;
  private paused = false;

  constructor(ctx: SaverContext) {
    this.ctxSaver = ctx;
    this.rng = ctx.rng;

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
    this.grid = new Array(this.cols * this.rows).fill(false);
    this.filled = 0;
    this.pipe = null;
    this.paintBackground();
  }

  private paintBackground(): void {
    this.ctx.fillStyle = '#111';
    this.ctx.fillRect(0, 0, this.w, this.h);
  }

  private idx(col: number, row: number): number {
    return row * this.cols + col;
  }

  private inBounds(col: number, row: number): boolean {
    return col >= 0 && col < this.cols && row >= 0 && row < this.rows;
  }

  private spawnPipe(): void {
    const empty: number[] = [];
    for (let i = 0; i < this.grid.length; i++) {
      if (!this.grid[i]) empty.push(i);
    }
    if (empty.length === 0) {
      this.clearGrid();
      return;
    }
    const cell = this.rng.pick(empty);
    const col = cell % this.cols;
    const row = Math.floor(cell / this.cols);
    this.pipe = {
      col,
      row,
      dir: this.rng.int(0, 3) as Dir,
      color: this.rng.pick(PALETTE),
    };
    this.grid[cell] = true;
    this.filled++;
    this.drawJoint(col, row, this.pipe.color);
  }

  private clearGrid(): void {
    this.grid.fill(false);
    this.filled = 0;
    this.pipe = null;
    this.paintBackground();
  }

  private growStep(): void {
    if (this.filled / this.grid.length > FILL_THRESHOLD) {
      this.clearGrid();
      return;
    }
    if (!this.pipe) {
      this.spawnPipe();
      return;
    }

    const candidates = this.getCandidates(this.pipe);
    if (candidates.length === 0) {
      this.pipe = null;
      return;
    }

    const oldCol = this.pipe.col;
    const oldRow = this.pipe.row;
    const oldDir = this.pipe.dir;

    const newDir = this.rng.pick(candidates);
    this.pipe.dir = newDir;

    const nc = oldCol + DX[newDir];
    const nr = oldRow + DY[newDir];

    this.drawSegment(oldCol, oldRow, nc, nr, this.pipe.color);

    if (newDir !== oldDir) {
      this.drawJoint(oldCol, oldRow, this.pipe.color);
    }

    this.pipe.col = nc;
    this.pipe.row = nr;
    this.grid[this.idx(nc, nr)] = true;
    this.filled++;
  }

  private getCandidates(pipe: Pipe): Dir[] {
    const out: Dir[] = [];
    for (let d = 0; d < 4; d++) {
      const nc = pipe.col + DX[d as Dir];
      const nr = pipe.row + DY[d as Dir];
      if (this.inBounds(nc, nr) && !this.grid[this.idx(nc, nr)]) {
        out.push(d as Dir);
      }
    }
    // Bias toward continuing straight
    if (out.includes(pipe.dir) && this.rng.next() < 0.65) {
      return [pipe.dir];
    }
    return out;
  }

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
    for (let i = 0; i < STEPS_PER_FRAME; i++) this.growStep();
  }

  private renderStill(): void {
    this.rebuild();
    for (let i = 0; i < 80; i++) this.growStep();
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
