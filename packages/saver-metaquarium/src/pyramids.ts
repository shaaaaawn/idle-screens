/**
 * Pyramids: perfect voxel monuments, on the fish's own grid.
 *
 * A metaquarium fish is voxel art, the classic tokens fourteen voxels nose to
 * tail; a pyramid here is cut from the same grid — one voxel is
 * FISH_LENGTH / 14 (× `crystalScale`), so the step of a stair is a fish's
 * pixel, whether the pyramid is a knee-high ruin by the glass or a mountain in
 * the haze. Every one is exactly symmetric: an odd base, so its apex is one
 * cube; each layer a square (and its stairs and temple the same on all four
 * faces); and the paint keyed on the sorted |x|, |z| of each cell, so the
 * pattern has the square's eight symmetries too.
 *
 * Shapes are integer rise:run sequences:
 *
 *   giza    five rises to four insets — 51.3°, the Great Pyramid's angle — a
 *           gilded pyramidion on many
 *   step    one in one: 45° stairs all the way
 *   bent    Dahshur's: steep (four rises to three) then shallow (one to one)
 *   djoser  six great tiers
 *   mayan   terraces, a stair up the middle of every face, a temple on top
 *   frame   only its edges: a wireframe of glowing voxels
 *   octa    two pyramids base to base: an octahedron, hanging in the water
 *
 * And how did they get there? Some stand, some are half sunk in the sand,
 * some lean where they settled, some are buried apex-first, upside down;
 * some float, rising and falling over half a minute; and one has lost its
 * capstone, which lies in the sand beside it. Many stand far off in the haze
 * (past the fog, hazed as the horizon is: horizon.ts), some in the middle
 * distance, a few small ones in the foreground.
 *
 * Geometry is the stepped faces only (a layer is a square: its four sides and
 * the ring of its top), so a mountain of a hundred voxels is a few hundred
 * quads. The voxels are drawn in the fragment shader: each fragment knows its
 * cell in the pyramid's own frame (`aCell`), so the paint stays on the grid
 * however the pyramid is turned, and fades to its mean where a cell is under a
 * pixel (no shimmer on the far ones as the camera orbits).
 */
import { BufferAttribute, BufferGeometry, Color, FrontSide, Matrix4, MeshBasicMaterial, Quaternion, Vector3, Vector4 } from 'three';
import type { CrystalRng, Emitter } from './crystals';
import { FISH_LENGTH } from './swim';
import { PYRAMID_MATERIAL_NAMES, PYRAMID_MATERIALS, PYRAMID_SHAPES, PYRAMID_STONES_BY_ENVIRONMENT, parsePyramidMix, type PyramidMaterial, type PyramidShape } from './pyramid-mix';

/** One voxel, in world units at `crystalScale` 1: a classic token is fourteen of them long. */
export const PYRAMID_VOXEL = FISH_LENGTH / 14;


export { PYRAMID_MATERIAL_NAMES, PYRAMID_MATERIALS, PYRAMID_SHAPES, parsePyramidMix, type PyramidMaterial, type PyramidShape };

export type PyramidPose = 'stand' | 'sunk' | 'lean' | 'inverted' | 'float' | 'capless';

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

export interface PyramidSite { x: number; z: number; shape: PyramidShape; material: PyramidMaterial; pose: PyramidPose; half: number; layers: number; band: 'near' | 'mid' | 'far' }

export interface Pyramids {
  /** Foreground and middle distance: fogged as the rest of the world is. */
  near: BufferGeometry | null;
  /** Past the fog line: hazed by its ring, as the horizon is. */
  far: BufferGeometry | null;
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
    case 'giza': case 'octa': up((j) => Math.floor((j * 4) / 5)); break;
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
 * is the rest, drawn on its own). The base is drawn: a leaning, floating or
 * upturned one shows it.
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

/** Rings: how far out, how big (half-width in cells), and how many at `amount` 1. */
const BANDS = {
  near: { r: [48, 200] as const, half: [5, 14] as const, n: 5, shapes: { giza: 3, step: 2, mayan: 2, djoser: 1, frame: 1 } as Partial<Record<PyramidShape, number>> },
  mid: { r: [240, 470] as const, half: [12, 36] as const, n: 8, shapes: { giza: 3, step: 1, mayan: 2, djoser: 2, bent: 1, octa: 1, frame: 0.5 } as Partial<Record<PyramidShape, number>> },
  far: { r: [560, 860] as const, half: [30, 92] as const, n: 16, shapes: { giza: 4, bent: 2, djoser: 2, step: 2, octa: 1, mayan: 1 } as Partial<Record<PyramidShape, number>> },
};
/** Every vertex stays this close to the origin, as the horizon's do (horizon.ts HORIZON_SAFE_R). */
const SAFE_R = 940;
/** How far each far one's colour carries through the water, by distance. */
const farHaze = (r: number): number => 0.86 - 0.34 * Math.min(1, Math.max(0, (r - 560) / 300));

