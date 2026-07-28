// @vitest-environment happy-dom
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRng, type SaverContext, type SaverInstance } from '@idle-screens/core';
import { mystify } from './mystify';

/**
 * Mystify renders full frames (black field + ghost trail + live outline), so
 * "the same pixels" is simply "the same op log for one renderFrame call".
 * The stub records draw calls with their active styles.
 */
type Op = (string | number)[];

function recordingStub(log: Op[]): CanvasRenderingContext2D {
  let fillStyle = '';
  let strokeStyle = '';
  let lineWidth = 0;
  const stub = {
    fillRect: (...a: number[]) => log.push(['fillRect', fillStyle, ...a]),
    clearRect: () => {},
    beginPath: () => log.push(['beginPath']),
    closePath: () => {},
    moveTo: (...a: number[]) => log.push(['moveTo', ...a]),
    lineTo: (...a: number[]) => log.push(['lineTo', ...a]),
    arc: () => {},
    stroke: () => log.push(['stroke', strokeStyle, lineWidth]),
    fill: () => {},
    setTransform: () => {},
    lineCap: 'butt',
    lineJoin: 'miter',
  };
  Object.defineProperties(stub, {
    fillStyle: { get: () => fillStyle, set: (v: string) => (fillStyle = v) },
    strokeStyle: { get: () => strokeStyle, set: (v: string) => (strokeStyle = v) },
    lineWidth: { get: () => lineWidth, set: (v: number) => (lineWidth = v) },
  });
  return stub as unknown as CanvasRenderingContext2D;
}

const W = 1024;
const H = 640;
const logs = new WeakMap<HTMLCanvasElement, Op[]>();

type Frameable = SaverInstance & { renderFrame(t: number, seed: number): void };

function mountWithLog(seed = 5): { inst: Frameable; log: Op[]; host: HTMLElement } {
  const host = document.createElement('div');
  document.body.append(host);
  const ctx: SaverContext = { host, dpr: 1, width: W, height: H, rng: createRng(seed), seed, reducedMotion: true };
  const inst = mystify.mount(ctx) as Frameable;
  const canvas = host.querySelector('canvas') as HTMLCanvasElement;
  return { inst, log: logs.get(canvas)!, host };
}

/** One full frame = everything from the final background fill onward. */
const lastFrame = (log: Op[]): string => {
  let last = 0;
  for (let i = 0; i < log.length; i++) if (log[i]![0] === 'fillRect') last = i;
  return JSON.stringify(log.slice(last));
};

