import { describe, expect, it } from 'vitest';
import { describeScene } from './describe';
import { LIMITS, type SaverSpec } from './types';

const spec = (referenceViewport?: number): SaverSpec => ({
  schemaVersion: 1,
  id: 'demo',
  label: 'Demo',
  units: 'viewport',
  ...(referenceViewport !== undefined ? { referenceViewport } : {}),
  background: { type: 'solid', color: '#000000' },
  layers: [
    { key: 'dots', count: 10, sprite: { kind: 'circle', radius: [0.01, 0.02], color: '#fff' }, motion: { type: 'static' } },
  ],
});

describe('describeScene', () => {
  it('reports entity counts unscaled at the default referenceViewport', () => {
    const d = describeScene(spec(), { viewport: { width: 1080, height: 1080 } });
    expect(d.snapshots[0]!.layers[0]!.count).toBe(10);
  });

  it('scales entity count by min(w,h)/referenceViewport, matching compileSaver', () => {
    // At 2160 with the default referenceViewport (1080), density scaling doubles the count.
    const d = describeScene(spec(), { viewport: { width: 2160, height: 2160 } });
    expect(d.snapshots[0]!.layers[0]!.count).toBe(20);
  });

  it('honors a custom referenceViewport instead of always assuming 1080', () => {
    // Same 2160 viewport, but referenceViewport: 2160 means no density scaling.
    const d = describeScene(spec(2160), { viewport: { width: 2160, height: 2160 } });
    expect(d.snapshots[0]!.layers[0]!.count).toBe(10);
  });

  it('treats an omitted `units` as viewport, like every other builder (F48)', () => {
    // Every shipped example omits `units`; describeScene used to build them at
    // scale 1 — roughly 1/1080th of the rendered size — so its coverage read 0.
    const noUnits: SaverSpec = { ...spec() };
    delete (noUnits as { units?: string }).units;
    const d = describeScene(noUnits, { viewport: { width: 1920, height: 1080 } });
    const explicit = describeScene(spec(), { viewport: { width: 1920, height: 1080 } });
    expect(d.snapshots[0]!.layers[0]!.coverage).toBeGreaterThan(0);
    expect(d.snapshots[0]!.layers[0]!.coverage).toBe(explicit.snapshots[0]!.layers[0]!.coverage);
    expect(d.spec.units).toBe('viewport');
  });

  it('clamps scaled counts to LIMITS.maxTotal like the renderer (F49)', () => {
    // 5120×2880 (a 5K display) scales two 200-entity layers ×2.67 → 1067
    // projected; the renderer clamps the total back to 800 and so must this.
    const dense: SaverSpec = { ...spec(), layers: [{ ...spec().layers[0]!, count: 200 }, { ...spec().layers[0]!, key: 'more', count: 200 }] };
    const d = describeScene(dense, { viewport: { width: 5120, height: 2880 } });
    const total = d.snapshots[0]!.layers.reduce((s, l) => s + l.count, 0);
    expect(total).toBe(LIMITS.maxTotal);
  });

  it('measures polygon coverage by the outline area', () => {
    const band: SaverSpec = {
      ...spec(),
      layers: [{ count: 1, sprite: { kind: 'polygon', radius: [0.5, 0.5], color: '#fff', points: [[-1, -0.1], [1, -0.1], [1, 0.1], [-1, 0.1]] }, motion: { type: 'static' } }],
    };
    const d = describeScene(band, { viewport: { width: 1000, height: 1000 } });
    // 1000 × 100 px of a 1000 × 1000 frame.
    expect(d.snapshots[0]!.layers[0]!.coverage).toBeCloseTo(0.1, 4);
  });
});
