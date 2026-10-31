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
 * The coat carries a baked ambient occlusion (COLOR_0, breeds.json `ao`).
 *
 * Axes are Blender's (Z up) and the file is glTF's (Y up): glTF (x, y, z) =
 * Blender (x, z, -y). The starfish lies in Blender's XY plane on z = 0 and
 * faces -Y; its left is +X. A voxel (i, j, k) spans x 2i-1..2i+1, y 2j-1..2j+1,
 * z 2k..2k+2.
 *
 *   disc    r ≤ 2.9 voxels, three layers: the face is on its top
 *   arms    five, at 36° + 72°·n from the front (two forward, two to the
 *           sides, one back), ARM_R long, each laid on a grid of its own along
 *           it (cubes square to the arm: straight edges, no stair-steps): five
 *           cells wide by the disc, three beyond, domed — three layers down the
 *           middle by the disc, thinning to one at the edges and the tip
 *   bumps   SecondaryColor tubercles, small cubes half sunk in the top, in a
 *           line zig-zagging down each arm's ridge
 *   tips    GLOW-Tips, each arm's point: its last cell and the one behind it
 *           down the middle (a real starfish's eyespots are there; the name
 *           must not contain "eye"); the rig's idle and crawl lift them
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

/** Half an arm's width at `along` voxels out (a cell is on the arm if |across| ≤ this). */
export const armHalfWidth = (along) => 2.3 - 1.55 * (along / ARM_R);
/** An arm's cells either side of its axis, `u` cells out: five wide by the disc, three down its length, and the
 *  glowing tip narrowing to a point — the arm's own end, lit (a full-width glowing paddle at the end of a
 *  thinning arm read as a separate slab stuck on). Chunky on purpose: the arms are the character (cut to the
 *  taper above on their own grid, they came out thin and spiky). */
export const armHalfCells = (u) => (u <= 4 ? 2 : u < Math.round(ARM_R) ? 1 : 0);

/** Which arm a point (voxel units) lies in, and how far out: null off the arms. */
export function armOf(x, y) {
  let best = null;
  ARM_ANGLES.forEach((th, n) => {
    const dx = Math.sin(th), dy = -Math.cos(th);
    const along = x * dx + y * dy, perp = Math.abs(x * dy - y * dx);
    if (along <= 0 || along > ARM_R + 0.5) return;
    if (perp <= armHalfWidth(along) + 0.5 && (!best || perp < best.perp)) best = { n, along, perp };
  });
  return best;
}

/**
 * An arm's layers at a cell of its own grid (u voxels out, v across): domed — three cubes thick down its
 * middle by the disc, thinning to one at its edges and toward its tip — so it reads as a ray, not a slab.
 */
export function armLayers(u, v) {
  const a = Math.abs(v);
  if (a === 0) return u <= 4 ? 3 : u <= 7 ? 2 : 1;
  if (a === 1) return u <= 5 ? 2 : 1;
  return 1;
}
const TIP_U = Math.round(ARM_R);
const ARM_SINK = 0.06;
/** Bumps (tubercles) down each arm: a small cube of SecondaryColor half sunk in the top, where these cells are. */
export const BUMP = 1.1;
// One line down each arm, zig-zagging about its ridge — the dotted line it always had, now raised (a bump in every
// other cell either side read busy, a rash, beside the starfish we drew).
const bumpAt = (u, v) => (v === 0 && u >= 4 && u <= 8 && u % 2 === 0) || (u === 3 && v === 1) || (u === 5 && v === -1) || (u === 7 && v === 1);

/**
 * Every cube. The disc is drawn on the lattice (i, j, k); each arm on a grid of its own, laid along the
 * arm (u out, v across), so its edges run straight down the arm instead of stair-stepping across the
 * lattice at 36° and 108° (seen from the side, the steps hung under every arm like teeth).
 *   { grid: 'disc' | arm index, cell: [a, b, k], mat, centre: [x, y, z] (Blender), basis: [[3], [3], [3]], size }
 */
