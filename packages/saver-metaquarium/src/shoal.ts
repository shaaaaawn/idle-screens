/**
 * The shoal (the Amano study): an ambient school of small voxel fish — neon
 * tetras, rummy-noses or embers — swimming as a body through the tank beside
 * the cast. Zero network, one instanced draw, and closed-form in t like
 * everything else here.
 *
 * - Formation: seats are scattered in an ellipsoid (long along the swim, flat
 *   top to bottom) and RELAXED for 90 passes at seed time under an anisotropic
 *   spacing — 1.7 body lengths nose to tail, 1.28 side to side, 1.02 top to
 *   bottom — so the school is evenly packed without a lattice's rows.
 * - Life: each fish breathes around its seat on its own slow sines, beats in
 *   burst-and-coast (fast tail and a surge, then a glide), and now and then one
 *   makes an EXCURSION — drops back, rises, slips out to the side or surges
 *   ahead for five to nine seconds — at most three at a time.
 * - Heading: from the fish's own track (its position a moment ago), so a fish
 *   on an excursion points where it is actually going.
 *
 * The Amano original integrates a boids-style sim frame by frame. Here every
 * term is a function of t (a schedule of excursions hashed per time slot, the
 * integral of the burst rhythm in closed form), so the same second looks the
 * same on every screen and after any seek.
 */

import {
  BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh,
  Frustum, Matrix4, MeshBasicMaterial, MeshStandardMaterial, Quaternion, Vector3, type Camera, type Material,
} from 'three';
import type { CrystalRng } from './crystals';

/** Along, up and side spacing between seats, in body lengths. */
export const SPACING = { along: 1.7, up: 1.02, side: 1.28 } as const;
/** Seconds per excursion slot: one may start in each. */
export const EXCURSION_SLOT = 3.5;

export type ShoalKind = 'neon' | 'rummynose' | 'ember';
export const SHOAL_KINDS: readonly ShoalKind[] = ['neon', 'rummynose', 'ember'];

/** A seat in body lengths: side (+ = the school's right), up, along (+ = ahead). */
export interface Seat { side: number; up: number; along: number }

/**
 * Seats for `n` fish, relaxed. Deterministic in the rng. The ellipsoid grows
 * with the cube root of the count so density stays about the same.
 */
export function relaxSeats(n: number, rng: CrystalRng): Seat[] {
  const g = Math.cbrt(Math.max(1, n) / 30);
  const R = { along: 3.8 * g, up: 1.6 * g, side: 2.4 * g };
  const p: Seat[] = [];
  for (let i = 0; i < n; i++) {
    let a: number, b: number, c: number;
    do { a = rng.range(-1, 1); b = rng.range(-1, 1); c = rng.range(-1, 1); } while (a * a + b * b + c * c > 1);
    p.push({ side: c * R.side, up: b * R.up, along: a * R.along });
  }
  for (let pass = 0; pass < 90; pass++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const P = p[i]!, Q = p[j]!;
        const dx = (Q.side - P.side) / SPACING.side, dy = (Q.up - P.up) / SPACING.up, dz = (Q.along - P.along) / SPACING.along;
        const d = Math.hypot(dx, dy, dz);
        if (d < 1 && d > 1e-6) {
          const f = ((1 - d) * 0.5) / d;
          P.side -= dx * f * SPACING.side; P.up -= dy * f * SPACING.up; P.along -= dz * f * SPACING.along;
          Q.side += dx * f * SPACING.side; Q.up += dy * f * SPACING.up; Q.along += dz * f * SPACING.along;
        }
      }
    }
    // Back inside the ellipsoid, gently: the school keeps its shape.
    for (const s of p) {
      const e = Math.hypot(s.side / R.side, s.up / R.up, s.along / R.along);
      if (e > 1) { const k = 1 - (1 - 1 / e) * 0.6; s.side *= k; s.up *= k; s.along *= k; }
    }
  }
  const m = p.reduce((acc, s) => ({ side: acc.side + s.side / n, up: acc.up + s.up / n, along: acc.along + s.along / n }), { side: 0, up: 0, along: 0 });
  return p.map((s) => ({ side: s.side - m.side, up: s.up - m.up, along: s.along - m.along }));
}

