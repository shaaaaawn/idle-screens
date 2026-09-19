/**
 * Crystals — the first scenery prop, generated rather than fetched.
 *
 * The original Metaquarium shipped six `crystal-*.glb` files (2.6–3 MB each).
 * Measured: every one is a single noise-displaced icosphere, stretched ≈1:4:1
 * into a spindle and copied 28–32 times — 39,636 triangles for what reads on
 * screen as a dozen facets a shard. `crystal-purple` (52 KB, 24 tris a shard)
 * is the same look. So nothing here downloads: a shard is ~40 triangles from
 * the seed, and a whole scene of clusters is one instanced draw.
 *
 * The layout law is lifted from `crystal-expanded.glb`, the one file that
 * still carries its node transforms: a lotus of 1 spire, then rings of 6, 9
 * and 16 at ≈30°, 55° and 85° of tilt, every shard radiating from one root
 * and shortening as it leans (3.85 → 1.4).
 *
 * Zero-dep on purpose, like `ipfs.ts` and `environments.ts`: the server
 * validates `propMix` through `./manifest` without pulling three.js, and
 * everything here is unit-testable as plain numbers.
 */

import type { EnvironmentName } from './environments';

/** Just the slice of core's Rng this module draws from. */
export interface CrystalRng {
  next(): number;
  range(min: number, max: number): number;
  fork(salt: number): CrystalRng;
}

// ---------------------------------------------------------------------------
// propMix DSL
// ---------------------------------------------------------------------------

export type CrystalHabit = 'lotus' | 'spire' | 'druse' | 'scatter';
export const CRYSTAL_HABITS: readonly CrystalHabit[] = ['lotus', 'spire', 'druse', 'scatter'];

/** Named colours are the originals' `GLOW-*` materials; `glass` is the dark
 *  transmission crystal (`crystal-expanded`); `env` follows the room. */
export const CRYSTAL_COLORS: Readonly<Record<string, string>> = {
  blue: '#1f7bff',
  hotpink: '#ff3f9e',
  purple: '#7a3cff',
  seafoam: '#2dffb0',
  yellow: '#ffd23a',
  orange: '#ff8a2a',
  cyan: '#4fe9ff',
  white: '#dff6ff',
  glass: '#2aa8ff',
};
export const CRYSTAL_PALETTES: readonly string[] = [
  'env', 'rainbow', ...Object.keys(CRYSTAL_COLORS),
];

const RAINBOW = ['hotpink', 'orange', 'yellow', 'seafoam', 'cyan', 'blue', 'purple'];

/** What a room's crystals look like when the token says `env` (the default). */
const ENV_COLORS: Readonly<Record<EnvironmentName, readonly string[]>> = {
  void: ['hotpink', 'cyan', 'yellow'],
  abyss: ['purple', 'blue'],
  reef: ['hotpink', 'seafoam', 'yellow'],
  kelp: ['seafoam', 'yellow'],
  ice: ['white', 'cyan'],
  vent: ['orange', 'yellow'],
  lagoon: ['seafoam', 'cyan'],
  universe: RAINBOW,
};

/** A room's own furniture, used only when `envProps` is `on` AND the author
 *  left `propMix` empty — the same "author always wins" rule as the palette. */
export const ENV_PROP_MIX: Readonly<Record<EnvironmentName, string>> = {
  void: '',
  abyss: 'crystal:3@lotus',
  reef: 'crystal:5@druse',
  kelp: 'crystal:3@druse',
  ice: 'crystal:3@spire,crystal:2@druse',
  vent: 'crystal:4@druse,crystal:1@lotus',
  lagoon: 'crystal:3@lotus',
  universe: 'crystal:6@lotus',
};

export interface PropMixEntry {
  kind: 'crystal';
  /** Author id (`crystal#hero`) — the key `props.<id>.*` paths will address. */
  id: string | null;
  count: number;
  habit: CrystalHabit;
  palette: string;
}

export interface PropMixResult {
  entries: PropMixEntry[];
  problems: string[];
}

/** Hard ceiling on clusters in one scene, whatever the tier allows. */
export const MAX_CLUSTERS = 12;

