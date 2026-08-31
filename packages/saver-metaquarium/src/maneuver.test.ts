import { describe, it, expect } from 'vitest';
import { MANEUVERS, maneuverAt, maneuverSpecOf } from './maneuver';

describe('maneuvers — the compiled performance', () => {
  it('none / rate 0 / intensity 0 are exact no-ops', () => {
    expect(maneuverSpecOf('none')).toBeNull();
    expect(maneuverSpecOf('breakdance')).toBeNull();
    const spec = maneuverSpecOf('dart');
    // Prototype-chain names must not resolve to ghost specs of undefineds.
    expect(maneuverSpecOf('toString')).toBeNull();
    expect(maneuverSpecOf('constructor')).toBeNull();
    for (const st of [
      maneuverAt(null, 3, 100, 1, 1),
      maneuverAt(spec, 3, 100, 0, 1),
      maneuverAt(spec, 3, 100, 1, 0),
    ]) {
      expect(st).toEqual({ along: 0, alongBump: 0, side: 0, up: 0, flurry: 0, pitch: 0 });
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
    // Far from any event boundary the kick is closed — and so is the seat
    // displacement, which is what lets a formation fish come home.
    const quiet = maneuverAt(spec, 2, interval * 3 + spec.dur + 2, 1, 1);
    expect(Math.abs(quiet.side)).toBeLessThan(1e-9);
    expect(Math.abs(quiet.up)).toBeLessThan(1e-9);
    expect(Math.abs(quiet.alongBump)).toBeLessThan(1e-9);
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
    // "Noses down" is an assertion, not a caption: somewhere in each period
    // the vertical kick must actually be negative.
    let minUp = 0;
    for (let tt = 0; tt < g.interval * 3; tt += 0.2) {
      minUp = Math.min(minUp, maneuverAt(g, 1, tt, 1, 1).up);
    }
    expect(minUp).toBeLessThan(-0.05);
    const far = 400;
    const z = maneuverAt(maneuverSpecOf('zoomies'), 1, far, 1, 1).along;
    const d = maneuverAt(maneuverSpecOf('dart'), 1, far, 1, 1).along;
    expect(z).toBeGreaterThan(d);
  });

  it('graze pitches nose-down mid-event; dart never pitches', () => {
    const g = maneuverSpecOf('graze')!;
    let minPitch = 0;
    for (let t = 0; t < g.interval * 3; t += 0.2) {
      minPitch = Math.min(minPitch, maneuverAt(g, 1, t, 1, 1).pitch);
    }
    expect(minPitch).toBeLessThan(-0.3);
    const d = maneuverSpecOf('dart')!;
    for (let t = 0; t < d.interval * 2; t += 0.5) {
      expect(maneuverAt(d, 1, t, 1, 1).pitch).toBe(0);
    }
  });
  it('the startle wave: seated fish share the event, offset by seat distance', () => {
    const sp = maneuverSpecOf('startle')!;
    // With seat delays, near and far seats fire the SAME event k at times
    // differing by exactly their delay difference.
    const probe = (delay: number) => {
      for (let t = 0; t < sp.interval * 2; t += 0.05) {
        if (maneuverAt(sp, 3, t, 1, 1, delay).side !== 0) return t;
      }
      return -1;
    };
    const near = probe(0);
    const far = probe(1.2);
    expect(near).toBeGreaterThanOrEqual(0);
    expect(far).toBeGreaterThanOrEqual(0);
    expect(far - near).toBeCloseTo(1.2, 1);
    // Free fish (null delay) keep their own schedules — no chorus line.
    const t0 = 30;
    const sides = Array.from({ length: 8 }, (_, i) => maneuverAt(sp, i, t0, 1, 1).side);
    const active = sides.filter((x) => Math.abs(x) > 0.05).length;
    expect(active).toBeLessThan(8);
  });
  it('rate above 1 shortens the interval; at or below 1 nothing changed', () => {
    const d = maneuverSpecOf('dart')!;
    // Same instant, higher rate → more completed events accumulated.
    const a1 = maneuverAt(d, 2, 200, 1, 1).along;
    const a3 = maneuverAt(d, 2, 200, 3, 1).along;
    expect(a3).toBeGreaterThan(a1 * 1.5);
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