/** Smallest anisotropic seat distance (1 = exactly the spacing). */
export function seatSpacing(seats: readonly Seat[]): number {
  let min = Infinity;
  for (let i = 0; i < seats.length; i++) for (let j = i + 1; j < seats.length; j++) {
    const P = seats[i]!, Q = seats[j]!;
    min = Math.min(min, Math.hypot((Q.side - P.side) / SPACING.side, (Q.up - P.up) / SPACING.up, (Q.along - P.along) / SPACING.along));
  }
  return min;
}

const hash = (n: number): number => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const ease = (u: number): number => { const c = Math.min(1, Math.max(0, u)); return c * c * (3 - 2 * c); };

/** Which fish (if any) starts an excursion in slot k, and how. */
export function excursionOf(k: number, n: number, salt: number): { fish: number; t0: number; dur: number; side: number; up: number; along: number } | null {
  const h = (i: number): number => hash(k * 1.618 + salt * 17.3 + i * 91.7);
  if (h(0) < 0.2) return null;
  const fish = Math.floor(h(1) * n) % n;
  const t0 = k * EXCURSION_SLOT + h(2) * EXCURSION_SLOT * 0.5, dur = 4.5 + 4.5 * h(3);
  const kind = h(4), a = h(5), b = h(6) - 0.5, c = h(7) - 0.5, sgn = h(8) < 0.5 ? -1 : 1;
  if (kind < 0.35) return { fish, t0, dur, side: c, up: b * 0.8, along: -(1.6 + 1.2 * a) }; //   drops back
  if (kind < 0.6) return { fish, t0, dur, side: c * 1.2, up: sgn * (1.1 + 0.7 * a), along: b }; // rises or dips
  if (kind < 0.85) return { fish, t0, dur, side: sgn * (1.2 + 0.8 * a), up: b * 0.8, along: c * 1.6 }; // out to the side
  return { fish, t0, dur, side: c, up: b * 1.2, along: 1.2 + 0.8 * a }; //                          surges ahead
}

/** The sum of live excursions for fish `i` at t (body lengths), and how many fish are out. */
export function excursionAt(i: number, n: number, t: number, salt: number, out: Seat): Seat {
  out.side = 0; out.up = 0; out.along = 0;
  const k0 = Math.floor(t / EXCURSION_SLOT);
  // A slot's excursion lasts ≤ 9 s and starts ≤ 1.75 s in: four slots cover it.
  for (let k = k0; k > k0 - 4; k--) {
    const e = excursionOf(k, n, salt);
    if (!e || e.fish !== i) continue;
    const u = (t - e.t0) / e.dur;
    if (u < 0 || u > 1) continue;
    const env = ease(u / 0.22) * (1 - ease((u - 0.7) / 0.3));
    out.side += e.side * env; out.up += e.up * env; out.along += e.along * env;
  }
  return out;
}

/** How many fish are on an excursion at t (for tests and inspect). */
export function excursionsOut(n: number, t: number, salt: number): number {
  const k0 = Math.floor(t / EXCURSION_SLOT);
  let c = 0;
  for (let k = k0; k > k0 - 4; k--) {
    const e = excursionOf(k, n, salt);
    if (e && t >= e.t0 && t <= e.t0 + e.dur) c++;
  }
  return c;
}

export interface Carrier { x: number; y: number; z: number; fx: number; fz: number }
export interface FishPose { x: number; y: number; z: number; hx: number; hy: number; hz: number; phase: number; amp: number; along: number }

interface Member { seat: Seat; w: [number, number, number]; ph: [number, number, number]; burstW: number; burstPh: number; beat: number }

export interface ShoalOptions {
  count: number; kind: ShoalKind; lit: boolean; length: number;
  /** Body lengths every fish keeps above the floor it is given (default 0.8). */
  clear?: number;
}

