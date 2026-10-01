import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Quaternion, Vector3, type Material } from 'three';
import { ContactShadows, contactShade, WalkGround } from './walker';

/** A solid slab: `w` wide (x and z), from `y0` up to `y1`, centred on (x, z). */
const slab = (x: number, z: number, w: number, y0: number, y1: number, material: Material = new MeshBasicMaterial()): Mesh => {
  const m = new Mesh(new BoxGeometry(w, y1 - y0, w), material);
  m.position.set(x, (y0 + y1) / 2, z);
  return m;
};
const flat = (): number => 0;

describe('walk ground', () => {
  it('with nothing on the floor, the ground is the terrain', () => {
    const g = new WalkGround([], (x) => x * 0.1);
    expect(g.solids).toBe(0);
    expect(g.at(30, 0, 0, 5)).toBeCloseTo(3);
  });

  it('a walker steps up onto a rock within a step, and walks through one taller than that', () => {
    const room = new Group(); room.add(slab(0, 0, 20, 0, 4));
    const g = new WalkGround([room], flat);
    expect(g.solids).toBe(1);
    expect(g.at(0, 0, 0, 6)).toBeCloseTo(4); //  on top of it
    expect(g.at(0, 0, 0, 2)).toBeCloseTo(0); //  too tall a step: through it
    expect(g.at(40, 0, 4, 6)).toBeCloseTo(0); // off it, back on the sand
  });

  it('under an arch it stays on the ground, not the roof', () => {
    const room = new Group(); room.add(slab(0, 0, 20, 0, 3), slab(0, 0, 20, 30, 32));
    const g = new WalkGround([room], flat);
    expect(g.at(0, 0, 0, 6)).toBeCloseTo(3);
    expect(g.at(0, 0, 3, 6)).toBeCloseTo(3); // still not the roof, 27 overhead
  });

  it('passes through plants and light: soft and see-through things are not ground', () => {
    const leaf = new MeshBasicMaterial(), glow = new MeshBasicMaterial({ transparent: true });
    const room = new Group(); room.add(slab(0, 0, 20, 0, 4, leaf), slab(40, 0, 20, 0, 4, glow));
    const g = new WalkGround([room], flat, { soft: new Set([leaf]) });
    expect(g.solids).toBe(0);
    expect(g.at(0, 0, 0, 6)).toBe(0);
    expect(g.at(40, 0, 0, 6)).toBe(0);
  });

  it('casts each cell once, and ramps between cells instead of stepping', () => {
    const room = new Group(); room.add(slab(0, 0, 3, 0, 4)); // covers the cell at 0 only
    const g = new WalkGround([room], flat, { cell: 2 });
    const mid = g.at(1, 0, 0, 6);
    expect(mid).toBeGreaterThan(0.5);
    expect(mid).toBeLessThan(3.5); // halfway up the ramp to the next cell
    const cast = g.cast;
    g.at(1, 0, 0, 6);
    expect(g.cast).toBe(cast);
  });
});

describe('contact shadows', () => {
  it('dark under the body and out to the feet, gone just past them', () => {
    expect(contactShade(0)).toBe(1);
    expect(contactShade(0.4)).toBe(1);
    expect(contactShade(0.75)).toBeGreaterThan(0.3);
    expect(contactShade(1)).toBe(0);
    for (let r = 0; r < 1; r += 0.05) expect(contactShade(r + 0.05)).toBeLessThanOrEqual(contactShade(r));
  });

  it('places one per walker and draws only the ones set', () => {
    const s = new ContactShadows(2);
    expect(s.mesh.count).toBe(0);
    s.set(0, 1, 2, 3, new Quaternion(), 10, 8);
    s.set(5, 0, 0, 0, new Quaternion(), 1, 1); // past capacity: ignored
    s.commit(3);
    expect(s.mesh.count).toBe(2);
    const at = new Vector3(), m = s.mesh.instanceMatrix.array;
    at.set(m[12]!, m[13]!, m[14]!);
    expect(at.toArray()).toEqual([1, 2, 3]);
    expect(m[0]).toBeCloseTo(10);
    expect(m[10]).toBeCloseTo(8);
    expect((s.mesh.material as Material).userData.mqOwned).toBe(true);
  });
});
