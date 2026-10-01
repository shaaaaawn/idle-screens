/**
 * Wild geodes — the mineral world's own treasure, lying about the floor.
 *
 * A real geode is a void in rock that mineral water filled from the walls
 * inward: a rough crust outside, then bands of chalcedony (agate) laid down
 * one by one, then — if the void did not fill — a hollow lined with crystal
 * points (druse), amethyst in Uruguay and Brazil, celestine in Madagascar,
 * quartz in Morocco. Cut, the bands follow the shape of the cavity like the
 * rings of a tree; a thunder egg's core is a star of agate; an amethyst
 * "cathedral" is a tall lava-tube section stood on end. Under the sea the
 * same chemistry builds Naica's beams of selenite and Ikka Fjord's ikaite
 * columns.
 *
 * And then the question the brief asked: what would No Man's Sky do with
 * them? It would make them SPECIES — a handful of archetypes, each grown
 * from a seed in its own proportions and its own mineral — give each world
 * one bold mineral scheme, make some of them MEGA, set a few of them
 * floating (its Gravitino balls), make the rare one iridescent, and have
 * them answer the player. So:
 *
 *   nodule      a split nodule: one half lying cut-face up, its twin leaning
 *               beside it facing out — the pair every rock shop shows
 *   thunderegg  a round egg cut in two, its core a star of agate
 *   cathedral   a tall amethyst cathedral standing open, crystal to the roof
 *   druse       a crust of rock carpeted in crystal points (an amethyst cluster)
 *   orb         a floating geode, two halves parted, turning slowly as it bobs
 *   column      ikaite tufa: knobbled pale pillars banded green and gold
 *   cavern      the mega geode (one at most): a cave mouth, beams of selenite inside
 *
 * Minerals are faceted (the world's one rule), so these are triangles, not
 * voxels: every cut face is real banding, every druse point a little pyramid.
 * Druse catches the light — a facet glints as the view swings past it — an
 * aura morph is iridescent, the orbs drift, and the crystals of every geode
 * brighten when a fish swims close (the same cast positions the flora reads).
 * One merged mesh; all motion and light in the vertex shader.
 */

import { BufferAttribute, BufferGeometry, Color, Matrix4, Quaternion, Vector3 } from 'three';
import type { CrystalRng } from './crystals';
import { GEODE_KINDS, type GeodeKind, type MineralName } from './geode-mix';

export { GEODE_KINDS, MINERALS, parseGeodeMix, parseGeodeMineral, type GeodeKind, type MineralName } from './geode-mix';

/** A mineral: the colours a geode of it is made of, outside to in. */
interface Mineral {
  /** The rough crust, and the thin skin band just inside it. */
  crust: string; skin: string;
  /** Agate bands, outside in; a geode uses a seeded run of them. */
  bands: readonly string[];
  /** Crystal points: dark at the root, bright at the tip. */
  root: string; tip: string;
  /** How long its points grow (fraction of the geode's radius) and how densely. */
  len: readonly [number, number]; dense: number;
}

const MINERAL: Readonly<Record<MineralName, Mineral>> = {
  amethyst: { crust: '#6e6a62', skin: '#cfc8d6', bands: ['#e9e3f0', '#9a8fb0', '#5a4a7a', '#d8d0e6'], root: '#3a1470', tip: '#b47cff', len: [0.07, 0.16], dense: 0.9 },
  agate: { crust: '#7a7266', skin: '#e8f2ff', bands: ['#1f4fbf', '#7fb4ff', '#e8f2ff', '#2f6fd8', '#0f2f7f', '#a8ccff'], root: '#2a5fc0', tip: '#d8ecff', len: [0.03, 0.07], dense: 1 },
  celestine: { crust: '#b8ab92', skin: '#eef4fa', bands: ['#e6f2ff', '#bcd8f0', '#d0e4f6'], root: '#6aa8e0', tip: '#cfe8ff', len: [0.08, 0.2], dense: 0.55 },
  citrine: { crust: '#7a6a52', skin: '#f6ecd6', bands: ['#fff1d0', '#e09030', '#8a4a10', '#f6c060'], root: '#a85a10', tip: '#ffd060', len: [0.06, 0.14], dense: 0.85 },
  carnelian: { crust: '#6a5a50', skin: '#ffe0d6', bands: ['#ffd0c0', '#d0302a', '#7a1010', '#f07050'], root: '#8a1010', tip: '#ff6a5a', len: [0.04, 0.09], dense: 0.9 },
  rose: { crust: '#7a6e6a', skin: '#ffffff', bands: ['#ff2f7a', '#ffb0d0', '#ffffff', '#c01f5a', '#ff70a8'], root: '#c0306a', tip: '#ffc0dc', len: [0.03, 0.07], dense: 1 },
  emerald: { crust: '#5e665a', skin: '#e0ffe8', bands: ['#0f7f3a', '#9fefb0', '#1fbf5a', '#e0ffe8'], root: '#0a6a2a', tip: '#7fffa8', len: [0.05, 0.11], dense: 0.9 },
  quartz: { crust: '#8a8274', skin: '#f4f0e8', bands: ['#d8d4cc', '#a8a49c', '#f4f0e8', '#bab4aa'], root: '#c8ccd6', tip: '#ffffff', len: [0.07, 0.18], dense: 0.8 },
  smoky: { crust: '#4e4842', skin: '#c8b8a0', bands: ['#5a4a3a', '#c8b8a0', '#3a2e24', '#9a8670'], root: '#3a2a1e', tip: '#b89a78', len: [0.07, 0.16], dense: 0.8 },
};

