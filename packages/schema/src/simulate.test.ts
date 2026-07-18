import { describe, it, expect } from 'vitest';
import { createRng } from '@idle-screens/core';
import { alphaAt, buildEntities, linkPairs, positionAt, spriteIndexAt, spriteVariants } from './simulate';
import type { LayerSpec } from './types';

const W = 800;
const H = 600;

const driftLayer: LayerSpec = {
  count: 20,
  sprite: { kind: 'emoji', glyphs: ['🐟', '🐠', '🐡'] },
  size: [30, 60],
  motion: { type: 'drift', speed: [40, 120], bidirectional: true, bob: 6 },
  flip: true,
};

describe('buildEntities (seeded, deterministic)', () => {
  it('same seed -> identical entities', () => {
    const a = buildEntities(driftLayer, createRng(7), W, H);
    const b = buildEntities(driftLayer, createRng(7), W, H);
    expect(a).toEqual(b);
    expect(a).toHaveLength(20);
  });

  it('different seed -> different placement', () => {
    const a = buildEntities(driftLayer, createRng(1), W, H);
    const b = buildEntities(driftLayer, createRng(2), W, H);
    expect(a).not.toEqual(b);
  });

  it('region constrains spawn; alpha resolves per entity; defaults leave both untouched', () => {
    const regioned = buildEntities(
      { ...driftLayer, region: { x: [0.25, 0.5], y: [0, 0.4] }, alpha: [0.3, 0.8] },
      createRng(11), W, H,
    );
    for (const e of regioned) {
      expect(e.x0).toBeGreaterThanOrEqual(0.25 * W);
      expect(e.x0).toBeLessThanOrEqual(0.5 * W);
      expect(e.y0).toBeLessThanOrEqual(0.4 * H);
      expect(e.alpha).toBeGreaterThanOrEqual(0.3);
      expect(e.alpha).toBeLessThanOrEqual(0.8);
    }
    const plain = buildEntities(driftLayer, createRng(11), W, H);
    expect(plain.every((e) => e.alpha === 1 && e.pulseAmp === 0)).toBe(true);
  });

  it('optional features consume no extra rng draws when absent (stream compat)', () => {
    // A layer written before alpha/region/pulse existed must build the exact same
    // entities after the upgrade — the seeded stream may not shift.
    const a = buildEntities(driftLayer, createRng(21), W, H);
    const b = buildEntities({ ...driftLayer, alpha: undefined, region: undefined, pulse: undefined }, createRng(21), W, H);
    expect(a).toEqual(b);
    expect(a.map((e) => [e.x0, e.y0])).toEqual(b.map((e) => [e.x0, e.y0]));
  });

  it('alphaAt is pure, bounded 0..1, and identity without pulse', () => {
    const [pulsed] = buildEntities(
      { ...driftLayer, alpha: [0.7, 0.7], pulse: { amp: 0.5, period: 2000 } },
      createRng(13), W, H,
    );
    for (let t = 0; t < 20_000; t += 97) {
      const v = alphaAt(pulsed!, t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(alphaAt(pulsed!, 500)).toBe(alphaAt(pulsed!, 500));
    const [still] = buildEntities({ ...driftLayer, alpha: [0.4, 0.4] }, createRng(13), W, H);
    expect(alphaAt(still!, 12345)).toBe(0.4);
  });

  it('bidirectional produces both headings; spriteIndex spans the glyph set', () => {
    const es = buildEntities(driftLayer, createRng(3), W, H);
    expect(es.some((e) => e.headingLeft)).toBe(true);
    expect(es.some((e) => !e.headingLeft)).toBe(true);
    expect(new Set(es.map((e) => e.spriteIndex)).size).toBeGreaterThan(1);
    expect(spriteVariants(driftLayer.sprite)).toBe(3);
  });
});

describe('colorIndex determinism', () => {
  const colorLayer: LayerSpec = {
    count: 30,
    sprite: { kind: 'circle', radius: [2, 6], color: '#fff', colors: ['#ff0000', '#00ff00', '#0000ff'] },
    motion: { type: 'static' },
  };

  it('same seed -> identical colorIndex assignments', () => {
    const a = buildEntities(colorLayer, createRng(42), W, H);
    const b = buildEntities(colorLayer, createRng(42), W, H);
    expect(a.map((e) => e.colorIndex)).toEqual(b.map((e) => e.colorIndex));
  });

  it('colorIndex values are within bounds of colors array', () => {
    const es = buildEntities(colorLayer, createRng(42), W, H);
    for (const e of es) {
      expect(e.colorIndex).toBeGreaterThanOrEqual(0);
      expect(e.colorIndex).toBeLessThan(3);
    }
  });

  it('colorIndex is -1 when no colors[] array', () => {
    const noColors: LayerSpec = { count: 5, sprite: { kind: 'circle', radius: [2, 6], color: '#fff' }, motion: { type: 'static' } };
    const es = buildEntities(noColors, createRng(42), W, H);
    expect(es.every((e) => e.colorIndex === -1)).toBe(true);
  });
});

describe('spriteIndexAt', () => {
  it('returns fixed spriteIndex when no cycling', () => {
    const singleLayer: LayerSpec = {
      count: 5,
      sprite: { kind: 'emoji', glyphs: ['A'] },
      size: [20, 20],
      motion: { type: 'static' },
    };
    const [e] = buildEntities(singleLayer, createRng(10), W, H);
    expect(spriteIndexAt(e!, 0, 1)).toBe(0);
    expect(spriteIndexAt(e!, 999999, 1)).toBe(0);
  });

  it('without cycle, returns the seeded spriteIndex regardless of time', () => {
    const [e] = buildEntities(driftLayer, createRng(10), W, H);
    const idx = spriteIndexAt(e!, 0, 3);
    expect(spriteIndexAt(e!, 5000, 3)).toBe(idx);
    expect(spriteIndexAt(e!, 99999, 3)).toBe(idx);
  });

  it('cycles through all variants when cycle period > 0', () => {
    const cycled: LayerSpec = {
      count: 1,
      sprite: { kind: 'emoji', glyphs: ['A', 'B', 'C'], cycle: { period: 3000 } },
      size: [20, 20],
      motion: { type: 'static' },
    };
    const [e] = buildEntities(cycled, createRng(10), W, H);
    const indices = new Set<number>();
    for (let t = 0; t < 9000; t += 500) {
      indices.add(spriteIndexAt(e!, t, 3));
    }
    expect(indices.size).toBe(3);
  });
});

describe('linkPairs', () => {
  it('finds neighbors within maxDist', () => {
    const positions = [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 500, y: 500 }];
    const pairs = linkPairs(positions, 2, 50, false, W, H);
    expect(pairs).toEqual([[0, 1]]);
  });

  it('toroidal wrap finds cross-seam neighbors', () => {
    const positions = [{ x: 5, y: 300 }, { x: 795, y: 300 }];
    const pairs = linkPairs(positions, 1, 50, true, W, H);
    expect(pairs).toHaveLength(1);
  });

  it('no toroidal wrap skips cross-seam pair', () => {
    const positions = [{ x: 5, y: 300 }, { x: 795, y: 300 }];
    const pairs = linkPairs(positions, 1, 50, false, W, H);
    expect(pairs).toHaveLength(0);
  });

  it('deduplicates edges (i-j and j-i)', () => {
    const positions = [{ x: 10, y: 10 }, { x: 15, y: 10 }];
    const pairs = linkPairs(positions, 2, 50, false, W, H);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]![0]).toBeLessThan(pairs[0]![1]);
  });
});

