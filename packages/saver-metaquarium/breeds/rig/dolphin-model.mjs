/**
 * The dolphin's model: breeds/source/dolphin.glb, voxel by voxel. EXPERIMENTAL.
 *
 *   node breeds/rig/dolphin-model.mjs        (from packages/saver-metaquarium)
 *
 * Dot's friend: a cartoon bottlenose, in the designer's style (whole 2-unit
 * cubes, flat colours, one mesh per material, every face of every cube) and
 * at the shark's grain (~40 cubes nose to flukes). A character, like Dot, so
 * its colours are its own (PAINT-#rrggbb, never a coat the tank re-rolls).
 *
 * Drawn the way the cartoon dolphins are: the body is a SMOOTH spline — a
 * centreline that arches (head lifted, tail dropping) and a thickness that
 * swells from a short rounded beak into a round melon and tapers in one long
 * curve to a slim tail stock — so the cubes follow clean curves, never kinks.
 *
 *   beak     short and rounded, low on the head; the lower jaw pale
 *   melon    the round forehead rising behind it
 *   smile    a dark line along the beak that curves UP to just under the
 *            eye; a pink tongue on the lower jaw (seen when it chatters)
 *   eyes     big and round, on the sides of the head above the smile's end:
 *            a white patch flush with the skin, a 2×2 pupil front and low
 *            (the rig gives it a catchlight), a blush behind
 *   blowhole on top, behind the melon
 *   dorsal   tall and curved, swept back past its base
 *   flippers swept back along the chest, out and a little down
 *   flukes   FLAT (wide in x, one cube thin), a crescent with pointed tips
 *            and a notch: they beat up and down (a shark's stands on edge)
 *   colours  a rich blue back over a soft pale belly; the line between runs
 *            from the jaw under the eye, dips behind the flipper and sweeps
 *            back along the flank to the tail
 *
 * It also writes rig/dolphin-anatomy.json — which cubes are jaw, flipper,
 * blowhole, and where the spine's joints sit — so rig/dolphin.py reads its
 * anatomy from the drawing instead of a copy of it.
 *
 * Axes are Blender's (Z up) and the file is glTF's (Y up): glTF (x, y, z) =
 * Blender (x, z, -y). It faces -Y; its left is +X. A voxel (i, j, k) spans
 * x 2i-1..2i+1, y 2j-1..2j+1, z 2k..2k+2; along the body, cell n (j = n - 18)
 * spans s n..n+1, beak tip at s 0.
 */
import { Document, NodeIO } from '@gltf-transform/core';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The body is SKIN- (lit as a coat: its faces shade by where they point); the accents are PAINT- (they glow a little, to pop).
export const CAPE = 'SKIN-#1f6fd1';
export const BELLY = 'SKIN-#d9ecfa';
/** The blues by which way the skin faces, as a real bottlenose (and a cel-shaded cartoon) wears them:
 *  a darker cape along the spine, CAPE on the upper sides, a lighter flank above the pale belly. */
export const BACK = 'SKIN-#1858b4';
export const FLANK = 'SKIN-#3f8fe6';
export const LINE = 'PAINT-#0f2238';
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
  [CAPE]: paint(CAPE), [BELLY]: paint(BELLY), [BACK]: paint(BACK), [FLANK]: paint(FLANK), [LINE]: paint(LINE), [TONGUE]: paint(TONGUE), [BLUSH]: paint(BLUSH),
  [WHITE]: { color: [0.85, 0.85, 0.85], roughness: 0.4 },
  [BLACK]: { color: [0, 0, 0], roughness: 0.1, metal: 1 },
};

