import { describe, expect, it } from 'vitest';
import { applyDeltasToSpec, easeSmooth, lerpSpec, resolveSpecPath, sequenceSteerablePaths, steerablePaths, structuralSignature } from './steer';
import type { SaverSpec } from './types';

const spec: SaverSpec = {
  schemaVersion: 1,
  id: 't',
  label: 'T',
  units: 'px',
  ghosting: 0.2,
  referenceViewport: 1080,
  background: {
    type: 'gradient',
    stops: [
      { at: 0, color: '#000000' },
      { at: 1, color: '#204060' },
    ],
  },
  layers: [
    {
      key: 'dots',
      count: 10,
      sprite: { kind: 'circle', radius: [1, 3], color: '#ff0000' },
      motion: { type: 'drift', speed: [10, 20] },
    },
  ],
};

describe('resolveSpecPath', () => {
  it('resolves index paths and key paths to the same target', () => {
    const byIndex = resolveSpecPath(spec, 'layers.0.count')!;
    const byKey = resolveSpecPath(spec, 'dots.count')!;
    expect(byIndex.parent).toBe(byKey.parent);
    expect(byIndex.key).toBe('count');
  });

  it('resolves into arrays (gradient stops)', () => {
    const t = resolveSpecPath(spec, 'background.stops.1.color')!;
    expect((t.parent as Record<string, unknown>)[t.key as string]).toBe('#204060');
  });

  it('resolves steerable top-level paint and sizing fields', () => {
    expect(resolveSpecPath(spec, 'ghosting')?.key).toBe('ghosting');
    expect(resolveSpecPath(spec, 'referenceViewport')?.key).toBe('referenceViewport');
  });

  it('returns null for unknown paths', () => {
    expect(resolveSpecPath(spec, 'layers.9.count')).toBeNull();
    expect(resolveSpecPath(spec, 'nope.count')).toBeNull();
    expect(resolveSpecPath(spec, 'layers.0.bogus')).toBeNull();
  });
});

describe('applyDeltasToSpec', () => {
  it('applies last-wins without mutating the base', () => {
    const out = applyDeltasToSpec(spec, [
      { t: 0, path: 'dots.count', value: 50 },
      { t: 1, path: 'dots.count', value: 200 },
      { t: 2, path: 'background.stops.1.color', value: '#ffffff' },
      { t: 3, path: 'unknown.path', value: 1 },
      { t: 4, path: 'ghosting', value: 0.8 },
      { t: 5, path: 'referenceViewport', value: 720 },
    ]);
    expect(out.layers[0]!.count).toBe(200);
    expect((out.background as { stops: Array<{ color: string }> }).stops[1]!.color).toBe('#ffffff');
    expect(spec.layers[0]!.count).toBe(10); // base untouched
    expect(out.ghosting).toBe(0.8);
    expect(out.referenceViewport).toBe(720);
  });
});

describe('lerpSpec', () => {
  const to = applyDeltasToSpec(spec, [
    { t: 0, path: 'dots.count', value: 110 },
    { t: 0, path: 'layers.0.sprite.color', value: '#0000ff' },
  ]);

  it('lerps numbers (count rounds to int)', () => {
    const mid = lerpSpec(spec, to, 0.5);
    expect(mid.layers[0]!.count).toBe(60);
    expect(Number.isInteger(mid.layers[0]!.count)).toBe(true);
  });

  it('lerps hex colours per channel', () => {
    const mid = lerpSpec(spec, to, 0.5);
    expect((mid.layers[0]!.sprite as { color: string }).color).toBe('#800080');
  });

  it('returns exact endpoints at k=0 and k=1', () => {
    expect(lerpSpec(spec, to, 0).layers[0]!.count).toBe(10);
    expect(lerpSpec(spec, to, 1).layers[0]!.count).toBe(110);
  });
});

describe('structuralSignature', () => {
  it('changes when count changes, not when colour changes', () => {
    const base = structuralSignature(spec);
    const colorOnly = applyDeltasToSpec(spec, [{ t: 0, path: 'layers.0.sprite.color', value: '#00ff00' }]);
    const countChange = applyDeltasToSpec(spec, [{ t: 0, path: 'dots.count', value: 99 }]);
    expect(structuralSignature(colorOnly)).toBe(base);
    expect(structuralSignature(countChange)).not.toBe(base);
    expect(structuralSignature({ ...spec, referenceViewport: 720 })).not.toBe(base);
  });
});