/**
 * `kind[#id][:count][@habit][/palette]`, comma separated.
 *
 *   crystal                      one lotus in the room's colours
 *   crystal#hero:1@lotus/hotpink
 *   crystal:6@druse, crystal:2@spire/glass
 *
 * Forgiving like `parseFishMix`: a bad token is dropped with a problem line,
 * never thrown — the classic lane can deliver anything.
 */
export function parsePropMix(input: string): PropMixResult {
  const entries: PropMixEntry[] = [];
  const problems: string[] = [];
  let total = 0;
  for (const raw of String(input ?? '').split(',')) {
    const token = raw.trim();
    if (!token) continue;
    const m = /^([a-z]+)(?:#([A-Za-z0-9_-]{1,24}))?(?::(\d{1,3}))?(?:@([a-z]+))?(?:\/([a-z]+))?$/.exec(token);
    if (!m) {
      problems.push(`"${token}" is not kind[#id][:count][@habit][/palette]`);
      continue;
    }
    const [, kind, id, countRaw, habitRaw, paletteRaw] = m;
    if (kind !== 'crystal') {
      problems.push(`unknown prop kind "${kind}" — known: crystal`);
      continue;
    }
    let habit: CrystalHabit = 'lotus';
    if (habitRaw) {
      if ((CRYSTAL_HABITS as readonly string[]).includes(habitRaw)) habit = habitRaw as CrystalHabit;
      else problems.push(`unknown habit "${habitRaw}" — using lotus (known: ${CRYSTAL_HABITS.join(', ')})`);
    }
    let palette = 'env';
    if (paletteRaw) {
      if (CRYSTAL_PALETTES.includes(paletteRaw)) palette = paletteRaw;
      else problems.push(`unknown palette "${paletteRaw}" — using env (known: ${CRYSTAL_PALETTES.join(', ')})`);
    }
    let count = countRaw ? Number(countRaw) : 1;
    if (count < 1) continue;
    if (total + count > MAX_CLUSTERS) {
      const kept = MAX_CLUSTERS - total;
      problems.push(`"${token}" clamped to ${kept} — a scene holds ${MAX_CLUSTERS} clusters`);
      count = kept;
      if (count < 1) continue;
    }
    if (id && entries.some((e) => e.id === id)) {
      problems.push(`prop id "${id}" is already taken — ids are unique per scene`);
      continue;
    }
    total += count;
    entries.push({ kind: 'crystal', id: id ?? null, count, habit, palette });
  }
  return { entries, problems };
}

// ---------------------------------------------------------------------------
// Shard geometry
// ---------------------------------------------------------------------------

export interface ShardGeometry {
  /** Non-indexed triangles, root at the origin, long axis +Y, length 1. */
  positions: Float32Array;
  /** Flat facet normals — what the crystal shader shades and sparkles on. */
  normals: Float32Array;
  /** Smooth outward direction — what the halo shell pushes along, so the
   *  inverted hull swells as one skin instead of cracking per facet. */
  smooth: Float32Array;
  triangles: number;
}

/** Radius profile measured from the original shard: a thin root, the girdle
 *  ABOVE the middle, a shoulder, then the termination. [height, radius]. */
const PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0, 0.23], [0.24, 0.8], [0.6, 1], [0.84, 0.58],
];
/** Girdle radius as a fraction of length — the originals' ≈4.1:1 aspect. */
export const SHARD_RADIUS = 0.122;

