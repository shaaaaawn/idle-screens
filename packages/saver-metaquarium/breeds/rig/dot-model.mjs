/**
 * Dot's model: breeds/source/dot.glb, voxel by voxel. EXPERIMENTAL — the first
 * CHARACTER (a named lead with its own look), not a breed of many.
 *
 *   node breeds/rig/dot-model.mjs        (from packages/saver-metaquarium)
 *
 * Dot is Geode Hollow's courier: a box of a character on two legs, arms in
 * short blue sleeves and white cartoon gloves, a mail cap, a mailbag on its
 * back, a little fish tail out of its shorts — and a face that is a screen
 * (the hackerfish's display, src/screen.ts). Drawn in the designer's style —
 * whole 2-unit cubes, flat colours, one mesh per material, every face of every
 * cube — but a character keeps its own colours: every part is PAINT-#rrggbb
 * (the same on every screen), never a coat the tank re-rolls, and its screen's
 * phosphor is fixed by its name (SCREEN-…#rrggbb).
 *
 * Axes are Blender's (Z up) and the file is glTF's (Y up): glTF (x, y, z) =
 * Blender (x, z, -y). It stands on z = 0 and faces -Y; its left is +X. A voxel
 * (i, j, k) spans x 2i-1..2i+1, y 2j-1..2j+1, z 2k..2k+2.
 *
 *   shoes    red sneakers, three long (k 0), under each leg (i ±2)
 *   legs     a white sock (k 1), orange shin and knee (k 2..4), the shorts'
 *            navy hem (k 5)
 *   body     a 7×5×8 box (k 6..13): navy shorts (k 6, 7), Dot orange above
 *   screen   the 5×5 glass on the front (j -2, k 8..12), recessed behind a
 *            navy bezel ring (j -3): the tank draws faces and thoughts on it
 *   arms     a column each side (i ±4): blue sleeve (k 12), orange arm
 *            (k 8..11), a white glove two deep (k 6, 7) — long enough to
 *            reach its face, its cap and over its shoulder
 *   cap      mail blue (k 14, 15), a brim over the bezel, a yellow badge
 *   antenna  a navy stalk out of the cap, its bulb GLOW-Antenna
 *   mailbag  on its back (j 3), letters sticking up out of it
 *   tail     a little yellow fish tail out of the back of its shorts
 */
import { Document, NodeIO } from '@gltf-transform/core';
import { fileURLToPath } from 'node:url';

export const ORANGE = 'PAINT-#ff8a2a';
export const NAVY = 'PAINT-#20243a';
export const BLUE = 'PAINT-#2f6bff';
export const YELLOW = 'PAINT-#ffc94a';
export const TAN = 'PAINT-#b07a3a';
export const WHITE = 'PAINT-#f4f1e8';
export const RED = 'PAINT-#e0373b';
export const SCREEN = 'SCREEN-Face#4fd8ff';
export const BULB = 'GLOW-Antenna';

/** Blender material colours (linear), for the .blend and the delivered look; the tank reads the names. */
const MATERIALS = {
  [ORANGE]: { color: [1.0, 0.25, 0.023] },
  [NAVY]: { color: [0.014, 0.018, 0.04] },
  [BLUE]: { color: [0.03, 0.15, 1.0] },
  [YELLOW]: { color: [1.0, 0.58, 0.07] },
  [TAN]: { color: [0.43, 0.19, 0.04] },
  [WHITE]: { color: [0.9, 0.88, 0.8] },
  [RED]: { color: [0.75, 0.04, 0.045] },
  [SCREEN]: { color: [0.02, 0.02, 0.03] },
  [BULB]: { color: [1.0, 0.2, 0.45] },
};

/** Every voxel: [i, j, k, material]. Everything above the legs sits on `HIP` (the top of the shorts' hem). */
export const HIP = 6;
export function voxels() {
  const cells = new Map();
  const put = (i, j, k, mat) => cells.set(`${i},${j},${k}`, [i, j, k, mat]);
  const up = (k) => k + HIP - 5; // the body's own rows, counted as if it sat on k 5
  for (const s of [-1, 1]) {
    // Legs: a red sneaker, a white sock, orange shin and knee, the shorts' hem.
    for (const j of [-2, -1, 0]) put(2 * s, j, 0, RED);
    put(2 * s, 0, 1, WHITE);
    for (let k = 2; k < HIP - 1; k++) put(2 * s, 0, k, ORANGE);
    put(2 * s, 0, HIP - 1, NAVY);
    // Arms: sleeve, a longer arm, a glove two deep.
    put(4 * s, 0, up(12), BLUE);
    for (const k of [8, 9, 10, 11]) put(4 * s, 0, up(k), ORANGE);
    for (const k of [6, 7]) for (const j of [-1, 0]) put(4 * s, j, up(k), WHITE);
  }
  // The body: shorts below, the glass on its front.
  for (let i = -3; i <= 3; i++) for (let j = -2; j <= 2; j++) for (let k = 5; k <= 12; k++) {
    let mat = k <= 6 ? NAVY : ORANGE;
    if (j === -2 && Math.abs(i) <= 2 && k >= 7 && k <= 11) mat = SCREEN;
    put(i, j, up(k), mat);
  }
  // The bezel: a ring a voxel proud of the front, so the glass sits back in it.
  for (let i = -3; i <= 3; i++) for (let k = 6; k <= 12; k++) {
    if (Math.abs(i) === 3 || k === 6 || k === 12) put(i, -3, up(k), NAVY);
  }
  // The cap: crown, brim over the bezel, badge.
  for (let i = -2; i <= 2; i++) {
    for (let j = -2; j <= 2; j++) put(i, j, up(13), BLUE);
    for (let j = -1; j <= 2; j++) put(i, j, up(14), BLUE);
    for (const j of [-3, -4]) put(i, j, up(13), BLUE);
  }
  put(0, -1, up(14), YELLOW);
  // The antenna, out of the crown; its bulb glows.
  put(1, 1, up(15), NAVY);
  put(1, 1, up(16), NAVY);
  put(1, 1, up(17), BULB);
  // The mailbag on its back, letters sticking up.
  for (let i = -2; i <= 2; i++) for (let k = 7; k <= 10; k++) put(i, 3, up(k), TAN);
  put(-1, 3, up(11), WHITE);
  put(1, 3, up(11), WHITE);
  // A little fish tail out of the back of its shorts.
  put(0, 3, up(5), YELLOW);
  for (const k of [4, 5, 6]) put(0, 4, up(k), YELLOW);
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
    const mat = doc.createMaterial(name).setBaseColorFactor([...spec.color, 1]).setRoughnessFactor(0.5).setMetallicFactor(0);
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
    const mesh = doc.createMesh(`Dot-${name}`).addPrimitive(prim);
    scene.addChild(doc.createNode(`Dot-${name}`).setMesh(mesh));
  }
  return doc;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = fileURLToPath(new URL('../source/dot.glb', import.meta.url));
  await new NodeIO().write(out, build());
  const v = voxels();
  const per = {};
  for (const x of v) per[x[3]] = (per[x[3]] ?? 0) + 1;
  console.log(out, v.length, 'voxels', per);
}
