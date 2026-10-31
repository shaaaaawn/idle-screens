import { BufferAttribute, BufferGeometry, Color, Group, Matrix4, Mesh, MeshLambertMaterial, ShaderLib, ShaderMaterial, type Material } from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { describe, expect, it } from 'vitest';
import { bakeFishOcclusion, FISH_AO, fishOcclusion, patchFishAO, voxelStep, type FishPart } from './fish-ao';
import { CubeWriter } from './scenery-paint';

/** Unit-step cubes at integer cells, as one non-indexed part (CubeWriter's outward winding), with optional jitter. */
function part(cells: Array<[number, number, number]>, step = 1, jitter = 0): FishPart & { pos: number[] } {
  const w = new CubeWriter();
  for (const [x, y, z] of cells) w.cube(x * step, y * step, z * step, step, step, step, new Color(1, 1, 1));
  const pos = w.pos.map((v, i) => v + (jitter ? Math.sin(i * 12.9898) * jitter : 0));
  return { pos, index: null };
}

/** Occlusion of the vertices at `at` on faces whose outward normal is +y. */
function topAt(p: { pos: number[] }, occ: Float32Array, at: [number, number, number], step = 1): number[] {
  const out: number[] = [];
  for (let t = 0; t < p.pos.length / 9; t += 1) {
    const v = [0, 1, 2].map((i) => t * 3 + i);
    const P = (i: number, a: number): number => p.pos[i * 3 + a]!;
    const ny = (P(v[1]!, 2) - P(v[0]!, 2)) * (P(v[2]!, 0) - P(v[0]!, 0)) - (P(v[1]!, 0) - P(v[0]!, 0)) * (P(v[2]!, 2) - P(v[0]!, 2));
    if (!(ny > 0)) continue;
    for (const i of v) if ([0, 1, 2].every((a) => Math.abs(P(i, a) - at[a]! * step) < 0.01 * step)) out.push(occ[i]!);
  }
  return out;
}