/** Draw weights when nothing chooses a mineral: amethyst and agate are the common ones. */
const MINERAL_WEIGHT: Readonly<Record<MineralName, number>> = {
  amethyst: 3, agate: 2.2, celestine: 1.2, citrine: 1.2, carnelian: 0.9, rose: 1, emerald: 0.7, quartz: 1.5, smoky: 0.8,
};

export interface GeodeSite { x: number; z: number }

export interface GeodeFieldOptions {
  /** 0..1 — how many wild geodes (× the device's props budget). */
  amount: number;
  cap: number;
  scale: number;
  /** Relative weights by kind (`geodeMix`); empty = the default spread. */
  mix?: Partial<Record<GeodeKind, number>>;
  /** Minerals to draw from (`geodeMineral`); empty = all, by weight. */
  minerals?: readonly MineralName[];
  /** `field` scatters them; `gallery` stands one of each kind in rows. */
  layout?: 'field' | 'gallery';
  /** True where something already stands (a home, a crystal, a road). */
  blocked(x: number, z: number, r: number): boolean;
  terrain(x: number, z: number): number;
}

export interface GeodeField {
  geometry: BufferGeometry | null;
  geodes: number;
  byKind: Record<GeodeKind, number>;
  /** Iridescent "aura" morphs (about one in twenty). */
  aura: number;
  /** For the scenery: what fish steer round, and where a geode's light leaves it. */
  obstacles: { x: number; y: number; z: number; r: number; h: number }[];
  lights: { x: number; y: number; z: number; color: string; reach: number }[];
  triangles: number;
}

/** Each vertex's look (aGeo): glint, iridescence, a phase, and whether a fish lights it. */
interface Look { glint: number; irid: number; glow: number }
const STONE: Look = { glint: 0, irid: 0, glow: 0 };

/** Faceted shading for a face of this normal (the world's key light, from up-left-front). */
const KEY = new Vector3(-0.45, 0.78, 0.43).normalize();

class GeoWriter {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  readonly geo: number[] = [];
  readonly flt: number[] = [];
  place = new Matrix4();
  /** For a floating geode: its centre and how far it bobs (aFloat). */
  float: [number, number, number, number] = [0, 0, 0, 0];
  phase = 0;
  private readonly a = new Vector3(); private readonly b = new Vector3(); private readonly c = new Vector3();
  private readonly n = new Vector3();

  /** A triangle in local space; `shade` gives it faceted key light (stone), else a gentle facet lift (crystal, polish). */
  tri(a: Vector3, b: Vector3, c: Vector3, ca: Color, cb: Color, cc: Color, look: Look, shade: 'stone' | 'polish' | 'gem'): void {
    this.a.copy(a).applyMatrix4(this.place); this.b.copy(b).applyMatrix4(this.place); this.c.copy(c).applyMatrix4(this.place);
    this.n.subVectors(this.b, this.a).cross(new Vector3().subVectors(this.c, this.a)).normalize();
    const d = this.n.dot(KEY);
    // DoubleSide: a face seen from its back is lit as if it faced you.
    const k = shade === 'stone' ? 0.42 + 0.68 * Math.abs(d) : shade === 'polish' ? 0.86 + 0.2 * Math.abs(d) : 0.78 + 0.32 * Math.abs(d);
    for (const [p, col] of [[this.a, ca], [this.b, cb], [this.c, cc]] as const) {
      this.pos.push(p.x, p.y, p.z);
      this.col.push(col.r * k, col.g * k, col.b * k);
      this.geo.push(look.glint, look.irid, this.phase, look.glow);
      this.flt.push(...this.float);
    }
  }

  quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, col: Color, look: Look, shade: 'stone' | 'polish' | 'gem'): void {
    this.tri(a, b, c, col, col, col, look, shade);
    this.tri(a, c, d, col, col, col, look, shade);
  }

  /** Vertices written so far (a part's start, for `settle`). */
  get mark(): number { return this.pos.length / 3; }

  /** Lower or raise everything since `from` so its lowest point sits `bury` below `floor`. */
  settle(from: number, floor: number, bury: number): number {
    let low = Infinity;
    for (let v = from; v < this.pos.length / 3; v += 1) low = Math.min(low, this.pos[v * 3 + 1]!);
    const dy = floor - bury - low;
    for (let v = from; v < this.pos.length / 3; v += 1) {
      this.pos[v * 3 + 1] = this.pos[v * 3 + 1]! + dy;
      if (this.flt[v * 4 + 3]! > 0) this.flt[v * 4 + 1] = this.flt[v * 4 + 1]! + dy;
    }
    return dy;
  }

  geometry(): BufferGeometry | null {
    if (!this.pos.length) return null;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('aGeo', new BufferAttribute(new Float32Array(this.geo), 4));
    g.setAttribute('aFloat', new BufferAttribute(new Float32Array(this.flt), 4));
    g.computeVertexNormals();
    return g;
  }
}

