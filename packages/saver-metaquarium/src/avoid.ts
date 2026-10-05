/**
 * Elbow room: fish that see each other coming and make way, instead of
 * swimming through one another.
 *
 * No simulation. A position here is never carried from one frame to the
 * next — the tank's rule (same spec + seed + t ⇒ same frame) holds — so this
 * is a pure function of where every fish IS this frame and where its route
 * is taking it:
 *
 *   1. Each pair looks ahead along its current velocities for the moment of
 *      closest approach (up to HORIZON seconds), and how close that is.
 *   2. Closer than touching, and the pair parts along the line that joins
 *      them at that moment, more firmly the sooner it comes — so a dodge
 *      starts a second out and grows into the pass, then lets go as the two
 *      separate. Every term is continuous in the inputs, and the inputs are
 *      closed-form in t, so the dodge is too.
 *   3. The smaller fish gives more room; a fish on a script, on the floor or
 *      held in a formation gives little or none.
 *
 * Two relaxation passes settle a crowd (a fish pushed into a third). The
 * rate of the dodge — what turns a fish's nose into it, so it never slides
 * sideways — is the same function a moment later, by differences.
 */

/** How far ahead a pair looks for its closest approach, seconds. */
export const HORIZON = 1.6;
/** How long after the pass a dodge takes to let go, seconds. */
export const AFTER = 0.9;
/** A fish's touching radius as a fraction of its length: a long, thin body
 *  seen from any side. Two fish closer than the sum have met. */
export const TOUCH = 0.275;
/** How much room a dodge aims for, past touching. */
const MARGIN = 1.35;
/** Room is made more readily up and down than across: a fish rising over
 *  another stays on its line, which reads calmer than one swerving off it. */
const UPWARD = 1.6;
/** No fish is shoved further than this many of its own lengths. */
const CAP = 0.9;
/** How near dead centre (in touching distances) the dodge starts to fade. */
const CENTRE = 0.3;

export interface AvoidBody {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** Body length, world units. */
  len: number;
  /** 0..1: how much of a pair's dodge this one takes. 0 never moves. */
  give: number;
  /** Lowest y this body may be dodged to at a given (x, z): the seabed's clearance. Default none. */
  floorAt?: (x: number, z: number) => number;
}

export interface Crowding {
  /** Pairs closer than touching. */
  touching: number;
  /** The deepest overlap, as a fraction of the pair's touching distance (0 = none). */
  deepest: number;
  /** The worst pairs, [slot, slot, overlap 0..1], deepest first. At most three. */
  pairs: Array<[number, number, number]>;
}

