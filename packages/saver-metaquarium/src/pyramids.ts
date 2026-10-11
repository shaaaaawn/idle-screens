/**
 * Pyramids: monuments built of cubes, as the fish are.
 *
 * A metaquarium fish is voxel art — a handful of square cubes, a classic token
 * fourteen of them nose to tail — and a pyramid here is made the same way: a
 * stack of cubes you can count, a dozen or two across, its cube a whole
 * multiple of the fish's (FISH_LENGTH / 14 × 1, 2, 3, 4, 6 or 8), so a
 * knee-high ruin by the glass and a mountain at the back of the floor are cut
 * from one grid and read as the same kind of thing. The cubes are drawn as
 * cubes: each its own shade of the stone, a fine seam between it and the next.
 *
 * Every one is exactly symmetric: an odd base, so its apex is one cube; each
 * layer a square, its stairs and temple the same on all four faces; and the
 * paint keyed on the sorted |x|, |z| of each cube, so the pattern has the
 * square's eight symmetries too.
 *
 * Shapes are integer rise:run sequences:
 *
 *   giza    five rises to four insets — 51.3°, the Great Pyramid's angle — a
 *           gilded pyramidion on many
 *   step    one in one: 45° stairs all the way
 *   bent    Dahshur's: steep (four rises to three) then shallow (one to one)
 *   djoser  six great tiers
 *   mayan   terraces, a stair up the middle of every face, a temple on top
 *   frame   only its edges: an open frame of glowing cubes
 *
 * They stand on the floor, always — in complexes, as Giza's do: a great
 * pyramid with its queens' pyramids in a row beside it, all squared to one
 * another. A few small complexes near the glass, more in the middle of the
 * floor, the great ones at the back fading into the water — only where the
 * floor is flat under the whole footprint (on a dune or a mound a square base
 * would bridge it or bury a corner, so there is none there). How did they get
 * there? Most stand true; some are half sunk in the sand; one has lost its
 * capstone, which lies in the sand at its foot.
 *
 * Geometry is the stepped faces only (a layer is a square: its four sides and
 * the ring of its top), so a pyramid is a few hundred quads. The cubes are
 * drawn in the fragment shader: each fragment knows its cube in the pyramid's
 * own frame (`aCell`), so the paint stays on the grid however the pyramid
 * is turned, and fades to its mean where a cube is under a pixel.
 */
import { BufferAttribute, BufferGeometry, Color, FrontSide, Matrix4, MeshBasicMaterial, Quaternion, Vector3, Vector4 } from 'three';
import type { CrystalRng, Emitter } from './crystals';
import { FISH_LENGTH } from './swim';
import { PYRAMID_MATERIAL_NAMES, PYRAMID_MATERIALS, PYRAMID_SHAPES, PYRAMID_STONES_BY_ENVIRONMENT, parsePyramidMix, type PyramidMaterial, type PyramidShape } from './pyramid-mix';

export { PYRAMID_MATERIAL_NAMES, PYRAMID_MATERIALS, PYRAMID_SHAPES, parsePyramidMix, type PyramidMaterial, type PyramidShape };

/** The fish's cube, in world units at `crystalScale` 1: a classic token is fourteen of them long. */
export const PYRAMID_VOXEL = FISH_LENGTH / 14;
/** A pyramid's cube is a whole number of the fish's: these, small to great. */
export const PYRAMID_CUBES = [1, 2, 3, 4, 5] as const;

export type PyramidPose = 'stand' | 'sunk' | 'capless';

export interface PyramidOptions {
  /** 0..1: how many. */
  amount: number;
  /** The device's prop budget (quality.props.clusters): the low tier gets fewer. */
  cap: number;
  /** `crystalScale`. */
  scale: number;
  environment: string;
  mix?: string;
  terrain: (x: number, z: number) => number;
  /** Whether a footprint of radius r at (x, z) is clear of everything already placed. */
  free: (x: number, z: number, r: number) => boolean;
}

export interface PyramidSite {
  x: number; z: number; shape: PyramidShape; material: PyramidMaterial; pose: PyramidPose;
  /** Half the base, in cubes (the base is 2·half + 1 across), and the cube's size in fish cubes. */
  half: number; cube: number; layers: number;
  /** The ground under its base's lowest corner; how far its lowest base corner sits above the ground there (never above: ≤ 0,
   *  it is set into the sand); its footprint's radius. */
  ground: number; seat: number; reach: number;
  band: 'near' | 'mid' | 'far'; complex: number;
}

