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
  /** An existing paved road (a castle's). Doors join it at their nearest point, and it is the hub. */
  spine?: { x0: number; z0: number; x1: number; z1: number; width: number };
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
    // Pushing the SAMPLES out is not enough: the chord between two pushed
    // samples can still sag through the stone (seed 9 in paths.test.ts laid a
    // segment 8.95 units from the centre of a 16-radius rock). Where a chord
    // passes inside the stone (plus half a path width, so the paving itself
    // clears the rim), split it at its nearest point and push that point out
    // to the full clearance. The test is against the STONE, not the clearance
    // circle: a chord between two points on the clearance circle always sags
    // a little inside it, so testing there never converges. Splitting halves
    // the chord and the sag shrinks quadratically — two rounds settle any
    // walk; the cap and the uniform budget bound it regardless. No rng, so
    // the walk stays a pure function of the seed.
    let inserted = 0;
    for (let round = 0; round < 3 && inserted < 8; round++) {
      let split = false;
      for (let i = 0; i + 1 < pts.length && inserted < 8; i++) {
        // The uniform array is exactly MAX_PATH_SEGMENTS wide; a split that
        // would overflow it is dropped rather than written past the end.
        if (segments.length + pts.length > MAX_PATH_SEGMENTS) break;
        const p = pts[i]!, q = pts[i + 1]!;
        for (const o of opts.obstacles) {
          const need = o.r + width * 1.5;
          const vx = q.x - p.x, vz = q.z - p.z, len2 = vx * vx + vz * vz;
          if (len2 < 1e-6) continue;
          const u = ((o.x - p.x) * vx + (o.z - p.z) * vz) / len2;
          if (u <= 0 || u >= 1) continue; // endpoints were already cleared
          const cx = p.x + vx * u, cz = p.z + vz * u;
          const d = Math.hypot(cx - o.x, cz - o.z);
          if (d >= o.r + width * 0.5 || d <= 1e-3) continue;
          pts.splice(i + 1, 0, { x: o.x + ((cx - o.x) / d) * need, z: o.z + ((cz - o.z) / d) * need });
          inserted++;
          split = true;
          break;
        }
      }
      if (!split) break;
    }
    // One material, or two: some walks change underfoot half-way.
    const first = pick(r), second = opts.material === 'auto' && r.next() < 0.3 ? pick(r) : first;
    for (let i = 0; i + 1 < pts.length; i++) {
      segments.push({ x0: pts[i]!.x, z0: pts[i]!.z, x1: pts[i + 1]!.x, z1: pts[i + 1]!.z, width, material: i < (pts.length - 1) / 2 ? first : second });
    }
    edges += 1;
  };

  const main = 9.5 * s, lane = 7 * s, trail = 4.6 * s;
  const sp = opts.spine;
  if (sp) {
    // The paving IS the road: each door walks to the nearest point along its
    // edge, on its own side — nobody crosses the street to reach a hub.
    hub.x = sp.x1; hub.z = sp.z1;
    const bx = sp.x1 - sp.x0, bz = sp.z1 - sp.z0, bl = Math.hypot(bx, bz) || 1;
    const join = (p: { x: number; z: number }): { x: number; z: number } => {
      const t = Math.min(1, Math.max(0.12, ((p.x - sp.x0) * bx + (p.z - sp.z0) * bz) / (bl * bl)));
      const cx = sp.x0 + bx * t, cz = sp.z0 + bz * t;
      const side = Math.sign((p.x - cx) * (-bz / bl) + (p.z - cz) * (bx / bl)) || 1;
      return { x: cx + (-bz / bl) * side * sp.width * 0.8, z: cz + (bx / bl) * side * sp.width * 0.8 };
    };
    homes.forEach((h, i) => walk(h, join(h), lane, rng.fork(10 + i)));
  } else {
    // The road to the landmark first: it must never be the one that misses the budget.
    marks.forEach((m, i) => walk(hub, m, main, rng.fork(50 + i)));
    homes.forEach((h, i) => walk(h, hub, lane, rng.fork(10 + i)));
  }
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
  uniform float uMqPathT;
  uniform vec4 uMqPathA[${MAX_PATH_SEGMENTS}];
  uniform vec4 uMqPathB[${MAX_PATH_SEGMENTS}];
  float mqHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float mqNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mqHash(i), mqHash(i + vec2(1.0, 0.0)), f.x), mix(mqHash(i + vec2(0.0, 1.0)), mqHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
`;
/** Tile size of a painted path, in world units at scale 1 — the castle's paving is laid on the same grid. */
export const PATH_TILE = 5.1;
export const PATH_FRAGMENT = /* glsl */ `
  if (uMqPathN > 0) {
    // The world is voxels and tiles, so a path is TILES: coverage is decided
    // once per tile (at its centre), which steps the edge like everything
    // else here instead of airbrushing a smear across the floor.
    float T = ${PATH_TILE.toFixed(2)} * uMqPathT;
    // Half a tile over in x, so the grid lines up with a castle road laid about x = 0.
    vec2 g = vMqW.xz / T + vec2(0.5, 0.0);
    vec2 cell = floor(g), pc = (cell + vec2(0.0, 0.5)) * T, in01 = fract(g);
    float best = 1e9, mat = 0.0, hw = 1.0;
    for (int i = 0; i < ${MAX_PATH_SEGMENTS}; i++) {
      if (i >= uMqPathN) break;
      vec2 a = uMqPathA[i].xy, ba = uMqPathA[i].zw - a, pa = pc - a;
      float d = length(pa - ba * clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0)) - uMqPathB[i].x;
      if (d < best) { best = d; mat = uMqPathB[i].y; hw = uMqPathB[i].x; }
    }
    float r1 = mqHash(cell), r2 = mqHash(cell + 17.3);
    // Ragged by whole tiles: the odd one missing inside, the odd one straying out.
    float laid = step(best + (r1 - 0.5) * T * 0.9, 0.0) * step(0.06, r2 + step(best, -hw * 0.5));
    if (laid > 0.5) {
      float worn = 1.0 - smoothstep(-hw, -hw * 0.25, best); // 1 down the middle, where it is walked
      // A tile has an edge: a dark joint round it, a lit top-left lip.
      float joint = min(min(in01.x, 1.0 - in01.x), min(in01.y, 1.0 - in01.y));
      float seam = smoothstep(0.0, 0.07, joint);
      float lipL = (1.0 - smoothstep(0.07, 0.16, min(in01.x, 1.0 - in01.y))) * seam;
      vec3 col;
      if (mat < 0.5) {
        // Algae: slabs gone green — tank green, a different shade a tile, paler where it is walked.
        col = mix(vec3(0.012, 0.11, 0.045), vec3(0.04, 0.26, 0.085), r1);
        col = mix(col, col * 1.3 + vec3(0.03, 0.05, 0.0), worn * 0.6);
        col *= 0.85 + 0.3 * step(0.72, mqNoise(vMqW.xz * 1.4)); // flecks of growth within a tile
      } else if (mat < 1.5) {
        // Cobbles: the castle's own greys.
        col = mix(vec3(0.27, 0.3, 0.37), vec3(0.44, 0.47, 0.55), r1);
      } else {
        // Sandstone flags.
        col = mix(vec3(0.62, 0.54, 0.38), vec3(0.78, 0.7, 0.5), r1);
      }
      // As bright as the floor it lies on: a path in a dark ocean is a dark path.
      float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      col *= clamp(0.34 + lum * 2.6, 0.34, 1.0);
      col = col * (0.45 + 0.55 * seam) + lipL * 0.07;
      diffuseColor.rgb = mix(diffuseColor.rgb, col, 0.96);
    }
  }
`;
