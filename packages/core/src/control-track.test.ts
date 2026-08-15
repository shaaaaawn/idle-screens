import { describe, it, expect } from 'vitest';
import { sampleTrack, defaultParams, integrateParam } from './control-track';
import type { ControlTrack, ParamSpace } from './types';

const track = (deltas: ControlTrack['deltas'], extra: Partial<ControlTrack> = {}): ControlTrack => ({
  program: 't',
  seed: 1,
  deltas,
  ...extra,
});

const numSpace = (ease?: ParamSpace[string]['ease']): ParamSpace => ({
  x: { type: 'number', default: 0, ease },
});

describe('defaultParams (C1)', () => {
  it('returns each declared default', () => {
    expect(defaultParams({ a: { type: 'number', default: 3 }, b: { type: 'bool', default: true } })).toEqual({
      a: 3,
      b: true,
    });
  });
});

describe('sampleTrack', () => {
  it('C2: empty track yields defaults at any t', () => {
    const s: ParamSpace = { y: { type: 'number', default: 5 } };
    expect(sampleTrack(s, track([]), 0).y).toBe(5);
    expect(sampleTrack(s, track([]), 9999).y).toBe(5);
  });

  it('C3: pure — identical inputs yield identical output', () => {
    const t = track([{ t: 0, path: 'x', value: 0 }, { t: 1000, path: 'x', value: 10 }]);
    expect(sampleTrack(numSpace(), t, 500)).toEqual(sampleTrack(numSpace(), t, 500));
  });

  it('C4: before the first delta of a path → default', () => {
    const t = track([{ t: 500, path: 'x', value: 10 }]);
    expect(sampleTrack(numSpace(), t, 0).x).toBe(0);
    expect(sampleTrack(numSpace(), t, 499).x).toBe(0);
  });

  it('C5: after the last delta → held value', () => {
    const t = track([{ t: 0, path: 'x', value: 0 }, { t: 1000, path: 'x', value: 10 }]);
    expect(sampleTrack(numSpace(), t, 1000).x).toBe(10);
    expect(sampleTrack(numSpace(), t, 99999).x).toBe(10);
  });

  it('C6: linear ease interpolates proportionally between deltas', () => {
    const t = track([{ t: 0, path: 'x', value: 0 }, { t: 1000, path: 'x', value: 10 }]);
    expect(sampleTrack(numSpace('linear'), t, 250).x).toBeCloseTo(2.5);
    expect(sampleTrack(numSpace('linear'), t, 500).x).toBeCloseTo(5);
    expect(sampleTrack(numSpace('linear'), t, 750).x).toBeCloseTo(7.5);
  });

  it('C7: smooth ease uses smoothstep (differs from linear off the midpoint)', () => {
    const t = track([{ t: 0, path: 'x', value: 0 }, { t: 1000, path: 'x', value: 10 }]);
    // smoothstep(0.25) = 0.25^2 * (3 - 0.5) = 0.15625 -> 1.5625 (linear would be 2.5)
    expect(sampleTrack(numSpace('smooth'), t, 250).x).toBeCloseTo(1.5625, 4);
    // symmetric at the ends and midpoint
    expect(sampleTrack(numSpace('smooth'), t, 500).x).toBeCloseTo(5);
    expect(sampleTrack(numSpace('smooth'), t, 0).x).toBe(0);
    expect(sampleTrack(numSpace('smooth'), t, 1000).x).toBe(10);
  });

  it('C8: step ease holds the previous value until exactly the delta t', () => {
    const t = track([{ t: 0, path: 'x', value: 0 }, { t: 1000, path: 'x', value: 10 }]);
    expect(sampleTrack(numSpace('step'), t, 1).x).toBe(0);
    expect(sampleTrack(numSpace('step'), t, 999).x).toBe(0);
    expect(sampleTrack(numSpace('step'), t, 1000).x).toBe(10);
  });

  it('C9: dur sets the ramp window [k.t - dur, k.t]; flat before it', () => {
    const t = track([
      { t: 0, path: 'x', value: 0 },
      { t: 1000, path: 'x', value: 10, dur: 200, ease: 'linear' },
    ]);
    expect(sampleTrack(numSpace(), t, 500).x).toBe(0); // before ramp start (800)
    expect(sampleTrack(numSpace(), t, 800).x).toBe(0); // at ramp start
    expect(sampleTrack(numSpace(), t, 900).x).toBeCloseTo(5); // midway through ramp
    expect(sampleTrack(numSpace(), t, 1000).x).toBe(10);
  });

  it('C10: color params lerp per channel in hex', () => {
    const cspace: ParamSpace = { c: { type: 'color', default: '#000000', ease: 'linear' } };
    expect(
      sampleTrack(cspace, track([{ t: 0, path: 'c', value: '#000000' }, { t: 100, path: 'c', value: '#ffffff' }]), 50).c,
    ).toBe('#808080');
    expect(
      sampleTrack(cspace, track([{ t: 0, path: 'c', value: '#ff0000' }, { t: 100, path: 'c', value: '#0000ff' }]), 50).c,
    ).toBe('#800080');
  });

  it('C11: bool/enum params switch at the delta, no blending', () => {
    const bspace: ParamSpace = { b: { type: 'bool', default: false, ease: 'linear' } };
    const bt = track([{ t: 100, path: 'b', value: true }]);
    expect(sampleTrack(bspace, bt, 50).b).toBe(false);
    expect(sampleTrack(bspace, bt, 100).b).toBe(true);

    const espace: ParamSpace = { e: { type: 'enum', default: 'a', options: ['a', 'b'], ease: 'linear' } };
    const et = track([{ t: 100, path: 'e', value: 'b' }]);
    expect(sampleTrack(espace, et, 50).e).toBe('a');
    expect(sampleTrack(espace, et, 100).e).toBe('b');
  });

  it('C11b: string params switch at the delta, no blending', () => {
    const sspace: ParamSpace = { s: { type: 'string', default: '0xabc', ease: 'linear' } };
    const st = track([{ t: 100, path: 's', value: '0xdef' }]);
    expect(sampleTrack(sspace, st, 50).s).toBe('0xabc');
    expect(sampleTrack(sspace, st, 100).s).toBe('0xdef');
    expect(sampleTrack(sspace, st, 9999).s).toBe('0xdef');
  });

  it('C12: loop + duration wraps t; no wrap without both', () => {
    const t = track([{ t: 0, path: 'x', value: 0 }, { t: 1000, path: 'x', value: 10 }]);
    const looped = track(t.deltas, { loop: true, duration: 1000 });
    expect(sampleTrack(numSpace(), looped, 1500).x).toBeCloseTo(5); // 1500 % 1000 = 500
    expect(sampleTrack(numSpace(), looped, 2000).x).toBe(0); // wraps to 0
    // without loop, past the end holds the last value
    expect(sampleTrack(numSpace(), t, 1500).x).toBe(10);
  });

  it('C13: deltas are grouped per path and sorted by t regardless of input order', () => {
    const space: ParamSpace = {
      x: { type: 'number', default: 0, ease: 'linear' },
      y: { type: 'number', default: 0, ease: 'linear' },
    };
    const t = track([
      { t: 1000, path: 'x', value: 10 },
      { t: 500, path: 'y', value: 4 },
      { t: 0, path: 'x', value: 0 },
      { t: 0, path: 'y', value: 0 },
    ]);
    const out = sampleTrack(space, t, 500);
    expect(out.x).toBeCloseTo(5); // x sorted 0->1000, midpoint
    expect(out.y).toBe(4); // y held after its last delta at t=500
  });
});