export interface Pyramids {
  geometry: BufferGeometry | null;
  obstacles: Array<{ x: number; y: number; z: number; r: number; h: number }>;
  emitters: Emitter[];
  sites: PyramidSite[];
}

/** Half-widths of each layer, in cells: the pyramid's profile, bottom up. */
export function pyramidProfile(shape: PyramidShape, half: number): number[] {
  const w: number[] = [];
  const W = Math.max(1, Math.round(half));
  const up = (inset: (j: number) => number): void => {
    for (let j = 0; ; j++) { const v = W - inset(j); if (v < 0) break; w.push(v); if (v === 0) break; }
  };
  switch (shape) {
    case 'step': case 'frame': up((j) => j); break;
    case 'giza': up((j) => Math.floor((j * 4) / 5)); break;
    case 'bent': {
      // Steep to just past half its height, then shallow.
      const knee = Math.round(W * 0.5);
      up((j) => { const steep = Math.floor((j * 3) / 4); return steep < knee ? steep : knee + (j - Math.ceil((knee * 4) / 3)); });
      break;
    }
    case 'djoser': {
      const tier = Math.max(2, Math.round(W * 0.2)), inset = Math.max(1, Math.round(W / 6.5));
      for (let k = 0; k < 6; k++) { const v = W - k * inset; if (v < 1) break; for (let r = 0; r < tier; r++) w.push(v); }
      break;
    }
    case 'mayan': {
      const n = Math.max(3, Math.min(8, Math.round(W / 3))), tier = Math.max(2, Math.round(W / n));
      for (let k = 0; k < n; k++) { const v = W - k * tier; if (v < 2) break; for (let r = 0; r < tier; r++) w.push(v); }
      break;
    }
  }
  // Never empty: one cube at the least.
  return w.length ? w : [0];
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Voxel-art face values, as CubeWriter's: top brightest, the side pairs apart, the underside dark. */
const SHADE = { top: 1, bottom: 0.42, px: 0.8, nx: 0.62, pz: 0.72, nz: 0.55 } as const;

export class PyramidWriter {
  readonly pos: number[] = []; readonly col: number[] = []; readonly cell: number[] = [];
  readonly a: number[] = []; readonly b: number[] = []; readonly face: number[] = [];
  quads = 0;
  /** Per pyramid: its frame, voxel, and the attributes every vertex carries. */
  m = new Matrix4(); V = 1; A: [number, number, number, number] = [0, 0, 0, 0]; B: [number, number, number, number] = [0, 0, 0, 0];
  private readonly v = new Vector3();
  /** A quad in the pyramid's cell frame (x, z cell centres on integers, layer j from y = j to j + 1), facing n. */
  quad(c: ReadonlyArray<readonly [number, number, number]>, n: readonly [number, number, number]): void {
    const [a, b, d] = [c[0]!, c[1]!, c[2]!];
    const cross = [(b[1] - a[1]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[1] - a[1]), (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]), (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0])];
    const flip = cross[0]! * n[0] + cross[1]! * n[1] + cross[2]! * n[2] < 0;
    const order = flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
    const shade = n[1] > 0 ? SHADE.top : n[1] < 0 ? SHADE.bottom : n[0] > 0 ? SHADE.px : n[0] < 0 ? SHADE.nx : n[2] > 0 ? SHADE.pz : SHADE.nz;
    const f = n[1] > 0 ? 1 : n[1] < 0 ? -1 : 0;
    for (const i of order) {
      const p = c[i]!;
      this.v.set(p[0] * this.V, p[1] * this.V, p[2] * this.V).applyMatrix4(this.m);
      this.pos.push(this.v.x, this.v.y, this.v.z);
      this.col.push(shade, shade, shade);
      // Half a cell in from the face: the cell this face belongs to.
      this.cell.push(p[0] - n[0] * 0.5, p[1] - n[1] * 0.5, p[2] - n[2] * 0.5);
      this.a.push(...this.A); this.b.push(...this.B); this.face.push(f);
    }
    this.quads += 1;
  }
  /** A box of cells: x in [x0, x1], z in [z0, z1] (inclusive cell indices), layers [y0, y1). Faces in `skip` are left out. */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, skip: ReadonlySet<string> = NONE): void {
    const X0 = x0 - 0.5, X1 = x1 + 0.5, Z0 = z0 - 0.5, Z1 = z1 + 0.5;
    if (!skip.has('top')) this.quad([[X0, y1, Z0], [X1, y1, Z0], [X1, y1, Z1], [X0, y1, Z1]], [0, 1, 0]);
    if (!skip.has('bottom')) this.quad([[X0, y0, Z0], [X1, y0, Z0], [X1, y0, Z1], [X0, y0, Z1]], [0, -1, 0]);
    if (!skip.has('px')) this.quad([[X1, y0, Z0], [X1, y1, Z0], [X1, y1, Z1], [X1, y0, Z1]], [1, 0, 0]);
    if (!skip.has('nx')) this.quad([[X0, y0, Z0], [X0, y1, Z0], [X0, y1, Z1], [X0, y0, Z1]], [-1, 0, 0]);
    if (!skip.has('pz')) this.quad([[X0, y0, Z1], [X1, y0, Z1], [X1, y1, Z1], [X0, y1, Z1]], [0, 0, 1]);
    if (!skip.has('nz')) this.quad([[X0, y0, Z0], [X1, y0, Z0], [X1, y1, Z0], [X0, y1, Z0]], [0, 0, -1]);
  }
  geometry(): BufferGeometry | null {
    if (!this.quads) return null;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('aCell', new BufferAttribute(new Float32Array(this.cell), 3));
    g.setAttribute('aPyrA', new BufferAttribute(new Float32Array(this.a), 4));
    g.setAttribute('aPyrB', new BufferAttribute(new Float32Array(this.b), 4));
    g.setAttribute('aFace', new BufferAttribute(new Float32Array(this.face), 1));
    g.computeBoundingSphere();
    g.userData.mqOwned = true;
    return g;
  }
}
const NONE: ReadonlySet<string> = new Set();
const NO_BOTTOM: ReadonlySet<string> = new Set(['bottom']);

