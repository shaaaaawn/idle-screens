import { describe, expect, it } from 'vitest';
import { eyeMood, type EyeCue, type EyeState } from './eyes';

const idle: EyeCue = { doing: 'idle', target: null, camera: { fwd: 0, up: 0.2 }, climb: 0 };
const mood = (t: number, slot: number, cue: EyeCue = idle, amount = 1): EyeState =>
  eyeMood(t, slot, cue, amount, { blink: 0, gazeFwd: 0, gazeUp: 0, dilate: 1, widen: 0, expr: 0 });

describe('eye mood', () => {
  it('is pure in (t, slot) and stays inside the eye', () => {
    for (let t = 0; t < 60; t += 0.37) {
      const a = mood(t, 3), b = mood(t, 3);
      expect(a).toEqual(b);
      expect(Math.abs(a.gazeFwd)).toBeLessThanOrEqual(1);
      expect(Math.abs(a.gazeUp)).toBeLessThanOrEqual(1);
      expect(a.blink).toBeGreaterThanOrEqual(0);
      expect(a.blink).toBeLessThanOrEqual(1);
    }
  });

  it('blinks briefly, on a personal clock: mostly open, and two fish are out of step', () => {
    const shut = (slot: number): number[] => Array.from({ length: 1200 }, (_, i) => (mood(i * 0.05, slot).blink > 0.5 ? 1 : 0));
    const a = shut(0), b = shut(1);
    const frac = a.reduce((s: number, v) => s + v, 0) / a.length;
    expect(frac).toBeGreaterThan(0.005);
    expect(frac).toBeLessThan(0.08);
    expect(a).not.toEqual(b);
  });

  it('saccades: holds a point, then darts — most frames the gaze does not move', () => {
    let still = 0;
    for (let i = 0; i < 400; i++) if (Math.abs(mood(20 + i * 0.02, 5).gazeFwd - mood(20 + (i + 1) * 0.02, 5).gazeFwd) < 1e-6) still++;
    expect(still).toBeGreaterThan(280);
  });

  it('means it: looks where it swims, at who it faces, wide for a hop, shut for a rest', () => {
    expect(mood(3.3, 2, { ...idle, doing: 'moving', climb: 1 }).gazeUp).toBeGreaterThan(0.5);
    expect(mood(3.3, 2, { ...idle, target: { fwd: 1, up: -0.6 } }).gazeFwd).toBeGreaterThan(0.6);
    const hop = mood(3.3, 2, { ...idle, doing: 'hop' });
    expect(hop.dilate).toBeGreaterThan(1.3);
    expect(hop.widen).toBe(1);
    expect(hop.expr).toBe(1);
    expect(mood(3.3, 2, { ...idle, doing: 'wiggle' }).expr).toBe(2);
    expect(mood(3.3, 2, { ...idle, doing: 'rest' }).blink).toBeGreaterThan(0.9);
  });

  it('scales to nothing at eyeLife 0', () => {
    const off = mood(3.3, 2, { ...idle, doing: 'hop' }, 0);
    for (const k of ['blink', 'gazeFwd', 'gazeUp', 'widen'] as const) expect(off[k]).toBeCloseTo(0, 9);
    expect(off.dilate).toBeCloseTo(1, 9);
  });
});
