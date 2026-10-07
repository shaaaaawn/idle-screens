import { NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { readFileSync } from 'node:fs';
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, RepeatWrapping, SkinnedMesh, SRGBColorSpace, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUNDLED_BREEDS } from './breeds';
import { ASSET_CIDS, BREEDS, fishAsset } from './farm';
import { MINTED_ATLAS, MINTED_PAINT } from './minted/index';
import { atlasTexture, MINTED_SCHEME, mintedIdOf, paintMinted, prepareMintedBase, type MintedPaint } from './minted';

const here = (p: string): URL => new URL(p, import.meta.url);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const MINTED = BREEDS.filter((b) => b.minted);
const paintOf = async (breed: string): Promise<MintedPaint> => (await MINTED_PAINT[breed]!()).default;
const bundled = async (breed: string): Promise<ArrayBuffer> => {
  const b = Buffer.from((await BUNDLED_BREEDS[breed]!()).default, 'base64');
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

/** Every triangle a document draws, by material name: vertex positions (and UVs) in winding order, from the smallest corner. */
function trianglesByMaterial(doc: Document, rename: (name: string) => string = (n) => n): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const name = rename(prim.getMaterial()!.getName());
    const pos = prim.getAttribute('POSITION')!, uv = prim.getAttribute('TEXCOORD_0'), idx = prim.getIndices();
    const n = idx ? idx.getCount() : pos.getCount();
    const list = out.get(name) ?? [];
    for (let t = 0; t < n; t += 3) {
      const corners = [0, 1, 2].map((k) => {
        const i = idx ? idx.getScalar(t + k) : t + k;
        return pos.getElement(i, [] as number[]).map((v) => v.toFixed(3)).join(',') + (uv ? '/' + uv.getElement(i, [] as number[]).map((v) => v.toFixed(3)).join(',') : '');
      });
      // Rotate to the smallest corner first: the same triangle however it starts, but a reversed one differs.
      const at = corners.indexOf([...corners].sort()[0]!);
      list.push([...corners.slice(at), ...corners.slice(0, at)].join('|'));
    }
    out.set(name, list);
  }
  for (const list of out.values()) list.sort();
  return out;
}

describe('mintedIdOf', () => {
  it('reads the scheme, and a token\'s own IPFS model on any gateway, and nothing else', () => {
    expect(mintedIdOf(`${MINTED_SCHEME}300`)).toBe(300);
    expect(mintedIdOf(fishAsset(300, '3d')!)).toBe(300);
    expect(mintedIdOf(fishAsset(1, '3d')!.replace('ipfs://', 'https://assets.idlescreens.com/ipfs/'))).toBe(1);
    // Another token's CID under this name is not this token.
    expect(mintedIdOf(`ipfs://${ASSET_CIDS[0]}/fish_300_of_the_metaquarium_3d.glb`)).toBeNull();
    expect(mintedIdOf(`${MINTED_SCHEME}513`)).toBeNull();
    expect(mintedIdOf(fishAsset(300, 'image')!)).toBeNull();
    expect(mintedIdOf('mq-breed:dori')).toBeNull();
    // A query string is a deliberate request for the original bytes.
    expect(mintedIdOf(`${fishAsset(300, '3d')!}?original`)).toBeNull();
  });
});

