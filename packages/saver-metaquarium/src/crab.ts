/**
 * The crab, alive: walks sideways on its own legs, stops to forage, pinch,
 * wave and cheer, turns about, looks at you, and climbs the rocks.
 *
 * The rig and its clips come from Blender (breeds/rig/crab.py): 23 rigid
 * voxel parts and six clips — walk, idle, pinch, forage, wave, cheer. This
 * module only decides WHICH clip, WHEN, and WHERE the crab stands.
 *
 * Everything is a closed form in t, like the rest of the tank: the schedule
 * is hashed per (crab, cycle), the distance walked is the integral of a
 * stop-and-go speed profile, and every clip's time and weight is SET each
 * frame (`action.time`, then `mixer.update(0)`), never advanced by dt. Any
 * frame can be rendered on its own and comes out the same.
 *
 * A cycle: WALK for W seconds (eased in and out), then STOP for S:
 *
 *   0 ─ 0.7 s   turn to face the activity (the camera, for a wave or a cheer)
 *   0.7 s ─     the activity's clip (forage / pinch / wave / cheer, or just idle)
 *   last 1.0 s  turn to the next bout's heading — sometimes all the way round
 *
 * Feet do not slide: the walk clip's phase is distance / stride, the stride
 * measured in Blender (the rig's `mqStride`) and scaled to the world. A crab
 * walks sideways, so its front faces 90° off its travel; the side that leads
 * is drawn per bout. While it turns, the walk clip steps it round.
 */
import {
  AnimationMixer, Box3, Euler, Quaternion, Vector3,
  type AnimationAction, type AnimationClip, type Bone, type Object3D,
} from 'three';
import { swimPoseAtDistance, type SwimPlan } from './plan';
import { fishHash } from './swim';

export const CRAB_CLIPS = ['walk', 'idle', 'pinch', 'forage', 'wave', 'cheer'] as const;
export type CrabClip = (typeof CRAB_CLIPS)[number];
/** What a crab does when it stops. `look` is idle, turned to face the camera. */
export type CrabDoing = 'walk' | 'turn' | 'idle' | 'look' | 'pinch' | 'forage' | 'wave' | 'cheer';

export interface CrabRig {
  mixer: AnimationMixer;
  actions: Record<CrabClip, AnimationAction>;
  durations: Record<CrabClip, number>;
  /** Model units a planted foot travels per walk cycle. */
  stride: number;
  /** The ground point under the body's centre, in model space: what the tank stands on the floor. */
  anchor: Vector3;
  /** The template's normalising scale (model units → a unit-size fish). */
  norm: number;
}

/** Rigs a freshly cloned crab body (identity transform), or null when the
 *  model carries no crab rig — then it swims like any other breed. */
export function rigCrab(body: Object3D, clips: readonly AnimationClip[], norm: number): CrabRig | null {
  const byName = new Map(clips.map((c) => [c.name, c]));
  if (!CRAB_CLIPS.every((n) => byName.has(n))) return null;
  let stride = 0;
  let bodyBone: Bone | null = null;
  body.traverse((o) => {
    if (typeof o.userData.mqStride === 'number') stride = o.userData.mqStride;
    if ((o as Bone).isBone && o.name === 'body') bodyBone = o as Bone;
  });
  if (!(stride > 0) || !bodyBone) return null;
  body.updateMatrixWorld(true);
  const centre = (bodyBone as Bone).getWorldPosition(new Vector3());
  const feet = new Box3().setFromObject(body).min.y;
  const mixer = new AnimationMixer(body);
  const actions = {} as Record<CrabClip, AnimationAction>;
  const durations = {} as Record<CrabClip, number>;
  for (const n of CRAB_CLIPS) {
    const clip = byName.get(n)!;
    const a = mixer.clipAction(clip);
    a.play();
    a.setEffectiveWeight(0);
    actions[n] = a;
    durations[n] = clip.duration;
  }
  return { mixer, actions, durations, stride, anchor: new Vector3(centre.x, feet, centre.z), norm };
}

