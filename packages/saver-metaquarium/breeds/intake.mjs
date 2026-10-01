#!/usr/bin/env node
/**
 * Breed intake: a source GLB in, a tank-ready breed out.
 *
 *   pnpm --filter @idle-screens/saver-metaquarium breeds            every breed in breeds.json
 *   pnpm --filter @idle-screens/saver-metaquarium breeds shark crab  just these
 *
 * For each breed in breeds.json it:
 *
 *   1. decodes the source (Draco out — the tank then needs no decoder for it),
 *      bakes GPU instancing and node transforms into the vertices, and joins
 *      primitives by material, so one model is one mesh, one draw per material;
 *   2. renames materials to the ROLES the tank reads (materials.ts):
 *      PrimaryColor / SecondaryColor (the seeded two-tone coat), EYES-White /
 *      EYES-Black (unlit, rigged by eyeLife), GLOW-<colour> (unlit + halo),
 *      KEEP-<anything> (the authored colour, kept). Anything else is painted a
 *      random coat at runtime — the audit calls that out;
 *   3. voxel models: greedy-meshes every material's voxel faces into rectangles,
 *      never along the swim axis (the body wave bends per vertex, so a face
 *      merged along the body would stay rigid and crack), never touching eye
 *      primitives (eyeLife reads their voxel grid), and drops any body face
 *      that sits exactly under an eye face (the source's z-fights resolve to
 *      the decal);
 *      smooth models: meshopt-simplifies to the breed's triangle budget;
 *   4. gives every primitive flat normals, drops attributes nothing reads,
 *      welds, dedups, prunes;
 *   rigged models (a skin, from breeds/rig/<breed>.py): the skeleton and its
 *      clips pass through untouched; greedy meshing runs per joint, so a merged
 *      rectangle never spans two parts that move apart, and every vertex keeps
 *      its one joint at weight 1; clips are resampled (redundant keys dropped);
 *   5. writes breeds/<breed>.glb (what the lab reviews), src/breeds/<breed>.ts
 *      (the same bytes, base64, one lazy chunk per breed) and breeds/REPORT.md.
 *
 * Review the result in the playground breed lab: /breeds.html?set=both.
 * The process around this script is breeds/README.md.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { clearNodeTransform, dedup, flatten, join, prune, resample, simplify, uninstance, unweld, weld } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { MeshoptSimplifier } from 'meshoptimizer';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join as pathJoin } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_OUT = pathJoin(HERE, '..', 'src', 'breeds');
const manifest = JSON.parse(readFileSync(pathJoin(HERE, 'breeds.json'), 'utf8'));
const only = process.argv.slice(2);
const quiet = { debug() {}, info() {}, warn: console.warn, error: console.error };

await MeshoptSimplifier.ready;
const io = new NodeIO().setLogger(quiet).registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });

const isEye = (name) => /eye/i.test(name);
const roleOf = (name) => isEye(name) ? (/black|pupil/i.test(name) ? 'eye·pupil' : /white|sclera/i.test(name) ? 'eye·sclera' : 'eye (by luminance)')
  : /glow/i.test(name) ? 'glow' : /^KEEP-/.test(name) ? 'kept' : /primary/i.test(name) ? 'coat A' : /secondary/i.test(name) ? 'coat B' : 'RANDOM coat';

function stats(doc) {
  let tris = 0; const mats = new Map(); const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const pos = p.getAttribute('POSITION'); const idx = p.getIndices();
    const t = (idx ? idx.getCount() : pos.getCount()) / 3; tris += t;
    const name = p.getMaterial()?.getName() ?? '';
    mats.set(name, (mats.get(name) ?? 0) + t);
    const mn = pos.getMin([]), mx = pos.getMax([]);
    for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], mn[i]); hi[i] = Math.max(hi[i], mx[i]); }
  }
  return { tris, mats, size: hi.map((v, i) => v - lo[i]), draws: [...mats.keys()].length };
}

/** Triangles of a primitive as corner arrays. */
function trianglesOf(p) {
  const pos = p.getAttribute('POSITION'), idx = p.getIndices();
  const n = idx ? idx.getCount() : pos.getCount(); const out = [];
  for (let t = 0; t < n / 3; t++) out.push([0, 1, 2].map((k) => pos.getElement(idx ? idx.getScalar(t * 3 + k) : t * 3 + k, [])));
  return out;
}

