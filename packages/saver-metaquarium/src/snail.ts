/**
 * The snail, alive: glides the floor slowly on its one foot, and stops to
 * look about, look at you, graze, stretch up tall, or pull into its shell
 * and peek back out.
 *
 * The model is drawn in our designer's style (breeds/rig/snail-model.mjs)
 * and rigged in Blender (breeds/rig/snail.py): a rigid shell, a soft body
 * (head, neck, foot, tail), eye stalks that roll in, eyes that blink, two
 * glowing feelers. This module decides WHICH clip, WHEN, and WHERE — the
 * crab's way (crab.ts): a closed form in t, its schedule hashed per (snail,
 * cycle), its place the integral of a stop-and-go pace along its own route,
 * every clip's time and weight SET each frame, then `mixer.update(0)`.
 *
 * A cycle: GLIDE for W seconds (eased in and out), then STOP for S:
 *
 *   0 ─ 0.9 s   turn to face the activity (the camera, for a look or a stretch)
 *   then        the activity's clip (look / munch / stretch / retract, or idle)
 *   last 1.4 s  turn back to its route
 *
 * The glide's phase is distance / stride (the rig's `mqStride`), so the wave
 * down its body keeps time with how far it goes. A blink (its own clip, eye
 * scale only) layers over the clips that leave the eyes alone — glide and
 * munch; idle, look, stretch and retract blink on their own.
 *
 * Its eyes are its own (`snailLook`, after the tank places it): no clip moves
 * the pupils, so each slides over its eye's face — at you when it stops to
 * look, down at its food when it grazes, ahead while it glides, and about in
 * saccades the rest of the time. The tank's shared eye display leaves them be.
 *
 * Its shell is dressed by `snailShell` (`dressSnail`): banded as drawn, pearl
 * (iridescent nacre), gold (polished metal), or glow (a dark shell whose
 * spiral breathes light); `mix` gives each snail its own.
 */
import {
  AnimationMixer, Box3, Color, Euler, Matrix4, MeshLambertMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Quaternion, Vector3,
  type AnimationAction, type AnimationClip, type Material, type Mesh, type Object3D,
} from 'three';
import { boutDistance, boutSpeed, type CrabInput } from './crab';
import { swimPoseAtDistance, type SwimPlan } from './plan';
import { fishHash } from './swim';
import type { ActorPose } from './vignette';

export const SNAIL_CLIPS = ['glide', 'idle', 'look', 'retract', 'stretch', 'munch', 'blink'] as const;
export type SnailClip = (typeof SNAIL_CLIPS)[number];
/** What a snail is doing. */
export type SnailDoing = 'glide' | 'turn' | 'idle' | 'look' | 'munch' | 'stretch' | 'retract';

/** An eye: its pupil slides over its face (the dori's way, tang.ts). */
export interface SnailEye {
  eye: Object3D;
  pupil: Object3D;
  /** +1 its left eye (+x), -1 its right. */
  side: 1 | -1;
  pupilRest: Vector3;
  /** The eye bone's rest rotation in the model's axes: a model-axis slide carried into the bone's own. */
  eyeAxes: Quaternion;
}

/** The shell's parts as the tank dressed them, and how they are dressed now (`dressSnail`). */
export interface SnailShell {
  parts: { mesh: Mesh; base: Material; spiral: boolean }[];
  style: SnailShellStyle | '';
}

export interface SnailRig {
  body: Object3D;
  eyes: SnailEye[];
  shell: SnailShell;
  mixer: AnimationMixer;
  actions: Record<SnailClip, AnimationAction>;
  durations: Record<SnailClip, number>;
  /** Model units glided per glide cycle. */
  stride: number;
  /** The ground point under the middle of its footprint, in model space: what the tank stands on the floor. */
  anchor: Vector3;
  /** The template's normalising scale (model units → a unit-size fish). */
  norm: number;
}

