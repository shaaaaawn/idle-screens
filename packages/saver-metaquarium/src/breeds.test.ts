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
const ROLE = /eye|glow|^KEEP-|^METAL-|^SCREEN-|primary|secondary/i;

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
        expect(w0).toBeCloseTo(1, 3);
        for (const tail of [w1!, w2!, w3!]) expect(Math.abs(tail)).toBeLessThan(1e-3);
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
        const [w0, ...rest] = w.getElement(i, []) as number[];
        expect(w0).toBeCloseTo(1, 3);
        for (const tail of rest) expect(Math.abs(tail)).toBeLessThan(1e-3);
        used.add(joints[j0!]!);
      }
      for (const bone of used) expect(bone, name).toMatch(parts[name]!);
    }
  });

  it('hackerfish: the rig survives the intake — five bones, three clips, the screen on its own bone', async () => {
    const doc = await new NodeIO().read(here('../breeds/hackerfish.glb').pathname);
    const root = doc.getRoot();
    expect(root.listSkins()).toHaveLength(1);
    const joints = root.listSkins()[0]!.listJoints().map((n) => n.getName());
    expect([...joints].sort()).toEqual(['body', 'fin.L', 'fin.R', 'screen', 'tail']);
    expect(root.listAnimations().map((a) => a.getName()).sort()).toEqual(['glitch', 'swim', 'type']);
    const parts: Record<string, RegExp> = {
      PrimaryColor: /^(body|tail)$/, SecondaryColor: /^fin\.[LR]$/, 'SCREEN-Glass': /^screen$/, 'SCREEN-Pixels': /^screen$/,
    };
    for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
      const name = p.getMaterial()!.getName();
      const j = p.getAttribute('JOINTS_0')!;
      for (let i = 0; i < j.getCount(); i++) expect(joints[(j.getElement(i, []) as number[])[0]!], name).toMatch(parts[name]!);
    }
  });

  it('shark: the rig survives the intake — head, jaw, eyes, fins and a three-link tail; the teeth on the jaw', async () => {
    const doc = await new NodeIO().read(here('../breeds/shark.glb').pathname);
    const root = doc.getRoot();
    expect(root.listSkins()).toHaveLength(1);
    const joints = root.listSkins()[0]!.listJoints().map((n) => n.getName());
    expect([...joints].sort()).toEqual(['body', 'caudal', 'eye.L', 'eye.R', 'fin.L', 'fin.R', 'head', 'jaw', 'tail1', 'tail2']);
    expect(root.listAnimations().map((a) => a.getName()).sort()).toEqual(['bite', 'swim']);
    let teeth = 0;
    for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
      if (p.getMaterial()!.getName() !== 'METAL-Teeth') continue;
      teeth += 1;
      const j = p.getAttribute('JOINTS_0')!, w = p.getAttribute('WEIGHTS_0')!;
      for (let i = 0; i < j.getCount(); i++) {
        expect(joints[(j.getElement(i, []) as number[])[0]!]).toBe('jaw');
        const [w0, ...rest] = w.getElement(i, []) as number[];
        expect(w0).toBeCloseTo(1, 3);
        for (const tail of rest) expect(Math.abs(tail)).toBeLessThan(1e-3);
      }
    }
    expect(teeth).toBeGreaterThan(0);
  });

  it('buried faces are culled: the shark (whole cubes, 28.8k faces) ships a fraction of them', () => {
    let tris = 0;
    const json = gltfJson(readFileSync(here('../breeds/shark.glb')));
    for (const mesh of json.meshes) for (const p of mesh.primitives) tris += json.accessors[p.indices ?? p.attributes.POSITION]!.count / 3;
    expect(tris).toBeLessThan(4000); // was 5,726 before the cull; the soft spine's bending faces merge only across the body
  });

  it('no body face lies under an eye decal: the two would z-fight (the crab\'s mouth flickered)', async () => {
    for (const [name, spec] of Object.entries(manifest.breeds)) {
      if (spec.kind !== 'voxel') continue;
      const doc = await new NodeIO().read(here(`../breeds/${name}.glb`).pathname);
      // Each triangle's rectangle, keyed by the plane it faces out of: a body
      // rectangle overlapping an eye's on one plane covers the same spot. Exact
      // overlap, not cells: the shark's eye sits a third of a voxel off the
      // head's lattice, and shares no cell with the face it covers.
      type Rect = [number, number, number, number];
      const eye = new Map<string, Rect[]>(), body: [string, Rect][] = [];
      for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
        const isEye = /eye|GLOW-Orbs/i.test(p.getMaterial()?.getName() ?? '');
        const pos = p.getAttribute('POSITION')!, idx = p.getIndices();
        const n = idx ? idx.getCount() : pos.getCount();
        for (let t = 0; t < n; t += 3) {
          const c = [0, 1, 2].map((k) => pos.getElement(idx ? idx.getScalar(t + k) : t + k, []) as number[]);
          const u = c[1]!.map((v, i) => v - c[0]![i]!), v = c[2]!.map((x, i) => x - c[0]![i]!);
          const nrm = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
          const ax = [0, 1, 2].reduce((b, i) => (Math.abs(nrm[i]!) > Math.abs(nrm[b]!) ? i : b), 0);
          const [a1, a2] = [0, 1, 2].filter((i) => i !== ax) as [number, number];
          const r: Rect = [Math.min(...c.map((q) => q[a1]!)), Math.max(...c.map((q) => q[a1]!)), Math.min(...c.map((q) => q[a2]!)), Math.max(...c.map((q) => q[a2]!))];
          const key = `${ax}|${Math.sign(nrm[ax]!)}|${Math.round(c[0]![ax]! * 20)}`;
          if (isEye) (eye.get(key) ?? eye.set(key, []).get(key)!).push(r); else body.push([key, r]);
        }
      }
      // Overlapping on both axes, past the sources' float noise (a dori eye sits 0.012 off its grid).
      const overlaps = (a: Rect, b: Rect): boolean => Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > 0.1 && Math.min(a[3], b[3]) - Math.max(a[2], b[2]) > 0.1;
      const under = body.filter(([k, r]) => (eye.get(k) ?? []).some((e) => overlaps(r, e)));
      expect(under.map(([k, r]) => `${k} ${r.map((x) => x.toFixed(2)).join(',')}`), name).toEqual([]);
    }
  });

  it('the server-side manifest never pulls model bytes in', () => {
    // manifest.ts → ipfs.ts is what idle-server imports to validate a mix.
    for (const file of ['./manifest.ts', './ipfs.ts']) {
      expect(readFileSync(here(file), 'utf8')).not.toMatch(/from '\.\/breeds'/);
    }
  });
});
