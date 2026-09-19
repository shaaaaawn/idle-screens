/**
 * Rocks with crystal fissures — why the crystals are here at all.
 *
 * A crystal standing on a plane is an ornament. A crystal at the end of a
 * glowing crack in a boulder is geology: the light is IN the rock, it has
 * split the stone to get out, and the cluster on top is just where it made it.
 *
 * The fissure is not drawn on the rock, it is cut from it: the crack is the
 * exact intersection of the rock's own triangles with a plane that wobbles as
 * it goes, so every segment lies on a facet, bends at every edge the way a
 * real fracture does, and never floats or sinks. A second plane, kept to one
 * side of the first, forks it. Each segment is two ribbons — a wide band in
 * the crystal's colour and a narrow white-hot core — and here and there a
 * small crystal has grown out along the facet's normal.
 *
 * Works on any triangle soup (boulders, the arch, a ridge), is fully seeded,
 * and costs nothing per frame: it all lands in the scenery's two batches.
 */

import { BufferAttribute, BufferGeometry, Color, IcosahedronGeometry, Matrix4, Quaternion, Vector3 } from 'three';
import type { CrystalRng } from './crystals';

export type Tri = [Vector3, Vector3, Vector3];

export interface RockSpec {
  x: number; y: number; z: number;
  /** Half-extents. */
  rx: number; ry: number; rz: number;
  tint: string;
  /** 0..1 — how fractured: forks, width, how many crystals have pushed out. */
  veins: number;
}

export interface RockParts {
  stone: BufferGeometry;
  /** Null when `veins` is 0. */
  glow: BufferGeometry | null;
  triangles: number;
  /** Where the fissure is widest — a bubble vent, if the world wants one. */
  seep: Vector3 | null;
}

/** A unit boulder: displaced icosphere, flat-bottomed, never the same twice. */
export function boulder(rng: CrystalRng, detail = 1): Tri[] {
  const ico = new IcosahedronGeometry(1, detail);
  const src = ico.getAttribute('position');
  const bump = new Map<string, number>();
  const tris: Tri[] = [];
  const at = (i: number): Vector3 => {
    const x = src.getX(i), y = src.getY(i), z = src.getZ(i);
    const k = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let v = bump.get(k);
    if (v === undefined) { v = rng.range(0.74, 1.18); bump.set(k, v); }
    // Sat on the floor, not balanced on a point.
    return new Vector3(x * v, Math.max(-0.42, y * v), z * v);
  };
  for (let i = 0; i < src.count; i += 3) tris.push([at(i), at(i + 1), at(i + 2)]);
  ico.dispose();
  return tris;
}

/**
 * Cut fissures into a surface. `tris` are in the space the wobble is tuned
 * for (roughly unit). Returns loose coloured triangles.
 */