describe('steerablePaths', () => {
  it('returns leaf paths for numbers, strings, and arrays', () => {
    const paths = steerablePaths(spec);
    expect(paths).toContain('layers.0.count');
    expect(paths).toContain('layers.0.sprite.color');
    expect(paths).toContain('layers.0.sprite.radius');
    expect(paths).toContain('layers.0.motion.speed');
    expect(paths).toContain('background.stops.0.color');
    expect(paths).toContain('background.stops.0.at');
    expect(paths).toContain('background.stops.1.color');
    expect(paths).toContain('ghosting');
    expect(paths).toContain('referenceViewport');
  });

  it('skips metadata fields', () => {
    const paths = steerablePaths(spec);
    expect(paths).not.toContain('schemaVersion');
    expect(paths).not.toContain('id');
    expect(paths).not.toContain('label');
    expect(paths).not.toContain('layers.0.sprite.kind');
    expect(paths).not.toContain('background.type');
    expect(paths).not.toContain('units');
  });

  it('handles specs with links, pulse, grow, and key', () => {
    const rich: SaverSpec = {
      schemaVersion: 1, id: 'r', label: 'R',
      layers: [{
        key: 'stars',
        count: 40,
        sprite: { kind: 'circle', radius: [2, 5], color: '#fff', colors: ['#aaa', '#bbb'] },
        motion: { type: 'drift', speed: [1, 5], bidirectional: true, bob: 3 },
        links: { k: 3, maxDist: 200, alpha: 0.15, width: 0.5 },
        pulse: { amp: 0.2, period: 3000 },
        grow: { amp: 0.1, period: 2000 },
        spin: 10,
        alpha: [0.5, 0.9],
        blend: 'lighter',
      }],
    };
    const paths = steerablePaths(rich);
    expect(paths).toContain('layers.0.links.k');
    expect(paths).toContain('layers.0.links.maxDist');
    expect(paths).toContain('layers.0.links.alpha');
    expect(paths).toContain('layers.0.pulse.amp');
    expect(paths).toContain('layers.0.grow.period');
    expect(paths).toContain('layers.0.spin');
    expect(paths).toContain('layers.0.sprite.colors');
    expect(paths).toContain('layers.0.motion.bidirectional');
    expect(paths).toContain('layers.0.motion.bob');
    expect(paths).not.toContain('layers.0.key');
  });

  it('returns empty for non-objects', () => {
    expect(steerablePaths(null)).toEqual([]);
    expect(steerablePaths(42)).toEqual([]);
  });

  it('omits a root field shadowed by a same-named layer key', () => {
    const shadowed: SaverSpec = {
      ...spec,
      layers: [{ ...spec.layers[0]!, key: 'ghosting' }],
    };
    const paths = steerablePaths(shadowed);
    expect(paths).not.toContain('ghosting');
    expect(paths).toContain('referenceViewport');
    expect(paths).toContain('layers.0.count');
  });
});

describe('easeSmooth', () => {
  it('is clamped and monotonic through the midpoint', () => {
    expect(easeSmooth(-1)).toBe(0);
    expect(easeSmooth(2)).toBe(1);
    expect(easeSmooth(0.5)).toBeCloseTo(0.5);
    expect(easeSmooth(0.25)).toBeLessThan(easeSmooth(0.75));
  });
});

describe('sequenceSteerablePaths', () => {
  const scene = (color: string, extra: Record<string, unknown> = {}) => ({
    schemaVersion: 1 as const, id: 's', label: 'S',
    layers: [{ count: 1, sprite: { kind: 'circle' as const, radius: [1, 2] as [number, number], color }, motion: { type: 'static' as const }, ...extra }],
  });
  it('lists the clicker, the union of segment paths, and bed paths under the bed. prefix', () => {
    const paths = sequenceSteerablePaths({
      format: 'idle-sequence', schemaVersion: 1, id: 'q', label: 'Q', loop: false,
      bed: { ...scene('#111'), ghosting: 0.5 },
      segments: [
        { key: 'a', scene: scene('#222'), duration: 2000 },
        { key: 'b', scene: scene('#333', { alpha: [0.5, 1] }), duration: 2000 },
      ],
    });
    expect(paths[0]).toBe('sequence.segment');
    expect(paths).toContain('bed.layers.0.sprite.color');
    expect(paths).toContain('bed.ghosting');
    expect(paths).toContain('layers.0.sprite.color');
    expect(paths).toContain('layers.0.alpha'); // only segment b has it — the union
    expect(paths.filter((p) => p === 'layers.0.sprite.color')).toHaveLength(1); // deduplicated
    expect(paths.some((p) => p.startsWith('segments'))).toBe(false);
  });
  it('has no bed. paths without a bed', () => {
    const paths = sequenceSteerablePaths({ format: 'idle-sequence', schemaVersion: 1, id: 'q', label: 'Q', loop: false, segments: [{ key: 'a', scene: scene('#222') }] });
    expect(paths.some((p) => p.startsWith('bed.'))).toBe(false);
    expect(paths).toContain('sequence.segment');
  });
});
