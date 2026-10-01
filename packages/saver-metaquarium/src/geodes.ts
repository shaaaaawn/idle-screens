/**
 * Wild geodes — few, and each one made properly.
 *
 * A geode is a void in rock that mineral water filled from the walls
 * inward: a knobbly crust, a skin of white chalcedony, then agate laid down
 * band by band following the shape of the hollow, then — where the void did
 * not fill — a lining of crystal points, tiny "sugar" druse near the rim and
 * big terminated crystals deeper in (amethyst pale at the root and deep
 * violet at the tip, its colour zoned toward the point). Cut, the bands run
 * round the cavity like contour lines, fine and wavy and many; a thunder
 * egg's close on a star. An amethyst "cathedral" is a tall section stood on
 * end; Naica's cave is a geode so big you walk among its beams of selenite.
 *
 * What makes them read is not geometry alone, so the look is done the way a
 * game artist does it, per pixel (GEODE_SHADE):
 *
 *   crust      mottled stone, lit by a key and the water above
 *   cut face   procedural agate: many fine bands from a noise-warped band
 *              coordinate (0 at the crust, 1 at the hollow), white
 *              chalcedony threads between, a polished highlight
 *   hollow     darkening with depth (the occlusion a deep cavity has), its
 *              sugar druse twinkling cell by cell as the view swings
 *   crystals   real quartz habit — a hexagonal prism and a six-faced point —
 *              scattered on the wall with no grid to give them away, bigger
 *              deeper in, sliced where they meet the cut; colour zoned root
 *              to tip, crisp facet highlights, a fresnel rim, an inner glow
 *   selenite   glassy blades, rim-lit
 *
 * The lighting is the geodes' own (the tank's studio exists only in lit
 * mode), so they look the same in a flat tank. Four assets:
 *
 *   geode      the split geode: one half lying cut-face up, its twin leaning
 *              beside it — and, one in three, a thunder egg
 *   cathedral  a tall amethyst cathedral standing open
 *   cluster    a crystal cluster: points radiating from a sugary matrix stone
 *   cavern     the mega geode (at most one): a cave mouth with blades of selenite
 *
 * One mesh, one draw; crystals wake when a fish comes close (the cast
 * uniforms the flora reads); one in twenty is an iridescent aura morph.
 */

import { BufferAttribute, BufferGeometry, Color, Matrix4, Quaternion, Vector3 } from 'three';
import type { CrystalRng } from './crystals';
import { GEODE_KINDS, MINERALS, type GeodeKind, type MineralName } from './geode-mix';

export { GEODE_KINDS, MINERALS, parseGeodeMix, parseGeodeMineral, type GeodeKind, type MineralName } from './geode-mix';

/** A mineral, outside to in: crust, agate (two tones), the hollow, its crystals root → tip. */
interface Mineral {
  crust: string; crust2: string;
  bandA: string; bandB: string;
  wall: string; spark: string;
  root: string; tip: string;
  /** Flat bladed crystals (celestine) instead of stout prisms. */
  bladed?: boolean;
  /** Crystal size, as a fraction of the hollow's radius, small to large. */
  size: readonly [number, number];
}

const MINERAL: Readonly<Record<MineralName, Mineral>> = {
  amethyst: { crust: '#8a8378', crust2: '#5f5950', bandA: '#8c84a6', bandB: '#dcd5ea', wall: '#381a66', spark: '#efe0ff', root: '#9468d6', tip: '#5418bc', size: [0.13, 0.32] },
  agate: { crust: '#8c8476', crust2: '#615a50', bandA: '#1d4fc4', bandB: '#a4c8ff', wall: '#5a7cb8', spark: '#ffffff', root: '#dfe8f6', tip: '#f6fbff', size: [0.06, 0.13] },
  celestine: { crust: '#c6b9a0', crust2: '#9a8e78', bandA: '#a6c0d8', bandB: '#eef4fa', wall: '#7c9cbc', spark: '#ffffff', root: '#bfe0fa', tip: '#76b0e8', bladed: true, size: [0.16, 0.38] },
  citrine: { crust: '#8a7a62', crust2: '#5f5240', bandA: '#c88a24', bandB: '#f6e2b0', wall: '#a8661a', spark: '#fff2c0', root: '#f4b850', tip: '#c86808', size: [0.12, 0.28] },
  carnelian: { crust: '#7e6c60', crust2: '#574940', bandA: '#c42a1c', bandB: '#ffb69a', wall: '#8e2618', spark: '#ffe0d0', root: '#ff9a7a', tip: '#e8402a', size: [0.07, 0.15] },
  rose: { crust: '#8a7e78', crust2: '#615652', bandA: '#de2c6c', bandB: '#ffbfd8', wall: '#b23866', spark: '#ffe6f0', root: '#ffa8cc', tip: '#ff4f94', size: [0.06, 0.13] },
  emerald: { crust: '#6e7468', crust2: '#4c5048', bandA: '#0e8a3e', bandB: '#a6f2bf', wall: '#18703a', spark: '#e0ffe8', root: '#9cf0b8', tip: '#22b85c', size: [0.09, 0.2] },
  quartz: { crust: '#9a9282', crust2: '#6c6658', bandA: '#c4beb2', bandB: '#f3efe6', wall: '#b8b8be', spark: '#ffffff', root: '#f2f4f8', tip: '#ffffff', size: [0.13, 0.32] },
  smoky: { crust: '#5e5850', crust2: '#3e3a34', bandA: '#5a4a3a', bandB: '#bca88e', wall: '#3e3024', spark: '#e8d8c0', root: '#cdb898', tip: '#3e2a1c', size: [0.12, 0.3] },
};

/** How common each is when nothing chooses. */
const MINERAL_WEIGHT: Readonly<Record<MineralName, number>> = {
  amethyst: 3, agate: 2.2, celestine: 1.2, citrine: 1.3, carnelian: 0.8, rose: 0.9, emerald: 0.6, quartz: 1.6, smoky: 0.8,
};

export interface GeodeFieldOptions {
  /** 0..1 — how many (× the device's props budget). */
  amount: number;
  cap: number;
  scale: number;
  mix?: Partial<Record<GeodeKind, number>>;
  minerals?: readonly MineralName[];
  layout?: 'field' | 'gallery';
  /** True where something already stands, for a footprint of radius `r`. */
  blocked(x: number, z: number, r: number): boolean;
  /** The scene's crystals: with no `minerals`, a geode is made of whatever
   *  mineral is nearest in colour to the crystal nearest it — the way flora
   *  and homes take their crystal's colour — so it belongs to its world. */
  anchors?: ReadonlyArray<{ x: number; z: number; color: string }>;
  /** The town's fountain at (x, z): a hot vent chimney or a geode basin. */
  fountain?: { kind: 'vent' | 'geode'; x: number; z: number };
  /** Streetlamps: a slate post with a crystal on top, at each of these. */
  lamps?: ReadonlyArray<{ x: number; z: number }>;
  terrain(x: number, z: number): number;
}

