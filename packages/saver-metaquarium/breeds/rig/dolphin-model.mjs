/**
 * The dolphin's model: breeds/source/dolphin.glb, voxel by voxel. EXPERIMENTAL.
 *
 *   node breeds/rig/dolphin-model.mjs        (from packages/saver-metaquarium)
 *
 * Dot's friend: a bottlenose dolphin drawn in the designer's style (whole
 * 2-unit cubes, flat colours, one mesh per material, every face of every
 * cube). A character, like Dot, so its colours are its own (PAINT-#rrggbb,
 * never a coat the tank re-rolls). Everything that says DOLPHIN and not shark:
 *
 *   flukes   the tail fin lies FLAT (wide in x, one cube thin), swept back
 *            with a notch in the middle; it beats up and down (the shark's
 *            stands on edge and sweeps side to side)
 *   beak     a short rostrum, low on the head, the lower jaw a little longer
 *   melon    the round forehead rising steeply behind the beak: the step
 *            between them is the dolphin's face
 *   smile    a dark mouth line down each side of the beak that turns UP at
 *            the corner; a pink tongue on the lower jaw (seen when it chatters)
 *   eyes     big, on the sides of the head above the mouth's corner: a white
 *            box proud of the skin, a 2×2 pupil on its outer face (the rig
 *            puts a catchlight on it), a dark stripe over each
 *   cheeks   a pink blush under each eye
 *   blowhole on top of the head, behind the melon
 *   dorsal   low and curved, hooked back (a shark's is a tall triangle)
 *   flippers small, low on the chest, swept down and back
 *   colours  countershaded: a blue-grey cape on the back, paler blue flanks,
 *            a cream belly and lower jaw
 *
 * Axes are Blender's (Z up) and the file is glTF's (Y up): glTF (x, y, z) =
 * Blender (x, z, -y). It faces -Y; its left is +X. A voxel (i, j, k) spans
 * x 2i-1..2i+1, y 2j-1..2j+1, z 2k..2k+2. Nose tip at j -11, fluke tips at j 12: 24 cubes long, 8 tall, 7 wide.
 */
import { Document, NodeIO } from '@gltf-transform/core';
import { fileURLToPath } from 'node:url';

export const CAPE = 'PAINT-#2f7ddb';
export const FLANK = 'PAINT-#6fb8ee';
export const BELLY = 'PAINT-#e4f1fb';
export const LINE = 'PAINT-#14243a';
export const TONGUE = 'PAINT-#ff6f8e';
export const BLUSH = 'PAINT-#ff8fb0';
export const WHITE = 'EYES-White';
export const BLACK = 'EYES-Black';

