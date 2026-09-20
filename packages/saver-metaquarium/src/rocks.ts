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

/** How far below the floor a boulder's base is clamped: the buried rim. A
 *  fissure may dip to it, never below the stone — rocks.test.ts pins this. */
export const ROCK_BASE = -0.42;

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
    return new Vector3(x * v, Math.max(ROCK_BASE, y * v), z * v);
  };
  for (let i = 0; i < src.count; i += 3) tris.push([at(i), at(i + 1), at(i + 2)]);
  ico.dispose();
  return tris;
}

/**
 * Cut fissures into a surface. `tris` are in the space the wobble is tuned
 * for (roughly unit). Returns loose coloured triangles plus a per-vertex
 * `flow` coordinate (distance from the source) for the shader to run light
 * down the channels.
 *
 * Third attempt, and what each taught: a bright tube right round the stone was
 * neon wire on a rock; a thin dark split was honest but dead. What this wants
 * to be is LAVA ON A MOUNTAIN — the crystals have burst out of the crown and
 * the light runs downhill from them in rivulets, like a creek finding its way:
 *
 *   - every channel starts at the crown and runs DOWN a flank (each is the
 *     stone cut by a vertical plane through the summit, kept on one side);
 *   - three to five of them at uneven angles, of uneven length, so the rock
 *     reads as split from the top rather than drawn on;
 *   - molten section: dark chilled banks, a wide glowing body, a white-hot
 *     thread down the middle — brightest at the source, cooling as it goes;
 *   - they wander, narrow toward the toe, and some fork once on the way down;
 *   - shards of crystal stand in the breach round the crown;
 *   - and the light FLOWS: `flow` lets the shader send slow pulses downhill.
 */
