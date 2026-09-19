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
 *
 * A crack is a GAP first and a light second. The first version drew a bright
 * even tube right round the stone — neon wire wrapped on a rock. A real
 * fracture starts somewhere (here: the crown, where the crystal broke out),
 * runs down a flank or two, narrows, and dies away; what you see is a dark
 * split with light deep inside it, strongest at the source. So each fissure is
 * a dark bed, a glow that fades with distance from the crown, and a hot core
 * only near the source — and its two arms are different lengths. Forks are
 * short hairlines. The few crystals that pushed out stay near the crown.
 */
export function fissures(
  tris: readonly Tri[], rng: CrystalRng, tint: string, amount: number,
): { positions: number[]; colors: number[]; seep: Vector3 | null } {
  const positions: number[] = [], colors: number[] = [];
  if (amount <= 0) return { positions, colors, seep: null };
  const band = new Color(tint);
  const core = band.clone().lerp(new Color('#ffffff'), 0.75);
  const bed = new Color('#05070b');
  const put = (p: Vector3, c: Color, k = 1): void => { positions.push(p.x, p.y, p.z); colors.push(c.r * k, c.g * k, c.b * k); };

  interface Seg { p: Vector3; q: Vector3; normal: Vector3; side: Vector3 }
  const ab = new Vector3(), ac = new Vector3();
  const cut = (n: Vector3, d: number, phase: number): Seg[] => {
    const dist = (v: Vector3): number =>
      v.dot(n) - d + Math.sin(v.x * 6.5 + phase) * 0.07 + Math.sin(v.z * 8 + v.y * 5 + phase * 2) * 0.05;
    const out: Seg[] = [];
    for (const [a, b, c] of tris) {
      const da = dist(a), db = dist(b), dc = dist(c);
      const hits: Vector3[] = [];
      for (const [u, v, du, dv] of [[a, b, da, db], [b, c, db, dc], [c, a, dc, da]] as const) {
        if ((du < 0) !== (dv < 0)) hits.push(u.clone().lerp(v, du / (du - dv)));
      }
      if (hits.length !== 2) continue;
      const [p, q] = hits as [Vector3, Vector3];
      if ((p.y + q.y) * 0.5 < -0.2 || p.distanceToSquared(q) < 1e-6) continue; // nothing glows underground
      const normal = new Vector3().crossVectors(ab.subVectors(b, a), ac.subVectors(c, a)).normalize();
      out.push({ p, q, normal, side: new Vector3().crossVectors(normal, q.clone().sub(p)).normalize() });
    }
    return out;
  };

  const yaw = rng.next() * Math.PI;
  const mainN = new Vector3(Math.cos(yaw), rng.range(-0.2, 0.2), Math.sin(yaw)).normalize();
  const mainSegs = cut(mainN, rng.range(-0.1, 0.1), rng.next() * 6.28);
  if (!mainSegs.length) return { positions, colors, seep: null };
  // The source: the highest point of the fracture.
  const crown = mainSegs.reduce((best, sg) => (sg.p.y > best.y ? sg.p : best), mainSegs[0]!.p).clone();
  const armDir = new Vector3().crossVectors(mainN, new Vector3(0, 1, 0)).normalize();

  const lay = (segs: Seg[], origin: Vector3, reachA: number, reachB: number, width: number, hot: boolean): void => {
    for (const sg of segs) {
      // Which arm, and how far along it. Arms differ: cracks are not symmetric.
      const mid = sg.p.clone().add(sg.q).multiplyScalar(0.5).sub(origin);
      const reach = mid.dot(armDir) >= 0 ? reachA : reachB;
      const fade = (v: Vector3): number => Math.max(0, 1 - v.distanceTo(origin) / reach);
      const fp = fade(sg.p), fq = fade(sg.q);
      if (fp <= 0 && fq <= 0) continue;
      const jag = rng.range(0.7, 1.3);
      const quad = (w: number, lift: number, c: Color, kp: number, kq: number): void => {
        const wp = w * jag * fp ** 0.7, wq = w * jag * fq ** 0.7;
        const l = sg.normal.clone().multiplyScalar(lift);
        const p0 = sg.p.clone().addScaledVector(sg.side, -wp).add(l), p1 = sg.p.clone().addScaledVector(sg.side, wp).add(l);
        const q0 = sg.q.clone().addScaledVector(sg.side, -wq).add(l), q1 = sg.q.clone().addScaledVector(sg.side, wq).add(l);
        put(p0, c, kp); put(q0, c, kq); put(q1, c, kq); put(p0, c, kp); put(q1, c, kq); put(p1, c, kp);
      };
      quad(width * 1.9, 0.008, bed, 1, 1); //                       the split
      quad(width, 0.014, band, 0.15 + 0.85 * fp * fp, 0.15 + 0.85 * fq * fq); // light inside it, fading
      if (hot && (fp > 0.62 || fq > 0.62)) quad(width * 0.38, 0.02, core, Math.max(0, fp - 0.55) * 2.2, Math.max(0, fq - 0.55) * 2.2);
    }
  };

  const width = 0.02 + amount * 0.022;
  lay(mainSegs, crown, rng.range(0.95, 1.5) * (0.6 + amount * 0.5), rng.range(0.4, 0.8) * (0.6 + amount * 0.5), width, true);
  // Hairline forks leaving the main crack part-way down.
  const forks = Math.round(amount * 2);
  for (let f = 0; f < forks; f += 1) {
    const from = mainSegs[Math.floor(rng.next() * mainSegs.length)]!.p;
    if (from.distanceTo(crown) > 0.9) continue;
    const a = yaw + rng.range(0.6, 1.2) * (f % 2 ? 1 : -1);
    const n = new Vector3(Math.cos(a), rng.range(-0.3, 0.3), Math.sin(a)).normalize();
    const segs = cut(n, from.dot(n), rng.next() * 6.28).filter((sg) => sg.p.y < from.y + 0.05);
    const r = rng.range(0.3, 0.55);
    lay(segs, from, r, r * 0.4, width * 0.5, false);
  }
  // A few small crystals where the stone first gave way.
  const root = band.clone().lerp(new Color('#ffffff'), 0.4);
  for (const sg of mainSegs) {
    const mid = sg.p.clone().add(sg.q).multiplyScalar(0.5);
    if (mid.distanceTo(crown) > 0.38 || rng.next() > 0.3 + amount * 0.3) continue;
    const len = rng.range(0.07, 0.17);
    const tip = mid.clone().addScaledVector(sg.normal, len).add(new Vector3(rng.range(-0.03, 0.03), rng.range(0, 0.04), rng.range(-0.03, 0.03)));
    const along = sg.q.clone().sub(sg.p).normalize();
    const foot = [mid.clone().addScaledVector(sg.side, width * 2), mid.clone().addScaledVector(sg.side, -width * 2), mid.clone().addScaledVector(along, width * 2.4)];
    for (let k = 0; k < 3; k += 1) { put(foot[k]!, root); put(foot[(k + 1) % 3]!, root); put(tip, band, 1.1); }
  }
  return { positions, colors, seep: crown };
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