describe('fish occlusion', () => {
  it('finds the voxel step through Draco-sized jitter', () => {
    expect(voxelStep([part([[0, 0, 0], [1, 0, 0], [0, 1, 0]], 0.25, 2e-5)])).toBeCloseTo(0.25, 3);
  });

  it('leaves a lone cube open', () => {
    const p = part([[0, 0, 0]]);
    expect(Math.max(...fishOcclusion([p])[0]!)).toBe(0);
  });

  it('darkens an inside edge and corner, and not the open far side', () => {
    // A 3×3 floor with a wall along +x and a wall along +z: the floor's inside corner at (0.5, 0.5, 0.5).
    const cells: Array<[number, number, number]> = [];
    for (let x = -1; x <= 1; x += 1) for (let z = -1; z <= 1; z += 1) cells.push([x, 0, z]);
    cells.push([1, 1, -1], [1, 1, 0], [1, 1, 1], [-1, 1, 1], [0, 1, 1]);
    const p = part(cells), occ = fishOcclusion([p])[0]!;
    expect(Math.max(...topAt(p, occ, [0.5, 0.5, 0.5]))).toBe(1); // inside corner: three cells
    expect(Math.max(...topAt(p, occ, [0.5, 0.5, -0.5]))).toBeCloseTo(0.48 / 0.62, 5); // along the +x wall: two
    expect(Math.max(...topAt(p, occ, [-0.5, 0.5, -0.5]))).toBe(0); // the open far corner
  });

  it('reads a fish split across materials as one body', () => {
    // A head cube (one material) on a body slab (another): the slab's top around the head darkens.
    const body = part([[-1, 0, 0], [0, 0, 0], [1, 0, 0]]), head = part([[0, 1, 0]]);
    const [occBody] = fishOcclusion([body, head]);
    expect(Math.max(...topAt(body, occBody!, [0.5, 0.5, 0.5]))).toBeGreaterThan(0);
    // Without the head the same top face is open. (CubeWriter draws the hidden faces between cubes too; those darken, unseen.)
    expect(Math.max(...topAt(body, fishOcclusion([body])[0]!, [0.5, 0.5, 0.5]))).toBe(0);
  });

  it('works in the fish\'s common space when a part carries its own transform', () => {
    const body = part([[-1, 0, 0], [0, 0, 0], [1, 0, 0]]);
    // The head drawn at the origin, placed by its node one cell up.
    const head = { ...part([[0, 0, 0]]), matrix: new Matrix4().makeTranslation(0, 1, 0) };
    const [occBody] = fishOcclusion([body, head]);
    expect(Math.max(...topAt(body, occBody!, [0.5, 0.5, 0.5]))).toBeGreaterThan(0);
  });

  it('bakes each geometry once, and patches only the fish\'s lit coats', () => {
    const fish = new Group();
    const geo = (p: FishPart & { pos: number[] }): BufferGeometry => { const g = new BufferGeometry(); g.setAttribute('position', new BufferAttribute(new Float32Array(p.pos), 3)); return g; };
    const coat = new MeshLambertMaterial(); coat.userData.mqFish = true;
    const glow = new MeshLambertMaterial();
    const a = new Mesh(geo(part([[0, 0, 0], [1, 0, 0]])), coat), b = new Mesh(geo(part([[0, 1, 0]])), glow);
    fish.add(a, b);
    expect(bakeFishOcclusion(fish)).toBe(true);
    expect(a.geometry.getAttribute('aMqFishOcc').count).toBe(a.geometry.getAttribute('position').count);
    expect(bakeFishOcclusion(fish)).toBe(false);
    expect(patchFishAO(coat)).toBe(true);
    expect(patchFishAO(glow)).toBe(false);
    const s = { uniforms: {} as Record<string, unknown>, vertexShader: ShaderLib.lambert.vertexShader, fragmentShader: ShaderLib.lambert.fragmentShader };
    (coat as Material).onBeforeCompile(s as never, null as never);
    expect(s.uniforms.uMqFishAO).toBe(FISH_AO);
    expect(s.fragmentShader).toMatch(/diffuseColor\.rgb \*= 1\.0 - 0\.62 \* uMqFishAO \* vMqFishOcc;/);
  });

  it('reads indexed geometry, as a GLB carries it, the same as unrolled', () => {
    const cells: Array<[number, number, number]> = [[-1, 0, 0], [0, 0, 0], [1, 0, 0], [0, 1, 0]];
    const flat = part(cells), g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(flat.pos), 3));
    const indexed = mergeVertices(g);
    const occIdx = fishOcclusion([{ pos: indexed.getAttribute('position').array, index: indexed.index!.array }])[0]!;
    // A shared vertex takes the darkest of its faces; the step at the head's foot is dark either way.
    expect(Math.max(...occIdx)).toBeCloseTo(Math.max(...fishOcclusion([flat])[0]!), 5);
  });

  it('gives no occlusion to a mesh with no axis-aligned faces', () => {
    const tilted = { pos: [0, 0, 0, 1, 0.3, 0, 0, 1, 0.7], index: null };
    expect(Array.from(fishOcclusion([tilted])[0]!)).toEqual([0, 0, 0]);
  });

  it('bakes only the meshes still missing it, and leaves shader materials without the chunks alone', () => {
    const fish = new Group();
    const geo = (cells: Array<[number, number, number]>): BufferGeometry => { const g = new BufferGeometry(); g.setAttribute('position', new BufferAttribute(new Float32Array(part(cells).pos), 3)); return g; };
    const done = new Mesh(geo([[0, 0, 0]]), new MeshLambertMaterial()), late = new Mesh(geo([[0, 1, 0]]), new MeshLambertMaterial());
    done.geometry.userData.mqFishOcc = true;
    fish.add(done, late);
    expect(bakeFishOcclusion(fish)).toBe(true);
    expect(done.geometry.getAttribute('aMqFishOcc')).toBeUndefined();
    expect(late.geometry.getAttribute('aMqFishOcc')).toBeDefined();
    const raw = new ShaderMaterial({ vertexShader: 'void main(){}', fragmentShader: 'void main(){}' }); raw.userData.mqFish = true;
    patchFishAO(raw);
    const r = { uniforms: {} as Record<string, unknown>, vertexShader: 'void main(){}', fragmentShader: 'void main(){}' };
    raw.onBeforeCompile(r as never, null as never);
    expect(r.uniforms.uMqFishAO).toBeUndefined();
    expect(bakeFishOcclusion(new Group())).toBe(false);
  });
});