/** The joint each triangle is skinned to (rigged models are rigid: one joint,
 *  weight 1, per triangle — breeds/rig/*.py writes them that way), or null. */
function jointsOf(p) {
  const j = p.getAttribute('JOINTS_0'), w = p.getAttribute('WEIGHTS_0'); if (!j) return null;
  const idx = p.getIndices(); const n = idx ? idx.getCount() : j.getCount(); const out = [];
  for (let t = 0; t < n / 3; t++) {
    const ids = [0, 1, 2].map((k) => (idx ? idx.getScalar(t * 3 + k) : t * 3 + k));
    const js = ids.map((i) => j.getElement(i, [])[0]);
    if (js[1] !== js[0] || js[2] !== js[0] || ids.some((i) => Math.abs(w.getElement(i, [])[0] - 1) > 1e-4)) {
      throw new Error(`${p.getMaterial()?.getName()}: triangle ${t} is not rigidly skinned to one joint`);
    }
    out.push(js[0]);
  }
  return out;
}

/** An axis-aligned face cell: which plane it lies in, which way it faces, and its rectangle in that plane. */
function faceOf([a, b, c]) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const L = Math.hypot(...n); if (L < 1e-12) return null;
  const axis = [0, 1, 2].reduce((best, i) => (Math.abs(n[i]) > Math.abs(n[best]) ? i : best), 0);
  if (Math.abs(n[axis]) / L < 0.999) return null; // not a voxel face
  const [ua, va] = [0, 1, 2].filter((i) => i !== axis);
  const us = [a[ua], b[ua], c[ua]], vs = [a[va], b[va], c[va]];
  return { axis, sign: Math.sign(n[axis]), plane: a[axis], ua, va, u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs) };
}

/** The model's voxel pitch, measured: the commonest side of its voxel faces
 *  (a scaled source node — the shark's is 1.3 — moves it off the nominal 2). */