/** Rigs a freshly cloned snail body (identity transform), or null when the
 *  model carries no snail rig — then it swims like any other breed. */
export function rigSnail(body: Object3D, clips: readonly AnimationClip[], norm: number): SnailRig | null {
  const byName = new Map(clips.map((c) => [c.name, c]));
  if (!SNAIL_CLIPS.every((n) => byName.has(n))) return null;
  let stride = 0;
  body.traverse((o) => {
    if (typeof o.userData.mqStride === 'number') stride = o.userData.mqStride;
  });
  if (!(stride > 0)) return null;
  body.updateMatrixWorld(true);
  const toModel = new Matrix4().copy(body.matrixWorld).invert();
  const eyes: SnailEye[] = [];
  for (const [side, s] of [['L', 1], ['R', -1]] as const) {
    const eye = named(body, `eye.${side}`), pupil = named(body, `pupil.${side}`);
    if (!eye || !pupil) continue;
    const m = new Matrix4().multiplyMatrices(toModel, eye.matrixWorld);
    eyes.push({ eye, pupil, side: s, pupilRest: pupil.position.clone(), eyeAxes: new Quaternion().setFromRotationMatrix(m.extractRotation(m)) });
  }
  // The middle of its footprint, feelers to tail: it turns about that, and its shadow sits there.
  const box = new Box3().setFromObject(body);
  const mixer = new AnimationMixer(body);
  const actions = {} as Record<SnailClip, AnimationAction>;
  const durations = {} as Record<SnailClip, number>;
  for (const n of SNAIL_CLIPS) {
    const clip = byName.get(n)!;
    const a = mixer.clipAction(clip);
    a.play();
    a.setEffectiveWeight(0);
    actions[n] = a;
    durations[n] = clip.duration;
  }
  return { body, eyes, shell: { parts: [], style: '' }, mixer, actions, durations, stride, anchor: new Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2), norm };
}

/** three drops the '.' from a bone's name ('eye.L' arrives as 'eyeL'). */
const named = (root: Object3D, name: string): Object3D | undefined =>
  root.getObjectByName(name.replace('.', '')) ?? root.getObjectByName(name);

// ---------------------------------------------------------------------------
// The schedule
// ---------------------------------------------------------------------------

const TURN_IN = 0.9;
const TURN_OUT = 1.4;
/** Gliding speed in world units per second: a snail's pace, a sixth of the
 *  crab's. Its own pace, not `swimSpeed` (crab.ts says why). */
export const SNAIL_PACE = 0.16 * 16.2;
/** The share of its glow a snail throws: its feeler tips are on the floor. */
export const SNAIL_BLOOM = 0.25;

const STOPS: readonly [SnailDoing, number][] = [
  ['idle', 0.24], ['look', 0.2], ['munch', 0.24], ['stretch', 0.16], ['retract', 0.16],
];

export interface SnailCycle { glide: number; stop: number; offset: number }

/** This snail's rhythm: how long it glides, how long it stops, where it starts. */
export function snailCycle(index: number): SnailCycle {
  const glide = 7 + 6 * fishHash(index, 1401);
  // Room for a turn in, the longest gesture (the 5 s retract) with its fades, and a turn out.
  const stop = 7.8 + 2 * fishHash(index, 1403);
  return { glide, stop, offset: fishHash(index, 1407) * (glide + stop) };
}

/** What the snail does at the stop that ends bout `k`. */
export function snailStopAt(index: number, k: number): SnailDoing {
  let r = fishHash(index * 7919 + k, 1409);
  // The weights sum to 1, so the walk through them always lands.
  return STOPS.find(([, w]) => (r -= w) < 0)?.[0] ?? 'idle';
}

export interface SnailMoment {
  /** Distance along its route, at unit speed (seconds of cruising). */
  glided: number;
  k: number;
  u: number;
  /** 0..1, how fast it is gliding right now. */
  speed: number;
  /** Seconds into the stop (negative while gliding). */
  intoStop: number;
}

