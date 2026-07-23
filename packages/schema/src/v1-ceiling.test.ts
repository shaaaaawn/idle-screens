import { describe, it, expect } from 'vitest';
import { createRng } from '@idle-screens/core';
import { buildEntities, lifeAlphaAt, linkEdges, positionAt, sizeAt, alphaAt, headingAt } from './simulate';
import { validateSpec } from './validate';
import { structuralSignature } from './steer';
import type { LayerSpec, SaverSpec } from './types';

const W = 1920;
const H = 1080;

function layer(partial: Partial<LayerSpec> & Pick<LayerSpec, 'motion'>): LayerSpec {
  return {
    count: 10,
    sprite: { kind: 'circle', radius: [4, 8], color: '#ffffff' },
    ...partial,
  } as LayerSpec;
}

function build(l: LayerSpec, seed = 7): ReturnType<typeof buildEntities> {
  return buildEntities(l, createRng(seed), W, H);
}

function baseSpec(overrides: Partial<SaverSpec> = {}): SaverSpec {
  return {
    schemaVersion: 1,
    id: 't',
    label: 'T',
    units: 'px',
    layers: [layer({ motion: { type: 'drift', speed: [10, 20] } })],
    ...overrides,
  };
}

describe('wander motion', () => {
  it('is deterministic and curves away from the straight drift line', () => {
    const l = layer({ motion: { type: 'wander', speed: [20, 30], angle: 0, meander: 80 } });
    const a = build(l);
    const b = build(l);
    expect(a).toEqual(b);
    const e = a[0]!;
    // At some sampled time the harmonic offset must pull y off the straight line.
    const straightY = e.y0;
    const deviations = [1000, 2500, 4000, 6000].map((t) => Math.abs(positionAt(e, t, W, H).y - straightY));
    expect(Math.max(...deviations)).toBeGreaterThan(1);
  });

  it('coherence 1 gives every entity an identical harmonic offset', () => {
    const l = layer({ motion: { type: 'wander', speed: [10, 10], angle: 0, meander: 60, coherence: 1 } });
    const [e1, e2] = build(l);
    const t = 3333;
    const off1 = positionAt(e1!, t, W, H).y - e1!.y0;
    const off2 = positionAt(e2!, t, W, H).y - e2!.y0;
    expect(off1).toBeCloseTo(off2, 8);
  });
});

describe('warp motion', () => {
  const l = layer({ motion: { type: 'warp', speed: [0.2, 0.2] } });

  it('streams outward from the center with growing size', () => {
    const e = build(l)[0]!;
    // Within one depth cycle (z0 → near plane), distance from center and size grow.
    const cx = W / 2;
    const cy = H / 2;
    const t0 = 0;
    const t1 = 400; // small step — no wrap yet for z0 in (0.16, 1]
    const d0 = Math.hypot(positionAt(e, t0, W, H).x - cx, positionAt(e, t0, W, H).y - cy);
    const d1 = Math.hypot(positionAt(e, t1, W, H).x - cx, positionAt(e, t1, W, H).y - cy);
    if (e.warp!.z0 > 0.16) {
      expect(d1).toBeGreaterThan(d0);
      expect(sizeAt(e, t1)).toBeGreaterThan(sizeAt(e, t0));
    }
  });

  it('fades entities in near the far plane (masks the respawn pop)', () => {
    const e = { ...build(l)[0]! };
    e.warp = { ...e.warp!, z0: 0.999, vz: 0.2 };
    expect(alphaAt(e, 0)).toBeLessThan(0.05); // just inside the far plane — nearly invisible
    expect(alphaAt(e, 2000)).toBeGreaterThan(alphaAt(e, 0));
  });

  it('orients streak headings radially outward', () => {
    const e = build(l)[0]!;
    const t = 300;
    const heading = headingAt(e, t, W, H);
    if (heading !== null) {
      const p = positionAt(e, t, W, H);
      const radial = Math.atan2(p.y - H / 2, p.x - W / 2);
      // Angles agree modulo small numerical differences.
      const diff = Math.abs(Math.atan2(Math.sin(heading - radial), Math.cos(heading - radial)));
      expect(diff).toBeLessThan(0.1);
    }
  });
});