function pitchOf(doc) {
  const count = new Map();
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    for (const tri of trianglesOf(p)) {
      const f = faceOf(tri); if (!f) continue;
      for (const side of [f.u1 - f.u0, f.v1 - f.v0]) { const k = side.toFixed(2); count.set(k, (count.get(k) ?? 0) + 1); }
    }
  }
  return +[...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Greedy meshing, in place. `voxel` is the grid pitch; `swim` the axis the body
 * wave bends along (never merged along). Eye primitives are left exactly as
 * authored; body cells under an eye cell are dropped.
 */
function greedy(doc, voxel, swim) {
  // Parts are not all on one lattice (baked instances sit at offsets like
  // 5.91), so each plane's grid carries its own phase along both of its axes.
  // Decoded Draco positions carry float noise (2.9985 for 3), so the phase is
  // snapped to 1/40 of a voxel — two faces on one lattice must share a key.
  const phase = (x) => { const step = voxel / 40; const m = ((Math.round(x / step) * step) % voxel + voxel) % voxel; return m > voxel - step / 2 ? 0 : +m.toFixed(4); };
  // The plane snaps too: the crab's mouth sat at z -10.0000 over body faces at
  // -9.9998, so the decal rule never matched them and the two z-fought.
  const snap = (x) => { const step = voxel / 40; return (Math.round(x / step) * step).toFixed(4); };
  const planeKey = (f) => `${f.axis}|${f.sign}|${snap(f.plane)}|${phase(f.u0)}|${phase(f.v0)}`;
  const cellsOf = (f) => {
    const pu = phase(f.u0), pv = phase(f.v0), out = [];
    for (let i = Math.round((f.u0 - pu) / voxel); i < Math.round((f.u1 - pu) / voxel); i++) {
      for (let j = Math.round((f.v0 - pv) / voxel); j < Math.round((f.v1 - pv) / voxel); j++) out.push(`${i}|${j}`);
    }
    return out;
  };
  // Cells every eye covers, so the body under them can go.
  const eyeCells = new Set();
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    if (!isEye(p.getMaterial()?.getName() ?? '')) continue;
    for (const tri of trianglesOf(p)) {
      const f = faceOf(tri); if (!f) continue;
      for (const c of cellsOf(f)) eyeCells.add(`${planeKey(f)}|${c}`);
    }
  }
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    if (isEye(p.getMaterial()?.getName() ?? '')) continue;
    const planes = new Map(); const loose = [];
    // Rigged: a part per joint, each merged on its own.
    const joints = jointsOf(p);
    trianglesOf(p).forEach((tri, t) => {
      const bone = joints ? joints[t] : 0;
      const f = faceOf(tri);
      if (!f) { loose.push({ tri, bone }); return; } // off-grid geometry passes through untouched
      const key = planeKey(f);
      let pl = planes.get(`${key}|${bone}`); if (!pl) { pl = { f, bone, cells: new Set() }; planes.set(`${key}|${bone}`, pl); }
      // A triangle is half its rectangle; its twin marks the same cells.
      for (const c of cellsOf(f)) if (!eyeCells.has(`${key}|${c}`)) pl.cells.add(c);
    });
    const pos = [], jnt = [];
    for (const { f, bone, cells } of planes.values()) {
      const canU = f.ua !== swim, canV = f.va !== swim;
      const used = new Set();
      const order = [...cells].map((k) => k.split('|').map(Number)).sort((A, B) => A[1] - B[1] || A[0] - B[0]);
      for (const [i, j] of order) {
        if (used.has(`${i}|${j}`)) continue;
        const free = (x, y) => cells.has(`${x}|${y}`) && !used.has(`${x}|${y}`);
        let w = 1; if (canU) while (free(i + w, j)) w++;
        let h = 1;
        if (canV) grow: for (;;) { for (let k = 0; k < w; k++) if (!free(i + k, j + h)) break grow; h++; }
        for (let a = 0; a < w; a++) for (let b = 0; b < h; b++) used.add(`${i + a}|${j + b}`);
        const pu = phase(f.u0), pv = phase(f.v0);
        const corner = (uu, vv) => { const q = [0, 0, 0]; q[f.axis] = f.plane; q[f.ua] = pu + uu * voxel; q[f.va] = pv + vv * voxel; return q; };
        const q = [corner(i, j), corner(i + w, j), corner(i + w, j + h), corner(i, j + h)];
        // Wind so the face points the way the source's did.
        const e1 = [0, 1, 2].map((k) => q[1][k] - q[0][k]), e2 = [0, 1, 2].map((k) => q[2][k] - q[0][k]);
        const nz = e1[(f.axis + 1) % 3] * e2[(f.axis + 2) % 3] - e1[(f.axis + 2) % 3] * e2[(f.axis + 1) % 3];
        for (const o of Math.sign(nz) === f.sign ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]) { pos.push(...q[o]); jnt.push(bone, 0, 0, 0); }
      }
    }
    for (const { tri, bone } of loose) for (const c of tri) { pos.push(...c); jnt.push(bone, 0, 0, 0); }
    p.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)));
    if (joints) {
      p.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(new Uint8Array(jnt)));
      // Normalized bytes: the weight is always exactly 1 (255/255).
      p.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setNormalized(true).setArray(new Uint8Array(jnt.map((_, i) => (i % 4 === 0 ? 255 : 0)))));
    }
    p.setIndices(null);
  }
}

/** Drops every clip channel that only ever holds its node's rest value (a
 *  bone a clip never moves): the mixer leaves an unbound property at rest. */