/** The body: knots [s, centre z, half-height, half-width] in cube units, beak tip at s 0. */
export const BODY = [
  [0, 3.9, 1.0, 1.0],
  [2.5, 3.9, 1.3, 1.2],
  [4.5, 4.0, 1.6, 1.5],     // the beak's root
  [5.5, 5.6, 3.3, 2.4],     // the melon rises: a round forehead over the beak
  [7, 6.1, 4.2, 3.2],
  [9, 6.3, 4.4, 3.5],       // the eyes
  [12, 6.5, 4.8, 3.7],
  [15, 6.5, 4.9, 3.7],      // thickest, a third of the way back
  [18, 6.3, 4.5, 3.3],
  [22, 6.0, 3.6, 2.6],      // the taper starts at the dorsal, as a real one's does
  [26, 5.7, 2.6, 1.6],
  [29, 5.5, 2.0, 0.9],      // the tail stock: a KEEL, tall and one cube thin,
  [31.5, 5.4, 1.7, 0.5],    // deep all the way into the flukes (round and thin,
  [33.5, 5.4, 1.3, 0.45],   // it read as a stick, the dolphin as a swordfish)
  [34, 5.4, 1.1, 0.4],
];
export const LENGTH = 34;
/** The arch: the head lifted a little, the tail dropping in a long curve (cube units of z at s). */
export const arch = (s) => (s < 14 ? 0.6 * (1 - s / 14) ** 2 : -0.008 * (s - 14) ** 2);

/** Catmull-Rom through the knots, per field: smooth, through every knot, no overshoot to speak of. */
function spline(knots, s, f) {
  if (s <= knots[0][0]) return knots[0][f];
  if (s >= knots[knots.length - 1][0]) return knots[knots.length - 1][f];
  let n = 0;
  while (knots[n + 1][0] < s) n++;
  const p0 = knots[Math.max(0, n - 1)], p1 = knots[n], p2 = knots[n + 1], p3 = knots[Math.min(knots.length - 1, n + 2)];
  const u = (s - p1[0]) / (p2[0] - p1[0]);
  // Tangents by the knots' spacing (centripetal-ish): uneven knots do not overshoot.
  const m1 = ((p2[f] - p0[f]) / (p2[0] - p0[0] || 1)) * (p2[0] - p1[0]);
  const m2 = ((p3[f] - p1[f]) / (p3[0] - p1[0] || 1)) * (p2[0] - p1[0]);
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p1[f] + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2[f] + (u3 - u2) * m2;
}

/** The body's section at s: centre z, half-height, half-width. */
export function section(s) {
  return { zc: spline(BODY, s, 1) + arch(s), h: spline(BODY, s, 2), w: spline(BODY, s, 3) };
}

/** Whether cell (i, n, k) is inside the body (the section's ellipse, at the cell's centre). */
export function inBody(i, n, k) {
  if (n < BEAK_N) return BEAK[n]?.[k]?.includes(Math.abs(i)) ?? false;
  const s = n + 0.5;
  if (s < 0 || s > LENGTH) return false;
  const { zc, h, w } = section(s);
  const dx = i / (w + 0.35), dz = (k + 0.5 - zc) / (h + 0.35);
  return dx * dx + dz * dz <= 1;
}

/** The outermost body cell of (n, k), as |i| (-1: none). */
export function outer(n, k) {
  for (let i = 6; i >= 0; i--) if (inBody(i, n, k)) return i;
  return -1;
}

/**
 * The beak, drawn by hand cube by cube: at one to three cubes across, an ellipse sampled per cube comes
 * out ragged (holes in its ridge, a lip line that steps). Per row n (0 the tip), per layer k, the |i|
 * it fills: a rounded tip, a pale lower jaw three wide, the lips (the mouth's row: dark on the outside,
 * the tongue hidden inside), the blue upper beak, and its ridge rising into the melon.
 */
export const BEAK_N = 5;
export const BEAK = [
  { 3: [0], 4: [0] },
  { 2: [0], 3: [0, 1], 4: [0, 1], 5: [0] },
  { 2: [0, 1], 3: [0, 1], 4: [0, 1], 5: [0, 1] },
  { 2: [0, 1], 3: [0, 1], 4: [0, 1], 5: [0, 1] },
  { 2: [0, 1], 3: [0, 1], 4: [0, 1], 5: [0, 1] },
];
/** The mouth's row on the beak (the lips, the jaw's top), and the smile's cubes up the cheek to the eye: [n, k]. */
export const MOUTH_K = 3;
const SMILE = [[5, 3], [6, 4]];
/** The jaw: the beak's cubes at and below the mouth's row; it hinges at the beak's root. */
const isJaw = (n, k) => n < BEAK_N && k <= MOUTH_K;
/** Where the belly's pale meets the back's blue: centre + o·half-height, o by s. */
const BELLY_LINE = [[5, -0.25], [8, -0.3], [10, -0.3], [13, -0.5], [17, -0.15], [22, -0.3], [27, -0.65], [31, -1.2]];
const bellyO = (s) => spline(BELLY_LINE.map(([a, o]) => [a, o]), s, 1);