export function buildPyramids(rng: CrystalRng, opts: PyramidOptions): Pyramids {
  const out: Pyramids = { near: null, far: null, obstacles: [], emitters: [], sites: [] };
  if (!(opts.amount > 0)) return out;
  const s = opts.scale, V = PYRAMID_VOXEL * s;
  const mix = parsePyramidMix(opts.mix ?? '');
  const stones = Object.keys(mix.materials).length ? mix.materials : (PYRAMID_STONES_BY_ENVIRONMENT[opts.environment] ?? PYRAMID_STONES_BY_ENVIRONMENT.void!);
  const budget = Math.min(1, Math.max(0.4, opts.cap / 10));
  const near = new PyramidWriter(), far = new PyramidWriter();
  near.V = far.V = V;
  const placed: Array<{ x: number; z: number; r: number }> = [];
  let capless = false, glowing = 0, seq = 0;
  const q = new Quaternion(), e = new Vector3();

  for (const band of ['far', 'mid', 'near'] as const) {
    const spec = BANDS[band];
    const want = Math.round(spec.n * opts.amount * budget + (band === 'far' ? 0.49 : 0));
    const shapes = Object.keys(mix.shapes).length ? mix.shapes : spec.shapes;
    const turn = rng.next() * Math.PI * 2;
    for (let i = 0, tries = 0; i < want && tries < want * 12; tries++) {
      // Spread round the ring by the golden angle, so none bunch on one side of the camera's orbit.
      const ang = turn + (i + tries * 0.37) * 2.39996 + rng.range(-0.25, 0.25);
      const shape = pick(rng, shapes);
      // A Mayan pyramid is a city's temple, not a mountain: keep it to the size its stairs read at.
      let half = Math.round(rng.range(spec.half[0], spec.half[1]));
      if (shape === 'mayan') half = Math.min(half, 30);
      if (shape === 'frame') half = Math.min(half, 26);
      const prof = pyramidProfile(shape, half);
      const W = prof[0]!, H = pyramidHeight(shape, prof);
      const reach = (W + 0.5) * V * Math.SQRT2;
      let r = rng.range(spec.r[0], spec.r[1]) * s;
      if (band === 'far') r = Math.min(r, Math.sqrt(Math.max(0, SAFE_R ** 2 - (H * V) ** 2)) - reach);
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      if (placed.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + reach * 0.9)) continue;
      if (band !== 'far' && !opts.free(x, z, reach)) continue;
      i++;
      const material = pick(rng, stones);
      // How did it get there?
      let pose: PyramidPose = pick<PyramidPose>(rng, band === 'near'
        ? { stand: 4, sunk: 2, lean: 2, inverted: 1, capless: capless ? 0 : 1.2 }
        : band === 'mid' ? { stand: 4, sunk: 2, lean: 1.5, inverted: 1, float: 1.5, capless: capless ? 0 : 1 }
          : { stand: 5, sunk: 2, lean: 1, float: 1.2, inverted: 0.6 });
      if (shape === 'octa') pose = 'float';
      if (pose === 'capless' && (shape !== 'giza' && shape !== 'step')) pose = 'stand';
      if (pose === 'capless') capless = true;
      const seed = rng.next();
      const cap = (shape === 'giza' || shape === 'step' || shape === 'bent') && rng.next() < 0.6 ? Math.max(1, Math.round(prof.length * 0.12)) : 0;
      const eye = (shape === 'giza' || shape === 'step') && W >= 9 && rng.next() < 0.35 ? 1 : 0;
      const glow = cap && band !== 'far' && glowing < 3 ? PYRAMID_MATERIALS[material].glow : cap ? 0.35 : 0;
      const w = band === 'far' ? far : near;
      const mat = PYRAMID_MATERIAL_NAMES.indexOf(material);
      w.A = [mat, seq++ * 0.6180339 % 1 + seed * 0.001, band === 'far' ? farHaze(r / s) : 1, shape === 'frame' ? Math.max(glow, 0.7) : glow];
      // A frame is all light: every edge cell in the capstone's colour, glowing.
      w.B = [prof.length - 1, shape === 'frame' ? 0 : cap ? prof.length - cap : 1e4, eye, 0];
      const ground = (px: number, pz: number): number => opts.terrain(px, pz);
      const yaw = Math.round(rng.range(0, 3)) * (Math.PI / 2) + rng.range(-0.5, 0.5);
      const top = H * V;
      const axis = rng.next() * Math.PI * 2;
      let tilt = 0, y = ground(x, z), bob = 0;
      const corners = (): number => Math.min(...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([cx, cz]) => ground(x + cx! * (W + 0.5) * V, z + cz! * (W + 0.5) * V)));
      switch (pose) {
        case 'stand': y = corners() - 0.3 * V; break;
        case 'sunk': y = corners() - top * rng.range(0.25, 0.55); break;
        case 'lean': tilt = rng.range(0.14, 0.38); break;
        case 'inverted': tilt = Math.PI + rng.range(-0.18, 0.18); break;
        case 'float': y = ground(x, z) + (band === 'mid' ? rng.range(70, 140) : rng.range(90, 220)) * s; bob = rng.range(2, 5) * s; tilt = rng.range(0, 0.25); break;
        case 'capless': y = corners() - 0.3 * V; break;
      }
      // The frame: up, then tilted about a level axis, then turned about the upright.
      q.setFromAxisAngle(e.set(Math.cos(axis), 0, Math.sin(axis)), tilt);
      const turnQ = new Quaternion().setFromAxisAngle(e.set(0, 1, 0), yaw);
      q.premultiply(turnQ);
      if (pose === 'lean' || pose === 'inverted') {
        // Seated by its lowest point: the low corner of its base (or its apex,
        // upturned) in the sand, a little under it, as if it settled there.
        const low = new Vector3();
        const probe = pose === 'inverted' ? [[0, H, 0]] : [[-W - 0.5, 0, -W - 0.5], [W + 0.5, 0, -W - 0.5], [W + 0.5, 0, W + 0.5], [-W - 0.5, 0, W + 0.5]];
        // The seat that puts its lowest point on the ground, then sunk a little.
        let seat = -Infinity;
        for (const [px, py, pz] of probe) {
          low.set(px! * V, py! * V, pz! * V).applyQuaternion(q);
          seat = Math.max(seat, ground(x + low.x, z + low.z) - low.y);
        }
        y = seat - (pose === 'inverted' ? top * rng.range(0.18, 0.32) : rng.range(0.6, 1.6) * V);
      }
      w.m.compose(new Vector3(x, y, z), q, new Vector3(1, 1, 1));
      w.B[3] = bob;
      if (pose === 'capless') {
        // It lost its top: the capstone lies beside it, on its side in the sand.
        const keep = prof.length - Math.max(2, Math.round(prof.length * 0.22));
        writePyramid(w, shape, prof, 0, keep);
        const cp = prof.slice(keep), cw = cp[0]!;
        const away = ang + rng.range(-1.2, 1.2), d = (W + cw + 3) * V;
        const cx = x + Math.cos(away) * d, cz = z + Math.sin(away) * d;
        const cq = new Quaternion().setFromAxisAngle(e.set(Math.cos(away + 1.57), 0, Math.sin(away + 1.57)), rng.range(0.5, 1.1)).premultiply(turnQ);
        w.m.compose(new Vector3(cx, ground(cx, cz) - keep * V - (cw * 0.35) * V, cz), cq, new Vector3(1, 1, 1));
        writePyramid(w, shape, prof, keep, prof.length);
        out.obstacles.push({ x: cx, y: ground(cx, cz), z: cz, r: (cw + 1) * V * 1.5, h: (cw + 1) * V * 1.5 });
      } else writePyramid(w, shape, prof);
      if (shape === 'octa') {
        // Its lower half: the same pyramid, upside down under it.
        const flip = new Quaternion().setFromAxisAngle(e.set(1, 0, 0), Math.PI).premultiply(q);
        w.m.compose(new Vector3(x, y, z), flip, new Vector3(1, 1, 1));
        writePyramid(w, shape, prof);
      }
      out.sites.push({ x, z, shape, material, pose, half: W, layers: H, band });
      placed.push({ x, z, r: reach });
      if (band !== 'far' && pose !== 'float') out.obstacles.push({ x, y: Math.max(y, ground(x, z)), z, r: reach, h: Math.max(V, y + top - ground(x, z)) });
      // A lit capstone throws its light on the floor (a few: the floor's pools are few).
      if (glow > 0.45 && band !== 'far' && pose !== 'inverted' && pose !== 'capless' && glowing < 3) {
        glowing++;
        const c = new Color(PYRAMID_MATERIALS[material].pal[3]);
        const apex = new Vector3(0, H * V, 0).applyQuaternion(q).add(new Vector3(x, y, z));
        out.emitters.push({ x: apex.x, y: apex.y, z: apex.z, r: c.r, g: c.g, b: c.b, reach: (band === 'near' ? 30 : 60) * s, phase: seed * 6.283 });
      }
    }
  }
  out.near = near.geometry();
  out.far = far.geometry();
  return out;
}