/** A closed outline in the cut plane (unit points, local XZ): a seeded wobble, optionally drawn to a point at -z. */
function outline(rng: CrystalRng, n: number, a: number, b: number, rough: number, point = 0): Array<[number, number]> {
  const p1 = rng.range(0, 6.28), p2 = rng.range(0, 6.28), p3 = rng.range(0, 6.28);
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i += 1) {
    const t = (i / n) * Math.PI * 2;
    const o = 1 + rough * (0.4 * Math.sin(2 * t + p1) + 0.35 * Math.sin(3 * t + p2) + 0.25 * Math.sin(5 * t + p3)) + rough * 0.25 * rng.range(-1, 1);
    const sz = Math.sin(t);
    out.push([Math.cos(t) * a * o, sz * b * o * (1 + point * Math.max(0, -sz) ** 6)]);
  }
  return out;
}

interface HalfOpts {
  out: Array<[number, number]>;
  /** Local radius (the outline's unit), dome depth as a fraction of it. */
  R: number; depth: number;
  m: Mineral;
  /** Bands across the cut face (0 = a plain crust lip). */
  bands: number;
  /** The cavity's size at the cut (0 = solid). */
  cavity: number;
  /** A thunder egg: the bands close on a star instead of a hollow. */
  star?: boolean;
  /** Crystal points: how long (× R), how many of the cavity's facets carry one, and do they stand up rather than point in. */
  len: readonly [number, number]; dense: number; up?: boolean;
  /** Bigger points toward the bottom of the cavity (a cathedral's). */
  grade?: number;
  /** Rings from the cut to the bottom (more = finer druse); default 5. */
  rings?: number;
  look: Look;
}

/**
 * Half a geode, in local space: the cut is the plane y = 0 and the dome
 * hangs below it. Crust outside; on the cut, a rind and agate bands that
 * follow the outline inward; inside, a hollow lined with crystal points.
 */
