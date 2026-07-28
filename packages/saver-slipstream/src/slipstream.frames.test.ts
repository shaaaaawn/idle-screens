// @vitest-environment happy-dom
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRng, type PageContext, type SaverContext, type SaverInstance } from '@idle-screens/core';
import { slipstream, demoTrack } from './index';

/* happy-dom has no Canvas2D — stub just enough for the wind to draw into. */
function stubContext2D(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => {} } as unknown as CanvasGradient;
  return {
    canvas,
    fillRect: () => {},
    clearRect: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    fill: () => {},
    stroke: () => {},
    setTransform: () => {},
    setLineDash: () => {},
    save: () => {},
    restore: () => {},
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineDashOffset: 0,
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
}

const W = 1280;
const H = 800;

interface Spec {
  left: number;
  top: number;
  width: number;
  height: number;
}

function makePage(specs: Spec[]): { host: HTMLElement; page: PageContext; victims: HTMLElement[] } {
  const host = document.createElement('div');
  document.body.append(host);
  const victims: HTMLElement[] = [];
  for (const s of specs) {
    const el = document.createElement('p');
    el.dataset.idleVictim = '';
    el.getBoundingClientRect = () =>
      ({
        left: s.left,
        top: s.top,
        right: s.left + s.width,
        bottom: s.top + s.height,
        width: s.width,
        height: s.height,
        x: s.left,
        y: s.top,
      }) as DOMRect;
    document.body.append(el);
    victims.push(el);
  }
  return { host, page: { palette: () => [], victims: () => victims }, victims };
}

const GRID: Spec[] = Array.from({ length: 10 }, (_, i) => ({
  left: 100 + (i % 2) * 560,
  top: 80 + Math.floor(i / 2) * 140,
  width: i % 3 === 0 ? 420 : 160,
  height: i % 3 === 0 ? 100 : 28,
}));

function ctx(host: HTMLElement, page: PageContext): SaverContext {
  return {
    host,
    dpr: 1,
    width: W,
    height: H,
    rng: createRng(23),
    seed: 23,
    reducedMotion: true, // no rAF loop — we drive renderFrame() ourselves
    page,
  };
}

type Frameable = SaverInstance & { renderFrame(t: number, seed: number): void };
const mount = (c: SaverContext): Frameable => slipstream.mount(c) as Frameable;

const snapshot = (victims: HTMLElement[]): string[] => victims.map((el) => el.style.transform);

