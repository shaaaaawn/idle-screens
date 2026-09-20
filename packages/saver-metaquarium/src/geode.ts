/**
 * Geode homes — the inhabitants' architecture, grown rather than built.
 *
 * A geode is the one object in this world that already IS a house: a dull
 * stone that, broken open, turns out to be lined with light. So a home is a
 * real geode first and a dwelling second:
 *
 *   MINERAL (faceted):  a seed-displaced boulder, broken along a jagged plane;
 *                       the break shows an agate rind — quartz, then the home's
 *                       colour — and a throat of crystal teeth pointing inward,
 *                       white-hot at the root like every crystal here.
 *   LIVING  (voxel):    a plank facade recessed into the throat, a round door
 *                       with a brass knob, a lit round window, a lamp on a
 *                       bracket, steps down to the floor, a chimney through
 *                       the roof that vents bubbles.
 *
 * That split is the world's one rule — minerals are faceted, the living and
 * the made are voxel — and the geode is where the two meet.
 *
 * Three habits so a village is not three copies: `cottage`, the long low
 * `hall`, and the upright `tower`. Everything is seeded; nothing is fetched.
 * Geometry comes back as loose parts for the scenery's batches, so any number
 * of homes stays three draw calls.
 */

import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, IcosahedronGeometry, Matrix4, Quaternion, Vector3,
} from 'three';
import type { CrystalRng, Emitter } from './crystals';
import { painted } from './scenery-paint';

export type GeodeHabit = 'cottage' | 'hall' | 'tower';
export const GEODE_HABITS: readonly GeodeHabit[] = ['cottage', 'hall', 'tower'];

/** Unit-space proportions [x, y, z] and how far back the break sits. */
const HABIT: Readonly<Record<GeodeHabit, { stretch: readonly [number, number, number]; cut: number; size: number }>> = {
  cottage: { stretch: [1, 0.92, 0.95], cut: 0.3, size: 23 },
  hall: { stretch: [1.35, 0.88, 1], cut: 0.26, size: 27 },
  tower: { stretch: [0.86, 1.36, 0.9], cut: 0.34, size: 21 },
};

export interface GeodeSpec {
  x: number; y: number; z: number;
  /** Yaw, radians: which way the opening looks. */
  facing: number;
  habit: GeodeHabit;
  /** The home's crystal colour (hex) — its rind and its teeth. */
  tint: string;
  scale: number;
}

export interface GeodeParts {
  /** Shaded stone and planks. */
  stone: BufferGeometry[];
  voxels: BufferGeometry[];
  /** Unshaded: teeth, rind, window, lamp — the things that are light. */
  glow: BufferGeometry[];
  vent: { x: number; y: number; z: number; color: string };
  emitter: Emitter;
  obstacle: { x: number; y: number; z: number; r: number; h: number };
  /** The foot of the front steps, on the floor: where a path to this door begins. */
  doorstep: { x: number; z: number };
  radius: number;
  triangles: number;
}

const WARM = '#ffc36b';
/** Facade radius in unit space — small enough that the crystal throat frames it. */
const FACADE_R = 0.5;

/** Loose triangles with per-vertex colours → a geometry the batches can merge. */
function soup(positions: number[], colors: number[], place: Matrix4): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  g.applyMatrix4(place);
  g.computeVertexNormals();
  return g;
}

