// @vitest-environment happy-dom
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRng, type PageContext, type SaverContext, type SaverInstance } from '@idle-screens/core';
import { limelight, demoTrack } from './index';

/* happy-dom has no Canvas2D — stub just enough for the stage to draw into. */
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
    ellipse: () => {},
    fill: () => {},
    stroke: () => {},
    drawImage: () => {},
    setTransform: () => {},
    save: () => {},
    restore: () => {},
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
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

/** A fake set of blocks at known, untransformed positions. */
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

/** A generic grid of blocks — enough overlap for some to shade others. */
const GRID: Spec[] = Array.from({ length: 12 }, (_, i) => ({
  left: 120 + (i % 3) * 340,
  top: 90 + Math.floor(i / 3) * 170,
  width: i % 4 === 0 ? 300 : 150,
  height: i % 4 === 0 ? 110 : 30,
}));

function ctx(host: HTMLElement, page: PageContext): SaverContext {
  return {
    host,
    dpr: 1,
    width: W,
    height: H,
    rng: createRng(5),
    seed: 5,
    reducedMotion: true, // no rAF loop — we drive renderFrame() ourselves
    page,
  };
}

type Frameable = SaverInstance & { renderFrame(t: number, seed: number): void };
const mount = (c: SaverContext): Frameable => limelight.mount(c) as Frameable;

const snapshot = (victims: HTMLElement[]): string[] =>
  victims.map((el) => `${el.style.transform}|${el.style.filter}`);

describe('limelight stages the live page', () => {
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

  it('lifts blocks and lights them, and re-rendering an earlier t reproduces it exactly', () => {
    const { host, page, victims } = makePage(GRID);
    const inst = mount(ctx(host, page));

    inst.renderFrame(4000, 5);
    const at4k = snapshot(victims);
    expect(at4k.some((s) => s.includes('brightness('))).toBe(true);
    expect(at4k.some((s) => s.startsWith('translate('))).toBe(true);

    // Seek far forward, then back. The occlusion cache is keyed on a bucket
    // derived from t, so the earlier frame must come back bit-identical.
    inst.renderFrame(23_000, 5);
    expect(snapshot(victims)).not.toEqual(at4k);

    inst.renderFrame(4000, 5);
    expect(snapshot(victims), 'seeking back reproduces the frame').toEqual(at4k);

    // Same-size resize re-measures from the untransformed layout.
    inst.resize(W, H);
    inst.renderFrame(4000, 5);
    expect(snapshot(victims), 'resize re-measures the untransformed boxes').toEqual(at4k);

    inst.dispose();
    host.remove();
  });

  it('a block standing behind another is dimmer than the same block in the clear', () => {
    // Two identical blocks mirrored about the light, so distance falloff is
    // identical; only the right-hand one has a flat parked on its light ray.
    // Light (640, 16) -> shaded centre (975, 615) crosses x≈771..821 over
    // y 250..340, which is why the blocker sits there and not above the block.
    const light = { x: 0.5, y: 0.02 };
    const clear: Spec = { left: 230, top: 600, width: 150, height: 30 };
    const shaded: Spec = { left: 900, top: 600, width: 150, height: 30 };
    const blocker: Spec = { left: 730, top: 250, width: 140, height: 90 };

    const { host, page, victims } = makePage([clear, shaded, blocker]);
    const inst = mount(ctx(host, page));
    inst.applyTrack?.({
      program: 'limelight',
      seed: 5,
      duration: 1000,
      loop: true,
      deltas: [
        { t: 0, path: 'roamX', value: 0 },
        { t: 0, path: 'roamY', value: 0 },
        { t: 0, path: 'lightX', value: light.x },
        { t: 0, path: 'lightY', value: light.y },
        { t: 0, path: 'beamSize', value: 1.2 },
        { t: 0, path: 'occlusion', value: 1 },
      ],
    });
    inst.renderFrame(500, 5);

    const bri = (el: HTMLElement): number =>
      Number(/brightness\(([\d.]+)\)/.exec(el.style.filter)?.[1] ?? '1');

    const clearBri = bri(victims[0] as HTMLElement);
    const shadedBri = bri(victims[1] as HTMLElement);
    expect(shadedBri, 'the shaded block is dimmed by the block in front of it').toBeLessThan(clearBri);

    inst.dispose();
    host.remove();
  });

  it('restores every inline style it touched on dispose', () => {
    const { host, page, victims } = makePage(GRID);
    for (const el of victims) el.style.filter = 'contrast(1.1)';
    const read = (): string[][] =>
      victims.map((el) => [
        el.style.transform,
        el.style.transformOrigin,
        el.style.filter,
        el.style.willChange,
        el.style.transition,
      ]);
    const before = read();

    const inst = mount(ctx(host, page));
    inst.applyTrack?.(demoTrack);
    inst.renderFrame(9000, 5);
    inst.dispose();

    expect(read()).toEqual(before);
    host.remove();
  });
});
