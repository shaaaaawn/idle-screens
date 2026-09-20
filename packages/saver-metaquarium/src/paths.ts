/**
 * Paths: what makes a scatter of homes and a castle a PLACE. Every front door
 * gets a walk to the village's hub, the hub gets a road to the landmark, and
 * at higher settings trails run out to the big crystals — so the layout reads
 * as used, not as props dropped on a floor.
 *
 * A path is not geometry. It is a short list of line segments with a width
 * and a material, which the FLOOR's shader paints (`installFloorPools`), so it
 * lies on any terrain, costs no triangles, and never z-fights. Mostly it is
 * fish-tank algae — a worn green, paler down the middle where it is walked —
 * but a stretch can be pebbles or pale sand, and one walk may change material
 * part-way: the hook for bigger maps, where a road crosses different ground.
 *
 * Pure and seeded: the same world grows the same paths. Zero three.js.
 */

import type { CrystalRng } from './crystals';

export type PathMaterial = 'algae' | 'pebble' | 'sand';
export const PATH_MATERIALS: readonly PathMaterial[] = ['algae', 'pebble', 'sand'];
/** Uniform budget in the floor shader. */
export const MAX_PATH_SEGMENTS = 24;

export interface PathNode { x: number; z: number; kind: 'home' | 'landmark' | 'crystal' }
export interface PathSegment { x0: number; z0: number; x1: number; z1: number; width: number; material: PathMaterial }
export interface PathOptions {
  /** 0..1 — 0 none; up to 0.5 the walks from each door; above it, trails to the crystals too. */
  amount: number;
  /** `auto` is mostly algae with the odd stretch of something else. */
  material: PathMaterial | 'auto';
  scale: number;
  /** Things a path goes round, not through. */
  obstacles: readonly { x: number; z: number; r: number }[];
}
export interface PathNetwork { segments: PathSegment[]; hub: { x: number; z: number } | null; edges: number }

export function buildPaths(nodes: readonly PathNode[], rng: CrystalRng, opts: PathOptions): PathNetwork {
  if (opts.amount <= 0 || !nodes.length) return { segments: [], hub: null, edges: 0 };
  const s = opts.scale;
  const homes = nodes.filter((n) => n.kind === 'home'), marks = nodes.filter((n) => n.kind === 'landmark');
  const crystals = nodes.filter((n) => n.kind === 'crystal');
  // The hub: where the village's walks meet — in front of the homes, toward
  // the viewer, the way a green sits in front of its cottages.
  const anchor = homes.length ? homes : marks.length ? marks : crystals;
  const hub = {
    x: anchor.reduce((t, n) => t + n.x, 0) / anchor.length,
    z: anchor.reduce((t, n) => t + n.z, 0) / anchor.length + (homes.length ? 26 * s : 0),
  };
  const pick = (r: CrystalRng): PathMaterial => {
    if (opts.material !== 'auto') return opts.material;
    const u = r.next();
    return u < 0.68 ? 'algae' : u < 0.87 ? 'pebble' : 'sand';
  };

  const segments: PathSegment[] = [];
  let edges = 0;
  const walk = (a: { x: number; z: number }, b: { x: number; z: number }, width: number, r: CrystalRng): void => {
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    if (len < 6 * s) return;
    const n = Math.min(5, Math.max(2, Math.round(len / (30 * s))));
    if (segments.length + n > MAX_PATH_SEGMENTS) return;
    const px = -dz / len, pz = dx / len;
    // A walk meanders: one slow bend, seeded, largest in the middle.
    const bend = r.range(-0.16, 0.16) * len, wob = r.range(-0.05, 0.05) * len;
    const pts = Array.from({ length: n + 1 }, (_, i) => {
      const t = i / n, off = Math.sin(t * Math.PI) * bend + Math.sin(t * Math.PI * 2) * wob;
      const p = { x: a.x + dx * t + px * off, z: a.z + dz * t + pz * off };
      if (i > 0 && i < n) for (const o of opts.obstacles) {
        const d = Math.hypot(p.x - o.x, p.z - o.z), need = o.r + width * 1.5;
        if (d < need && d > 1e-3) { p.x = o.x + ((p.x - o.x) / d) * need; p.z = o.z + ((p.z - o.z) / d) * need; }
      }
      return p;
    });
    // One material, or two: some walks change underfoot half-way.
    const first = pick(r), second = opts.material === 'auto' && r.next() < 0.3 ? pick(r) : first;
    for (let i = 0; i < n; i++) {
      segments.push({ x0: pts[i]!.x, z0: pts[i]!.z, x1: pts[i + 1]!.x, z1: pts[i + 1]!.z, width, material: i < n / 2 ? first : second });
    }
    edges += 1;
  };

  const main = 7.5 * s, lane = 5.2 * s, trail = 3.4 * s;
  // The road to the landmark first: it must never be the one that misses the budget.
  marks.forEach((m, i) => walk(hub, m, main, rng.fork(50 + i)));
  homes.forEach((h, i) => walk(h, hub, lane, rng.fork(10 + i)));
  if (opts.amount > 0.5) {
    const count = Math.round((opts.amount - 0.5) * 2 * Math.min(4, crystals.length));
    [...crystals].sort((p, q) => Math.hypot(p.x - hub.x, p.z - hub.z) - Math.hypot(q.x - hub.x, q.z - hub.z))
      .slice(0, count).forEach((c, i) => walk(hub, c, trail, rng.fork(80 + i)));
  }
  return { segments, hub, edges };
}

