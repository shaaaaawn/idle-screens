import { describe, expect, it } from 'vitest';
import { describeScene } from './describe';
import type { SaverSpec } from './types';

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
