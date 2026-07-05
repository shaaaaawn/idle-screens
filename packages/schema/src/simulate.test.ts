import { describe, it, expect } from 'vitest';
import { createRng } from '@idle-screens/core';
import { buildEntities, positionAt, spriteVariants } from './simulate';
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

  it('bidirectional produces both headings; spriteIndex spans the glyph set', () => {
    const es = buildEntities(driftLayer, createRng(3), W, H);
    expect(es.some((e) => e.headingLeft)).toBe(true);
    expect(es.some((e) => !e.headingLeft)).toBe(true);
    expect(new Set(es.map((e) => e.spriteIndex)).size).toBeGreaterThan(1);
    expect(spriteVariants(driftLayer.sprite)).toBe(3);
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