export function cubes() {
  const out = [];
  const R = Math.ceil(DISC_R) + 1;
  for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
    if (Math.hypot(i, j) > DISC_R) continue;
    for (let k = 0; k < 3; k++) out.push({ grid: 'disc', cell: [i, j, k], mat: 'PrimaryColor', centre: [2 * i, 2 * j, 2 * k + 1], basis: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], size: 2 });
  }
  // The face, on the disc's top (k = 2): a smile toward the front…
  const smile = [[-1, -2], [0, -2], [1, -2], [-2, -1], [2, -1]];
  for (const c of out) if (c.cell[2] === 2 && smile.some(([i, j]) => c.cell[0] === i && c.cell[1] === j)) c.mat = 'EYES-Black';
  // …and the eyes above it, toward the back, each pupil its inner front voxel.
  for (const side of [-1, 1]) {
    for (const di of [1, 2]) for (const j of [0, 1]) {
      out.push({ grid: 'disc', cell: [side * di, j, 3], mat: di === 1 && j === 0 ? 'EYES-Black' : 'EYES-White', centre: [2 * side * di, 2 * j, 7], basis: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], size: 2 });
    }
  }
  ARM_ANGLES.forEach((th, n) => {
    // Across (p), out (d), up: right-handed (p × d = up), or every face of an arm's cubes winds inside out.
    const d = [Math.sin(th), -Math.cos(th), 0], p = [-Math.cos(th), -Math.sin(th), 0];
    // A hair below the disc's planes: where an arm's root overlaps the disc, their tops (and bottoms) would
    // be one plane, and two coplanar faces flicker.
    const at = (u, v, z) => [2 * u * d[0] + 2 * v * p[0], 2 * u * d[1] + 2 * v * p[1], z - ARM_SINK];
    for (let u = 2; u <= TIP_U; u++) {
      for (let v = -2; v <= 2; v++) {
        // Inside the disc the disc is the starfish (its face is drawn on it): an arm starts at its rim.
        if (Math.abs(v) > armHalfCells(u) || Math.hypot(u, v) < DISC_R) continue;
        // The light is the tip itself: the last cell and the one behind it down the middle. A whole lit paddle,
        // haloed and bloomed past its cubes, read as a glowing slab pasted over the end of the arm.
        const tip = u === TIP_U || (u === TIP_U - 1 && v === 0);
        const layers = armLayers(u, v);
        for (let k = 0; k < layers; k++) {
          out.push({ grid: n, cell: [v, u, k], mat: tip ? 'GLOW-Tips' : 'PrimaryColor', centre: at(u, v, 2 * k + 1), basis: [p, d, [0, 0, 1]], size: 2 });
        }
        if (!tip && bumpAt(u, v) && u < TIP_U - 1) {
          out.push({ grid: n, cell: [v, u, layers], mat: 'SecondaryColor', centre: at(u, v, 2 * layers + BUMP * 0.3), basis: [p, d, [0, 0, 1]], size: BUMP, bump: true });
        }
      }
    }
  });
  return out;
}

/** Every cube as [a, b, k, material] (the breed test counts twelve triangles a cube, per material). */
export function voxels() {
  return cubes().map((c) => [...c.cell, c.mat]);
}

/**
 * Ambient occlusion, per corner of every face (the classic voxel rule, as the dolphin's): of the three cubes
 * just outside the face round that corner — along its two edges and across its diagonal — how many are there.
 * Counted within the cube's own grid (the disc's, or its arm's). Written as a grey (COLOR_0) the tank multiplies
 * over the coat, so the dome's steps, the arm's root and the bumps' feet darken a little and read as sculpted.
 */
export const AO_LEVELS = [1, 0.86, 0.76, 0.68];
function aoAt(solid, grid, cell, axis, sign, corner) {
  const [a, b] = [0, 1, 2].filter((x) => x !== axis);
  const out = [...cell]; out[axis] += sign;
  const has = (da, db) => { const q = [...out]; q[a] += da; q[b] += db; return solid.has(`${grid}|${q.join(',')}`) ? 1 : 0; };
  const s1 = has(corner[a], 0), s2 = has(0, corner[b]), c = has(corner[a], corner[b]);
  return AO_LEVELS[s1 && s2 ? 3 : s1 + s2 + c];
}

// A cube's six faces: (axis, sign) and its four corners, wound outward, in the cube's own axes.
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
  const all = cubes();
  const solid = new Set(all.filter((c) => !c.bump).map((c) => `${c.grid}|${c.cell.join(',')}`));
  const byMat = new Map();
  for (const c of all) (byMat.get(c.mat) ?? byMat.set(c.mat, []).get(c.mat)).push(c);
  for (const [name, spec] of Object.entries(MATERIALS)) {
    const cells = byMat.get(name) ?? [];
    if (!cells.length) continue;
    const mat = doc.createMaterial(name).setBaseColorFactor([...spec.color, 1])
      .setRoughnessFactor(spec.roughness).setMetallicFactor(spec.metal ?? 0);
    const pos = [], nrm = [], idx = [], col = [];
    // The coat takes the occlusion (the tank multiplies COLOR_0 over it); eyes and glow stay as drawn.
    const shaded = name === 'PrimaryColor' || name === 'SecondaryColor';
    for (const c of cells) {
      const h = c.size / 2, [bx, by, bz] = c.basis;
      for (const [axis, sign, quad] of FACES) {
        const base = pos.length / 3;
        for (const q of quad) {
          const b = [0, 1, 2].map((m) => c.centre[m] + (bx[m] * q[0] + by[m] * q[1] + bz[m] * q[2]) * h);
          pos.push(b[0], b[2], -b[1]); // Blender → glTF
          if (shaded) { const g = c.bump ? 1 : aoAt(solid, c.grid, c.cell, axis, sign, q); col.push(g, g, g); }
        }
        const nv = [bx, by, bz][axis].map((x) => x * sign);
        for (let m = 0; m < 4; m++) nrm.push(nv[0], nv[2], -nv[1]);
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    const prim = doc.createPrimitive().setMaterial(mat)
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nrm)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(idx)).setBuffer(buffer));
    if (shaded) prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(new Float32Array(col)).setBuffer(buffer));
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
