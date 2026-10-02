/**
 * The starfish, alive: it crawls the floor and over the rocks, a ripple
 * running round its arms, and when it stops it looks about, curls up in a
 * hug, waves at you, or stands up on two arms — a five-pointed star, face to
 * you — and flops back down.
 *
 * The model is drawn in our designer's style (breeds/rig/starfish-model.mjs)
 * and rigged in Blender (breeds/rig/starfish.py): the disc and its face, two
 * eyes, five arms of three rigid links each; clips crawl, idle, wave, stand,
 * curl. This module decides WHICH clip, WHEN, and WHERE it is — the crab's
 * way (crab.ts): a closed form in t, its schedule hashed per (starfish,
 * cycle), its place the integral of a stop-and-go pace along its own route,
 * every clip's time and weight SET each frame, then `mixer.update(0)`.
 *
 * A cycle: CRAWL for W seconds (eased in and out), then STOP for S:
 *
 *   0 ─ 0.9 s   turn to face the activity (the camera, for a wave, a stand or a look)
 *   0.9 s ─     the activity's clip (curl / wave / stand, or just idle)
 *   last 1.2 s  turn back to its route
 *
 * It crawls face first, unlike the crab. Its arms have no feet to plant, but
 * the crawl's ripple still runs on distance (the rig's `mqStride`), so a
 * slower starfish ripples slower and a stopped one is still.
 */
import {
  AnimationMixer, Box3, Euler, Quaternion, Vector3,
  type AnimationAction, type AnimationClip, type Bone, type Object3D,
} from 'three';
import { boutDistance, boutSpeed, type CrabInput } from './crab';
import { swimPoseAtDistance, type SwimPlan } from './plan';
import { fishHash } from './swim';

export const STARFISH_CLIPS = ['crawl', 'idle', 'wave', 'stand', 'curl'] as const;
export type StarfishClip = (typeof STARFISH_CLIPS)[number];
/** What a starfish does when it stops. `look` is idle, turned to face the camera. */
export type StarfishDoing = 'crawl' | 'turn' | 'idle' | 'look' | 'wave' | 'stand' | 'curl';

export interface StarfishRig {
  mixer: AnimationMixer;
  actions: Record<StarfishClip, AnimationAction>;
  durations: Record<StarfishClip, number>;
  /** Model units crawled per crawl cycle. */
  stride: number;
  /** The ground point under the disc's centre, in model space: what the tank stands on the floor. */
  anchor: Vector3;
  /** The template's normalising scale (model units → a unit-size fish). */
  norm: number;
}

/** Rigs a freshly cloned starfish body (identity transform), or null when the
 *  model carries no starfish rig — then it swims like any other breed. */
export function rigStarfish(body: Object3D, clips: readonly AnimationClip[], norm: number): StarfishRig | null {
  const byName = new Map(clips.map((c) => [c.name, c]));
  if (!STARFISH_CLIPS.every((n) => byName.has(n))) return null;
  let stride = 0;
  let disc: Bone | null = null;
  body.traverse((o) => {
    if (typeof o.userData.mqStride === 'number') stride = o.userData.mqStride;
    if ((o as Bone).isBone && o.name === 'body') disc = o as Bone;
  });
  if (!(stride > 0) || !disc) return null;
  body.updateMatrixWorld(true);
  const centre = (disc as Bone).getWorldPosition(new Vector3());
  const floor = new Box3().setFromObject(body).min.y;
  const mixer = new AnimationMixer(body);
  const actions = {} as Record<StarfishClip, AnimationAction>;
  const durations = {} as Record<StarfishClip, number>;
  for (const n of STARFISH_CLIPS) {
    const a = mixer.clipAction(byName.get(n)!);
    a.play();
    a.setEffectiveWeight(0);
    actions[n] = a;
    durations[n] = byName.get(n)!.duration;
  }
  return { mixer, actions, durations, stride, anchor: new Vector3(centre.x, floor, centre.z), norm };
}

// ---------------------------------------------------------------------------
// The schedule
// ---------------------------------------------------------------------------

const TURN_IN = 0.9;
const TURN_OUT = 1.2;
/** Crawling speed in world units per second: about a third of its span, a
 *  little over half the crab's. Its own pace, like the crab's (crab.ts says why). */
export const STARFISH_PACE = 0.3 * 16.2;

const STOPS: readonly [StarfishDoing, number][] = [
  ['idle', 0.22], ['look', 0.14], ['wave', 0.22], ['stand', 0.22], ['curl', 0.2],
];

export interface StarfishCycle { crawl: number; stop: number; offset: number }