function dropRestChannels(doc) {
  for (const anim of doc.getRoot().listAnimations()) {
    for (const ch of anim.listChannels()) {
      const node = ch.getTargetNode(), path = ch.getTargetPath();
      const rest = path === 'rotation' ? node.getRotation() : path === 'translation' ? node.getTranslation() : path === 'scale' ? node.getScale() : null;
      if (!rest) continue;
      const out = ch.getSampler().getOutput().getArray();
      let still = true;
      for (let i = 0; i < out.length && still; i++) still = Math.abs(out[i] - rest[i % rest.length]) < 1e-5;
      if (still) { const smp = ch.getSampler(); ch.dispose(); if (!smp.listParents().some((p) => p !== doc.getRoot() && p !== anim)) smp.dispose(); }
    }
  }
}

/** Flat normals from the (unindexed) triangles; every other vertex attribute but UVs on textured
 *  materials and a rig's joints/weights goes. */
function flatNormals(doc) {
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const textured = !!p.getMaterial()?.getBaseColorTexture();
    const keep = (sem) => sem === 'POSITION' || (textured && sem === 'TEXCOORD_0') || sem === 'JOINTS_0' || sem === 'WEIGHTS_0';
    for (const sem of p.listSemantics()) if (!keep(sem)) p.setAttribute(sem, null);
    const pos = p.getAttribute('POSITION').getArray(); const nrm = new Float32Array(pos.length);
    for (let t = 0; t < pos.length; t += 9) {
      const u = [pos[t + 3] - pos[t], pos[t + 4] - pos[t + 1], pos[t + 5] - pos[t + 2]], v = [pos[t + 6] - pos[t], pos[t + 7] - pos[t + 1], pos[t + 8] - pos[t + 2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const L = Math.hypot(...n) || 1;
      for (let k = 0; k < 3; k++) nrm.set([n[0] / L, n[1] / L, n[2] / L], t + k * 3);
    }
    p.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nrm));
  }
}

