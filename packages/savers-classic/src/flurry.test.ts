// @vitest-environment happy-dom
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRng, type SaverContext, type SaverInstance } from '@idle-screens/core';
import { flurry, flurryManifest, flurryDemoTrack } from './flurry';

/* -------------------------------------------------------------------------- */
/*  Stub HTMLCanvasElement.getContext                                          */
/*                                                                            */
/*  happy-dom has no Canvas2D. Stub just enough for flurry to draw into, and  */
/*  record every `stroke()` call (endpoints + width + color) — flurry draws   */
/*  its ribbon as connected tapered segments, so this is what "a frame" is.  */
/* -------------------------------------------------------------------------- */

interface StrokeCall {
  path: Array<[number, number]>;
  lineWidth: number;
  strokeStyle: string;
}

let strokeCalls: StrokeCall[] = [];

function stubContext2D(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => {} } as unknown as CanvasGradient;
  let path: Array<[number, number]> = [];
  const ctxObj = {
    canvas,
    fillRect: () => {},
    clearRect: () => {},
    beginPath: () => {
      path = [];
    },
    closePath: () => {},
    moveTo: (x: number, y: number) => {
      path = [[x, y]];
    },
    lineTo: (x: number, y: number) => {
      path.push([x, y]);
    },
    arc: () => {},
    fill: () => {},
    stroke: () => {
      strokeCalls.push({
        path: [...path],
        lineWidth: ctxObj.lineWidth,
        strokeStyle: String(ctxObj.strokeStyle),
      });
    },
    fillText: () => {},
    setTransform: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '10px monospace',
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
  };
  return ctxObj as unknown as CanvasRenderingContext2D;
}

let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

beforeAll(() => {
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    return stubContext2D(this);
  } as unknown as HTMLCanvasElement['getContext'];
});