export class Shoal {
  readonly mesh: InstancedMesh;
  readonly count: number;
  readonly length: number;
  private readonly clear: number;
  private readonly members: Member[];
  private readonly salt: number;
  private readonly swim: InstancedBufferAttribute;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly v = new Vector3();
  private readonly s = new Vector3();
  private readonly fwd = new Vector3();
  private readonly e: Seat = { side: 0, up: 0, along: 0 };
  private readonly at: Float64Array;
  private readonly before: Float64Array;
  private readonly meta: Float64Array;
  private readonly pA: FishPose = { x: 0, y: 0, z: 0, hx: 0, hy: 0, hz: 1, phase: 0, amp: 0, along: 0 };

  constructor(rng: CrystalRng, o: ShoalOptions) {
    this.count = o.count;
    this.length = o.length;
    this.clear = o.clear ?? 0.8;
    this.at = new Float64Array(o.count * 3);
    this.before = new Float64Array(o.count * 3);
    this.meta = new Float64Array(o.count * 3);
    const seats = relaxSeats(o.count, rng.fork(1));
    const r = rng.fork(2);
    this.salt = r.next() * 1000;
    this.members = seats.map((seat) => ({
      seat,
      w: [0.3 + 0.25 * r.next(), 0.3 + 0.25 * r.next(), 0.3 + 0.25 * r.next()],
      ph: [r.next() * 6.283, r.next() * 6.283, r.next() * 6.283],
      burstW: (Math.PI * 2) / (1.6 + 1.6 * r.next()),
      burstPh: r.next() * 6.283,
      beat: 0.93 + 0.14 * r.next(),
    }));
    const geometry = shoalFishGeometry(o.kind);
    const material = shoalMaterial(o.lit);
    this.mesh = new InstancedMesh(geometry, material, o.count);
    this.mesh.name = 'shoal';
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.swim = new InstancedBufferAttribute(new Float32Array(o.count * 2), 2);
    this.swim.setUsage(DynamicDrawUsage);
    geometry.setAttribute('aSwim', this.swim);
  }

  /**
   * Fish `i` at time `t`: `carrier` is the school centre and its heading at a
   * time (a pure function the tank supplies), `floor` the ground height.
   */
  poseAt(i: number, t: number, carrier: (t: number, along: number) => Carrier, floor: (x: number, z: number) => number, out: FishPose): FishPose {
    const f = this.members[i]!, L = this.length;
    excursionAt(i, this.count, t, this.salt, this.e);
    // Burst and coast: b ∈ [0,1]; its integral gives the tail-beat phase and the surge.
    const bw = f.burstW, bp = f.burstPh;
    const b = 0.5 + 0.5 * Math.sin(bw * t + bp);
    const ib = 0.5 * t - (0.5 / bw) * (Math.cos(bw * t + bp) - Math.cos(bp));
    const side = f.seat.side + 0.28 * Math.sin(f.w[0] * t + f.ph[0]) + this.e.side;
    const up = f.seat.up + 0.2 * Math.sin(f.w[1] * t + f.ph[1]) + this.e.up;
    const along = f.seat.along + 0.3 * Math.sin(f.w[2] * t + f.ph[2]) - 0.07 * Math.cos(bw * t + bp) + this.e.along;
    // Follow the leader: a fish rides the ROUTE at its own distance along it,
    // so the school bends through a turn instead of pivoting like a plank
    // (whose ends would slide sideways). Side and up are off the route there.
    const c = carrier(t, along * L);
    const hl = Math.hypot(c.fx, c.fz) || 1, fx = c.fx / hl, fz = c.fz / hl;
    // Right of the heading, on the level: (fz, -fx).
    out.x = c.x + fz * side * L;
    out.z = c.z - fx * side * L;
    out.y = Math.max(c.y + up * L, floor(out.x, out.z) + this.clear * L);
    out.along = along * L;
    out.phase = Math.PI * 2 * f.beat * (1.6 * t + 3.4 * ib);
    out.amp = 0.03 + 0.09 * b * b;
    return out;
  }

