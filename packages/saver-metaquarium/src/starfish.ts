/**
 * The starfish, alive — and our first character that stands up like a person.
 *
 * Lying down it crawls the floor and over the rocks, a ripple running round
 * its arms; when it stops it looks about, curls up in a hug, waves at you, or
 * stands up on two arms — a five-pointed star, face to you — and flops back
 * down. Some bouts it walks instead of crawling: it rises onto its two front
 * arms (its legs), walks upright with its arms swinging, and sits back down.
 * And in a dance scene (`starfishDance`) every starfish joins a class on the
 * floor, faces the camera and dances on the beat (`danceTempo`).
 *
 * The model is drawn in our designer's style (breeds/rig/starfish-model.mjs)
 * and rigged in Blender (breeds/rig/starfish.py): the disc and its face, two
 * eyes, five arms of three rigid links each. This module decides WHICH clip,
 * WHEN, and WHERE it is — the crab's way (crab.ts): a closed form in t, its
 * schedule hashed per (starfish, cycle), its place the integral of a
 * stop-and-go pace along its own route, every clip's time and weight SET each
 * frame, then `mixer.update(0)`.
 *
 * A cycle: MOVE for W seconds (crawling or walking, drawn per bout, eased in
 * and out), then STOP for S:
 *
 *   0 ─ 1.2 s   it sits down, if it walked
 *   then 0.9 s  turn to face the activity (the camera, for a wave, a stand or a look)
 *   then        the activity's clip (curl / wave / stand, or just idle)
 *   then 1.2 s  turn back to its route
 *   last 1.2 s  it rises, if it walks next
 *
 * Rising and sitting are the `rise` clip played forward or back — never a
 * cross-fade of a flat pose into a standing one, which would hang it halfway.
 * Whatever weight the moving clip leaves goes to the rest clip of the posture
 * it is in (`idle` lying, `standing` upright): three.js gives an unclaimed
 * remainder to the bind pose, which is lying flat.
 *
 * Standing, its feet are `mqFeet` ahead of where its disc lay (it rises over
 * its front tips), so the ground it stands on is read there.
 */
import {
  AnimationMixer, Box3, Euler, Quaternion, Vector3,
  type AnimationAction, type AnimationClip, type Bone, type Object3D,
} from 'three';
import { integrateParam, type ControlTrack, type ParamSpace } from '@idle-screens/core';
import { boutDistance, boutSpeed, type CrabInput } from './crab';
import { swimPoseAtDistance, type SwimPlan } from './plan';
import { fishHash } from './swim';

export const DANCE_MOVES = ['march', 'jacks', 'reach', 'kick', 'twist', 'circles', 'disco', 'spin'] as const;
export type DanceMove = (typeof DANCE_MOVES)[number];
export const STARFISH_CLIPS = ['crawl', 'idle', 'wave', 'stand', 'curl', 'rise', 'standing', 'walk', ...DANCE_MOVES] as const;
export type StarfishClip = (typeof STARFISH_CLIPS)[number];
/** What a starfish is doing. `look` is idle, turned to face the camera; a dancer reports its move. */
export type StarfishDoing = 'crawl' | 'walk' | 'turn' | 'idle' | 'look' | 'wave' | 'stand' | 'curl' | 'rise' | 'sit' | DanceMove;
export type StarfishDanceMode = 'aerobics' | 'freestyle';

export interface StarfishRig {
  mixer: AnimationMixer;
  actions: Record<StarfishClip, AnimationAction>;
  durations: Record<StarfishClip, number>;
  /** Model units crawled per crawl cycle. */
  stride: number;
  /** Model units walked per upright walk cycle. */
  walkStride: number;
  /** Standing, how far ahead of the disc's resting place its feet are (model units). */
  feet: number;
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
  let stride = 0, walkStride = 0, feet = 0;
  let disc: Bone | null = null;
  body.traverse((o) => {
    if (typeof o.userData.mqStride === 'number') stride = o.userData.mqStride;
    if (typeof o.userData.mqWalkStride === 'number') walkStride = o.userData.mqWalkStride;
    if (typeof o.userData.mqFeet === 'number') feet = o.userData.mqFeet;
    if ((o as Bone).isBone && o.name === 'body') disc = o as Bone;
  });
  if (!(stride > 0) || !(walkStride > 0) || !(feet > 0) || !disc) return null;
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
  return { mixer, actions, durations, stride, walkStride, feet, anchor: new Vector3(centre.x, floor, centre.z), norm };
}