const linear = (hex) => [1, 3, 5].map((o) => {
  const c = parseInt(hex.slice(o, o + 2), 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
const paint = (name) => ({ color: linear(name.slice(name.indexOf('#'))) });

/** Blender material colours (linear); the tank reads the names. */
const MATERIALS = {
  [CAPE]: paint(CAPE), [FLANK]: paint(FLANK), [BELLY]: paint(BELLY), [LINE]: paint(LINE),
  [TONGUE]: paint(TONGUE), [BLUSH]: paint(BLUSH),
  [WHITE]: { color: [0.85, 0.85, 0.85], roughness: 0.4 },
  [BLACK]: { color: [0, 0, 0], roughness: 0.1, metal: 1 },
};

/**
 * The body, drawn by hand at the house scale (the dori is 7 × 17 × 9 cubes,
 * the blowfish 14 × 12 × 10): row j → [bottom k, top k, half-width]. Big
 * cubes, a chubby cartoon dolphin, a silhouette you read at a glance.
 *
 *   j -11..-10  the bottle nose: short, three rows tall, three wide
 *   j  -9       the melon rises behind it
 *   j  -8..3    head and body, eight tall, seven wide
 *   j   4..9    tapering to the tail stock, narrow and tall
 *   j  10..12   the flukes (FLUKES), flat
 */
export const ROWS = {
  [-11]: [1, 3, 1], [-10]: [1, 3, 1],
  [-9]: [1, 6, 2],
  [-8]: [0, 7, 3], [-7]: [0, 7, 3], [-6]: [0, 7, 3], [-5]: [0, 7, 3], [-4]: [0, 7, 3], [-3]: [0, 7, 3],
  [-2]: [0, 7, 3], [-1]: [0, 7, 3], [0]: [0, 7, 3], [1]: [0, 7, 3], [2]: [1, 7, 3], [3]: [1, 7, 3],
  [4]: [1, 6, 2], [5]: [2, 6, 2], [6]: [2, 6, 2],
  [7]: [3, 5, 1], [8]: [3, 5, 1], [9]: [3, 5, 1],
};
/** Where the jaws meet: the lower jaw is j <= JAW_J, k <= JAW_K (its top row the mouth). */
export const JAW_J = -9;
export const JAW_K = 2;

/** Whether cell (i, j, k) lies inside the body: its row's box with the long edges bevelled, so it reads round. */
export function inBody(i, j, k) {
  const r = ROWS[j];
  if (!r) return false;
  const [bot, top, hw] = r;
  if (k < bot || k > top || Math.abs(i) > hw) return false;
  // Bevel: the outermost column drops its top and bottom cells (a wide row its two).
  const edge = hw - Math.abs(i);
  const cut = hw >= 3 ? (edge === 0 ? 2 : edge === 1 ? 1 : 0) : hw === 2 ? (edge === 0 ? 1 : 0) : 0;
  return k >= bot + cut && k <= top - cut;
}

/** The outermost body cell of row (j, k), as |i| (-1: none). */
export function outer(j, k) {
  for (let i = 4; i >= 0; i--) if (inBody(i, j, k)) return i;
  return -1;
}

/** The flukes, seen from above: row j as the cells either side of the middle (x = |i|); a notch at the middle. */
const FLUKES = [
  [10, [0, 1, 2]],
  [11, [1, 2, 3, 4]],
  [12, [3, 4, 5]],
];
export const FLUKE_K = 4;
/** The dorsal fin: [k, j from, j to], one cube thin on the midline, hooked back. */
const DORSAL = [[8, -1, 2], [9, 1, 3]];
/** Each flipper: [|i|, j, k] cells, out from the chest, swept back and down. */
const FLIPPER = [[4, -5, 1], [4, -4, 1], [5, -4, 0], [5, -3, 0]];
/** The eye: a big googly white, a cube proud of the head's side (|i| = EYE.i), the pupil front and low on it. */
export const EYE = { i: 4, j: [-7, -5], k: [3, 5] };
export const PUPIL = { j: [-7, -6], k: [3, 4] };

export function voxels() {
  const cells = new Map();
  const put = (i, j, k, mat) => cells.set(`${i},${j},${k}`, [i, j, k, mat]);
  const paintAt = (i, j, k, mat) => { const c = cells.get(`${i},${j},${k}`); if (c) c[3] = mat; };
  // The body, countershaded: cape over flanks over belly.
  for (const [js, [bot, top]] of Object.entries(ROWS)) {
    const j = Number(js);
    for (let i = -4; i <= 4; i++) for (let k = 0; k <= 8; k++) {
      if (!inBody(i, j, k)) continue;
      let mat = k >= top - 2 ? CAPE : k <= bot + 2 ? BELLY : FLANK;
      if (j <= -10) mat = k === 3 ? CAPE : BELLY;          // the nose: blue above, pale jaw
      if (j <= JAW_J && k <= JAW_K - 1) mat = BELLY;
      put(i, j, k, mat);
    }
  }
  for (const s of [-1, 1]) {
    // The smile: the mouth row along the nose and the cheek, its corner turned up toward the eye.
    for (let j = -11; j <= -9; j++) { const o = outer(j, JAW_K); if (o >= 0) paintAt(s * o, j, JAW_K, LINE); }
    { const o = outer(-8, JAW_K + 1); if (o >= 0) paintAt(s * o, -8, JAW_K + 1, LINE); }
    // The eye: white cubes proud of the side (filled behind), the pupil on them.
    for (let j = EYE.j[0]; j <= EYE.j[1]; j++) for (let k = EYE.k[0]; k <= EYE.k[1]; k++) {
      for (let i = 0; i < EYE.i; i++) if (!cells.has(`${s * i},${j},${k}`)) put(s * i, j, k, FLANK);
      const pupil = j >= PUPIL.j[0] && j <= PUPIL.j[1] && k >= PUPIL.k[0] && k <= PUPIL.k[1];
      put(s * EYE.i, j, k, pupil ? BLACK : WHITE);
    }
    // A blush under the eye, behind the smile's corner.
    for (const j of [-6, -5]) { const o = outer(j, EYE.k[0] - 1); if (o >= 0) paintAt(s * o, j, EYE.k[0] - 1, BLUSH); }
  }
  // The tongue: the mouth row's middle, inside (seen when it opens its mouth).
  for (let j = -11; j <= -9; j++) for (let i = -1; i <= 1; i++) {
    const c = cells.get(`${i},${j},${JAW_K}`);
    if (c && Math.abs(i) < outer(j, JAW_K)) c[3] = TONGUE;
  }
  // The blowhole, on top behind the melon, flush.
  paintAt(0, -6, 7, LINE);
  // The dorsal fin.
  for (const [k, a, b] of DORSAL) for (let j = a; j <= b; j++) put(0, j, k, CAPE);
  // The flippers.
  for (const s of [-1, 1]) for (const [i, j, k] of FLIPPER) if (!cells.has(`${s * i},${j},${k}`)) put(s * i, j, k, FLANK);
  // The flukes, flat.
  for (const [j, xs] of FLUKES) for (const x of xs) for (const s of x ? [-1, 1] : [1]) {
    if (!cells.has(`${s * x},${j},${FLUKE_K}`)) put(s * x, j, FLUKE_K, CAPE);
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
    const mat = doc.createMaterial(name).setBaseColorFactor([...spec.color, 1]).setRoughnessFactor(spec.roughness ?? 0.5).setMetallicFactor(spec.metal ?? 0);
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
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(idx)).setBuffer(buffer));
    const mesh = doc.createMesh(`Dolphin-${name}`).addPrimitive(prim);
    scene.addChild(doc.createNode(`Dolphin-${name}`).setMesh(mesh));
  }
  return doc;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = fileURLToPath(new URL('../source/dolphin.glb', import.meta.url));
  await new NodeIO().write(out, build());
  const v = voxels();
  const per = {};
  for (const x of v) per[x[3]] = (per[x[3]] ?? 0) + 1;
  console.log(out, v.length, 'voxels', per);
}
