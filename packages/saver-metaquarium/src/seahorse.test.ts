import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3, type Material } from 'three';
import { hasPatch } from './hooks';
import { rigSeahorse, SEAHORSE, SEAHORSE_TAG, seahorsePoint, tailCurl, type SeahorseState } from './seahorse';

// The measured seahorse box in the fish frame: crown at y 25, 52 tall; snout at z 14, 26 deep.
const BOX = [25, 52, 14, 26] as const;
const at = (s: number, f: number, x = 0): Vector3 => new Vector3(x, BOX[0] - s * BOX[1], BOX[2] - f * BOX[3]);
const st = (t: number, amount = 1, phase = 0.4): SeahorseState => ({ t, amount, phase });
type Shader = Parameters<Material['onBeforeCompile']>[0];
const compile = (m: Material): Shader => {
  const sh = { uniforms: {}, vertexShader: 'void main() {\n#include <begin_vertex>\n#include <project_vertex>\n}', fragmentShader: 'void main() {}' } as unknown as Shader;
  m.onBeforeCompile(sh, undefined as never);
  return sh;
};

describe('seahorse rig', () => {
  it('amount 0 is the model at rest, every point', () => {
    for (const s of [0, 0.3, 0.5, 0.7, 0.9, 1]) for (const f of [0, 0.5, 0.8, 1]) {
      const p = at(s, f, 1.5);
      expect(seahorsePoint(p, BOX, st(3.3, 0)).distanceTo(p)).toBeLessThan(1e-9);
    }
  });

  it('the dorsal fin ripples sideways; the snout and belly do not', () => {
    const fin = at(0.55, 0.95), belly = at(0.55, 0.3);
    const xs = (p: Vector3) => Array.from({ length: 40 }, (_, i) => seahorsePoint(p, BOX, st(i * 0.037)).x);
    const spread = (a: number[]) => Math.max(...a) - Math.min(...a);
    expect(spread(xs(fin))).toBeGreaterThan(BOX[1] * 0.05);
    expect(spread(xs(belly))).toBeLessThan(1e-9);
    // Above and below the fin band, nothing flutters either.
    expect(spread(xs(at(0.15, 0.95)))).toBeLessThan(1e-9);
    expect(spread(xs(at(0.9, 0.95)))).toBeLessThan(1e-9);
  });

  it('the tail coils FORWARD about its own root, and more when the animal works', () => {
    const root = at(SEAHORSE.tailBase, SEAHORSE.tailSpine), tip = at(1, SEAHORSE.tailSpine);
    // Measured against the root, so the whole-body rock and nod cancel out.
    const reach = (s: SeahorseState): number => seahorsePoint(tip, BOX, s).z - seahorsePoint(root, BOX, s).z;
    const ts = Array.from({ length: 200 }, (_, i) => i * 0.1);
    const coiled = ts.reduce((best, t) => (tailCurl(st(t)) > tailCurl(st(best)) ? t : best), 0);
    const loose = ts.reduce((best, t) => (tailCurl(st(t)) < tailCurl(st(best)) ? t : best), 0);
    expect(reach(st(coiled))).toBeGreaterThan(reach(st(loose)) + BOX[1] * 0.1);
    expect(reach(st(coiled, 1.9))).toBeGreaterThan(reach(st(coiled, 1)));
    // A curl, not a stretch: the tip keeps its distance from the root.
    const len = (s: SeahorseState) => seahorsePoint(tip, BOX, s).distanceTo(seahorsePoint(root, BOX, s));
    expect(Math.abs(len(st(coiled)) - tip.distanceTo(root))).toBeLessThan(1e-6);
    // Never flung backward far, never folded through the belly.
    for (const t of ts) {
      expect(tailCurl(st(t))).toBeGreaterThan(-0.2);
      expect(tailCurl(st(t))).toBeLessThan(0.75);
    }
  });

  it('two seahorses do not coil in step', () => {
    expect(tailCurl(st(5, 1, 0))).not.toBeCloseTo(tailCurl(st(5, 1, 2.2)), 2);
  });

  it('rigs every mesh of the fish, on materials of its own', () => {
    const group = new Group(), body = new Group(), shared = new MeshBasicMaterial();
    shared.userData.mqOwned = true;
    const a = new Mesh(new BoxGeometry(4, 20, 4), shared), b = new Mesh(new BoxGeometry(4, 20, 4), shared);
    a.position.y = 10; b.position.y = -10;
    body.add(a, b); group.add(body);
    const rig = rigSeahorse(group, body, 1)!;
    expect(rig.meshes).toBe(2);
    expect(a.material).not.toBe(b.material); // the frame is per mesh
    for (const m of [a, b]) expect(hasPatch(m.material as Material, SEAHORSE_TAG)).toBe(true);
    rig.set({ phase: 0, amp: 0.08, bend: 0, t: 2 });
    rig.ensure();
  });

  it('clones a template material instead of patching the one every fish shares, and re-attaches when replaced', () => {
    const group = new Group(), body = new Group(), template = new MeshBasicMaterial(); // not ours: a template's
    const m = new Mesh(new BoxGeometry(4, 40, 4), template);
    body.add(m); group.add(body);
    const rig = rigSeahorse(group, body, 0)!;
    expect(m.material).not.toBe(template);
    expect(hasPatch(template, SEAHORSE_TAG)).toBe(false);
    // Something (tinting, the eye rig) swaps the material: ensure() patches the new one.
    const swapped = new MeshBasicMaterial(); swapped.userData.mqOwned = true;
    m.material = swapped;
    rig.ensure();
    expect(hasPatch(swapped, SEAHORSE_TAG)).toBe(true);
    // A second seahorse on the SAME patched material gets its own copy (its own frame).
    const g2 = new Group(), b2 = new Group(), m2 = new Mesh(new BoxGeometry(4, 40, 4), swapped);
    b2.add(m2); g2.add(b2);
    rigSeahorse(g2, b2, 1);
    expect(m2.material).not.toBe(swapped);
    rig.set({ phase: 0, amp: 0.08, bend: 0 }); // no clock given: t 0, no throw
  });

  it('injects the pose before projection, once, with its uniforms bound to the rig', () => {
    const group = new Group(), body = new Group(), mat = new MeshBasicMaterial(); mat.userData.mqOwned = true;
    const m = new Mesh(new BoxGeometry(4, 40, 4), mat); body.add(m); group.add(body);
    const rig = rigSeahorse(group, body, 0.5)!;
    const sh = compile(m.material as Material);
    expect(sh.vertexShader).toContain('uSeaTo');
    expect(sh.vertexShader.indexOf('uSeaTo * vec4(transformed')).toBeLessThan(sh.vertexShader.indexOf('#include <project_vertex>'));
    expect(sh.vertexShader.split('uniform vec4 uSea;').length).toBe(2); // declared once
    rig.set({ phase: 0, amp: 0.16, bend: 0, t: 3 });
    const u = sh.uniforms as unknown as { uSea: { value: { x: number; y: number; z: number } } };
    expect(u.uSea.value.x).toBe(3);
    expect(u.uSea.value.y).toBeCloseTo(2);
    expect(u.uSea.value.z).toBe(0.5);
  });

  it('a model with no meshes has nothing to rig', () => {
    const group = new Group(), body = new Group(); group.add(body);
    expect(rigSeahorse(group, body, 0)).toBeNull();
  });
});
