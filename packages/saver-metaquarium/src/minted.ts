/**
 * The minted fish, without IPFS: a breed's one shared model plus a token's paint.
 *
 * Every token of a minted breed is the same model — one triangle set, one set
 * of UVs (all 512 measured: zero outliers). What makes #300 #300 is its paint:
 * which material each triangle wears, what those materials are, and on a
 * betafish its texture atlas. `breeds/minted.mjs` cut each breed's model into
 * PAINT REGIONS (the coarsest split every token's materials respect) and wrote
 * each token's paint; the intake bundled the model like any other breed.
 *
 * So a minted fish costs no network at all — the model is a lazy chunk shared
 * by every token of its breed, the paint a few dozen bytes — except a
 * betafish's atlas: a 256² WebP rides in the package (a lazy chunk per fish,
 * always there), and the tank swaps in the 512² from the asset host when it
 * answers. The originals were 2048² JPEGs: 22 MB of GPU memory per fish.
 *
 * A token is rebuilt exactly as GLTFLoader built its original: one mesh per
 * material, with the original's names, colours and flags, so everything
 * downstream (coats, glow, eyes, metal) sees what it always saw. The meshes
 * share the breed's vertex attributes and differ only in their index.
 */
import {
  Bone, Box3, BufferAttribute, BufferGeometry, Color, DoubleSide, LinearSRGBColorSpace, Mesh, MeshBasicMaterial,
  MeshPhysicalMaterial, MeshStandardMaterial, RepeatWrapping, Skeleton, SkinnedMesh, Sphere, SRGBColorSpace, Texture, Vector3,
  type AnimationClip, type InterleavedBufferAttribute, type Material, type Matrix4, type Object3D,
} from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ASSET_CIDS, isMintedId } from './farm';

/** URL scheme of a minted fish rebuilt from its breed's bundled model. */
export const MINTED_SCHEME = 'mq-minted:';

/** Where the asset host keeps the 512² betafish atlases (`<id>.webp`). */
export const MINTED_ATLAS_URL = 'https://assets.idlescreens.com/mq/minted/atlas/512/v1/';

/** One of a token's materials, as its GLB authored it (linear colour factors). */
export interface MintedMaterial {
  name: string;
  color: [number, number, number];
  metal: number;
  rough: number;
  emissive?: [number, number, number];
  emissiveStrength?: number;
  /** KHR_materials_ior / _specular: GLTFLoader built these as MeshPhysicalMaterial. */
  ior?: number;
  specular?: number;
  specularColor?: [number, number, number];
  unlit?: boolean;
  double?: boolean;
  /** Painted by the token's texture atlas. */
  atlas?: boolean;
}

/** A breed's paint table: per token, its materials and one base-36 digit per
 *  region naming which of them that region wears. */
export interface MintedPaint {
  breed: string;
  regions: number;
  tokens: Record<string, [MintedMaterial[], string]>;
}

/**
 * The token a fish URL names, or null: `mq-minted:<id>`, or the token's own
 * IPFS model (`ipfs://<cid>/fish_<id>_of_the_metaquarium_3d.glb`, or the same
 * path on any gateway) when the CID is that token's — so every scene and
 * preset that names a minted fish by its IPFS URL takes the bundled path
 * without an edit.
 */
export function mintedIdOf(url: string): number | null {
  if (url.startsWith(MINTED_SCHEME)) {
    const id = Number(url.slice(MINTED_SCHEME.length));
    return isMintedId(id) ? id : null;
  }
  const m = /^(?:ipfs:\/\/|https?:\/\/[^/]+\/ipfs\/)([^/]+)\/fish_(\d+)_of_the_metaquarium_3d\.glb$/.exec(url);
  if (!m) return null;
  const id = Number(m[2]);
  return isMintedId(id) && ASSET_CIDS[id - 1] === m[1] ? id : null;
}

/** A breed's model, ready to paint: its scene, its clips, and each region's
 *  slice of one shared index into one shared set of vertex attributes. */
export interface MintedBase {
  scene: Object3D;
  animations: AnimationClip[];
  /** Per region: [first index, index count] into `index`. */
  ranges: Array<[number, number]>;
  index: Uint32Array;
  attributes: Record<string, BufferAttribute>;
  /** A skinned breed's skeleton, by bone name: a token binds its meshes to its clone's bones. */
  skin: { bones: string[]; inverses: Matrix4[]; bindMatrix: Matrix4 } | null;
}

/**
 * Merge a parsed breed model's region meshes (`MINT-R…` / `MINT-EYE-R…`, one
 * per region) into one attribute set. Region meshes are siblings under one
 * parent with one transform (the intake keeps the original node); the
 * template the tank clones keeps that parent, emptied, as the place a token's
 * meshes go.
 */