// ---------------------------------------------------------------------------
// The schedule
// ---------------------------------------------------------------------------

/** Seconds of easing at each end of a walking bout. */
const RAMP = 0.45;
const TURN_IN = 0.7;
const TURN_OUT = 1.0;
/** Walking speed in body lengths per second, at swimSpeed 1. */
const PACE = 0.55;

const STOPS: readonly [CrabDoing, number][] = [
  ['forage', 0.3], ['idle', 0.16], ['pinch', 0.16], ['wave', 0.15], ['cheer', 0.11], ['look', 0.12],
];

export interface CrabCycle { walk: number; stop: number; offset: number }

/** This crab's rhythm: how long it walks, how long it stops, where it starts. */
export function crabCycle(index: number): CrabCycle {
  const walk = 3.5 + 3 * fishHash(index, 701);
  // Long enough for a turn in, the longest gesture (3 s) with its fades, and a turn out.
  const stop = 5.2 + 2 * fishHash(index, 703);
  return { walk, stop, offset: fishHash(index, 707) * (walk + stop) };
}

/** What the crab does at the stop that ends bout `k`. */
export function crabStopAt(index: number, k: number): CrabDoing {
  let r = fishHash(index * 7919 + k, 709);
  // The weights sum to 1, so the walk through them always lands.
  return STOPS.find(([, w]) => (r -= w) < 0)?.[0] ?? 'idle';
}

/** Which side leads bout `k`: +1 or -1. Drawn per bout, so a stop between
 *  two bouts with different sides turns the crab all the way round. */
export function crabLead(index: number, k: number): 1 | -1 {
  return fishHash(index * 104729 + k, 711) < 0.5 ? 1 : -1;
}

const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
/** ∫₀ˣ smooth: the distance an eased start has covered (in units of ramp × speed). */
const smoothInt = (x: number): number => (x <= 0 ? 0 : x >= 1 ? x - 0.5 : x * x * x - (x * x * x * x) / 2);

/** Distance walked within one bout at `u` seconds into it, at unit speed. */
export function boutDistance(u: number, walk: number): number {
  const r = Math.min(RAMP, walk / 2);
  const w = Math.max(0, Math.min(u, walk));
  // Eased start, cruise, eased stop — the stop is the start played backwards:
  // ∫ smooth((walk-u)/r) du from walk-r to w = r·(S(1) - S((walk-w)/r)), S(1) = ½.
  const start = r * smoothInt(Math.min(w, r) / r);
  const cruise = Math.max(0, Math.min(w, walk - r) - r);
  const stop = w > walk - r ? r * (0.5 - smoothInt((walk - w) / r)) : 0;
  return start + cruise + stop;
}

/** Speed fraction (0..1) at `u` seconds into a bout. */
export function boutSpeed(u: number, walk: number): number {
  if (u < 0 || u > walk) return 0;
  const r = Math.min(RAMP, walk / 2);
  return smooth(u / r) * smooth((walk - u) / r);
}

export interface CrabMoment {
  /** Distance along its route, at unit speed (seconds of cruising). */
  walked: number;
  /** Bout index and seconds into this cycle. */
  k: number;
  u: number;
  /** 0..1, how fast it is walking right now. */
  speed: number;
  /** Seconds into the stop (negative while walking). */
  intoStop: number;
}

export function crabMoment(index: number, t: number): CrabMoment {
  const c = crabCycle(index);
  const P = c.walk + c.stop;
  const tau = t + c.offset;
  const k = Math.floor(tau / P);
  const u = tau - k * P;
  const perBout = boutDistance(c.walk, c.walk);
  const walked = k * perBout + boutDistance(u, c.walk);
  const speed = boutSpeed(u, c.walk);
  return { walked, k, u, speed, intoStop: u - c.walk };
}

// ---------------------------------------------------------------------------
// The frame
// ---------------------------------------------------------------------------

