/**
 * Rocks the crystals have burst out of — why the crystals are here at all.
 *
 * A crystal standing on a plane is an ornament. A crystal breaking out of a
 * boulder is geology: the mineral grew inside the stone until the stone gave,
 * and what shows is where it made it through.
 *
 * So the crystal is not drawn on the rock. The crown is HEAVED into a pit
 * (the stone pushed down and apart where the growth broke through), a few
 * angular chips of that stone lie tumbled round the rim, short dark fractures
 * run a little way down the flanks from the breach, and the host plants a
 * REAL crystal colony in the pit — `growCluster` shards, the same geometry,
 * material, pulse, fog and halo as every `propMix` crystal, roots sunk below
 * the stone. Only the fractures' throats glow, and only near the breach: the
 * light is in the crystal, not painted on the rock.
 *
 * Fourth attempt, and what the first three taught: a bright tube right round
 * the stone was neon wire; a thin dark split was honest but dead; lava
 * rivulets running the whole flank read from a low camera as a spider's legs
 * over the rock, and the flat three-triangle "shards" at the crown were a
 * different species from the real crystals beside them.
 *
 * Works on any triangle soup (boulders, the arch, a ridge), is fully seeded,
 * and costs nothing per frame: stone and chips land in the stone batch, the
 * fracture throats in the glow batch, the colony in the rock crystal field.
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
  /** 0..1 — how hard the crystal broke through: pit depth, chips, fractures. */
  veins: number;
  /** A host rock: a `propMix` cluster already stands at its centre, so the
   *  breach is dug under THAT and the rock grows no colony of its own. */
  host?: boolean;
}

/** Where a rock's own colony roots, in world space: sunk below the pit floor,
 *  growing along `normal`. `size` is a world length for the colony. */
export interface RockCrystal { x: number; y: number; z: number; normal: Vector3; size: number }