export function fissures(
  tris: readonly Tri[], rng: CrystalRng, tint: string, amount: number, worldPerUnit = 12,
): { positions: number[]; colors: number[]; flow: number[]; seep: Vector3 | null } {
  const positions: number[] = [], colors: number[] = [], flow: number[] = [];
  // Nothing to cut: no stone, no crown — and no seep for the vents to use.
  if (amount <= 0 || !tris.length) return { positions, colors, flow, seep: null };
  const band = new Color(tint);
  const core = band.clone().lerp(new Color('#ffffff'), 0.82);
  const bank = new Color('#04060a');
  const put = (p: Vector3, c: Color, k: number, f: number): void => {
    positions.push(p.x, p.y, p.z); colors.push(c.r * k, c.g * k, c.b * k); flow.push(f);
  };

  // The summit: where the crystals broke out.
  let crown = tris[0]![0];
  for (const t of tris) for (const v of t) if (v.y > crown.y) crown = v;
  crown = crown.clone();

  interface Seg { p: Vector3; q: Vector3; normal: Vector3; side: Vector3 }
  const ab = new Vector3(), ac = new Vector3();
  /** The stone cut by a wandering vertical plane through `origin`, one side only. */
  const cut = (origin: Vector3, az: number, phase: number): Seg[] => {
    const n = new Vector3(Math.cos(az), 0, Math.sin(az));
    const downhill = new Vector3(-Math.sin(az), 0, Math.cos(az));
    const d0 = origin.dot(n);
    const dist = (v: Vector3): number => {
      const along = v.clone().sub(origin).dot(downhill);
      return v.dot(n) - d0 + Math.sin(along * 5.5 + phase) * 0.09 * Math.min(1, along * 3) + Math.sin(along * 12 + phase * 2) * 0.03;
    };
    const out: Seg[] = [];
    for (const [a, b, c] of tris) {
      const da = dist(a), db = dist(b), dc = dist(c);
      const hits: Vector3[] = [];
      for (const [u, v, du, dv] of [[a, b, da, db], [b, c, db, dc], [c, a, dc, da]] as const) {
        if ((du < 0) !== (dv < 0)) hits.push(u.clone().lerp(v, du / (du - dv)));
      }
      if (hits.length !== 2) continue;
      const [p, q] = hits as [Vector3, Vector3];
      const mid = p.clone().add(q).multiplyScalar(0.5);
      if (mid.y < -0.3 || p.distanceToSquared(q) < 1e-6) continue; // nothing glows underground
      if (mid.clone().sub(origin).dot(downhill) < -0.02) continue; // this side of the summit only
      const normal = new Vector3().crossVectors(ab.subVectors(b, a), ac.subVectors(c, a)).normalize();
      if (normal.y < -0.2) continue; // never on the underside
      out.push({ p, q, normal, side: new Vector3().crossVectors(normal, q.clone().sub(p)).normalize() });
    }
    return out;
  };

  const lay = (segs: Seg[], origin: Vector3, reach: number, width: number, heat: number, f0: number): void => {
    for (const sg of segs) {
      let dp = sg.p.distanceTo(origin), dq = sg.q.distanceTo(origin);
      if (dp >= reach && dq >= reach) continue;
      // A segment that straddles the reach ends AT it: the channel stops where
      // its seeded length says, not at the far corner of whatever facet it
      // was crossing. (Linear along a facet-sized segment — close enough.)
      let sp = sg.p, sq = sg.q;
      if (dq >= reach) { sq = sp.clone().lerp(sq, (reach - dp) / (dq - dp)); dq = reach; }
      else if (dp >= reach) { sp = sq.clone().lerp(sp, (reach - dq) / (dp - dq)); dp = reach; }
      const fp = Math.max(0, 1 - dp / reach), fq = Math.max(0, 1 - dq / reach);
      const jag = rng.range(0.75, 1.3);
      const quad = (w: number, lift: number, c: Color, kp: number, kq: number): void => {
        // A channel pinches toward its toe but keeps a body most of the way.
        const wp = w * jag * (0.25 + 0.75 * fp ** 0.5), wq = w * jag * (0.25 + 0.75 * fq ** 0.5);
        const l = sg.normal.clone().multiplyScalar(lift);
        const p0 = sp.clone().addScaledVector(sg.side, -wp).add(l), p1 = sp.clone().addScaledVector(sg.side, wp).add(l);
        const q0 = sq.clone().addScaledVector(sg.side, -wq).add(l), q1 = sq.clone().addScaledVector(sg.side, wq).add(l);
        const a = f0 + dp, b = f0 + dq;
        put(p0, c, kp, a); put(q0, c, kq, b); put(q1, c, kq, b); put(p0, c, kp, a); put(q1, c, kq, b); put(p1, c, kp, a);
      };
      quad(width * 1.75, 0.008, bank, 1, 1); //                                   chilled banks
      quad(width, 0.014, band, heat * (0.35 + 0.65 * fp), heat * (0.35 + 0.65 * fq)); //  the molten body
      quad(width * 0.34, 0.02, core, heat * fp ** 1.4, heat * fq ** 1.4); //          the white-hot thread
    }
  };

  // Rivulets off the summit, at uneven angles and of uneven length.
  const count = 2 + Math.round(amount * 3);
  const spin = rng.next() * Math.PI * 2;
  // Width is a WORLD size: a channel on a 25-unit ridge rock is no wider than
  // one on a 9-unit boulder. Scaled with the stone, big rocks wore flat stripes
  // a fish-length across — decals, from close up.
  const width = (0.03 + amount * 0.03) * Math.min(1.3, 12 / worldPerUnit);
  for (let i = 0; i < count; i += 1) {
    const az = spin + (i / count) * Math.PI * 2 + rng.range(-0.45, 0.45);
    const reach = rng.range(0.75, 1.55) * (0.65 + amount * 0.45);
    const segs = cut(crown, az, rng.next() * 6.28);
    lay(segs, crown, reach, width * rng.range(0.8, 1.2), 1, 0);
    // A fork: a thinner stream leaving part-way down, bearing off to one side.
    if (segs.length > 3 && rng.next() < 0.35 + amount * 0.4) {
      const from = segs[Math.floor(segs.length * rng.range(0.25, 0.55))]!.p;
      const fd = from.distanceTo(crown);
      if (fd < reach * 0.7 && fd > 0.15) {
        lay(cut(from, az + rng.range(0.5, 0.95) * (rng.next() < 0.5 ? 1 : -1), rng.next() * 6.28),
          from, (reach - fd) * rng.range(0.6, 0.95), width * 0.6, 0.85 * (1 - fd / reach) + 0.15, fd);
      }
    }
  }

  // The breach: shards standing round the crown, where the stone gave way.
  const root = band.clone().lerp(new Color('#ffffff'), 0.5);
  const shards = 3 + Math.round(amount * 5);
  for (let i = 0; i < shards; i += 1) {
    const a = rng.next() * Math.PI * 2, r = rng.range(0.05, 0.3);
    const base = new Vector3(crown.x + Math.cos(a) * r, crown.y - r * 0.35 - 0.04, crown.z + Math.sin(a) * r);
    const len = rng.range(0.12, 0.3) * (1 - r);
    const tip = base.clone().add(new Vector3(Math.cos(a) * len * 0.55, len, Math.sin(a) * len * 0.55));
    const w = len * 0.24;
    const foot = [0, 1, 2].map((k) => new Vector3(base.x + Math.cos(a + k * 2.094) * w, base.y, base.z + Math.sin(a + k * 2.094) * w));
    for (let k = 0; k < 3; k += 1) { put(foot[k]!, root, 1, 0); put(tip, band, 1.15, 0); put(foot[(k + 1) % 3]!, root, 1, 0); }
  }
  return { positions, colors, flow, seep: crown };
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

export function glowGeometry(positions: number[], colors: number[], place: Matrix4, flow?: number[]): BufferGeometry | null {
  if (!positions.length) return null;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  g.setAttribute('aFlow', new BufferAttribute(new Float32Array(flow ?? new Array(positions.length / 3).fill(0)), 1));
  g.applyMatrix4(place);
  g.computeVertexNormals();
  return g;
}

/** Slow pulses of light running DOWN the channels: brightness rides a wave in
 *  `aFlow − t`, so it travels away from the source. Shallow (±18 %) and slow. */
export const FISSURE_FLOW = /* glsl */ `
  #include <color_vertex>
  vColor.rgb *= 0.86 + 0.18 * sin(aFlow * 9.0 - uFlowTime * 1.1) + 0.08 * sin(aFlow * 23.0 - uFlowTime * 2.3);
`;

export function buildRock(spec: RockSpec, rng: CrystalRng): RockParts {
  const tris = boulder(rng.fork(1), spec.rx > 16 ? 2 : 1);
  const place = new Matrix4().compose(
    new Vector3(spec.x, spec.y + spec.ry * 0.3, spec.z),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rng.next() * Math.PI * 2),
    new Vector3(spec.rx, spec.ry, spec.rz),
  );
  const cut = fissures(tris, rng.fork(2), spec.tint, spec.veins, (spec.rx + spec.ry + spec.rz) / 3);
  return {
    stone: paintStone(tris, place, rng.fork(3)),
    glow: glowGeometry(cut.positions, cut.colors, place, cut.flow),
    triangles: tris.length + cut.positions.length / 9,
    seep: cut.seep ? cut.seep.applyMatrix4(place) : null,
  };
}