/**
 * Write one pyramid's faces in its cell frame (the writer's matrix places it).
 * `from`..`to` are the layers drawn (a capless one stops short; its capstone
 * is the rest, drawn on its own). The base is drawn: a capstone lying on its
 * side shows it.
 */
export function writePyramid(w: PyramidWriter, shape: PyramidShape, prof: readonly number[], from = 0, to = prof.length): void {
  if (shape === 'frame') {
    // Only the edges: the four corners of every layer, and the base's rim.
    for (let j = from; j < to; j++) {
      const v = prof[j]!;
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) w.box(sx * v, sx * v, j, j + 1, sz * v, sz * v);
    }
    const v = prof[from]!;
    for (let i = -v + 1; i <= v - 1; i++) {
      w.box(i, i, from, from + 1, v, v); w.box(i, i, from, from + 1, -v, -v);
      w.box(v, v, from, from + 1, i, i); w.box(-v, -v, from, from + 1, i, i);
    }
    return;
  }
  // Runs of equal width are one wall, and the ring between a layer and the
  // one above is its top: four strips, or the whole square on the last.
  let j = from;
  const base = prof[from]!;
  w.quad([[-base - 0.5, from, -base - 0.5], [base + 0.5, from, -base - 0.5], [base + 0.5, from, base + 0.5], [-base - 0.5, from, base + 0.5]], [0, -1, 0]);
  while (j < to) {
    const v = prof[j]!;
    let k = j + 1;
    while (k < to && prof[k] === v) k++;
    const E = v + 0.5;
    w.quad([[E, j, -E], [E, k, -E], [E, k, E], [E, j, E]], [1, 0, 0]);
    w.quad([[-E, j, -E], [-E, k, -E], [-E, k, E], [-E, j, E]], [-1, 0, 0]);
    w.quad([[-E, j, E], [E, j, E], [E, k, E], [-E, k, E]], [0, 0, 1]);
    w.quad([[-E, j, -E], [E, j, -E], [E, k, -E], [-E, k, -E]], [0, 0, -1]);
    const next = k < to ? prof[k]! : -1;
    if (next < 0) w.quad([[-E, k, -E], [E, k, -E], [E, k, E], [-E, k, E]], [0, 1, 0]);
    else {
      // The ring as four edges and four corners: the same cut on every side, so the faces are as symmetric as the stone.
      const I = next + 0.5;
      w.quad([[-I, k, I], [I, k, I], [I, k, E], [-I, k, E]], [0, 1, 0]);
      w.quad([[-I, k, -E], [I, k, -E], [I, k, -I], [-I, k, -I]], [0, 1, 0]);
      w.quad([[I, k, -I], [E, k, -I], [E, k, I], [I, k, I]], [0, 1, 0]);
      w.quad([[-E, k, -I], [-I, k, -I], [-I, k, I], [-E, k, I]], [0, 1, 0]);
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        w.quad([[sx * I, k, sz * I], [sx * E, k, sz * I], [sx * E, k, sz * E], [sx * I, k, sz * E]], [0, 1, 0]);
      }
    }
    j = k;
  }
  if (shape === 'mayan' && to === prof.length) {
    // A stair up the middle of every face, one in one from a little out at the
    // foot to the top platform; on the platform, a temple.
    const H = prof.length, W = prof[0]!, top = prof[H - 1]!;
    const sw = Math.max(1, Math.round(W * 0.12));
    for (let j = 0; j < H; j++) {
      const out = Math.max(prof[j]!, W + 2 - j);
      if (out <= prof[j]!) continue;
      const lo = prof[j]! + 1;
      w.box(lo, out, j, j + 1, -sw, sw, new Set(['nx', 'bottom']));
      w.box(-out, -lo, j, j + 1, -sw, sw, new Set(['px', 'bottom']));
      w.box(-sw, sw, j, j + 1, lo, out, new Set(['nz', 'bottom']));
      w.box(-sw, sw, j, j + 1, -out, -lo, new Set(['pz', 'bottom']));
    }
    const wt = Math.max(1, Math.round(top * 0.6)), ht = Math.max(3, Math.round(W * 0.28));
    w.box(-wt, wt, H, H + ht, -wt, wt, NO_BOTTOM);
    // Its roof comb: one cell proud along the middle, the same both ways.
    w.box(-Math.max(0, wt - 2), Math.max(0, wt - 2), H + ht, H + ht + 1, -Math.max(0, wt - 2), Math.max(0, wt - 2), NO_BOTTOM);
  }
}