export interface GeodeField {
  geometry: BufferGeometry | null;
  geodes: number;
  byKind: Record<GeodeKind, number>;
  /** Iridescent aura morphs (about one in twenty). */
  aura: number;
  /** Thunder eggs among the geodes. */
  thundereggs: number;
  obstacles: { x: number; y: number; z: number; r: number; h: number }[];
  lights: { x: number; y: number; z: number; color: string; reach: number }[];
  /** The fountain's mouth (where its bubbles leave and its light is), if there is one. */
  fountain: { x: number; y: number; z: number; color: string } | null;
  /** Each lamp's crystal (light and halo). */
  lamps: { x: number; y: number; z: number; color: string }[];
  triangles: number;
}

/** What a vertex is, for the shader. */
export const PART = { crust: 0, cut: 1, hollow: 2, crystal: 3, selenite: 4 } as const;

class GeoWriter {
  readonly pos: number[] = [];
  readonly colA: number[] = [];
  readonly colB: number[] = [];
  readonly part: number[] = [];
  readonly geo: number[] = [];
  place = new Matrix4();
  /** Per-triangle state: two colours, the part, a seed (v), a phase, and whether a fish wakes it. */
  a = new Color(); b = new Color();
  kind: number = PART.crust; v = 0; phase = 0; glow = 0;
  private readonly t = new Vector3();

  private vert(p: Vector3, u: number): void {
    this.t.copy(p).applyMatrix4(this.place);
    this.pos.push(this.t.x, this.t.y, this.t.z);
    this.colA.push(this.a.r, this.a.g, this.a.b);
    this.colB.push(this.b.r, this.b.g, this.b.b);
    this.part.push(this.kind);
    this.geo.push(u, this.v, this.phase, this.glow);
  }

  /** A triangle in local space; `u` per corner (band coordinate, depth, or along a crystal). */
  tri(p: Vector3, up: number, q: Vector3, uq: number, r: Vector3, ur: number): void {
    this.vert(p, up); this.vert(q, uq); this.vert(r, ur);
  }

  get mark(): number { return this.pos.length / 3; }

  /** Move everything since `from` so its lowest point sits `bury` below `floor`. */
  settle(from: number, floor: number, bury: number): number {
    let low = Infinity;
    for (let i = from; i < this.pos.length / 3; i += 1) low = Math.min(low, this.pos[i * 3 + 1]!);
    const dy = floor - bury - low;
    for (let i = from; i < this.pos.length / 3; i += 1) this.pos[i * 3 + 1] = this.pos[i * 3 + 1]! + dy;
    return dy;
  }

  geometry(): BufferGeometry | null {
    if (!this.pos.length) return null;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.colA), 3));
    g.setAttribute('aColB', new BufferAttribute(new Float32Array(this.colB), 3));
    g.setAttribute('aPart', new BufferAttribute(new Float32Array(this.part), 1));
    g.setAttribute('aGeo', new BufferAttribute(new Float32Array(this.geo), 4));
    g.computeVertexNormals();
    return g;
  }
}

const UP = new Vector3(0, 1, 0);
/** The world's stone: the slate every rock is painted (rocks.ts paintStone). */
const STONE = new Color('#33435a');

/** A closed outline (unit, local XZ) with a seeded wobble; `point` draws it to a point at -z (a cathedral's top). */
function outline(rng: CrystalRng, n: number, a: number, b: number, rough: number, point = 0): Array<[number, number]> {
  const p1 = rng.range(0, 6.28), p2 = rng.range(0, 6.28), p3 = rng.range(0, 6.28);
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    const o = 1 + rough * (0.45 * Math.sin(2 * t + p1) + 0.35 * Math.sin(3 * t + p2) + 0.2 * Math.sin(5 * t + p3));
    const sz = Math.sin(t);
    return [Math.cos(t) * a * o, sz * b * o * (1 + point * Math.max(0, -sz) ** 6)] as [number, number];
  });
}

/** Knobs on a crust: a seeded set of soft bumps over the sphere (botryoidal, the way a geode's skin is). */
function knobs(rng: CrystalRng, count: number): (d: Vector3) => number {
  const bumps = Array.from({ length: count }, () => {
    const c = new Vector3(rng.range(-1, 1), rng.range(-1, 0.3), rng.range(-1, 1)).normalize();
    return { c, w: rng.range(0.12, 0.3), a: rng.range(0.04, 0.1) };
  });
  return (d) => {
    let s = 0;
    for (const b of bumps) {
      const q = (1 - d.dot(b.c)) / b.w;
      if (q < 1) s += b.a * (1 - q) * (1 - q);
    }
    return 1 + s;
  };
}

interface CrystalSpec { size: readonly [number, number]; count: number; bladed?: boolean; aura: boolean; root: Color; tip: Color }
type Surface = Array<{ a: Vector3; b: Vector3; c: Vector3; u: number }>;

/**
 * Crystals sown on a surface: area-weighted random points, kept apart by
 * their own size — no grid, so no pattern to give the geometry away. Each is
 * quartz habit (see `crystal`), its axis from `axisOf`, scaled by `deep(u)`
 * for the depth it grows at; `ceil` slices any point that would rise
 * through the cut.
 */
