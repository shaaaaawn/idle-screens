#!/usr/bin/env node
/**
 * The minted breeds, canonical: 512 token GLBs in, four shared models and a
 * paint table out.
 *
 *   node breeds/minted.mjs <dir of fish_<id>.glb> [breed…]   (the mirror; see below)
 *
 * Every token of a minted breed is the SAME model: one triangle set, one set
 * of UVs (measured over all 512, 2026-10-05: zero outliers). What makes #300
 * #300 is only its paint — which material each triangle wears, what those
 * materials are, and on a betafish its texture atlas. So instead of 512
 * models this writes:
 *
 *   breeds/source/<breed>.glb   one model per breed, cut into PAINT REGIONS:
 *                               the coarsest split of its triangles that every
 *                               token's materials respect. Region r is material
 *                               `MINT-R<r>` (`MINT-EYE-R<r>` when every token
 *                               paints it as an eye cell, so the intake and
 *                               the eye survey treat it as one). The skin and
 *                               clip of the first token pass through.
 *   src/minted/<breed>.ts       the paint table, a lazy chunk: per token its
 *                               materials (as authored) and which of them each
 *                               region wears.
 *   src/minted/atlas/<id>.ts    betafish only: the token's atlas at 256², WebP,
 *                               a lazy chunk (the bundled floor).
 *   <dir>/../atlas/512/<id>.webp  the same at 512², for the asset host
 *                               (assets.idlescreens.com/mq/minted/atlas/512/v1/).
 *
 * The tank builds a token by giving the breed's one shared geometry a
 * per-token index (triangles sorted by material) and the token's materials:
 * vertex buffers are uploaded once per breed, however many fish wear it.
 *
 * The mirror is the IPFS originals, byte for byte (idle-mono keeps one, with
 * SHA256SUMS; `assets.idlescreens.com/ipfs/<cid>/fish_<id>_of_the_metaquarium_3d.glb`
 * serves the same bytes). The script refuses a breed with an outlier token.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_OUT = path.join(HERE, '..', 'src', 'minted');
const BREEDS = { betafish: [1, 256], angelfish: [257, 456], seahorse: [457, 496], seaturtle: [497, 512] };
const ATLAS = [256, 512];
/** Breeds rigged in Blender (breeds.json `rig`): their rig's clips replace the authored one. */
const RIGGED = new Set(Object.entries(JSON.parse(fs.readFileSync(path.join(HERE, 'breeds.json'), 'utf8')).breeds)
  .filter(([, spec]) => spec.rig).map(([name]) => name));

const from = process.argv[2];
const ATLAS_OUT = from ? path.join(path.resolve(from), '..', 'atlas') : '';
const only = process.argv.slice(3);
if (!from || !fs.existsSync(from)) {
  console.error('usage: node breeds/minted.mjs <dir of fish_<id>.glb> [breed…]');
  process.exit(2);
}
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const isEyeName = (n) => /^EYE/i.test(n);
const r4 = (v) => Math.round(v * 1e4) / 1e4;

/** Every triangle of a doc as [key, primitive, vertex indices], in document order. */
function triangles(doc) {
  const out = [];
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION'), uv = prim.getAttribute('TEXCOORD_0'), idx = prim.getIndices();
    const n = idx ? idx.getCount() : pos.getCount();
    for (let t = 0; t < n; t += 3) {
      const vi = [0, 1, 2].map((k) => (idx ? idx.getScalar(t + k) : t + k));
      const key = vi.map((i) => pos.getElement(i, []).map((v) => v.toFixed(3)).join(',')
        + (uv ? '/' + uv.getElement(i, []).map((v) => v.toFixed(3)).join(',') : '')).sort().join('|');
      out.push([key, prim, vi]);
    }
  }
  return out;
}

/** A material as GLTFLoader would have built it — everything the tank reads.
 *  Colours are the glTF's own LINEAR factors (GLTFLoader reads them as
 *  LinearSRGB), kept to 4 places: a near-black coat survives. */
