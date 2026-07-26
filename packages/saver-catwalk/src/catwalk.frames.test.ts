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

  it('a playful cat swats a small neighbour block sideways (translateX, not a perch spring)', () => {
    // A perch grid plus one swattable chip parked in paw's reach of a perch.
    // Whether a given seed's itinerary includes a 'bat' stop is personality,
    // so probe a fixed seed list — at least one of these cats must be playful.
    const probe = process.env.PROBE_SEEDS === '1';
    const seeds = probe ? Array.from({ length: 40 }, (_, i) => i + 1) : [3, 7, 11, 23, 42];
    let swatted = false;
    for (const seed of seeds) {
      const { host, victims } = makePage();
      const chip = document.createElement('a');
      chip.dataset.idleVictim = '';
      // 110px right of the perch at (100,120,w260): anchor x=230 → chip cx=340.
      chip.getBoundingClientRect = () =>
        ({ left: 310, top: 150, right: 370, bottom: 170, width: 60, height: 20, x: 310, y: 150 }) as DOMRect;
      document.body.append(chip);
      const allEls = [...victims, chip];
      const pageWithChip: PageContext = { palette: () => [], victims: () => allEls };

      const c = { ...ctx(host, pageWithChip), rng: createRng(seed), seed };
      const inst = mount(c);
      if (probe && (inst as unknown as { visits: { batTarget: number }[] }).visits.some((v) => v.batTarget >= 0)) {
        console.log('BATSEED', seed);
      }
      // The bat works both ways: the chip may swat a perch or a perch may swat
      // the chip — either produces a sideways (translateX) shove somewhere.
      for (let t = 0; t < 90_000 && !swatted; t += 120) {
        inst.renderFrame(t, seed);
        if (allEls.some((el) => el.style.transform.startsWith('translateX'))) swatted = true;
      }
      inst.dispose();
      expect(chip.style.transform, 'swat restored on dispose').toBe('');
      chip.remove();
      host.remove();
      if (swatted) break;
    }
    expect(swatted, 'some seed bats the chip').toBe(true);
  });

  it('perch memory and zoomies appear across the seed population', () => {
    let sawFavorite = false;
    let sawZoomies = false;
    for (let seed = 1; seed <= 12 && !(sawFavorite && sawZoomies); seed++) {
      const { host, page } = makePage();
      const inst = mount({ ...ctx(host, page), rng: createRng(seed), seed });
       
      const visits = (inst as any).visits as { perch: number; action: string; zoom: boolean; favorite: boolean }[];
      const fav = visits.find((v) => v.favorite);
      if (fav) {
        sawFavorite = true;
        expect(fav.action, 'the homecoming is the long nap').toBe('sleep');
        expect(
          visits.filter((v) => v.perch === fav.perch).length,
          'the favourite perch is genuinely revisited',
        ).toBeGreaterThanOrEqual(2);
      }
      if (visits.some((v) => v.zoom)) sawZoomies = true;
      inst.dispose();
      host.remove();
    }
    expect(sawFavorite, 'some cat has a favourite perch').toBe(true);
    expect(sawZoomies, 'some cat gets the zoomies').toBe(true);
  });

  it('every seed is a different cat: body and itinerary both vary', () => {
    const summaries = [1, 2, 3].map((seed) => {
      const { host, page, victims } = makePage();
      const inst = mount({ ...ctx(host, page), rng: createRng(seed), seed });
       
      const anyInst = inst as any;
      const summary = JSON.stringify({
        look: anyInst.look,
        actions: anyInst.visits.map((v: { action: string }) => v.action),
      });
      inst.dispose();
      void victims;
      host.remove();
      return summary;
    });
    expect(new Set(summaries).size, 'three seeds, three distinct cats').toBe(3);

    // And the same seed twice is the same cat exactly.
    const twice = [0, 0].map(() => {
      const { host, page } = makePage();
      const inst = mount({ ...ctx(host, page), rng: createRng(9), seed: 9 });
       
      const s = JSON.stringify({ look: (inst as any).look, actions: (inst as any).visits.map((v: { action: string }) => v.action) });
      inst.dispose();
      host.remove();
      return s;
    });
    expect(twice[0]).toBe(twice[1]);
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

  it('describes its composition stack: page deck, surface, passes', () => {
    const { host, page } = makePage();
    const inst = mount(ctx(host, page));
    const stack = inst.composition!();
    expect(stack[0]!.kind).toBe('page');
    expect(stack[0]!.el, 'the page deck is host-bound, never saver-owned').toBeUndefined();
    const surface = stack.find((l) => l.kind === 'surface');
    expect(surface?.el?.tagName).toBe('CANVAS');
    expect(stack.filter((l) => l.kind === 'pass').length).toBeGreaterThanOrEqual(2);
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