// ---------------------------------------------------------------------------
// The schedule
// ---------------------------------------------------------------------------

const TURN_IN = 0.9;
const TURN_OUT = 1.2;
/** The rise clip's length: from lying flat to standing (the rig's `rise`). */
export const STARFISH_RISE = 1.2;
/** Seconds to hand over between a rest clip and a posture change. */
const HANDOVER = 0.25;
/** Crawling (or walking) speed in world units per second: about a third of its
 *  span, a little over half the crab's. Its own pace (crab.ts says why). */
export const STARFISH_PACE = 0.3 * 16.2;
/** The share of its bouts it walks upright. */
const WALKS = 0.35;

const STOPS: readonly [StarfishDoing, number][] = [
  ['idle', 0.22], ['look', 0.14], ['wave', 0.22], ['stand', 0.22], ['curl', 0.2],
];

export interface StarfishCycle { crawl: number; stop: number; offset: number }

export function starfishCycle(index: number): StarfishCycle {
  const crawl = 4 + 4 * fishHash(index, 1301);
  // Room for a sit, a turn in, the longest gesture (the 4.6 s stand) with its
  // fades, a turn out and a rise.
  const stop = 9.8 + 2 * fishHash(index, 1303);
  return { crawl, stop, offset: fishHash(index, 1307) * (crawl + stop) };
}

/** What the starfish does at the stop that ends bout `k`. */
export function starfishStopAt(index: number, k: number): StarfishDoing {
  let r = fishHash(index * 7919 + k, 1309);
  return STOPS.find(([, w]) => (r -= w) < 0)?.[0] ?? 'idle';
}

/** How it covers bout `k`: crawling, or walking upright on its front arms. */
export function starfishGait(index: number, k: number): 'crawl' | 'walk' {
  return fishHash(index * 7907 + k, 1317) < WALKS ? 'walk' : 'crawl';
}