export function starfishCycle(index: number): StarfishCycle {
  const crawl = 4 + 4 * fishHash(index, 1301);
  // A turn in, the longest gesture (the 4.6 s stand) with its fades, and a turn out.
  const stop = 7.2 + 2 * fishHash(index, 1303);
  return { crawl, stop, offset: fishHash(index, 1307) * (crawl + stop) };
}

/** What the starfish does at the stop that ends bout `k`. */
export function starfishStopAt(index: number, k: number): StarfishDoing {
  let r = fishHash(index * 7919 + k, 1309);
  return STOPS.find(([, w]) => (r -= w) < 0)?.[0] ?? 'idle';
}

export interface StarfishMoment {
  /** Distance along its route at unit speed. */
  crawled: number;
  k: number;
  u: number;
  speed: number;
  /** Seconds into the stop (negative while crawling). */
  intoStop: number;
}

export function starfishMoment(index: number, t: number): StarfishMoment {
  const c = starfishCycle(index);
  const P = c.crawl + c.stop;
  const tau = t + c.offset;
  const k = Math.floor(tau / P);
  const u = tau - k * P;
  const crawled = k * boutDistance(c.crawl, c.crawl) + boutDistance(u, c.crawl);
  return { crawled, k, u, speed: boutSpeed(u, c.crawl), intoStop: u - c.crawl };
}

/** Where along the plan a starfish's route starts: spread by index. */
export function starfishStart(plan: SwimPlan, index: number): number {
  return fishHash(index, 1311) * plan.totalLength;
}

/** Where its route puts it at `t`, before it minds the others; `back` units further back for a trail. */
export function starfishSpot(index: number, t: number, plan: SwimPlan, start: number, back = 0): { x: number; z: number; fx: number; fz: number } {
  const pose = swimPoseAtDistance(plan, start + starfishMoment(index, t).crawled * STARFISH_PACE - back);
  const l = Math.hypot(pose.fx, pose.fz) || 1;
  return { x: pose.x, z: pose.z, fx: pose.fx / l, fz: pose.fz / l };
}

// ---------------------------------------------------------------------------
// The frame
// ---------------------------------------------------------------------------

export interface StarfishOutput {
  x: number; y: number; z: number;
  quaternion: Quaternion;
  /** Unit facing (its face's side). */
  fx: number; fz: number;
  /** Unit travel along its route, and where the route had it two lengths ago. */
  tx: number; tz: number;
  trailX: number; trailZ: number;
  doing: StarfishDoing;
  /** How much glow it throws (StarfishRig bloom): low while it lies on the floor, flaring as it stands up. */
  bloom: number;
}

const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const wrap = (a: number): number => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;
const posMod = (v: number, m: number): number => ((v % m) + m) % m;
const euler = new Euler(0, 0, 0, 'YXZ');
/** Closer than this many body lengths (centre to centre), two floor creatures ease apart. */
const ROOM = 1.1;
const GESTURES = ['wave', 'stand', 'curl'] as const;
/** The share of its glow a starfish throws while it lies down (see `bloom`). */
export const STARFISH_BLOOM = 0.2;
/** …and at the top of a stand: brighter, still not a lamp. */
export const STARFISH_STAND_BLOOM = 0.55;

/** Places the starfish and sets its clips for time `t`. Pure in its input;
 *  the input is the crab's (`others` holds crabs and starfish alike). */