describe('positionAt (pure, analytic, wrapping)', () => {
  const e = buildEntities(driftLayer, createRng(5), W, H)[0]!;

  it('is a pure function of time', () => {
    expect(positionAt(e, 1500, W, H)).toEqual(positionAt(e, 1500, W, H));
  });

  it('drift stays within the wrapped bounds [-size, W+size] for all t', () => {
    for (let t = 0; t < 60_000; t += 137) {
      const p = positionAt(e, t, W, H);
      expect(p.x).toBeGreaterThanOrEqual(-e.size - 1e-6);
      expect(p.x).toBeLessThanOrEqual(W + e.size + 1e-6);
    }
  });

  it('drift x is periodic (wraps cleanly)', () => {
    const period = ((W + 2 * e.size) / Math.abs(e.vx)) * 1000; // ms to traverse one wrap span
    expect(positionAt(e, 1000, W, H).x).toBeCloseTo(positionAt(e, 1000 + period, W, H).x, 4);
  });

  it('rise moves up and wraps to the bottom', () => {
    const bub = buildEntities(
      { count: 5, sprite: { kind: 'circle', radius: [2, 6], color: '#fff' }, motion: { type: 'rise', speed: [20, 40], sway: 8 } },
      createRng(9),
      W,
      H,
    )[0]!;
    const y0 = positionAt(bub, 0, W, H).y;
    const y1 = positionAt(bub, 500, W, H).y;
    expect(y1).toBeLessThan(y0); // rose
    for (let t = 0; t < 40_000; t += 211) {
      const p = positionAt(bub, t, W, H);
      expect(p.y).toBeGreaterThanOrEqual(-bub.size - 1e-6);
      expect(p.y).toBeLessThanOrEqual(H + bub.size + 1e-6);
    }
  });

  it('bounce reflects within the inset box', () => {
    const ball = buildEntities(
      { count: 3, sprite: { kind: 'circle', radius: [10, 10], color: '#fff' }, motion: { type: 'bounce', speed: [200, 200] } },
      createRng(4),
      W,
      H,
    )[0]!;
    for (let t = 0; t < 30_000; t += 173) {
      const p = positionAt(ball, t, W, H);
      expect(p.x).toBeGreaterThanOrEqual(ball.size / 2 - 1e-6);
      expect(p.x).toBeLessThanOrEqual(W - ball.size / 2 + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(ball.size / 2 - 1e-6);
      expect(p.y).toBeLessThanOrEqual(H - ball.size / 2 + 1e-6);
    }
  });
});