describe('integrateParam', () => {
  const space = (ease: 'step' | 'linear' | 'smooth' = 'linear'): ParamSpace => ({
    speed: { type: 'number', default: 1, min: 0.2, max: 3, ease },
  });

  /** Midpoint-rule numeric integral of the curve sampleTrack actually emits —
   *  the oracle every closed-form case must match. */
  const numeric = (sp: ParamSpace, t: ControlTrack, T: number, dt = 0.5): number => {
    let acc = 0;
    for (let tau = 0; tau < T; tau += dt) {
      const v = sampleTrack(sp, t, Math.min(tau + dt / 2, T)).speed;
      acc += (typeof v === 'number' ? v : 0) * Math.min(dt, T - tau);
    }
    return acc;
  };

  const cases: Array<[string, ParamSpace, ControlTrack, number]> = [
    ['no deltas holds the default', space(), track([]), 4000],
    ['single step delta', space(), track([{ t: 1000, path: 'speed', value: 2, ease: 'step' }]), 3000],
    ['linear ramp from previous keyframe', space(), track([
      { t: 500, path: 'speed', value: 2 },
      { t: 2000, path: 'speed', value: 0.5 },
    ]), 3000],
    ['smooth ramp with dur', space('smooth'), track([
      { t: 1500, path: 'speed', value: 3, dur: 800 },
    ]), 2500],
    ['dur overlapping the previous keyframe (mid-ease jump)', space(), track([
      { t: 1000, path: 'speed', value: 2 },
      { t: 1400, path: 'speed', value: 0.4, dur: 900 },
    ]), 2200],
    ['mixed eases across several keyframes', space(), track([
      { t: 400, path: 'speed', value: 2, ease: 'smooth', dur: 400 },
      { t: 1200, path: 'speed', value: 0.5, ease: 'step' },
      { t: 2000, path: 'speed', value: 1.5, ease: 'linear' },
    ]), 2600],
  ];

  for (const [name, sp, t, T] of cases) {
    it(`matches numeric integration: ${name}`, () => {
      const exact = integrateParam(sp, t, 'speed', T);
      const approx = numeric(sp, t, T);
      expect(exact).toBeCloseTo(approx, 0);
      // and a mid-curve point, not just the endpoint
      expect(integrateParam(sp, t, 'speed', T * 0.37)).toBeCloseTo(numeric(sp, t, T * 0.37), 0);
    });
  }

  it('loop wrap: n full loops plus remainder', () => {
    const t = track(
      [{ t: 500, path: 'speed', value: 2, ease: 'step' }],
      { duration: 1000, loop: true },
    );
    const one = integrateParam(space(), t, 'speed', 1000);
    expect(one).toBeCloseTo(0.5 * 1000 * 1 + 0.5 * 1000 * 2, 5);
    expect(integrateParam(space(), t, 'speed', 3250)).toBeCloseTo(3 * one + integrateParam(space(), t, 'speed', 250), 5);
    expect(integrateParam(space(), t, 'speed', 3250)).toBeCloseTo(numeric(space(), t, 3250), 0);
  });

  it('is monotone non-decreasing for a non-negative curve', () => {
    const t = track([
      { t: 300, path: 'speed', value: 3, dur: 200 },
      { t: 900, path: 'speed', value: 0.2, ease: 'smooth' },
    ]);
    let prev = 0;
    for (let ms = 0; ms <= 2000; ms += 50) {
      const v = integrateParam(space(), t, 'speed', ms);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  it('coerces finite numeric strings and skips junk values', () => {
    const clean = track([{ t: 1000, path: 'speed', value: 2.5, ease: 'step' }]);
    const stringy = track([{ t: 1000, path: 'speed', value: '2.5', ease: 'step' }]);
    const junk = track([{ t: 1000, path: 'speed', value: 'fast', ease: 'step' }]);
    expect(integrateParam(space(), stringy, 'speed', 2000)).toBeCloseTo(
      integrateParam(space(), clean, 'speed', 2000), 9);
    // junk keyframe behaves as absent: the default integrates throughout
    expect(integrateParam(space(), junk, 'speed', 2000)).toBeCloseTo(2000, 9);
  });

  it('non-number params integrate their numeric default (or zero)', () => {
    const sp: ParamSpace = { label: { type: 'string', default: 'hi' } };
    expect(integrateParam(sp, track([]), 'label', 1000)).toBe(0);
    expect(integrateParam(sp, track([]), 'missing', 1000)).toBe(0);
  });
});