export function shardGeometry(rng: CrystalRng): ShardGeometry {
  const n = 5 + Math.floor(rng.next() * 3); // 5–7 sides
  const twist = rng.range(-0.25, 0.25);
  // One radial gain per SIDE, shared by every ring, so faces stay near-planar
  // quads (a crystal) instead of a crumpled tube; a little per-vertex noise on
  // top keeps any two facets from being exactly parallel.
  const sideGain = Array.from({ length: n }, () => rng.range(0.78, 1.18));
  const rings: number[][][] = PROFILE.map(([h, r], ri) =>
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + twist * ri;
      const rr = SHARD_RADIUS * r * sideGain[i]! * rng.range(0.94, 1.06);
      return [Math.cos(a) * rr, h, Math.sin(a) * rr];
    }),
  );
  const tip = [rng.range(-0.03, 0.03), 1, rng.range(-0.03, 0.03)];

  const tris: number[][][] = [];
  for (let ri = 0; ri < rings.length - 1; ri += 1) {
    const lo = rings[ri]!;
    const hi = rings[ri + 1]!;
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      tris.push([lo[i]!, hi[i]!, hi[j]!], [lo[i]!, hi[j]!, lo[j]!]);
    }
  }
  const top = rings[rings.length - 1]!;
  for (let i = 0; i < n; i += 1) tris.push([top[i]!, tip, top[(i + 1) % n]!]);
  // No root cap: the root is sunk below the floor and never seen.

  const positions = new Float32Array(tris.length * 9);
  const normals = new Float32Array(tris.length * 9);
  const smooth = new Float32Array(tris.length * 9);
  tris.forEach((tri, t) => {
    const [a, b, c] = tri as [number[], number[], number[]];
    const ux = b[0]! - a[0]!, uy = b[1]! - a[1]!, uz = b[2]! - a[2]!;
    const vx = c[0]! - a[0]!, vy = c[1]! - a[1]!, vz = c[2]! - a[2]!;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    // Wind outward: the facet normal must point away from the long axis.
    const mx = (a[0]! + b[0]! + c[0]!) / 3, mz = (a[2]! + b[2]! + c[2]!) / 3;
    const flip = nx * mx + nz * mz < 0 && Math.abs(ny) < 0.98;
    const order = flip ? [a, c, b] : [a, b, c];
    if (flip) { nx = -nx; ny = -ny; nz = -nz; }
    order.forEach((p, k) => {
      const o = t * 9 + k * 3;
      positions[o] = p[0]!; positions[o + 1] = p[1]!; positions[o + 2] = p[2]!;
      normals[o] = nx; normals[o + 1] = ny; normals[o + 2] = nz;
      const sy = (p[1]! - 0.55) * 0.25;
      const sl = Math.hypot(p[0]!, sy, p[2]!) || 1;
      smooth[o] = p[0]! / sl; smooth[o + 1] = sy / sl; smooth[o + 2] = p[2]! / sl;
    });
  });
  return { positions, normals, smooth, triangles: tris.length };
}

// ---------------------------------------------------------------------------
// Cluster law
// ---------------------------------------------------------------------------

/** [count, tilt°] per ring, innermost first, at the full shard budget. */
const HABIT_RINGS: Readonly<Record<CrystalHabit, ReadonlyArray<readonly [number, number]>>> = {
  lotus: [[1, 0], [6, 30], [9, 55], [16, 85]],
  spire: [[1, 0], [3, 7], [5, 17]],
  druse: [[7, 20], [11, 46], [14, 72]],
  scatter: [[1, 0], [6, 30], [9, 55], [16, 85]],
};
/** Spire length in world units at crystalScale 1 (a fish is 18 long). */
const HABIT_LENGTH: Readonly<Record<CrystalHabit, number>> = {
  lotus: 40, spire: 58, druse: 22, scatter: 32,
};

export interface Shard {
  /** Root position, world units, relative to the cluster root. */
  x: number; y: number; z: number;
  /** Unit long-axis direction. */
  ax: number; ay: number; az: number;
  /** Spin about its own axis, radians. */
  roll: number;
  length: number;
  /** Width relative to the measured 4:1 shard — a spire is drawn out thin. */
  girth: number;
  /** Which of the scene's shard-geometry variants this one wears. */
  variant: number;
}

export interface Cluster {
  id: string | null;
  habit: CrystalHabit;
  /** Root on the floor (y is filled in by the host from its terrain). */
  x: number; y: number; z: number;
  /** Hex colour. */
  color: string;
  glass: boolean;
  /** Footprint radius and standing height — what fish steer around and what
   *  the light field uses as the emitter's reach. */
  radius: number;
  height: number;
  /** Pulse phase, radians. */
  phase: number;
  shards: Shard[];
}

export interface ClusterOptions {
  /** Shards allowed in one cluster (tier budget). */
  shardCap: number;
  /** Geometry variants available to pick from. */
  variants: number;
  scale: number;
}

/** One cluster's shards from the habit's ring table. Thins each ring
 *  proportionally when the tier cannot afford the full 32. */