function sow(w: GeoWriter, rng: CrystalRng, tris: Surface, spec: CrystalSpec, R: number,
  axisOf: (p: Vector3, n: Vector3) => Vector3, deep: (u: number) => number, ceil?: number): number {
  if (!tris.length || spec.count <= 0) return 0;
  const areas = tris.map((t) => new Vector3().subVectors(t.b, t.a).cross(new Vector3().subVectors(t.c, t.a)).length() / 2);
  const total = areas.reduce((x, y) => x + y, 0);
  // Enough to carpet the wall at their mean size, up to the budget.
  const mean = R * (spec.size[0] + spec.size[1]) / 2;
  const want = Math.min(spec.count, Math.ceil(total / (mean * mean * 0.4)));
  const placed: Array<{ p: Vector3; s: number }> = [];
  let made = 0;
  for (let tries = 0; tries < want * 6 && made < want; tries += 1) {
    let roll = rng.next() * total, k = 0;
    while (k < tris.length - 1 && roll > areas[k]!) { roll -= areas[k]!; k += 1; }
    const t = tris[k]!;
    let r1 = rng.next(), r2 = rng.next();
    if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
    const p = t.a.clone().addScaledVector(new Vector3().subVectors(t.b, t.a), r1).addScaledVector(new Vector3().subVectors(t.c, t.a), r2);
    const s = R * (spec.size[0] + (spec.size[1] - spec.size[0]) * rng.next() ** 1.6) * deep(t.u);
    if (placed.some((q) => q.p.distanceTo(p) < (q.s + s) * 0.19)) continue;
    const n = new Vector3().subVectors(t.b, t.a).cross(new Vector3().subVectors(t.c, t.a)).normalize();
    const axis = axisOf(p, n).add(new Vector3(rng.range(-0.3, 0.3), rng.range(-0.3, 0.3), rng.range(-0.3, 0.3))).normalize();
    if (crystal(w, rng, p, axis, s, spec, ceil)) { placed.push({ p, s }); made += 1; }
  }
  return made;
}

/** One quartz crystal from `base` along `axis`, `s` long: a hexagonal prism rooted in the wall and a six-faced point. False if the cut would leave nothing of it. */
function crystal(w: GeoWriter, rng: CrystalRng, base: Vector3, axis: Vector3, s: number, spec: CrystalSpec, ceil?: number): boolean {
  let len = s;
  const start = base.clone().addScaledVector(axis, -s * 0.18);
  if (ceil !== undefined && axis.y > 0.05) {
    // Sliced by the cut: shorten a point that would rise through it.
    const room = (ceil - start.y) / axis.y;
    if (room < len) len = room - s * 0.04;
    if (len < s * 0.35) return false;
  }
  const helper = Math.abs(axis.y) < 0.9 ? UP : new Vector3(1, 0, 0);
  const e1 = new Vector3().crossVectors(axis, helper).normalize(), e2 = new Vector3().crossVectors(axis, e1);
  const r = s * (spec.bladed ? 0.2 : 0.24) * rng.range(0.8, 1.15);
  const flat = spec.bladed ? 0.42 : 1;
  const spin = rng.range(0, Math.PI);
  const prism = len * rng.range(0.52, 0.66), apexOff = new Vector3().addScaledVector(e1, rng.range(-0.08, 0.08) * s);
  const ring = (c: Vector3, k: number): Vector3[] => Array.from({ length: 6 }, (_, i) => {
    const a = spin + (i / 6) * Math.PI * 2;
    return c.clone().addScaledVector(e1, Math.cos(a) * r * k).addScaledVector(e2, Math.sin(a) * r * k * flat);
  });
  const lo = ring(start, 0.9), hi = ring(start.clone().addScaledVector(axis, prism), 1);
  const apex = start.clone().addScaledVector(axis, len).add(apexOff);
  const uHi = prism / len;
  w.kind = PART.crystal;
  w.a.copy(spec.root).multiplyScalar(rng.range(0.88, 1.08));
  w.b.copy(spec.tip).multiplyScalar(rng.range(0.9, 1.1));
  w.v = rng.next();
  w.phase = rng.range(0, 6.28) + (spec.aura ? 10 : 0);
  w.glow = 1;
  for (let i = 0; i < 6; i += 1) {
    const j = (i + 1) % 6;
    w.tri(lo[i]!, 0, lo[j]!, 0, hi[j]!, uHi);
    w.tri(lo[i]!, 0, hi[j]!, uHi, hi[i]!, uHi);
    w.tri(hi[i]!, uHi, hi[j]!, uHi, apex, 1);
  }
  return true;
}

interface HalfOpts {
  out: Array<[number, number]>;
  R: number; depth: number;
  m: Mineral;
  /** The hollow's size at the cut (of the outline), and how deep it goes (of the dome). */
  hollow: number; hollowDepth: number;
  /** A thunder egg: the bands close on a star, no hollow. */
  star?: boolean;
  crystals: number;
  /** The mineral's crystal size, scaled for this asset (a cave's points are not a cave's size). Default 1. */
  crystalScale?: number;
  aura: boolean;
  /** Seed for the agate's banding. */
  band: number;
}