function half(w: GeoWriter, rng: CrystalRng, o: HalfOpts): void {
  const n = o.out.length, R = o.R, nu = o.rings ?? 5;
  const crust = new Color(o.m.crust), crustDark = crust.clone().multiplyScalar(0.62), skin = new Color(o.m.skin);
  const ring = (s: number, u: number, lumpy: boolean, k: number, depth: number): Vector3[] => o.out.map(([x, z]) => {
    const c = Math.cos(u * Math.PI / 2), l = lumpy && u > 0 ? rng.range(0.9, 1.1) : 1;
    return new Vector3(x * R * s * c * l, -depth * R * s * Math.sin(u * Math.PI / 2) * k, z * R * s * c * l);
  });
  // ---- the crust: a lumpy dome under the cut ---------------------------
  const rings: Vector3[][] = [];
  for (let k = 0; k <= nu; k += 1) rings.push(ring(1, k / nu, true, 1, o.depth));
  for (let k = 0; k < nu; k += 1) {
    const A = rings[k]!, B = rings[k + 1]!, col = crust.clone().lerp(crustDark, k / nu);
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      w.quad(A[i]!, A[j]!, B[j]!, B[i]!, col.clone().multiplyScalar(rng.range(0.9, 1.08)), STONE, 'stone');
    }
  }
  // ---- the cut: a rind, then agate bands closing in ---------------------
  const at = (s: number, i: number, t = 0): Vector3 => {
    const [x, z] = o.out[i % n]!;
    if (!o.star) return new Vector3(x * R * s, 0.002 * R, z * R * s);
    // A thunder egg's bands close on a five-pointed star.
    const th = (i / n) * Math.PI * 2, star = 0.32 * (1 + 0.55 * Math.abs(Math.cos(th * 2.5)));
    const fx = x * s * (1 - t) + Math.cos(th) * star * t, fz = z * s * (1 - t) + Math.sin(th) * star * t;
    return new Vector3(fx * R, 0.002 * R, fz * R);
  };
  const stops: number[] = [1, 0.93];
  const inner = o.star ? 0.32 : Math.max(0.12, o.cavity);
  const nb = Math.max(0, o.bands);
  // Bands of seeded width, finer toward the middle — agate's rhythm.
  const widths = Array.from({ length: nb }, () => rng.range(0.4, 1.6));
  const total = widths.reduce((a, b) => a + b, 0) || 1;
  let s = 0.93;
  for (const wd of widths) { s -= (0.93 - inner) * (wd / total); stops.push(s); }
  if (!nb) stops.push(inner);
  const runStart = Math.floor(rng.next() * o.m.bands.length);
  for (let b = 0; b < stops.length - 1; b += 1) {
    const sa = stops[b]!, sb = stops[b + 1]!;
    const col = b === 0 ? skin.clone().lerp(crust, 0.35) : new Color(o.m.bands[(runStart + b) % o.m.bands.length]!);
    const ta = o.star ? (1 - (sa - inner) / (1 - inner)) : 0, tb = o.star ? (1 - (sb - inner) / (1 - inner)) : 0;
    for (let i = 0; i < n; i += 1) {
      w.quad(at(sa, i, ta), at(sa, i + 1, ta), at(sb, i + 1, tb), at(sb, i, tb), col, b === 0 ? STONE : { ...o.look, glint: 0, glow: 0 }, 'polish');
    }
  }
  // ---- the heart: a star of druse, or a crystal-lined hollow -------------
  const root = new Color(o.m.root), tip = new Color(o.m.tip), hot = tip.clone().lerp(new Color('#ffffff'), 0.55);
  const point = (p: Vector3, q: Vector3, r: Vector3, dir: Vector3, len: number): void => {
    const mid = new Vector3().add(p).add(q).add(r).multiplyScalar(1 / 3);
    const shrink = (v: Vector3): Vector3 => v.clone().lerp(mid, 0.06);
    const pa = shrink(p), pb = shrink(q), pc = shrink(r);
    const apex = mid.clone().addScaledVector(dir, len);
    w.phase = rng.next() * 6.283;
    const rc = root.clone().multiplyScalar(rng.range(0.85, 1.15)), tc = (rng.next() < 0.25 ? hot : tip).clone().multiplyScalar(rng.range(0.9, 1.1));
    w.tri(pa, pb, apex, rc, rc, tc, o.look, 'gem');
    w.tri(pb, pc, apex, rc, rc, tc, o.look, 'gem');
    w.tri(pc, pa, apex, rc, rc, tc, o.look, 'gem');
  };
  if (o.star) {
    // The core: a flat star of the druse colour, sparkling.
    const c0 = new Vector3(0, 0.003 * R, 0);
    for (let i = 0; i < n; i += 1) w.tri(c0, at(inner, i, 1), at(inner, i + 1, 1), tip, root, root, o.look, 'polish');
    for (let i = 0; i < n; i += 2) {
      const p = at(inner, i, 1).multiplyScalar(0.55);
      point(p.clone().add(new Vector3(0.02 * R, 0, 0)), p.clone().add(new Vector3(-0.01 * R, 0, 0.02 * R)), p.clone().add(new Vector3(-0.01 * R, 0, -0.02 * R)), new Vector3(0, 1, 0), 0.03 * R);
    }
    return;
  }
  if (o.cavity <= 0) return;
  const cd = Math.max(0.12, o.depth * 0.86);
  const holes: Vector3[][] = [];
  for (let k = 0; k <= nu; k += 1) holes.push(ring(o.cavity, k / nu, false, 1, cd));
  const centre = new Vector3(0, -cd * R * o.cavity * 0.3, 0);
  // The wall between the points: the crystal's own colour, a shade deep — not
  // black, or the gaps read as a net.
  const wall = root.clone().lerp(tip, 0.25).multiplyScalar(0.8);
  for (let k = 0; k < nu; k += 1) {
    const A = holes[k]!, B = holes[k + 1]!;
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      w.quad(A[i]!, B[i]!, B[j]!, A[j]!, wall, { ...o.look, glint: o.look.glint * 0.5 }, 'gem');
      // A crystal on most facets, bigger deeper in.
      for (const [p, q, r] of [[A[i]!, B[i]!, B[j]!], [A[i]!, B[j]!, A[j]!]] as const) {
        if (rng.next() > o.dense) continue;
        const mid = new Vector3().add(p).add(q).add(r).multiplyScalar(1 / 3);
        const dir = o.up ? new Vector3(rng.range(-0.25, 0.25), 1, rng.range(-0.25, 0.25)).normalize() : centre.clone().sub(mid).normalize();
        const grade = 1 + (o.grade ?? 0) * (k / nu);
        point(p, q, r, dir, rng.range(o.len[0], o.len[1]) * R * grade);
      }
    }
  }
}

/** An outline at twice the resolution (midpoints added), for the mega geode's finer druse. */
function outlineFine(out: Array<[number, number]>): Array<[number, number]> {
  return out.flatMap(([x, z], i) => {
    const [x2, z2] = out[(i + 1) % out.length]!;
    return [[x, z], [(x + x2) / 2, (z + z2) / 2]] as Array<[number, number]>;
  });
}