describe('the minted paint tables (breeds/minted.mjs)', () => {
  for (const b of MINTED) {
    it(`${b.breed}: every token painted, every region worn, in step with the bundled model`, async () => {
      const paint = await paintOf(b.breed);
      const json = JSON.parse(new TextDecoder().decode(new Uint8Array(await bundled(b.breed)).subarray(20, 20 + new DataView(await bundled(b.breed)).getUint32(12, true)))) as { materials: { name: string }[] };
      const regions = json.materials.map((m) => m.name).filter((n) => /^MINT-/.test(n));
      expect(regions.length).toBe(paint.regions);
      const [lo, hi] = b.range!;
      expect(Object.keys(paint.tokens).map(Number).sort((x, y) => x - y)).toEqual(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i));
      for (const [id, [mats, map]] of Object.entries(paint.tokens)) {
        expect(map).toHaveLength(paint.regions);
        const worn = new Set([...map].map((c) => parseInt(c, 36)));
        for (const m of worn) expect(m).toBeLessThan(mats.length);
        // No material is listed that no region wears.
        expect(worn.size).toBe(mats.length);
        // An atlas-painted token has its atlas bundled; no other token does.
        expect(!!MINTED_ATLAS[Number(id)]).toBe(mats.some((m) => m.atlas));
      }
    });
  }

  it('angelfish #257 and betafish #100: the canonical model in the token\'s paint IS the original, triangle for triangle', async () => {
    // The playground ships these two originals (byte for byte the IPFS GLBs).
    for (const [id, breed, file] of [[257, 'angelfish', 'fish-257-angelfish'], [100, 'betafish', 'fish-100-betafish']] as const) {
      const original = trianglesByMaterial(await io.read(here(`../../../apps/playground/public/assets/metaquarium/${file}.glb`).pathname));
      const [mats, map] = (await paintOf(breed)).tokens[id]!;
      // The source model, each region renamed to the material this token wears there.
      const painted = trianglesByMaterial(await io.read(here(`../breeds/source/${breed}.glb`).pathname), (name) => {
        const r = Number(/R(\d+)$/.exec(name)![1]);
        return mats[parseInt(map[r]!, 36)]!.name;
      });
      expect([...painted.keys()].sort()).toEqual([...original.keys()].sort());
      for (const [name, tris] of original) expect(painted.get(name), `${breed} #${id} ${name}`).toEqual(tris);
    }
  });
});

describe('paintMinted', () => {
  const parse = async (breed: string): Promise<{ scene: Object3D; animations: never[] }> =>
    (await new GLTFLoader().parseAsync(await bundled(breed), '')) as unknown as { scene: Object3D; animations: never[] };

  it('rebuilds a token as its original was built: one mesh per material, its regions\' triangles, its own colours', async () => {
    const gltf = await parse('angelfish');
    const base = prepareMintedBase(gltf.scene, gltf.animations);
    const paint = (await paintOf('angelfish')).tokens[300]!;
    const fish = paintMinted(base, paint, null);
    const meshes: Mesh[] = [];
    fish.traverse((o) => { if ((o as Mesh).isMesh) meshes.push(o as Mesh); });
    const [mats, map] = paint;
    expect(meshes.map((m) => m.name).sort()).toEqual(mats.map((m) => m.name).sort());
    for (const mesh of meshes) {
      const at = mats.findIndex((m) => m.name === mesh.name);
      const want = [...map].reduce((n, c, r) => n + (parseInt(c, 36) === at ? base.ranges[r]![1] : 0), 0);
      expect(mesh.geometry.index!.count).toBe(want);
      // Shared vertex data: one upload's worth per breed, however many tokens.
      expect(mesh.geometry.attributes.position).toBe(base.attributes.position);
      const d = mats[at]!, mat = mesh.material as MeshStandardMaterial | MeshBasicMaterial;
      expect(mat.name).toBe(d.name);
      expect(mat.color.toArray().map((v) => +v.toFixed(3))).toEqual(d.color.map((v) => +v.toFixed(3)));
      if (!d.unlit) expect((mat as MeshStandardMaterial).metalness).toBe(d.metal);
    }
    // The template is untouched: the next token paints from the same base.
    const again = paintMinted(base, (await paintOf('angelfish')).tokens[257]!, null);
    let n = 0; again.traverse((o) => { if ((o as Mesh).isMesh) n++; });
    expect(n).toBe((await paintOf('angelfish')).tokens[257]![0].length);
  });

  it('a betafish keeps its skeleton and clip: every mesh skinned to the clone\'s own bones', async () => {
    const gltf = await parse('betafish');
    const base = prepareMintedBase(gltf.scene, gltf.animations as never[]);
    expect(base.skin?.bones).toHaveLength(4);
    expect(base.attributes.uv).toBeDefined();
    const fish = paintMinted(base, (await paintOf('betafish')).tokens[100]!, null);
    const skinned: SkinnedMesh[] = [];
    fish.traverse((o) => { if ((o as SkinnedMesh).isSkinnedMesh) skinned.push(o as SkinnedMesh); });
    expect(skinned.length).toBeGreaterThan(0);
    for (const m of skinned) for (const bone of m.skeleton.bones) {
      let root: Object3D = bone; while (root.parent) root = root.parent;
      expect(root).toBe(fish);
    }
    expect(gltf.animations.length).toBeGreaterThan(0);
  });
});

