/**
 * The snail's model: breeds/source/snail.glb, voxel by voxel. EXPERIMENTAL.
 *
 *   node breeds/rig/snail-model.mjs        (from packages/saver-metaquarium)
 *
 * Our third in-house breed, a floor creature in the designer's style (after
 * rig/starfish-model.mjs and rig/octopus-model.mjs): whole 2-unit cubes, flat
 * colours, a coat the tank repaints per fish (PrimaryColor, SecondaryColor),
 * a glowing accent (GLOW-), big white eyes with black pupils and a black
 * smile (EYES-). Written the way the designer's models arrive — one mesh per
 * material, every face of every cube, each face its own four vertices — so it
 * goes through the same rig (rig/snail.py) and intake as theirs.
 *
 * Axes are Blender's (Z up) and the file is glTF's (Y up): glTF (x, y, z) =
 * Blender (x, z, -y). It sits on z = 0 and faces -Y; its left is +X. A voxel
 * (i, j, k) spans x 2i-1..2i+1, y 2j-1..2j+1, z 2k..2k+2.
 *
 *   foot     the long sole on the floor (k 0), i ±2, from the head (j -5)
 *            back to a tapering tail (j 7)
 *   body     a layer over the sole (k 1, j -4..5), rising to the neck (k 2)
 *   head     a block at the front, i ±2, j -8..-5, k 0..3, the smile on its
 *            front face (corners up)
 *   feelers  the lower tentacles: two voxels forward off the head's front
 *            corners on the floor, their tips GLOW-Feelers (no "eye" in it)
 *   stalks   the upper tentacles: a column of three on the head's top (i ±2,
 *            j -7, k 4..6), each carrying an eye
 *   eyes     3×3×2 white blocks centred on the stalks (i 1..3, k 7..9), each
 *            pupil a 2×2 on the front face, inner and low at rest (rig/snail.py
 *            makes it one sliding quad with a catchlight)
 *   shell    the silhouette: a fat disc on the back, its axis across the body
 *            (X), SHELL_R round, centred over j 1.5, k 6.2; three widths
 *            (|i| ≤ 1 full, 2 a little in, 3 a dome cap) so it reads round,
 *            and on each flank a SecondaryColor spiral of SPIRAL_TURNS
 *            turns, wound from the rim into the apex
 */
import { Document, NodeIO } from '@gltf-transform/core';
import { fileURLToPath } from 'node:url';

export const SHELL_R = 5.6;
export const SHELL_J = 1.5;
export const SHELL_K = 6.2;
const SPIRAL_TURNS = 1.6;
/** The shell's radius at each half-width |i|: full in the middle, rounder toward the flanks. */
const SHELL_LAYERS = { 0: SHELL_R, 1: SHELL_R, 2: SHELL_R - 0.6, 3: SHELL_R - 2.2 };

const MATERIALS = {
  PrimaryColor: { color: [0.75, 0.32, 0.12], roughness: 0.5 },
  SecondaryColor: { color: [0.95, 0.78, 0.45], roughness: 0.5 },
  'PAINT-#6f9a62': { color: [0.16, 0.32, 0.12], roughness: 0.6 },
  'GLOW-Feelers': { color: [0.3, 0.9, 0.7], roughness: 0.5 },
  'EYES-White': { color: [0.8, 0.8, 0.8], roughness: 0.4 },
  'EYES-Black': { color: [0, 0, 0], roughness: 0.1, metal: 1 },
};
const FLESH = 'PAINT-#6f9a62';

/** Is (j, k) on the shell's spiral band? Polar about the shell's centre: an
 *  Archimedean spiral from the rim (angle 0, at the top) into the apex. */
export function onSpiral(j, k) {
  const dj = j - SHELL_J, dk = k - SHELL_K;
  const r = Math.hypot(dj, dk);
  if (r < 0.8) return true; // the apex
  const pitch = SHELL_R / SPIRAL_TURNS;
  // Angle round from the top, toward the front (-j) — the coil winds forward.
  const th = (Math.atan2(-dj, dk) + 2 * Math.PI) % (2 * Math.PI);
  for (let turn = 0; turn <= SPIRAL_TURNS + 1; turn++) {
    const rs = SHELL_R - pitch * (turn + th / (2 * Math.PI)) - 0.6;
    if (rs > 0 && Math.abs(r - rs) < 0.5) return true;
  }
  return false;
}