describe('mystify: closed-form ribbons', () => {
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

  it('the same (t, seed) is the same frame; seek-back reproduces it exactly', () => {
    const a = mountWithLog(5);
    const b = mountWithLog(5);
    a.inst.renderFrame(4000, 5);
    b.inst.renderFrame(4000, 5);
    expect(lastFrame(a.log)).toBe(lastFrame(b.log));

    a.inst.renderFrame(20_000, 5);
    a.inst.renderFrame(4000, 5);
    expect(lastFrame(a.log), 'seek away and back is bit-identical').toBe(lastFrame(b.log));

    const c = mountWithLog(9);
    c.inst.renderFrame(4000, 9);
    expect(lastFrame(c.log), 'a different seed is a different weave').not.toBe(lastFrame(a.log));

    a.inst.dispose();
    b.inst.dispose();
    c.inst.dispose();
    a.host.remove();
    b.host.remove();
    c.host.remove();
  });

  it('every vertex stays folded inside the viewport, forever', () => {
    const { inst, log, host } = mountWithLog(5);
    for (const t of [50, 3000, 60_000, 3_600_000]) {
      inst.renderFrame(t, 5);
      for (const op of log) {
        if (op[0] === 'moveTo' || op[0] === 'lineTo') {
          expect(op[1] as number).toBeGreaterThanOrEqual(0);
          expect(op[1] as number).toBeLessThanOrEqual(W);
          expect(op[2] as number).toBeGreaterThanOrEqual(0);
          expect(op[2] as number).toBeLessThanOrEqual(H);
        }
      }
      log.length = 0;
    }
    inst.dispose();
    host.remove();
  });

  it('the ghost trail draws oldest-first with rising alpha, ending on the live outline', () => {
    const { inst, log, host } = mountWithLog(5);
    inst.renderFrame(5000, 5);
    const frame = JSON.parse(lastFrame(log)) as Op[];
    const alphas = frame
      .filter((op) => op[0] === 'stroke')
      .map((op) => Number(/([\d.]+)\)$/.exec(String(op[1]))?.[1] ?? '-1'));
    expect(alphas.length).toBeGreaterThan(6); // several ghosts × shapes
    // Alpha never decreases through the draw order, and the top is near-solid.
    for (let i = 1; i < alphas.length; i++) expect(alphas[i]).toBeGreaterThanOrEqual(alphas[i - 1]! - 1e-9);
    expect(alphas[alphas.length - 1]).toBeCloseTo(0.92, 2);
    inst.dispose();
    host.remove();
  });

  it('params plumb: shapes, trail, width and hueShift all reach the frame', () => {
    const { inst, log, host } = mountWithLog(5);
    const strokes = (): Op[] => (JSON.parse(lastFrame(log)) as Op[]).filter((op) => op[0] === 'stroke');

    inst.renderFrame(5000, 5);
    const base = strokes();

    inst.applyTrack?.({
      program: 'mystify',
      seed: 5,
      duration: 1000,
      loop: true,
      deltas: [
        { t: 0, path: 'shapes', value: 6 },
        { t: 0, path: 'trail', value: 1 },
        { t: 0, path: 'width', value: 4 },
        { t: 0, path: 'hueShift', value: 120 },
      ],
    });
    inst.renderFrame(5000, 5);
    const steered = strokes();

    expect(steered.length, 'more shapes and a longer trail mean more strokes').toBeGreaterThan(base.length * 1.5);
    expect(steered.every((op) => op[2] === 4), 'width reaches the stroke').toBe(true);
    const hueOf = (op: Op): number => Number(/hsla\((\d+(?:\.\d+)?)/.exec(String(op[1]))?.[1] ?? '-1');
    // Strokes group per ghost (n shapes each, newest ghost last) — compare
    // shape 0 of the newest ghost in both frames (base n=3, steered n=6).
    expect(hueOf(steered[steered.length - 6]!), 'hueShift rotates the palette').toBe(
      (hueOf(base[base.length - 3]!) + 120) % 360,
    );

    inst.dispose();
    host.remove();
  });

  it('a steered speed never teleports the ribbons (integral, not t x rate)', () => {
    const { inst, log, host } = mountWithLog(5);
    // A track whose speed changes over time — the dangerous case.
    inst.applyTrack?.({
      program: 'mystify',
      seed: 5,
      duration: 10_000,
      loop: true,
      deltas: [
        { t: 0, path: 'speed', value: 0.5 },
        { t: 10_000, path: 'speed', value: 2.5, ease: 'smooth' },
        { t: 0, path: 'trail', value: 0 }, // single outline, easy to read
      ],
    });
    const headAt = (t: number): [number, number] => {
      inst.renderFrame(t, 5);
      const frame = JSON.parse(lastFrame(log)) as Op[];
      const mv = frame.find((op) => op[0] === 'moveTo')!;
      return [mv[1] as number, mv[2] as number];
    };
    // Cross a phase-bucket boundary (250ms grid): the hop across must be no
    // larger than the same hop inside a bucket, scaled generously.
    const [x1, y1] = headAt(8124);
    const [x2, y2] = headAt(8126);
    const inside = Math.hypot(x2 - x1, y2 - y1);
    const [x3, y3] = headAt(8249);
    const [x4, y4] = headAt(8251);
    const across = Math.hypot(x4 - x3, y4 - y3);
    expect(across, 'no teleport at the bucket boundary').toBeLessThan(Math.max(inside * 4, 2.5));

    inst.dispose();
    host.remove();
  });

  it('resize keeps every identity: same t, same seed, same weave at the new size', () => {
    const a = mountWithLog(5);
    a.inst.renderFrame(4000, 5);
    a.inst.resize(W, H); // same size — must be a no-op for the geometry
    a.inst.renderFrame(4000, 5);
    const resized = lastFrame(a.log);

    const b = mountWithLog(5);
    b.inst.renderFrame(4000, 5);
    expect(resized, 'same-size resize re-derives the identical frame').toBe(lastFrame(b.log));

    a.inst.dispose();
    b.inst.dispose();
    a.host.remove();
    b.host.remove();
  });
});