/** Half a geode in local space: the cut is the plane y = 0, the dome hangs below. */
function half(w: GeoWriter, rng: CrystalRng, o: HalfOpts): void {
  const n = o.out.length, R = o.R;
  const bump = knobs(rng, 18);
  // ---- the crust: a knobbled dome -------------------------------------
  // The crust is the world's stone (paintStone's slate), only a hint of its own mineral in it.
  w.kind = PART.crust; w.a.set(STONE).lerp(new Color(o.m.crust), 0.18); w.b.copy(w.a); w.v = o.band; w.phase = 0; w.glow = 0;
  const nu = 8;
  const dome: Vector3[][] = [];
  for (let k = 0; k <= nu; k += 1) {
    const phi = (k / nu) * Math.PI / 2;
    dome.push(o.out.map(([x, z]) => {
      const d = new Vector3(x * Math.cos(phi), -Math.sin(phi), z * Math.cos(phi)).normalize();
      const knob = 1 + (bump(d) - 1) * Math.min(1, k / 2);
      return new Vector3(x * R * Math.cos(phi) * knob, -o.depth * R * Math.sin(phi) * knob, z * R * Math.cos(phi) * knob);
    }));
  }
  for (let k = 0; k < nu; k += 1) for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n, A = dome[k]!, B = dome[k + 1]!;
    w.tri(A[i]!, 0, A[j]!, 0, B[j]!, 0);
    w.tri(A[i]!, 0, B[j]!, 0, B[i]!, 0);
  }
  // ---- the cut: agate, banded per pixel ----------------------------------
  const p2 = rng.range(0, 6.28), p3 = rng.range(0, 6.28);
  const inner = (i: number): [number, number] => {
    // The angle of the outline point itself, so a mirrored twin's star and
    // hollow are mirrored with it (indexing by i twisted its rings into bow-ties).
    const [x, z] = o.out[i % n]!, th = Math.atan2(z, x);
    if (o.star) {
      // A thunder egg's core: a five-armed star, a little off centre.
      const sr = 0.2 * (1 + 0.75 * Math.abs(Math.cos(th * 2.5 + p2)) ** 1.5);
      return [Math.cos(th) * sr + 0.05 * Math.sign(o.out[0]![0]), Math.sin(th) * sr];
    }
    const wob = 1 + 0.1 * Math.sin(3 * th + p2) + 0.06 * Math.sin(5 * th + p3);
    return [x * o.hollow * wob, z * o.hollow * wob];
  };
  const T = [0, 0.03, 0.07, 0.12, 0.19, 0.28, 0.39, 0.52, 0.66, 0.8, 0.91, 1];
  const at = (t: number, i: number): Vector3 => {
    const [ox, oz] = o.out[i % n]!, [ix, iz] = inner(i);
    return new Vector3((ox + (ix - ox) * t) * R, 0, (oz + (iz - oz) * t) * R);
  };
  w.kind = PART.cut; w.a.set(o.m.bandA); w.b.set(o.m.bandB); w.v = o.band;
  for (let k = 0; k < T.length - 1; k += 1) for (let i = 0; i < n; i += 1) {
    const t0 = T[k]!, t1 = T[k + 1]!;
    w.tri(at(t0, i), t0, at(t0, i + 1), t0, at(t1, i + 1), t1);
    w.tri(at(t0, i), t0, at(t1, i + 1), t1, at(t1, i), t1);
  }
  // ---- the heart -------------------------------------------------------
  w.kind = PART.hollow; w.a.set(o.m.wall); w.b.set(o.m.spark);
  if (o.star) {
    // A thunder egg's star is agate too: its bands follow the star inward,
    // a fortification, closing on a speck of druse at the very middle.
    const c = new Vector3(0.05 * R * Math.sign(o.out[0]![0]), 0, 0);
    const S = [1, 1.12, 1.25, 1.38, 1.5, 1.62];
    w.kind = PART.cut; w.a.set(o.m.bandA); w.b.set(o.m.bandB);
    const toward = (k: number, i: number): Vector3 => at(1, i).lerp(c, (S[k]! - 1) / 0.75);
    for (let k = 0; k < S.length - 1; k += 1) for (let i = 0; i < n; i += 1) {
      w.tri(toward(k, i), S[k]!, toward(k, i + 1), S[k]!, toward(k + 1, i + 1), S[k + 1]!);
      w.tri(toward(k, i), S[k]!, toward(k + 1, i + 1), S[k + 1]!, toward(k + 1, i), S[k + 1]!);
    }
    w.kind = PART.hollow; w.a.set(o.m.wall).lerp(new Color(o.m.bandB), 0.5); w.b.set(o.m.spark);
    for (let i = 0; i < n; i += 1) w.tri(c, 0.15, toward(S.length - 1, i), 0.1, toward(S.length - 1, i + 1), 0.1);
    return;
  }
  const nh = 7, hd = o.depth * o.hollowDepth;
  const hole: Vector3[][] = [];
  for (let k = 0; k <= nh; k += 1) {
    const phi = (k / nh) * Math.PI / 2;
    hole.push(Array.from({ length: n }, (_, i) => {
      const [ix, iz] = inner(i), jag = k === 0 ? 1 : rng.range(0.94, 1.06);
      return new Vector3(ix * R * Math.cos(phi) * jag, -hd * R * Math.sin(phi) * jag, iz * R * Math.cos(phi) * jag);
    }));
  }
  const tris: Surface = [];
  for (let k = 0; k < nh; k += 1) for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n, A = hole[k]!, B = hole[k + 1]!, u0 = k / nh, u1 = (k + 1) / nh;
    w.tri(A[i]!, u0, B[i]!, u1, B[j]!, u1);
    w.tri(A[i]!, u0, B[j]!, u1, A[j]!, u0);
    tris.push({ a: A[i]!, b: B[i]!, c: B[j]!, u: (u0 + u1) / 2 }, { a: A[i]!, b: B[j]!, c: A[j]!, u: (u0 + u1) / 2 });
  }
  // Crystals point into the hollow: small sugar at the rim, big points deep.
  const centre = new Vector3(0, -hd * R * 0.45, 0);
  const cs = o.crystalScale ?? 1;
  const spec: CrystalSpec = { size: [o.m.size[0] * cs, o.m.size[1] * cs], count: o.crystals, bladed: o.m.bladed, aura: o.aura, root: new Color(o.m.root), tip: new Color(o.m.tip) };
  sow(w, rng, tris, spec, R * o.hollow,
    (p, nrm) => {
      const inward = nrm.dot(centre.clone().sub(p)) < 0 ? nrm.clone().negate() : nrm.clone();
      return inward.multiplyScalar(0.6).add(centre.clone().sub(p).normalize().multiplyScalar(0.4)).normalize();
    },
    (u) => 0.55 + 0.75 * u, -0.012 * R);
}

/** The mineral whose crystals are nearest in hue (and lightness) to `hex`. */
export function mineralNear(hex: string): MineralName {
  const want = { h: 0, s: 0, l: 0 }, got = { h: 0, s: 0, l: 0 };
  new Color(hex).getHSL(want);
  let best: MineralName = 'quartz', score = Infinity;
  for (const name of Object.keys(MINERAL) as MineralName[]) {
    new Color(MINERAL[name].tip).getHSL(got);
    const dh = Math.min(Math.abs(want.h - got.h), 1 - Math.abs(want.h - got.h));
    // A grey or white crystal wants quartz: weigh hue by how saturated both are.
    const d = dh * 2 * Math.min(want.s, got.s) + Math.abs(want.s - got.s) * 0.6 + Math.abs(want.l - got.l) * 0.3;
    if (d < score) { score = d; best = name; }
  }
  return best;
}

function pickMineral(rng: CrystalRng, allowed: readonly MineralName[] | undefined): MineralName {
  const names = allowed?.length ? allowed : (Object.keys(MINERAL) as MineralName[]);
  const weight = (m: MineralName): number => (allowed?.length ? 1 : MINERAL_WEIGHT[m]);
  let roll = rng.next() * names.reduce((a, m) => a + weight(m), 0);
  for (const m of names) { roll -= weight(m); if (roll < 0) return m; }
  return names[0]!;
}

const KIND: Readonly<Record<GeodeKind, { share: number; max?: number; room: number }>> = {
  geode: { share: 0.5, room: 26 },
  cathedral: { share: 0.2, room: 24 },
  cluster: { share: 0.3, room: 18 },
  cavern: { share: 0.03, max: 1, room: 80 },
};

interface Grown { r: number; h: number; light?: { y: number; reach: number }; star?: boolean }