export function snailMoment(index: number, t: number): SnailMoment {
  const c = snailCycle(index);
  const P = c.glide + c.stop;
  const tau = t + c.offset;
  const k = Math.floor(tau / P);
  const u = tau - k * P;
  const glided = k * boutDistance(c.glide, c.glide) + boutDistance(u, c.glide);
  return { glided, k, u, speed: boutSpeed(u, c.glide), intoStop: u - c.glide };
}

/** Where along the plan a snail's route starts: spread by index. */
export function snailStart(plan: SwimPlan, index: number): number {
  return fishHash(index, 1411) * plan.totalLength;
}

/** Where its route puts it at `t`, before it minds the others; `back` units further back for a trail. */
export function snailSpot(index: number, t: number, plan: SwimPlan, start: number, back = 0): { x: number; z: number; fx: number; fz: number } {
  const pose = swimPoseAtDistance(plan, start + snailMoment(index, t).glided * SNAIL_PACE - back);
  const l = Math.hypot(pose.fx, pose.fz) || 1;
  return { x: pose.x, z: pose.z, fx: pose.fx / l, fz: pose.fz / l };
}

/** When this snail blinks in cycle `k`, seconds into it (once a cycle, somewhere in the glide). */
export function snailBlinkAt(index: number, k: number, glide: number): number {
  return 1 + (glide - 2) * fishHash(index * 6151 + k, 1413);
}

// ---------------------------------------------------------------------------
// The frame
// ---------------------------------------------------------------------------

export interface SnailOutput {
  x: number; y: number; z: number;
  quaternion: Quaternion;
  /** Unit facing (its head). */
  fx: number; fz: number;
  /** Unit travel along its route, and where the route had it two lengths ago: the follow camera's chord. */
  tx: number; tz: number;
  trailX: number; trailZ: number;
  doing: SnailDoing;
}

const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const wrap = (a: number): number => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;
const posMod = (v: number, m: number): number => ((v % m) + m) % m;
const euler = new Euler(0, 0, 0, 'YXZ');
/** Closer than this many body lengths (centre to centre), two floor creatures ease apart. */
const ROOM = 1.1;
const GESTURES = ['look', 'retract', 'stretch', 'munch'] as const;
type Gesture = (typeof GESTURES)[number];

export interface SnailInput extends CrabInput {
  /** Its vignette pose, when it is an actor this frame; and where the script has it a quarter second on (its pace). */
  act?: ActorPose | null;
  next?: ActorPose | null;
  /** As an actor: how far its script has walked it by now (`actorTravel`) — what its foot's wave keeps time with. */
  travel?: number;
}

/**
 * On the ground at (x, z), facing `yaw`: the footprint's highest reading (a
 * long foot, a narrow one), tilted with the slope within reason — a snail
 * climbs a rock's flank.
 */
function stand(inp: CrabInput, x: number, z: number, yaw: number, out: SnailOutput): void {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const rx = fz, rz = -fx;
  const g = inp.ground, len = inp.len;
  const lf = len * 0.38, ls = len * 0.18;
  const hc = g(x, z);
  const hf = g(x + fx * lf, z + fz * lf), hb = g(x - fx * lf, z - fz * lf);
  const hr = g(x + rx * ls, z + rz * ls), hl = g(x - rx * ls, z - rz * ls);
  const y = Math.max(hc, (hf + hb) / 2, (hr + hl) / 2);
  const lim = 0.7;
  const pitch = Math.max(-lim, Math.min(lim, Math.atan2(hf - hb, 2 * lf)));
  const roll = Math.max(-lim, Math.min(lim, Math.atan2(hr - hl, 2 * ls)));
  euler.set(-pitch, yaw, roll);
  out.quaternion.setFromEuler(euler);
  out.x = x; out.y = y; out.z = z; out.fx = fx; out.fz = fz;
}

