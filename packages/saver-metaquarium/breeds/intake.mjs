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
 *      KEEP-<anything> (the authored colour, kept), METAL-<anything> (polished
 *      metal: chrome or a lit reflective plate), SCREEN-<anything> (a display the
 *      tank draws: src/screen.ts). Anything else is painted a
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
import { cullHidden, faceOf, jointsOf, trianglesOf } from './cull.mjs';

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
  : /glow/i.test(name) ? 'glow' : /^KEEP-/.test(name) ? 'kept' : /^METAL-/.test(name) ? 'metal' : /^SCREEN-/.test(name) ? 'screen' : /^VIVID-\d{1,3}$/.test(name) ? `vivid ${name.slice(6)}%` : /^PAINT-#[0-9a-f]{6}$/i.test(name) ? `paint ${name.slice(6)}` : /primary/i.test(name) ? 'coat A' : /secondary/i.test(name) ? 'coat B' : 'RANDOM coat';

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
/** Skin weights as normalized bytes that still sum to exactly 255. */
function bytes(w) {
  const b = [...w].map((x) => Math.round(x * 255));
  b[b.indexOf(Math.max(...b))] += 255 - b.reduce((a, x) => a + x, 0);
  return b;
}

function greedy(doc, voxel, swim, spine = swim, mergeBends = true) {
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
  // Decals. Where two materials lie on one cell, facing one way, they
  // z-fight: the crab's mouth on its body, the shark's teeth on its jaw. The
  // decal wins — an eye always, else the smaller material — and the face under
  // it goes. In a rig only within one part (a face on another part is
  // uncovered the moment the parts move), except under an eye: an eye rides
  // its own bone flush on the head, and the face beneath it would z-fight.
  const claims = new Map(); const area = new Map();
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const name = p.getMaterial()?.getName() ?? '';
    const joints = jointsOf(p);
    trianglesOf(p).forEach((tri, t) => {
      const f = faceOf(tri); if (!f) return;
      const j = isEye(name) ? '*' : joints ? joints[t] : 0;
      for (const c of cellsOf(f)) {
        const k = `${planeKey(f)}|${c}|${j}`;
        (claims.get(k) ?? claims.set(k, new Set()).get(k)).add(name);
        area.set(name, (area.get(name) ?? 0) + 1);
      }
    });
  }
  const rank = (name) => (isEye(name) ? -1 : area.get(name) ?? 0);
  // An eye off the body's lattice (the shark's sits a third of a voxel over)
  // shares no cell with the face under it, yet covers most of it. Those
  // rectangles are cut around the eye instead.
  const eyeRects = new Map();
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    if (!isEye(p.getMaterial()?.getName() ?? '')) continue;
    for (const tri of trianglesOf(p)) {
      const f = faceOf(tri); if (!f) continue;
      const k = `${f.axis}|${f.sign}|${snap(f.plane)}`;
      (eyeRects.get(k) ?? eyeRects.set(k, []).get(k)).push([f.u0, f.u1, f.v0, f.v1]);
    }
  }
  const eps = voxel / 40;
  // R minus every eye rectangle on its plane: up to four strips per cut.
  const cut = (R, eyes) => {
    let out = [R];
    for (const [a0, a1, b0, b1] of eyes) {
      const next = [];
      for (const [u0, u1, v0, v1] of out) {
        if (a0 >= u1 - eps || a1 <= u0 + eps || b0 >= v1 - eps || b1 <= v0 + eps) { next.push([u0, u1, v0, v1]); continue; }
        const lo = Math.max(u0, a0), hi = Math.min(u1, a1);
        if (lo - u0 > eps) next.push([u0, lo, v0, v1]);
        if (u1 - hi > eps) next.push([hi, u1, v0, v1]);
        if (b0 - v0 > eps) next.push([lo, hi, v0, b0]);
        if (v1 - b1 > eps) next.push([lo, hi, b1, v1]);
      }
      out = next;
    }
    return out;
  };
  const covered = (name, key, c, j) => [j, '*'].some((jj) => [...(claims.get(`${key}|${c}|${jj}`) ?? [])].some((o) => o !== name && rank(o) < rank(name)));
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const name = p.getMaterial()?.getName() ?? '';
    if (isEye(name)) continue;
    const planes = new Map(); const loose = [];
    const jAttr = p.getAttribute('JOINTS_0'), wAttr = p.getAttribute('WEIGHTS_0');
    const skinAt = new Map();
    // Every corner's skin, bending or not: a quad can bend in one triangle and
    // not its twin (three corners alike, the fourth not), and then its fourth
    // corner is only here. Consulted only where the bending faces are silent,
    // so a breed that never needed it merges exactly as before.
    const anySkinAt = new Map();
    const posKey = (q) => q.map((x) => Math.round(x / (voxel / 40))).join(',');
    // Rigged: a part per joint, each merged on its own.
    const joints = jointsOf(p);
    trianglesOf(p).forEach((tri, t) => {
      const bone = joints ? joints[t] : 0;
      const f = faceOf(tri);
      // Off-grid geometry, and a blending face (its corners weigh differently),
      // pass through untouched, with their own skin.
      const skin = () => [0, 1, 2].map((k) => ({ j: jAttr.getElement(t * 3 + k, []), w: wAttr.getElement(t * 3 + k, []) }));
      if (!f) { loose.push({ tri, bone, skin: joints && bone < 0 ? skin() : null }); return; }
      if (joints) skin().forEach((c, k) => { if (!anySkinAt.has(posKey(tri[k]))) anySkinAt.set(posKey(tri[k]), c); });
      if (bone < 0) {
        // A bending face: remember each corner's skin by where it is. Merged
        // rectangles take their corners' skins from here, and never merge
        // along the swim axis, the one the spine bends along.
        skin().forEach((c, k) => skinAt.set(posKey(tri[k]), c));
      }
      const key = planeKey(f);
      let pl = planes.get(`${key}|${bone}`); if (!pl) { pl = { f, bone, cells: new Set() }; planes.set(`${key}|${bone}`, pl); }
      // A triangle is half its rectangle; its twin marks the same cells.
      for (const c of cellsOf(f)) if (!covered(name, key, c, bone)) pl.cells.add(c);
    });
    // A quad that bends in one triangle and not its twin: both halves claimed
    // the face, so it would be drawn twice, each copy skinned its own way.
    // The bending half wins it (its corners carry the blend; anySkinAt has
    // the rigid corner).
    for (const [k, pl] of planes) {
      if (pl.bone < 0) continue;
      const bending = planes.get(`${k.slice(0, k.lastIndexOf('|'))}|-1`);
      if (bending) for (const c of bending.cells) pl.cells.delete(c);
    }
    const pos = [], jnt = [], wgt = [];
    for (const { f, bone, cells } of planes.values()) {
      const bends = bone < 0;
      // A breed whose parts bend every which way (the octopus's arms radiate
      // and curl: `mergeBends: false`) keeps its bending faces as drawn —
      // a merged one would need a source vertex at every corner.
      const canU = f.ua !== swim && (!bends || (mergeBends && f.ua !== spine)), canV = f.va !== swim && (!bends || (mergeBends && f.va !== spine));
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
        const R = [pu + i * voxel, pu + (i + w) * voxel, pv + j * voxel, pv + (j + h) * voxel];
        const corner = (uu, vv) => { const q = [0, 0, 0]; q[f.axis] = f.plane; q[f.ua] = uu; q[f.va] = vv; return q; };
        const eyes = eyeRects.get(`${f.axis}|${f.sign}|${snap(f.plane)}`) ?? [];
        // A bending rectangle's corners take the source's skins; a corner a cut
        // makes blends its rectangle's four, as the skin does across the face.
        const at = (q) => {
          const sk = skinAt.get(posKey(q)) ?? anySkinAt.get(posKey(q)); if (sk) return sk;
          const tu = (q[f.ua] - R[0]) / (R[1] - R[0]), tv = (q[f.va] - R[2]) / (R[3] - R[2]);
          const mix = new Map();
          for (const [uu, vv, k] of [[R[0], R[2], (1 - tu) * (1 - tv)], [R[1], R[2], tu * (1 - tv)], [R[1], R[3], tu * tv], [R[0], R[3], (1 - tu) * tv]]) {
            const c = skinAt.get(posKey(corner(uu, vv))) ?? anySkinAt.get(posKey(corner(uu, vv)));
            if (!c) throw new Error(`${name}: a bending rectangle's corner has no source vertex at ${corner(uu, vv)}`);
            c.j.forEach((jj, i) => mix.set(jj, (mix.get(jj) ?? 0) + k * c.w[i]));
          }
          const top = [...mix.entries()].filter(([, w]) => w > 1e-6).sort((a, b) => b[1] - a[1]).slice(0, 4);
          const sum = top.reduce((a, [, w]) => a + w, 0);
          while (top.length < 4) top.push([0, 0]);
          return { j: top.map(([jj]) => jj), w: top.map(([, w]) => w / sum) };
        };
        for (const [u0, u1, v0, v1] of eyes.length ? cut(R, eyes) : [R]) {
          const q = [corner(u0, v0), corner(u1, v0), corner(u1, v1), corner(u0, v1)];
          // Wind so the face points the way the source's did.
          const e1 = [0, 1, 2].map((k) => q[1][k] - q[0][k]), e2 = [0, 1, 2].map((k) => q[2][k] - q[0][k]);
          const nz = e1[(f.axis + 1) % 3] * e2[(f.axis + 2) % 3] - e1[(f.axis + 2) % 3] * e2[(f.axis + 1) % 3];
          for (const o of Math.sign(nz) === f.sign ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]) {
            pos.push(...q[o]);
            if (!bends) { jnt.push(bone, 0, 0, 0); wgt.push(255, 0, 0, 0); continue; }
            const sk = at(q[o]);
            jnt.push(...sk.j); wgt.push(...bytes(sk.w));
          }
        }
      }
    }
    for (const { tri, bone, skin } of loose) tri.forEach((c, k) => {
      pos.push(...c);
      if (!skin) { jnt.push(Math.max(0, bone), 0, 0, 0); wgt.push(255, 0, 0, 0); return; }
      jnt.push(...skin[k].j); wgt.push(...bytes(skin[k].w));
    });
    p.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)));
    if (joints) {
      p.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(new Uint8Array(jnt)));
      // Normalized bytes: a rigid part's weight is exactly 1 (255/255).
      p.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setNormalized(true).setArray(new Uint8Array(wgt)));
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