function grow(w: GeoWriter, rng: CrystalRng, kind: GeodeKind, mineral: MineralName, x: number, z: number, yaw: number, s: number,
  floor: number, aura: boolean, variant?: 'star' | 'hollow'): Grown {
  const m = MINERAL[mineral];
  const turn = new Quaternion().setFromAxisAngle(UP, yaw);
  const placeAt = (dx: number, dz: number, tilt: number, extraYaw = 0): Matrix4 => {
    const q = turn.clone().multiply(new Quaternion().setFromAxisAngle(UP, extraYaw)).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), tilt));
    const off = new Vector3(dx, 0, dz).applyQuaternion(turn);
    return new Matrix4().compose(new Vector3(x + off.x, floor, z + off.z), q, new Vector3(1, 1, 1));
  };
  const band = rng.next();
  if (kind === 'geode') {
    const R = rng.range(9, 13) * s;
    const star = variant ? variant === 'star' : rng.next() < 0.3;
    const out = outline(rng, 40, 1, rng.range(0.8, 1), star ? 0.06 : 0.12);
    const opts: HalfOpts = { out, R, depth: rng.range(0.8, 1), m, hollow: star ? 0 : rng.range(0.5, 0.66), hollowDepth: 0.8, star, crystals: star ? 0 : 160, crystalScale: 1.25, aura, band };
    // The pair: one half lies cut-face up, its twin leans beside it, facing out.
    let from = w.mark;
    w.place = placeAt(-R * 1.02, 0, 0, rng.range(-0.4, 0.4));
    half(w, rng.fork(1), opts);
    w.settle(from, floor, R * opts.depth * 0.3);
    from = w.mark;
    w.place = placeAt(R * 1.08, R * 0.15, Math.PI / 2 - rng.range(0.3, 0.55), rng.range(-0.25, 0.1));
    half(w, rng.fork(2), { ...opts, out: out.map(([a, b]) => [-a, b] as [number, number]) });
    w.settle(from, floor, R * 0.14);
    return { r: R * 2.2, h: R * 2.1, star, light: star ? undefined : { y: R * 0.5, reach: R * 2.2 } };
  }
  if (kind === 'cathedral') {
    const R = rng.range(10, 12.5) * s;
    const out = outline(rng, 44, 1, rng.range(2.1, 2.5), 0.08, 0.38);
    const from = w.mark;
    w.place = placeAt(0, 0, Math.PI / 2);
    half(w, rng.fork(3), { out, R, depth: rng.range(0.8, 0.95), m, hollow: 0.8, hollowDepth: 0.9, crystals: 420, crystalScale: 0.75, aura, band });
    w.settle(from, floor, R * 0.2);
    return { r: R * 1.2, h: R * 6.4, light: { y: R * 2.2, reach: R * 3 } };
  }
  if (kind === 'cluster') {
    // A matrix stone, its crown sugary with druse, and points radiating from
    // its middle the way an amethyst cluster's do.
    const R = rng.range(10, 14) * s;
    const out = outline(rng, 30, 1, rng.range(0.7, 0.95), 0.2);
    const bump = knobs(rng, 12);
    const depth = rng.range(0.38, 0.55), nu = 6;
    const from = w.mark;
    w.place = placeAt(0, 0, 0);
    const ringsV: Vector3[][] = [];
    for (let k = 0; k <= nu; k += 1) {
      const phi = (k / nu) * Math.PI / 2;
      ringsV.push(out.map(([ox, oz]) => {
        const d = new Vector3(ox * Math.cos(phi), Math.sin(phi), oz * Math.cos(phi)).normalize();
        const kb = bump(new Vector3(d.x, -d.y, d.z));
        return new Vector3(ox * R * Math.cos(phi) * kb, depth * R * Math.sin(phi) * kb, oz * R * Math.cos(phi) * kb);
      }));
    }
    const crown: Surface = [];
    for (let k = 0; k < nu; k += 1) for (let i = 0; i < out.length; i += 1) {
      const j = (i + 1) % out.length, A = ringsV[k]!, B = ringsV[k + 1]!;
      const top = k >= nu / 2;
      w.kind = top ? PART.hollow : PART.crust;
      if (top) { w.a.set(m.wall).lerp(new Color(m.root), 0.35); w.b.set(m.spark); } else { w.a.set(STONE).lerp(new Color(m.crust), 0.18); w.b.copy(w.a); }
      w.v = band; w.glow = top ? 1 : 0;
      const u = top ? 0.2 : 0;
      w.tri(A[i]!, u, B[j]!, u, A[j]!, u);
      w.tri(A[i]!, u, B[i]!, u, B[j]!, u);
      if (top) crown.push({ a: A[i]!, b: B[j]!, c: A[j]!, u: k / nu }, { a: A[i]!, b: B[i]!, c: B[j]!, u: k / nu });
    }
    const spec: CrystalSpec = { size: [m.size[0] * 1.6, m.size[1] * 2.2], count: 40, bladed: m.bladed, aura, root: new Color(m.root), tip: new Color(m.tip) };
    const mid = new Vector3(0, depth * R * 0.2, 0);
    sow(w, rng.fork(4), crown, spec, R,
      (p) => p.clone().sub(mid).setY(0).multiplyScalar(0.06).add(new Vector3(0, 1, 0)).normalize(),
      (u) => 0.5 + 0.7 * u);
    w.settle(from, floor, R * depth * 0.3);
    return { r: R * 1.1, h: R * 1.6, light: { y: R * 0.6, reach: R * 2.2 } };
  }
  // The cavern: a geode so big it is a cave, stood open toward the middle of
  // the tank and buried to its waist, with blades of selenite across its mouth.
  const R = rng.range(40, 50) * s;
  const out = outline(rng, 56, 1.3, 1, 0.14);
  const from = w.mark;
  w.place = placeAt(0, 0, Math.PI / 2);
  half(w, rng.fork(5), { out, R, depth: 0.95, m, hollow: 0.86, hollowDepth: 0.92, crystals: 700, crystalScale: 0.45, aura, band });
  // The cave's heart: a few giant points rising from its floor toward the
  // mouth — the crystals of a geode this size are the size of trees.
  const grng = rng.fork(6);
  const giants = 3 + Math.floor(grng.next() * 2);
  const gspec: CrystalSpec = { size: [0.38, 0.58], count: 1, bladed: m.bladed, aura, root: new Color(m.root), tip: new Color(m.tip) };
  for (let i = 0; i < giants; i += 1) {
    const fx = (i / (giants - 1)) * 1.2 - 0.6 + grng.range(-0.1, 0.1);
    // Local +z is down once stood up; -y is into the cave.
    // Just above where the floor cuts the mouth (the cave is buried to 0.55 R), deep inside.
    const base = new Vector3(fx * 1.3 * R * 0.55, -grng.range(0.45, 0.7) * R, R * grng.range(-0.05, 0.12));
    const axis = new Vector3(-fx * 0.5 + grng.range(-0.2, 0.2), grng.range(0.5, 0.9), -grng.range(0.8, 1.1)).normalize();
    crystal(w, grng, base, axis, R * grng.range(gspec.size[0], gspec.size[1]), gspec);
  }
  w.settle(from, floor, R * 0.55);
  return { r: R * 1.3, h: R * 1.7, light: { y: R * 0.5, reach: R * 2.5 } };
}

