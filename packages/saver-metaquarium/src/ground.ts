/**
 * The walkable top of the scenery's stone: what a crab stands on.
 *
 * The fish clearances (`Scenery.clearance`, `clusterClearance`) are padded
 * domes, built so a swimming nose clears a rock with room to spare. Something
 * WALKING on them hovers: a boulder is a bumpy icosahedron under a random yaw,
 * and its dome is neither its height nor its shape. So the stone's own
 * triangles are rasterised, once, into a height grid: each cell keeps the
 * highest upward-facing surface over its centre. Arches and ledges read as
 * their tops (a crab walks over an arch, not under it).
 *
 * Built at scenery-build time from geometry that is already in world space;
 * sampling is bilinear over the cells that have stone, -Infinity off it.
 */
import type { BufferGeometry } from 'three';

export type GroundFn = (x: number, z: number) => number;

/** Cell size, in world units: a crab foot is about 3 across at the default size. */
export const GROUND_CELL = 1.5;

export function stoneTop(geoms: readonly BufferGeometry[], cell = GROUND_CELL): GroundFn | null {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const g of geoms) {
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
  }
  if (!(x1 > x0)) return null;
  const nx = Math.ceil((x1 - x0) / cell) + 1, nz = Math.ceil((z1 - z0) / cell) + 1;
  const h = new Float32Array(nx * nz).fill(-Infinity);
  for (const g of geoms) {
    const p = g.getAttribute('position'), idx = g.getIndex();
    const n = idx ? idx.count : p.count;
    for (let t = 0; t < n; t += 3) {
      const a = idx ? idx.getX(t) : t, b = idx ? idx.getX(t + 1) : t + 1, c = idx ? idx.getX(t + 2) : t + 2;
      const ax = p.getX(a), ay = p.getY(a), az = p.getZ(a);
      const bx = p.getX(b), by = p.getY(b), bz = p.getZ(b);
      const cx = p.getX(c), cy = p.getY(c), cz = p.getZ(c);
      // A vertical face (no plan-view area) or a downward one (an overhang's
      // underside) is no floor. Stone is wound counter-clockwise, outward.
      const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(den) < 1e-9) continue;
      const up = (bz - az) * (cx - ax) - (bx - ax) * (cz - az); // ((b-a)×(c-a)).y
      if (up <= 0) continue;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - x0) / cell));
      const i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, cx) - x0) / cell));
      const k0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - z0) / cell));
      const k1 = Math.min(nz - 1, Math.ceil((Math.max(az, bz, cz) - z0) / cell));
      for (let i = i0; i <= i1; i++) {
        const x = x0 + i * cell;
        for (let k = k0; k <= k1; k++) {
          const z = z0 + k * cell;
          const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den;
          const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den;
          const l3 = 1 - l1 - l2;
          if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue;
          const y = l1 * ay + l2 * by + l3 * cy;
          const j = k * nx + i;
          if (y > h[j]!) h[j] = y;
        }
      }
    }
  }
  return (x, z) => {
    const fx = (x - x0) / cell, fz = (z - z0) / cell;
    if (fx < 0 || fz < 0 || fx > nx - 1 || fz > nz - 1) return -Infinity;
    const i = Math.min(nx - 2, Math.floor(fx)), k = Math.min(nz - 2, Math.floor(fz));
    const u = fx - i, v = fz - k;
    const q = [h[k * nx + i]!, h[k * nx + i + 1]!, h[(k + 1) * nx + i]!, h[(k + 1) * nx + i + 1]!];
    const w = [(1 - u) * (1 - v), u * (1 - v), (1 - u) * v, u * v];
    // Bilinear over the corners that have stone: the rim of a rock is a slope, not a cliff to -Infinity.
    let s = 0, sw = 0;
    for (let j = 0; j < 4; j++) if (q[j]! > -Infinity) { s += q[j]! * w[j]!; sw += w[j]!; }
    return sw > 0.25 ? s / sw : -Infinity;
  };
}