export function prepareMintedBase(scene: Object3D, animations: AnimationClip[]): MintedBase {
  const regions: Array<{ mesh: Mesh; r: number }> = [];
  scene.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const name = (mesh.material as Material).name ?? '';
    const m = /^MINT-(?:EYE-)?R(\d+)$/.exec(name);
    if (!m) throw new Error(`minted model: unexpected material "${name}"`);
    regions.push({ mesh, r: Number(m[1]) });
  });
  if (!regions.length) throw new Error('minted model: no regions');
  regions.sort((a, b) => a.r - b.r);
  const R = regions[regions.length - 1]!.r + 1;
  const parent = regions[0]!.mesh.parent;
  for (const { mesh } of regions) {
    if (mesh.parent !== parent) throw new Error('minted model: regions under different parents');
    if (!mesh.matrix.equals(regions[0]!.mesh.matrix)) throw new Error('minted model: regions with different transforms');
  }
  const names = Object.keys(regions[0]!.mesh.geometry.attributes);
  let vertices = 0, indices = 0;
  for (const { mesh } of regions) {
    vertices += mesh.geometry.attributes.position!.count;
    indices += mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position!.count;
  }
  // Element by element: GLTFLoader hands interleaved attributes back as views
  // of one shared stream, so `.array` is not this attribute's values alone.
  // Regions need not agree on a type: after a rigged intake a coat region's
  // skin weights are normalized bytes and an eye region's are floats. Copied
  // raw into the first region's type, the eyes' weights fell to ~0 and the
  // turtle's eyes collapsed into its head. Where they disagree, the merge
  // holds real (denormalized) floats instead.
  const attributes: Record<string, BufferAttribute> = {};
  for (const name of names) {
    const all = regions.map(({ mesh }) => mesh.geometry.attributes[name] as BufferAttribute | undefined);
    const first = all[0]!;
    const size = first.itemSize;
    if (all.some((a) => !a || a.itemSize !== size)) throw new Error(`minted model: region missing ${name}`);
    const uniform = all.every((a) => a!.array.constructor === first.array.constructor && a!.normalized === first.normalized);
    const Ctor = (uniform ? first.array.constructor : Float32Array) as new (n: number) => Float32Array;
    const arr = new Ctor(vertices * size);
    let o = 0;
    for (const a of all) {
      if (!uniform) {
        // getComponent denormalizes a normalized integer: the value the shader sees.
        for (let i = 0; i < a!.count; i++) for (let k = 0; k < size; k++) arr[o++] = a!.getComponent(i, k);
        continue;
      }
      // Raw values (getComponent would denormalize into a normalized integer array).
      const il = (a as unknown as InterleavedBufferAttribute).isInterleavedBufferAttribute ? (a as unknown as InterleavedBufferAttribute) : null;
      const src = il ? il.data.array : a!.array, stride = il ? il.data.stride : size, offset = il ? il.offset : 0;
      for (let i = 0; i < a!.count; i++) for (let k = 0; k < size; k++) arr[o++] = src[i * stride + offset + k]!;
    }
    attributes[name] = new BufferAttribute(arr, size, uniform ? first.normalized : false);
  }
  const index = new Uint32Array(indices);
  const ranges: Array<[number, number]> = Array.from({ length: R }, () => [0, 0]);
  let base = 0, at = 0;
  for (const { mesh, r } of regions) {
    const g = mesh.geometry, n = g.attributes.position!.count;
    const start = at;
    if (g.index) for (let i = 0; i < g.index.count; i++) index[at++] = g.index.getX(i) + base;
    else for (let i = 0; i < n; i++) index[at++] = i + base;
    ranges[r] = [start, at - start];
    base += n;
  }
  const first = regions[0]!.mesh as SkinnedMesh;
  const skin = first.isSkinnedMesh
    ? { bones: first.skeleton.bones.map((b) => b.name), inverses: first.skeleton.boneInverses.map((m) => m.clone()), bindMatrix: first.bindMatrix.clone() }
    : null;
  if (skin && new Set(skin.bones).size !== skin.bones.length) throw new Error('minted model: bone names must be unique');
  // The template keeps the skeleton, the clip's targets and the parent node
  // (tagged: a clone copies userData); its region meshes go — a token brings its own.
  (parent ?? scene).userData.mqMintedParent = true;
  for (const { mesh } of regions) mesh.removeFromParent();
  return { scene, animations, ranges, index, attributes, skin };
}

/**
 * A token mesh's geometry. It shares the breed's whole position attribute, but
 * three measures bounds over every vertex of that attribute, not the indexed
 * ones — so each part would report the whole fish. The tank reads part
 * bounds (nose side, glow size and centre), so measure the indexed vertices.
 */
class MintedGeometry extends BufferGeometry {
  override computeBoundingBox(): void {
    const box = (this.boundingBox ??= new Box3()).makeEmpty();
    const pos = this.attributes.position, index = this.index;
    if (!pos || !index) return super.computeBoundingBox();
    const v = new Vector3();
    for (let i = 0; i < index.count; i++) box.expandByPoint(v.fromBufferAttribute(pos as BufferAttribute, index.getX(i)));
  }