// ---------------------------------------------------------------------------
// Material
// ---------------------------------------------------------------------------

const MATS = PYRAMID_MATERIAL_NAMES.map((n) => PYRAMID_MATERIALS[n]);

/** The voxels, drawn per fragment from the cell it lies in. */
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
  vec3 col = mix(mainC, altC, step(0.64, r)) * (0.9 + 0.18 * mqPyrH(vec3(w, u, c.y * 1.37) + seed * 31.0));
  vec3 mean = mix(mainC, altC, 0.36);
  bool side = abs(vFace) < 0.5;
  // A frieze every few layers: glyphs three cells wide, mirrored about the face's middle.
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
  // Nacre: the colour wanders with the cell, as mother-of-pearl does.
  if (mo.w > 0.0) {
    float t = (u + c.y * 0.7 + w * 0.3) * 0.55 + seed * 6.0;
    col = mix(col, col * vec3(0.92 + 0.12 * sin(t), 0.92 + 0.12 * sin(t + 2.1), 0.94 + 0.12 * sin(t + 4.2)), mo.w);
  }
  // The capstone: gilded, or the stone's own light.
  float capped = step(vPyrB.y, c.y);
  col = mix(col, capC * (0.92 + 0.12 * r), capped);
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
  // Under a pixel, a cell is its mean: no shimmer as the camera moves.
  float f = max(max(fwidth(vCell.x), fwidth(vCell.y)), fwidth(vCell.z));
  col = mix(col, mix(mean, capC, capped), smoothstep(0.45, 1.0, f));
  // Lit parts: the capstone and the veins glow (their own light, not the room's).
  float g = vPyrA.w * max(capped, vein);
  return col * (1.0 + 0.9 * g);
}
`;

/** One shared material per band: `far` is hazed past the fog line (the horizon's rule), the rest fogged as the world is. */
export function pyramidMaterial(far: boolean, clock: { value: number }, fog: { value: Color }): MeshBasicMaterial {
  const mat = new MeshBasicMaterial({ vertexColors: true, side: FrontSide, fog: !far });
  mat.userData.mqOwned = true;
  if (far) mat.userData.mqNoCaustic = true; // past the fog line
  const pal = MATS.flatMap((m) => m.pal.map((h) => new Color(h)));
  const motif = MATS.map((m) => new Vector4(m.bands, m.speckle, m.veins, m.nacre));
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPyrPal = { value: pal };
    shader.uniforms.uPyrMotif = { value: motif };
    shader.uniforms.uPyrTime = clock;
    if (far) shader.uniforms.uHorizonFog = fog;
    shader.vertexShader = `attribute vec3 aCell; attribute vec4 aPyrA; attribute vec4 aPyrB; attribute float aFace;
uniform float uPyrTime; varying vec3 vCell; varying vec4 vPyrA; varying vec4 vPyrB; varying float vFace;${far ? ' varying float vHaze;' : ''}\n` + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  vCell = aCell; vPyrA = aPyrA; vPyrB = aPyrB; vFace = aFace;
  // A floating one rises and falls, slowly, all of it as one.
  transformed.y += aPyrB.w * sin(uPyrTime * 0.21 + aPyrA.y * 6.2832);
  ${far ? '// Haze pools at its foot, as at the horizon\'s: it rises out of the murk.\n  vHaze = aPyrA.z * smoothstep(-20.0, 90.0, transformed.y);' : ''}`);
    shader.fragmentShader = PYRAMID_GLSL + (far ? 'uniform vec3 uHorizonFog; varying float vHaze;\n' : '')
      + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
  diffuseColor.rgb *= mqPyrPaint();${far ? '\n  diffuseColor.rgb = mix(uHorizonFog, diffuseColor.rgb, vHaze);' : ''}`);
  };
  mat.customProgramCacheKey = () => (far ? 'mq-pyramids-far-v1' : 'mq-pyramids-v1');
  return mat;
}