describe('path motion', () => {
  const points = [
    { x: 0.2, y: 0.3 },
    { x: 0.8, y: 0.3 },
    { x: 0.5, y: 0.8 },
  ];

  it('closed paths loop exactly with period = duration', () => {
    const l = layer({ motion: { type: 'path', points, duration: 8000, closed: true } });
    const e = build(l)[0]!;
    const p1 = positionAt(e, 1234, W, H);
    const p2 = positionAt(e, 1234 + 8000, W, H);
    expect(p2.x).toBeCloseTo(p1.x, 6);
    expect(p2.y).toBeCloseTo(p1.y, 6);
  });

  it('open paths ping-pong instead of teleporting', () => {
    const l = layer({ count: 1, motion: { type: 'path', points, duration: 8000, closed: false, curve: 'linear' } });
    const e = build(l)[0]!;
    // Sample densely across two laps: consecutive positions must never jump more
    // than the max segment length would allow in one step.
    let prev = positionAt(e, 0, W, H);
    for (let t = 50; t <= 16000; t += 50) {
      const p = positionAt(e, t, W, H);
      const jump = Math.hypot(p.x - prev.x, p.y - prev.y);
      expect(jump).toBeLessThan(80);
      prev = p;
    }
  });

  it('scatter offsets entities sharing a path', () => {
    const l = layer({ motion: { type: 'path', points, duration: 8000, scatter: 40 } });
    const ents = build(l);
    const offsets = new Set(ents.map((e) => `${e.path!.offX.toFixed(3)}:${e.path!.offY.toFixed(3)}`));
    expect(offsets.size).toBeGreaterThan(1);
  });
});

describe('lifeAlphaAt', () => {
  it('ramps in at enter and out after exit', () => {
    const life = { enter: 1000, exit: 5000, fade: 500 };
    expect(lifeAlphaAt(life, 0)).toBe(0);
    expect(lifeAlphaAt(life, 999)).toBe(0);
    expect(lifeAlphaAt(life, 1250)).toBeCloseTo(0.5, 5);
    expect(lifeAlphaAt(life, 2000)).toBe(1);
    expect(lifeAlphaAt(life, 5250)).toBeCloseTo(0.5, 5);
    expect(lifeAlphaAt(life, 6000)).toBe(0);
    expect(lifeAlphaAt(undefined, 123)).toBe(1);
  });
});

describe('linkEdges modes', () => {
  const positions = [
    { x: 100, y: 100 },
    { x: 200, y: 100 },
    { x: 200, y: 200 },
    { x: 100, y: 200 },
  ];

  it('chain connects in order; closed joins last to first', () => {
    const open = linkEdges({ k: 1, maxDist: 1, mode: 'chain' }, positions, 1, false, W, H);
    expect(open.map((e) => [e.i, e.j])).toEqual([[0, 1], [1, 2], [2, 3]]);
    const closed = linkEdges({ k: 1, maxDist: 1, mode: 'chain', closed: true }, positions, 1, false, W, H);
    expect(closed.map((e) => [e.i, e.j])).toEqual([[0, 1], [1, 2], [2, 3], [3, 0]]);
  });

  it('random mode is deterministic and respects maxDist', () => {
    const a = linkEdges({ k: 2, maxDist: 1, mode: 'random' }, positions, 150, false, W, H);
    const b = linkEdges({ k: 2, maxDist: 1, mode: 'random' }, positions, 150, false, W, H);
    expect(a).toEqual(b);
    for (const e of a) expect(e.dist).toBeLessThanOrEqual(150);
  });

  it('nearest mode carries wrap-aware distances for falloff', () => {
    const edges = linkEdges({ k: 1, maxDist: 1 }, positions, 150, false, W, H);
    for (const e of edges) expect(e.dist).toBeCloseTo(100, 5);
  });
});

describe('grid layout', () => {
  it('places entities at cell centers with jitter 0', () => {
    const l = layer({ count: 4, layout: { type: 'grid', columns: 2 }, motion: { type: 'static' } });
    const ents = build(l);
    expect(ents.map((e) => [e.x0, e.y0])).toEqual([
      [W * 0.25, H * 0.25],
      [W * 0.75, H * 0.25],
      [W * 0.25, H * 0.75],
      [W * 0.75, H * 0.75],
    ]);
  });

  it('per-axis jitter { y: 1 } keeps columns exact while scattering rows', () => {
    const l = layer({ count: 8, layout: { type: 'grid', columns: 4, jitter: { y: 1 } }, motion: { type: 'static' } });
    const ents = build(l);
    const colXs = new Set(ents.map((e) => e.x0.toFixed(6)));
    expect(colXs.size).toBe(4); // x stays on the 4 column centers
    const rowYs = new Set(ents.map((e) => e.y0.toFixed(6)));
    expect(rowYs.size).toBeGreaterThan(2); // y scattered
  });
});

describe('weighted palettes', () => {
  it('a degenerate weight vector forces a single color', () => {
    const l = layer({
      count: 50,
      sprite: { kind: 'circle', radius: [2, 4], color: '#fff', colors: ['#111111', '#222222', '#333333'], colorWeights: [0, 0, 1] },
      motion: { type: 'static' },
    });
    for (const e of build(l)) expect(e.colorIndex).toBe(2);
  });
});

describe('pulse.wave', () => {
  it('derives phase from position without disturbing other draws', () => {
    const plain = layer({ motion: { type: 'static' }, pulse: { amp: 0.3, period: 2000 } });
    const waved = layer({ motion: { type: 'static' }, pulse: { amp: 0.3, period: 2000, wave: { wavelength: 300, angle: 0 } } });
    const a = build(plain);
    const b = build(waved);
    for (let i = 0; i < a.length; i++) {
      const { pulsePhase: pa, ...restA } = a[i]!;
      const { pulsePhase: pb, ...restB } = b[i]!;
      expect(restB).toEqual(restA); // identical streams apart from the derived phase
      expect(pb).toBeCloseTo(-(b[i]!.x0 / 300) * Math.PI * 2, 6);
      void pa;
    }
  });
});