export interface CrabInput {
  t: number;
  index: number;
  plan: SwimPlan;
  /** Where along the plan this crab's route starts (crabStart). */
  start: number;
  /** Body length in world units. */
  len: number;
  /** swimSpeed: scales the walking, not the gestures. */
  speed: number;
  /** World units per model unit. */
  scale: number;
  /** Walkable height (terrain, stone, mound): never -Infinity. */
  ground: (x: number, z: number) => number;
  camX: number;
  camZ: number;
  /** Every crab's own spot this frame (crabSpot), as (index, x, z) triples:
   *  this one steps aside rather than climbing through the others. */
  others?: readonly number[];
}

export interface CrabOutput {
  x: number; y: number; z: number;
  quaternion: Quaternion;
  /** Unit facing (the crab's front), for the follow camera and the eyes. */
  fx: number; fz: number;
  doing: CrabDoing;
}

const wrap = (a: number): number => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;
const euler = new Euler(0, 0, 0, 'YXZ');

/** Places the crab and sets its clips for time `t`. Pure in its input. */
/** Where along its route a crab starts: spread by index, so a cast of crabs
 *  does not set out from one spot. */
export function crabStart(plan: SwimPlan, index: number): number {
  return fishHash(index, 719) * plan.totalLength;
}

/** Where a crab's route puts it at `t`, before it minds the others. */
export function crabSpot(index: number, t: number, plan: SwimPlan, start: number, len: number, speed: number): { x: number; z: number; fx: number; fz: number } {
  const pose = swimPoseAtDistance(plan, start + crabMoment(index, t).walked * PACE * len * speed);
  return { x: pose.x, z: pose.z, fx: pose.fx, fz: pose.fz };
}

/** Two crabs closer than this many body lengths (centre to centre) ease apart. */
const ROOM = 1.15;

