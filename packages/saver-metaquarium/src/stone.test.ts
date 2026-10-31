import { Color, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { STONE_STYLES, weathered } from './stone';
import { METAQUARIUM_PARAMS } from './manifest';
import { PARAM_DOCS } from './guide';

const lum = (c: Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

describe('stoneStyle', () => {
  it('is classic by default, and documented', () => {
    expect(METAQUARIUM_PARAMS.stoneStyle).toMatchObject({ type: 'enum', default: 'classic', options: [...STONE_STYLES] });
    expect(PARAM_DOCS.stoneStyle).toMatch(/weathered/);
  });

  it('lifts a face turned from the light out of the black', () => {
    // The classic stone's darkest face: #2b3546 × 0.4 × 1.5.
    const dark = new Color('#2b3546').multiplyScalar(0.6);
    const w = weathered(dark.clone(), 0, new Vector3(1, 2, 3));
    expect(lum(w)).toBeGreaterThan(lum(dark) * 2.5);
    expect(w.getHexString()).not.toBe(dark.getHexString());
  });

  it('settles silt on the tops only, and shades each facet a little apart, from where it is', () => {
    const base = new Color('#2b3546');
    const side = weathered(base.clone(), 0.2, new Vector3(5, 0, 5)), top = weathered(base.clone(), 1, new Vector3(5, 0, 5));
    expect(top.r).toBeGreaterThan(side.r * 1.5); // silt is warm and light
    const a = weathered(base.clone(), 0.2, new Vector3(5, 0, 5)), b = weathered(base.clone(), 0.2, new Vector3(-7, 3, 1));
    expect(a.equals(side)).toBe(true); // the same facet, the same shade: no rng
    expect(a.equals(b)).toBe(false);
  });
});