/**
 * A vignette's actor: the script's place and facing, its foot on the floor
 * whatever height the script's mark was written at (an open-stage mark is a
 * swimmer's, y ≈ 34); gliding while the script walks it, resting at a mark.
 * Dot's way (dot.ts): the wave keeps time with the distance the script walked.
 */
function snailActorFrame(rig: SnailRig, inp: SnailInput, act: ActorPose, out: SnailOutput): SnailOutput {
  const { index, t, len } = inp;
  const yaw = Math.atan2(act.fx, act.fz);
  stand(inp, act.x, act.z, yaw, out);
  out.tx = out.fx; out.tz = out.fz;
  out.trailX = act.x - out.fx * len * 2; out.trailZ = act.z - out.fz * len * 2;
  const n = inp.next;
  const speed = n ? Math.hypot(n.x - act.x, n.z - act.z) / 0.25 : 0;
  const going = smooth((speed - 1.5) / 3);
  out.doing = going > 0.5 ? 'glide' : 'idle';
  const D = rig.durations;
  setAction(rig, 'glide', posMod(((inp.travel ?? 0) / (rig.stride * inp.scale)) * D.glide, D.glide), going);
  for (const g of GESTURES) setAction(rig, g, 0, 0);
  setAction(rig, 'blink', 0, 0);
  setAction(rig, 'idle', posMod(t + fishHash(index, 1417) * D.idle, D.idle), 1 - going);
  rig.mixer.update(0);
  return out;
}

/** Places the snail and sets its clips for time `t`. Pure in its input. */
export function snailFrame(rig: SnailRig, inp: SnailInput, out: SnailOutput): SnailOutput {
  if (inp.act) return snailActorFrame(rig, inp, inp.act, out);
  const { index, t, len } = inp;
  const c = snailCycle(index);
  const m = snailMoment(index, t);
  const pose = snailSpot(index, t, inp.plan, inp.start);
  let x = pose.x, z = pose.z;
  // Elbow room, as the crab gives it: each pair splits the overlap.
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

  // Facing: along its route while it glides; at a stop, to the camera for a look or a stretch.
  let yaw = travel;
  let doing: SnailDoing = 'glide';
  let turned = 0;
  let turning = 0;
  let gesture: Gesture | null = null;
  if (m.intoStop >= 0) {
    const did = snailStopAt(index, m.k);
    const faceCam = (did === 'look' || did === 'stretch') && Number.isFinite(inp.camX);
    const faceYaw = faceCam ? Math.atan2(inp.camX - x, inp.camZ - z) : travel;
    const dIn = wrap(faceYaw - travel);
    const a = m.intoStop / TURN_IN, b = (m.intoStop - (c.stop - TURN_OUT)) / TURN_OUT;
    yaw = travel + dIn * smooth(a) - dIn * smooth(b);
    turned = Math.abs(dIn) * (smooth(a) + smooth(b));
    const effort = (x: number): number => Math.sin(Math.PI * Math.min(1, Math.max(0, x))) * Math.min(1, Math.abs(dIn) / 0.4);
    turning = a < 1 ? effort(a) : b > 0 ? effort(b) : 0;
    doing = Math.abs(dIn) > 0.05 && (a < 1 || b > 0) ? 'turn' : did;
    if (did !== 'idle') gesture = did as Gesture;
  }
  // On the ground (`stand`).
  stand(inp, x, z, yaw, out);
  out.tx = pose.fx; out.tz = pose.fz;
  const trail = snailSpot(index, t, inp.plan, inp.start, len * 2);
  out.trailX = trail.x + (x - pose.x); out.trailZ = trail.z + (z - pose.z);
  out.doing = doing;

  // Clips. The glide's phase from this bout's distance (and a turn's, which
  // ripples the foot as it comes round): the wave keeps time with the ground.
  const D = rig.durations;
  const strideW = rig.stride * inp.scale;
  const moved = boutDistance(m.u, c.glide) * SNAIL_PACE + turned * len * 0.25;
  const glideW = Math.max(m.speed, turning);
  let actT = 0, actW = 0;
  if (gesture) {
    const into = m.intoStop - TURN_IN;
    actT = Math.max(0, Math.min(D[gesture], into));
    actW = smooth(into / 0.3) * smooth((D[gesture] + 0.35 - into) / 0.35);
  }
  const idleW = Math.max(0, 1 - glideW - actW);
  setAction(rig, 'glide', posMod((moved / strideW) * D.glide, D.glide), glideW);
  for (const n of GESTURES) setAction(rig, n, n === gesture ? actT : 0, n === gesture ? actW : 0);
  setAction(rig, 'idle', posMod(t + fishHash(index, 1417) * D.idle, D.idle), idleW);
  // A blink over the clips that leave the eyes alone (the glide, the munch).
  const free = Math.max(0, 1 - idleW - (gesture === 'munch' ? 0 : actW));
  const blinkT = m.u - snailBlinkAt(index, m.k, c.glide);
  const blinking = blinkT >= 0 && blinkT < D.blink;
  setAction(rig, 'blink', blinking ? blinkT : 0, blinking ? free : 0);
  rig.mixer.update(0);
  return out;
}

