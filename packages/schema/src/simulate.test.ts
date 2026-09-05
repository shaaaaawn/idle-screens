import { describe, it, expect } from 'vitest';
import { createRng } from '@idle-screens/core';
import { alphaAt, buildEntities, emitEnvelope, emitWindow, linkPairs, positionAt, sizeAt, spriteIndexAt, spriteVariants } from './simulate';
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

  it('scalar spin gives every entity one shared speed; range spin gives seeded per-entity speeds', () => {
    const scalar: LayerSpec = { count: 8, sprite: { kind: 'circle', radius: [10, 10], color: '#ffffff' }, motion: { type: 'static' }, spin: 12 };
    const scalarEnts = buildEntities(scalar, createRng(3), W, H);
    expect(new Set(scalarEnts.map((e) => e.spinSpeed)).size).toBe(1);
    expect(scalarEnts[0]!.spinSpeed).toBeCloseTo((12 * Math.PI) / 180, 6);

    const ranged: LayerSpec = { count: 12, sprite: { kind: 'circle', radius: [10, 10], color: '#ffffff' }, motion: { type: 'static' }, spin: [6, 14] };
    const degs = buildEntities(ranged, createRng(3), W, H).map((e) => (e.spinSpeed * 180) / Math.PI);
    expect(new Set(degs).size).toBeGreaterThan(1);
    for (const d of degs) {
      expect(d).toBeGreaterThanOrEqual(6 - 1e-6);
      expect(d).toBeLessThanOrEqual(14 + 1e-6);
    }
  });

  it('different seed -> different placement', () => {
    const a = buildEntities(driftLayer, createRng(1), W, H);
    const b = buildEntities(driftLayer, createRng(2), W, H);
    expect(a).not.toEqual(b);
  });

  it('grid layers are exempt from count scaling — the lattice never truncates', () => {
    // A scaled count doesn't thin a grid like a scatter field, it truncates it
    // row-major. Live failure this pins: an 18-column single-row grid at
    // countScale 0.67 rendered 12 cells and stopped at two-thirds width, while
    // the analytic path (countScale 1) showed it full-width.
    const grid: LayerSpec = {
      count: 18,
      sprite: { kind: 'rect', width: [0.028, 0.028], aspect: [1.5, 1.5], color: '#14100c' },
      motion: { type: 'static' },
      layout: { type: 'grid', columns: 18, jitter: 0 },
      region: { x: [0.02, 0.98], y: [0.19, 0.23] },
    };
    for (const cs of [0.5, 0.67, 1, 1.6]) {
      const ents = buildEntities(grid, createRng(42), W, H, Math.min(W, H), cs);
      expect(ents, `countScale ${cs}`).toHaveLength(18);
      const xs = ents.map((e) => e.x0 / W);
      // The row spans its region: first cell near the left edge, last near the right.
      expect(Math.min(...xs)).toBeLessThan(0.08);
      expect(Math.max(...xs)).toBeGreaterThan(0.92);
    }

    // Scatter layers keep scaling — the exemption is grid-only.
    const scatter = buildEntities(driftLayer, createRng(42), W, H, 1, 0.5);
    expect(scatter).toHaveLength(10);
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

// ---------------------------------------------------------------------------
// Time structure (#47): emit, clock, ease
// ---------------------------------------------------------------------------

describe('emit — sparse events', () => {
  const ring = (emit: LayerSpec['emit'], extra: Partial<LayerSpec> = {}): LayerSpec => ({
    count: 4,
    sprite: { kind: 'ring', radius: [10, 10], color: '#4fb3a8' },
    motion: { type: 'static' },
    emit,
    ...extra,
  });

  it('is dark outside its window, lit inside, and the envelope is a pure hump', () => {
    const [e] = buildEntities(ring({ every: 10000, life: 4000 }), createRng(1), W, H);
    let lit = 0;
    let dark = 0;
    for (let t = 0; t < 10000; t += 100) {
      const u = emitWindow(e!, t);
      if (u === null) { dark++; expect(alphaAt(e!, t)).toBe(0); } else { lit++; expect(u).toBeGreaterThanOrEqual(0); expect(u).toBeLessThan(1); }
    }
    expect(lit).toBe(40); // 4000 of every 10000 ms
    expect(dark).toBe(60);
    expect(emitEnvelope(0)).toBe(0);
    expect(emitEnvelope(0.25)).toBe(1);
    expect(emitEnvelope(0.999)).toBeLessThan(0.01);
    expect(emitEnvelope(0.5)).toBeGreaterThan(emitEnvelope(0.9));
    // Periodic: one full period later is the same frame.
    expect(alphaAt(e!, 1234)).toBeCloseTo(alphaAt(e!, 11234), 12);
  });

  it('jitter 0 staggers the entities evenly across the period — one event at a time', () => {
    const ents = buildEntities(ring({ every: 12000, life: 3000, jitter: 0 }), createRng(1), W, H);
    const phases = ents.map((e) => e.emit!.phase).sort((a, b) => a - b);
    expect(phases).toEqual([0, 3000, 6000, 9000]);
    // At any instant at most one entity is lit.
    for (let t = 0; t < 12000; t += 50) {
      const litNow = ents.filter((e) => emitWindow(e, t) !== null).length;
      expect(litNow).toBeLessThanOrEqual(1);
    }
  });

  it('jitter 1 scatters the offsets with no rng draw — this layer and the next are placed identically', () => {
    const jittered = buildEntities(ring({ every: 12000, life: 3000 }), createRng(1), W, H);
    const phases = jittered.map((e) => e.emit!.phase);
    expect(new Set(phases.map((p) => Math.round(p))).size).toBe(4);
    for (const p of phases) { expect(p).toBeGreaterThanOrEqual(0); expect(p).toBeLessThan(12000); }
    const plain = buildEntities(ring(undefined), createRng(1), W, H);
    expect(jittered.map((e) => [e.x0, e.y0, e.size])).toEqual(plain.map((e) => [e.x0, e.y0, e.size]));
    // A later layer sharing the scene rng is untouched too.
    const rngA = createRng(5); buildEntities(ring({ every: 12000, life: 3000 }), rngA, W, H); const nextA = buildEntities(driftLayer, rngA, W, H);
    const rngB = createRng(5); buildEntities(ring(undefined), rngB, W, H); const nextB = buildEntities(driftLayer, rngB, W, H);
    expect(nextA).toEqual(nextB);
    // And the offsets do not depend on the seed — event timing is composition, not scatter.
    expect(buildEntities(ring({ every: 12000, life: 3000 }), createRng(99), W, H).map((e) => e.emit!.phase)).toEqual(phases);
  });

  it('grow scales size from grow[0] to grow[1] across the window', () => {
    const [e] = buildEntities(ring({ every: 10000, life: 4000, jitter: 0, grow: [0.5, 2] }), createRng(1), W, H);
    expect(sizeAt(e!, 0)).toBeCloseTo(e!.size * 0.5, 9);
    expect(sizeAt(e!, 2000)).toBeCloseTo(e!.size * 1.25, 9);
    expect(sizeAt(e!, 3999.9)).toBeCloseTo(e!.size * 2, 2);
  });

  it('life is clamped to every', () => {
    const [e] = buildEntities(ring({ every: 1000, life: 5000 }), createRng(1), W, H);
    expect(e!.emit!.life).toBe(1000);
  });
});

describe('clock — phase-lock', () => {
  const pulsing = (extra: Partial<LayerSpec>): LayerSpec => ({
    count: 6,
    sprite: { kind: 'circle', radius: [4, 8], color: '#fff' },
    motion: { type: 'static' },
    alpha: [0.5, 0.5],
    pulse: { amp: 0.3, period: 2000 },
    grow: { amp: 0.2, period: 2000 },
    ...extra,
  });

  it('locks every entity of the layer to one phase, and two layers to each other', () => {
    const a = buildEntities(pulsing({ clock: { phase: 0.25 } }), createRng(1), W, H);
    const b = buildEntities(pulsing({ clock: { phase: 0.25 } }), createRng(99), W, H);
    for (const e of [...a, ...b]) {
      expect(e.pulsePhase).toBeCloseTo(Math.PI / 2, 12);
      expect(e.growPhase).toBeCloseTo(Math.PI / 2, 12);
    }
    expect(alphaAt(a[0]!, 777) - a[0]!.alpha).toBeCloseTo(alphaAt(b[3]!, 777) - b[3]!.alpha, 12);
  });

  it('draws nothing — placement is identical with and without a clock', () => {
    const plain = buildEntities(pulsing({}), createRng(1), W, H);
    const clocked = buildEntities(pulsing({ clock: { phase: 0.5, rate: 2 } }), createRng(1), W, H);
    expect(clocked.map((e) => [e.x0, e.y0, e.size, e.alpha])).toEqual(plain.map((e) => [e.x0, e.y0, e.size, e.alpha]));
    // Unclocked entities keep seeded, distinct phases.
    expect(new Set(plain.map((e) => e.pulsePhase.toFixed(6))).size).toBeGreaterThan(1);
  });

  it('rate runs pulse faster: rate 2 halves the effective period', () => {
    const [e] = buildEntities(pulsing({ clock: { rate: 2 } }), createRng(1), W, H);
    expect(alphaAt(e!, 250) - e!.alpha).toBeCloseTo(e!.pulseAmp * Math.sin(Math.PI / 2), 9); // 250 ms × 2 = quarter of 2000
  });

  it('a wave keeps its travelling phase on top of the clock', () => {
    const waved = buildEntities(pulsing({ clock: { phase: 0 }, pulse: { amp: 0.3, period: 2000, wave: { wavelength: 200 } } }), createRng(1), W, H);
    expect(new Set(waved.map((e) => e.pulsePhase.toFixed(6))).size).toBeGreaterThan(1);
  });
});

describe('ease — settle and buoyant', () => {
  const mover = (ease: { type: 'settle' | 'buoyant'; tau: number } | undefined, emit?: LayerSpec['emit']): LayerSpec => ({
    count: 1,
    sprite: { kind: 'circle', radius: [2, 2], color: '#fff' },
    motion: { type: 'drift', speed: [100, 100], angle: 0, ease },
    region: { x: [0.1, 0.1], y: [0.5, 0.5] },
    wrap: false,
    emit,
  });

  it('settle travels speed × tau and comes to rest', () => {
    const [e] = buildEntities(mover({ type: 'settle', tau: 2000 }), createRng(1), W, H);
    const x0 = positionAt(e!, 0, W, H).x;
    const far = positionAt(e!, 60000, W, H).x;
    expect(far - x0).toBeCloseTo(100 * 2, 3); // 100 px/s × 2 s
    expect(positionAt(e!, 60000, W, H).x).toBeCloseTo(positionAt(e!, 90000, W, H).x, 6);
    // Decelerating: the first second covers more ground than the second.
    const d1 = positionAt(e!, 1000, W, H).x - x0;
    const d2 = positionAt(e!, 2000, W, H).x - positionAt(e!, 1000, W, H).x;
    expect(d1).toBeGreaterThan(d2);
  });

  it('buoyant starts at rest and approaches the linear path', () => {
    const [e] = buildEntities(mover({ type: 'buoyant', tau: 1000 }), createRng(1), W, H);
    const [lin] = buildEntities(mover(undefined), createRng(1), W, H);
    const x0 = positionAt(e!, 0, W, H).x;
    expect(positionAt(e!, 100, W, H).x - x0).toBeLessThan(positionAt(lin!, 100, W, H).x - x0);
    // After many τ the eased path lags the linear one by exactly speed × tau.
    expect(positionAt(lin!, 20000, W, H).x - positionAt(e!, 20000, W, H).x).toBeCloseTo(100, 3);
  });

  it('with emit, the eased travel restarts from the spawn point on every event', () => {
    const [e] = buildEntities(mover({ type: 'settle', tau: 500 }, { every: 5000, life: 2000, jitter: 0 }), createRng(1), W, H);
    const x0 = positionAt(e!, 0, W, H).x;
    expect(positionAt(e!, 5000, W, H).x).toBeCloseTo(x0, 6);
    expect(positionAt(e!, 4999, W, H).x).toBeCloseTo(x0 + 100 * 0.5, 2); // settled 50 px out
  });

  it('draws nothing — placement is identical with and without ease', () => {
    const a = buildEntities(mover({ type: 'settle', tau: 500 }), createRng(3), W, H);
    const b = buildEntities(mover(undefined), createRng(3), W, H);
    expect([a[0]!.x0, a[0]!.y0, a[0]!.size]).toEqual([b[0]!.x0, b[0]!.y0, b[0]!.size]);
  });
});

// ---------------------------------------------------------------------------
// Data layouts (#49): list / table, ordered variants, bar sprites
// ---------------------------------------------------------------------------

describe('layout: list / table', () => {
  const labels = (extra: Partial<LayerSpec> = {}): LayerSpec => ({
    count: 4,
    sprite: { kind: 'text', strings: ['A', 'B', 'C', 'D'] },
    size: [20, 20],
    motion: { type: 'static' },
    layout: { type: 'list', gap: 50 },
    position: { x: 0.1, y: 0.2 },
    ...extra,
  });

  it('stacks entities from the anchor in reading order, with strings in order', () => {
    const ents = buildEntities(labels(), createRng(1), W, H);
    expect(ents.map((e) => [e.x0, e.y0])).toEqual([[80, 120], [80, 170], [80, 220], [80, 270]]);
    expect(ents.map((e) => e.spriteIndex)).toEqual([0, 1, 2, 3]);
  });

  it('table fills columns row-major with per-axis gaps', () => {
    const ents = buildEntities(labels({ count: 5, layout: { type: 'table', columns: 2, gap: { x: 100, y: 30 } } }), createRng(1), W, H);
    expect(ents.map((e) => [e.x0, e.y0])).toEqual([[80, 120], [180, 120], [80, 150], [180, 150], [80, 180]]);
  });

  it('without a position the block is centred in the region', () => {
    const ents = buildEntities(labels({ position: undefined, region: { x: [0, 0.5], y: [0, 1] } }), createRng(1), W, H);
    const ys = ents.map((e) => e.y0);
    expect(ents[0]!.x0).toBe(200); // centre of the left half
    expect((ys[0]! + ys[3]!) / 2).toBeCloseTo(300, 9); // centred vertically
  });

  it('burns the two scatter draws so the rest of the layer stream is unchanged when the layout toggles', () => {
    const scattered = buildEntities(labels({ layout: undefined, position: undefined, alpha: [0.2, 0.9] }), createRng(7), W, H);
    const listed = buildEntities(labels({ position: undefined, alpha: [0.2, 0.9] }), createRng(7), W, H);
    expect(listed.map((e) => e.alpha)).toEqual(scattered.map((e) => e.alpha));
  });

  it('takes palette colours in order too, unless weights are given', () => {
    const bars = buildEntities({ count: 3, sprite: { kind: 'bar', values: [1, 2, 3], length: 100, thickness: 10, color: '#fff', colors: ['#111', '#222', '#333'] }, motion: { type: 'static' }, layout: { type: 'list' } }, createRng(1), W, H);
    expect(bars.map((e) => e.colorIndex)).toEqual([0, 1, 2]);
    expect(bars.map((e) => e.barIndex)).toEqual([0, 1, 2]);
    expect(bars.map((e) => [e.size, e.size2])).toEqual([[100, 10], [100, 10], [100, 10]]);
  });
});