afterAll(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

/* -------------------------------------------------------------------------- */

const W = 800;
const H = 480;

function makeCtx(seed = 11): SaverContext {
  return {
    host: document.createElement('div'),
    dpr: 1,
    width: W,
    height: H,
    rng: createRng(seed),
    seed,
    reducedMotion: true, // no rAF loop — we drive renderFrame() ourselves
  };
}

type Frameable = SaverInstance & { renderFrame(t: number, seed: number): void };
const mount = (c: SaverContext): Frameable => flurry.mount(c) as Frameable;

/** Reset the recorded-draw buffer before a capture. */
function resetCalls(): void {
  strokeCalls = [];
}

/** Snapshot of everything painted this frame: every ribbon segment's
 *  endpoints, width (size/taper), and color (hue/alpha/palette) — so
 *  determinism checks catch a hue regression as readily as a geometry one. */
function snapshotDraw(): StrokeCall[] {
  return strokeCalls.map((c) => ({ ...c, path: [...c.path] }));
}

describe('flurry manifest', () => {
  it('has the expected id, label, and worker/flash-safety flags', () => {
    expect(flurryManifest.id).toBe('flurry');
    expect(flurryManifest.label).toMatch(/\S/);
    expect(flurryManifest.workerReady).toBe(true);
    expect(flurryManifest.a11y?.flashSafe).toBe(true);
  });

  it('declares the full typed param space', () => {
    const space = flurryManifest.paramSpace;
    expect(space).toBeDefined();
    expect(new Set(Object.keys(space!))).toEqual(
      new Set(['arms', 'speed', 'glow', 'trail', 'palette', 'size']),
    );
  });

  it('every default value sits within its declared range/options', () => {
    const space = flurryManifest.paramSpace!;
    for (const [key, def] of Object.entries(space)) {
      if (def.type === 'number') {
        expect(def.default as number, `${key} default >= min`).toBeGreaterThanOrEqual(def.min!);
        expect(def.default as number, `${key} default <= max`).toBeLessThanOrEqual(def.max!);
      } else if (def.type === 'enum') {
        expect(def.options, `${key} declares options`).toBeDefined();
        expect(def.options, `${key} default is one of its options`).toContain(def.default as string);
      }
    }
    // The preserved default arm count from the original port.
    expect(space.arms!.default).toBe(5);
  });
});

describe('flurryDemoTrack', () => {
  it('targets the flurry program, is ~16s, and every delta path/value is valid', () => {
    expect(flurryDemoTrack.program).toBe('flurry');
    expect(flurryDemoTrack.duration).toBe(16_000);
    expect(flurryDemoTrack.deltas.length).toBeGreaterThan(0);

    const space = flurryManifest.paramSpace!;
    for (const d of flurryDemoTrack.deltas) {
      const def = space[d.path];
      expect(def, `"${d.path}" is a declared param`).toBeDefined();
      if (def!.type === 'number') {
        expect(d.value as number).toBeGreaterThanOrEqual(def!.min!);
        expect(d.value as number).toBeLessThanOrEqual(def!.max!);
      } else if (def!.type === 'enum') {
        expect(def!.options).toContain(d.value as string);
      }
      expect(d.t).toBeGreaterThanOrEqual(0);
      expect(d.t).toBeLessThanOrEqual(flurryDemoTrack.duration!);
    }

    // It actually steers speed/glow/palette, per spec.
    const paths = new Set(flurryDemoTrack.deltas.map((d) => d.path));
    expect(paths.has('speed')).toBe(true);
    expect(paths.has('glow')).toBe(true);
    expect(paths.has('palette')).toBe(true);
  });
});

describe('flurry: closed-form rendering (stubbed 2d context)', () => {
  it('mounts, renders, and disposes without throwing', () => {
    const inst = mount(makeCtx());
    expect(() => {
      for (let t = 0; t < 20_000; t += 733) inst.renderFrame(t, 11);
    }).not.toThrow();
    expect(() => inst.dispose()).not.toThrow();
  });

  it('same (t, seed) paints an identical frame — geometry AND color', () => {
    const inst = mount(makeCtx());

    resetCalls();
    inst.renderFrame(6000, 11);
    const first = snapshotDraw();
    expect(first.length).toBeGreaterThan(0); // arms actually drew ribbon segments

    resetCalls();
    inst.renderFrame(6000, 11);
    const second = snapshotDraw();
    expect(second).toEqual(first);

    inst.dispose();
  });

  it('seeking away and back (6000 -> 1500 -> 6000) reproduces the pinned frame exactly', () => {
    const inst = mount(makeCtx());

    resetCalls();
    inst.renderFrame(6000, 11);
    const pinned = snapshotDraw();

    expect(() => inst.renderFrame(1500, 11)).not.toThrow();

    resetCalls();
    expect(() => inst.renderFrame(6000, 11)).not.toThrow();
    expect(snapshotDraw()).toEqual(pinned);

    inst.dispose();
  });

  it('rebuilds arm count deterministically as the "arms" param moves (build-time knob)', () => {
    const inst = mount(makeCtx(5));

    resetCalls();
    inst.renderFrame(3000, 5);
    const fiveArmDraws = strokeCalls.length;

    inst.applyTrack!({
      program: 'flurry',
      seed: 5,
      duration: 4000,
      deltas: [{ t: 0, path: 'arms', value: 9 }],
    });

    resetCalls();
    expect(() => inst.renderFrame(3000, 5)).not.toThrow();
    const nineArmDraws = strokeCalls.length;

    // More arms -> more ribbon segments drawn (each arm draws the same segment count).
    expect(nineArmDraws).toBeGreaterThan(fiveArmDraws);

    inst.dispose();
  });

  it('ribbon has no gaps: each core segment starts exactly where the previous one ended', () => {
    // This is the identity check: flurry must read as continuous weaving
    // ribbons, not a dotted comet trail. Each arm is drawn as consecutive
    // stroked segments (a soft halo pass, then a bright core pass) — the
    // core passes are the actual traced path, and consecutive segments must
    // share an endpoint exactly (they're built from the same sampled-point
    // array), which is what guarantees zero visual gaps regardless of the
    // curve's local speed/curvature.
    const inst = mount(makeCtx(5)); // default arms = 5
    resetCalls();
    inst.renderFrame(4000, 5);
    const calls = strokeCalls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.length % 2).toBe(0); // halo+core pairs

    const core = calls.filter((_, idx) => idx % 2 === 1);
    const segmentsPerArm = core.length / 5;
    expect(Number.isInteger(segmentsPerArm)).toBe(true);
    expect(segmentsPerArm).toBeGreaterThanOrEqual(39); // >=40 samples/arm => >=39 segments

    for (let arm = 0; arm < 5; arm++) {
      const armSegs = core.slice(arm * segmentsPerArm, (arm + 1) * segmentsPerArm);
      for (let k = 0; k < armSegs.length - 1; k++) {
        expect(armSegs[k]!.path[1], `arm ${arm} segment ${k} connects to the next`).toEqual(
          armSegs[k + 1]!.path[0],
        );
      }
    }

    inst.dispose();
  });

  it('honors reducedMotion (paused + a still frame) and survives resize', () => {
    const inst = mount(makeCtx());
    expect(() => inst.resize(1024, 640)).not.toThrow();
    expect(() => inst.setPaused(false)).not.toThrow();
    expect(() => inst.setPaused(true)).not.toThrow();
    inst.dispose();
  });

  it('pausing freezes on the frame actually showing, not a fixed anchor', () => {
    const inst = mount(makeCtx());

    // Deliberately not STILL_T's own value — this pins that setPaused(true)
    // re-renders wherever we were (this.t), rather than snapping to an
    // internal constant.
    resetCalls();
    inst.renderFrame(9000, 11);
    const shown = snapshotDraw();

    resetCalls();
    inst.setPaused(true); // stops the loop and calls renderStill()
    expect(snapshotDraw()).toEqual(shown);

    inst.dispose();
  });
});