  /**
   * Every fish at t, then pushed apart: two fish closer than 0.8 body lengths
   * are separated along the line between them (three passes). It reads only
   * this instant's positions, so the result is still a pure function of t —
   * the Amano sim's collision step without its history.
   */
  private solve(t: number, carrier: (t: number, along: number) => Carrier, floor: (x: number, z: number) => number, out: Float64Array, meta?: Float64Array): void {
    const n = this.count, L = this.length, min = 0.8 * L; // separation, not clearance
    for (let i = 0; i < n; i++) {
      const a = this.poseAt(i, t, carrier, floor, this.pA);
      out[i * 3] = a.x; out[i * 3 + 1] = a.y; out[i * 3 + 2] = a.z;
      if (meta) { meta[i * 3] = a.phase; meta[i * 3 + 1] = a.amp; meta[i * 3 + 2] = a.along; }
    }
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const dx = out[j * 3]! - out[i * 3]!, dy = out[j * 3 + 1]! - out[i * 3 + 1]!, dz = out[j * 3 + 2]! - out[i * 3 + 2]!;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2);
        // Coincident: part them sideways by index, deterministically.
        const ux = d > 1e-6 ? dx / d : 1, uy = d > 1e-6 ? dy / d : 0, uz = d > 1e-6 ? dz / d : 0;
        const k = (min - d) * 0.5;
        out[i * 3] -= ux * k; out[i * 3 + 1] -= uy * k * 0.6; out[i * 3 + 2] -= uz * k;
        out[j * 3] += ux * k; out[j * 3 + 1] += uy * k * 0.6; out[j * 3 + 2] += uz * k;
      }
    }
    for (let i = 0; i < n; i++) out[i * 3 + 1] = Math.max(out[i * 3 + 1]!, floor(out[i * 3]!, out[i * 3 + 2]!) + this.clear * L);
  }

  /**
   * Heading: the route's tangent where the fish is, steered by its own
   * sideways and vertical motion, the steer capped at half the tangent (the
   * Amano sim's cap). A fish drifting back through the school still faces
   * forward — it is swimming slower, not backwards — and one slipping out to
   * the side angles toward where it is going.
   */
  private heading(i: number, t: number, at: Float64Array, before: Float64Array, along: number, carrier: (t: number, along: number) => Carrier, out: Vector3, dt: number): Vector3 {
    const c = carrier(t, along);
    const hl = Math.hypot(c.fx, c.fz) || 1, tx = c.fx / hl, tz = c.fz / hl;
    const vx = (at[i * 3]! - before[i * 3]!) / dt, vy = (at[i * 3 + 1]! - before[i * 3 + 1]!) / dt, vz = (at[i * 3 + 2]! - before[i * 3 + 2]!) / dt;
    const fwdSpeed = Math.max(3, Math.abs(vx * tx + vz * tz));
    const px = vx - (vx * tx + vz * tz) * tx, pz = vz - (vx * tx + vz * tz) * tz;
    let sx = px / fwdSpeed, sy = (vy / fwdSpeed) * 0.8, sz = pz / fwdSpeed;
    const sm = Math.hypot(sx, sy, sz);
    if (sm > 0.5) { sx *= 0.5 / sm; sy *= 0.5 / sm; sz *= 0.5 / sm; }
    return out.set(tx + sx, sy, tz + sz).normalize();
  }

  /** Where every fish is at t (after separation), as [x, y, z] per fish. */
  positions(t: number, carrier: (t: number, along: number) => Carrier, floor: (x: number, z: number) => number): Float64Array {
    const out = new Float64Array(this.count * 3);
    this.solve(t, carrier, floor, out);
    return out;
  }

  /** Write every fish for time t. */
  update(t: number, carrier: (t: number, along: number) => Carrier, floor: (x: number, z: number) => number): void {
    const L = this.length, dt = 0.15, at = this.at, before = this.before, meta = this.meta;
    this.solve(t, carrier, floor, at, meta);
    this.solve(t - dt, carrier, floor, before);
    for (let i = 0; i < this.count; i++) {
      this.heading(i, t, at, before, meta[i * 3 + 2]!, carrier, this.fwd, dt);
      this.q.setFromUnitVectors(this.v.set(0, 0, 1), this.fwd);
      this.m.compose(this.s.set(at[i * 3]!, at[i * 3 + 1]!, at[i * 3 + 2]!), this.q, this.v.set(L, L, L));
      this.mesh.setMatrixAt(i, this.m);
      this.swim.setXY(i, meta[i * 3]! % (Math.PI * 2000), meta[i * 3 + 1]!);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.swim.needsUpdate = true;
  }

  /** Analytic view for inspect(): polarisation and the closest pair, in body lengths. */
  stats(t: number, carrier: (t: number, along: number) => Carrier, floor: (x: number, z: number) => number, camera?: Camera): { count: number; out: number; nearest: number; polarisation: number; inView: number | null } {
    const a = new Float64Array(this.count * 3), b = new Float64Array(this.count * 3), meta = new Float64Array(this.count * 3);
    this.solve(t, carrier, floor, a, meta);
    this.solve(t - 0.15, carrier, floor, b);
    const h = new Vector3();
    let nearest = Infinity, hx = 0, hy = 0, hz = 0;
    for (let i = 0; i < this.count; i++) {
      for (let j = i + 1; j < this.count; j++) {
        nearest = Math.min(nearest, Math.hypot(a[i * 3]! - a[j * 3]!, a[i * 3 + 1]! - a[j * 3 + 1]!, a[i * 3 + 2]! - a[j * 3 + 2]!) / this.length);
      }
      this.heading(i, t, a, b, meta[i * 3 + 2]!, carrier, h, 0.15);
      hx += h.x; hy += h.y; hz += h.z;
    }
    // The share of the school inside the camera's frustum: whether anyone can see it.
    let inView: number | null = null;
    if (camera) {
      camera.updateMatrixWorld();
      const f = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      const p = new Vector3();
      let seen = 0;
      for (let i = 0; i < this.count; i++) if (f.containsPoint(p.set(a[i * 3]!, a[i * 3 + 1]!, a[i * 3 + 2]!))) seen++;
      inView = Math.round((seen / Math.max(1, this.count)) * 100) / 100;
    }
    return {
      count: this.count,
      inView,
      out: excursionsOut(this.count, t, this.salt),
      nearest: Math.round(nearest * 100) / 100,
      polarisation: Math.round((Math.hypot(hx, hy, hz) / Math.max(1, this.count)) * 100) / 100,
    };
  }
}

