import { describe, it, expect } from 'vitest';
import { MANEUVERS, maneuverAt, maneuverSpecOf } from './maneuver';

describe('maneuvers — the compiled performance', () => {
  it('none / rate 0 / intensity 0 are exact no-ops', () => {
    expect(maneuverSpecOf('none')).toBeNull();
    expect(maneuverSpecOf('breakdance')).toBeNull();
    const spec = maneuverSpecOf('dart');
    for (const st of [
      maneuverAt(null, 3, 100, 1, 1),
      maneuverAt(spec, 3, 100, 0, 1),
      maneuverAt(spec, 3, 100, 1, 0),
    ]) {
      expect(st).toEqual({ along: 0, side: 0, up: 0, flurry: 0 });
    }
  });

  it('is pure and frame-addressable: same inputs, same state, any order', () => {
    const spec = maneuverSpecOf('zoomies');
    const a = maneuverAt(spec, 5, 123.4, 0.8, 0.9);
    // Evaluate other times in between — must not matter.
    maneuverAt(spec, 5, 999, 0.8, 0.9);
    maneuverAt(spec, 5, 1, 0.8, 0.9);
    expect(maneuverAt(spec, 5, 123.4, 0.8, 0.9)).toEqual(a);
  });

  it('kicks close back to zero between events; advance is permanent', () => {
    const spec = maneuverSpecOf('dart')!;
    const interval = spec.interval; // rate 1
    // Sample a long stretch at fine steps: side/up must return to ~0 between
    // events, along must be monotonically accumulating overall.
    let maxSide = 0;
    const alongAt = (t: number) => maneuverAt(spec, 2, t, 1, 1).along;
    for (let t = 0; t < interval * 6; t += 0.25) {
      maxSide = Math.max(maxSide, Math.abs(maneuverAt(spec, 2, t, 1, 1).side));
    }
    expect(maxSide).toBeGreaterThan(0.1); // events actually fire
    expect(alongAt(interval * 6)).toBeGreaterThanOrEqual(spec.advance * 4); // ~6 events done
    // Far from any event boundary the kick is closed.
    const quiet = maneuverAt(spec, 2, interval * 3 + spec.dur + 2, 1, 1);
    expect(Math.abs(quiet.side)).toBeLessThan(1e-9);
    expect(Math.abs(quiet.up)).toBeLessThan(1e-9);
  });

  it('every fish runs its own schedule — no synchronized flinching', () => {
    const spec = maneuverSpecOf('startle')!;
    const t = 30;
    const sides = Array.from({ length: 8 }, (_, i) => maneuverAt(spec, i, t, 1, 1).side);
    // At any instant, most fish are quiet and a few are mid-event.
    const active = sides.filter((s) => Math.abs(s) > 0.05).length;
    expect(active).toBeGreaterThan(0);
    expect(active).toBeLessThan(8);
  });

  it('graze drops back and noses down; zoomies out-advances dart', () => {
    const g = maneuverSpecOf('graze')!;
    const t = g.interval * 4;
    expect(maneuverAt(g, 1, t, 1, 1).along).toBeLessThan(0);
    const far = 400;
    const z = maneuverAt(maneuverSpecOf('zoomies'), 1, far, 1, 1).along;
    const d = maneuverAt(maneuverSpecOf('dart'), 1, far, 1, 1).along;
    expect(z).toBeGreaterThan(d);
  });

  it('the catalogue is what we say it is', () => {
    expect([...MANEUVERS]).toEqual(['none', 'dart', 'startle', 'graze', 'curious', 'zoomies']);
    for (const m of MANEUVERS) {
      if (m === 'none') continue;
      const spec = maneuverSpecOf(m)!;
      expect(spec.dur).toBeLessThanOrEqual(spec.interval); // events never overlap themselves
    }
  });
});