function setAction(rig: SnailRig, name: SnailClip, time: number, weight: number): void {
  const a = rig.actions[name];
  a.time = time;
  a.setEffectiveWeight(weight);
}

/** A snail the tank is placing itself (a vignette's actor, a formation): idle on the spot. */
export function snailIdle(rig: SnailRig, t: number, index: number): void {
  const D = rig.durations;
  setAction(rig, 'glide', 0, 0);
  for (const n of GESTURES) setAction(rig, n, 0, 0);
  setAction(rig, 'blink', 0, 0);
  setAction(rig, 'idle', posMod(t + fishHash(index, 1417) * D.idle, D.idle), 1);
  rig.mixer.update(0);
}

// ---------------------------------------------------------------------------
// The eyes
// ---------------------------------------------------------------------------

/** How far a pupil slides (model units, each way from the middle of its face). Its eye is three cells, its pupil two. */
export const PUPIL_TRAVEL = 1;
/** How far it can look, pupils only: yaw and pitch (radians) that take a pupil to its face's edge. */
const REACH_YAW = 0.7, REACH_PITCH = 0.5;
/** A saccade slot: on each one the eyes may jump to a new spot. */
const SLOT = 0.8;
/** The share of slots, while it is not busy, that it glances at you. */
const GLANCE = 0.22;

export type SnailLookAt = 'viewer' | 'ahead' | 'down' | 'wander';

/** Where the eyes look, as a gaze in -1..1 (x + toward its left, y + up), and what at. Pure in (index, t, doing). */
export function snailGaze(index: number, t: number, doing: SnailDoing): { at: SnailLookAt; gx: number; gy: number } {
  if (doing === 'look' || doing === 'stretch') return { at: 'viewer', gx: 0, gy: 0 };
  if (doing === 'munch') return { at: 'down', gx: 0.35 * Math.sin(t * 1.3 + index), gy: -1 };
  const j = Math.floor(t / SLOT);
  const r = fishHash(index * 6907 + j, 1419);
  if (r < GLANCE) return { at: 'viewer', gx: 0, gy: 0 };
  const gx = 2 * fishHash(index * 6911 + j, 1421) - 1, gy = 2 * fishHash(index * 6917 + j, 1423) - 1;
  // Gliding it mostly watches where it is going.
  if (doing === 'glide' && r < 0.75) return { at: 'ahead', gx: 0.25 * gx, gy: -0.3 + 0.2 * gy };
  return { at: 'wander', gx: 0.85 * gx, gy: 0.7 * gy };
}