export function crabFrame(rig: CrabRig, inp: CrabInput, out: CrabOutput): CrabOutput {
  const { index, t, len } = inp;
  const c = crabCycle(index);
  const m = crabMoment(index, t);
  const pace = PACE * len * inp.speed;
  const pose = crabSpot(index, t, inp.plan, inp.start, len, inp.speed);
  let x = pose.x, z = pose.z;
  // Elbow room: each pair splits the overlap, so both step aside by half.
  // Pure in t — the others' spots are their own closed forms.
  const o = inp.others ?? [];
  const room = ROOM * len;
  for (let i = 0; i + 2 < o.length; i += 3) {
    if (o[i] === index) continue;
    const dx = pose.x - o[i + 1]!, dz = pose.z - o[i + 2]!;
    const dist = Math.hypot(dx, dz);
    if (dist >= room) continue;
    // Exactly on top of each other: part along the index, not along nothing.
    const ux = dist > 1e-6 ? dx / dist : Math.cos(index), uz = dist > 1e-6 ? dz / dist : Math.sin(index);
    const k = (room - dist) * 0.5 * smooth((room - dist) / (room * 0.35));
    x += ux * k; z += uz * k;
  }
  const travel = Math.atan2(pose.fx, pose.fz);

  // Facing. Walking: square to the travel, the bout's lead side ahead.
  const lead = crabLead(index, m.k);
  const walkYaw = travel + (lead * Math.PI) / 2;
  let yaw = walkYaw;
  let doing: CrabDoing = 'walk';
  let turned = 0;   // radians turned so far in this stop, eased: what the legs step through
  let turning = 0;  // 0..1: how hard the legs work at it right now
  let gesture: CrabClip | null = null;
  if (m.intoStop >= 0) {
    const did = crabStopAt(index, m.k);
    const faceCam = did === 'wave' || did === 'cheer' || did === 'look';
    const faceYaw = faceCam ? Math.atan2(inp.camX - x, inp.camZ - z) : walkYaw;
    const nextYaw = travel + (crabLead(index, m.k + 1) * Math.PI) / 2;
    const dIn = wrap(faceYaw - walkYaw);
    // Turning round (a lead swap, not facing anything): always the same way,
    // so a 180° never dithers between left and right.
    let dOut = wrap(nextYaw - faceYaw);
    if (Math.abs(Math.abs(dOut) - Math.PI) < 1e-3) dOut = Math.PI;
    const a = m.intoStop / TURN_IN, b = (m.intoStop - (c.stop - TURN_OUT)) / TURN_OUT;
    yaw = walkYaw + dIn * smooth(a) + dOut * smooth(b);
    turned = Math.abs(dIn) * smooth(a) + Math.abs(dOut) * smooth(b);
    const effort = (delta: number, x: number): number => Math.sin(Math.PI * Math.min(1, Math.max(0, x))) * Math.min(1, Math.abs(delta) / 0.4);
    turning = a < 1 ? effort(dIn, a) : b > 0 ? effort(dOut, b) : 0;
    doing = (a < 1 && Math.abs(dIn) > 0.05) || (b > 0 && Math.abs(dOut) > 0.05) ? 'turn' : did;
    if (did === 'pinch' || did === 'forage' || did === 'wave' || did === 'cheer') gesture = did;
  }
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  // The crab's own +X (the walk clip walks toward it) is up × front.
  const rx = fz, rz = -fx;

  // Standing on the ground: the footprint's highest reading, so a rock's rim
  // never swallows the crab; the tilt follows the slope, within reason.
  const g = inp.ground;
  const lf = len * 0.3, ls = len * 0.42;
  const hc = g(x, z);
  const hf = g(x + fx * lf, z + fz * lf), hb = g(x - fx * lf, z - fz * lf);
  const hr = g(x + rx * ls, z + rz * ls), hl = g(x - rx * ls, z - rz * ls);
  const y = Math.max(hc, (hf + hb) / 2, (hr + hl) / 2);
  const lim = 0.7; // ~40°: a crab clings to a steep flank; past that it would be climbing a wall
  const pitch = Math.max(-lim, Math.min(lim, Math.atan2(hf - hb, 2 * lf)));
  const roll = Math.max(-lim, Math.min(lim, Math.atan2(hr - hl, 2 * ls)));
  euler.set(-pitch, yaw, roll);
  out.quaternion.setFromEuler(euler);
  out.x = x; out.y = y; out.z = z; out.fx = fx; out.fz = fz;
  out.doing = doing;

  // Clips. Gait phase from distance (no sliding), signed by which way the
  // crab's +X points along its travel (lead -1: +X is the travel); a turn
  // steps the legs round a circle a third of a body across.
  const D = rig.durations;
  const strideW = rig.stride * inp.scale;
  const stepped = m.walked * pace * -lead + turned * len * 0.3;
  const walkW = Math.max(m.speed, turning);
  let actT = 0, actW = 0;
  if (gesture) {
    const into = m.intoStop - TURN_IN;
    actT = Math.max(0, Math.min(D[gesture], into));
    actW = smooth(into / 0.25) * smooth((D[gesture] + 0.3 - into) / 0.3);
  }
  setAction(rig, 'walk', posMod((stepped / strideW) * D.walk, D.walk), walkW);
  for (const n of GESTURES) setAction(rig, n, n === gesture ? actT : 0, n === gesture ? actW : 0);
  setAction(rig, 'idle', posMod(t + fishHash(index, 713) * D.idle, D.idle), Math.max(0, 1 - walkW - actW));
  rig.mixer.update(0);
  return out;
}

const GESTURES = ['pinch', 'forage', 'wave', 'cheer'] as const;

const posMod = (v: number, m: number): number => ((v % m) + m) % m;

function setAction(rig: CrabRig, name: CrabClip, time: number, weight: number): void {
  const a = rig.actions[name];
  a.time = time;
  a.setEffectiveWeight(weight);
}

/** A crab the tank is placing itself (a vignette's actor): idle on the spot. */
export function crabIdle(rig: CrabRig, t: number, index: number): void {
  const D = rig.durations;
  setAction(rig, 'walk', 0, 0);
  for (const n of GESTURES) setAction(rig, n, 0, 0);
  setAction(rig, 'idle', posMod(t + fishHash(index, 713) * D.idle, D.idle), 1);
  rig.mixer.update(0);
}
