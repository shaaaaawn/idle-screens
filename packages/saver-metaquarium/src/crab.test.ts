import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3, type Material } from 'three';
import { CRAB, CRAB_TAG, crabPoint, rigCrab, type CrabState } from './crab';
import { hasPatch } from './hooks';

// A crab box in the fish frame: x from -20 (back) 40 long, y from 0 up 20, z centred on 0, 24 to a side.
const BOX = [-20, 40, 0, 20, 0, 24] as const;
const at = (u: number, up: number, lat: number, side = 1): Vector3 => new Vector3(BOX[0] + u * BOX[1], BOX[2] + up * BOX[3], side * lat * BOX[5]);
const st = (gait: number, t = 0, amount = 1): CrabState => ({ gait, t, amount, phase: 0.3 });
type Shader = Parameters<Material['onBeforeCompile']>[0];
const compile = (m: Material): Shader => {
  const sh = { uniforms: {}, vertexShader: 'void main() {\n#include <begin_vertex>\n#include <project_vertex>\n}', fragmentShader: 'void main() {}' } as unknown as Shader;
  m.onBeforeCompile(sh, undefined as never);
  return sh;
};

describe('crab rig', () => {
  it('amount 0 is the model at rest', () => {
    for (const u of [0.1, 0.5, 0.9]) for (const lat of [0.1, 0.5, 0.9]) {
      const p = at(u, 0.2, lat);
      expect(crabPoint(p, BOX, st(2.1, 1.3, 0)).distanceTo(p)).toBeLessThan(1e-9);
    }
  });

  it('legs step: a leg tip lifts and reaches; the body barely moves', () => {
    const tip = at(0.3, 0.1, 0.95), body = at(0.4, 0.5, 0.1);
    const path = (p: Vector3) => Array.from({ length: 24 }, (_, i) => crabPoint(p, BOX, st((i / 24) * Math.PI * 2)));
    const spread = (ps: Vector3[], k: 'y' | 'z') => Math.max(...ps.map((q) => q[k])) - Math.min(...ps.map((q) => q[k]));
    expect(spread(path(tip), 'y')).toBeGreaterThan(BOX[3] * 0.1); // lifts
    expect(spread(path(tip), 'z')).toBeGreaterThan(BOX[5] * 0.2); // reaches along the travel
    expect(spread(path(body), 'y')).toBeLessThan(BOX[3] * 0.06); //  the bob only
    // A foot never sinks below its rest height: it lifts, then plants.
    expect(Math.min(...path(tip).map((q) => q.y))).toBeGreaterThanOrEqual(tip.y + 0 - 1e-9);
  });

  it('the two sides walk in opposite phase, and the gait is distance, not time', () => {
    const left = at(0.3, 0.1, 0.95, -1), right = at(0.3, 0.1, 0.95, 1);
    const g = Math.PI / 2 - Math.floor(0.3 * 4) * (Math.PI / 2); // left side at the top of its lift
    const ly = crabPoint(left, BOX, st(g)).y - left.y, ry = crabPoint(right, BOX, st(g)).y - right.y;
    expect(ly).toBeGreaterThan(ry + BOX[3] * 0.1);
    // Same distance walked, same stance, whatever the clock says (claws aside).
    expect(crabPoint(right, BOX, st(1.1, 0)).distanceTo(crabPoint(right, BOX, st(1.1, 50)))).toBeLessThan(1e-9);
  });

  it('the claws work on their own clock', () => {
    const claw = at(0.95, 0.6, 0.6);
    const ys = Array.from({ length: 30 }, (_, i) => crabPoint(claw, BOX, st(0, i * 0.2)).y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(BOX[3] * 0.08);
    expect(CRAB.clawFrom).toBeGreaterThan(0.5);
  });

  it('rigs every mesh once, finds its claws by name, and binds its uniforms', () => {
    const body = new Group();
    const shell = new Mesh(new BoxGeometry(24, 12, 30), new MeshBasicMaterial({ name: 'PrimaryColor' }));
    const claws = new Mesh(new BoxGeometry(8, 6, 8), new MeshBasicMaterial({ name: 'GLOW-claws' }));
    claws.position.set(-16, 2, 0); // claws at -x: the rig must read the box from the other end
    body.add(shell, claws);
    const group = new Group(); group.add(body);
    const rig = rigCrab(group, body, 0.5)!;
    expect(rig.meshes).toBe(2);
    for (const m of [shell, claws]) expect(hasPatch(m.material as Material, CRAB_TAG)).toBe(true);
    const sh = compile(claws.material as Material);
    expect(sh.vertexShader).toContain('uCrabTo');
    const boxA = (sh.uniforms as Record<string, { value: Vector3 }>).uCrabBoxA!.value;
    expect(boxA.y).toBeLessThan(0); // read back to front from +x
    rig.set({ phase: 1, amp: 0, bend: 0, t: 2 });
    const crab = (sh.uniforms as Record<string, { value: { x: number; y: number; z: number } }>).uCrab!.value;
    expect(crab.x).toBeCloseTo(1 * CRAB.stepsPerStride);
    expect(crab.z).toBe(1); // a crab always walks with the same will
    rig.ensure();
    // Where it stands: the bottom of its box, the middle and size of its footprint, in the group's units.
    group.scale.setScalar(2); group.position.set(5, 9, 0);
    const scaled = rigCrab(group, body, 0)!;
    expect(rig.foot).toBeCloseTo(-6);
    expect(scaled.foot).toBeCloseTo(-6); // the group's own scale and place do not change it
    expect(rig.middle.x).toBeCloseTo((-20 + 12) / 2);
    expect(rig.middle.z).toBeCloseTo(0);
    expect(rig.span).toEqual({ x: 32, z: 30 });
    expect(rigCrab(new Group(), new Group(), 0)).toBeNull();
  });

  it('clones a material it does not own or that two meshes share, so one crab never moves another', () => {
    const shared = new MeshBasicMaterial({ name: 'SecondaryColor' });
    shared.userData.mqOwned = true;
    const a = new Mesh(new BoxGeometry(10, 4, 30), shared), b = new Mesh(new BoxGeometry(6, 4, 6), shared);
    const borrowed = new Mesh(new BoxGeometry(4, 4, 4), new MeshBasicMaterial({ name: 'EYES-Black' }));
    const body = new Group(); body.add(a, b, borrowed);
    const group = new Group(); group.add(body);
    rigCrab(group, body, 0)!;
    expect(a.material).toBe(shared); //        owned, first use: patched in place
    expect(b.material).not.toBe(shared); //    shared: its own copy
    expect((borrowed.material as Material).userData.mqOwned).toBe(true); // borrowed: cloned and owned
    // With no claws named, the front is +x.
    const sh = compile(a.material as Material);
    expect((sh.uniforms as Record<string, { value: Vector3 }>).uCrabBoxA!.value.y).toBeGreaterThan(0);
  });
});