const rows = [];
mkdirSync(SRC_OUT, { recursive: true });
for (const [breed, spec] of Object.entries(manifest.breeds)) {
  if (only.length && !only.includes(breed)) continue;
  const doc = await io.read(pathJoin(HERE, spec.source));
  const before = stats(doc);
  for (const ext of doc.getRoot().listExtensionsUsed()) if (ext instanceof KHRDracoMeshCompression) ext.dispose();
  const rigged = doc.getRoot().listSkins().length > 0;
  if (rigged) {
    // A rig's hierarchy IS the skeleton: no flattening, no baking, no joining
    // (the export is already one mesh per material). Its mesh nodes must sit at
    // the origin — the inverse bind matrices were computed against that.
    for (const node of doc.getRoot().listNodes()) {
      if (node.getMesh() && node.getWorldMatrix().some((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) > 1e-6)) {
        throw new Error(`${breed}: mesh node ${node.getName()} carries a transform; apply it in Blender`);
      }
    }
  } else await doc.transform(uninstance(), flatten());
  // Uninstancing leaves many nodes sharing one mesh; baking a node's transform
  // into a SHARED mesh moves it for every node (dori came out 602 units tall).
  // Each node gets its own copy first — ALL copies before ANY bake, or a copy
  // inherits the transform an earlier node already baked into the original.
  const seen = new Set();
  const meshed = rigged ? [] : doc.getRoot().listNodes().filter((node) => node.getMesh());
  for (const node of meshed) {
    const mesh = node.getMesh();
    if (seen.has(mesh)) node.setMesh(mesh.clone()); else seen.add(mesh);
  }
  for (const node of meshed) clearNodeTransform(node);
  // Roles, and material fixes the audit asked for.
  for (const m of doc.getRoot().listMaterials()) {
    const to = spec.roles?.[m.getName()];
    if (to) m.setName(to);
    if (spec.metal !== undefined) m.setMetallicFactor(spec.metal);
    if (spec.roughness !== undefined) m.setRoughnessFactor(spec.roughness);
  }
  if (!rigged) await doc.transform(join());
  const size = stats(doc).size;
  const swim = size[0] > size[2] ? 0 : 2; // the tank's own rule (tank.ts template: longX)
  if (spec.kind === 'voxel') {
    await doc.transform(unweld());
    // The swim-axis rule protects the body wave, which never bends a skinned
    // mesh (swimwave.ts): a rig's parts are rigid, so they merge every way.
    greedy(doc, pitchOf(doc), rigged ? -1 : swim);
  } else {
    await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, spec.triBudget / before.tris), error: spec.error ?? 0.002, lockBorder: false }), unweld());
  }
  flatNormals(doc);
  if (rigged) {
    dropRestChannels(doc);
    // Blender's own extras (material-variant bookkeeping) go; the rig's mq* facts stay.
    for (const node of doc.getRoot().listNodes()) {
      node.setExtras(Object.fromEntries(Object.entries(node.getExtras()).filter(([k]) => k.startsWith('mq'))));
    }
  }
  await doc.transform(weld(), dedup(), ...(rigged ? [resample({ tolerance: 1e-4 })] : []), prune());
  const after = stats(doc);
  const clips = doc.getRoot().listAnimations().map((a) => a.getName());
  const bytes = await io.writeBinary(doc);
  writeFileSync(pathJoin(HERE, `${breed}.glb`), bytes);
  writeFileSync(pathJoin(SRC_OUT, `${breed}.ts`),
    `// Generated by breeds/intake.mjs from breeds/${spec.source} — do not edit; re-run the intake.\n` +
    `// ${after.tris} triangles, ${after.draws} materials, ${bytes.length} bytes.\n` +
    `export default '${Buffer.from(bytes).toString('base64')}';\n`);
  const unknown = [...after.mats.keys()].filter((n) => roleOf(n) === 'RANDOM coat');
  const joints = doc.getRoot().listSkins()[0]?.listJoints().length ?? 0;
  rows.push({ breed, kind: spec.kind, before, after, bytes: bytes.length, swim: 'xyz'[swim], unknown, spec, joints, clips });
  console.log(`${breed.padEnd(11)} ${String(before.tris).padStart(6)} → ${String(after.tris).padStart(5)} tris  ${after.draws} draws  ${(bytes.length / 1024).toFixed(0)} KB${joints ? `  rig: ${joints} joints, clips ${clips.join(' ')}` : ''}${unknown.length ? `  ⚠ unroled: ${unknown.join(', ')}` : ''}`);
}

// The loader map: one lazy chunk per breed, so a scene pays only for the breeds it casts.
if (!only.length) {
  const names = Object.keys(manifest.breeds);
  writeFileSync(pathJoin(SRC_OUT, 'index.ts'),
    `// Generated by breeds/intake.mjs — do not edit; re-run the intake.\n` +
    `/** The bundled breeds, each a lazy chunk holding its GLB as base64. */\n` +
    `export const BUNDLED_BREEDS: Readonly<Record<string, () => Promise<{ default: string }>>> = {\n` +
    names.map((n) => `  ${n}: () => import('./${n}'),\n`).join('') + `};\n`);
  const table = rows.map((r) => `| ${r.breed} | ${r.kind} | ${r.before.tris} | ${r.after.tris} | ${r.before.draws} → ${r.after.draws} | ${(r.bytes / 1024).toFixed(0)} KB | ${r.swim} | ${[...r.after.mats.keys()].map((n) => `${n} (${roleOf(n)})`).join(', ')} | ${r.spec.size} | ${r.joints ? `${r.spec.motion}: ${r.joints} joints, ${r.clips.join(' ')}` : r.spec.motion} |`).join('\n');
  writeFileSync(pathJoin(HERE, 'REPORT.md'),
    `# Breed intake report\n\nGenerated by \`breeds/intake.mjs\` — the numbers the last intake produced. Review the look in the playground breed lab (\`/breeds.html?set=both\`).\n\n` +
    `| breed | kind | tris in | tris out | draws | GLB | swim axis | materials (role) | size | motion |\n|---|---|---|---|---|---|---|---|---|---|\n${table}\n`);
}
