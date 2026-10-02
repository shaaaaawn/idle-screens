import { BoxGeometry, BufferAttribute, BufferGeometry, PlaneGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { stoneTop } from './ground';

const box = (w: number, h: number, d: number, x: number, y: number, z: number): BufferGeometry =>
  new BoxGeometry(w, h, d).translate(x, y, z);

describe('stone top (ground.ts)', () => {
  it('reads a block as its top, and nothing off it', () => {
    const g = stoneTop([box(20, 6, 20, 30, 3, -10)])!;
    expect(g(30, -10)).toBeCloseTo(6, 6);
    expect(g(38, -2)).toBeCloseTo(6, 6);
    expect(g(80, 80)).toBe(-Infinity);
    expect(g(-60, -10)).toBe(-Infinity);
  });

  it('keeps the highest surface where stones stack, and follows a slope', () => {
    const ramp = new BufferGeometry();
    // One upward triangle rising along +x: y = x / 4 over x 0..20.
    ramp.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, -10, 0, 0, 10, 20, 5, 0]), 3));
    const g = stoneTop([box(10, 2, 10, 0, 1, 0), box(4, 8, 4, 0, 4, 0), ramp])!;
    expect(g(0, 0)).toBeCloseTo(8, 6);
    expect(g(4, 0)).toBeCloseTo(2, 1); // the low block; the ramp is below it here
    expect(g(16, 0)).toBeCloseTo(4, 1); // the ramp alone
  });

  it('is no floor under an overhang or on a sheer face', () => {
    // A plane rotated to face DOWN, and one standing on its edge.
    const ceiling = new PlaneGeometry(10, 10).rotateX(Math.PI / 2).translate(0, 9, 0);
    const wall = new PlaneGeometry(10, 10).translate(30, 5, 0);
    const g = stoneTop([ceiling, wall])!;
    expect(g(0, 0)).toBe(-Infinity);
    expect(g(30, 0)).toBe(-Infinity);
  });

  it('has nothing to say about no stone', () => {
    expect(stoneTop([])).toBeNull();
  });
});