export function growCluster(
  habit: CrystalHabit, rng: CrystalRng, opts: ClusterOptions,
): { shards: Shard[]; radius: number; height: number } {
  const rings = HABIT_RINGS[habit];
  const full = rings.reduce((a, [c]) => a + c, 0);
  const keep = Math.min(1, opts.shardCap / full);
  const size = HABIT_LENGTH[habit] * opts.scale * rng.range(0.8, 1.2);
  // Spires stand as a stand of columns, not petals from one point.
  const spread = habit === 'scatter' ? size * 0.9 : habit === 'spire' ? size * 0.13 : 0;
  const girth = habit === 'spire' ? 0.62 : 1;
  const shards: Shard[] = [];
  let radius = 0;
  let height = 0;
  for (const [count, tiltDeg] of rings) {
    const c = count === 1 ? 1 : Math.max(3, Math.round(count * keep));
    const offset = rng.next() * Math.PI * 2;
    for (let i = 0; i < c; i += 1) {
      const tilt = ((tiltDeg + (count === 1 ? rng.range(0, 6) : rng.range(-7, 7))) * Math.PI) / 180;
      const az = offset + (i / c) * Math.PI * 2 + rng.range(-0.22, 0.22);
      // The measured law: length falls ≈linearly with tilt, 3.85 → 1.4.
      // A druse is a crust: stubby and uneven, where a lotus is graded.
      const vary = habit === 'druse' ? rng.range(0.5, 1.3)
        : habit === 'spire' && count > 1 ? rng.range(0.45, 1.05) : rng.range(0.85, 1.12);
      const length = size * (1 - 0.64 * Math.min(1, tilt / 1.69)) * vary;
      const ax = Math.sin(tilt) * Math.cos(az);
      const az3 = Math.sin(tilt) * Math.sin(az);
      // Never below the horizon: the originals' 97° skirt dips into a flat
      // Blender floor; on terrain that reads as a shard stabbed into a hill.
      const ay = Math.max(0.1, Math.cos(tilt));
      const al = Math.hypot(ax, ay, az3);
      const sr = spread ? Math.sqrt(rng.next()) * spread : 0;
      const sa = rng.next() * Math.PI * 2;
      shards.push({
        x: Math.cos(sa) * sr, y: -length * 0.08, z: Math.sin(sa) * sr,
        ax: ax / al, ay: ay / al, az: az3 / al,
        roll: rng.next() * Math.PI * 2,
        length,
        girth,
        variant: Math.floor(rng.next() * opts.variants) % Math.max(1, opts.variants),
      });
      radius = Math.max(radius, sr + Math.hypot(ax, az3) / al * length);
      height = Math.max(height, (ay / al) * length);
    }
  }
  return { shards, radius, height };
}

export interface LayoutOptions extends ClusterOptions {
  environment: EnvironmentName;
  /** Clusters the tier affords. */
  clusterCap: number;
}