/** One gallery specimen. */
export interface GallerySpecimen { kind: GeodeKind; mineral: MineralName; variant?: 'star' | 'hollow'; aura?: boolean }

/**
 * The gallery: a lineup of every kind in every mineral, a row per kind —
 * aura morphs in front, then thunder eggs, hollow geodes, clusters and
 * cathedrals going back, the mega geode behind them all.
 */
export function galleryRows(minerals: readonly MineralName[] = MINERALS): GallerySpecimen[][] {
  const each = (f: (m: MineralName) => GallerySpecimen): GallerySpecimen[] => minerals.map(f);
  return [
    (['quartz', 'amethyst', 'agate'] as MineralName[]).filter((m) => minerals.includes(m)).map((mineral) => ({ kind: 'geode', mineral, variant: 'hollow', aura: true })),
    each((mineral) => ({ kind: 'geode', mineral, variant: 'star' })),
    each((mineral) => ({ kind: 'geode', mineral, variant: 'hollow' })),
    each((mineral) => ({ kind: 'cluster', mineral })),
    each((mineral) => ({ kind: 'cathedral', mineral })),
    [{ kind: 'cavern', mineral: minerals.includes('amethyst') ? 'amethyst' : minerals[0]! }],
  ].filter((row) => row.length) as GallerySpecimen[][];
}

/** A faceted slate post or chimney: stacked rings tapering from `r0` to `r1`, `h` tall. */
function column(w: GeoWriter, rng: CrystalRng, h: number, r0: number, r1: number, sides: number, segs: number, color: Color): Vector3[] {
  w.kind = PART.crust; w.a.copy(color); w.b.copy(color); w.glow = 0;
  let prev: Vector3[] | null = null;
  const spin = rng.range(0, 6.28);
  for (let j = 0; j <= segs; j += 1) {
    const t = j / segs, r = (r0 + (r1 - r0) * t) * (j === 0 || j === segs ? 1 : rng.range(0.9, 1.1));
    const ring = Array.from({ length: sides }, (_, i) => {
      const a = spin + (i / sides) * Math.PI * 2;
      return new Vector3(Math.cos(a) * r, t * h, Math.sin(a) * r);
    });
    if (prev) for (let i = 0; i < sides; i += 1) {
      const k = (i + 1) % sides;
      w.tri(prev[i]!, 0, prev[k]!, 0, ring[k]!, 0);
      w.tri(prev[i]!, 0, ring[k]!, 0, ring[i]!, 0);
    }
    prev = ring;
  }
  return prev!;
}

/** A crown of crystals at `at`, pointing up and out: a lamp's, or a vent's crust. */
function crown(w: GeoWriter, rng: CrystalRng, at: Vector3, count: number, size: number, spread: number, m: Mineral): void {
  const spec: CrystalSpec = { size: [1, 1], count: 1, bladed: m.bladed, aura: false, root: new Color(m.root), tip: new Color(m.tip) };
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const lean = i === 0 ? 0 : spread;
    const axis = new Vector3(Math.cos(a) * lean, 1, Math.sin(a) * lean).normalize();
    const base = at.clone().add(new Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(i === 0 ? 0 : size * 0.18));
    crystal(w, rng, base, axis, size * (i === 0 ? 1 : rng.range(0.55, 0.8)), spec);
  }
}