export interface RockParts {
  stone: BufferGeometry;
  /** Null when `veins` is 0. */
  glow: BufferGeometry | null;
  triangles: number;
  /** The breach — a bubble vent, if the world wants one. */
  seep: Vector3 | null;
  /** Null for a host rock, or when `veins` is 0. */
  crystal: RockCrystal | null;
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
 * The breach: where the crystal broke through, in the stone's unit space.
 *
 * `site` is the crown (the highest point), or, for a host rock, the top of
 * its centre line, where the host's cluster already stands. Every vertex of
 * the upper half within `R` of the site in plan is pushed DOWN by a bowl
 * profile (a pit the colony stands in), the ring just outside is lifted a
 * little (the heaved rim), and 3–7 angular chips of the same stone are laid
 * on the rim, tipped as if thrown off. The displacement is a pure function
 * of position, so a vertex shared by several triangles moves once and the
 * stone stays closed.
 */
export interface Breach { tris: Tri[]; chips: Tri[]; site: Vector3; floor: number; normal: Vector3 }

export function breach(tris: readonly Tri[], rng: CrystalRng, amount: number, opts: { centre?: boolean; pit?: number } = {}): Breach {
  let top = tris[0]![0];
  for (const t of tris) for (const v of t) if (v.y > top.y) top = v;
  let site = top.clone();
  if (opts.centre) {
    // The host's cluster stands on the centre line: dig there, at the height
    // the stone reaches near it.
    let y = -Infinity;
    for (const t of tris) for (const v of t) if (Math.hypot(v.x, v.z) < 0.45 && v.y > y) y = v.y;
    site = new Vector3(0, Number.isFinite(y) ? y : top.y, 0);
  }
  const R = 0.42 + 0.12 * amount;
  const pit = (opts.pit ?? 0.34) * (0.55 + 0.45 * amount);
  const rim = pit * 0.22;
  const heave = (v: Vector3): Vector3 => {
    const out = v.clone();
    if (v.y <= site.y - 0.9) return out; // the upper crown only: the base stays where it sits
    const d = Math.hypot(v.x - site.x, v.z - site.z) / R;
    if (d < 1) out.y -= pit * (1 - d * d);
    else if (d < 1.6) out.y += rim * (1 - Math.abs(d - 1.3) / 0.3) * (d < 1.3 ? (d - 1) / 0.3 : 1);
    return out;
  };
  const heaved: Tri[] = tris.map(([a, b, c]) => [heave(a), heave(b), heave(c)]);

  // The colony grows along the crown's own lean, pulled mostly upright.
  const normal = new Vector3();
  const ab = new Vector3(), ac = new Vector3(), n = new Vector3();
  for (const [a, b, c] of tris) {
    const mx = (a.x + b.x + c.x) / 3, mz = (a.z + b.z + c.z) / 3;
    if (Math.hypot(mx - site.x, mz - site.z) > R * 1.4) continue;
    n.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
    if (n.y > 0) normal.add(n.normalize());
  }
  if (normal.lengthSq() < 1e-6) normal.set(0, 1, 0);
  normal.normalize().lerp(new Vector3(0, 1, 0), 0.55).normalize();

  // Height of the heaved stone under (x, z), from the top: where a chip rests.
  const surfaceAt = (x: number, z: number): number => {
    let best = -Infinity;
    for (const [a, b, c] of heaved) {
      const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      if (Math.abs(d) < 1e-9) continue;
      const w1 = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / d;
      const w2 = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / d;
      const w3 = 1 - w1 - w2;
      if (w1 < -1e-6 || w2 < -1e-6 || w3 < -1e-6) continue;
      best = Math.max(best, w1 * a.y + w2 * b.y + w3 * c.y);
    }
    return best;
  };

  // Chips: octahedra of the same stone, jittered, tipped, half-sunk on the rim.
  const chips: Tri[] = [];
  const count = 3 + Math.round(amount * 4);
  const q = new Quaternion(), e = new Vector3();
  const octa = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;
  const faces = [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]] as const;
  for (let i = 0; i < count; i += 1) {
    const a = rng.next() * Math.PI * 2, r = R * rng.range(0.85, 1.45);
    const x = site.x + Math.cos(a) * r, z = site.z + Math.sin(a) * r;
    const y = surfaceAt(x, z);
    if (!Number.isFinite(y)) continue;
    const size = rng.range(0.06, 0.13) * (0.7 + 0.5 * amount);
    q.setFromAxisAngle(e.set(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).normalize(), rng.next() * Math.PI);
    const verts = octa.map(([ox, oy, oz]) => new Vector3(ox * rng.range(0.7, 1.3), oy * rng.range(0.5, 1), oz * rng.range(0.7, 1.3))
      .multiplyScalar(size).applyQuaternion(q).add(new Vector3(x, y + size * 0.25, z)));
    for (const [i0, i1, i2] of faces) chips.push([verts[i0]!.clone(), verts[i1]!.clone(), verts[i2]!.clone()]);
  }
  return { tris: heaved, chips, site, floor: site.y - pit, normal };
}

/**
 * Short dark fractures running a little way down the flanks from the breach.
 * The stone cut by a wandering vertical plane through `origin` (one side
 * only), so every segment lies on a facet and bends at its edges; each is a
 * dark split with a glowing throat that is brightest at the breach and gone
 * within the first half of its length. Returns loose coloured triangles plus
 * a per-vertex `flow` (distance from the breach) for the shader's slow pulse.
 */