// ---------------------------------------------------------------------------
// The fish: a voxel tetra one unit long, nose +z, in slices so it can bend.
// ---------------------------------------------------------------------------

const PALETTES: Record<ShoalKind, { back: string; belly: string; stripe: string; low: string; tail: string; nose: string; glow: number }> = {
  // Paracheirodon: an electric blue line over a red rear half.
  neon: { back: '#3d5566', belly: '#dfe7ee', stripe: '#29e3ff', low: '#ff2d45', tail: '#aeb9c4', nose: '#8ea3b3', glow: 1 },
  // Rummy-nose: a silver body, a red face, a barred tail.
  rummynose: { back: '#b9c3c9', belly: '#eef2f4', stripe: '#dfe6ea', low: '#dfe6ea', tail: '#1b1f24', nose: '#ff3b30', glow: 0 },
  // Ember tetra: orange all over, brighter below.
  ember: { back: '#e8621d', belly: '#ffb070', stripe: '#ff8a3a', low: '#ff7a2a', tail: '#ff9a52', nose: '#e8621d', glow: 0.35 },
};

export function shoalFishGeometry(kind: ShoalKind): BufferGeometry {
  const pal = PALETTES[kind];
  const pos: number[] = [], col: number[] = [], glow: number[] = [];
  const c = new Color();
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, hex: string, g = 0): void => {
    c.set(hex);
    const P = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]] as const;
    const faces: [number, number, number, number, number][] = [
      [3, 2, 6, 7, 1], [0, 4, 5, 1, 0.45], [1, 5, 6, 2, 0.8], [0, 3, 7, 4, 0.8], [4, 7, 6, 5, 0.7], [0, 1, 2, 3, 0.6],
    ];
    for (const [a, b, d, e, shade] of faces) {
      for (const k of [a, b, d, a, d, e]) {
        pos.push(...P[k]!);
        col.push(c.r * shade, c.g * shade, c.b * shade);
        glow.push(g);
      }
    }
  };
  const slices = 8, half = 0.5;
  for (let k = 0; k < slices; k++) {
    const z0 = -half + (k / slices) * 0.82, z1 = -half + ((k + 1) / slices) * 0.82;
    const zc = (z0 + z1) / 2 + 0.09; // body spans −0.5 … 0.32, the head the rest
    const u = Math.abs(zc) / 0.5;
    const h = 0.06 + 0.16 * Math.pow(Math.max(0, 1 - u * u), 0.6);
    const w = 0.045 + 0.02 * (1 - u);
    const rear = k < slices / 2;
    box(-w, w, 0, h, z0, z1, pal.back); //                                  back
    box(-w, w, -h * 0.4, 0, z0, z1, rear ? pal.low : pal.belly); //           belly (red rear on a neon)
    box(-w * 1.02, w * 1.02, -h * 0.05, h * 0.3, z0, z1, pal.stripe, pal.glow); // the lateral line
  }
  box(-0.04, 0.04, -0.07, 0.09, 0.32, 0.5, pal.nose); //                     head
  box(-0.008, 0.008, -0.13, 0.13, -0.66, -0.5, pal.tail); //                 caudal fin
  box(-0.006, 0.006, 0.12, 0.2, -0.12, 0.06, pal.back); //                   dorsal fin
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setAttribute('aGlow', new BufferAttribute(new Float32Array(glow), 1));
  g.computeVertexNormals();
  g.userData.mqOwned = true;
  return g;
}

