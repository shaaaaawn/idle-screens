import { NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
// @ts-expect-error -- draco3dgltf ships no types (the intake uses it from .mjs)
import draco3d from 'draco3dgltf';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUNDLED_BREEDS } from './breeds';
import { NPC_CATALOG } from './ipfs';
import { ACT_LENGTH } from './puffer';

const here = (p: string): URL => new URL(p, import.meta.url);
const manifest = JSON.parse(readFileSync(here('../breeds/breeds.json'), 'utf8')) as { breeds: Record<string, { kind: string; minted?: boolean }> };

/** The JSON chunk of a GLB. */
function gltfJson(bytes: Uint8Array): { extensionsUsed?: string[]; materials?: { name?: string }[]; meshes: { primitives: { indices?: number; attributes: { POSITION: number } }[] }[]; accessors: { count: number }[] } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(dv.getUint32(0, true)).toBe(0x46546c67); // 'glTF'
  const len = dv.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len)));
}
/** A breed's GLB as the tank loads it: its lazy chunk, decoded. The one shipped copy (breeds/README.md). */
async function bundled(name: string): Promise<Uint8Array> {
  return Uint8Array.from(Buffer.from((await BUNDLED_BREEDS[name]!()).default, 'base64'));
}
const bundledDoc = async (name: string): Promise<Document> => new NodeIO().readBinary(await bundled(name));
const ROLE = /eye|glow|^KEEP-|^METAL-|^SCREEN-|^VIVID-\d{1,3}$|^PAINT-#[0-9a-f]{6}$|primary|secondary/i;
/** A minted breed's parts are paint regions: each token says what it wears there (src/minted.ts). */
const MINT_REGION = /^MINT-(EYE-)?R\d{3}$/;

/** Triangles in each eye's white and in its pupils: a clean eye is one box (12 each) and one quad (2 each) — no seams for a sliding pupil to show. */
function cleanEyes(root: ReturnType<Document['getRoot']>, joints: string[], white: string, black: string): { white: number; pupil: number } {
  let w = 0, p = 0;
  for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
    const name = prim.getMaterial()!.getName();
    if (name !== white && name !== black) continue;
    const j = prim.getAttribute('JOINTS_0')!, idx = prim.getIndices();
    const n = idx ? idx.getCount() : j.getCount();
    for (let t = 0; t < n; t += 3) {
      const v = idx ? idx.getScalar(t) : t;
      const bone = joints[(j.getElement(v, []) as number[])[0]!]!;
      if (name === white) w++; else if (bone.startsWith('pupil')) p++;
    }
  }
  return { white: w, pupil: p };
}