export interface StarfishMoment {
  /** Distance along its route at unit speed. */
  crawled: number;
  k: number;
  u: number;
  speed: number;
  /** Seconds into the stop (negative while moving). */
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
// The dance
// ---------------------------------------------------------------------------

/** The class's routine, in beats per move: eight counts of each (two of the
 *  slower-reading ones), a spin, and round again. Every move is one bar long
 *  and starts and ends on the same standing pose, so it cuts on the bar line. */
export const AEROBICS: readonly (readonly [DanceMove, number])[] = [
  ['march', 16], ['jacks', 16], ['reach', 16], ['kick', 16], ['twist', 16],
  ['circles', 16], ['disco', 16], ['spin', 4], ['jacks', 8], ['march', 4],
];
const AEROBICS_BEATS = AEROBICS.reduce((s, [, n]) => s + n, 0);
/** Freestyle: each dancer picks its own move every eight counts; spins are rare. */
const FREESTYLE: readonly (readonly [DanceMove, number])[] = [
  ['march', 0.12], ['jacks', 0.14], ['reach', 0.12], ['kick', 0.12], ['twist', 0.16], ['circles', 0.12], ['disco', 0.17], ['spin', 0.05],
];

/** Beats danced by `t` seconds: `danceTempo` (BPM) integrated over the track
 *  when it is steered, so a glide speeds the beat up without a jump in it;
 *  `bpm × t` when it is not. */
export function danceBeats(t: number, bpm: number, space: ParamSpace, track: ControlTrack | null, tracked: boolean): number {
  if (!tracked || !track) return (t * bpm) / 60;
  const def = space.danceTempo;
  return integrateParam(space, track, 'danceTempo', t * 1000, {
    ...(def?.min !== undefined ? { min: def.min } : {}), ...(def?.max !== undefined ? { max: def.max } : {}),
  }) / 1000 / 60;
}

/** The move a dancer is on at beat `beats`, and how many beats into it. */
export function danceAt(mode: StarfishDanceMode, index: number, beats: number): { move: DanceMove; beat: number } {
  if (mode === 'freestyle') {
    const block = Math.floor(beats / 8);
    let r = fishHash(index * 977 + block, 1319);
    const move = FREESTYLE.find(([, w]) => (r -= w) < 0)?.[0] ?? 'disco';
    return { move, beat: beats - block * 8 };
  }
  let b = posMod(beats, AEROBICS_BEATS);
  for (const [move, n] of AEROBICS) {
    if (b < n) return { move, beat: b };
    b -= n;
  }
  return { move: 'march', beat: 0 };
}

/** A dancer's place in the class, in spacings: `depth` toward the camera,
 *  `side` across. With three or more, the first is the instructor, out in
 *  front; the rest fill rows of four from the front back, so a capped cast
 *  loses a back-row dancer, never one from the middle. */
export function classSpot(slot: number, count: number): { side: number; depth: number } {
  const lead = count >= 3;
  if (lead && slot === 0) return { side: 0, depth: 1.25 };
  const s = lead ? slot - 1 : slot, n = lead ? count - 1 : count;
  const row = Math.floor(s / 4);
  const inRow = Math.min(4, n - row * 4);
  return { side: (s % 4) - (inRow - 1) / 2, depth: -row };
}

// ---------------------------------------------------------------------------
// The frame
// ---------------------------------------------------------------------------

export interface StarfishDance {
  mode: StarfishDanceMode;
  /** Beats since the start (the tank integrates `danceTempo`). */
  beats: number;
  /** Where this dancer's feet go (classSpot, placed by the tank), and which way the class faces. */
  x: number; z: number; yaw: number;
}

export interface StarfishInput extends CrabInput {
  /** In a dance scene: its place and the beat. Absent: it lives its own life. */
  dance?: StarfishDance;
}

export interface StarfishOutput {
  /** Where the group goes (the disc's resting place) and its turn. */
  x: number; y: number; z: number;
  quaternion: Quaternion;
  /** Unit facing (its face's side). */
  fx: number; fz: number;
  /** Unit travel along its route, and where the route had it two lengths ago. */
  tx: number; tz: number;
  trailX: number; trailZ: number;
  /** Where it actually is to look at: its disc lying down, its feet standing up. */
  focusX: number; focusZ: number;
  doing: StarfishDoing;
  /** How much glow it throws (StarfishRig bloom): low while it lies on the floor, higher standing. */
  bloom: number;
}

const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const wrap = (a: number): number => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;
const posMod = (v: number, m: number): number => ((v % m) + m) % m;
const euler = new Euler(0, 0, 0, 'YXZ');
/** Closer than this many body lengths (centre to centre), two floor creatures ease apart. */
const ROOM = 1.1;
/** The share of its glow a starfish throws while it lies down (see `bloom`). */
export const STARFISH_BLOOM = 0.2;
/** …and standing up: brighter, still not a lamp. Held, never pulsed on the beat (a beat is faster than the 1.5 Hz flash limit). */
export const STARFISH_STAND_BLOOM = 0.55;
/** …and dancing, a long while up close: a little less, so a close-up stays crisp. */
export const STARFISH_DANCE_BLOOM = 0.35;

/** Every clip's weight this frame, by name; unnamed clips are 0. */
type Weights = Partial<Record<StarfishClip, [time: number, weight: number]>>;

/** Places the starfish and sets its clips for time `t`. Pure in its input. */
export function starfishFrame(rig: StarfishRig, inp: StarfishInput, out: StarfishOutput): StarfishOutput {
  return inp.dance ? danceFrame(rig, inp, inp.dance, out) : lifeFrame(rig, inp, out);
}

function lifeFrame(rig: StarfishRig, inp: StarfishInput, out: StarfishOutput): StarfishOutput {
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
  const D = rig.durations;
  const w: Weights = {};
  const standing = (weight: number): void => { w.standing = [posMod(t + fishHash(index, 1313) * D.standing, D.standing), weight]; };
  const idle = (weight: number): void => { w.idle = [posMod(t + fishHash(index, 1313) * D.idle, D.idle), weight]; };

  let yaw = travel;
  let doing: StarfishDoing;
  /** 0 lying flat, 1 standing: where its weight is (and its feet). */
  let up = 0;
  let bloomUp = 0;
  if (m.intoStop < 0) {
    // Moving: crawling flat, or walking upright, each phased by this bout's distance.
    const moved = boutDistance(m.u, c.crawl) * STARFISH_PACE;
    if (starfishGait(index, m.k) === 'walk') {
      w.walk = [posMod((moved / (rig.walkStride * inp.scale)) * D.walk, D.walk), m.speed];
      standing(1 - m.speed);
      doing = 'walk'; up = 1; bloomUp = 1;
    } else {
      w.crawl = [posMod((moved / (rig.stride * inp.scale)) * D.crawl, D.crawl), m.speed];
      idle(1 - m.speed);
      doing = 'crawl';
    }
  } else {
    const s = m.intoStop;
    const sit = starfishGait(index, m.k) === 'walk' ? STARFISH_RISE : 0;
    const rise = starfishGait(index, m.k + 1) === 'walk' ? STARFISH_RISE : 0;
    const end = c.stop - rise;
    if (s < sit || s >= end) {
      // Sitting down (the rise backwards) or getting up, handing over to the
      // rest clip of the posture it leaves or reaches.
      const r = s < sit ? STARFISH_RISE - s : s - end;
      const flatEnd = smooth((HANDOVER - r) / HANDOVER), upEnd = smooth((r - (STARFISH_RISE - HANDOVER)) / HANDOVER);
      w.rise = [r, 1 - flatEnd - upEnd];
      if (flatEnd > 0) idle(flatEnd);
      if (upEnd > 0) standing(upEnd);
      doing = s < sit ? 'sit' : 'rise';
      up = r / STARFISH_RISE; bloomUp = Math.sin((Math.PI / 2) * up);
    } else {
      const did = starfishStopAt(index, m.k);
      const faceCam = (did === 'wave' || did === 'stand' || did === 'look') && Number.isFinite(inp.camX);
      const faceYaw = faceCam ? Math.atan2(inp.camX - x, inp.camZ - z) : travel;
      const dIn = wrap(faceYaw - travel);
      const a = (s - sit) / TURN_IN, b = (s - (end - TURN_OUT)) / TURN_OUT;
      // Back the way it turned, so it ends the stop facing its route again.
      yaw = travel + dIn * smooth(a) * (1 - smooth(b));
      const turned = Math.abs(dIn) * (smooth(a) + smooth(b));
      const effort = (v: number): number => Math.sin(Math.PI * Math.min(1, Math.max(0, v))) * Math.min(1, Math.abs(dIn) / 0.4);
      const turning = a < 1 ? effort(a) : b > 0 ? effort(b) : 0;
      doing = Math.abs(dIn) > 0.05 && (a < 1 || b > 0) ? 'turn' : did;
      let actW = 0;
      if (did === 'wave' || did === 'stand' || did === 'curl') {
        const into = s - sit - TURN_IN;
        const actT = Math.max(0, Math.min(D[did], into));
        actW = smooth(into / 0.25) * smooth((D[did] + 0.3 - into) / 0.3);
        w[did] = [actT, actW];
        if (did === 'stand') {
          const risen = Math.max(0, Math.min(1, actT / 1.25, (D.stand - 0.25 - actT) / 0.9));
          bloomUp = actW * Math.sin((Math.PI / 2) * risen);
        }
      }
      w.crawl = [posMod(((turned * len * 0.25) / (rig.stride * inp.scale)) * D.crawl, D.crawl), turning];
      idle(Math.max(0, 1 - turning - actW));
    }
  }
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const rx = fz, rz = -fx;
  // Its feet, standing, are ahead of the disc's place: the ground is read there.
  const reach = up * rig.feet * inp.scale;
  const gx = x + fx * reach, gz = z + fz * reach;
  const g = inp.ground;
  const r = len * 0.38;
  const hc = g(gx, gz);
  const hf = g(gx + fx * r, gz + fz * r), hb = g(gx - fx * r, gz - fz * r);
  const hr = g(gx + rx * r, gz + rz * r), hl = g(gx - rx * r, gz - rz * r);
  // Lying, the footprint's highest reading, tilted to the slope; standing, on
  // its feet and upright (a person does not lean with the hill).
  const y = up >= 1 ? hc : Math.max(hc, (1 - up) * Math.max((hf + hb) / 2, (hr + hl) / 2) + up * hc);
  const lim = 0.75 * (1 - up);
  const pitch = Math.max(-lim, Math.min(lim, Math.atan2(hf - hb, 2 * r)));
  const roll = Math.max(-lim, Math.min(lim, Math.atan2(hr - hl, 2 * r)));
  euler.set(-pitch, yaw, roll);
  out.quaternion.setFromEuler(euler);
  out.x = x; out.y = y; out.z = z; out.fx = fx; out.fz = fz;
  out.tx = pose.fx; out.tz = pose.fz;
  out.focusX = gx; out.focusZ = gz;
  const trail = starfishSpot(index, t, inp.plan, inp.start, len * 2);
  out.trailX = trail.x + (x - pose.x); out.trailZ = trail.z + (z - pose.z);
  out.doing = doing;
  out.bloom = STARFISH_BLOOM + (STARFISH_STAND_BLOOM - STARFISH_BLOOM) * bloomUp;
  apply(rig, w);
  return out;
}

function danceFrame(rig: StarfishRig, inp: StarfishInput, dance: StarfishDance, out: StarfishOutput): StarfishOutput {
  const { move, beat } = danceAt(dance.mode, inp.index, dance.beats);
  const fx = Math.sin(dance.yaw), fz = Math.cos(dance.yaw);
  const reach = rig.feet * inp.scale;
  out.x = dance.x - fx * reach; out.z = dance.z - fz * reach;
  out.y = inp.ground(dance.x, dance.z);
  euler.set(0, dance.yaw, 0);
  out.quaternion.setFromEuler(euler);
  out.fx = fx; out.fz = fz; out.tx = fx; out.tz = fz;
  out.focusX = dance.x; out.focusZ = dance.z;
  out.trailX = dance.x - fx * inp.len * 2; out.trailZ = dance.z - fz * inp.len * 2;
  out.doing = move;
  out.bloom = STARFISH_DANCE_BLOOM;
  // One bar per clip: four beats at whatever tempo the tank keeps.
  apply(rig, { [move]: [(posMod(beat, 4) / 4) * rig.durations[move], 1] });
  return out;
}

function apply(rig: StarfishRig, w: Weights): void {
  for (const n of STARFISH_CLIPS) {
    const a = rig.actions[n];
    const tw = w[n];
    a.time = tw ? tw[0] : 0;
    a.setEffectiveWeight(tw ? tw[1] : 0);
  }
  rig.mixer.update(0);
}

/** A starfish the tank is placing itself (a vignette's actor): idle on the spot. */
export function starfishIdle(rig: StarfishRig, t: number, index: number): void {
  apply(rig, { idle: [posMod(t + fishHash(index, 1313) * rig.durations.idle, rig.durations.idle), 1] });
}