/** A prism of `sides` from a to b, radius r, capped with points: a beam of selenite. */
function beam(w: GeoWriter, a: Vector3, b: Vector3, r: number, col: Color, end: Color, look: Look, sides = 6): void {
  const axis = new Vector3().subVectors(b, a).normalize();
  const helper = Math.abs(axis.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const u = new Vector3().crossVectors(axis, helper).normalize(), v = new Vector3().crossVectors(axis, u);
  const at = (base: Vector3, i: number): Vector3 => {
    const t = (i / sides) * Math.PI * 2;
    return base.clone().addScaledVector(u, Math.cos(t) * r).addScaledVector(v, Math.sin(t) * r);
  };
  const a0 = a.clone().addScaledVector(axis, r * 1.5), b0 = b.clone().addScaledVector(axis, -r * 1.5);
  for (let i = 0; i < sides; i += 1) {
    const p = at(a0, i), q = at(a0, i + 1), pp = at(b0, i), qq = at(b0, i + 1);
    w.tri(p, q, qq, col, col, end, look, 'gem');
    w.tri(p, qq, pp, col, end, end, look, 'gem');
    w.tri(a, q, p, col, col, col, look, 'gem');
    w.tri(b, pp, qq, end, end, end, look, 'gem');
  }
}

function pickMineral(rng: CrystalRng, allowed: readonly MineralName[] | undefined): MineralName {
  const names = (allowed?.length ? allowed : (Object.keys(MINERAL) as MineralName[]));
  const total = names.reduce((a, m) => a + (allowed?.length ? 1 : MINERAL_WEIGHT[m]), 0);
  let roll = rng.next() * total;
  for (const m of names) { roll -= allowed?.length ? 1 : MINERAL_WEIGHT[m]; if (roll < 0) return m; }
  return names[0]!;
}

/** Default spread of kinds, and the most a field holds of each. */
const KIND: Readonly<Record<GeodeKind, { share: number; max?: number; size: readonly [number, number] }>> = {
  nodule: { share: 0.26, size: [9, 14] },
  thunderegg: { share: 0.15, size: [7, 11] },
  cathedral: { share: 0.12, size: [11, 16] },
  druse: { share: 0.2, size: [8, 13] },
  orb: { share: 0.08, max: 3, size: [5, 8] },
  column: { share: 0.15, size: [4, 7] },
  cavern: { share: 0.04, max: 1, size: [40, 52] },
};

/** Grow one geode of `kind` at (x, z), its opening toward `yaw`. Returns its footprint and height. */
function grow(w: GeoWriter, rng: CrystalRng, kind: GeodeKind, mineralName: MineralName, x: number, z: number, yaw: number, s: number,
  floor: number, aura: boolean): { r: number; h: number; light?: { y: number; reach: number } } {
  const m = MINERAL[mineralName];
  const R = rng.range(KIND[kind].size[0], KIND[kind].size[1]) * s;
  // An aura morph: titanium-coated, every crystal iridescent.
  const look: Look = { glint: 0.9, irid: aura ? 1 : 0, glow: 1 };
  const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  const placeAt = (dx: number, dz: number, tiltX: number, extraYaw = 0): Matrix4 => {
    const q = turn.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), extraYaw))
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), tiltX));
    const off = new Vector3(dx, 0, dz).applyQuaternion(turn);
    return new Matrix4().compose(new Vector3(x + off.x, floor, z + off.z), q, new Vector3(1, 1, 1));
  };
  w.float = [0, 0, 0, 0];
  w.phase = rng.next() * 6.283;
  if (kind === 'nodule' || kind === 'thunderegg') {
    const star = kind === 'thunderegg';
    const out = outline(rng, 26, 1, star ? rng.range(0.9, 1) : rng.range(0.75, 1), star ? 0.06 : 0.16);
    const opts: HalfOpts = {
      out, R, depth: star ? 0.95 : rng.range(0.7, 0.95), m, bands: star ? 5 + Math.floor(rng.next() * 3) : 2 + Math.floor(rng.next() * 5),
      cavity: star ? 0 : rng.range(0.42, 0.62), star, len: m.len, dense: m.dense, look,
    };
    // The pair: one half lies cut-face up, its twin leans beside it, facing out.
    const hrng = rng.fork(1);
    let from = w.mark;
    w.place = placeAt(-R * 0.95, 0, 0);
    half(w, hrng.fork(1), opts);
    w.settle(from, floor, R * opts.depth * 0.25);
    from = w.mark;
    w.place = placeAt(R * 1.05, R * 0.1, Math.PI / 2 - rng.range(0.25, 0.5), rng.range(-0.3, 0.3));
    half(w, hrng.fork(1), { ...opts, out: out.map(([a, b]) => [-a, b] as [number, number]) });
    w.settle(from, floor, R * 0.12);
    return { r: R * 2.1, h: R * 2 };
  }
  if (kind === 'cathedral') {
    // Tall, drawn to a point at the top, stood open toward the front.
    const out = outline(rng, 30, 1, rng.range(2, 2.5), 0.1, 0.4);
    const from = w.mark;
    w.place = placeAt(0, 0, Math.PI / 2);
    half(w, rng.fork(2), { out, R, depth: rng.range(0.75, 0.95), m, bands: 1 + Math.floor(rng.next() * 2), cavity: 0.86, len: [m.len[0] * 0.9, m.len[1] * 1.1], dense: Math.min(1, m.dense + 0.1), grade: 0.8, look });
    w.settle(from, floor, R * 0.15);
    return { r: R * 1.2, h: R * 4.6, light: { y: R * 2, reach: R * 3 } };
  }
  if (kind === 'druse') {
    // A slab of rock whose whole top is a carpet of points — an amethyst cluster.
    const out = outline(rng, 22, 1, rng.range(0.6, 0.9), 0.28);
    const from = w.mark;
    w.place = placeAt(0, 0, rng.range(-0.15, 0.15));
    half(w, rng.fork(3), { out, R, depth: rng.range(0.3, 0.45), m, bands: 0, cavity: 0.9, len: [m.len[0] * 1.4, m.len[1] * 1.8], dense: 1, up: true, look });
    w.settle(from, floor, R * 0.2);
    return { r: R, h: R * 0.7 };
  }
  if (kind === 'orb') {
    // A floating geode: two halves parted like a clam, turning as it bobs.
    const out = outline(rng, 22, 1, 1, 0.05);
    const lift = rng.range(18, 34) * s;
    const cy = floor + lift;
    w.float = [x, cy, z, rng.range(1.5, 3) * s];
    const opts: HalfOpts = { out, R, depth: 1, m, bands: 3, cavity: 0.72, len: m.len, dense: m.dense, look: { ...look, glow: 1.5 } };
    // The lower half lies cut-face up; the upper is hinged at the back and
    // swung open like a clam's, so the lit hollow faces out.
    const open = rng.range(0.85, 1.15);
    w.place = new Matrix4().compose(new Vector3(x, cy, z), turn, new Vector3(1, 1, 1));
    half(w, rng.fork(4), opts);
    // Flipped (cut face down), then swung up about the back edge so its
    // hollow looks out and down at the one below.
    const lid = turn.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI - open));
    const hinge = new Vector3(0, R * 0.05, -R).applyQuaternion(turn);
    const edge = new Vector3(0, 0, -R).applyQuaternion(lid);
    w.place = new Matrix4().compose(new Vector3(x + hinge.x - edge.x, cy + hinge.y - edge.y, z + hinge.z - edge.z), lid, new Vector3(1, 1, 1));
    half(w, rng.fork(5), opts);
    w.float = [0, 0, 0, 0];
    return { r: R * 1.2, h: lift + R, light: { y: lift, reach: R * 3 } };
  }
  if (kind === 'column') {
    // Ikaite tufa: one to three knobbled pillars, pale, banded with the green
    // and gold of what grows on them, a crest of tiny crystals at the top.
    const cols = 1 + Math.floor(rng.next() * 3);
    const cream = new Color('#efe7cf'), pore = new Color('#8a8270');
    const bandsC = [new Color('#9fbf6f'), new Color('#e0d070'), new Color('#cfd8a8')];
    let tallest = 0;
    for (let c = 0; c < cols; c += 1) {
      const cx = (c === 0 ? 0 : rng.range(-1.6, 1.6)) * R, cz = (c === 0 ? 0 : rng.range(-1.6, 1.6)) * R;
      const H = rng.range(6, 14) * R * (c === 0 ? 1 : 0.6), segs = 10 + Math.floor(rng.next() * 8), sides = 8;
      tallest = Math.max(tallest, H);
      w.place = placeAt(cx, cz, 0);
      let prev: Vector3[] | null = null;
      for (let j = 0; j <= segs; j += 1) {
        const t = j / segs, r = R * (1 - 0.45 * t) * rng.range(0.82, 1.18);
        const ox = rng.range(-0.15, 0.15) * R, oz = rng.range(-0.15, 0.15) * R;
        const ringV = Array.from({ length: sides }, (_, i) => {
          const a = (i / sides) * Math.PI * 2;
          return new Vector3(ox + Math.cos(a) * r * rng.range(0.85, 1.15), t * H - 0.3 * R, oz + Math.sin(a) * r * rng.range(0.85, 1.15));
        });
        if (prev) {
          const band = j % 4 === 0 ? bandsC[j % 3]! : cream;
          for (let i = 0; i < sides; i += 1) {
            const k = (i + 1) % sides;
            w.quad(prev[i]!, prev[k]!, ringV[k]!, ringV[i]!, rng.next() < 0.18 ? pore : band, STONE, 'stone');
          }
        }
        prev = ringV;
      }
      // The crest: a flat top crowned with a ring of tiny white points.
      const top = new Vector3(0, H - 0.3 * R, 0);
      for (let i = 0; i < sides; i += 1) w.tri(top, prev![(i + 1) % sides]!, prev![i]!, cream, cream, cream, STONE, 'stone');
      const white = new Color('#ffffff'), ice = new Color('#d8f0ff');
      const crest: Look = { glint: 1, irid: aura ? 1 : 0.15, glow: 1 };
      for (let i = 0; i < 7; i += 1) {
        const a = rng.range(0, 6.28), rr = rng.range(0, 0.45) * R;
        const b = top.clone().add(new Vector3(Math.cos(a) * rr, 0, Math.sin(a) * rr));
        w.phase = rng.next() * 6.283;
        const e = 0.12 * R;
        w.tri(b.clone().add(new Vector3(e, 0, 0)), b.clone().add(new Vector3(-e, 0, e)), b.clone().add(new Vector3(0, rng.range(0.4, 0.8) * R, 0)), ice, ice, white, crest, 'gem');
        w.tri(b.clone().add(new Vector3(-e, 0, e)), b.clone().add(new Vector3(0, 0, -e)), b.clone().add(new Vector3(0, rng.range(0.4, 0.8) * R, 0)), ice, ice, white, crest, 'gem');
      }
    }
    return { r: R * 2.2, h: tallest };
  }
  // The cavern: the mega geode. A great half stood open toward the middle of
  // the tank, buried to its waist, so its mouth is a cave; inside, beams of
  // selenite cross from wall to wall the way they do at Naica.
  const out = outline(rng, 34, 1.25, 1, 0.16);
  const from = w.mark;
  w.place = placeAt(0, 0, Math.PI / 2);
  half(w, rng.fork(6), { out: outlineFine(out), R, depth: 0.95, m, bands: 4 + Math.floor(rng.next() * 3), cavity: 0.87, len: [0.035, 0.09], dense: 0.95, grade: 0.6, rings: 10, look });
  const brng = rng.fork(7);
  const beams = 7 + Math.floor(brng.next() * 5);
  const selenite = new Color('#cfdce8'), glass = new Color('#f4f8ff');
  for (let i = 0; i < beams; i += 1) {
    // From a point on the cavity wall, across and up, to another.
    const a1 = brng.range(0, 6.28), a2 = a1 + Math.PI + brng.range(-0.9, 0.9);
    const d1 = brng.range(0.15, 0.6), d2 = brng.range(0.1, 0.5);
    const p = new Vector3(Math.cos(a1) * 1.25 * R * 0.78, -d1 * R, Math.sin(a1) * R * 0.78);
    const q = new Vector3(Math.cos(a2) * 1.25 * R * 0.7, -d2 * R, Math.sin(a2) * R * 0.7);
    w.phase = brng.next() * 6.283;
    beam(w, p, q, brng.range(0.022, 0.042) * R, selenite, glass, { glint: 0.6, irid: 0.35, glow: 1 });
  }
  w.settle(from, floor, R * 0.55);
  return { r: R * 1.3, h: R * 2.2 - R * 0.55, light: { y: R * 0.5, reach: R * 2.5 } };
}

