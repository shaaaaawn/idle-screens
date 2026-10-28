import { describe, expect, it } from 'vitest';
import { lumaKeyTimes, pathCells, timelineFlashReport } from './flash-timeline';
import { sweptBox, transformPoint, type TransformRange } from './paint';
import type { SaverSpec } from './types';
import { validateSpec } from './validate';

const square = 'M -1 -1 L 1 -1 L 1 1 L -1 1 Z';
const fullFrame = (key: string, color: string, opacity = 1): Record<string, unknown> => ({
  key, count: 1, position: { x: 0.5, y: 0.5 }, opacity, motion: { type: 'static' },
  sprite: { kind: 'polygon', radius: [1.5, 1.5], color, path: square },
});
const step = (t: number, path: string, value: unknown): Record<string, unknown> => ({ t, path, value, dur: 0, ease: 'step' });
const scene = (bg: string, layers: unknown[], keys: unknown[], duration = 4000): SaverSpec =>
  ({ schemaVersion: 1, id: 'f', label: 'F', background: { type: 'solid', color: bg }, layers, timeline: { loop: true, duration, keys } }) as unknown as SaverSpec;

describe('timelineFlashReport', () => {
  it('treats draw-span keys as luminance-bearing, so a draw-only timeline is sampled', () => {
    const bar = (key: string, color: string): Record<string, unknown> => ({
      key, count: 1, position: { x: 0.5, y: 0.5 }, motion: { type: 'static' },
      sprite: { kind: 'stroke', length: [3, 3], points: [[-1, 0], [1, 0]], curve: 'linear', width: 2, color, draw: { end: 1 } },
    });
    const keys = [];
    for (let i = 0; i < 15; i++) {
      keys.push(step(i * 200, 'w.sprite.draw.end', i % 2 ? 0 : 1));
      keys.push(step(i * 200 + 100, 'k.sprite.draw.end', i % 2 ? 1 : 0));
    }
    const spec = scene('#000000', [bar('k', '#000000'), bar('w', '#ffffff')], keys);
    expect(lumaKeyTimes(spec).times.length).toBeGreaterThan(0); // sampled, not waved through unexamined
  });


  it('catches paths that are each legal but combine into a full-frame strobe', () => {
    // The top layer's opacity picks between its own colour and the bottom
    // layer's; all three keyed at the 200 ms floor, 67 ms apart.
    const keys = [];
    for (let i = 0; i < 15; i++) {
      keys.push(step(i * 200, 'top.opacity', i % 2 ? 0 : 1));
      keys.push(step(i * 200 + 67, 'top.sprite.color', i % 2 ? '#ffffff' : '#000000'));
      keys.push(step(i * 200 + 133, 'bottom.sprite.color', i % 2 ? '#000000' : '#ffffff'));
    }
    const spec = scene('#000000', [fullFrame('bottom', '#000000'), fullFrame('top', '#ffffff')], keys);
    expect(validateSpec(structuredClone(spec)).valid).toBe(true); // every path obeys the per-path floor
    const r = timelineFlashReport(spec);
    expect(r.fails).toBe(true);
    expect(r.flashesPerSecond).toBeGreaterThan(3);
    expect(r.flashingArea).toBeGreaterThanOrEqual(0.25);
  });

  it('still catches a bright strobe (greys that sit above the analyzer\'s dark ceiling in gamma space)', () => {
    const keys = [];
    for (let i = 0; i < 15; i++) {
      keys.push(step(i * 200, 'top.opacity', i % 2 ? 0 : 1));
      keys.push(step(i * 200 + 67, 'top.sprite.color', i % 2 ? '#ffffff' : '#d0d0d0'));
      keys.push(step(i * 200 + 133, 'bottom.sprite.color', i % 2 ? '#d0d0d0' : '#ffffff'));
    }
    expect(timelineFlashReport(scene('#d0d0d0', [fullFrame('bottom', '#d0d0d0'), fullFrame('top', '#ffffff')], keys)).fails).toBe(true);
  });

  it('counts whole-object `sprite` keys as paint', () => {
    const sprite = (color: string) => ({ kind: 'polygon', radius: [1.5, 1.5], color, path: square });
    const keys = [];
    for (let i = 0; i < 15; i++) {
      keys.push(step(i * 200, 'top.opacity', i % 2 ? 0 : 1));
      keys.push(step(i * 200 + 67, 'top.sprite', sprite(i % 2 ? '#ffffff' : '#000000')));
      keys.push(step(i * 200 + 133, 'bottom.sprite', sprite(i % 2 ? '#000000' : '#ffffff')));
    }
    expect(timelineFlashReport(scene('#000000', [fullFrame('bottom', '#000000'), fullFrame('top', '#ffffff')], keys)).fails).toBe(true);
  });

  it('does not let a harmless dense section hide a later strobe', () => {
    const keys = [];
    // 0-1 s: eight paths with keys 25 ms apart (each path is 200 ms apart) that change nothing visible.
    for (let p = 0; p < 8; p++) for (let i = 0; i < 3; i++) keys.push(step(p * 25 + i * 200, `d${p}.opacity`, 0));
    for (let i = 0; i < 15; i++) {
      keys.push(step(3000 + i * 200, 'top.opacity', i % 2 ? 0 : 1));
      keys.push(step(3000 + i * 200 + 67, 'top.sprite.color', i % 2 ? '#ffffff' : '#000000'));
      keys.push(step(3000 + i * 200 + 133, 'bottom.sprite.color', i % 2 ? '#000000' : '#ffffff'));
    }
    const decoys = Array.from({ length: 8 }, (_, p) => fullFrame(`d${p}`, '#000000', 0));
    expect(timelineFlashReport(scene('#000000', [...decoys, fullFrame('bottom', '#000000'), fullFrame('top', '#ffffff')], keys, 8000)).fails).toBe(true);
  });

  it('passes X589 as submitted: two white layers 100 ms apart peak at 3 flashes a second', () => {
    const keys = [];
    for (let i = 0; i < 10; i++) {
      keys.push(step(i * 200, 'a.opacity', i % 2 ? 0 : 1));
      keys.push(step(i * 200 + 100, 'b.opacity', i % 2 ? 0 : 1));
    }
    const r = timelineFlashReport(scene('#000000', [fullFrame('a', '#ffffff', 0), fullFrame('b', '#ffffff', 0)], keys));
    expect(r.fails).toBe(false);
    expect(r.flashesPerSecond).toBe(3);
  });

  it('passes a light switch and costs nothing where no second is dense with paint keys', () => {
    const closet = scene('#e0d8c0', [fullFrame('dark', '#000000', 0.86)], [
      { t: 3000, path: 'dark.opacity', value: 0, dur: 280 },
      { t: 9000, path: 'dark.opacity', value: 0.86, dur: 280 },
      { t: 15000, path: 'dark.opacity', value: 0, dur: 280 },
      { t: 21000, path: 'dark.opacity', value: 0.86, dur: 280 },
    ], 24000);
    expect(timelineFlashReport(closet)).toEqual({ fails: false, flashesPerSecond: 0, flashingArea: 0, at: null });
    // Fast keys on a non-paint path are not a flash candidate at all.
    const moves = [];
    for (let i = 0; i < 15; i++) moves.push(step(i * 200, 'a.position.x', i % 2 ? 0.4 : 0.6), step(i * 200 + 100, 'b.position.x', i % 2 ? 0.4 : 0.6));
    expect(timelineFlashReport(scene('#000000', [fullFrame('a', '#ffffff'), fullFrame('b', '#ffffff')], moves)).at).toBeNull();
  });

  it('catches a burst that straddles a chunk edge after many harmless boundaries', () => {
    // 17 harmless boundaries 100 ms apart push the burst's samples across the
    // 64-sample chunk edge; the chunks must share a full second of time.
    const keys: Record<string, unknown>[] = [];
    for (let i = 0; i < 17; i++) keys.push(step(i * 100, 'bottom.sprite.color', i % 2 ? '#000000' : '#000001'));
    for (let i = 0; i < 8; i++) keys.push(step(1700 + i * 100, 'top.opacity', i % 2 ? 0 : 1));
    const spec = scene('#000000', [fullFrame('bottom', '#000000'), fullFrame('top', '#ffffff')], keys, 3000);
    const r = timelineFlashReport(spec);
    expect(r.fails).toBe(true);
  });

  describe('per-cell shortcut (F125 regression)', () => {
    // 28 small static dots, each opacity keyed 9 times between 1 and 0.2 in a
    // staggered wave: dense across the frame (56 boundaries a second, past the
    // sample budget), sparse in every grid cell.
    const wave = (radius: number, motion: Record<string, unknown> = { type: 'static' }, low = 0.2): SaverSpec => {
      const layers = Array.from({ length: 28 }, (_, i) => ({
        key: `dot${i}`, count: 1, motion, position: { x: (i + 0.5) / 28, y: 0.5 + 0.25 * Math.sin(i / 2) },
        sprite: { kind: 'circle', radius: [radius, radius], color: '#ffffff' },
      }));
      const keys = [];
      for (let i = 0; i < 28; i++) for (let k = 0; k < 9; k++) keys.push({ t: k * 1000 + i * 37, path: `dot${i}.opacity`, value: k % 2 ? 1 : low, dur: 400 });
      return scene('#000000', layers.map((l) => ({ ...l, opacity: 1 })), keys, 10000);
    };

    it('passes a staggered wave of small dots without resolving a frame', () => {
      const spec = wave(0.02);
      expect(validateSpec(structuredClone(spec)).valid).toBe(true);
      expect(timelineFlashReport(spec)).toEqual({ fails: false, flashesPerSecond: 0, flashingArea: 0, at: null });
    });

    it('still reports the three-path full-frame strobe at 5 flashes a second', () => {
      const keys = [];
      for (let i = 0; i < 15; i++) {
        keys.push(step(i * 200, 'top.opacity', i % 2 ? 0 : 1));
        keys.push(step(i * 200 + 67, 'top.sprite.color', i % 2 ? '#ffffff' : '#000000'));
        keys.push(step(i * 200 + 133, 'bottom.sprite.color', i % 2 ? '#000000' : '#ffffff'));
      }
      const r = timelineFlashReport(scene('#000000', [fullFrame('bottom', '#000000'), fullFrame('top', '#ffffff')], keys));
      expect(r).toMatchObject({ fails: true, flashesPerSecond: 5 });
      expect(r.incomplete).toBeUndefined();
    });

    it('counts cells, not pixels: 40 small dots strobing in 40 cells still fail', () => {
      // The three-path strobe on two 8×5 grids of dots: about 4% of the
      // pixels, but each dot sits in its own cells, and the analyzer fails on
      // the share of cells that flash.
      const grid = (key: string, color: string): Record<string, unknown> => ({
        key, count: 40, layout: { type: 'grid', columns: 8 }, motion: { type: 'static' }, opacity: 1,
        sprite: { kind: 'circle', radius: [0.04, 0.04], color },
      });
      const keys = [];
      for (let i = 0; i < 15; i++) {
        keys.push(step(i * 200, 'top.opacity', i % 2 ? 0 : 1));
        keys.push(step(i * 200 + 67, 'top.sprite.color', i % 2 ? '#000000' : '#ffffff'));
        keys.push(step(i * 200 + 133, 'bottom.sprite.color', i % 2 ? '#ffffff' : '#000000'));
      }
      const r = timelineFlashReport(scene('#ffffff', [grid('bottom', '#ffffff'), grid('top', '#000000')], keys));
      expect(r.fails).toBe(true);
      expect(r.incomplete).toBeUndefined();
    });

    it('attributes a group opacity key to its member layers', () => {
      const keys = [];
      for (let i = 0; i < 15; i++) {
        keys.push(step(i * 200, 'groups.g.opacity', i % 2 ? 0 : 1));
        keys.push(step(i * 200 + 67, 'top.sprite.color', i % 2 ? '#ffffff' : '#000000'));
        keys.push(step(i * 200 + 133, 'bottom.sprite.color', i % 2 ? '#000000' : '#ffffff'));
      }
      const spec = { ...scene('#000000', [fullFrame('bottom', '#000000'), { ...fullFrame('top', '#ffffff'), group: 'g' }], keys), groups: { g: { opacity: 1 } } } as SaverSpec;
      expect(timelineFlashReport(spec)).toMatchObject({ fails: true, flashesPerSecond: 5 });
    });

    it('treats a moving layer as reaching every cell', () => {
      // The same wave on drifting dots cannot be pinned to cells, so it is
      // sampled, runs past the budget and fails closed.
      const r = timelineFlashReport(wave(0.02, { type: 'drift', speed: [0.02, 0.02] }));
      expect(r).toMatchObject({ fails: true, incomplete: true });
    });

    it('treats a trailing layer as reaching every cell (trail echoes ignore the layer scale)', () => {
      const keys = [];
      for (let i = 0; i < 40; i++) keys.push(step(i * 100, 'dot.sprite.color', i % 2 ? '#000000' : '#ffffff'));
      const dot = { key: 'dot', count: 1, motion: { type: 'static' }, position: { x: 0.5, y: 0.5 }, opacity: 1, transform: { scale: 0.1 }, trail: { length: 500, fade: 0 }, sprite: { kind: 'circle', radius: [0.6, 0.6], color: '#ffffff' } };
      const r = timelineFlashReport(scene('#000000', [dot], keys));
      expect(r.fails).toBe(true);
    });

    it('fails closed, saying how dense, when a large-area dense window is past the budget', () => {
      // Discs that cover most of the frame, each barely changing: nothing
      // flashes, but there is too much to resolve.
      const r = timelineFlashReport(wave(0.6, { type: 'static' }, 0.97));
      expect(r).toMatchObject({ fails: true, incomplete: true });
      expect(r.boundariesPerSecond).toBeGreaterThanOrEqual(50);
    });
  });
  describe('keyed transforms reach where they carry the drawing (X681)', () => {
    // The flash grid is 16×9 over 1920×1080: 120 px cells, cell = row × 16 + col.
    const cell = (row: number, col: number): number => row * 16 + col;
    const dot = (key: string, x: number, y: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
      key, count: 1, position: { x, y }, opacity: 1, motion: { type: 'static' },
      sprite: { kind: 'circle', radius: [0.02, 0.02], color: '#ffffff' }, ...extra,
    });
    const cellsOf = (spec: SaverSpec, path: string): number[] | null | undefined => pathCells(spec)?.get(path);

    // X681 as reported: a Truchet grid of 28 tiles, each flushing red as it
    // turns about its own anchor, in a diagonal wave staggered 130 ms a step.
    const truchet = (rotate: boolean): SaverSpec => {
      const layers = [];
      const keys = [];
      for (let r = 0; r < 4; r++) for (let c = 0; c < 7; c++) {
        const key = `t${r}_${c}`;
        layers.push({
          key, count: 1, position: { x: 0.1 + c * 0.13, y: 0.2 + r * 0.2 }, motion: { type: 'static' }, alpha: [1, 1],
          transform: { origin: 'anchor', rotate: 0 },
          sprite: { kind: 'polygon', radius: [0.06, 0.06], color: '#000', parts: [{ path: 'M -1 0 A 1 1 0 0 1 0 -1 M 0 1 A 1 1 0 0 1 1 0', fill: false, stroke: { color: '#ece8df', width: 0.1 } }] },
        });
        const t = 1400 + (r + c) * 130;
        if (rotate) keys.push({ t, path: `${key}.transform.rotate`, value: 90, ease: 'spring', dur: 1100 });
        keys.push({ t, path: `${key}.sprite.parts.0.stroke.color`, value: '#ed3f21', dur: 350 });
        keys.push({ t: t + 700, path: `${key}.sprite.parts.0.stroke.color`, value: '#ece8df', dur: 1500 });
      }
      return { schemaVersion: 1, id: 'x681', label: 'X681', background: { type: 'solid', color: '#141414' }, layers, timeline: { duration: 12000, keys } } as unknown as SaverSpec;
    };

    it('passes a colour wave over tiles that turn about their own anchors', () => {
      const spec = truchet(true);
      expect(validateSpec(structuredClone(spec)).valid).toBe(true);
      expect(timelineFlashReport(spec)).toEqual({ fails: false, flashesPerSecond: 0, flashingArea: 0, at: null });
    });

    it('keeps a tile turning about its anchor in the cells it already paints', () => {
      const turning = cellsOf(truchet(true), 'layers.9.sprite.parts.0.stroke.color');
      expect(turning).toEqual(cellsOf(truchet(false), 'layers.9.sprite.parts.0.stroke.color'));
      expect(turning!.length).toBeLessThanOrEqual(9);
    });

    it('sweeps a tile turned about the viewport centre along its arc, and no further', () => {
      // At (384, 540), half a turn about (960, 540) swings it over the top to (1536, 540).
      const spec = scene('#000000', [dot('d', 0.2, 0.5, { transform: { rotate: 0 } })], [
        { t: 0, path: 'd.transform.rotate', value: 180, dur: 2000 },
        { t: 0, path: 'd.opacity', value: 0.5, dur: 300 },
      ]);
      const cells = cellsOf(spec, 'layers.0.opacity')!;
      expect(cells).toEqual(expect.arrayContaining([cell(4, 3), cell(0, 8), cell(4, 12)]));
      expect(cells).not.toContain(cell(8, 8)); // the arc never dips below the centre
    });

    it('reaches every cell along a transform x glide, both ends included', () => {
      // From (192, 540) to (192 + 0.8 × 1080, 540) = (1056, 540): columns 1 to 8 of row 4.
      const spec = scene('#000000', [dot('d', 0.1, 0.5, { transform: { x: 0 } })], [
        { t: 0, path: 'd.transform.x', value: 0.8, dur: 2000, ease: 'linear' },
        { t: 0, path: 'd.opacity', value: 0.5, dur: 300 },
      ]);
      const cells = cellsOf(spec, 'layers.0.opacity')!;
      for (let c = 1; c <= 8; c++) expect(cells).toContain(cell(4, c));
      expect(cells.every((i) => i % 16 <= 9 && Math.floor(i / 16) >= 3 && Math.floor(i / 16) <= 5)).toBe(true);
    });

    it('widens a group\'s members by the group\'s keyed transform', () => {
      const keys = [{ t: 0, path: 'd.opacity', value: 0.5, dur: 300 }];
      const base = { ...scene('#000000', [dot('d', 0.4, 0.5, { group: 'g' })], keys), groups: { g: { transform: { scale: 1 } } } } as SaverSpec;
      const zoomed = { ...base, timeline: { ...base.timeline!, keys: [...keys, { t: 0, path: 'groups.g.transform.scale', value: 3, dur: 2000 }] } } as SaverSpec;
      const before = cellsOf(base, 'layers.0.opacity')!;
      const after = cellsOf(zoomed, 'layers.0.opacity')!;
      // (768, 540) scaled 3× about the centre lands at (384, 540).
      expect(after).toEqual(expect.arrayContaining([...before, cell(4, 3)]));
      expect(after.length).toBeGreaterThan(before.length);
    });

    it('keeps the whole grid for a transform key that moves the pivot', () => {
      // A whole-object key without `origin` lands on the viewport-centre default.
      const keys = [{ t: 0, path: 'd.opacity', value: 0.5, dur: 300 }];
      const spec = scene('#000000', [dot('d', 0.2, 0.2, { transform: { origin: 'anchor', rotate: 0 } })], [...keys, { t: 0, path: 'd.transform', value: { rotate: 30 }, dur: 500 }]);
      expect(validateSpec(structuredClone(spec)).valid).toBe(true);
      expect(cellsOf(spec, 'layers.0.opacity')).toBeNull();
      const kept = scene('#000000', [dot('d', 0.2, 0.2, { transform: { origin: 'anchor', rotate: 0 } })], [...keys, { t: 0, path: 'd.transform', value: { origin: 'anchor', rotate: 30 }, dur: 500 }]);
      expect(cellsOf(kept, 'layers.0.opacity')).toEqual(cellsOf(scene('#000000', [dot('d', 0.2, 0.2)], keys), 'layers.0.opacity'));
    });

    it('sizes a static scaleY stretch by its largest axis (X698)', () => {
      const keys = [{ t: 0, path: 'd.opacity', value: 0.5, dur: 300 }, { t: 0, path: 'd.transform.rotate', value: 90, dur: 500 }];
      const mk = (tf: Record<string, unknown>): SaverSpec => scene('#000000', [dot('d', 0.5, 0.5, { transform: { origin: 'anchor', rotate: 0, ...tf } })], keys);
      const flat = cellsOf(mk({}), 'layers.0.opacity')!;
      const tall = cellsOf(mk({ scaleY: 3 }), 'layers.0.opacity')!;
      expect(tall.length).toBeGreaterThan(flat.length);
      expect(tall).toEqual(expect.arrayContaining(flat));
    });

    it('bounds every point a transform reaches while its fields range (never short)', () => {
      let seed = 7;
      const rnd = (lo: number, hi: number): number => { seed = (seed * 16807) % 2147483647; return lo + ((seed - 1) / 2147483646) * (hi - lo); };
      const pair = (lo: number, hi: number): [number, number] => { const a = rnd(lo, hi); const b = rnd(lo, hi); return [Math.min(a, b), Math.max(a, b)]; };
      for (let trial = 0; trial < 200; trial++) {
        const r: TransformRange = { x: pair(-0.5, 0.5), y: pair(-0.5, 0.5), scale: pair(-2, 3), scaleX: pair(-2, 3), scaleY: pair(-2, 3), rotate: pair(-400, 400) };
        const p = { x: rnd(-200, 2100), y: rnd(-200, 1300) };
        const o = { x: rnd(0, 1920), y: rnd(0, 1080) };
        const box = sweptBox(r, p, o, 1080);
        for (let i = 0; i < 50; i++) {
          const q = transformPoint({ x: rnd(...r.x), y: rnd(...r.y), scale: rnd(...r.scale), scaleX: rnd(...r.scaleX), scaleY: rnd(...r.scaleY), rotate: rnd(...r.rotate) }, p, 1920, 1080, 1080, o);
          expect(q.x).toBeGreaterThanOrEqual(box.x0 - 1e-6);
          expect(q.x).toBeLessThanOrEqual(box.x1 + 1e-6);
          expect(q.y).toBeGreaterThanOrEqual(box.y0 - 1e-6);
          expect(q.y).toBeLessThanOrEqual(box.y1 + 1e-6);
        }
      }
    });

    it('still catches the three-path full-frame strobe on layers that turn', () => {
      const keys = [];
      for (let i = 0; i < 15; i++) {
        keys.push(step(i * 200, 'top.opacity', i % 2 ? 0 : 1));
        keys.push(step(i * 200 + 67, 'top.sprite.color', i % 2 ? '#ffffff' : '#000000'));
        keys.push(step(i * 200 + 133, 'bottom.sprite.color', i % 2 ? '#000000' : '#ffffff'));
      }
      keys.push({ t: 0, path: 'top.transform.rotate', value: 90, dur: 3000 }, { t: 0, path: 'bottom.transform.rotate', value: -90, dur: 3000 });
      const turning = (key: string, color: string): Record<string, unknown> => ({ ...fullFrame(key, color), transform: { origin: 'anchor', rotate: 0 } });
      const r = timelineFlashReport(scene('#000000', [turning('bottom', '#000000'), turning('top', '#ffffff')], keys));
      expect(r).toMatchObject({ fails: true, flashesPerSecond: 5 });
      expect(r.incomplete).toBeUndefined();
    });
  });
});