/** The eye: white cells (n × k) flush with the side of the head; the pupil front and low on them. */
export const EYE = { n: [7, 9], k: [5, 8] };
export const PUPIL = { n: [7, 8], k: [5, 6] };
/** The dorsal fin: [k above the back, n from, n to] — one cube thin, its tip swept back past its base. */
const DORSAL = [[1, 14, 21], [2, 16, 22], [3, 18, 22], [4, 20, 23], [5, 22, 23]];
/** Each flipper: [|i| beyond the skin, n, k] — out from the chest, back, and a little down. */
const FLIPPER = [[1, 11, 4], [1, 12, 4], [2, 12, 3], [2, 13, 3], [3, 13, 3], [3, 14, 2], [4, 14, 2], [4, 15, 2]];
/** The flukes, seen from above: for |i| = x, the cells n from lead(x) to trail(x) — a crescent, pointed tips, a notch.
 *  Sized to the real thing (Fish 1998, Tursiops): span ~0.25 of the body (a cartoon's a little more, 11 of 37 cubes),
 *  the leading edge swept back ~31°, a root chord of ~8%. Wider and swept further, seen edge-on they were a long stick. */
export const FLUKE_X = 5;
const flukeLead = (x) => 32 + 0.6 * x;
const flukeTrail = (x) => 34.8 + 0.72 * x - 0.03 * x * x;

export function voxels() {
  return draw().cells;
}