/** A pupil's slide on its face for a gaze, in the model's axes (x + its left, y up), from where it rests (inner and low). */
export function pupilOffset(side: 1 | -1, gx: number, gy: number): { x: number; y: number } {
  const c = (v: number): number => Math.max(-1, Math.min(1, v));
  // The middle of its travel is a cell out and a cell up from rest.
  return { x: side * PUPIL_TRAVEL + c(gx) * PUPIL_TRAVEL, y: PUPIL_TRAVEL + c(gy) * PUPIL_TRAVEL };
}

const _m = new Matrix4(), _q = new Quaternion(), _q2 = new Quaternion(), _v = new Vector3(), _c = new Vector3();

/**
 * Slides each pupil for this frame, after the tank has placed the snail
 * (its group's matrices current). `viewer`: the camera in world space, or
 * null (riding in its eye) — then it never looks at you.
 */
export function snailLook(rig: SnailRig, t: number, index: number, doing: SnailDoing, viewer: Vector3 | null): SnailLookAt {
  const g = snailGaze(index, t, doing);
  let at = g.at;
  const toModel = _m.copy(rig.body.matrixWorld).invert();
  for (const e of rig.eyes) {
    let gx = g.gx, gy = g.gy;
    if (at === 'viewer') {
      if (!viewer) { at = 'wander'; } else {
        // The viewer from this eye, in the eye's own rest axes: what its pupil can reach.
        const em = new Matrix4().multiplyMatrices(toModel, e.eye.matrixWorld);
        _c.setFromMatrixPosition(em);
        _q.setFromRotationMatrix(em.extractRotation(em));
        _v.copy(viewer).applyMatrix4(toModel).sub(_c).applyQuaternion(_q.invert()).applyQuaternion(e.eyeAxes);
        const yaw = Math.atan2(_v.x, _v.z), pitch = Math.atan2(_v.y, Math.hypot(_v.x, _v.z));
        // Behind it: it cannot see you, so it looks ahead.
        if (Math.abs(yaw) > 1.4) { gx = 0; gy = 0; } else { gx = yaw / REACH_YAW; gy = pitch / REACH_PITCH; }
      }
    }
    const o = pupilOffset(e.side, gx, gy);
    // Model axes into the eye bone's own (the pupil's position is in its parent's frame).
    _v.set(o.x, o.y, 0).applyQuaternion(_q2.copy(e.eyeAxes).invert());
    e.pupil.position.copy(e.pupilRest).add(_v);
  }
  return at;
}

// ---------------------------------------------------------------------------
// The shell
// ---------------------------------------------------------------------------

export const SNAIL_SHELLS = ['mix', 'banded', 'pearl', 'gold', 'glow'] as const;
export type SnailShellMode = (typeof SNAIL_SHELLS)[number];
export type SnailShellStyle = Exclude<SnailShellMode, 'mix'>;
const SHELL_MIX: readonly [SnailShellStyle, number][] = [['banded', 0.4], ['pearl', 0.25], ['glow', 0.2], ['gold', 0.15]];

/** The shell a snail wears: the mode's, or under `mix` its own (seeded by its slot). */
export function snailShellOf(mode: string, index: number): SnailShellStyle {
  if (mode === 'banded' || mode === 'pearl' || mode === 'gold' || mode === 'glow') return mode;
  let r = fishHash(index, 1427);
  return SHELL_MIX.find(([, w]) => (r -= w) < 0)?.[0] ?? 'banded';
}

/** How bright a glowing spiral is at `t`: a slow breath, its own phase — a 7 s cycle, nowhere near a flash. */
export function snailGlow(t: number, index: number): number {
  return 0.7 + 0.3 * Math.sin((2 * Math.PI * t) / 7 + 6.283 * fishHash(index, 1429));
}

