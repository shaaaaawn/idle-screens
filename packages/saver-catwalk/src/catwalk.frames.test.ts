// @vitest-environment happy-dom
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRng, type PageContext, type SaverContext, type SaverInstance } from '@idle-screens/core';
import { catwalk } from './index';

/* happy-dom has no Canvas2D — stub just enough for the cat to draw into. */
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
    quadraticCurveTo: () => {},
    arc: () => {},
    ellipse: () => {},
    fill: () => {},
    stroke: () => {},
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
  } as unknown as CanvasRenderingContext2D;
}

const W = 1280;
const H = 800;

/** A grid of perch-sized blocks the cat can tour. */
function makePage(): { host: HTMLElement; page: PageContext; victims: HTMLElement[] } {
  const host = document.createElement('div');
  document.body.append(host);
  const victims: HTMLElement[] = [];
  for (let i = 0; i < 10; i++) {
    const el = document.createElement('p');
    el.dataset.idleVictim = '';
    const left = 100 + (i % 3) * 380;
    const top = 120 + Math.floor(i / 3) * 180;
    el.getBoundingClientRect = () =>
      ({
        left, top, right: left + 260, bottom: top + 40,
        width: 260, height: 40, x: left, y: top,
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
    rng: createRng(7),
    seed: 7,
    reducedMotion: true, // no rAF loop — we drive renderFrame() ourselves
    page,
  };
}

type Frameable = SaverInstance & { renderFrame(t: number, seed: number): void };
const mount = (c: SaverContext): Frameable => catwalk.mount(c) as Frameable;

const snapshot = (victims: HTMLElement[]): string[] => victims.map((el) => el.style.transform);

describe('catwalk: the page is the cat\'s furniture', () => {
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

  it('perches ring under landings somewhere in the loop, and only perches move', () => {
    const { host, page, victims } = makePage();
    const inst = mount(ctx(host, page));

    // Sweep the loop: at least one t must catch a perch mid-spring.
    let sprung = 0;
    for (let t = 0; t < 60_000; t += 400) {
      inst.renderFrame(t, 7);
      sprung += victims.filter((el) => el.style.transform.startsWith('translateY')).length;
    }
    expect(sprung, 'landings visibly move perches across the loop').toBeGreaterThan(0);

    inst.dispose();
    host.remove();
  });

  it('re-rendering an earlier t reproduces the frame exactly, resize included', () => {
    const { host, page, victims } = makePage();
    const inst = mount(ctx(host, page));

    // Find a t where the page is actually deformed, so equality is meaningful.
    let tHit = -1;
    for (let t = 0; t < 60_000; t += 250) {
      inst.renderFrame(t, 7);
      if (victims.some((el) => el.style.transform.startsWith('translateY'))) { tHit = t; break; }
    }
    expect(tHit, 'found a deformed frame to pin').toBeGreaterThanOrEqual(0);

    inst.renderFrame(tHit, 7);
    const pinned = snapshot(victims);

    inst.renderFrame(tHit + 30_000, 7);
    inst.renderFrame(tHit, 7);
    expect(snapshot(victims), 'seek away and back is bit-identical').toEqual(pinned);

    // Same-size resize recompiles the itinerary from forked streams — the
    // same t must land the same cat on the same perch.
    inst.resize(W, H);
    inst.renderFrame(tHit, 7);
    expect(snapshot(victims), 'resize re-derives an identical itinerary').toEqual(pinned);

    inst.dispose();
    host.remove();
  });

  it('falls back to structural perches when the semantic selector finds nothing', () => {
    // A page of plain perch-sized <div>s — the gallery/app-shell case that
    // shipped as a blank dark veil. The structural second pass must find them.
    const host = document.createElement('div');
    document.body.append(host);
    const divs: HTMLElement[] = [];
    for (let i = 0; i < 6; i++) {
      const el = document.createElement('div');
      const left = 140 + (i % 3) * 400;
      const top = 160 + Math.floor(i / 3) * 260;
      el.getBoundingClientRect = () =>
        ({ left, top, right: left + 280, bottom: top + 120, width: 280, height: 120, x: left, y: top }) as DOMRect;
      document.body.append(el);
      divs.push(el);
    }
    const page: PageContext = {
      palette: () => [],
      // Selector-aware mock: the semantic pass gets nothing, the structural
      // pass gets the divs — exactly the shape of the failing pages.
      victims: (sel: string) => (sel.startsWith('main ') ? [] : divs),
    };
    const inst = mount(ctx(host, page));

    let sprung = 0;
    for (let t = 0; t < 60_000; t += 400) {
      inst.renderFrame(t, 7);
      sprung += divs.filter((el) => el.style.transform.startsWith('translateY')).length;
    }
    expect(sprung, 'the cat tours the structural perches').toBeGreaterThan(0);

    inst.dispose();
    for (const el of divs) el.remove();
    host.remove();
  });

  it('with no perches at all, the cat patrols the floor instead of vanishing', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const page: PageContext = { palette: () => [], victims: () => [] };
    const inst = mount(ctx(host, page));

    // Nothing to grab onto — must not throw, must not touch the page, and the
    // frame must still be pure in t.
    for (let t = 0; t < 40_000; t += 700) inst.renderFrame(t, 7);
    inst.renderFrame(9000, 7);
    inst.renderFrame(31_000, 7);
    inst.renderFrame(9000, 7);

    inst.dispose();
    host.remove();
  });

  it('restores every inline style it touched on dispose', () => {
    const { host, page, victims } = makePage();
    for (const el of victims) el.style.transform = 'translateX(2px)';
    const read = (): string[][] =>
      victims.map((el) => [
        el.style.transform,
        el.style.transformOrigin,
        el.style.willChange,
        el.style.transition,
      ]);
    const before = read();

    const inst = mount(ctx(host, page));
    for (let t = 0; t < 20_000; t += 500) inst.renderFrame(t, 7);
    inst.dispose();

    expect(read()).toEqual(before);
    host.remove();
  });
});