function describe(mat) {
  const ext = (name) => mat.getExtension(name);
  const strength = ext('KHR_materials_emissive_strength')?.getEmissiveStrength?.() ?? 1;
  const d = {
    name: mat.getName(),
    color: mat.getBaseColorFactor().slice(0, 3).map(r4),
    metal: r4(mat.getMetallicFactor()),
    rough: r4(mat.getRoughnessFactor()),
  };
  const em = mat.getEmissiveFactor();
  if (em.some((v) => v > 0)) { d.emissive = em.map(r4); if (strength !== 1) d.emissiveStrength = r4(strength); }
  // IOR and specular make GLTFLoader build a MeshPhysicalMaterial: keep them.
  const ior = ext('KHR_materials_ior');
  if (ior) d.ior = r4(ior.getIOR());
  const spec = ext('KHR_materials_specular');
  if (spec) { d.specular = r4(spec.getSpecularFactor()); d.specularColor = spec.getSpecularColorFactor().map(r4); }
  if (ext('KHR_materials_unlit')) d.unlit = true;
  if (mat.getDoubleSided()) d.double = true;
  if (mat.getBaseColorTexture()) d.atlas = true;
  return d;
}

for (const [breed, [lo, hi]] of Object.entries(BREEDS)) {
  if (only.length && !only.includes(breed)) continue;
  const ids = [];
  for (let id = lo; id <= hi; id++) ids.push(id);
  const docs = new Map();
  for (const id of ids) docs.set(id, await io.read(path.join(from, `fish_${id}.glb`)));

  // Canonical triangle order: the first token's. The canonical model is cut
  // from a fresh read of it — #lo's own document must stay as authored, for
  // its paint is read from it below.
  const base = await io.read(path.join(from, `fish_${lo}.glb`));
  const baseTris = triangles(base);
  const order = new Map(baseTris.map(([k], i) => [k, i]));
  if (order.size !== baseTris.length) throw new Error(`${breed}: #${lo} has duplicate triangles`);
  const T = baseTris.length;

  // Per token: which of its materials each canonical triangle wears.
  const wear = new Map(); // id -> { mats: Material[], tri: Int16Array }
  for (const id of ids) {
    const tris = triangles(docs.get(id));
    if (tris.length !== T) throw new Error(`${breed}: #${id} has ${tris.length} triangles, #${lo} has ${T}`);
    const mats = [], tri = new Int16Array(T).fill(-1);
    for (const [key, prim] of tris) {
      const at = order.get(key);
      if (at === undefined) throw new Error(`${breed}: #${id} has a triangle #${lo} lacks — not one model`);
      const m = prim.getMaterial();
      let mi = mats.indexOf(m);
      if (mi < 0) { mi = mats.length; mats.push(m); }
      tri[at] = mi;
    }
    if (tri.includes(-1)) throw new Error(`${breed}: #${id} leaves a triangle bare`);
    wear.set(id, { mats, tri });
  }

  // Regions: triangles that wear the same material as each other on EVERY token.
  const regionOf = new Int32Array(T);
  const sigs = new Map();
  for (let t = 0; t < T; t++) {
    const sig = ids.map((id) => wear.get(id).tri[t]).join(',');
    let r = sigs.get(sig);
    if (r === undefined) { r = sigs.size; sigs.set(sig, r); }
    regionOf[t] = r;
  }
  const R = sigs.size;
  if (R > 255) throw new Error(`${breed}: ${R} regions`);
  // A region every token paints as an eye is an eye cell.
  const eyeRegion = Array.from({ length: R }, () => true);
  for (const id of ids) {
    const { mats, tri } = wear.get(id);
    for (let t = 0; t < T; t++) if (!isEyeName(mats[tri[t]].getName())) eyeRegion[regionOf[t]] = false;
  }
  const regionName = (r) => `MINT-${eyeRegion[r] ? 'EYE-' : ''}R${String(r).padStart(3, '0')}`;

  // The canonical model: the first token's document, its primitives re-cut by region.
  const root = base.getRoot();
  const mesh = root.listMeshes()[0];
  if (root.listMeshes().length !== 1) throw new Error(`${breed}: expected one mesh`);
  const prims = mesh.listPrimitives();
  const semantics = prims[0].listSemantics();
  const buffer = root.listBuffers()[0];
  const regionMats = Array.from({ length: R }, (_, r) => base.createMaterial(regionName(r))
    .setBaseColorFactor([((r * 97) % 255) / 255, ((r * 57) % 255) / 255, ((r * 151) % 255) / 255, 1])
    .setMetallicFactor(0).setRoughnessFactor(1));
  const byRegion = Array.from({ length: R }, () => []);
  baseTris.forEach(([, prim, vi], t) => byRegion[regionOf[t]].push([prim, vi]));
  const fresh = byRegion.map((tris, r) => {
    const prim = base.createPrimitive().setMaterial(regionMats[r]);
    for (const sem of semantics) {
      const src = tris[0][0].getAttribute(sem);
      const size = src.getElementSize();
      const ArrayType = src.getArray().constructor;
      const arr = new ArrayType(tris.length * 3 * size);
      let o = 0;
      for (const [p, vi] of tris) for (const i of vi) { const e = p.getAttribute(sem).getElement(i, []); for (let k = 0; k < size; k++) arr[o++] = e[k]; }
      prim.setAttribute(sem, base.createAccessor().setType(src.getType()).setArray(arr).setNormalized(src.getNormalized()).setBuffer(buffer));
    }
    return prim;
  });
  for (const p of prims) { mesh.removePrimitive(p); p.dispose(); }
  for (const p of fresh) mesh.addPrimitive(p);
  for (const m of root.listMaterials()) if (!regionMats.includes(m)) m.dispose();
  for (const t of root.listTextures()) t.dispose();
  for (const name of ['KHR_materials_unlit', 'KHR_materials_emissive_strength', 'KHR_materials_ior', 'KHR_materials_specular']) {
    root.listExtensionsUsed().find((e) => e.extensionName === name)?.dispose();
  }
  // The mesh as authored: a rotation on its node goes (every turtle's node
  // carries a -30° yaw over perfectly axis-aligned voxels). Baked in, it
  // knocks the voxels off every axis — the lattice a rig is cut on — and
  // Blender's glTF export drops a turn that undoes it. The tank orients a
  // fish by its own rule either way. A skinned breed's nodes are its rig.
  for (const node of root.listNodes()) {
    if (node.getMesh() && !node.getSkin() && node.getRotation().some((v, i) => Math.abs(v - (i === 3 ? 1 : 0)) > 1e-9)) node.setRotation([0, 0, 0, 1]);
  }
  // A breed rigged in Blender loses the authored whole-body clip: the rig's
  // clips replace it, and Blender would import the model posed at the clip's
  // first frame (a turtle's turned -30°) and bake that into the rig. A breed
  // still on the generic path keeps it — it is that fish's default motion.
  if (RIGGED.has(breed) && !root.listSkins().length) for (const anim of root.listAnimations()) anim.dispose();
  // keepAttributes: the region materials are untextured, and a plain prune
  // would take the UVs a betafish's atlas needs.
  await base.transform(prune({ keepAttributes: true }));
  root.getAsset().generator = 'idle-screens breeds/minted.mjs';
  await io.write(path.join(HERE, 'source', `${breed}.glb`), base);

  // The paint table: per token, its materials and each region's.
  const tokens = {};
  for (const id of ids) {
    const { mats, tri } = wear.get(id);
    const map = Array.from({ length: R }, () => -1);
    for (let t = 0; t < T; t++) map[regionOf[t]] = tri[t];
    tokens[id] = { mats: mats.map(describe), regions: map };
  }
  // The same table as the tank's lazy chunk: per token [materials, one
  // base-36 digit per region naming the material it wears].
  fs.mkdirSync(SRC_OUT, { recursive: true });
  const compact = Object.fromEntries(Object.entries(tokens).map(([id, t]) => [id, [t.mats, t.regions.map((m) => m.toString(36)).join('')]]));
  fs.writeFileSync(path.join(SRC_OUT, `${breed}.ts`),
    `// Generated by breeds/minted.mjs from the ${ids.length} ${breed} originals — do not edit; re-run it.\n`
    + `import type { MintedPaint } from '../minted';\n\n`
    + `const paint: MintedPaint = ${JSON.stringify({ breed, regions: R, tokens: compact })};\nexport default paint;\n`);

  // Betafish atlases: one per token, downscaled. JPEG at 2048² is ~80× the
  // pixels a fish ever shows; 512² is indistinguishable in the tank.
  let atlases = 0;
  for (const id of ids) {
    const tex = docs.get(id).getRoot().listTextures();
    if (!tex.length) continue;
    if (new Set(tex.map((t) => t.getImage())).size !== 1) throw new Error(`${breed}: #${id} has more than one atlas`);
    const tmp = path.join(os.tmpdir(), `mq-atlas-${id}.png`);
    const src = path.join(os.tmpdir(), `mq-atlas-${id}.${tex[0].getMimeType() === 'image/png' ? 'png' : 'jpg'}`);
    fs.writeFileSync(src, tex[0].getImage());
    for (const size of ATLAS) {
      const dir = path.join(ATLAS_OUT, String(size));
      fs.mkdirSync(dir, { recursive: true });
      execFileSync('magick', [src, '-filter', 'Lanczos', '-resize', `${size}x${size}`, tmp]);
      execFileSync('cwebp', ['-quiet', '-q', '82', '-m', '6', tmp, '-o', path.join(dir, `${id}.webp`)]);
    }
    // The bundled floor: the small atlas as a lazy chunk of its own.
    fs.mkdirSync(path.join(SRC_OUT, 'atlas'), { recursive: true });
    fs.writeFileSync(path.join(SRC_OUT, 'atlas', `${id}.ts`),
      `// Generated by breeds/minted.mjs — do not edit. Fish #${id}'s texture atlas, ${ATLAS[0]}² WebP.\n`
      + `export default '${fs.readFileSync(path.join(ATLAS_OUT, String(ATLAS[0]), `${id}.webp`)).toString('base64')}';\n`);
    fs.rmSync(tmp); fs.rmSync(src);
    atlases++;
  }
  const mats = ids.map((id) => wear.get(id).mats.length);
  console.log(`${breed.padEnd(10)} ${ids.length} tokens · ${T} tris · ${R} regions (${eyeRegion.filter(Boolean).length} eye) · ${Math.min(...mats)}–${Math.max(...mats)} materials/token${atlases ? ` · ${atlases} atlases` : ''}`);
}