const owned = <M extends Material>(m: M, base: Material): M => {
  m.name = base.name;
  m.userData = { ...base.userData, mqOwned: true, mqSnailShell: true };
  return m;
};
const coatOf = (m: Material): Color => (m as Partial<MeshLambertMaterial>).color?.clone() ?? new Color('#c46a2a');

/** One shell part dressed in a style, from the coat the tank gave it. */
function shellMaterial(style: SnailShellStyle, base: Material, spiral: boolean): Material {
  const coat = coatOf(base);
  if (style === 'pearl') {
    // Nacre: pale and bright, a rainbow sheen that slides as it turns (iridescence over the room's environment).
    const pale = coat.clone().lerp(new Color('#fff6ee'), spiral ? 0.35 : 0.6);
    return owned(new MeshPhysicalMaterial({
      color: pale, metalness: 0.1, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.12,
      iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [180, 820], envMapIntensity: 1.3,
      emissive: pale.clone().multiplyScalar(0.12),
    }), base);
  }
  if (style === 'gold') {
    // Polished, not a mirror: a satin roughness so a flat voxel face never flips sky-white to black (materials.ts METAL-).
    const gold = new Color(spiral ? '#9c6a24' : '#f0c25a').lerp(coat, 0.18);
    return owned(new MeshStandardMaterial({ color: gold, metalness: 0.85, roughness: spiral ? 0.42 : 0.3, envMapIntensity: 1.4, emissive: gold.clone().multiplyScalar(0.12) }), base);
  }
  // glow: a dark shell; its spiral a vivid line of the coat's own hue, lit from within (snailGlow sets how much).
  if (!spiral) return owned(new MeshLambertMaterial({ color: coat.clone().multiplyScalar(0.28) }), base);
  const hsl = { h: 0, s: 0, l: 0 };
  coat.getHSL(hsl);
  // Dark until lit: the light carries the colour (a lit colour on top of it would wash out to cream).
  const vivid = new Color().setHSL((hsl.h + 0.45) % 1, 1, 0.5);
  const m = owned(new MeshLambertMaterial({ color: vivid.clone().multiplyScalar(0.12), emissive: vivid.clone() }), base);
  m.userData.mqGlow = vivid;
  return m;
}

/**
 * Dresses the shell in `style`, once (a call with the style it already
 * wears does nothing, so the tank calls this every frame and a live steer
 * of `snailShell` takes on the next one). `lit` false (flat lighting) or
 * the neon look keep the tank's own materials: banded.
 */
export function dressSnail(rig: SnailRig, style: SnailShellStyle, lit: boolean, neon: boolean): void {
  const want: SnailShellStyle = lit && !neon ? style : 'banded';
  const sh = rig.shell;
  if (sh.style === want) return;
  if (!sh.parts.length) {
    rig.body.traverse((n) => {
      const mesh = n as Mesh;
      const mat = mesh.material as Material | Material[] | undefined;
      if (!mesh.isMesh || !mat || Array.isArray(mat)) return;
      if (mat.name === 'PrimaryColor' || mat.name === 'SecondaryColor') sh.parts.push({ mesh, base: mat, spiral: mat.name === 'SecondaryColor' });
    });
  }
  for (const p of sh.parts) {
    const cur = p.mesh.material as Material;
    if (cur !== p.base && cur.userData.mqSnailShell) cur.dispose();
    p.mesh.material = want === 'banded' ? p.base : shellMaterial(want, p.base, p.spiral);
  }
  sh.style = want;
}

/** This frame's light in a glowing spiral (a no-op on any other shell). */
export function snailShellLight(rig: SnailRig, t: number, index: number): void {
  if (rig.shell.style !== 'glow') return;
  const k = snailGlow(t, index);
  for (const p of rig.shell.parts) {
    if (!p.spiral) continue;
    const m = p.mesh.material as MeshLambertMaterial;
    m.emissive.copy(m.userData.mqGlow as Color).multiplyScalar(k);
  }
}