describe('validation of ceiling features', () => {
  it('caps ghosting and rejects out-of-range values', () => {
    expect(validateSpec(baseSpec({ ghosting: 0.9 })).valid).toBe(true);
    expect(validateSpec(baseSpec({ ghosting: 0.99 })).valid).toBe(false);
    expect(validateSpec(baseSpec({ ghosting: -0.1 })).valid).toBe(false);
  });

  it('enforces the warp speed cap and path floors', () => {
    const warp = baseSpec({ layers: [layer({ motion: { type: 'warp', speed: [0.1, 2] } })] });
    expect(validateSpec(warp).errors.some((e) => e.message.includes('warp speed'))).toBe(true);
    const path = baseSpec({ layers: [layer({ motion: { type: 'path', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], duration: 500 } })] });
    expect(validateSpec(path).errors.some((e) => e.path.endsWith('duration'))).toBe(true);
  });

  it('validates colorWeights shape', () => {
    const bad = baseSpec({
      layers: [layer({ sprite: { kind: 'circle', radius: [2, 4], color: '#fff', colors: ['#111111', '#222222'], colorWeights: [1] }, motion: { type: 'static' } })],
    });
    expect(validateSpec(bad).errors.some((e) => e.path.endsWith('colorWeights'))).toBe(true);
  });

  it('validates orbit layer-parents: existence, count 1, one level deep', () => {
    const missing = baseSpec({
      layers: [layer({ motion: { type: 'orbit', speed: [10, 20], radius: [50, 80], center: { layer: 'nope' } } })],
    });
    expect(validateSpec(missing).errors.some((e) => e.message.includes('no layer with key'))).toBe(true);

    const multi = baseSpec({
      layers: [
        layer({ key: 'parent', count: 3, motion: { type: 'drift', speed: [5, 10] } }),
        layer({ motion: { type: 'orbit', speed: [10, 20], radius: [50, 80], center: { layer: 'parent' } } }),
      ],
    });
    expect(validateSpec(multi).errors.some((e) => e.message.includes('count: 1'))).toBe(true);

    const twoLevel = baseSpec({
      layers: [
        layer({ key: 'root', count: 1, motion: { type: 'static' } }),
        layer({ key: 'mid', count: 1, motion: { type: 'orbit', speed: [10, 20], radius: [50, 80], center: { layer: 'root' } } }),
        layer({ motion: { type: 'orbit', speed: [10, 20], radius: [30, 40], center: { layer: 'mid' } } }),
      ],
    });
    expect(validateSpec(twoLevel).errors.some((e) => e.message.includes('one level deep'))).toBe(true);
  });

  it('accepts the new sprite kinds and rejects malformed ones', () => {
    const ok = baseSpec({
      layers: [
        layer({ sprite: { kind: 'ring', radius: [3, 6], color: '#abcdef', width: 1.5 }, motion: { type: 'rise', speed: [10, 20] } }),
        layer({ sprite: { kind: 'streak', length: [10, 30], color: '#abcdef' }, motion: { type: 'drift', speed: [40, 80], angle: 90 } }),
        layer({ sprite: { kind: 'rect', width: [4, 9], aspect: [1, 2], color: '#abcdef' }, motion: { type: 'bounce', speed: [20, 50] } }),
      ],
    });
    expect(validateSpec(ok)).toMatchObject({ valid: true, errors: [] });
    const bad = baseSpec({
      layers: [layer({ sprite: { kind: 'streak', length: [30, 10], color: '#abcdef' } as never, motion: { type: 'drift', speed: [10, 20] } })],
    });
    expect(validateSpec(bad).valid).toBe(false);
  });
});

describe('structural signature', () => {
  it('changes when layout or colorWeights change (forces deterministic rebuild)', () => {
    const a = baseSpec();
    const withLayout = baseSpec({ layers: [layer({ layout: { type: 'grid', columns: 5 }, motion: { type: 'drift', speed: [10, 20] } })] });
    expect(structuralSignature(withLayout)).not.toEqual(structuralSignature(a));
    const weighted = baseSpec({
      layers: [layer({ sprite: { kind: 'circle', radius: [4, 8], color: '#ffffff', colors: ['#111111', '#222222'], colorWeights: [3, 1] }, motion: { type: 'drift', speed: [10, 20] } })],
    });
    const unweighted = baseSpec({
      layers: [layer({ sprite: { kind: 'circle', radius: [4, 8], color: '#ffffff', colors: ['#111111', '#222222'] }, motion: { type: 'drift', speed: [10, 20] } })],
    });
    expect(structuralSignature(weighted)).not.toEqual(structuralSignature(unweighted));
  });
});
