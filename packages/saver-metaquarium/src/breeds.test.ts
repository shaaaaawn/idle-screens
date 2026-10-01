import { NodeIO } from '@gltf-transform/core';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUNDLED_BREEDS } from './breeds';
import { NPC_CATALOG } from './ipfs';

const here = (p: string): URL => new URL(p, import.meta.url);
const manifest = JSON.parse(readFileSync(here('../breeds/breeds.json'), 'utf8')) as { breeds: Record<string, { kind: string }> };

/** The JSON chunk of a GLB. */
function gltfJson(bytes: Uint8Array): { extensionsUsed?: string[]; materials?: { name?: string }[]; meshes: { primitives: { indices?: number; attributes: { POSITION: number } }[] }[]; accessors: { count: number }[] } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(dv.getUint32(0, true)).toBe(0x46546c67); // 'glTF'
  const len = dv.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len)));
}
const ROLE = /eye|glow|^KEEP-|^METAL-|primary|secondary/i;

describe('bundled breeds (breeds/README.md)', () => {
  const names = Object.keys(manifest.breeds);

  it('every intake breed is bundled, catalogued, and nothing else is', () => {
    expect(Object.keys(BUNDLED_BREEDS).sort()).toEqual([...names].sort());
    expect(NPC_CATALOG.map((f) => f.breed).sort()).toEqual([...names].sort());
  });

  for (const name of names) {
    it(`${name}: the chunk IS the reviewed GLB, decoder-free, every part a role, within budget`, async () => {
      const b64 = (await BUNDLED_BREEDS[name]!()).default;
      const bytes = Uint8Array.from(Buffer.from(b64, 'base64'));
      // Drift guard: the lab reviews breeds/<name>.glb; the wall must swim the same bytes.
      expect(Buffer.compare(Buffer.from(bytes), readFileSync(here(`../breeds/${name}.glb`)))).toBe(0);
      const json = gltfJson(bytes);
      expect(json.extensionsUsed ?? []).not.toContain('KHR_draco_mesh_compression');
      // A material with no role is painted a random coat at runtime.
      for (const m of json.materials ?? []) expect(m.name ?? '').toMatch(ROLE);
      let tris = 0;
      for (const mesh of json.meshes) for (const p of mesh.primitives) tris += json.accessors[p.indices ?? p.attributes.POSITION]!.count / 3;
      // About twice a minted fish (~2.7k) at most: the intake's job.
      expect(tris).toBeLessThanOrEqual(6000);
    });
  }

  it('crab: the Blender rig survives the intake — one skin, six clips, every vertex rigid on its own part', async () => {
    // breeds/rig/crab.py → rig/crab.glb → intake. Greedy meshing rewrites every
    // body face; a joint lost or crossed on the way rigs a claw to a leg.
    const doc = await new NodeIO().read(here('../breeds/crab.glb').pathname);
    const root = doc.getRoot();
    expect(root.listSkins()).toHaveLength(1);
    const joints = root.listSkins()[0]!.listJoints().map((n) => n.getName());
    expect(joints).toHaveLength(23);
    expect(root.listAnimations().map((a) => a.getName()).sort()).toEqual(['cheer', 'forage', 'idle', 'pinch', 'walk', 'wave']);
    expect(root.listNodes().find((n) => n.getName() === 'Crab')?.getExtras().mqStride).toBeCloseTo(6 / 0.55, 6);
    const parts: Record<string, RegExp> = {
      'GLOW-claws': /^(claw|jaw)\.[LR]$/, SecondaryColor: /^(thigh|shin)[1-4]\.[LR]$/,
      PrimaryColor: /^body$/, 'EYES-White': /^(body|eye\.[LR])$/, 'EYES-Black': /^(body|eye\.[LR])$/,
    };
    for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
      const name = p.getMaterial()!.getName();
      const j = p.getAttribute('JOINTS_0')!, w = p.getAttribute('WEIGHTS_0')!;
      expect(j.getCount()).toBe(p.getAttribute('POSITION')!.getCount());
      const used = new Set<string>();
      for (let i = 0; i < j.getCount(); i++) {
        const [j0] = j.getElement(i, []) as number[];
        const [w0, w1, w2, w3] = w.getElement(i, []) as number[];
        expect(j0).toBeLessThan(joints.length);
        expect([w0, w1! + w2! + w3!]).toEqual([1, 0]);
        used.add(joints[j0!]!);
      }
      for (const bone of used) expect(bone).toMatch(parts[name]!);
    }
  });

  it('glowfish: the angler rig survives the intake — eight bones, four clips, each part on its own', async () => {
    const doc = await new NodeIO().read(here('../breeds/glowfish.glb').pathname);
    const root = doc.getRoot();
    expect(root.listSkins()).toHaveLength(1);
    const joints = root.listSkins()[0]!.listJoints().map((n) => n.getName());
    expect([...joints].sort()).toEqual(['body', 'eye.L', 'eye.R', 'head', 'lure1', 'lure2', 'lure3', 'tail']);
    const anims = root.listAnimations();
    expect(anims.map((a) => a.getName()).sort()).toEqual(['blink', 'chomp', 'lure', 'swim']);
    // The blink squashes the eyes: scale, on the eyes and nothing else.
    const blink = anims.find((a) => a.getName() === 'blink')!;
    expect(new Set(blink.listChannels().map((c) => `${c.getTargetNode()!.getName()}.${c.getTargetPath()}`)))
      .toEqual(new Set(['eye.L.scale', 'eye.R.scale']));
    const parts: Record<string, RegExp> = {
      PrimaryColor: /^(body|tail)$/, SecondaryColor: /^(head|lure[123])$/, 'GLOW-Orbs': /^eye\.[LR]$/,
      'GLOW-Lure': /^lure3$/, 'METAL-Teeth': /^body$/,
    };
    for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
      const name = p.getMaterial()!.getName();
      const j = p.getAttribute('JOINTS_0')!, w = p.getAttribute('WEIGHTS_0')!;
      const used = new Set<string>();
      for (let i = 0; i < j.getCount(); i++) {
        const [j0] = j.getElement(i, []) as number[];
        expect((w.getElement(i, []) as number[])[0]).toBe(1);
        used.add(joints[j0!]!);
      }
      for (const bone of used) expect(bone, name).toMatch(parts[name]!);
    }
  });

  it('no body face lies under an eye decal: the two would z-fight (the crab\'s mouth flickered)', async () => {
    for (const [name, spec] of Object.entries(manifest.breeds)) {
      if (spec.kind !== 'voxel') continue;
      const doc = await new NodeIO().read(here(`../breeds/${name}.glb`).pathname);
      // Each triangle's centroid, keyed by the plane it faces out of: a body
      // triangle sharing a key with an eye triangle covers the same spot.
      const eye = new Set<string>(), body: string[] = [];
      for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
        const isEye = /eye/i.test(p.getMaterial()?.getName() ?? '');
        const pos = p.getAttribute('POSITION')!, idx = p.getIndices();
        const n = idx ? idx.getCount() : pos.getCount();
        for (let t = 0; t < n; t += 3) {
          const c = [0, 1, 2].map((k) => pos.getElement(idx ? idx.getScalar(t + k) : t + k, []) as number[]);
          const u = c[1]!.map((v, i) => v - c[0]![i]!), v = c[2]!.map((x, i) => x - c[0]![i]!);
          const nrm = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
          const ax = [0, 1, 2].reduce((b, i) => (Math.abs(nrm[i]!) > Math.abs(nrm[b]!) ? i : b), 0);
          const [a1, a2] = [0, 1, 2].filter((i) => i !== ax) as [number, number];
          const lo = [Math.min(...c.map((q) => q[a1]!)), Math.min(...c.map((q) => q[a2]!))];
          const hi = [Math.max(...c.map((q) => q[a1]!)), Math.max(...c.map((q) => q[a2]!))];
          // Sample the triangle's rectangle on a fine grid (a greedy rectangle
          // and a voxel quad cover the same cells, whatever their sizes).
          for (let x = lo[0]! + 0.25; x < hi[0]!; x += 0.5) for (let y = lo[1]! + 0.25; y < hi[1]!; y += 0.5) {
            const key = `${ax}|${Math.sign(nrm[ax]!)}|${Math.round(c[0]![ax]! * 20)}|${Math.round(x * 4)}|${Math.round(y * 4)}`;
            if (isEye) eye.add(key); else body.push(key);
          }
        }
      }
      expect(body.filter((k) => eye.has(k)), name).toEqual([]);
    }
  });

  it('the server-side manifest never pulls model bytes in', () => {
    // manifest.ts → ipfs.ts is what idle-server imports to validate a mix.
    for (const file of ['./manifest.ts', './ipfs.ts']) {
      expect(readFileSync(here(file), 'utf8')).not.toMatch(/from '\.\/breeds'/);
    }
  });
});