export interface CrystalLayout {
  clusters: Cluster[];
  problems: string[];
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/**
 * Every cluster in the scene, placed. A golden-angle spiral rather than
 * rejection sampling: no retries, no failure mode, even cover, and the FIRST
 * token lands nearest the centre — so `crystal#hero` is where the camera is.
 */
export function layoutCrystals(
  entries: readonly PropMixEntry[], rng: CrystalRng, opts: LayoutOptions,
): CrystalLayout {
  const problems: string[] = [];
  const wanted = entries.reduce((a, e) => a + e.count, 0);
  const total = Math.min(wanted, opts.clusterCap);
  if (wanted > total) problems.push(`${wanted} clusters asked, ${total} built — this device's prop budget`);
  const clusters: Cluster[] = [];
  const spin = rng.next() * Math.PI * 2;
  const envColors = ENV_COLORS[opts.environment] ?? ENV_COLORS.void;
  let k = 0;
  for (const e of entries) {
    for (let i = 0; i < e.count && k < total; i += 1, k += 1) {
      const crng = rng.fork(0x5a0 + k);
      const r = 24 + 100 * Math.sqrt(k / Math.max(1, total)) + crng.range(-8, 8);
      const a = spin + k * GOLDEN;
      const names = e.palette === 'env' ? envColors : e.palette === 'rainbow' ? RAINBOW : [e.palette];
      const name = names[(k + Math.floor(crng.next() * 2)) % names.length]!;
      // The camera orbits at 80–400 and looks at the centre, so an outer
      // cluster is the one that ends up between lens and fish: the hero
      // stands in the middle, the ring around it stays low.
      const grown = growCluster(e.habit, crng, { ...opts, scale: opts.scale * (1 - 0.5 * Math.min(1, r / 124)) });
      clusters.push({
        id: e.id && e.count === 1 ? e.id : e.id ? `${e.id}.${i}` : null,
        habit: e.habit,
        x: Math.cos(a) * r, y: 0, z: Math.sin(a) * r,
        color: CRYSTAL_COLORS[name] ?? CRYSTAL_COLORS.hotpink!,
        glass: name === 'glass',
        phase: crng.next() * Math.PI * 2,
        ...grown,
      });
    }
  }
  return { clusters, problems };
}

// ---------------------------------------------------------------------------
// Light field
// ---------------------------------------------------------------------------

/** A point of coloured light. Linear RGB 0..1. */
export interface Emitter {
  x: number; y: number; z: number;
  r: number; g: number; b: number;
  /** Distance at which the light has halved. */
  reach: number;
  phase: number;
}

/** Slow enough (0.12 Hz) and shallow enough (≤15 %) to sit far inside the
 *  flash-safety envelope at any `pulse`. */
export const PULSE_HZ = 0.12;
export function pulseAt(tSec: number, phase: number, pulse: number): number {
  return 1 - pulse * 0.15 * (0.5 + 0.5 * Math.sin(tSec * PULSE_HZ * Math.PI * 2 + phase));
}

function hexToLinear(hex: string): [number, number, number] {
  const h = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1] ?? 'ffffff';
  const ch = (i: number): number => {
    const s = parseInt(h.slice(i, i + 2), 16) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [ch(0), ch(2), ch(4)];
}

/** Clusters as emitters. Glass clusters barely emit — they catch light. */
export function emittersOf(clusters: readonly Cluster[]): Emitter[] {
  return clusters.map((c) => {
    const [r, g, b] = hexToLinear(c.color);
    const k = c.glass ? 0.25 : 1;
    return {
      x: c.x, y: c.y + c.height * 0.35, z: c.z,
      r: r * k, g: g * k, b: b * k,
      reach: Math.max(c.radius, c.height) * 2.2,
      phase: c.phase,
    };
  });
}

/**
 * The light at a point: Σ colour / (1 + (d/reach)²). No lights in the scene
 * graph — every surface that wants to look lit samples this, on the CPU for
 * a fish (N ≤ 24 × ≤ 12 emitters) or mirrored as a shader loop for the floor.
 */
export function sampleLight(
  emitters: readonly Emitter[], x: number, y: number, z: number,
  tSec: number, pulse: number, out: [number, number, number] = [0, 0, 0],
): [number, number, number] {
  let r = 0, g = 0, b = 0;
  for (const e of emitters) {
    const dx = x - e.x, dy = y - e.y, dz = z - e.z;
    const q = (dx * dx + dy * dy + dz * dz) / (e.reach * e.reach);
    const w = pulseAt(tSec, e.phase, pulse) / (1 + q);
    r += e.r * w; g += e.g * w; b += e.b * w;
  }
  out[0] = r; out[1] = g; out[2] = b;
  return out;
}

/** How high the seabed effectively is at (x, z) once clusters stand on it
 *  (-Infinity where none does) — a dome per cluster, so floor-huggers ride over a crystal, not through it. */
export function clusterClearance(clusters: readonly Cluster[], x: number, z: number): number {
  let h = -Infinity;
  for (const c of clusters) {
    const d = Math.hypot(x - c.x, z - c.z);
    // A DOME, not a cone: a lotus is a bowl — widest at the top — so a cone
    // over it lets a fish at mid-radius swim straight through the petals.
    // Parabolic, so the rim has a finite slope and a fish rides up it rather
    // than popping; the foot carries half a body length for the nose.
    const foot = c.radius * 1.1 + 9;
    if (d < foot) h = Math.max(h, c.y + c.height * 0.9 * (1 - (d / foot) ** 2));
  }
  return h;
}