describe('bundled breeds (breeds/README.md)', () => {
  const names = Object.keys(manifest.breeds);

  it('every intake breed is bundled, catalogued, and nothing else is', () => {
    expect(Object.keys(BUNDLED_BREEDS).sort()).toEqual([...names].sort());
    // The minted breeds are catalogued by token (farm.ts), not as NPCs.
    expect(NPC_CATALOG.map((f) => f.breed).sort()).toEqual(names.filter((n) => !manifest.breeds[n]!.minted).sort());
  });

  for (const name of names) {
    it(`${name}: the chunk is decoder-free, every part a role, within budget`, async () => {
      const json = gltfJson(await bundled(name));
      expect(json.extensionsUsed ?? []).not.toContain('KHR_draco_mesh_compression');
      // A material with no role is painted a random coat at runtime.
      for (const m of json.materials ?? []) expect(m.name ?? '').toMatch(manifest.breeds[name]!.minted ? MINT_REGION : ROLE);
      let tris = 0;
      for (const mesh of json.meshes) for (const p of mesh.primitives) tris += json.accessors[p.indices ?? p.attributes.POSITION]!.count / 3;
      // About twice a minted fish (~2.7k) at most: the intake's job.
      expect(tris).toBeLessThanOrEqual(6000);
    });
  }

  it('crab: the Blender rig survives the intake — one skin, six clips, every vertex rigid on its own part', async () => {
    // breeds/rig/crab.py → rig/crab.glb → intake. Greedy meshing rewrites every
    // body face; a joint lost or crossed on the way rigs a claw to a leg.
    const doc = await bundledDoc('crab');
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

  // `soft`: a spine whose vertices blend between neighbouring bones (weights
  // sum to 1); otherwise every vertex rides one part. Eyes are rigid either way.
  // `layers`: the non-deforming bones kept as joints of their own (the dials'
  // and whole-body moments'), so they layer over the swim and never average with it.
  const MINTED_RIGS: Record<string, { joints: string[]; layers: string[]; clips: string[]; head: string; soft?: boolean }> = {
    angelfish: {
      joints: ['a1', 'a2', 'a3', 'body', 'd1', 'd2', 'd3', 'head', 's2', 's3', 'snout', 'tail'],
      layers: ['flex2', 'flex3', 'flex4', 'lookP', 'lookY', 'roll', 'root'],
      clips: ['bend', 'bow', 'burst', 'curious', 'display', 'flutter', 'hover', 'kiss', 'lookPitch', 'lookYaw', 'nibble', 'pirouette', 'soar', 'stretch', 'sway', 'swim'],
      head: 'head', soft: true,
    },
    seaturtle: {
      joints: ['fL1', 'fL2', 'fL3', 'fR1', 'fR2', 'fR3', 'head', 'neck', 'rL', 'rR', 'shell', 'tail'],
      layers: ['bank', 'lookP', 'lookY', 'reach', 'root', 'steerL', 'steerR', 'withdraw'],
      clips: ['barrel', 'breathe', 'burst', 'flap', 'glide', 'lookPitch', 'lookYaw', 'lookback', 'nod', 'paddle', 'reach', 'somersault', 'steer', 'stretch', 'swim', 'tuck', 'wave', 'wipe'],
      head: 'head', soft: true,
    },
    seahorse: {
      joints: ['fin1', 'fin2', 'fin3', 'head', 'neck', 'snout', 't1', 't2', 't3', 't4', 't5', 't6', 'trunk'],
      layers: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'lean', 'lookP', 'lookY', 'roll', 'root'],
      clips: ['bob', 'bow', 'burst', 'coil', 'curl', 'dance', 'hover', 'lean', 'lookPitch', 'lookYaw', 'lookabout', 'snick', 'stretch', 'swim', 'tilt', 'twirl', 'wag'],
      head: 'head', soft: true,
    },
  };
  for (const [breed, want] of Object.entries(MINTED_RIGS)) {
    it(`${breed}: the minted rig survives the intake — its bones and clips, ${want.soft ? 'a blended spine' : 'each vertex rigid on one part'}, the eyes rigid on the ${want.head}`, async () => {
      const doc = await new NodeIO().read(here(`../breeds/${breed}.glb`).pathname);
      const root = doc.getRoot();
      expect(root.listSkins()).toHaveLength(1);
      const joints = root.listSkins()[0]!.listJoints().map((n) => n.getName());
      expect([...joints].sort()).toEqual([...want.joints, ...want.layers].sort());
      expect(root.listAnimations().map((a) => a.getName()).sort()).toEqual(want.clips);
      const used = new Set<string>();
      for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
        const name = p.getMaterial()!.getName();
        const j = p.getAttribute('JOINTS_0')!, w = p.getAttribute('WEIGHTS_0')!;
        for (let i = 0; i < j.getCount(); i++) {
          const [j0] = j.getElement(i, []) as number[];
          const ws = w.getElement(i, []) as number[], js = j.getElement(i, []) as number[];
          const [w0, ...rest] = ws;
          if (want.soft) expect(ws.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2);
          else expect([w0, rest.reduce((a, b) => a + b, 0)]).toEqual([1, 0]);
          // Eye cells ride the head, rigid, where rigEyes reads their grid.
          if (/EYE/.test(name)) { expect(joints[j0!]).toBe(want.head); expect(w0).toBeCloseTo(1, 2); }
          ws.forEach((x, k) => { if (x > 0.01) used.add(joints[js[k]!]!); });
        }
      }
      expect([...used].sort()).toEqual(want.joints);
      // No dial or moment bone shares a channel with another clip's.
      const layer = new Set(want.layers);
      for (const a of root.listAnimations()) {
        const hits = a.listChannels().map((c) => c.getTargetNode()!.getName()).filter((n) => layer.has(n));
        if (/^(bend|steer|lookYaw|lookPitch|reach|curl|lean)$/.test(a.getName())) expect(a.listChannels().length, a.getName()).toBe(hits.length);
      }
    });
  }

  it('a soft rig keeps its faces whole: no T-junction the delivered model did not have (they crack, a flickering line, as the skin bends)', async () => {
    // A vertex strictly inside another triangle's edge. The intake's merging
    // makes them wherever a merged face meets unmerged ones (round the eyes,
    // the angelfish's 'line'); `kind: asis` keeps every voxel face whole.
    const tjunctions = async (file: string): Promise<number> => {
      const tris: number[][][] = [], verts = new Map<string, number[]>();
      for (const mesh of (await new NodeIO().read(here(file).pathname)).getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
        const pos = p.getAttribute('POSITION')!, idx = p.getIndices();
        for (let t = 0; t < (idx ? idx.getCount() : pos.getCount()); t += 3) {
          const c = [0, 1, 2].map((k) => pos.getElement(idx ? idx.getScalar(t + k) : t + k, []) as number[]);
          tris.push(c);
          for (const v of c) verts.set(v.map((x) => x.toFixed(3)).join(','), v);
        }
      }
      let n = 0;
      for (const c of tris) for (let e = 0; e < 3; e++) {
        const a = c[e]!, b = c[(e + 1) % 3]!, ab = a.map((x, i) => b[i]! - x), L2 = ab.reduce((s, x) => s + x * x, 0);
        for (const v of verts.values()) {
          const av = v.map((x, i) => x - a[i]!), u = av.reduce((s, x, i) => s + x * ab[i]!, 0) / L2;
          if (u <= 1e-4 || u >= 1 - 1e-4) continue;
          if (av.reduce((s, x, i) => s + (x - u * ab[i]!) ** 2, 0) < 1e-6) n++;
        }
      }
      return n;
    };
    // The delivered angelfish has a few of its own (a cell 0.07 off the grid, mid-body): never more than that.
    for (const breed of ['angelfish', 'seaturtle', 'seahorse']) {
      expect(await tjunctions(`../breeds/${breed}.glb`), breed).toBeLessThanOrEqual(await tjunctions(`../breeds/source/${breed}.glb`));
    }
  }, 120_000);

  // How each minted rig faces the convention: the angelfish swims along +X and
  // is turned a quarter; the turtle's source is already square, facing +Z.
  const FACING: Record<string, (p: number[]) => number[]> = { angelfish: ([x, y, z]) => [-z!, y!, x!], seaturtle: (p) => p, seahorse: ([x, y, z]) => [z!, y!, -x!], betafish: ([x, y, z]) => [-z!, y!, x!] };
  for (const [breed, turn] of Object.entries(FACING)) it(`${breed}: the rig never edits the model — at bind, every triangle is the source's (facing +Z), in its own region`, async () => {
    const draco = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });
    const tris = async (file: string, f: (p: number[]) => number[] = (p) => p): Promise<Map<string, string[]>> => {
      const out = new Map<string, string[]>();
      // Where each mesh sits: the source's node may carry a translation (the
      // turtle's), which Blender bakes in; a rig's mesh node is identity.
      const root = (await draco.read(here(file).pathname)).getRoot();
      const at = new Map(root.listNodes().filter((n) => n.getMesh() && !n.getSkin()).map((n) => [n.getMesh()!, n.getWorldMatrix()]));
      for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
        const name = p.getMaterial()!.getName(), pos = p.getAttribute('POSITION')!, idx = p.getIndices();
        const W = at.get(mesh), place = (q: number[]): number[] => (W ? [0, 1, 2].map((r) => W[r]! * q[0]! + W[4 + r]! * q[1]! + W[8 + r]! * q[2]! + W[12 + r]!) : q);
        const list = out.get(name) ?? [];
        for (let t = 0; t < (idx ? idx.getCount() : pos.getCount()); t += 3) {
          list.push([0, 1, 2].map((k) => f(place(pos.getElement(idx ? idx.getScalar(t + k) : t + k, []) as number[])).map((v) => v.toFixed(2)).join(',')).sort().join('|'));
        }
        out.set(name, list);
      }
      for (const l of out.values()) l.sort();
      return out;
    };
    const src = await tris(`../breeds/source/${breed}.glb`, turn), rig = await tris(`../breeds/rig/${breed}.glb`);
    expect([...rig.keys()].sort()).toEqual([...src.keys()].sort());
    for (const [m, list] of src) expect(rig.get(m), m).toEqual(list);
  });

  it('glowfish: the angler rig survives the intake — eight bones, four clips, each part on its own', async () => {
    const doc = await bundledDoc('glowfish');
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
        expect([w0, rest.reduce((a, b) => a + b, 0)]).toEqual([1, 0]);
        used.add(joints[j0!]!);
      }
      for (const bone of used) expect(bone, name).toMatch(parts[name]!);
    }
  });

  it('hackerfish: the rig survives the intake — five bones, three clips, the screen on its own bone', async () => {
    const doc = await bundledDoc('hackerfish');
    const root = doc.getRoot();
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
    const doc = await bundledDoc('shark');
    const root = doc.getRoot();
    const joints = root.listSkins()[0]!.listJoints().map((n) => n.getName());
    expect([...joints].sort()).toEqual(['body', 'caudal', 'eye.L', 'eye.R', 'fin.L', 'fin.R', 'head', 'jaw', 'tail1', 'tail2']);
    expect(root.listAnimations().map((a) => a.getName()).sort()).toEqual(['bite', 'swim']);
    for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
      if (p.getMaterial()!.getName() !== 'METAL-Teeth') continue;
      const j = p.getAttribute('JOINTS_0')!;
      for (let i = 0; i < j.getCount(); i++) expect(joints[(j.getElement(i, []) as number[])[0]!]).toBe('jaw');
    }
  });

  it('babyfish: the rig survives the intake — a soft-spined body, a dorsal fin, two eyes; every clip, the eye clips moving only the eyes', async () => {
    const doc = await bundledDoc('babyfish');
    const root = doc.getRoot();
    const joints = root.listSkins()[0]!.listJoints().map((n) => n.getName());
    expect([...joints].sort()).toEqual(['body', 'dorsal', 'eye.L', 'eye.R', 'fin', 'head', 'tail1', 'tail2']);
    const anims = new Map(root.listAnimations().map((a) => [a.getName(), a]));
    expect([...anims.keys()].sort()).toEqual([
      'blink', 'flip', 'hiccup', 'hiccup_eyes', 'peek', 'peek_eyes', 'swim', 'tailchase', 'wiggle', 'wiggle_eyes', 'yawn', 'yawn_eyes', 'zoom',
    ]);
    // The eye clips layer at full weight over the body's clips, so they touch nothing else…
    for (const n of ['blink', 'wiggle_eyes', 'peek_eyes', 'hiccup_eyes', 'yawn_eyes']) {
      for (const ch of anims.get(n)!.listChannels()) expect(ch.getTargetNode()!.getName(), n).toMatch(/^eye\./);
    }
    // …and the body's clips leave the eyes to them.
    for (const n of ['swim', 'zoom', 'wiggle', 'flip', 'peek', 'hiccup', 'tailchase', 'yawn']) {
      for (const ch of anims.get(n)!.listChannels()) expect(ch.getTargetNode()!.getName(), n).not.toMatch(/^eye\./);
    }
    // A soft spine: some vertices blend between two parts, so a joint never opens.
    let blended = 0;
    for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
      const w = p.getAttribute('WEIGHTS_0')!;
      for (let i = 0; i < w.getCount(); i++) if ((w.getElement(i, []) as number[])[0]! < 0.99) blended++;
    }
    expect(blended).toBeGreaterThan(0);
  });

  it('blowfish: the rig survives the intake — a body the clips move, a puff dial that alone scales it and stands its spines up, eyes no clip touches', async () => {
    const doc = await bundledDoc('blowfish');
    const root = doc.getRoot();
    const joints = root.listSkins()[0]!.listJoints().map((n) => n.getName());
    expect([...joints].sort()).toEqual([
      'body', 'eye.L', 'eye.R', 'fin.L', 'fin.R', 'mouth', 'puff', 'pupil.L', 'pupil.R',
      'spines.L', 'spines.R', 'spines.back', 'spines.bottom', 'spines.top',
    ]);
    const anims = new Map(root.listAnimations().map((a) => [a.getName(), a]));
    expect([...anims.keys()].sort()).toEqual(['bounce', 'chomp', 'flip', 'gulp', 'hover', 'kiss', 'puff', 'shimmy', 'shy', 'spin', 'spit', 'swim', 'wave', 'yawn', 'zip']);
    const touches = (clip: string): string[] => anims.get(clip)!.listChannels().map((c) => `${c.getTargetNode()!.getName()}.${c.getTargetPath()}`);
    // The body is a bone with no vertices, and still exported: every clip moves it.
    expect(touches('spin')).toContain('body.rotation');
    expect(touches('flip')).toContain('body.rotation');
    // The dial alone scales the puff and moves the spines…
    expect(touches('puff')).toContain('puff.scale');
    expect(touches('puff')).toContain('spines.top.translation');
    for (const [name] of anims) {
      if (name === 'puff') continue;
      for (const ch of touches(name)) {
        expect(ch, name).not.toBe('puff.scale');
        expect(ch, name).not.toMatch(/^spines\.(top|bottom|L|R)\.translation$/);
      }
    }
    // …and no clip at all moves an eye or a pupil: puffer.ts aims, closes and dilates them.
    for (const [name] of anims) for (const ch of touches(name)) expect(ch, name).not.toMatch(/^(eye|pupil)\./);
    expect(cleanEyes(root, joints, 'EYES-WHITE', 'EYES-BLACK')).toEqual({ white: 24, pupil: 4 });
    // The driver schedules each act by its clip's length.
    for (const [act, len] of Object.entries(ACT_LENGTH)) if (anims.has(act)) expect(anims.get(act)!.listChannels()[0]!.getSampler()!.getInput()!.getMax([])[0], act).toBeCloseTo(len, 2);
  });

  it('dori: the rig survives the intake — a rigid body on two fins, a tail for bursts, eyes and pupils of their own that no clip moves', async () => {
    const doc = await bundledDoc('dori');
    const root = doc.getRoot();
    const joints = root.listSkins()[0]!.listJoints().map((n) => n.getName());
    expect([...joints].sort()).toEqual(['body', 'dorsal', 'eye.L', 'eye.R', 'head', 'pec.L', 'pec.R', 'peduncle', 'pupil.L', 'pupil.R', 'tail']);
    const anims = root.listAnimations();
    expect(anims.map((a) => a.getName()).sort()).toEqual(['back', 'burst', 'flare', 'flop', 'fly', 'headstand', 'hover', 'pick']);
    // The eyes are tang.ts's, every frame: a clip that keyed them would fight it.
    for (const a of anims) for (const ch of a.listChannels()) expect(ch.getTargetNode()!.getName(), a.getName()).not.toMatch(/^(eye|pupil)\./);
    // The materials arrive as the roles the delivered model was mapped to.
    expect(root.listMaterials().map((m) => m.getName()).sort()).toEqual(['EYES-Black', 'EYES-White', 'GLOW-Yellow', 'PrimaryColor', 'SecondaryColor']);
    // Each pupil is its own bone's alone.
    const where = (name: string): Set<string> => {
      const out = new Set<string>();
      for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
        if (p.getMaterial()!.getName() !== name) continue;
        const j = p.getAttribute('JOINTS_0')!;
        for (let i = 0; i < j.getCount(); i++) out.add(joints[(j.getElement(i, []) as number[])[0]!]!);
      }
      return out;
    };
    expect([...where('EYES-White')].sort()).toEqual(['eye.L', 'eye.R']);
    expect([...where('EYES-Black')].sort()).toEqual(['head', 'pupil.L', 'pupil.R', 'tail']);
    expect(cleanEyes(root, joints, 'EYES-White', 'EYES-Black')).toEqual({ white: 24, pupil: 4 });
  });

  it('starfish: the rig survives the intake — disc, eyes, five arms in three links; each glowing tip its own light on its own arm', async () => {
    const doc = await bundledDoc('starfish');
    const root = doc.getRoot();
    const joints = root.listSkins()[0]!.listJoints().map((n) => n.getName());
    const arms = [0, 1, 2, 3, 4].flatMap((n) => [1, 2, 3].map((l) => `arm${n}.${l}`));
    expect([...joints].sort()).toEqual(['body', 'eye.L', 'eye.R', ...arms].sort());
    expect(root.listAnimations().map((a) => a.getName()).sort()).toEqual([
      'circles', 'crawl', 'curl', 'dip_follow', 'dip_lead', 'disco', 'idle', 'jacks', 'kick', 'lead_twirl', 'lift_fly', 'lift_lead', 'mambo', 'march',
      'reach', 'rise', 'spin', 'stand', 'standing', 'sway', 'twirl', 'twist', 'walk', 'wave',
    ]);
    const extras = root.listNodes().find((n) => n.getExtras().mqStride !== undefined)!.getExtras();
    expect(extras.mqWalkStride).toBeGreaterThan(0);
    expect(extras.mqFeet).toBeCloseTo(2 * 10.5 * Math.cos((36 * Math.PI) / 180), 3); // its front tips, where it stands
    const tips: string[] = [];
    for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
      const name = p.getMaterial()!.getName();
      const j = p.getAttribute('JOINTS_0')!;
      const bones = new Set(Array.from({ length: j.getCount() }, (_, i) => joints[(j.getElement(i, []) as number[])[0]!]!));
      if (name === 'GLOW-Tips') { expect(bones.size).toBe(1); tips.push(...bones); }
      if (name === 'EYES-White') expect([...bones].sort()).toEqual(['eye.L', 'eye.R']);
    }
    // splitByBone (breeds.json): one small light per tip, so neon keeps it lit and its bloom rides the tip.
    expect(tips.sort()).toEqual(['arm0.3', 'arm1.3', 'arm2.3', 'arm3.3', 'arm4.3']);
  });

  it('starfish: every dance move starts and ends on one pose (the aerobics on the rise\'s end, partners on their frame), so a routine cuts on the bar', async () => {
    const doc = await bundledDoc('starfish');
    const anims = new Map(doc.getRoot().listAnimations().map((a) => [a.getName(), a]));
    /** A clip's value per channel at its first or last key; a channel it never moves is the node's rest. */
    const ends = (name: string, which: 'first' | 'last'): Map<string, number[]> => {
      const out = new Map<string, number[]>();
      for (const ch of anims.get(name)!.listChannels()) {
        const values = ch.getSampler()!.getOutput()!, n = values.getCount();
        out.set(`${ch.getTargetNode()!.getName()}.${ch.getTargetPath()}`, values.getElement(which === 'first' ? 0 : n - 1, []) as number[]);
      }
      return out;
    };
    const rest = (key: string): number[] => {
      const node = key.slice(0, key.lastIndexOf('.')), path = key.slice(key.lastIndexOf('.') + 1);
      const nd = doc.getRoot().listNodes().find((x) => x.getName() === node)!;
      return path === 'rotation' ? nd.getRotation() : path === 'translation' ? nd.getTranslation() : nd.getScale();
    };
    const same = (a: number[], b: number[], key: string): void => {
      // q and -q are one rotation (the spin ends a full turn round).
      const d = Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));
      const flipped = key.endsWith('rotation') ? Math.max(...a.map((v, i) => Math.abs(v + b[i]!))) : Infinity;
      expect(Math.min(d, flipped), key).toBeLessThan(2e-3);
    };
    const joins = (pose: Map<string, number[]>, moves: string[]): void => {
      for (const move of moves) {
        for (const which of ['first', 'last'] as const) {
          const e = ends(move, which);
          for (const key of new Set([...e.keys(), ...pose.keys()])) same(e.get(key) ?? rest(key), pose.get(key) ?? rest(key), `${move} ${which} ${key}`);
        }
      }
    };
    joins(ends('rise', 'last'), ['march', 'jacks', 'reach', 'kick', 'twist', 'circles', 'disco', 'spin']);
    // The partner clips share their own pose: upright in the dance frame.
    joins(ends('mambo', 'first'), ['mambo', 'sway', 'lead_twirl', 'twirl', 'dip_lead', 'dip_follow', 'lift_lead', 'lift_fly']);
  });

  it('starfish: the committed source is what its generator draws (breeds/rig/starfish-model.mjs)', async () => {
    // @ts-expect-error -- a plain ESM script beside the rig, no types
    const model = await import('../breeds/rig/starfish-model.mjs') as { voxels: () => [number, number, number, string][] };
    const want = new Map<string, number>();
    for (const v of model.voxels()) want.set(v[3], (want.get(v[3]) ?? 0) + 12); // every face of every cube
    const doc = await new NodeIO().read(here('../breeds/source/starfish.glb').pathname);
    const got = new Map<string, number>();
    for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) got.set(p.getMaterial()!.getName(), p.getIndices()!.getCount() / 3);
    expect(got).toEqual(want);
    // No glow named for an eye: isEyes() would take it for an eye display.
    for (const name of got.keys()) if (/^GLOW/i.test(name)) expect(name).not.toMatch(/eye/i);
  });

  it('buried faces are culled: the shark (whole cubes, 28.8k faces) ships a fraction of them', async () => {
    let tris = 0;
    const json = gltfJson(await bundled('shark'));
    for (const mesh of json.meshes) for (const p of mesh.primitives) tris += json.accessors[p.indices ?? p.attributes.POSITION]!.count / 3;
    expect(tris).toBeLessThan(4000); // was 5,726 before the cull; the soft spine's bending faces merge only across the body
  });

  it('no body face lies under an eye decal: the two would z-fight (the crab\'s mouth flickered)', async () => {
    for (const [name, spec] of Object.entries(manifest.breeds)) {
      if (spec.kind !== 'voxel') continue;
      const doc = await bundledDoc(name);
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
