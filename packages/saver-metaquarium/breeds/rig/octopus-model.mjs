/**
 * The octopus's model: breeds/source/octopus.glb, voxel by voxel.
 *
 *   node breeds/rig/octopus-model.mjs        (from packages/saver-metaquarium)
 *
 * Our second in-house breed, in the designer's style (the starfish was the
 * first, rig/starfish-model.mjs): whole 2-unit cubes, flat colours, a coat the
 * tank repaints per fish (PrimaryColor, SecondaryColor), a glowing accent
 * (GLOW-), big white eyes with black pupils. Written the way the designer's
 * models arrive — one mesh per material, every face of every cube, each face
 * its own four vertices — so it goes through the same rig (rig/octopus.py)
 * and intake as theirs.
 *
 * Axes are Blender's (Z up) and the file is glTF's (Y up): glTF (x, y, z) =
 * Blender (x, z, -y). It sits on z = 0 and faces -Y; its left is +X. A voxel
 * (i, j, k) spans x 2i-1..2i+1, y 2j-1..2j+1, z 2k..2k+2.
 *
 *   crown   the arms' root: a disc r ≤ 3, two layers, on the floor
 *   mantle  the head: a big round bulb from k 2 to 11, widest (r 4.6) at
 *           k 6-7, leaning back as it rises — an octopus's mantle sits
 *           behind and above its eyes
 *   eyes    two big white eyes, 4 wide and 3 tall, low on the bulb's front
 *           and proud of it (j -5, k 3..5), a voxel apart; each pupil a
 *           HORIZONTAL BAR, 2 by 1, in
 *           the middle — an octopus's slit pupil (rig/octopus.py keeps it
 *           level with the world, as a real octopus does)
 *   brows   a ridge of SecondaryColor over each eye (k 6): it raises them
 *   siphon  the jet's nozzle, a stub on its left side (i 4..6, k 3)
 *   arms    eight, leaving at 22.5° + 45°·n from the front and sweeping
 *           round as they reach, all the same way (a pinwheel: CURL), from
 *           r 2 to ARM_R, tapering from 1.4 voxels either side of the
 *           centreline to 0.5; two
 *           layers to r 4.5, then one; the tip curls UP (its last stretch a
 *           layer higher, the pale underside showing) — the octopus pose
 *   spots   SecondaryColor freckles over the mantle
 *   rings   GLOW-Rings: a few bright spots on the mantle and one on each
 *           arm, after the blue-ringed octopus, which flashes its rings
 */
import { Document, NodeIO } from '@gltf-transform/core';
import { fileURLToPath } from 'node:url';

export const ARM_R = 12.5;
export const ARM_ROOT = 2;
export const ARM_THICK = 4.5;
const CROWN_R = 3;
/** Arm axes, radians from the front (-Y) toward the octopus's left (+X). */
export const ARM_ANGLES = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => ((22.5 + 45 * n) * Math.PI) / 180);
/** The mantle's radius at each layer k, and how far back its centre leans (voxels): a big round bulb behind and above the eyes. */
const MANTLE = { 2: 3.2, 3: 3.8, 4: 4.2, 5: 4.5, 6: 4.6, 7: 4.6, 8: 4.4, 9: 4.0, 10: 3.3, 11: 2.3 };
const lean = (k) => 0.3 * Math.max(0, k - 3);
/** How far each arm sweeps round as it reaches out (radians at its tip). Every arm curls the same way — a
 *  pinwheel: arms curling opposite ways meet their neighbours, however gently they curl. */
const CURL = 0.7;

const MATERIALS = {
  PrimaryColor: { color: [0.8, 0.22, 0.12], roughness: 0.5 },
  SecondaryColor: { color: [0.9, 0.62, 0.5], roughness: 0.5 },
  'GLOW-Rings': { color: [0.1, 0.55, 0.9], roughness: 0.5 },
  'EYES-White': { color: [0.8, 0.8, 0.8], roughness: 0.4 },
  'EYES-Black': { color: [0, 0, 0], roughness: 0.1, metal: 1 },
};

/** Arm n's centreline at `along` voxels out: it sweeps round as it reaches, the octopus's curl. */
export function armPoint(n, along) {
  const u = Math.max(0, (along - ARM_ROOT) / (ARM_R - ARM_ROOT));
  const th = ARM_ANGLES[n] + CURL * u * u;
  return { x: Math.sin(th) * along, y: -Math.cos(th) * along, th };
}

/** An arm's half-width at `along`: 1.4 voxels at its root, 0.5 at its tip. */
export const armWidth = (along) => 1.4 - 0.9 * Math.max(0, (along - ARM_ROOT) / (ARM_R - ARM_ROOT));

/** Which arm a cell (voxel units, centre) lies in, and how far out along it: null off the arms. */
export function armOf(x, y) {
  let best = null;
  for (let n = 0; n < ARM_ANGLES.length; n++) {
    for (let along = ARM_ROOT; along <= ARM_R; along += 0.1) {
      const p = armPoint(n, along);
      const perp = Math.hypot(x - p.x, y - p.y);
      if (perp <= armWidth(along) && (!best || perp < best.perp)) best = { n, along, perp };
    }
  }
  return best;
}