/** The total height of a shape, in layers (the temple and its comb on a Mayan one). */
export function pyramidHeight(shape: PyramidShape, prof: readonly number[]): number {
  return shape === 'mayan' ? prof.length + Math.max(3, Math.round(prof[0]! * 0.28)) + 1 : prof.length;
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

const pick = <K extends string>(rng: CrystalRng, weights: Partial<Record<K, number>>): K => {
  const entries = Object.entries(weights).filter(([, w]) => (w as number) > 0) as Array<[K, number]>;
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let x = rng.next() * total;
  for (const [k, w] of entries) { x -= w; if (x < 0) return k; }
  return entries[entries.length - 1]![0];
};

/** Where complexes stand (distance from the middle), how many at `amount` 1, how big a cube (in fish cubes) and how wide a great pyramid. */
const BANDS = {
  // Inside the camera's orbit (110 by default): in front of the lens wherever it goes, never in its path.
  near: { r: [18, 58] as const, n: 2, cube: [1] as const, half: [3, 6] as const, inner: 0 },
  mid: { r: [150, 280] as const, n: 4, cube: [2, 2, 3] as const, half: [5, 9] as const, inner: 125 },
  // Within the fog (fogFar is 500 by default): the great ones stand where the water still shows them.
  far: { r: [300, 470] as const, n: 5, cube: [3, 4, 5] as const, half: [7, 11] as const, inner: 200 },
};
const GREAT: Partial<Record<PyramidShape, number>> = { giza: 4, bent: 1.5, djoser: 2, step: 1.5, mayan: 1.5 };
const QUEEN: Partial<Record<PyramidShape, number>> = { giza: 3, step: 2, mayan: 1, djoser: 0.5, frame: 0.6 };
/** How far the ground may rise and fall under a footprint: a fifth of its cube and a hair — flat, to the eye. In
 *  practice a flat floor (a dune, a ridge, a basin's bowl or a rippled tread is not). The base is set in by the low
 *  point, so it never shows a gap. */
export const pyramidFlatness = (V: number, s: number): number => 0.2 * V + 0.15 * PYRAMID_VOXEL * s;
/** The ground's lowest point and its rise and fall over a square footprint (half-width `h`, turned by `q`), on a 7×7 grid. */
export function groundUnder(ground: (x: number, z: number) => number, x: number, z: number, h: number, q: Quaternion): { lo: number; spread: number } {
  let lo = Infinity, hi = -Infinity;
  const p = new Vector3();
  for (let i = 0; i <= 6; i++) for (let k = 0; k <= 6; k++) {
    p.set((i / 3 - 1) * h, 0, (k / 3 - 1) * h).applyQuaternion(q);
    const g = ground(x + p.x, z + p.z);
    lo = Math.min(lo, g); hi = Math.max(hi, g);
  }
  return { lo, spread: hi - lo };
}
/** Every footprint stays on the floor (tank.ts builds it 620 to a side; its edge is past the fog). */
const FLOOR_R = 590;
/** The camera orbits the middle at `cameraDistance` (110 by default): nothing near reaches past this. */
const NEAR_R = 72;

export function buildPyramids(rng: CrystalRng, opts: PyramidOptions): Pyramids {
  const out: Pyramids = { geometry: null, obstacles: [], emitters: [], sites: [] };
  if (!(opts.amount > 0)) return out;
  const s = opts.scale;
  const mix = parsePyramidMix(opts.mix ?? '');
  const stones = Object.keys(mix.materials).length ? mix.materials : (PYRAMID_STONES_BY_ENVIRONMENT[opts.environment] ?? PYRAMID_STONES_BY_ENVIRONMENT.void!);
  const named = Object.keys(mix.shapes).length ? mix.shapes : null;
  const budget = Math.min(1, Math.max(0.4, opts.cap / 10));
  const w = new PyramidWriter();
  const placed: Array<{ x: number; z: number; r: number }> = [];
  const ground = (x: number, z: number): number => opts.terrain(x, z);
  let capless = false, glowing = 0, seq = 0, complexes = 0;
  const e = new Vector3();

  /** One pyramid on the floor, squared to `yaw`. Returns false where it will not fit. */
  const raise = (x: number, z: number, shape: PyramidShape, half: number, cube: number, yaw: number, material: PyramidMaterial,
    band: PyramidSite['band'], great: boolean): boolean => {
    const prof = pyramidProfile(shape, half);
    const W = prof[0]!, H = pyramidHeight(shape, prof), V = PYRAMID_VOXEL * cube * s;
    const reach = (W + 0.5) * V * Math.SQRT2;
    if (Math.hypot(x, z) + reach > FLOOR_R * s) return false;
    // The near ones and their queens keep inside the camera's orbit; the rest keep well outside it.
    if (band === 'near' && Math.hypot(x, z) + reach > NEAR_R * s) return false;
    if (Math.hypot(x, z) - reach < BANDS[band].inner * s) return false;
    if (placed.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + reach + V)) return false;
    if (!opts.free(x, z, reach)) return false;
    // Only on flat ground: a square base on a dune or a mound would bridge it or bury a corner.
    const q = new Quaternion().setFromAxisAngle(e.set(0, 1, 0), yaw);
    const under = groundUnder(ground, x, z, (W + 0.5) * V, q);
    if (under.spread > pyramidFlatness(V, s)) return false;
    // And round it, to twice its width: a small one can find a flat spot on top of a dune and sit there like a hat.
    if (groundUnder(ground, x, z, (W + 0.5) * V * 2, q).spread > 2 * pyramidFlatness(V, s)) return false;
    // How did it get there?
    let pose: PyramidPose = pick<PyramidPose>(rng, great ? { stand: 6, sunk: 2, capless: capless ? 0 : 1 } : { stand: 5, sunk: 2, capless: capless ? 0 : 0.8 });
    if (pose === 'capless' && shape !== 'giza' && shape !== 'step') pose = 'stand';
    if (pose === 'capless') capless = true;
    const seed = rng.next();
    const cap = (shape === 'giza' || shape === 'step' || shape === 'bent') && rng.next() < 0.6 ? Math.max(1, Math.round(prof.length * 0.12)) : 0;
    const eye = (shape === 'giza' || shape === 'step') && W >= 7 && rng.next() < 0.3 ? 1 : 0;
    const lit = cap > 0 && glowing < 3 && band !== 'far';
    const glow = shape === 'frame' ? 0.8 : cap ? (lit ? PYRAMID_MATERIALS[material].glow : 0.3) : 0;
    w.V = V;
    w.A = [PYRAMID_MATERIAL_NAMES.indexOf(material), ((seq++ * 0.6180339) % 1) + seed * 0.001, 1, glow];
    // A frame is all light: every edge cube in the capstone's colour.
    w.B = [prof.length - 1, shape === 'frame' ? 0 : cap ? prof.length - cap : 1e4, eye, 0];
    const low = under.lo;
    // Its base never shows a gap over the sand: it sits at the lowest corner, a little in.
    let y = low - 0.25 * V;
    if (pose === 'sunk') y = low - H * V * rng.range(0.22, 0.45);
    w.m.compose(new Vector3(x, y, z), q, new Vector3(1, 1, 1));
    // How it sits: its deepest base corner against the ground under that corner.
    let seatGap = Infinity;
    for (const [cx, cz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const c = new Vector3(cx * (W + 0.5) * V, 0, cz * (W + 0.5) * V).applyQuaternion(q);
      seatGap = Math.min(seatGap, y + c.y - ground(x + c.x, z + c.z));
    }
    if (pose === 'capless') {
      // It lost its top: the capstone lies at its foot, tipped on its side in the sand.
      const keep = prof.length - Math.max(2, Math.round(prof.length * 0.22));
      writePyramid(w, shape, prof, 0, keep);
      const cw = prof[keep]!, away = yaw + Math.PI / 4 + rng.range(-0.6, 0.6), d = (W + cw + 2) * V * 1.1;
      const cx = x + Math.cos(away) * d, cz = z + Math.sin(away) * d;
      const cq = new Quaternion().setFromAxisAngle(e.set(Math.cos(away + Math.PI / 2), 0, Math.sin(away + Math.PI / 2)), rng.range(0.25, 0.45))
        .multiply(new Quaternion().setFromAxisAngle(e.set(0, 1, 0), yaw));
      w.m.compose(new Vector3(cx, ground(cx, cz) - keep * V - (cw + 1) * 0.55 * V, cz), cq, new Vector3(1, 1, 1));
      writePyramid(w, shape, prof, keep, prof.length);
      out.obstacles.push({ x: cx, y: ground(cx, cz), z: cz, r: (cw + 1.5) * V * 1.5, h: (cw + 1.5) * V * 1.5 });
    } else writePyramid(w, shape, prof);
    out.sites.push({ x, z, shape, material, pose, half: W, cube, layers: H, ground: low, seat: seatGap, reach, band, complex: complexes });
    placed.push({ x, z, r: reach });
    out.obstacles.push({ x, y: low, z, r: reach, h: Math.max(V, y + H * V - low) });
    // A lit capstone throws its light on the floor (a few: the floor's pools are few).
    if (lit && pose !== 'capless' && glow > 0.45) {
      glowing++;
      const c = new Color(PYRAMID_MATERIALS[material].pal[3]);
      const apex = new Vector3(0, H * V, 0).applyQuaternion(q).add(new Vector3(x, y, z));
      out.emitters.push({ x: apex.x, y: apex.y, z: apex.z, r: c.r, g: c.g, b: c.b, reach: (band === 'near' ? 30 : 50) * s, phase: seed * 6.283 });
    }
    return true;
  };

  for (const band of ['far', 'mid', 'near'] as const) {
    const spec = BANDS[band];
    const want = Math.max(band === 'far' ? 1 : 0, Math.round(spec.n * opts.amount * budget));
    const turn = rng.next() * Math.PI * 2;
    for (let i = 0, tries = 0; i < want && tries < want * 14; tries++) {
      // Round the floor by the golden angle, so they surround the camera's orbit rather than bunch on one side.
      const ang = turn + (i + tries * 0.37) * 2.39996 + rng.range(-0.3, 0.3);
      const cube = spec.cube[Math.floor(rng.next() * spec.cube.length)]!;
      let half = Math.round(rng.range(spec.half[0], spec.half[1]));
      // Placed to fit: past the band's inner edge, inside the floor (and, near, inside the camera's orbit).
      const out = band === 'near' ? NEAR_R : FLOOR_R;
      const fit = (h: number): number => (h + 0.5) * PYRAMID_VOXEL * cube * s * Math.SQRT2;
      while (half > 2 && spec.inner * s + fit(half) * 2 > out * s - fit(half)) half -= 1;
      const lo = Math.max(spec.r[0] * s, spec.inner * s + fit(half) + 1), hi = Math.min(spec.r[1] * s, out * s - fit(half) - 1);
      const r = hi > lo ? rng.range(lo, hi) : lo;
      const cx = Math.cos(ang) * r, cz = Math.sin(ang) * r;
      const shape = pick(rng, named ?? GREAT);
      const material = pick(rng, stones);
      // A complex is squared to the compass (Giza is), turned only a little from it.
      const yaw = rng.range(-0.12, 0.12);
      if (!raise(cx, cz, shape, half, cube, yaw, material, band, true)) continue;
      i++;
      // Its queens: smaller pyramids in a row off one corner, the same stone, each a little smaller than the last.
      const V = PYRAMID_VOXEL * cube * s;
      const queens = Math.floor(rng.range(1, 3.99));
      // Along one of its diagonals, the one that runs most nearly round the floor (never in toward the middle).
      const side = rng.next() < 0.5 ? 1 : -1;
      let dir = yaw + Math.PI / 4, best = -Infinity;
      for (let k = 0; k < 4; k++) {
        const d = yaw + Math.PI / 4 + k * (Math.PI / 2);
        const score = side * (Math.cos(d) * -Math.sin(ang) + Math.sin(d) * Math.cos(ang)) + 0.3 * (Math.cos(d) * Math.cos(ang) + Math.sin(d) * Math.sin(ang));
        if (score > best) { best = score; dir = d; }
      }
      let along = (half + 0.5) * V * Math.SQRT2;
      for (let k = 0; k < queens; k++) {
        const qh = Math.max(2, Math.round(half * (0.5 - 0.08 * k)));
        const qShape = named ? pick(rng, named) : pick(rng, QUEEN);
        along += (qh + 0.5) * V * Math.SQRT2 + V * 3;
        raise(cx + Math.cos(dir) * along, cz + Math.sin(dir) * along, qShape, qh, cube, yaw, material, band, false);
        along += (qh + 0.5) * V * Math.SQRT2;
      }
      complexes++;
    }
  }
  out.geometry = w.geometry();
  return out;
}

// ---------------------------------------------------------------------------
// Material
// ---------------------------------------------------------------------------

const MATS = PYRAMID_MATERIAL_NAMES.map((n) => PYRAMID_MATERIALS[n]);

/** The cubes, drawn per fragment from the cube it lies in. */
export const PYRAMID_GLSL = /* glsl */ `
uniform vec3 uPyrPal[${MATS.length * 4}];
uniform vec4 uPyrMotif[${MATS.length}];
varying vec3 vCell;
varying vec4 vPyrA;
varying vec4 vPyrB;
varying float vFace;
float mqPyrH(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
vec3 mqPyrPaint() {
  vec3 c = vec3(floor(vCell.x + 0.5), floor(vCell.y), floor(vCell.z + 0.5));
  // Sorted |x|, |z|: the square's eight symmetries, so the paint is as symmetric as the stone.
  float ax = abs(c.x), az = abs(c.z);
  float u = min(ax, az), w = max(ax, az);
  int m = int(vPyrA.x + 0.5);
  float seed = vPyrA.y;
  vec3 mainC = uPyrPal[m * 4], altC = uPyrPal[m * 4 + 1], acc = uPyrPal[m * 4 + 2], capC = uPyrPal[m * 4 + 3];
  vec4 mo = uPyrMotif[m];
  float r = mqPyrH(vec3(u, w, c.y) + seed * 17.0);
  // Each cube its own shade of the stone, as each of a fish's is its own colour.
  vec3 col = mix(mainC, altC, step(0.64, r)) * (0.86 + 0.24 * mqPyrH(vec3(w, u, c.y * 1.37) + seed * 31.0));
  vec3 mean = mix(mainC, altC, 0.36);
  bool side = abs(vFace) < 0.5;
  // A frieze every few layers: glyphs three cubes wide, mirrored about the face's middle.
  if (mo.x > 0.0 && side && mod(c.y, mo.x) < 0.5 && c.y > 0.5) {
    float g = floor(u / 3.0), px = mod(u, 3.0);
    float bits = floor(mqPyrH(vec3(g, c.y, seed * 7.0)) * 8.0);
    float lit = mod(floor(bits / pow(2.0, px)), 2.0);
    col = mix(col, acc, lit * 0.85);
  }
  // Growth on the treads: coral, moss.
  if (mo.y > 0.0 && vFace > 0.5) col = mix(col, acc, step(1.0 - mo.y, mqPyrH(vec3(u + 3.1, w, c.y) + seed * 5.0)));
  // Veins of light through the stone.
  float vein = 0.0;
  if (mo.z > 0.0) vein = step(abs(sin(u * 0.83 + c.y * 0.61 + w * 0.37 + seed * 9.0)), 0.13);
  col = mix(col, acc * 1.25, vein);
  // Nacre: the colour wanders from cube to cube, as mother-of-pearl does.
  if (mo.w > 0.0) {
    float t = (u + c.y * 0.7 + w * 0.3) * 0.55 + seed * 6.0;
    col = mix(col, col * vec3(0.92 + 0.12 * sin(t), 0.92 + 0.12 * sin(t + 2.1), 0.94 + 0.12 * sin(t + 4.2)), mo.w);
  }
  // The capstone: gilded, or the stone's own light.
  float capped = step(vPyrB.y, c.y);
  col = mix(col, capC * (0.9 + 0.14 * r), capped);
  // The eye, on every face, five layers under the apex.
  if (vPyrB.z > 0.5 && side) {
    float dy = c.y - (vPyrB.x - 5.0), ady = abs(dy);
    float rim = (ady == 2.0 && u <= 1.0) || (ady == 1.0 && u == 2.0) || (ady == 0.0 && u == 3.0) ? 1.0 : 0.0;
    float white = (ady == 1.0 && u <= 1.0) || (ady == 0.0 && (u == 1.0 || u == 2.0)) ? 1.0 : 0.0;
    float pupil = ady == 0.0 && u == 0.0 ? 1.0 : 0.0;
    col = mix(col, vec3(0.06, 0.04, 0.03), rim + pupil);
    col = mix(col, vec3(0.97, 0.95, 0.88), white);
    vein = max(vein, white * 0.6);
  }
  // The seam between one cube and the next: what makes them read as cubes, not a slope.
  // Distance to the nearest cube edge on this face (along the face's normal the
  // cell coordinate is mid-cube, so that axis never draws one).
  vec3 d = vec3(0.5 - abs(fract(vCell.x + 0.5) - 0.5), 0.5 - abs(fract(vCell.y) - 0.5), 0.5 - abs(fract(vCell.z + 0.5) - 0.5));
  vec3 fw = fwidth(vCell);
  vec3 seamAxis = 1.0 - smoothstep(fw * 0.5, fw * 0.5 + 0.045, d);
  float seam = max(max(seamAxis.x, seamAxis.y), seamAxis.z);
  // Under a pixel, a cube is its mean (and no seam): no shimmer as the camera moves.
  float f = max(max(fw.x, fw.y), fw.z);
  float far = smoothstep(0.3, 0.8, f);
  col = mix(col, mix(mean, capC, capped), far);
  col *= 1.0 - 0.32 * seam * (1.0 - far);
  // Lit parts: the capstone and the veins glow (their own light, not the room's).
  float g = vPyrA.w * max(capped, vein);
  return col * (1.0 + 0.9 * g);
}
`;

/** The pyramids' one material: unlit vertex colour, fogged and lit by the room as every other stone is. */
export function pyramidMaterial(): MeshBasicMaterial {
  const mat = new MeshBasicMaterial({ vertexColors: true, side: FrontSide });
  mat.userData.mqOwned = true;
  const pal = MATS.flatMap((m) => m.pal.map((h) => new Color(h)));
  const motif = MATS.map((m) => new Vector4(m.bands, m.speckle, m.veins, m.nacre));
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPyrPal = { value: pal };
    shader.uniforms.uPyrMotif = { value: motif };
    shader.vertexShader = 'attribute vec3 aCell; attribute vec4 aPyrA; attribute vec4 aPyrB; attribute float aFace;\nvarying vec3 vCell; varying vec4 vPyrA; varying vec4 vPyrB; varying float vFace;\n'
      + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vCell = aCell; vPyrA = aPyrA; vPyrB = aPyrB; vFace = aFace;');
    shader.fragmentShader = PYRAMID_GLSL + shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= mqPyrPaint();');
  };
  mat.customProgramCacheKey = () => 'mq-pyramids-v2';
  return mat;
}