/** Value noise + the path painter, as shader text for the floor material. */
/** How far `p` is from the nearest of these walks, less its half-width (negative = on it). */
export function pathClearance(segments: readonly PathSegment[], x: number, z: number): number {
  let best = Infinity;
  for (const g of segments) {
    const bx = g.x1 - g.x0, bz = g.z1 - g.z0, t = Math.min(1, Math.max(0, ((x - g.x0) * bx + (z - g.z0) * bz) / Math.max(1e-6, bx * bx + bz * bz)));
    best = Math.min(best, Math.hypot(x - g.x0 - bx * t, z - g.z0 - bz * t) - g.width);
  }
  return best;
}

export const PATH_PARS = /* glsl */ `
  uniform int uMqPathN;
  uniform vec4 uMqPathA[${MAX_PATH_SEGMENTS}];
  uniform vec4 uMqPathB[${MAX_PATH_SEGMENTS}];
  float mqHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float mqNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mqHash(i), mqHash(i + vec2(1.0, 0.0)), f.x), mix(mqHash(i + vec2(0.0, 1.0)), mqHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
`;
export const PATH_FRAGMENT = /* glsl */ `
  if (uMqPathN > 0) {
    vec2 pw = vMqW.xz;
    float best = 1e9, mat = 0.0, hw = 1.0;
    for (int i = 0; i < ${MAX_PATH_SEGMENTS}; i++) {
      if (i >= uMqPathN) break;
      vec2 a = uMqPathA[i].xy, ba = uMqPathA[i].zw - a, pa = pw - a;
      float d = length(pa - ba * clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0)) - uMqPathB[i].x;
      if (d < best) { best = d; mat = uMqPathB[i].y; hw = uMqPathB[i].x; }
    }
    // A ragged, grown edge — never a ruled line.
    float n1 = mqNoise(pw * 0.12), n2 = mqNoise(pw * 0.41 + 7.3);
    float cover = 1.0 - smoothstep(-0.8, 1.4, best + (n1 - 0.5) * 3.4 + (n2 - 0.5) * 1.3);
    if (cover > 0.0) {
      float worn = 1.0 - smoothstep(-hw, -hw * 0.25, best); // 1 down the middle, where it is walked
      vec3 col;
      if (mat < 0.5) {
        // Algae: tank green, mottled, paler and yellower where feet keep it short.
        col = mix(vec3(0.015, 0.17, 0.07), vec3(0.06, 0.38, 0.12), n2);
        col = mix(col, col * 1.3 + vec3(0.03, 0.05, 0.0), worn * 0.6);
        col *= 0.82 + 0.36 * step(0.7, mqNoise(pw * 1.4));
      } else if (mat < 1.5) {
        // Pebbles: rounded stones in a dark bed, each its own grey.
        vec2 g = pw / 2.3, c = floor(g);
        vec2 f = fract(g) - 0.5 + (vec2(mqHash(c), mqHash(c + 3.1)) - 0.5) * 0.3;
        float stone = 1.0 - smoothstep(0.26, 0.44, length(f));
        col = mix(vec3(0.10, 0.11, 0.14), mix(vec3(0.36, 0.39, 0.46), vec3(0.62, 0.60, 0.55), mqHash(c + 9.7)), stone);
      } else {
        // Sand: pale, rippled across the walk.
        col = vec3(0.72, 0.64, 0.46) * (0.84 + 0.2 * n2 + 0.08 * sin(pw.x * 0.9 + pw.y * 0.5 + n1 * 6.0));
      }
      // As bright as the floor it lies on: a path in a dark ocean is a dark path.
      float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      col *= clamp(0.34 + lum * 2.6, 0.34, 1.0);
      // A darker lip where the growth meets bare floor, so the walk has an edge to read.
      float lip = smoothstep(0.0, 0.5, cover) * (1.0 - smoothstep(0.5, 1.0, cover));
      diffuseColor.rgb = mix(diffuseColor.rgb, col * (1.0 - 0.45 * lip), min(1.0, cover * 1.1) * 0.95);
    }
  }
`;