export function fissures(
  tris: readonly Tri[], rng: CrystalRng, tint: string, amount: number, worldPerUnit = 12, origin?: Vector3,
): { positions: number[]; colors: number[]; flow: number[]; seep: Vector3 | null } {
  const positions: number[] = [], colors: number[] = [], flow: number[] = [];
  // Nothing to cut: no stone, no crown — and no seep for the vents to use.
  if (amount <= 0 || !tris.length) return { positions, colors, flow, seep: null };
  // Only the throat glows, a dimmed tint, and only right at the breach.
  const band = new Color(tint).multiplyScalar(0.62);
  const bank = new Color('#04060a');
  const put = (p: Vector3, c: Color, k: number, f: number): void => {
    positions.push(p.x, p.y, p.z); colors.push(c.r * k, c.g * k, c.b * k); flow.push(f);
  };

  // The breach, or failing that the summit.
  let crown = tris[0]![0];
  for (const t of tris) for (const v of t) if (v.y > crown.y) crown = v;
  crown = origin ? origin.clone() : crown.clone();

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
      quad(width * 1.6, 0.008, bank, 1, 1); //                                    the split
      quad(width * 0.6, 0.014, band, heat * fp ** 3, heat * fq ** 3); //             a throat of colour, only at the breach
    }
  };

  // Fractures radiating off the breach, at uneven angles and lengths — short
  // and dark: they say the stone split, not that light runs down it. A long
  // one under a colony reads as a stalk.
  const count = 3 + Math.round(amount * 2);
  const spin = rng.next() * Math.PI * 2;
  // Width is a WORLD size: a channel on a 25-unit ridge rock is no wider than
  // one on a 9-unit boulder. Scaled with the stone, big rocks wore flat stripes
  // a fish-length across — decals, from close up.
  const width = (0.022 + amount * 0.018) * Math.min(1.3, 12 / worldPerUnit);
  for (let i = 0; i < count; i += 1) {
    const az = spin + (i / count) * Math.PI * 2 + rng.range(-0.45, 0.45);
    const reach = rng.range(0.22, 0.45) * (0.6 + amount * 0.4);
    const segs = cut(crown, az, rng.next() * 6.28);
    lay(segs, crown, reach, width * rng.range(0.8, 1.2), 1, 0);
    // A fork: a thinner stream leaving part-way down, bearing off to one side.
    if (segs.length > 3 && rng.next() < 0.1 * amount) {
      const from = segs[Math.floor(segs.length * rng.range(0.25, 0.55))]!.p;
      const fd = from.distanceTo(crown);
      if (fd < reach * 0.7 && fd > 0.15) {
        lay(cut(from, az + rng.range(0.5, 0.95) * (rng.next() < 0.5 ? 1 : -1), rng.next() * 6.28),
          from, (reach - fd) * rng.range(0.6, 0.95), width * 0.6, 0.85 * (1 - fd / reach) + 0.15, fd);
      }
    }
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
  const raw = boulder(rng.fork(1), spec.rx > 16 ? 2 : 1);
  const place = new Matrix4().compose(
    new Vector3(spec.x, spec.y + spec.ry * 0.3, spec.z),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rng.next() * Math.PI * 2),
    new Vector3(spec.rx, spec.ry, spec.rz),
  );
  if (spec.veins <= 0) {
    return { stone: paintStone(raw, place, rng.fork(3)), glow: null, triangles: raw.length, seep: null, crystal: null };
  }
  const br = breach(raw, rng.fork(4), spec.veins, { centre: spec.host });
  // Fractures run from the pit floor (the site itself is the old crown, now air).
  const cut = fissures(br.tris, rng.fork(2), spec.tint, spec.veins, (spec.rx + spec.ry + spec.rz) / 3, br.site.clone().setY(br.floor));
  const stoneTris = [...br.tris, ...br.chips];
  const seep = br.site.clone().setY(br.floor).applyMatrix4(place);
  let crystal: RockCrystal | null = null;
  if (!spec.host) {
    // Roots below the pit floor, so the colony comes OUT of the stone.
    const root = br.site.clone().setY(br.floor - 0.12).applyMatrix4(place);
    // A normal through a non-uniform scale: the inverse-transpose, i.e. divide
    // by the scale, then rotate.
    const rot = new Quaternion(); place.decompose(new Vector3(), rot, new Vector3());
    const normal = new Vector3(br.normal.x / spec.rx, br.normal.y / spec.ry, br.normal.z / spec.rz).applyQuaternion(rot).normalize();
    crystal = { x: root.x, y: root.y, z: root.z, normal, size: spec.ry * (1.15 + 0.7 * spec.veins) };
  }
  return {
    stone: paintStone(stoneTris, place, rng.fork(3)),
    glow: glowGeometry(cut.positions, cut.colors, place, cut.flow),
    triangles: stoneTris.length + cut.positions.length / 9,
    seep,
    crystal,
  };
}