const hash = (i, j, k) => {
  const h = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453;
  return h - Math.floor(h);
};

/** Every voxel: [i, j, k, material]. */
export function voxels() {
  const cells = new Map();
  const put = (i, j, k, m) => cells.set(`${i},${j},${k}`, [i, j, k, m]);
  const has = (i, j, k) => cells.has(`${i},${j},${k}`);
  const R = Math.ceil(ARM_R) + 1;
  // The crown and the arms, on the floor.
  for (let i = -R; i <= R; i++) {
    for (let j = -R; j <= R; j++) {
      const crown = Math.hypot(i, j) <= CROWN_R;
      const arm = armOf(i, j);
      if (!crown && !arm) continue;
      if (crown || arm.along < ARM_THICK) { put(i, j, 0, 'PrimaryColor'); put(i, j, 1, 'PrimaryColor'); continue; }
      // The tip curls up: its very end a layer higher, its pale underside
      // showing, standing on the arm (not a cube floating at its corner).
      put(i, j, 0, 'PrimaryColor');
      if (arm.along > ARM_R - 0.9) put(i, j, 1, 'SecondaryColor');
    }
  }
  // The mantle: a dome leaning back.
  for (const [ks, r] of Object.entries(MANTLE)) {
    const k = Number(ks), jc = lean(k);
    for (let i = -5; i <= 5; i++) for (let j = -6; j <= 6; j++) {
      if (Math.hypot(i, (j - jc) * 0.95) <= r) put(i, j, k, 'PrimaryColor');
    }
  }
  // Freckles on the mantle's skin (a cell with open air beside it, not the face).
  for (const [key, c] of cells) {
    const [i, j, k] = c;
    if (k < 5 || j <= -2) continue;
    const open = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1]].some(([a, b, d]) => !has(i + a, j + b, k + d));
    if (open && hash(i, j, k) < 0.09) cells.set(key, [i, j, k, 'SecondaryColor']);
  }
  // Rings that glow: three a side on the mantle, one on each arm.
  // Rings that glow: on the bulb's flanks, and one on each arm — each clear
  // of a joint (rig/octopus.py blends there), so each is one bone's light.
  for (const [i, j, k] of [[4, 2, 5], [4, 3, 8], [2, 4, 10], [-4, 2, 5], [-4, 3, 8], [-2, 4, 10]]) {
    if (has(i, j, k)) cells.set(`${i},${j},${k}`, [i, j, k, 'GLOW-Rings']);
  }
  ARM_ANGLES.forEach((_, n) => {
    const p = armPoint(n, 5.75), i = Math.round(p.x), j = Math.round(p.y);
    if (has(i, j, 0)) cells.set(`${i},${j},0`, [i, j, 0, 'GLOW-Rings']);
  });
  // The eyes, low on the front of the bulb and proud of it: white, a
  // horizontal bar of a pupil in the middle row, the head filled in behind.
  for (const side of [-1, 1]) {
    for (let di = 1; di <= 4; di++) for (let k = 3; k <= 5; k++) {
      const pupil = k === 4 && (di === 2 || di === 3);
      put(side * di, -5, k, pupil ? 'EYES-Black' : 'EYES-White');
      for (let j = -4; j <= -2; j++) if (!has(side * di, j, k)) put(side * di, j, k, 'PrimaryColor');
    }
    // The brow: a ridge over the eye, set back a little into the bulb.
    for (let di = 1; di <= 4; di++) {
      put(side * di, -5, 6, 'SecondaryColor');
      for (let j = -4; j <= -2; j++) if (!has(side * di, j, 6)) put(side * di, j, 6, 'PrimaryColor');
    }
  }
  // Between the eyes, down to the crown: the head is whole.
  for (let k = 2; k <= 6; k++) for (let j = -4; j <= -2; j++) if (!has(0, j, k)) put(0, j, k, 'PrimaryColor');
  // The siphon: a stub out of its left side, low — its root on the head.
  put(4, 1, 3, 'SecondaryColor'); put(5, 1, 3, 'SecondaryColor'); put(6, 1, 3, 'SecondaryColor');
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
    const big = pos.length / 3 > 65535;
    const prim = doc.createPrimitive().setMaterial(mat)
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nrm)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(big ? new Uint32Array(idx) : new Uint16Array(idx)).setBuffer(buffer));
    const mesh = doc.createMesh(`Octopus-${name}`).addPrimitive(prim);
    scene.addChild(doc.createNode(`Octopus-${name}`).setMesh(mesh));
  }
  return doc;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = fileURLToPath(new URL('../source/octopus.glb', import.meta.url));
  await new NodeIO().write(out, build());
  const v = voxels();
  const per = {};
  for (const x of v) per[x[3]] = (per[x[3]] ?? 0) + 1;
  console.log(out, v.length, 'voxels', per);
}
