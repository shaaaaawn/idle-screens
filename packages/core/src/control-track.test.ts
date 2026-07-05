import { describe, it, expect } from 'vitest';
import { sampleTrack, defaultParams } from './control-track';
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