  override computeBoundingSphere(): void {
    const sphere = (this.boundingSphere ??= new Sphere());
    const pos = this.attributes.position, index = this.index;
    if (!pos || !index) return super.computeBoundingSphere();
    this.computeBoundingBox();
    const box = this.boundingBox!;
    if (box.isEmpty()) { sphere.makeEmpty(); return; }
    box.getCenter(sphere.center);
    const v = new Vector3();
    let r2 = 0;
    for (let i = 0; i < index.count; i++) r2 = Math.max(r2, sphere.center.distanceToSquared(v.fromBufferAttribute(pos as BufferAttribute, index.getX(i))));
    sphere.radius = Math.sqrt(r2);
  }
}

/** A token's material, built the way GLTFLoader built the original. */
export function mintedMaterial(d: MintedMaterial, atlas: Texture | null): Material {
  const color = new Color().setRGB(d.color[0], d.color[1], d.color[2], LinearSRGBColorSpace);
  const map = d.atlas ? atlas : null;
  const side = d.double ? DoubleSide : undefined;
  let mat: Material;
  if (d.unlit) {
    mat = new MeshBasicMaterial({ color, map, ...(side ? { side } : {}) });
  } else {
    const physical = d.ior !== undefined || d.specular !== undefined;
    const params = { color, map, metalness: d.metal, roughness: d.rough, ...(side ? { side } : {}) };
    const std = physical ? new MeshPhysicalMaterial(params) : new MeshStandardMaterial(params);
    if (physical) {
      const phys = std as MeshPhysicalMaterial;
      if (d.ior !== undefined) phys.ior = d.ior === 0 ? 1000 : d.ior; // GLTFLoader's own reading of 0 (three #26167)
      if (d.specular !== undefined) phys.specularIntensity = d.specular;
      if (d.specularColor) phys.specularColor.setRGB(d.specularColor[0], d.specularColor[1], d.specularColor[2], LinearSRGBColorSpace);
    }
    if (d.emissive) {
      std.emissive.setRGB(d.emissive[0], d.emissive[1], d.emissive[2], LinearSRGBColorSpace);
      std.emissiveIntensity = d.emissiveStrength ?? 1;
    }
    mat = std;
  }
  mat.name = d.name;
  return mat;
}

/**
 * A token's fish: the breed's template cloned (skeleton and all), and under
 * its emptied parent one mesh per token material — the original GLB's shape.
 * Each mesh's geometry shares the breed's attributes; its index is that
 * material's regions.
 */
export function paintMinted(base: MintedBase, paint: [MintedMaterial[], string], atlas: Texture | null): Object3D {
  const [mats, map] = paint;
  if (map.length !== base.ranges.length) throw new Error(`minted paint: ${map.length} regions, model has ${base.ranges.length}`);
  const scene = cloneSkinned(base.scene);
  const parent = findParent(scene);
  // The skeleton, rebuilt on the clone's own bones.
  const skeleton = base.skin
    ? new Skeleton(base.skin.bones.map((name) => {
      const bone = scene.getObjectByName(name);
      if (!(bone as Bone | undefined)?.isBone) throw new Error(`minted model: no bone ${name}`);
      return bone as Bone;
    }), base.skin.inverses.map((m) => m.clone()))
    : null;
  for (let m = 0; m < mats.length; m++) {
    let count = 0;
    for (let r = 0; r < map.length; r++) if (parseInt(map[r]!, 36) === m) count += base.ranges[r]![1];
    if (!count) continue;
    const index = new Uint32Array(count);
    let o = 0;
    for (let r = 0; r < map.length; r++) {
      if (parseInt(map[r]!, 36) !== m) continue;
      const [start, n] = base.ranges[r]!;
      index.set(base.index.subarray(start, start + n), o);
      o += n;
    }
    const geometry = new MintedGeometry();
    for (const [name, attr] of Object.entries(base.attributes)) geometry.setAttribute(name, attr);
    geometry.setIndex(new BufferAttribute(index, 1));
    const material = mintedMaterial(mats[m]!, atlas);
    const mesh = skeleton ? new SkinnedMesh(geometry, material) : new Mesh(geometry, material);
    mesh.name = mats[m]!.name;
    parent.add(mesh);
    if (skeleton) (mesh as SkinnedMesh).bind(skeleton, base.skin!.bindMatrix);
  }
  return scene;
}

/** Where a template's region meshes were: tagged before they left. */
function findParent(scene: Object3D): Object3D {
  let found: Object3D | null = null;
  scene.traverse((o) => { if (!found && o.userData.mqMintedParent) found = o; });
  return found ?? scene;
}

/** A betafish's atlas from WebP bytes, set up as GLTFLoader set up the original's. */
export async function atlasTexture(bytes: ArrayBuffer): Promise<Texture | null> {
  if (typeof createImageBitmap === 'undefined' || typeof Blob === 'undefined') return null;
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/webp' }), { premultiplyAlpha: 'none' });
  const tex = new Texture(bitmap);
  tex.flipY = false;
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}