/** One primitive per bone for the materials named (breeds.json `splitByBone`):
 *  a glow material spread over several moving parts (the starfish's five tips)
 *  becomes one small light per part, each riding its own bone — a small glow
 *  stays lit in the neon look, and its bloom and light follow the tip. Runs on
 *  unindexed, rigid primitives (after greedy and flatNormals). */
function splitByBone(doc, names) {
  for (const mesh of doc.getRoot().listMeshes()) for (const p of [...mesh.listPrimitives()]) {
    if (!names.includes(p.getMaterial()?.getName()) || p.getIndices()) continue;
    const joints = jointsOf(p); if (!joints) continue;
    if (joints.includes(-1)) throw new Error(`${p.getMaterial().getName()}: splitByBone needs rigid parts`);
    const parts = [...new Set(joints)].sort((a, b) => a - b); if (parts.length < 2) continue;
    for (const j of parts) {
      const q = doc.createPrimitive().setMaterial(p.getMaterial()).setMode(p.getMode());
      for (const sem of p.listSemantics()) {
        const a = p.getAttribute(sem), size = a.getElementSize(), src = a.getArray();
        const out = new src.constructor(joints.filter((x) => x === j).length * 3 * size);
        let o = 0;
        joints.forEach((x, t) => { if (x === j) { out.set(src.subarray(t * 3 * size, (t + 1) * 3 * size), o); o += 3 * size; } });
        q.setAttribute(sem, doc.createAccessor().setType(a.getType()).setArray(out).setNormalized(a.getNormalized()));
      }
      mesh.addPrimitive(q);
    }
    p.dispose();
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
    // A rig's clips are `<breed>:<clip>` (several breeds share one .blend, and
    // actions are file-global); keep this breed's, by their own names. And a
    // shared .blend suffixes a second `PrimaryColor` as `PrimaryColor.001`.
    for (const anim of doc.getRoot().listAnimations()) {
      const [owner, clip] = anim.getName().split(':');
      if (clip === undefined) continue;
      if (owner === breed) anim.setName(clip); else anim.dispose();
    }
    // Names that only say where in the .blend it was built: never the breed's.
    // A suffix the delivered model wrote itself (`Material.002`) stays.
    const authored = new Set((await io.read(pathJoin(HERE, spec.delivered ?? spec.source))).getRoot().listMaterials().map((m) => m.getName()));
    for (const m of doc.getRoot().listMaterials()) if (!authored.has(m.getName())) m.setName(m.getName().replace(/\.\d{3}$/, ''));
    for (const m of [...doc.getRoot().listMeshes(), ...doc.getRoot().listNodes()]) m.setName(m.getName().replace(/\.\d{3}$/, ''));
    for (const scene of doc.getRoot().listScenes()) scene.setName('Scene');
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
    const buried = cullHidden(doc, pitchOf(doc));
    if (buried) console.log(`${breed.padEnd(11)} culled ${buried} buried faces`);
    // The swim-axis rule protects the body wave, which never bends a skinned
    // mesh (swimwave.ts): a rig's parts are rigid, so they merge every way.
    greedy(doc, pitchOf(doc), rigged ? -1 : swim, swim, spec.mergeBends !== false);
  } else {
    await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, spec.triBudget / before.tris), error: spec.error ?? 0.002, lockBorder: false }), unweld());
  }
  flatNormals(doc);
  if (rigged && spec.splitByBone) splitByBone(doc, spec.splitByBone);
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