/** Every voxel: [i, j, k, material]. */
export function voxels() {
  const cells = new Map();
  const put = (i, j, k, mat) => cells.set(`${i},${j},${k}`, [i, j, k, mat]);
  // The sole, tapering to the tail.
  for (let j = -5; j <= 7; j++) {
    const w = j <= 4 ? 2 : j <= 5 ? 1 : 0;
    for (let i = -w; i <= w; i++) put(i, j, 0, FLESH);
  }
  // The body over it, rising to the neck.
  for (let j = -4; j <= 5; j++) for (let i = -1; i <= 1; i++) put(i, j, 1, FLESH);
  for (let j = -4; j <= -2; j++) for (let i = -1; i <= 1; i++) put(i, j, 2, FLESH);
  // The head.
  for (let j = -8; j <= -5; j++) for (let k = 0; k <= 3; k++) for (let i = -2; i <= 2; i++) put(i, j, k, FLESH);
  // …its smile on the front face, corners up.
  for (const [i, k] of [[-1, 1], [0, 1], [1, 1], [-2, 2], [2, 2]]) put(i, -8, k, 'EYES-Black');
  // The feelers, forward off the head's lower corners; their tips glow.
  for (const s of [-1, 1]) {
    put(2 * s, -9, 0, FLESH);
    put(2 * s, -10, 0, 'GLOW-Feelers');
  }
  // The stalks and their eyes: each eye 3 wide, 3 tall and 2 deep, centred on
  // its stalk, its pupil a 2×2 on the front face (inner and low at rest; the
  // rig slides it, and lays a catchlight on it).
  for (const s of [-1, 1]) {
    for (let k = 4; k <= 6; k++) put(2 * s, -7, k, FLESH);
    for (const di of [1, 2, 3]) for (const j of [-8, -7]) for (const k of [7, 8, 9]) {
      put(s * di, j, k, j === -8 && di <= 2 && k <= 8 ? 'EYES-Black' : 'EYES-White');
    }
  }
  // The shell, layer by layer across the body, the spiral on each flank's outermost voxel.
  const R = Math.ceil(SHELL_R) + 1;
  for (const [ai, rad] of Object.entries(SHELL_LAYERS)) {
    const a = Number(ai);
    for (let j = Math.floor(SHELL_J - R); j <= SHELL_J + R; j++) {
      for (let k = 1; k <= SHELL_K + R; k++) {
        const r = Math.hypot(j - SHELL_J, k - SHELL_K);
        if (r > rad) continue;
        const outer = a === 3 || r > (SHELL_LAYERS[a + 1] ?? -1);
        const mat = outer && a > 0 && onSpiral(j, k) ? 'SecondaryColor' : 'PrimaryColor';
        for (const i of a === 0 ? [0] : [-a, a]) put(i, j, k, mat);
      }
    }
  }
  return [...cells.values()];
}

// A cube's six faces: (axis, sign) and its four corners, wound outward.
const FACES = [
  [0, 1, [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
  [0, -1, [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
  [1, 1, [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
  [1, -1, [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
  [2, 1, [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
  [2, -1, [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]]],
];

export function build() {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('Scene');
  const byMat = new Map();
  for (const v of voxels()) (byMat.get(v[3]) ?? byMat.set(v[3], []).get(v[3])).push(v);
  for (const [name, spec] of Object.entries(MATERIALS)) {
    const cells = byMat.get(name) ?? [];
    if (!cells.length) continue;
    const mat = doc.createMaterial(name).setBaseColorFactor([...spec.color, 1])
      .setRoughnessFactor(spec.roughness).setMetallicFactor(spec.metal ?? 0);
    const pos = [], nrm = [], idx = [];
    for (const [i, j, k] of cells) {
      const c = [2 * i, 2 * j, 2 * k + 1]; // Blender centre
      for (const [axis, sign, quad] of FACES) {
        const base = pos.length / 3;
        for (const q of quad) {
          const b = [c[0] + q[0], c[1] + q[1], c[2] + q[2]];
          pos.push(b[0], b[2], -b[1]); // Blender → glTF
        }
        const n = [0, 0, 0]; n[axis] = sign;
        for (let m = 0; m < 4; m++) nrm.push(n[0], n[2], -n[1]);
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    const prim = doc.createPrimitive().setMaterial(mat)
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nrm)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idx)).setBuffer(buffer));
    const mesh = doc.createMesh(`Snail-${name}`).addPrimitive(prim);
    scene.addChild(doc.createNode(`Snail-${name}`).setMesh(mesh));
  }
  return doc;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = fileURLToPath(new URL('../source/snail.glb', import.meta.url));
  await new NodeIO().write(out, build());
  const v = voxels();
  const per = {};
  for (const x of v) per[x[3]] = (per[x[3]] ?? 0) + 1;
  console.log(out, v.length, 'voxels', per);
}