const smooth = (a: number, b: number, x: number): number => {
  const k = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/**
 * One relaxation pass: add each pair's push to `out` (3 floats per body),
 * measured from positions displaced by what `out` already holds.
 */
function pass(bodies: readonly AvoidBody[], amount: number, out: Float64Array, inc: Float64Array): void {
  const n = bodies.length;
  inc.fill(0, 0, n * 3);
  for (let i = 0; i < n; i++) {
    const a = bodies[i]!;
    for (let j = i + 1; j < n; j++) {
      const b = bodies[j]!;
      const ga = a.give * b.len, gb = b.give * a.len;
      if (ga + gb <= 0) continue;
      const R = (a.len + b.len) * TOUCH * MARGIN;
      const px = b.x + out[j * 3]! - a.x - out[i * 3]!;
      const py = b.y + out[j * 3 + 1]! - a.y - out[i * 3 + 1]!;
      const pz = b.z + out[j * 3 + 2]! - a.z - out[i * 3 + 2]!;
      // Cheap reject: too far apart to meet inside the horizon.
      const vx = b.vx - a.vx, vy = b.vy - a.vy, vz = b.vz - a.vz;
      const v2 = vx * vx + vy * vy + vz * vz;
      const reach = R + Math.sqrt(v2) * HORIZON;
      const p2 = px * px + py * py + pz * pz;
      if (p2 > reach * reach) continue;
      // Closest approach, looking a horizon ahead and half one back: a pair
      // that has just passed still holds its dodge and eases off, rather
      // than springing back the moment it is behind. The softened
      // denominator keeps it continuous as a pair's relative speed falls to 0.
      const pv = px * vx + py * vy + pz * vz;
      const tca = Math.max(-AFTER, Math.min(HORIZON, -pv / (v2 + 1e-3)));
      const qx = px + vx * tca, qy = py + vy * tca, qz = pz + vz * tca;
      const dmin = Math.hypot(qx, qy, qz);
      const dnow = Math.sqrt(p2);
      if (dmin >= R && dnow >= R) continue;
      // Sooner is firmer: full at the pass, nothing at the horizon either side.
      const w = tca >= 0 ? 1 - smooth(0, HORIZON, tca) : 1 - smooth(0, AFTER, -tca);
      // Two pushes, each along its own gap, favouring up and down: the gap
      // the pair will have at its closest, for what is coming; the gap it
      // has now, for a slow pair already in each other's way whose closest
      // moment is past the horizon. The second is weightless exactly when
      // the pair is at its closest, the only time that gap can be zero.
      //
      // The first has a dead centre — nose to nose, no line to part along —
      // and any field of directions pointing away from a middle must turn
      // right round near it, where a hair's change in the routes would swing
      // the dodge with it. So that push fades in over the last of the miss.
      let ux = 0, uy = 0, uz = 0;
      const part = (gx: number, gy: number, gz: number, g: number, k: number): void => {
        if (g >= R || k <= 0) return;
        const sy = gy * UPWARD, l = Math.hypot(gx, sy, gz);
        if (l < 1e-9) return;
        // How far along that line takes the gap to touching.
        const cos = Math.max(0.35, (gx * gx + gy * sy + gz * gz) / (l * (g || 1)));
        const m = ((R - g) / cos) * k / l;
        ux += gx * m; uy += sy * m; uz += gz * m;
      };
      part(qx, qy, qz, dmin, w * Math.min(1, dmin / (R * CENTRE)));
      part(px, py, pz, dnow, 1 - w);
      if (ux === 0 && uy === 0 && uz === 0) continue;
      // The smaller fish gives more: each takes the OTHER's length as its share.
      const sa = (ga / (ga + gb)) * amount, sb = (gb / (ga + gb)) * amount;
      inc[i * 3]! -= ux * sa; inc[i * 3 + 1]! -= uy * sa; inc[i * 3 + 2]! -= uz * sa;
      inc[j * 3]! += ux * sb; inc[j * 3 + 1]! += uy * sb; inc[j * 3 + 2]! += uz * sb;
    }
  }
  for (let i = 0; i < n; i++) {
    let x = out[i * 3]! + inc[i * 3]!, y = out[i * 3 + 1]! + inc[i * 3 + 1]!, z = out[i * 3 + 2]! + inc[i * 3 + 2]!;
    const cap = bodies[i]!.len * CAP, m = Math.hypot(x, y, z);
    if (m > cap) { x *= cap / m; y *= cap / m; z *= cap / m; }
    const bi = bodies[i]!, lo = bi.floorAt?.(bi.x + x, bi.z + z);
    if (lo !== undefined && bi.y + y < lo) y = lo - bi.y;
    out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
  }
}

/**
 * How far each fish steps aside this frame, 3 floats per body into `out`.
 * `amount` 0..1 (the `fishAvoid` param) scales every push; 0 leaves `out` zero.
 */
export function avoidOffsets(bodies: readonly AvoidBody[], amount: number, out: Float64Array, scratch: Float64Array): Float64Array {
  out.fill(0, 0, bodies.length * 3);
  if (amount <= 0 || bodies.length < 2) return out;
  pass(bodies, amount, out, scratch);
  pass(bodies, amount, out, scratch);
  return out;
}

/**
 * The dodge and how fast it is changing: offsets now, and their rate (units
 * per second) from the same function `dt` later with every fish carried on
 * along its velocity. The rate is what a fish turns its nose into.
 */
export function avoidFrame(
  bodies: AvoidBody[], amount: number,
  out: Float64Array, rate: Float64Array, scratch: Float64Array, ahead: Float64Array, dt = 0.1,
): void {
  avoidOffsets(bodies, amount, out, scratch);
  rate.fill(0, 0, bodies.length * 3);
  if (amount <= 0 || bodies.length < 2) return;
  for (const b of bodies) { b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; }
  avoidOffsets(bodies, amount, ahead, scratch);
  for (const b of bodies) { b.x -= b.vx * dt; b.y -= b.vy * dt; b.z -= b.vz * dt; }
  for (let k = 0; k < bodies.length * 3; k++) rate[k] = (ahead[k]! - out[k]!) / dt;
}

/**
 * Who is touching whom, from final positions: [x, y, z, len] per slot in
 * `at`, NaN x for a slot not on screen. The pairs are slot numbers.
 */
export function crowding(at: ArrayLike<number>, slots: number): Crowding {
  let touching = 0, deepest = 0;
  const pairs: Array<[number, number, number]> = [];
  for (let i = 0; i < slots; i++) {
    const ax = at[i * 4]!;
    if (Number.isNaN(ax)) continue;
    for (let j = i + 1; j < slots; j++) {
      const bx = at[j * 4]!;
      if (Number.isNaN(bx)) continue;
      const R = (at[i * 4 + 3]! + at[j * 4 + 3]!) * TOUCH;
      const d = Math.hypot(bx - ax, at[j * 4 + 1]! - at[i * 4 + 1]!, at[j * 4 + 2]! - at[i * 4 + 2]!);
      if (d >= R) continue;
      touching++;
      const o = 1 - d / R;
      deepest = Math.max(deepest, o);
      pairs.push([i, j, o]);
    }
  }
  pairs.sort((a, b) => b[2] - a[2]);
  const worst = pairs.slice(0, 3).map(([i, j, o]): [number, number, number] => [i, j, Math.round(o * 100) / 100]);
  return { touching, deepest: Math.round(deepest * 100) / 100, pairs: worst };
}