export function starfishFrame(rig: StarfishRig, inp: CrabInput, out: StarfishOutput): StarfishOutput {
  const { index, t, len } = inp;
  const c = starfishCycle(index);
  const m = starfishMoment(index, t);
  const pose = starfishSpot(index, t, inp.plan, inp.start);
  let x = pose.x, z = pose.z;
  const o = inp.others ?? [];
  const room = ROOM * len;
  for (let i = 0; i + 2 < o.length; i += 3) {
    if (o[i] === index) continue;
    const dx = pose.x - o[i + 1]!, dz = pose.z - o[i + 2]!;
    const dist = Math.hypot(dx, dz);
    if (dist >= room) continue;
    const ux = dist > 1e-6 ? dx / dist : Math.cos(index), uz = dist > 1e-6 ? dz / dist : Math.sin(index);
    const k = (room - dist) * 0.5 * smooth((room - dist) / (room * 0.35));
    x += ux * k; z += uz * k;
  }
  const travel = Math.atan2(pose.fx, pose.fz);

  let yaw = travel;
  let doing: StarfishDoing = 'crawl';
  let turned = 0, turning = 0;
  let gesture: (typeof GESTURES)[number] | null = null;
  if (m.intoStop >= 0) {
    const did = starfishStopAt(index, m.k);
    const faceCam = (did === 'wave' || did === 'stand' || did === 'look') && Number.isFinite(inp.camX);
    const faceYaw = faceCam ? Math.atan2(inp.camX - x, inp.camZ - z) : travel;
    const dIn = wrap(faceYaw - travel);
    const a = m.intoStop / TURN_IN, b = (m.intoStop - (c.stop - TURN_OUT)) / TURN_OUT;
    // Back the way it turned, so the stop ends facing its route again.
    yaw = travel + dIn * smooth(a) * (1 - smooth(b));
    turned = Math.abs(dIn) * (smooth(a) + smooth(b));
    const effort = (x: number): number => Math.sin(Math.PI * Math.min(1, Math.max(0, x))) * Math.min(1, Math.abs(dIn) / 0.4);
    turning = a < 1 ? effort(a) : b > 0 ? effort(b) : 0;
    doing = Math.abs(dIn) > 0.05 && (a < 1 || b > 0) ? 'turn' : did;
    if (did === 'wave' || did === 'stand' || did === 'curl') gesture = did;
  }
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const rx = fz, rz = -fx;

  // Lying on the ground: the footprint's highest reading, tilted to the slope.
  const g = inp.ground;
  const r = len * 0.38;
  const hc = g(x, z);
  const hf = g(x + fx * r, z + fz * r), hb = g(x - fx * r, z - fz * r);
  const hr = g(x + rx * r, z + rz * r), hl = g(x - rx * r, z - rz * r);
  const y = Math.max(hc, (hf + hb) / 2, (hr + hl) / 2);
  const lim = 0.75; // a starfish clings to steeper rock than a crab
  const pitch = Math.max(-lim, Math.min(lim, Math.atan2(hf - hb, 2 * r)));
  const roll = Math.max(-lim, Math.min(lim, Math.atan2(hr - hl, 2 * r)));
  euler.set(-pitch, yaw, roll);
  out.quaternion.setFromEuler(euler);
  out.x = x; out.y = y; out.z = z; out.fx = fx; out.fz = fz;
  out.tx = pose.fx; out.tz = pose.fz;
  const trail = starfishSpot(index, t, inp.plan, inp.start, len * 2);
  out.trailX = trail.x + (x - pose.x); out.trailZ = trail.z + (z - pose.z);
  out.doing = doing;

  // Clips. The ripple's phase from this bout's distance (and a turn's sweep);
  // the gesture faded in after the turn and out before the turn back.
  const D = rig.durations;
  const strideW = rig.stride * inp.scale;
  const crawled = boutDistance(m.u, c.crawl) * STARFISH_PACE + turned * len * 0.25;
  const crawlW = Math.max(m.speed, turning);
  let actT = 0, actW = 0;
  if (gesture) {
    const into = m.intoStop - TURN_IN;
    actT = Math.max(0, Math.min(D[gesture], into));
    actW = smooth(into / 0.25) * smooth((D[gesture] + 0.3 - into) / 0.3);
  }
  // Its tips are bright, but it lies on the floor: thrown at full strength their
  // glow pools round it like a lamp. Low, then, flaring as it stands up to you
  // and fading as it lies back down (each over the second the move takes: no flash).
  const risen = gesture === 'stand' ? Math.max(0, Math.min(1, actT / 1.25, (D.stand - 0.25 - actT) / 0.9)) : 0;
  out.bloom = STARFISH_BLOOM + (STARFISH_STAND_BLOOM - STARFISH_BLOOM) * actW * Math.sin((Math.PI / 2) * risen);
  set(rig, 'crawl', posMod((crawled / strideW) * D.crawl, D.crawl), crawlW);
  for (const n of GESTURES) set(rig, n, n === gesture ? actT : 0, n === gesture ? actW : 0);
  set(rig, 'idle', posMod(t + fishHash(index, 1313) * D.idle, D.idle), Math.max(0, 1 - crawlW - actW));
  rig.mixer.update(0);
  return out;
}

function set(rig: StarfishRig, name: StarfishClip, time: number, weight: number): void {
  const a = rig.actions[name];
  a.time = time;
  a.setEffectiveWeight(weight);
}

/** A starfish the tank is placing itself (a vignette's actor): idle on the spot. */
export function starfishIdle(rig: StarfishRig, t: number, index: number): void {
  set(rig, 'crawl', 0, 0);
  for (const n of GESTURES) set(rig, n, 0, 0);
  set(rig, 'idle', posMod(t + fishHash(index, 1313) * rig.durations.idle, rig.durations.idle), 1);
  rig.mixer.update(0);
}