describe('betafish atlases', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('every bundled atlas is a 256² WebP (the originals were 2048² JPEGs)', async () => {
    const ids = Object.keys(MINTED_ATLAS).map(Number);
    expect(ids).toHaveLength(256);
    const seen = new Set<string>();
    for (const id of ids) {
      const b64 = (await MINTED_ATLAS[id]!()).default;
      const bytes = Buffer.from(b64, 'base64');
      expect(bytes.toString('latin1', 0, 4)).toBe('RIFF');
      expect(bytes.toString('latin1', 8, 12)).toBe('WEBP');
      expect(bytes.toString('latin1', 12, 16)).toBe('VP8 ');
      // VP8 key frame: 14-bit width and height after the start code.
      expect([bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff]).toEqual([256, 256]);
      expect(bytes.length).toBeLessThan(64_000);
      seen.add(b64);
    }
    // Each its own art — but #31 and #144 are twins: one painting, two JPEG
    // encodes (1,675,153 and 1,675,271 bytes) that downscale to the same pixels.
    expect(seen.size).toBe(255);
  });

  it('decodes as GLTFLoader decoded the original\'s: unflipped, sRGB, repeating — and is absent where there is no decoder', async () => {
    expect(await atlasTexture(new ArrayBuffer(8))).toBeNull();
    const decode = vi.fn(async () => ({ width: 256, height: 256, close() {} }));
    vi.stubGlobal('createImageBitmap', decode);
    const tex = (await atlasTexture(new ArrayBuffer(8)))!;
    expect(decode).toHaveBeenCalledWith(expect.any(Blob), { premultiplyAlpha: 'none' });
    expect(tex.flipY).toBe(false);
    expect(tex.colorSpace).toBe(SRGBColorSpace);
    expect([tex.wrapS, tex.wrapT]).toEqual([RepeatWrapping, RepeatWrapping]);
  });
});

describe('prepareMintedBase', () => {
  const region = (name: string, indexed: boolean): Mesh => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
    if (indexed) g.setIndex([0, 1, 2]);
    const m = new MeshBasicMaterial(); m.name = name;
    return new Mesh(g, m);
  };

  it('takes unindexed regions too, and paints a token across them', () => {
    const node = new Group(); node.add(region('MINT-R001', false), region('MINT-EYE-R000', true));
    const scene = new Group(); scene.add(node);
    const base = prepareMintedBase(scene, []);
    expect(base.ranges).toEqual([[0, 3], [3, 3]]);
    expect([...base.index]).toEqual([0, 1, 2, 3, 4, 5]);
    expect(node.children).toHaveLength(0);
    const fish = paintMinted(base, [[{ name: 'EYE-WHITE', color: [1, 1, 1], metal: 0, rough: 1, unlit: true, double: true }, { name: 'GLOW', color: [0, 0, 0], metal: 0, rough: 1, emissive: [0, 0, 1], emissiveStrength: 4 }], '01'], null);
    const meshes: Mesh[] = []; fish.traverse((o) => { if ((o as Mesh).isMesh) meshes.push(o as Mesh); });
    expect(meshes.map((m) => [m.name, (m.material as MeshBasicMaterial).type, m.geometry.index!.count])).toEqual([['EYE-WHITE', 'MeshBasicMaterial', 3], ['GLOW', 'MeshStandardMaterial', 3]]);
    expect((meshes[1]!.material as MeshStandardMaterial).emissiveIntensity).toBe(4);
    expect(() => paintMinted(base, [[], '0'], null)).toThrow(/regions/);
  });

  it('refuses a model that is not a cut minted model', () => {
    expect(() => prepareMintedBase(new Group(), [])).toThrow(/no regions/);
    const odd = new Group(); odd.add(region('PrimaryColor', true));
    expect(() => prepareMintedBase(odd, [])).toThrow(/unexpected material/);
    const split = new Group(), a = new Group(), b = new Group();
    a.add(region('MINT-R000', true)); b.add(region('MINT-R001', true)); split.add(a, b);
    expect(() => prepareMintedBase(split, [])).toThrow(/different parents/);
  });
});
