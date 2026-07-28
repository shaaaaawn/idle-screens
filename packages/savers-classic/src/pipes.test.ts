// @vitest-environment happy-dom
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRng, type SaverContext, type SaverInstance } from '@idle-screens/core';
import { pipes } from './pipes';

/**
 * The frame-addressable pipes must satisfy the library's core claim: the
 * canvas after renderFrame(t) is a pure function of (t, seed, size), whether
 * it got there by appending steps (forward playback) or by repaint-and-replay
 * (a seek). happy-dom has no Canvas2D, so the stub RECORDS draw calls with
 * their active styles — "pixels" here means the op log since the last
 * background repaint, which fully determines the canvas contents.
 */
type Op = (string | number)[];

function recordingStub(log: Op[]): CanvasRenderingContext2D {
  let fillStyle = '';
  let strokeStyle = '';
  let lineWidth = 0;
  const stub = {
    fillRect: (...a: number[]) => log.push(['fillRect', fillStyle, ...a]),
    clearRect: () => {},
    beginPath: () => {},
    moveTo: (...a: number[]) => log.push(['moveTo', ...a]),
    lineTo: (...a: number[]) => log.push(['lineTo', ...a]),
    arc: (...a: number[]) => log.push(['arc', fillStyle, ...a]),
    stroke: () => log.push(['stroke', strokeStyle, lineWidth]),
    fill: () => log.push(['fill', fillStyle]),
    setTransform: () => {},
    lineCap: 'butt',
  };
  Object.defineProperties(stub, {
    fillStyle: { get: () => fillStyle, set: (v: string) => (fillStyle = v) },
    strokeStyle: { get: () => strokeStyle, set: (v: string) => (strokeStyle = v) },
    lineWidth: { get: () => lineWidth, set: (v: number) => (lineWidth = v) },
  });
  return stub as unknown as CanvasRenderingContext2D;
}

/** Everything drawn since the last background repaint == the canvas state. */
const sinceLastBg = (log: Op[]): string => {
  let last = 0;
  for (let i = 0; i < log.length; i++) {
    if (log[i]![0] === 'fillRect' && log[i]![1] === '#111') last = i;
  }
  return JSON.stringify(log.slice(last));
};

const W = 800;
const H = 520;
const logs = new WeakMap<HTMLCanvasElement, Op[]>();

function ctx(host: HTMLElement, seed = 7): SaverContext {
  return { host, dpr: 1, width: W, height: H, rng: createRng(seed), seed, reducedMotion: true };
}

type Frameable = SaverInstance & { renderFrame(t: number, seed: number): void };

function mountWithLog(seed = 7): { inst: Frameable; log: Op[]; host: HTMLElement } {
  const host = document.createElement('div');
  document.body.append(host);
  const inst = pipes.mount(ctx(host, seed)) as Frameable;
  const canvas = host.querySelector('canvas') as HTMLCanvasElement;
  const log = logs.get(canvas)!;
  return { inst, log, host };
}

describe('pipes: a compiled plan evaluated at t', () => {
  let originalGetContext: HTMLCanvasElement['getContext'];

  beforeAll(() => {
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
      let log = logs.get(this);
      if (!log) {
        log = [];
        logs.set(this, log);
      }
      return recordingStub(log);
    } as unknown as HTMLCanvasElement['getContext'];
  });

  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it('the same (t, seed) is the same frame, across fresh instances', () => {
    const a = mountWithLog(7);
    const b = mountWithLog(7);
    a.inst.renderFrame(2000, 7);
    b.inst.renderFrame(2000, 7);
    expect(sinceLastBg(a.log)).toBe(sinceLastBg(b.log));
    expect(sinceLastBg(a.log).length).toBeGreaterThan(200); // it actually drew pipes

    // ...and a different seed is a different run.
    const c = mountWithLog(11);
    c.inst.renderFrame(2000, 11);
    expect(sinceLastBg(c.log)).not.toBe(sinceLastBg(a.log));

    a.inst.dispose();
    b.inst.dispose();
    c.inst.dispose();
    a.host.remove();
    b.host.remove();
    c.host.remove();
  });

  it('seeking away and back replays to the identical canvas state', () => {
    const a = mountWithLog(7);
    a.inst.renderFrame(2000, 7);
    const at2k = sinceLastBg(a.log);
    a.inst.renderFrame(9000, 7); // later (and into a later epoch)
    a.inst.renderFrame(2000, 7); // backwards — must repaint and replay
    expect(sinceLastBg(a.log), 'seek-back is bit-identical').toBe(at2k);
    a.inst.dispose();
    a.host.remove();
  });

  it('forward playback (incremental appends) equals a cold seek to the same t', () => {
    const played = mountWithLog(7);
    for (let t = 0; t <= 3000; t += 16) played.inst.renderFrame(t, 7);
    played.inst.renderFrame(3000, 7); // the sweep's stride never lands on 3000 itself
    const cold = mountWithLog(7);
    cold.inst.renderFrame(3000, 7);
    expect(sinceLastBg(played.log), 'append path and replay path land on the same pixels').toBe(
      sinceLastBg(cold.log),
    );
    played.inst.dispose();
    cold.inst.dispose();
    played.host.remove();
    cold.host.remove();
  });

  it('epochs roll over: the screen clears and a different run grows', () => {
    const { inst, log, host } = mountWithLog(7);
    const anyInst = inst as unknown as { epochSteps: number[]; paintedEpoch: number };
    inst.renderFrame(100, 7);
    const epoch0Dur = anyInst.epochSteps[0]! * (1000 / 180);
    expect(epoch0Dur).toBeGreaterThan(1000); // a real screen-filling run

    inst.renderFrame(epoch0Dur + 500, 7);
    expect(anyInst.paintedEpoch).toBe(1);
    const epoch1 = sinceLastBg(log);

    const fresh = mountWithLog(7);
    fresh.inst.renderFrame(500, 7);
    expect(epoch1, 'epoch 1 is a different seeded run than epoch 0').not.toBe(sinceLastBg(fresh.log));

    inst.dispose();
    fresh.inst.dispose();
    host.remove();
    fresh.host.remove();
  });

  it('the compiled plan honours the fill threshold and the grid bounds', () => {
    const { inst, host } = mountWithLog(7);
    const anyInst = inst as unknown as {
      compileEpoch(e: number): { steps: { kind: string; col: number; row: number; c2: number; r2: number }[] };
      cols: number;
      rows: number;
    };
    const plan = anyInst.compileEpoch(0);
    const size = anyInst.cols * anyInst.rows;
    const cells = plan.steps.filter((s) => s.kind !== 'end').length;
    expect(cells / size).toBeGreaterThan(0.6); // it genuinely fills the screen
    expect(cells / size).toBeLessThan(0.7); // ...and stops at the threshold
    for (const s of plan.steps) {
      if (s.kind === 'seg') {
        expect(Math.abs(s.c2 - s.col) + Math.abs(s.r2 - s.row), 'segments are one cell long').toBe(1);
        expect(s.c2).toBeGreaterThanOrEqual(0);
        expect(s.c2).toBeLessThan(anyInst.cols);
        expect(s.r2).toBeGreaterThanOrEqual(0);
        expect(s.r2).toBeLessThan(anyInst.rows);
      }
    }
    inst.dispose();
    host.remove();
  });

  it('a reduced-motion still is never a bare background', () => {
    const { log, inst, host } = mountWithLog(7);
    // Constructor ran renderStill (reducedMotion: true) — pipes must be visible.
    expect(sinceLastBg(log).length).toBeGreaterThan(200);
    inst.dispose();
    host.remove();
  });
});
