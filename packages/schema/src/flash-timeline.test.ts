import { describe, expect, it } from 'vitest';
import { lumaKeyTimes, timelineFlashReport } from './flash-timeline';
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
});