export function buildGeode(spec: GeodeSpec, rng: CrystalRng): GeodeParts {
  const h = HABIT[spec.habit];
  const r = h.size * spec.scale * rng.range(0.9, 1.12);
  const [sx, sy, sz] = h.stretch;
  // The home rests IN the floor: a third of it is buried, so it reads as a
  // stone that was always here rather than a ball set down on a plane.
  const cy = spec.y + r * sy * 0.62;
  const place = new Matrix4().compose(
    new Vector3(spec.x, cy, spec.z),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), spec.facing),
    new Vector3(r, r, r),
  );

  // ---- the stone --------------------------------------------------------
  const ico = new IcosahedronGeometry(1, 2);
  const src = ico.getAttribute('position');
  // One displacement per UNIQUE vertex (keyed by position), or the facets
  // tear apart where their corners disagree.
  const bump = new Map<string, number>();
  const brng = rng.fork(11);
  const lump = (x: number, y: number, z: number): number => {
    const k = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let v = bump.get(k);
    if (v === undefined) { v = brng.range(0.9, 1.1); bump.set(k, v); }
    return v;
  };
  const verts: Vector3[] = [];
  for (let i = 0; i < src.count; i += 1) {
    const x = src.getX(i), y = src.getY(i), z = src.getZ(i);
    const k = lump(x, y, z);
    verts.push(new Vector3(x * k * sx, y * k * sy, z * k * sz));
  }
  ico.dispose();

  // The break: a tilted plane with a seeded wobble, so the rim is jagged the
  // way a struck stone is and no two homes share an outline.
  const tiltX = rng.range(-0.12, 0.12), tiltY = rng.range(-0.18, 0.05);
  const wob = rng.range(0, Math.PI * 2);
  const broken = (p: Vector3): boolean =>
    p.z + p.x * tiltX + p.y * tiltY + Math.sin(Math.atan2(p.y, p.x) * 5 + wob) * 0.05 > h.cut;

  const stoneP: number[] = [], stoneC: number[] = [];
  const glowP: number[] = [], glowC: number[] = [];
  const dark = new Color('#2b3546'), darker = new Color('#1d2432');
  const tint = new Color(spec.tint);
  const quartz = new Color('#efe6f6');
  const cavity = tint.clone().multiplyScalar(0.16);
  const push = (arr: number[], col: number[], p: Vector3, c: Color): void => {
    arr.push(p.x, p.y, p.z); col.push(c.r, c.g, c.b);
  };
  const edgeCount = new Map<string, { a: Vector3; b: Vector3; n: number }>();
  const key = (p: Vector3): string => `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`;
  const kept: Array<[Vector3, Vector3, Vector3]> = [];
  for (let i = 0; i < verts.length; i += 3) {
    const a = verts[i]!, b = verts[i + 1]!, c = verts[i + 2]!;
    const mid = new Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3);
    if (broken(mid)) continue;
    kept.push([a, b, c]);
    // Strata: the stone darkens toward its buried base.
    const shade = dark.clone().lerp(darker, Math.max(0, -mid.y));
    for (const p of [a, b, c]) push(stoneP, stoneC, p, shade);
    for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
      const k = [key(p), key(q)].sort().join('|');
      const e = edgeCount.get(k);
      if (e) e.n += 1; else edgeCount.set(k, { a: p, b: q, n: 1 });
    }
  }

  // The rind, across every edge the break left open: stone → quartz → colour.
  const INNER = 0.84, MID = 0.92;
  for (const e of edgeCount.values()) {
    if (e.n !== 1) continue;
    const bands: Array<[number, number, Color, Color]> = [
      [1, MID, quartz, quartz],
      [MID, INNER, tint.clone().lerp(quartz, 0.35), tint],
    ];
    for (const [o, i, co, ci] of bands) {
      const a0 = e.a.clone().multiplyScalar(o), b0 = e.b.clone().multiplyScalar(o);
      const a1 = e.a.clone().multiplyScalar(i), b1 = e.b.clone().multiplyScalar(i);
      for (const [p, c] of [[a0, co], [b0, co], [b1, ci], [a0, co], [b1, ci], [a1, ci]] as const) push(glowP, glowC, p, c);
    }
  }

  // The throat: the inner wall, and a crystal tooth on most of its facets —
  // only where the opening can see them. White-hot root, saturated tip: the
  // same emissive-without-HDR rule the free-standing crystals use.
  const trng = rng.fork(12);
  const hot = tint.clone().lerp(new Color('#ffffff'), 0.75);
  for (const [a, b, c] of kept) {
    const ia = a.clone().multiplyScalar(INNER), ib = b.clone().multiplyScalar(INNER), ic = c.clone().multiplyScalar(INNER);
    const mid = new Vector3().add(ia).add(ib).add(ic).multiplyScalar(1 / 3);
    const deep = cavity.clone().lerp(tint, Math.max(0, mid.z + 0.55) * 0.35);
    for (const p of [ia, ic, ib]) push(glowP, glowC, p, deep); // wound inward
    // Teeth ring the throat; none behind the facade, where they would spear
    // through the planks and turn a house into a hedgehog.
    const ringR = Math.hypot(mid.x / sx, mid.y / sy);
    if (mid.z < h.cut - 0.62 || ringR < FACADE_R + 0.1 || trng.next() < 0.15) continue;
    const len = trng.range(0.14, 0.34) * (mid.z > h.cut - 0.25 ? 1.25 : 1);
    const tip = mid.clone().multiplyScalar(1 - len / Math.max(0.2, mid.length()))
      .add(new Vector3(trng.range(-0.04, 0.04), trng.range(-0.04, 0.04), trng.range(-0.04, 0.04)));
    const tipC = tint.clone().multiplyScalar(trng.range(0.85, 1.15));
    for (const [p, q] of [[ia, ib], [ib, ic], [ic, ia]] as const) {
      push(glowP, glowC, p, hot); push(glowP, glowC, tip, tipC); push(glowP, glowC, q, hot);
    }
  }

  const stone = [soup(stoneP, stoneC, place)];
  // Re-shade the stone facets from their real normals (soup() only colours).
  {
    const g = stone[0]!;
    const n = g.getAttribute('normal'), c = g.getAttribute('color');
    for (let i = 0; i < n.count; i += 1) {
      const k = 0.4 + 0.6 * Math.max(0, n.getX(i) * -0.45 + n.getY(i) * 0.78 + n.getZ(i) * 0.43);
      c.setXYZ(i, c.getX(i) * k * 1.5, c.getY(i) * k * 1.5, c.getZ(i) * k * 1.5);
    }
  }
  const glow = [soup(glowP, glowC, place)];

  // ---- the house (voxels) -----------------------------------------------
  const voxels: BufferGeometry[] = [];
  const yaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), spec.facing);
  const vox = (into: BufferGeometry[], x: number, y: number, z: number, w: number, hh: number, d: number, color: string, shade = true): void => {
    const p = new Vector3(x * sx, y * sy, z * sz).applyMatrix4(place);
    into.push(painted(new BoxGeometry(1, 1, 1), color, p, new Vector3(w * sx * r, hh * sy * r, d * sz * r), yaw, shade));
  };
  const zf = h.cut - 0.3; // facade plane, recessed behind the teeth
  // Each home is painted: one colour for the door and the shutters, picked
  // from a cottage's tin of paints — never the wall's own brown.
  const PAINTS = [['#2f7f9f', '#25657f'], ['#b04444', '#8e3535'], ['#3f8a55', '#326e44'], ['#d0a52c', '#a88522'], ['#7257b0', '#5a458c']] as const;
  // …and the one that sits furthest round the colour wheel from the home's
  // own crystal, so an orange geode gets a blue door and a green one a red.
  const hueOf = (hex: string | Color): number => { const hsl = { h: 0, s: 0, l: 0 }; new Color(hex).getHSL(hsl); return hsl.h; };
  const home = hueOf(tint);
  const away = (hex: string): number => { const d = Math.abs(hueOf(hex) - home); return Math.min(d, 1 - d); };
  const ranked = [...PAINTS].sort((p, q) => away(q[0]) - away(p[0]));
  const paint = ranked[rng.next() < 0.7 ? 0 : 1]!;
  const BEAM = '#3d2a24', STONE_A = '#c9bda3', STONE_B = '#a99c84', BRASS = '#ffd76a';
  // A stepped disc of planks — round because the throat is — lighter than it
  // was, so the dark timber and the painted door have something to stand on.
  const R = FACADE_R, rows = 9;
  const planks = ['#a9784f', '#976a42', '#b58657'];
  for (let j = 0; j < rows; j += 1) {
    const y = -R + (j + 0.5) * (2 * R / rows);
    const w = Math.sqrt(Math.max(0.02, R * R - y * y)) * 2;
    vox(voxels, 0, y - 0.04, zf, w, 2 * R / rows + 0.004, 0.07, planks[j % 3]!);
  }
  // The round door. A ring of dressed stones frames it; the slab is painted
  // boards (cut to the circle) with a big brass knob dead centre, the way a
  // burrow door has it.
  const dr = 0.215, dx = -0.05, dy = -0.25;
  for (let i = 0; i < 16; i += 1) {
    const a = (i / 16) * Math.PI * 2;
    if (Math.sin(a) < -0.86) continue; // the sill is the top step
    vox(voxels, dx + Math.cos(a) * (dr + 0.04), dy + Math.sin(a) * (dr + 0.04), zf + 0.06, 0.082, 0.082, 0.1, i % 2 ? STONE_A : STONE_B);
  }
  const boards = 7;
  for (let j = 0; j < boards; j += 1) {
    const x = -dr + (j + 0.5) * (2 * dr / boards);
    const hgt = Math.sqrt(Math.max(0.01, dr * dr - x * x)) * 2;
    vox(voxels, dx + x, dy, zf + 0.055, 2 * dr / boards - 0.006, hgt, 0.05, paint[j % 2]);
  }
  vox(glow, dx, dy, zf + 0.1, 0.06, 0.06, 0.05, BRASS, false);
  vox(voxels, dx, dy, zf + 0.085, 0.085, 0.085, 0.02, '#8a6a1f');

  // One plain awning over the door, in the door's paint: the only thing that
  // projects, so the front has depth without clutter.
  const eave = dy + dr + 0.1;
  vox(voxels, dx, eave, zf + 0.15, 0.6, 0.05, 0.2, paint[0]);
  vox(voxels, dx, eave + 0.045, zf + 0.11, 0.44, 0.045, 0.12, paint[1]);

  // A window: glass, muntins, a pale sill and lintel. Nothing else.
  const windowAt = (wx: number, wy: number, size: number): void => {
    vox(glow, wx, wy, zf + 0.045, size, size, 0.03, WARM, false);
    vox(voxels, wx, wy, zf + 0.065, size, 0.022, 0.02, BEAM);
    vox(voxels, wx, wy, zf + 0.065, 0.022, size, 0.02, BEAM);
    const f = size / 2 + 0.014;
    vox(voxels, wx, wy + f, zf + 0.06, size + 0.05, 0.03, 0.05, STONE_A);
    vox(voxels, wx, wy - f, zf + 0.06, size + 0.08, 0.035, 0.07, STONE_A);
  };
  const tower = spec.habit === 'tower';
  windowAt(tower ? 0.02 : 0.28, tower ? 0.29 : 0.17, 0.17);
  if (spec.habit === 'hall') windowAt(-0.34, 0.19, 0.13);

  // A lantern on a bracket beside the door.
  vox(voxels, dx - 0.31, dy + 0.12, zf + 0.1, 0.03, 0.03, 0.14, '#23262e');
  vox(glow, dx - 0.31, dy + 0.06, zf + 0.17, 0.065, 0.085, 0.065, '#ffe2a3', false);

  // Steps from the sill down to the floor, out through the break, between
  // low cheek walls — so they belong to the house instead of floating at it.
  for (let j = 0; j < 3; j += 1) {
    vox(voxels, dx, -0.5 - j * 0.045, zf + 0.12 + j * 0.13, 0.4 + j * 0.09, 0.05, 0.14, j % 2 ? '#6a7690' : '#59647a');
  }
  for (const cxn of [-1, 1]) vox(voxels, dx + cxn * 0.33, -0.53, zf + 0.26, 0.07, 0.13, 0.42, '#4a566b');
  // Chimney through the roof, leaning a little, capped.
  const cx = spec.habit === 'hall' ? 0.5 : 0.28;
  for (let j = 0; j < 4; j += 1) vox(voxels, cx + j * 0.012, 0.78 + j * 0.1, -0.12, 0.13, 0.1, 0.13, j % 2 ? '#3e4a5e' : '#4a566b');
  vox(voxels, cx + 0.05, 1.19, -0.12, 0.19, 0.04, 0.19, '#2f3848');
  const ventP = new Vector3((cx + 0.05) * sx, 1.24 * sy, -0.12 * sz).applyMatrix4(place);

  // The foot of the steps (the third step's outer edge), in the world.
  const foot = new Vector3(-0.05 * sx, -0.6 * sy, (zf + 0.12 + 2 * 0.13 + 0.12) * sz).applyMatrix4(place);
  // Where the home's light leaves it: out through the break, low, warm.
  const mouth = new Vector3(0, -0.25 * sy, (h.cut + 0.55) * sz).applyMatrix4(place);
  const warm = new Color(WARM).lerp(tint, 0.3);
  // Counted from the geometry, so the boxes in `glow` (knob, windows, the
  // lantern) are in the total the scenery reports.
  const triangles = [...stone, ...glow, ...voxels].reduce((n, g) => n + g.getAttribute('position').count / 3, 0);
  return {
    stone, voxels, glow,
    vent: { x: ventP.x, y: ventP.y, z: ventP.z, color: '#ffe6bd' },
    emitter: { x: mouth.x, y: mouth.y, z: mouth.z, r: warm.r * 0.9, g: warm.g * 0.9, b: warm.b * 0.9, reach: r * 1.5, phase: rng.next() * 6.28 },
    // The chimney (via `ventP`, its very top) reaches noticeably higher above
    // `cy` than the boulder's own `r * sy` — a floor-hugging fish must clear
    // the whole home, chimney included, not just the buried boulder.
    obstacle: { x: spec.x, y: cy, z: spec.z, r: r * Math.max(sx, sz), h: Math.max(r * sy, ventP.y - cy) },
    doorstep: { x: foot.x, z: foot.z },
    radius: r,
    triangles,
  };
}
