/**
 * The starfish's model: breeds/source/starfish.glb, voxel by voxel.
 *
 *   node breeds/rig/starfish-model.mjs        (from packages/saver-metaquarium)
 *
 * Every other breed arrived from our designer. The starfish is the first we
 * drew ourselves, in their style: whole 2-unit cubes, flat colours, a coat
 * the tank repaints per fish (PrimaryColor, SecondaryColor), a glowing accent
 * (GLOW-), big white eyes with black pupils and a black smile (EYES-). It is
 * written the way their models arrive — one mesh per material, every face of
 * every cube, each face its own four vertices — so it goes through the same
 * rig (rig/starfish.py) and intake as theirs, and the rig never edits it.
 *
 * Axes are Blender's (Z up) and the file is glTF's (Y up): glTF (x, y, z) =
 * Blender (x, z, -y). The starfish lies in Blender's XY plane on z = 0 and
 * faces -Y; its left is +X. A voxel (i, j, k) spans x 2i-1..2i+1, y 2j-1..2j+1,
 * z 2k..2k+2.
 *
 *   disc    r ≤ 2.9 voxels, three layers: the face is on its top
 *   arms    five, at 36° + 72°·n from the front (two forward, two to the
 *           sides, one back), tapering from 2.3 voxels either side of the
 *           axis to 0.75, ARM_R long; two layers to ARM_THICK, then one
 *   dots    SecondaryColor down each arm's spine, every other voxel
 *   tips    GLOW-Tips, the last TIP_LEN of each arm (a real starfish's
 *           eyespots are there; the name must not contain "eye")
 *   face    two eyes on top of the disc (2×2 white, the inner front voxel a
 *           black pupil) behind a black smile set into the disc's top
 */
import { Document, NodeIO } from '@gltf-transform/core';
import { fileURLToPath } from 'node:url';

export const ARM_R = 10.5;
export const ARM_THICK = 5;
export const TIP_LEN = 1.6;
const DISC_R = 2.9;
/** Arm axes, radians from the front (-Y) toward the starfish's left (+X). */
export const ARM_ANGLES = [0, 1, 2, 3, 4].map((n) => ((36 + 72 * n) * Math.PI) / 180);

const MATERIALS = {
  PrimaryColor: { color: [0.8, 0.2, 0.04], roughness: 0.5 },
  SecondaryColor: { color: [0.8, 0.55, 0.1], roughness: 0.5 },
  'GLOW-Tips': { color: [0.8, 0.2, 0.42], roughness: 0.5 },
  'EYES-White': { color: [0.8, 0.8, 0.8], roughness: 0.4 },
  'EYES-Black': { color: [0, 0, 0], roughness: 0.1, metal: 1 },
};

/** Which arm a cell (voxel units, centre) lies in, and how far out: null off the arms. */
export function armOf(x, y) {
  let best = null;
  ARM_ANGLES.forEach((th, n) => {
    const dx = Math.sin(th), dy = -Math.cos(th);
    const along = x * dx + y * dy, perp = Math.abs(x * dy - y * dx);
    if (along <= 0 || along > ARM_R) return;
    const w = 2.3 - 1.55 * (along / ARM_R);
    if (perp <= w && (!best || perp < best.perp)) best = { n, along, perp };
  });
  return best;
}

/** Every voxel: [i, j, k, material]. */
export function voxels() {
  const out = [];
  const R = Math.ceil(ARM_R) + 1;
  for (let i = -R; i <= R; i++) {
    for (let j = -R; j <= R; j++) {
      const r = Math.hypot(i, j);
      const arm = armOf(i, j);
      const disc = r <= DISC_R;
      if (!disc && !arm) continue;
      const layers = disc ? 3 : arm.along < ARM_THICK ? 2 : 1;
      for (let k = 0; k < layers; k++) {
        let mat = 'PrimaryColor';
        if (arm && !disc && arm.along > ARM_R - TIP_LEN) mat = 'GLOW-Tips';
        else if (arm && !disc && k === layers - 1 && arm.perp < 0.75 && arm.along > 3.5 && Math.round(arm.along) % 2 === 1) mat = 'SecondaryColor';
        out.push([i, j, k, mat]);
      }
    }
  }
  // The face, on the disc's top (k = 2): a smile toward the front…
  const smile = [[-1, -2], [0, -2], [1, -2], [-2, -1], [2, -1]];
  for (const v of out) if (v[2] === 2 && smile.some(([i, j]) => v[0] === i && v[1] === j)) v[3] = 'EYES-Black';
  // …and the eyes above it, toward the back, each pupil its inner front voxel.
  for (const side of [-1, 1]) {
    for (const di of [1, 2]) for (const j of [0, 1]) out.push([side * di, j, 3, di === 1 && j === 0 ? 'EYES-Black' : 'EYES-White']);
  }
  return out;
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
    const mesh = doc.createMesh(`Starfish-${name}`).addPrimitive(prim);
    scene.addChild(doc.createNode(`Starfish-${name}`).setMesh(mesh));
  }
  return doc;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = fileURLToPath(new URL('../source/starfish.glb', import.meta.url));
  await new NodeIO().write(out, build());
  const v = voxels();
  const per = {};
  for (const x of v) per[x[3]] = (per[x[3]] ?? 0) + 1;
  console.log(out, v.length, 'voxels', per);
}