export function fissures(
  tris: readonly Tri[], rng: CrystalRng, tint: string, amount: number,
): { positions: number[]; colors: number[]; seep: Vector3 | null } {
  const positions: number[] = [], colors: number[] = [];
  if (amount <= 0) return { positions, colors, seep: null };
  const band = new Color(tint);
  const core = band.clone().lerp(new Color('#ffffff'), 0.8);
  const tipC = band.clone().multiplyScalar(1.1);
  const root = band.clone().lerp(new Color('#ffffff'), 0.4);
  const put = (p: Vector3, c: Color): void => { positions.push(p.x, p.y, p.z); colors.push(c.r, c.g, c.b); };
  const quad = (a: Vector3, b: Vector3, side: Vector3, w: number, lift: Vector3, c: Color): void => {
    const o = side.clone().multiplyScalar(w);
    const a0 = a.clone().sub(o).add(lift), a1 = a.clone().add(o).add(lift);
    const b0 = b.clone().sub(o).add(lift), b1 = b.clone().add(o).add(lift);
    for (const p of [a0, b0, b1, a0, b1, a1]) put(p, c);
  };

  // The main fracture crosses the top; forks hang off one side of it.
  const planes: Array<{ n: Vector3; d: number; phase: number; gate: Vector3 | null }> = [];
  const yaw = rng.next() * Math.PI;
  const main = new Vector3(Math.cos(yaw), rng.range(-0.25, 0.25), Math.sin(yaw)).normalize();
  planes.push({ n: main, d: rng.range(-0.12, 0.12), phase: rng.next() * 6.28, gate: null });
  const forks = Math.round(amount * 2);
  for (let f = 0; f < forks; f += 1) {
    const a = yaw + rng.range(0.5, 1.1) * (f % 2 ? 1 : -1);
    planes.push({
      n: new Vector3(Math.cos(a), rng.range(-0.3, 0.3), Math.sin(a)).normalize(),
      d: rng.range(-0.2, 0.2), phase: rng.next() * 6.28,
      gate: main.clone().multiplyScalar(f % 2 ? 1 : -1),
    });
  }

  let seep: Vector3 | null = null;
  const width = 0.028 + amount * 0.03;
  const ab = new Vector3(), ac = new Vector3(), normal = new Vector3(), dir = new Vector3(), side = new Vector3();
  for (const plane of planes) {
    const dist = (p: Vector3): number =>
      p.dot(plane.n) - plane.d + Math.sin(p.x * 6.5 + plane.phase) * 0.07 + Math.sin(p.z * 8 + p.y * 5 + plane.phase * 2) * 0.05;
    for (const [a, b, c] of tris) {
      const da = dist(a), db = dist(b), dc = dist(c);
      const hits: Vector3[] = [];
      for (const [p, q, dp, dq] of [[a, b, da, db], [b, c, db, dc], [c, a, dc, da]] as const) {
        if ((dp < 0) !== (dq < 0)) hits.push(p.clone().lerp(q, dp / (dp - dq)));
      }
      if (hits.length !== 2) continue;
      const [p, q] = hits as [Vector3, Vector3];
      const mid = p.clone().add(q).multiplyScalar(0.5);
      if (mid.y < -0.18) continue; // nothing glows underground
      if (plane.gate && mid.dot(plane.gate) < 0.05) continue;
      normal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a)).normalize();
      dir.subVectors(q, p);
      if (dir.lengthSq() < 1e-6) continue;
      side.crossVectors(normal, dir).normalize();
      // Wider on the crown, a hairline down the flanks.
      const w = width * (0.45 + 0.75 * Math.max(0, mid.y + 0.2));
      quad(p, q, side, w, normal.clone().multiplyScalar(0.012), band);
      quad(p, q, side, w * 0.36, normal.clone().multiplyScalar(0.02), core);
      if (!seep || mid.y > seep.y) seep = mid.clone();
      // Crystals that have pushed out through the crack.
      if (rng.next() < 0.22 * amount + 0.06) {
        const len = rng.range(0.1, 0.26) * (0.6 + amount * 0.6);
        const tip = mid.clone().add(normal.clone().multiplyScalar(len))
          .add(new Vector3(rng.range(-0.04, 0.04), rng.range(0, 0.05), rng.range(-0.04, 0.04)));
        const base = [
          mid.clone().add(side.clone().multiplyScalar(w * 1.6)),
          mid.clone().sub(side.clone().multiplyScalar(w * 1.6)),
          mid.clone().add(dir.clone().normalize().multiplyScalar(w * 1.8)),
        ];
        for (let k = 0; k < 3; k += 1) {
          put(base[k]!.clone().add(normal.clone().multiplyScalar(0.01)), root);
          put(base[(k + 1) % 3]!.clone().add(normal.clone().multiplyScalar(0.01)), root);
          put(tip, tipC);
        }
      }
    }
  }
  return { positions, colors, seep };
}

/** Stone colouring: slate, darker toward the buried base, a little different
 *  facet to facet, shaded from the same key as the terrain and crystals. */
export function paintStone(tris: readonly Tri[], place: Matrix4, rng: CrystalRng, base = '#33435a'): BufferGeometry {
  const pos = new Float32Array(tris.length * 9), col = new Float32Array(tris.length * 9);
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3(), u = new Vector3(), v = new Vector3();
  const stone = new Color(base);
  tris.forEach((t, i) => {
    a.copy(t[0]).applyMatrix4(place); b.copy(t[1]).applyMatrix4(place); c.copy(t[2]).applyMatrix4(place);
    n.crossVectors(u.subVectors(b, a), v.subVectors(c, a)).normalize();
    const key = 0.36 + 0.64 * Math.max(0, n.x * -0.45 + n.y * 0.78 + n.z * -0.43);
    const depth = 0.72 + 0.28 * Math.min(1, Math.max(0, (t[0].y + t[1].y + t[2].y) / 3 + 0.5));
    const k = key * depth * rng.range(0.9, 1.1);
    [a, b, c].forEach((p, j) => {
      pos.set([p.x, p.y, p.z], i * 9 + j * 3);
      col.set([stone.r * k, stone.g * k, stone.b * k], i * 9 + j * 3);
    });
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export function glowGeometry(positions: number[], colors: number[], place: Matrix4): BufferGeometry | null {
  if (!positions.length) return null;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  g.applyMatrix4(place);
  g.computeVertexNormals();
  return g;
}

export function buildRock(spec: RockSpec, rng: CrystalRng): RockParts {
  const tris = boulder(rng.fork(1), spec.rx > 16 ? 2 : 1);
  const place = new Matrix4().compose(
    new Vector3(spec.x, spec.y + spec.ry * 0.3, spec.z),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rng.next() * Math.PI * 2),
    new Vector3(spec.rx, spec.ry, spec.rz),
  );
  const cut = fissures(tris, rng.fork(2), spec.tint, spec.veins);
  return {
    stone: paintStone(tris, place, rng.fork(3)),
    glow: glowGeometry(cut.positions, cut.colors, place),
    triangles: tris.length + cut.positions.length / 9,
    seep: cut.seep ? cut.seep.applyMatrix4(place) : null,
  };
}
