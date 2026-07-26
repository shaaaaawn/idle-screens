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
});
