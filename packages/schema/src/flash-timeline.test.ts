import { describe, expect, it } from 'vitest';
import { timelineFlashReport } from './flash-timeline';
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
});