/** The gallery's two rows: the low and the floating in front, the tall and the mega behind. */
export const GEODE_GALLERY: readonly (readonly GeodeKind[])[] = [
  ['thunderegg', 'nodule', 'druse', 'orb', 'nodule', 'thunderegg'],
  ['column', 'cathedral', 'cavern', 'cathedral', 'column'],
];

export function buildGeodeField(rng: CrystalRng, opts: GeodeFieldOptions): GeodeField {
  const w = new GeoWriter();
  const byKind = Object.fromEntries(GEODE_KINDS.map((k) => [k, 0])) as Record<GeodeKind, number>;
  const obstacles: GeodeField['obstacles'] = [], lights: GeodeField['lights'] = [];
  const s = opts.scale;
  let aura = 0, geodes = 0;
  const put = (kind: GeodeKind, x: number, z: number, yaw: number, mineral: MineralName, isAura: boolean): void => {
    const floor = opts.terrain(x, z);
    const grown = grow(w, rng.fork(1000 + geodes), kind, mineral, x, z, yaw, opts.layout === 'gallery' && kind !== 'cavern' ? s * 1.35 : s, floor, isAura);
    obstacles.push({ x, y: floor, z, r: grown.r, h: grown.h });
    if (grown.light) lights.push({ x, y: floor + grown.light.y, z, color: MINERAL[mineral].tip, reach: grown.light.reach });
    byKind[kind] += 1;
    geodes += 1;
    if (isAura) aura += 1;
  };
  const minerals = opts.minerals?.length ? opts.minerals : undefined;
  if (opts.layout === 'gallery') {
    // One of each kind, minerals dealt round in turn so every colour shows.
    const order = minerals ?? (['amethyst', 'agate', 'citrine', 'rose', 'celestine', 'emerald', 'carnelian', 'quartz', 'smoky'] as MineralName[]);
    let dealt = 0;
    GEODE_GALLERY.forEach((row, r) => {
      const gap = (r === 0 ? 40 : 62) * s, rowZ = (r === 0 ? 22 : -70) * s;
      row.forEach((kind, i) => {
        const x = (i - (row.length - 1) / 2) * gap;
        const z = kind === 'cavern' ? rowZ - 70 * s : rowZ;
        // Facing the front, toed in a little toward the middle.
        // The mega geode is always the showpiece mineral: amethyst, unless the scene chose.
        const mineral = kind === 'cavern' && !minerals ? 'amethyst' : order[dealt++ % order.length]!;
        put(kind, x, z, Math.atan2(-x, 420 * s), mineral, kind === 'orb');
      });
    });
  } else {
    const want = Math.round(opts.amount * opts.cap * 1.5);
    const named = opts.mix && Object.values(opts.mix).some((v) => (v ?? 0) > 0);
    const weights = GEODE_KINDS.map((k) => [k, named ? Math.max(0, opts.mix?.[k] ?? 0) : KIND[k].share] as const).filter(([, v]) => v > 0);
    const total = weights.reduce((a, [, v]) => a + v, 0);
    const placed: Array<{ x: number; z: number; r: number }> = [];
    // A full field always has its landmark: the mega geode comes first.
    const landmark = opts.amount >= 0.5 && weights.some(([k]) => k === 'cavern');
    for (let i = 0; i < want * 6 && geodes < want; i += 1) {
      let roll = rng.next() * total, kind: GeodeKind = weights[0]![0];
      for (const [k, v] of weights) { if (roll < v) { kind = k; break; } roll -= v; }
      if (landmark && byKind.cavern === 0 && i < 12) kind = 'cavern';
      if (KIND[kind].max !== undefined && byKind[kind] >= KIND[kind].max!) continue;
      // The cavern stands at the back, facing in; the rest scatter round the middle.
      const mega = kind === 'cavern';
      const a = mega ? Math.PI * rng.range(1.25, 1.75) : rng.range(0, Math.PI * 2);
      const d = (mega ? rng.range(170, 210) : rng.range(45, 175)) * s;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const room = (mega ? 75 : kind === 'cathedral' ? 22 : 18) * s;
      if (opts.blocked(x, z, room) || placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + room)) continue;
      placed.push({ x, z, r: room });
      // Opening toward the middle of the tank (where the camera looks), give or take.
      const yaw = Math.atan2(-x, -z) + (mega ? 0 : rng.range(-0.6, 0.6));
      put(kind, x, z, yaw, pickMineral(rng, minerals), rng.next() < 0.05);
    }
  }
  const geometry = w.geometry();
  return { geometry, geodes, byKind, aura, obstacles, lights, triangles: geometry ? geometry.getAttribute('position').count / 3 : 0 };
}