export function buildGeodeField(rng: CrystalRng, opts: GeodeFieldOptions): GeodeField {
  const w = new GeoWriter();
  const byKind = Object.fromEntries(GEODE_KINDS.map((k) => [k, 0])) as Record<GeodeKind, number>;
  const obstacles: GeodeField['obstacles'] = [], lights: GeodeField['lights'] = [];
  const s = opts.scale;
  let aura = 0, geodes = 0, thundereggs = 0;
  const put = (kind: GeodeKind, x: number, z: number, yaw: number, mineral: MineralName, isAura: boolean, scale = s, variant?: 'star' | 'hollow'): void => {
    const floor = opts.terrain(x, z);
    const grown = grow(w, rng.fork(1000 + geodes), kind, mineral, x, z, yaw, scale, floor, isAura, variant);
    obstacles.push({ x, y: floor, z, r: grown.r, h: grown.h });
    if (grown.light) lights.push({ x, y: floor + grown.light.y, z, color: MINERAL[mineral].tip, reach: grown.light.reach });
    byKind[kind] += 1;
    geodes += 1;
    // A thunder egg has no crystals to be iridescent: it is not an aura morph.
    if (isAura && !grown.star) aura += 1;
    if (grown.star) thundereggs += 1;
  };
  const minerals = opts.minerals?.length ? opts.minerals : undefined;
  if (opts.layout === 'gallery' && opts.amount > 0) {
    // Columns a mineral each, rows a kind each, spaced so nothing touches;
    // the mega geode stands behind the lot.
    const rows = galleryRows(minerals ?? MINERALS);
    const gap = 52 * s, rowGap = 56 * s;
    rows.forEach((row, r) => {
      const mega = row[0]!.kind === 'cavern', tall = row[0]!.kind === 'cathedral';
      const z = (2.2 - r) * rowGap - (mega ? 150 * s : 0);
      row.forEach((g, i) => {
        // The cathedrals leave an empty slot in the middle, so the mega geode
        // shows between them; every other row is centred.
        const slot = tall && i >= Math.ceil(row.length / 2) ? i + 1 : i;
        const x = (slot - (tall && row.length > 1 ? row.length : row.length - 1) / 2) * gap;
        put(g.kind, x, z, 0, g.mineral, !!g.aura, g.kind === 'cluster' ? s * 1.6 : s, g.variant);
      });
    });
  } else {
    // Fewer, and better: a geode is a find, not gravel.
    const named = opts.mix && Object.values(opts.mix).some((v) => (v ?? 0) > 0);
    // A mix that names kinds but weights none of them (`cavern:0`) asks for nothing, not for the default.
    const nothing = !!opts.mix && Object.keys(opts.mix).length > 0 && !named;
    const want = nothing ? 0 : Math.round(opts.amount * opts.cap * 0.8);
    const weights = GEODE_KINDS.map((k) => [k, named ? Math.max(0, opts.mix?.[k] ?? 0) : KIND[k].share] as const).filter(([, v]) => v > 0);
    const total = weights.reduce((a, [, v]) => a + v, 0);
    const placed: Array<{ x: number; z: number; r: number }> = [];
    const landmark = opts.amount >= 0.5 && weights.some(([k]) => k === 'cavern');
    for (let i = 0; i < want * 8 && geodes < want; i += 1) {
      let roll = rng.next() * total, kind: GeodeKind = weights[0]![0];
      for (const [k, v] of weights) { if (roll < v) { kind = k; break; } roll -= v; }
      if (landmark && byKind.cavern === 0 && i < 16) kind = 'cavern';
      if (KIND[kind].max !== undefined && byKind[kind] >= KIND[kind].max!) continue;
      const mega = kind === 'cavern';
      const a = mega ? Math.PI * rng.range(1.25, 1.75) : rng.range(0, Math.PI * 2);
      const d = (mega ? rng.range(175, 215) : rng.range(50, 170)) * s;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const room = KIND[kind].room * s;
      if (opts.blocked(x, z, room) || placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + room)) continue;
      placed.push({ x, z, r: room });
      // Opening toward the front of the tank, where the camera usually is, give or take.
      const yaw = Math.atan2(-x, 320 * s - z) + (mega ? 0 : rng.range(-0.45, 0.45));
      // Its mineral: what the scene chose, else the colour of the crystal nearest it, else any.
      const near = !minerals && opts.anchors?.length
        ? opts.anchors.reduce((b, c) => (Math.hypot(x - c.x, z - c.z) < Math.hypot(x - b.x, z - b.z) ? c : b))
        : null;
      const mineral = near ? mineralNear(near.color) : mega && !minerals ? 'amethyst' : pickMineral(rng, minerals);
      put(kind, x, z, yaw, mineral, rng.next() < 0.05);
    }
  }
  // ---- the town: a fountain in the square, lamps along the paths ---------
  const mineralAt = (x: number, z: number): MineralName => {
    if (minerals) return minerals[0]!;
    if (!opts.anchors?.length) return 'quartz';
    const near = opts.anchors.reduce((b, c) => (Math.hypot(x - c.x, z - c.z) < Math.hypot(x - b.x, z - b.z) ? c : b));
    return mineralNear(near.color);
  };
  let fountain: GeodeField['fountain'] = null;
  if (opts.fountain) {
    const { x, z, kind } = opts.fountain;
    const floor = opts.terrain(x, z), frng = rng.fork(77);
    const m = MINERAL[mineralAt(x, z)];
    const stone = STONE.clone();
    if (kind === 'vent') {
      // A hydrothermal chimney: a broad slate mound, a knobbled stack on it,
      // crusted with crystal where the hot water cools, glowing at the mouth.
      w.place = new Matrix4().makeTranslation(x, floor - 1.5 * s, z);
      column(w, frng, 7 * s, 20 * s, 12 * s, 11, 2, stone.clone().multiplyScalar(0.9));
      w.place = new Matrix4().makeTranslation(x, floor + 5 * s, z);
      column(w, frng, 30 * s, 9 * s, 4.2 * s, 9, 8, stone);
      const mouthY = 30 * s;
      // The mouth glows hot whatever the neighbourhood: a vent's water is
      // hot, and the crystal that crusts round its lip is citrine-gold.
      crown(w, frng, new Vector3(0, mouthY - 1.5 * s, 0), 8, 6 * s, 1, MINERAL.citrine);
      // Down the stack, the local crystal crusts it where the water cools.
      for (let k = 0; k < 6; k += 1) {
        const a = frng.range(0, 6.28), y = frng.range(3, 24) * s, r = (9 - y / s * 0.16) * s;
        crown(w, frng, new Vector3(Math.cos(a) * r, y, Math.sin(a) * r), 3, 3.6 * s, 0.8, m);
      }
      fountain = { x, y: floor + 5 * s + mouthY, z, color: '#ffb36b' };
      obstacles.push({ x, y: floor, z, r: 20 * s, h: 38 * s });
    } else {
      // A geode basin: one great half, cut face up, on a short plinth, its
      // hollow full of crystal and its agate rim the basin's edge.
      w.place = new Matrix4().makeTranslation(x, floor - 1 * s, z);
      column(w, frng, 7 * s, 12 * s, 10 * s, 12, 2, stone);
      const R = 17 * s, from = w.mark;
      w.place = new Matrix4().makeTranslation(x, floor, z);
      half(w, frng.fork(1), { out: outline(frng, 44, 1, 1, 0.08), R, depth: 0.6, m, hollow: 0.68, hollowDepth: 0.8, crystals: 220, crystalScale: 1.1, aura: false, band: frng.next() });
      w.settle(from, floor + 6 * s, 0);
      fountain = { x, y: floor + 6 * s + R * 0.6 + 2 * s, z, color: m.tip };
      obstacles.push({ x, y: floor, z, r: R * 1.05, h: R * 0.9 });
    }
  }
  const lamps: GeodeField['lamps'] = [];
  for (const [i, at] of (opts.lamps ?? []).entries()) {
    // A slate post, a cap, and a small crystal crown that glows.
    const floor = opts.terrain(at.x, at.z), lrng = rng.fork(500 + i);
    const m = MINERAL[mineralAt(at.x, at.z)];
    w.place = new Matrix4().makeTranslation(at.x, floor - 0.5 * s, at.z);
    column(w, lrng, 14 * s, 2 * s, 1.4 * s, 6, 3, STONE.clone().multiplyScalar(0.95));
    w.place = new Matrix4().makeTranslation(at.x, floor + 13.5 * s, at.z);
    column(w, lrng, 1.4 * s, 3 * s, 2.8 * s, 6, 1, STONE.clone().multiplyScalar(1.15));
    crown(w, lrng, new Vector3(0, 1.3 * s, 0), 5, 6 * s, 0.5, m);
    lamps.push({ x: at.x, y: floor + 18.5 * s, z: at.z, color: m.tip });
  }
  const geometry = w.geometry();
  return { geometry, geodes, byKind, aura, thundereggs, obstacles, lights, fountain, lamps, triangles: geometry ? geometry.getAttribute('position').count / 3 : 0 };
}