describe('timelineFlashReport: a jump that lands on another key of the same path', () => {
  // A step to dark and a glide back up keyed at the same `t`: two changes per
  // key time, so the 200 ms floor allows a 5-a-second sawtooth (found triaging X712).
  const sawtooth = (period: number, laps: number, dur = period): SaverSpec => {
    const keys = [];
    for (let t = 0; t < laps * period; t += period) {
      keys.push(step(t, 'top.opacity', 0));
      keys.push({ t, path: 'top.opacity', value: 1, dur, ease: 'linear' });
    }
    const spec = scene('#000000', [fullFrame('top', '#ffffff')], keys, laps * period + 1000);
    (spec.timeline as { loop?: boolean }).loop = false;
    return spec;
  };

  it('refuses a full-frame sawtooth at the 200 ms floor (5 a second)', () => {
    const spec = sawtooth(200, 20);
    expect(validateSpec(structuredClone(spec)).valid).toBe(true); // legal per path
    const r = timelineFlashReport(spec);
    expect(r.fails).toBe(true);
    expect(r.flashesPerSecond).toBeGreaterThan(3);
    expect(r.flashingArea).toBeGreaterThanOrEqual(0.25);
  });

  it('refuses the same sawtooth whether or not the glide ends on the next jump', () => {
    expect(timelineFlashReport(sawtooth(200, 20, 199)).fails).toBe(true);
    expect(timelineFlashReport(sawtooth(250, 16)).fails).toBe(true); // 4 a second
  });

  it('passes a sawtooth at 2.5 a second', () => {
    expect(timelineFlashReport(sawtooth(400, 10)).fails).toBe(false);
  });

  it('passes one jump-then-glide per lap (a loop seam reset)', () => {
    const keys = [step(0, 'top.opacity', 0), { t: 0, path: 'top.opacity', value: 1, dur: 35000, ease: 'linear' }];
    expect(timelineFlashReport(scene('#000000', [fullFrame('top', '#ffffff')], keys, 36000)).fails).toBe(false);
  });

  it('does not double-count a chain of glides that meet end to start', () => {
    const keys = [];
    for (let i = 0; i < 20; i++) keys.push({ t: i * 200, path: 'top.opacity', value: i % 2 ? 0.95 : 1, dur: 200, ease: 'linear' });
    expect(lumaKeyTimes(scene('#000000', [fullFrame('top', '#ffffff')], keys)).times.length).toBe(21 + 20);
    expect(timelineFlashReport(scene('#000000', [fullFrame('top', '#ffffff')], keys)).fails).toBe(false);
  });
});