// The loader map: one lazy chunk per breed's paint, one per bundled atlas.
const breedsDone = Object.keys(BREEDS).filter((b) => fs.existsSync(path.join(SRC_OUT, `${b}.ts`)));
const atlasIds = fs.existsSync(path.join(SRC_OUT, 'atlas'))
  ? fs.readdirSync(path.join(SRC_OUT, 'atlas')).map((f) => Number(f.replace(/\.ts$/, ''))).filter(Number.isInteger).sort((a, b) => a - b)
  : [];
fs.writeFileSync(path.join(SRC_OUT, 'index.ts'),
  `// Generated by breeds/minted.mjs — do not edit; re-run it.\n`
  + `import type { MintedPaint } from '../minted';\n\n`
  + `/** Each minted breed's paint table, a lazy chunk. */\n`
  + `export const MINTED_PAINT: Readonly<Record<string, () => Promise<{ default: MintedPaint }>>> = {\n`
  + breedsDone.map((b) => `  ${b}: () => import('./${b}'),\n`).join('')
  + `};\n\n/** Each betafish's bundled texture atlas (WebP, base64), a lazy chunk. */\n`
  + `export const MINTED_ATLAS: Readonly<Record<number, () => Promise<{ default: string }>>> = {\n`
  + atlasIds.map((id) => `  ${id}: () => import('./atlas/${id}'),\n`).join('')
  + `};\n`);