/** The look in the vertex shader: drift for the orbs; glints, aura and a fish's light for the crystals. */
export const GEODE_PARS = /* glsl */ `
  uniform float uGeoTime;
  attribute vec4 aGeo; attribute vec4 aFloat;
`;
export const GEODE_VERTEX = /* glsl */ `
  #include <begin_vertex>
  if (aFloat.w > 0.0) {
    // A floating geode turns slowly about its own centre and bobs.
    vec3 gc = aFloat.xyz, gp = transformed - gc;
    float ga = uGeoTime * 0.12 + aGeo.z * 0.15;
    float gcs = cos(ga), gsn = sin(ga);
    gp.xz = vec2(gcs * gp.x - gsn * gp.z, gsn * gp.x + gcs * gp.z);
    transformed = gc + gp;
    transformed.y += sin(uGeoTime * 0.5 + aFloat.x * 0.07) * aFloat.w;
  }
`;
export const GEODE_LOOK = /* glsl */ `
  #include <project_vertex>
  {
    vec3 gW = (modelMatrix * vec4(transformed, 1.0)).xyz;
    vec3 gN = normalize(mat3(modelMatrix) * normal);
    vec3 gV = normalize(cameraPosition - gW);
    float gFacing = abs(dot(gN, gV));
    // An aura morph: titanium film, its colour turning with the angle.
    if (aGeo.y > 0.0) {
      vec3 film = 0.55 + 0.45 * cos(6.2832 * ((1.0 - gFacing) * 1.6 + aGeo.z * 0.3 + vec3(0.0, 0.33, 0.67)));
      vColor.rgb = mix(vColor.rgb, film * (0.6 + 0.6 * max(max(vColor.r, vColor.g), vColor.b)), aGeo.y * 0.7);
    }
    // Druse glints: each little facet flashes white as the view (or the
    // slow clock) swings it past the light.
    if (aGeo.x > 0.0) {
      float g = pow(max(0.0, sin(aGeo.z * 61.0 + uGeoTime * 0.9 + gFacing * 14.0)), 40.0);
      vColor.rgb += aGeo.x * g * 1.4;
    }
    // A fish come close: the crystals wake.
    if (aGeo.w > 0.0 && uMqFloraFishN > 0) vColor.rgb *= 1.0 + aGeo.w * mqStartleAt(gW) * 0.9;
  }
`;