/** The body wave, in the fish's own unit space (nose +z at 0.5, tail −0.66). */
const SHOAL_VERTEX = /* glsl */ `
  #include <begin_vertex>
  {
    float s = clamp((0.5 - transformed.z) / 1.16, 0.0, 1.0);
    float env = 0.07 - 0.22 * s + 1.15 * s * s;
    transformed.x += aSwim.y * env * sin(s / 0.95 * 6.2831853 - aSwim.x);
  }
  vMqGlow = aGlow;
`;

function shoalMaterial(lit: boolean): Material {
  const mat = lit
    ? new MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.35, envMapIntensity: 1.2 })
    : new MeshBasicMaterial({ vertexColors: true });
  // Lit tetras take the water's light too (fishlight.ts).
  if (lit) mat.userData.mqFish = true;
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = 'attribute vec2 aSwim; attribute float aGlow; varying float vMqGlow;\n'
      + shader.vertexShader.replace('#include <begin_vertex>', SHOAL_VERTEX);
    // The lateral line glows (a neon's stripe is its own light, more or less).
    const glowChunk = lit ? '#include <emissivemap_fragment>' : '#include <color_fragment>';
    shader.fragmentShader = 'varying float vMqGlow;\n' + shader.fragmentShader.replace(glowChunk, `${glowChunk}
      ${lit ? 'totalEmissiveRadiance += diffuseColor.rgb * vMqGlow * 0.9;' : 'diffuseColor.rgb *= 1.0 + vMqGlow * 0.6;'}`);
  };
  mat.customProgramCacheKey = () => `mq-shoal-v1-${lit ? 'lit' : 'flat'}`;
  mat.userData.mqOwned = true;
  return mat;
}