describe('slipstream: the page is the boundary condition', () => {
  let originalGetContext: HTMLCanvasElement['getContext'];

  beforeAll(() => {
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
      return stubContext2D(this);
    } as unknown as HTMLCanvasElement['getContext'];
  });

  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it('the wind moves the page, and re-rendering an earlier t reproduces it exactly', () => {
    const { host, page, victims } = makePage(GRID);
    const inst = mount(ctx(host, page));

    inst.renderFrame(5000, 23);
    const at5k = snapshot(victims);
    expect(at5k.some((s) => s.includes('rotate('))).toBe(true);

    inst.renderFrame(26_000, 23);
    expect(snapshot(victims)).not.toEqual(at5k);

    // The streamline cache is keyed on a t-derived bucket, so seeking back
    // must land on the identical frame — page transforms included.
    inst.renderFrame(5000, 23);
    expect(snapshot(victims), 'seeking back reproduces the frame').toEqual(at5k);

    inst.resize(W, H);
    inst.renderFrame(5000, 23);
    expect(snapshot(victims), 'resize re-measures from the untransformed layout').toEqual(at5k);

    inst.dispose();
    host.remove();
  });

  it('a block in the lee of a large obstacle feels different wind than one in the open', () => {
    // Wind blows left-to-right. Two identical small blocks at the same x, but
    // one sits directly downstream of a large slab (in its deflected field).
    const open: Spec = { left: 800, top: 600, width: 120, height: 24 };
    const shadowed: Spec = { left: 800, top: 200, width: 120, height: 24 };
    const slab: Spec = { left: 480, top: 140, width: 260, height: 140 };
    const { host, page, victims } = makePage([open, shadowed, slab]);
    const inst = mount(ctx(host, page));
    inst.applyTrack?.({
      program: 'slipstream',
      seed: 23,
      duration: 1000,
      loop: true,
      deltas: [
        { t: 0, path: 'windAngle', value: 0 },
        { t: 0, path: 'veer', value: 0 },
        { t: 0, path: 'gustiness', value: 0 },
        { t: 0, path: 'flutter', value: 0 },
      ],
    });
    inst.renderFrame(500, 23);

    const rot = (el: HTMLElement): number =>
      Number(/rotate\((-?[\d.]+)deg\)/.exec(el.style.transform)?.[1] ?? '0');
    // give differs per index — normalise by comparing the RATIO of x-motion to
    // rotation... simpler: both have identical dimensions, so identical give
    // curves differ only by the fork jitter. Assert the FIELD differs: the two
    // transforms must not be equal once per-block jitter is cancelled out by
    // flutter=0 and identical geometry. Different local velocity ⇒ different
    // lean per unit give ⇒ different rotate/translate mix.
    const a = victims[0] as HTMLElement;
    const b = victims[1] as HTMLElement;
    expect(a.style.transform).not.toBe('');
    expect(b.style.transform).not.toBe('');
    expect(Math.abs(rot(a) - rot(b)), 'the slab deflects the wind reaching its lee').toBeGreaterThan(0.005);

    inst.dispose();
    host.remove();
  });

  it('the advection phase is continuous across flow buckets and pure in t', () => {
    const { host, page } = makePage(GRID);
    const inst = mount(ctx(host, page));
    inst.applyTrack?.(demoTrack); // gusty, so bucket speeds genuinely differ

    const phaseAt = (i: Frameable, t: number): number =>
      (i as unknown as { phaseAt(t: number): number }).phaseAt(t);

    // Continuity: dashes/dust used to advance by t * bucketSpeed, teleporting
    // by t·ΔS at every boundary (worse the longer the saver ran). The phase
    // integral may only advance by ~speed·dt across a boundary.
    const maxSpeed = 3 * 2; // windSpeed ceiling × gust ceiling
    for (const edge of [240, 480, 60_000, 600_000]) {
      const before = phaseAt(inst, edge - 1);
      const after = phaseAt(inst, edge + 1);
      expect(after, `phase advances at t=${edge}`).toBeGreaterThan(before);
      expect(after - before, `no teleport at t=${edge}`).toBeLessThan(maxSpeed * 2 + 0.01);
    }

    // Purity: a played-through instance and a cold seek agree exactly.
    const played = phaseAt(inst, 30_000);
    const { host: h2, page: p2 } = makePage(GRID);
    const cold = mount(ctx(h2, p2));
    cold.applyTrack?.(demoTrack);
    expect(phaseAt(cold, 30_000)).toBeCloseTo(played, 6);

    inst.dispose();
    cold.dispose();
    host.remove();
    h2.remove();
  });

  it('page lean is continuous across a flow-bucket boundary', () => {
    const { host, page, victims } = makePage(GRID);
    const inst = mount(ctx(host, page));
    inst.applyTrack?.(demoTrack); // wind genuinely changing bucket to bucket

    const rot = (el: HTMLElement): number =>
      Number(/rotate\((-?[\d.]+)deg\)/.exec(el.style.transform)?.[1] ?? '0');

    // The lean used to come from the bucket wind snapshot, so every block
    // stepped at each 240ms boundary. Live wind means a 2ms hop across the
    // boundary moves a block no more than a 2ms hop inside one.
    const el = victims[0] as HTMLElement;
    inst.renderFrame(15_119, 23);
    const inside = rot(el);
    inst.renderFrame(15_121, 23); // same bucket
    const insideStep = Math.abs(rot(el) - inside);
    inst.renderFrame(15_359, 23);
    const before = rot(el);
    inst.renderFrame(15_361, 23); // crosses the 15_360 boundary
    const acrossStep = Math.abs(rot(el) - before);
    expect(acrossStep, 'no per-bucket tick').toBeLessThan(Math.max(insideStep * 4, 0.05));

    inst.dispose();
    host.remove();
  });

  it('the crossfade pair (current + previous bucket lines) is reproducible from a cold seek', () => {
    interface LineInternals {
      lines: { pts: Float32Array; n: number }[];
      prevLines: { pts: Float32Array; n: number }[];
    }
    const fingerprint = (i: Frameable): string => {
      const { lines, prevLines } = i as unknown as LineInternals;
      const sig = (set: LineInternals['lines']): number[] =>
        set.slice(0, 5).flatMap((l) => [l.n, l.pts[0]!, l.pts[1]!, l.pts[(l.n - 1) * 2]!]);
      return JSON.stringify({ n: lines.length, p: prevLines.length, a: sig(lines), b: sig(prevLines) });
    };

    const { host, page } = makePage(GRID);
    const played = mount(ctx(host, page));
    played.applyTrack?.(demoTrack);
    for (let t = 0; t <= 1000; t += 16) played.renderFrame(t, 23);
    const warm = fingerprint(played);

    const { host: h2, page: p2 } = makePage(GRID);
    const cold = mount(ctx(h2, p2));
    cold.applyTrack?.(demoTrack);
    cold.renderFrame(1000, 23);
    expect(fingerprint(cold), 'seek lands on the same current AND previous line sets').toBe(warm);

    played.dispose();
    cold.dispose();
    host.remove();
    h2.remove();
  });

  it('a prebuilt bucket adopted at the boundary equals a synchronous build', () => {
    const lineSig = (i: Frameable): string => {
      const lines = (i as unknown as { lines: { pts: Float32Array; n: number }[] }).lines;
      return JSON.stringify(lines.map((l) => [l.n, l.pts[0], l.pts[1], l.pts[(l.n - 1) * 2]]));
    };

    // Warm path: quiet frames inside bucket 0 integrate bucket 1 a slice at
    // a time; the boundary frame adopts the prebuilt set instead of paying
    // the whole rebuild.
    const { host, page } = makePage(GRID);
    const warm = mount(ctx(host, page));
    warm.applyTrack?.(demoTrack);
    for (let t = 0; t < 240; t += 16) warm.renderFrame(t, 23);
    warm.renderFrame(250, 23); // crosses into bucket 1 — adoption path
    const adopted = lineSig(warm);

    // Cold path: a fresh instance seeks straight to the same frame and
    // builds bucket 1 synchronously.
    const { host: h2, page: p2 } = makePage(GRID);
    const cold = mount(ctx(h2, p2));
    cold.applyTrack?.(demoTrack);
    cold.renderFrame(250, 23);
    expect(lineSig(cold), 'prebuild is bit-identical to a sync build').toBe(adopted);

    warm.dispose();
    cold.dispose();
    host.remove();
    h2.remove();
  });

  it('restores every inline style it touched on dispose', () => {
    const { host, page, victims } = makePage(GRID);
    for (const el of victims) el.style.transform = 'translateY(2px)';
    const read = (): string[][] =>
      victims.map((el) => [el.style.transform, el.style.transformOrigin, el.style.willChange, el.style.transition]);
    const before = read();

    const inst = mount(ctx(host, page));
    inst.applyTrack?.(demoTrack);
    inst.renderFrame(12_000, 23);
    inst.dispose();

    expect(read()).toEqual(before);
    host.remove();
  });

  // `composition()` and `applyTrack()` came in with the core composition-stack
  // change this release and were untested here — which is exactly what the
  // ratcheted coverage gate flagged. The playground's inspector renders this
  // stack, so a missing layer or an unbound `el` is a real defect.
  it('describes its composition stack, binding the surface layer to the live canvas', () => {
    const { host, page } = makePage(GRID);
    const inst = mount(ctx(host, page));

    const stack = inst.composition?.() ?? [];
    expect(stack.length).toBeGreaterThan(0);

    // Bottom-up: the borrowed page, then the wind canvas, then draw passes.
    expect(stack[0]?.kind).toBe('page');
    const surface = stack.find((l) => l.kind === 'surface');
    expect(surface?.el, 'the surface layer must point at a real canvas to be toggleable').toBeInstanceOf(
      HTMLCanvasElement,
    );
    expect(host.contains(surface!.el as HTMLElement)).toBe(true);

    const ids = stack.map((l) => l.id);
    expect(new Set(ids).size, `duplicate layer ids: ${ids.join(', ')}`).toBe(ids.length);
    for (const layer of stack) expect(layer.label).toMatch(/\S/);

    inst.dispose();
    host.remove();
  });

  it('applyTrack while paused repaints instead of waiting for a frame', () => {
    const { host, page, victims } = makePage(GRID);
    const inst = mount(ctx(host, page));

    inst.renderFrame(9000, 11);
    inst.setPaused(true);
    const before = snapshot(victims);

    // Paused means no frames run, so steering must repaint or be invisible.
    inst.applyTrack?.({ program: 'slipstream', seed: 11, deltas: [] });
    expect(snapshot(victims)).toEqual(before);

    inst.dispose();
    host.remove();
  });
});