/** Vertex side: hand the fragment what each pixel is, and how awake (a fish near). */
export const GEODE_PARS = /* glsl */ `
  attribute float aPart; attribute vec4 aGeo; attribute vec3 aColB;
  varying vec3 vGeoW; varying float vGeoPart; varying vec4 vGeo; varying vec3 vColB; varying float vGeoWake;
`;
export const GEODE_VERTEX = /* glsl */ `
  #include <project_vertex>
  vGeoW = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vGeoPart = aPart; vGeo = aGeo; vColB = aColB;
  vGeoWake = (aGeo.w > 0.0 && uMqFloraFishN > 0) ? aGeo.w * mqStartleAt(vGeoW) : 0.0;
`;

/** Fragment side: the noise the stone and the agate are drawn from. */
export const GEODE_FRAGMENT_PARS = /* glsl */ `
  uniform float uGeoTime; uniform float uGeoGlow; uniform float uGeoPulse;
  varying vec3 vGeoW; varying float vGeoPart; varying vec4 vGeo; varying vec3 vColB; varying float vGeoWake;
  float gH(vec3 p) { p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float gN(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(gH(i), gH(i + vec3(1.0, 0.0, 0.0)), f.x), mix(gH(i + vec3(0.0, 1.0, 0.0)), gH(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
               mix(mix(gH(i + vec3(0.0, 0.0, 1.0)), gH(i + vec3(1.0, 0.0, 1.0)), f.x), mix(gH(i + vec3(0.0, 1.0, 1.0)), gH(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
  }
  float gF(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * gN(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
`;
export const GEODE_SHADE = /* glsl */ `
  #include <color_fragment>
  {
    // The world's rules, so a geode belongs to it: the same fixed key the
    // terrain, the rocks and the crystals are lit by (up, left, from behind),
    // faceted shading with a per-facet offset (what reads as "cut"), and its
    // crystals the world's crystal: emissive, white-hot at the root,
    // saturated at the tip, pulsing with crystalGlow / crystalPulse.
    vec3 gNrm = normalize(cross(dFdx(vGeoW), dFdy(vGeoW)));
    vec3 gV = normalize(cameraPosition - vGeoW);
    if (dot(gNrm, gV) < 0.0) gNrm = -gNrm;
    vec3 gL = normalize(vec3(-0.45, 0.78, -0.43));
    float gKey = max(dot(gNrm, gL), 0.0);
    float gFacet = fract(sin(dot(gNrm, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    float gFres = pow(1.0 - abs(dot(gNrm, gV)), 2.5);
    float gBeat = 1.0 - uGeoPulse * 0.15 * (0.5 + 0.5 * sin(uGeoTime * 0.754 + vGeo.y * 6.28));
    vec3 gA = diffuseColor.rgb, gB = vColB, gC;
    if (vGeoPart < 0.5) {
      // Crust: the world's stone, baked the way paintStone bakes a rock.
      gC = gA * (0.36 + 0.64 * gKey) * (0.9 + 0.2 * gFacet);
    } else if (vGeoPart < 1.5) {
      // Agate, in the world's key: bands from the noise-warped band field,
      // a pale thread at each edge, a little glow of its own (agate is
      // translucent; the cut catches the light of the hollow behind it).
      float t = vGeo.x;
      float warp = (gF(vGeoW * 0.15 + vGeo.y * 7.0) - 0.5) * 0.24 + (gN(vGeoW * 0.85) - 0.5) * 0.035;
      float tt = clamp(t + warp * (t > 1.0 ? 0.3 : 0.2 + 0.8 * t), 0.0, 1.8);
      vec3 alb;
      if (tt < 0.06) alb = gA * 0.22 + vec3(0.12, 0.13, 0.16);
      else if (tt < 0.095) alb = mix(gB, vec3(0.85), 0.5);
      else {
        float nb = 8.0 + floor(vGeo.y * 10.0);
        float b = (tt - 0.095) / 0.905 * nb;
        float k = floor(b), f = fract(b);
        float pick = gH(vec3(k, vGeo.y * 31.0, 3.0));
        alb = pick < 0.5 ? gA : (pick < 0.88 ? gB : mix(gB, vec3(1.0), 0.6));
        alb = mix(alb, mix(gA, gB, 0.5), step(0.68, gH(vec3(k, 2.0, vGeo.y))) * 0.6);
        float edge = 1.0 - smoothstep(0.0, 0.08, min(f, 1.0 - f));
        alb = mix(alb, mix(gB, vec3(1.0), 0.5), edge * 0.4);
        alb *= 0.8 + 0.3 * min(tt, 1.0);
      }
      gC = alb * (0.42 + 0.34 * gKey + 0.2 * gFres) * gBeat * (0.7 + 0.3 * uGeoGlow);
    } else if (vGeoPart < 2.5) {
      // The hollow: a dark glass body (the world's glass), its druse catching
      // the light cell by cell, deeper darker.
      float ao = mix(1.0, 0.35, vGeo.x);
      float h = gH(floor(vGeoW * 3.2));
      float tw = pow(max(0.0, sin(h * 91.0 + dot(gV, vec3(4.1, 3.3, 2.7)) * 5.0 + uGeoTime * 0.7)), 26.0) * step(0.7, h);
      gC = gA * ao * (0.35 + 0.4 * gKey) + gB * tw * 1.3 * (0.4 + ao) * (0.5 + 0.5 * uGeoGlow);
    } else {
      // A crystal is the world's crystal: emissive, white-hot at the root.
      float t = vGeo.x;
      vec3 c = gB;
      if (vGeo.z > 9.0) c = 0.55 + 0.45 * cos(6.2832 * (gFres * 1.4 + t * 0.5 + vec3(0.0, 0.33, 0.67)));
      float shade = 0.46 + 0.5 * gKey + (gFacet - 0.5) * 0.36;
      float hot = (1.0 - t) * (1.0 - t) * 0.9 * (0.55 + 0.45 * gKey);
      gC = mix(c, vec3(1.0), hot) * shade * (0.85 + 0.4 * gFres) * gBeat * (0.5 + 0.5 * uGeoGlow);
      gC += vec3(smoothstep(0.62, 0.95, gFacet) * gFres * gFres * 0.8);
    }
    diffuseColor.rgb = gC * (1.0 + vGeoWake * 0.8);
  }
`;