/** The drawing: every cell [i, j, k, material], and the parts the rig needs (anatomy). */
export function draw() {
  const cells = new Map();
  const parts = {};
  const key = (i, n, k) => `${i},${n - 18},${k}`;
  const put = (i, n, k, mat, part) => { cells.set(key(i, n, k), [i, n - 18, k, mat]); if (part) parts[key(i, n, k)] = part; };
  const get = (i, n, k) => cells.get(key(i, n, k));
  const N = Math.ceil(LENGTH);
  // The body, two-toned: the jaw pale below the smile, the belly below its line.
  for (let n = 0; n < N; n++) for (let i = -6; i <= 6; i++) for (let k = 0; k <= 13; k++) {
    if (!inBody(i, n, k)) continue;
    const s = n + 0.5, z = k + 0.5, { zc, h } = section(s);
    const jaw = isJaw(n, k);
    // The jaw and the cheek under the smile are pale; then the belly, below its line.
    const smileK = SMILE.find(([sn]) => sn === n)?.[1];
    const pale = n < BEAK_N ? k < MOUTH_K || (n === 0 && k === MOUTH_K) : smileK !== undefined ? k < smileK : z < zc + bellyO(s) * h;
    // The blues by the way the skin faces: the section's outward normal, its upward share (ellipse gradient).
    const gx = i / (section(s).w + 0.35) ** 2, gz = (z - zc) / (h + 0.35) ** 2, up = gz / (Math.hypot(gx, gz) || 1);
    const blue = n < BEAK_N ? CAPE : up > 0.8 ? BACK : up > 0.2 ? CAPE : FLANK;
    put(i, n, k, pale ? BELLY : blue, jaw ? 'jaw' : null);
  }
  for (const side of [-1, 1]) {
    // The smile: on the skin, a line along the beak curving up toward the eye.
    // The lips along the beak (the mouth's row, outside), then the smile up the cheek in one clean diagonal.
    for (let n = 2; n < BEAK_N; n++) { const o = outer(n, MOUTH_K); if (o > 0) get(side * o, n, MOUTH_K)[3] = LINE; }
    get(0, 1, MOUTH_K)[3] = LINE; // across the front, behind the tip: a closed mouth, head on
    for (const [n, k] of SMILE) { const o = outer(n, k); if (o > 0) get(side * o, n, k)[3] = LINE; }
    // The eye: white cells on the skin (the head is upright there, so it lies flush), the pupil on them.
    let ei = 0;
    for (let n = EYE.n[0]; n <= EYE.n[1]; n++) for (let k = EYE.k[0]; k <= EYE.k[1]; k++) ei = Math.max(ei, outer(n, k));
    for (let n = EYE.n[0]; n <= EYE.n[1]; n++) for (let k = EYE.k[0]; k <= EYE.k[1]; k++) {
      for (let i = 0; i < ei; i++) if (!get(side * i, n, k)) put(side * i, n, k, CAPE);
      const pupil = n >= PUPIL.n[0] && n <= PUPIL.n[1] && k >= PUPIL.k[0] && k <= PUPIL.k[1];
      put(side * ei, n, k, pupil ? BLACK : WHITE);
    }
    // A blush behind the smile's end, under the eye's back.
    for (const n of [EYE.n[1], EYE.n[1] + 1]) { const k = EYE.k[0] - 1, o = outer(n, k); if (o >= 0) get(side * o, n, k)[3] = BLUSH; }
    // The flippers.
    for (const [di, n, k] of FLIPPER) {
      const root = outer(11, 4);
      if (!get(side * (root + di), n, k)) put(side * (root + di), n, k, CAPE, `flipper.${side > 0 ? 'L' : 'R'}`);
    }
  }
  // The tongue: the jaw's top row, inside (seen when it opens its mouth).
  for (let n = 2; n < BEAK_N; n++) { const c = get(0, n, MOUTH_K); if (c) c[3] = TONGUE; }
  // The blowhole, on top behind the melon.
  { const n = 12; let k = 13; while (k > 0 && !get(0, n, k)) k--; get(0, n, k)[3] = LINE; parts[key(0, n, k)] = 'blowhole'; }
  // The dorsal fin, on the back: its rows stand on the back's height at the fin's middle; where the back
  // falls away under the first row, the fin fills down to it, so it grows out of the body.
  const backK = (n) => { let k = 13; while (k > 0 && !inBody(0, n, k)) k--; return k; };
  const base = backK(18);
  for (const [up, a, b] of DORSAL) for (let n = a; n <= b; n++) {
    const from = up === 1 ? backK(n) + 1 : base + up;
    for (let k = from; k <= base + up; k++) if (!get(0, n, k)) put(0, n, k, CAPE);
  }
  // The flukes, flat: one cube thin at the tail's height.
  const kf = Math.floor(section(LENGTH - 1).zc);
  for (let x = 0; x <= FLUKE_X; x++) for (let n = Math.floor(flukeLead(x)); n <= Math.ceil(flukeTrail(x)); n++) {
    const s = n + 0.5;
    if (s < flukeLead(x) || s > flukeTrail(x)) continue;
    for (const side of x ? [-1, 1] : [1]) if (!get(side * x, n, kf)) put(side * x, n, kf, CAPE);
  }
  // The spine's joints, the jaw's hinge and the blowhole, in model units (Blender axes): y = 2(s - 18.5), z = 2·(cube z).
  const Y = (s) => 2 * (s - 18.5), Z = (s) => 2 * section(s).zc;
  const anatomy = {
    $comment: 'Written by rig/dolphin-model.mjs: the parts rig/dolphin.py cuts and where its joints sit (model units, Blender axes). Do not edit.',
    parts,
    knots: [[Y(9), 'head'], [Y(13), 'body'], [Y(18), 'body'], [Y(22.5), 'tail1'], [Y(28), 'tail2'], [Y(31.5), 'flukes']],
    joints: {
      head: [Y(11), Z(11)], body: [Y(15), Z(15)], tail1: [Y(20), Z(20)], tail2: [Y(25.5), Z(25.5)], flukes: [Y(30), Z(30)],
      tip: [Y(0), Z(0)], end: [Y(LENGTH + 4), Z(LENGTH)],
    },
    hinge: [Y(BEAK_N), 2 * (MOUTH_K + 1)],
  };
  return { cells: [...cells.values()], anatomy };
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
  writeFileSync(fileURLToPath(new URL('./dolphin-anatomy.json', import.meta.url)), `${JSON.stringify(draw().anatomy, null, 1)}\n`);
  const v = voxels();
  const per = {};
  for (const x of v) per[x[3]] = (per[x[3]] ?? 0) + 1;
  console.log(out, v.length, 'voxels', per);
}
