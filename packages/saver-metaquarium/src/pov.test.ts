import { describe, expect, it } from 'vitest';
import { POV_EYE_FALLBACK, POV_LOOK, POV_PITCH_MAX, walkerEyeRest, walkerPov, type WalkerPov } from './pov';

const out = (): WalkerPov => ({ y: 0, tx: 0, ty: 0, tz: 0, pitch: 0 });

describe('pov: a walker sees from its own eye', () => {
  it('sits at its screen or eyes, not the top of its bounds (Dot\'s antenna is above its face)', () => {
    // A Dot-like rest pose: feet at 0, antenna tip at 10, the screen's centre at 6.
    expect(walkerEyeRest({ minY: 0, maxY: 10, anchorY: 0, eyes: [6] })).toBe(6);
    // Both eyes count: their mean.
    expect(walkerEyeRest({ minY: 0, maxY: 10, anchorY: 0, eyes: [5, 7] })).toBe(6);
    // Measured from the feet (the anchor), not the model's origin.
    expect(walkerEyeRest({ minY: -2, maxY: 8, anchorY: -2, eyes: [4] })).toBe(6);
  });

  it('falls back to near the top of the model when it names no eyes', () => {
    expect(walkerEyeRest({ minY: 0, maxY: 10, anchorY: 0, eyes: [] })).toBeCloseTo(10 * POV_EYE_FALLBACK);
  });

  it('keeps a mis-measured eye inside the model: never under the floor, never over its top', () => {
    expect(walkerEyeRest({ minY: 0, maxY: 10, anchorY: 0, eyes: [-3] })).toBe(2);
    expect(walkerEyeRest({ minY: 0, maxY: 10, anchorY: 0, eyes: [40] })).toBe(10);
    expect(walkerEyeRest({ minY: 0, maxY: 10, anchorY: 0, eyes: [NaN] })).toBeCloseTo(10 * POV_EYE_FALLBACK);
    expect(walkerEyeRest({ minY: 3, maxY: 3, anchorY: 3, eyes: [3] })).toBe(0);
  });

  it('stands its eye height over its feet and looks level along its heading on flat ground', () => {
    const p = walkerPov(10, -5, 0, 1, 2, 14, () => 2, out());
    expect(p.y).toBe(16);
    expect(p.pitch).toBe(0);
    expect([p.tx, p.ty, p.tz]).toEqual([10, 16, -5 + POV_LOOK]);
    // No seabed at all (a flat floor): level too.
    expect(walkerPov(0, 0, 1, 0, 0, 14, null, out()).pitch).toBe(0);
  });

  it('scales with the walker: twice the size, twice the eye', () => {
    const eye = walkerEyeRest({ minY: 0, maxY: 10, anchorY: 0, eyes: [6] });
    const small = walkerPov(0, 0, 0, 1, 0, eye * 1, null, out()).y;
    const big = walkerPov(0, 0, 0, 1, 0, eye * 2, null, out()).y;
    expect(big).toBeCloseTo(small * 2);
  });

  it('pitches up a hill and down into a dip, by the ground\'s own slope', () => {
    const ramp = (s: number) => (_x: number, z: number): number => s * z;
    const up = walkerPov(0, 0, 0, 1, 0, 14, ramp(0.15), out());
    const down = walkerPov(0, 0, 0, -1, 0, 14, ramp(0.15), out());
    expect(up.pitch).toBeCloseTo(Math.atan(0.15));
    expect(down.pitch).toBeCloseTo(-Math.atan(0.15));
    // The look rises with it: the far end of the path stays in frame.
    expect(up.ty).toBeCloseTo(14 + 0.15 * POV_LOOK);
    // Sideways to the slope it looks level.
    expect(walkerPov(0, 0, 1, 0, 0, 14, ramp(0.15), out()).pitch).toBeCloseTo(0);
  });

  it('holds its pitch on a cliff', () => {
    const cliff = (_x: number, z: number): number => (z > 10 ? 200 : 0);
    expect(walkerPov(0, 0, 0, 1, 0, 14, cliff, out()).pitch).toBe(POV_PITCH_MAX);
    expect(walkerPov(0, 20, 0, -1, 200, 14, cliff, out()).pitch).toBe(-POV_PITCH_MAX);
  });

  it('measures the slope from the ground under it, not its feet: a jetting octopus looks level over flat sand', () => {
    const p = walkerPov(0, 0, 0, 1, 30, 8, () => 0, out());
    expect(p.y).toBe(38);
    expect(p.pitch).toBe(0);
    expect(p.ty).toBe(38);
  });

  it('keeps its pitch from a lifted eye (the camera held over scenery)', () => {
    const ramp = (_x: number, z: number): number => 0.1 * z;
    const p = walkerPov(0, 0, 0, 1, 0, 14, ramp, out(), 25);
    expect(p.y).toBe(25);
    expect(p.ty).toBeCloseTo(25 + 0.1 * POV_LOOK);
  });
});
