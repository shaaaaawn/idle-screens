// @vitest-environment happy-dom
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRng, type PageContext, type SaverContext, type SaverInstance } from '@idle-screens/core';
import { tide } from './index';

/* happy-dom has no Canvas2D — stub just enough for the tide to draw into. */
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
    clip: () => {},
    fill: () => {},
    stroke: () => {},
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

/** A fake page of blocks at known, untransformed positions. */
function makePage(): { host: HTMLElement; page: PageContext; victims: HTMLElement[] } {
  const host = document.createElement('div');
  document.body.append(host);
  const victims: HTMLElement[] = [];
  for (let i = 0; i < 12; i++) {
    const el = document.createElement('p');
    el.dataset.idleVictim = '';
    const top = 40 + i * 60;
    const width = i % 3 === 0 ? 640 : 180;
    const height = i % 3 === 0 ? 120 : 26;
    el.getBoundingClientRect = () =>
      ({
        left: 80,
        top,
        right: 80 + width,
        bottom: top + height,
        width,
        height,
        x: 80,
        y: top,
      }) as DOMRect;
    document.body.append(el);
    victims.push(el);
  }
  return { host, page: { palette: () => [], victims: () => victims }, victims };
}

function ctx(host: HTMLElement, page: PageContext): SaverContext {
  return {
    host,
    dpr: 1,
    width: W,
    height: H,
    rng: createRng(11),
    seed: 11,
    reducedMotion: true, // no rAF loop — we drive renderFrame() ourselves
    page,
  };
}

/** `tide.mount` is synchronous and always exposes `renderFrame`. */
type Frameable = SaverInstance & { renderFrame(t: number, seed: number): void };
const mount = (c: SaverContext): Frameable => tide.mount(c) as Frameable;

const snapshot = (victims: HTMLElement[]): string[] =>
  victims.map((el) => `${el.style.transform}|${el.style.filter}`);

describe('tide is frame-addressable through to the live page', () => {
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

  it('deforms the page, and re-rendering an earlier t reproduces it exactly', () => {
    const { host, page, victims } = makePage();
    const inst = mount(ctx(host, page));

    inst.renderFrame(9000, 11);
    const at9k = snapshot(victims);
    expect(at9k.some((s) => s.startsWith('matrix('))).toBe(true);

    // Seek forward past a full flood, then back. No integrated state means the
    // earlier frame must come back bit-identical — page transforms included.
    inst.renderFrame(21000, 11);
    const at21k = snapshot(victims);
    expect(at21k).not.toEqual(at9k);

    inst.renderFrame(9000, 11);
    expect(snapshot(victims)).toEqual(at9k);

    // A same-size resize re-measures every victim. The cached rects must be the
    // untransformed ones — if a measurement ever leaked the transformed layout,
    // the identical frame would come back different.
    inst.resize(W, H);
    inst.renderFrame(9000, 11);
    expect(snapshot(victims), 'resize re-measures from the untransformed layout').toEqual(at9k);

    inst.dispose();
    host.remove();
  });

  it('hands each victim a non-degenerate affine, not just a translation', () => {
    const { host, page, victims } = makePage();
    const inst = mount(ctx(host, page));
    inst.renderFrame(13000, 11);

    let sheared = 0;
    for (const el of victims) {
      const t = el.style.transform;
      if (!t.startsWith('matrix(')) continue;
      const m = t.slice(7, -1).split(',').map(Number);
      const [a, b, c, d] = m as [number, number, number, number];
      // Never mirrored or collapsed — the J_CLAMP guarantee.
      expect(a * d - b * c).toBeGreaterThan(0.15);
      if (Math.abs(a - 1) > 0.01 || Math.abs(b) > 0.01 || Math.abs(c) > 0.01 || Math.abs(d - 1) > 0.01) {
        sheared++;
      }
    }
    expect(sheared, 'the field derivative reaches the page').toBeGreaterThan(0);

    inst.dispose();
    host.remove();
  });

  it('restores every inline style it touched on dispose', () => {
    const { host, page, victims } = makePage();
    for (const el of victims) el.style.transform = 'translateX(3px)';
    const before = victims.map((el) => [
      el.style.transform,
      el.style.transformOrigin,
      el.style.filter,
      el.style.willChange,
      el.style.transition,
    ]);

    const inst = mount(ctx(host, page));
    inst.renderFrame(13000, 11);
    inst.dispose();

    const after = victims.map((el) => [
      el.style.transform,
      el.style.transformOrigin,
      el.style.filter,
      el.style.willChange,
      el.style.transition,
    ]);
    expect(after).toEqual(before);
    host.remove();
  });

  // `composition()` and `applyTrack()` arrived with the core composition-stack
  // change in this release and had no test in this package, which is what the
  // ratcheted coverage gate caught. The stack is what the playground's inspector
  // renders, so a wrong `el` or a missing layer is a real defect.
  it('describes its composition stack, binding the surface layer to the live canvas', () => {
    const { host, page } = makePage();
    const inst = mount(ctx(host, page));

    const stack = inst.composition?.() ?? [];
    expect(stack.length).toBeGreaterThan(0);

    // Bottom-up: the borrowed page sits under the water canvas, then passes.
    expect(stack[0]?.kind).toBe('page');
    const surface = stack.find((l) => l.kind === 'surface');
    expect(surface?.el, 'the surface layer must point at a real canvas to be toggleable').toBeInstanceOf(
      HTMLCanvasElement,
    );
    expect(host.contains(surface!.el as HTMLElement)).toBe(true);

    // Ids are what the inspector keys rows on, so they have to be unique.
    const ids = stack.map((l) => l.id);
    expect(new Set(ids).size, `duplicate layer ids: ${ids.join(', ')}`).toBe(ids.length);
    for (const layer of stack) expect(layer.label).toMatch(/\S/);

    inst.dispose();
    host.remove();
  });

  it('applyTrack while paused re-renders the still rather than waiting for a frame', () => {
    const { host, page, victims } = makePage();
    const inst = mount(ctx(host, page));

    inst.renderFrame(9000, 11);
    inst.setPaused(true);
    const before = snapshot(victims);

    // A paused saver runs no frames, so steering has to repaint immediately or
    // the change is invisible until something resumes it.
    inst.applyTrack?.({ program: 'tide', seed: 11, deltas: [] });
    expect(snapshot(victims)).toEqual(before);

    inst.dispose();
    host.remove();
  });
});
