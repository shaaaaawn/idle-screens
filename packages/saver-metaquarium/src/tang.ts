/**
 * The dori — a blue tang, alive. The first breed that swims on its fins: a
 * tang is a labriform swimmer, its body held rigid while its pectorals beat
 * like wings, and it only kicks its tail to burst (breeds/rig/dori.py has the
 * clips and the sources). And the first whose eyes are the act: a fish has no
 * eyelids and a fixed pupil, so it never blinks — all the life is in where it
 * LOOKS.
 *
 * Two calls a frame, both closed forms in t:
 *
 *   tangFrame  the clips, before the tank places the fish: the fin stroke
 *              (fly when cruising, hover when it idles, phased by time AND
 *              distance, so the fins beat while it holds station), the tail's
 *              burst layered in when the tank makes it dart, and now and then
 *              a moment — snapping up plankton, a display, a headstand at a
 *              cleaning station, backing off from the glass, playing dead.
 *   tangLook   the eyes, after: each eye's box swivels and its pupil slides
 *              across its face to look at something. It scans in saccades
 *              (quick jumps, then still); it turns to the viewer and holds
 *              their eye, the two eyes a beat apart — a double take; before it
 *              snaps at plankton both eyes converge on the speck; playing dead,
 *              one eye stays on you. Mostly yoked, with a little drift each:
 *              butterflyfish move their eyes together, pipefish apart, and a
 *              tang's are not on record.
 *
 * No state: a saccade is a hashed schedule, a shift is a short crossfade
 * between two targets both evaluated at t, and following something is just
 * aiming at where it is now.
 */
import { AnimationMixer, Matrix4, Quaternion, Vector3, type AnimationAction, type AnimationClip, type Object3D } from 'three';
import { fishHash } from './swim';

export const TANG_CLIPS = ['fly', 'hover', 'back', 'burst', 'pick', 'flare', 'headstand', 'flop'] as const;
export type TangClip = (typeof TANG_CLIPS)[number];
export type TangMoment = 'pick' | 'flare' | 'headstand' | 'flop' | 'wary';
export type TangDoing = 'swim' | 'hover' | 'burst' | TangMoment;
export type TangLookAt = 'wander' | 'viewer' | 'focus';

/** An eye: its box swivels on its bone, its pupil slides on the box's face. */
export interface TangEye {
  eye: Object3D;
  pupil: Object3D;
  /** +1 the fish's left eye (+x), -1 its right. */
  side: 1 | -1;
  eyeRest: Quaternion;
  pupilRest: Vector3;
  /** The eye bone's rest rotation in the model's axes (to turn a model-axis swivel into the bone's own). */
  eyeAxes: Quaternion;
  /** Its parent's (the eye bone's) rest rotation, the same for the pupil's slide. */
  pupilAxes: Quaternion;
  /** The eye's centre, at rest, in the model's axes. */
  centre: Vector3;
}

export interface TangRig {
  mixer: AnimationMixer;
  actions: Record<TangClip, AnimationAction>;
  durations: Record<TangClip, number>;
  /** The head and its rest matrix in the model: a target is read in the head's frame, then put back in the rest model's. */
  head: Object3D | null;
  headRest: Matrix4;
  eyes: TangEye[];
}

/** three drops the '.' from a bone's name ('eye.L' arrives as 'eyeL'). */
const named = (root: Object3D, name: string): Object3D | undefined =>
  root.getObjectByName(name.replace('.', '')) ?? root.getObjectByName(name);

/** Rigged at identity, before the tank scales and turns the body. */
export function rigTang(body: Object3D, clips: readonly AnimationClip[]): TangRig | null {
  const byName = new Map(clips.map((c) => [c.name, c]));
  if (!TANG_CLIPS.every((n) => byName.has(n))) return null;
  const mixer = new AnimationMixer(body);
  const actions = {} as Record<TangClip, AnimationAction>;
  const durations = {} as Record<TangClip, number>;
  for (const n of TANG_CLIPS) {
    const clip = byName.get(n)!;
    const a = mixer.clipAction(clip);
    a.play();
    a.setEffectiveWeight(0);
    actions[n] = a;
    durations[n] = clip.duration;
  }
  body.updateMatrixWorld(true);
  const toModel = new Matrix4().copy(body.matrixWorld).invert();
  const modelQ = (o: Object3D): Quaternion => {
    const m = new Matrix4().multiplyMatrices(toModel, o.matrixWorld);
    return new Quaternion().setFromRotationMatrix(m.extractRotation(m));
  };
  const head = named(body, 'head') ?? null;
  const headRest = head ? new Matrix4().multiplyMatrices(toModel, head.matrixWorld) : new Matrix4();
  const eyes: TangEye[] = [];
  for (const [side, s] of [['L', 1], ['R', -1]] as const) {
    const eye = named(body, `eye.${side}`), pupil = named(body, `pupil.${side}`);
    if (!eye || !pupil) continue;
    eyes.push({
      eye, pupil, side: s,
      eyeRest: eye.quaternion.clone(), pupilRest: pupil.position.clone(),
      eyeAxes: modelQ(eye), pupilAxes: modelQ(eye),
      centre: new Vector3().setFromMatrixPosition(new Matrix4().multiplyMatrices(toModel, eye.matrixWorld)),
    });
  }
  return { mixer, actions, durations, head, headRest, eyes };
}

// ---------------------------------------------------------------------------
// The body: the stroke and the moments
// ---------------------------------------------------------------------------

/** Fin-stroke seconds per unit swum, on top of one a second: the beat quickens as it swims faster. */
export const TANG_STROKE = 0.012;
const MOMENT_LENGTH: Record<TangMoment, number> = { pick: 1.0, flare: 2.6, headstand: 3.0, flop: 3.0, wary: 2.6 };
/** Playing dead is rare (and short): it is a joke the first time and a bug report the fifth. */
const MOMENTS: readonly [TangMoment, number][] = [
  ['pick', 0.38], ['wary', 0.22], ['headstand', 0.16], ['flare', 0.16], ['flop', 0.08],
];
const LONGEST = Math.max(...Object.values(MOMENT_LENGTH));

export interface TangCycle { period: number; offset: number; at: number }

/** One moment a cycle, an adult's unhurried rhythm (a baby's is 6–12 s). */
export function tangCycle(index: number): TangCycle {
  const period = 10 + 8 * fishHash(index, 1501);
  return { period, offset: fishHash(index, 1503) * period, at: 0.5 + (period - LONGEST - 1) * fishHash(index, 1505) };
}

export function tangMomentAt(index: number, k: number): TangMoment {
  let r = fishHash(index * 7793 + k, 1507);
  return MOMENTS.find(([, w]) => (r -= w) < 0)?.[0] ?? 'pick';
}

const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const posMod = (v: number, m: number): number => ((v % m) + m) % m;
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

export interface TangInput {
  /** How fast it is cruising, relative to an ordinary fish (0 holds station, 1 cruises). */
  pace: number;
  /** How hard the tank is making it dart (the maneuver's flurry): the tail kicks in. */
  flurry: number;
}

export interface TangState {
  doing: TangDoing;
  moment: TangMoment | null;
  /** The moment's weight against the stroke, and seconds into it. */
  weight: number;
  into: number;
}

export function tangMoment(index: number, t: number): { moment: TangMoment | null; weight: number; into: number } {
  const c = tangCycle(index);
  const tau = t + c.offset;
  const k = Math.floor(tau / c.period);
  const u = tau - k * c.period - c.at;
  const moment = tangMomentAt(index, k);
  const len = MOMENT_LENGTH[moment];
  if (u < 0 || u > len) return { moment: null, weight: 0, into: 0 };
  return { moment, weight: smooth(u / 0.2) * smooth((len - u) / 0.3), into: u };
}

/** Sets the clips for `t`; `beat` is the distance swum. */
export function tangFrame(rig: TangRig, t: number, index: number, beat: number, inp: TangInput): TangState {
  const m = tangMoment(index, t);
  const D = rig.durations;
  for (const n of TANG_CLIPS) set(rig, n, 0, 0);
  // The stroke: phased by time and by distance, so it beats while it hovers
  // and quickens as it swims.
  const phase = t + beat * TANG_STROKE;
  const burst = clamp(inp.flurry * 1.4, 0, 1);
  const cruise = smooth((inp.pace - 0.1) / 0.5);
  // A wary tang backs off on its fins; the clip clips sit under the moments' weight.
  const wary = m.moment === 'wary' ? m.weight : 0;
  const clipW = m.moment && m.moment !== 'wary' ? m.weight : 0;
  const rest = 1 - clipW;
  set(rig, 'burst', posMod(t, D.burst), rest * burst);
  const stroke = rest * (1 - burst);
  set(rig, 'back', posMod(phase * 1.1, D.back), stroke * wary);
  set(rig, 'fly', posMod(phase, D.fly), stroke * (1 - wary) * cruise);
  set(rig, 'hover', posMod(phase, D.hover), stroke * (1 - wary) * (1 - cruise));
  if (m.moment && m.moment !== 'wary') set(rig, m.moment, Math.min(m.into, D[m.moment]), clipW);
  rig.mixer.update(0);
  const doing: TangDoing = m.weight > 0.02 && m.moment ? m.moment : burst > 0.3 ? 'burst' : cruise > 0.5 ? 'swim' : 'hover';
  return { doing, moment: m.moment, weight: m.weight, into: m.into };
}

function set(rig: TangRig, name: TangClip, time: number, weight: number): void {
  const a = rig.actions[name];
  a.time = time;
  a.setEffectiveWeight(weight);
}

// ---------------------------------------------------------------------------
// The eyes
// ---------------------------------------------------------------------------

/** How far an eye's box swivels (radians), and the pupil's slide (model units, both ways from centre). */
export const EYE_YAW = 0.55;
export const EYE_PITCH = 0.35;
export const PUPIL_TRAVEL = 1;
/** Where the pupil sits on its face at rest, from the centre of its travel (the designer's side-glance). */
const PUPIL_REST = { x: 1, y: 1 };
/** How far an eye can look, box and pupil together. */
const REACH_YAW = 1.0, REACH_PITCH = 0.6;
/** A saccade slot: on each one an eye may jump to a new target. */
const SLOT = 0.35;

export interface TangLookInput {
  /** The viewer (the camera) in world space, or null when there is none to look at (riding in its eye). */
  viewer: Vector3 | null;
  /** The state from this frame's tangFrame. */
  state: TangState;
}

export interface TangLook {
  at: TangLookAt;
  /** Degrees between where the eyes point and the viewer (null: no viewer). */
  offViewer: number | null;
}

/** Whether eye-shift slot `j` is a saccade for this fish, and where it then looks. */
function slotSaccade(index: number, j: number): boolean {
  return fishHash(index * 4241 + j, 1511) < 0.32;
}

/** The slot of the last saccade at or before slot `j`. */
function lastSaccade(index: number, j: number): number {
  for (let k = 0; k < 24; k++) if (slotSaccade(index, j - k)) return j - k;
  return j - 24;
}

interface Aim { yaw: number; pitch: number; at: TangLookAt }

const _v = new Vector3(), _w = new Vector3(), _q = new Quaternion(), _q2 = new Quaternion();
const Y = new Vector3(0, 1, 0), X = new Vector3(1, 0, 0);

/** The target of saccade `j` for eye `e`, as an aim from that eye (the viewer's is aimed at, now). */
function targetOf(rig: TangRig, index: number, j: number, eye: TangEye, viewer: Vector3 | null, t: number, inp: TangLookInput): Aim {
  const m = inp.state;
  // A moment owns the gaze.
  if (m.moment === 'pick' && m.into > 0.0 && m.into < 0.75) return aimAt(eye, _w.set(0, -4, 30));
  if ((m.moment === 'wary' || m.moment === 'flare') && viewer) return aimAt(eye, viewer, 'viewer');
  if (m.moment === 'flop' && viewer && eye.side > 0) return aimAt(eye, viewer, 'viewer');
  // Otherwise: half the saccades find the viewer, half look about.
  if (viewer && fishHash(index * 977 + j, 1513) < 0.5) return aimAt(eye, viewer, 'viewer');
  const h1 = fishHash(index * 31 + j, 1515), h2 = fishHash(index * 37 + j, 1517);
  // A little of its own each eye, held for the saccade: never quite yoked.
  const drift = 0.12 * (fishHash(index * 41 + j * 2 + (eye.side > 0 ? 1 : 0), 1521) * 2 - 1);
  return { yaw: (h1 * 2 - 1) * 0.9 + drift, pitch: (h2 * 2 - 1) * 0.45, at: 'wander' };
}

function aimAt(eye: TangEye, p: Vector3, at: TangLookAt = 'focus'): Aim {
  const d = _v.copy(p).sub(eye.centre);
  return { yaw: Math.atan2(d.x, d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)), at };
}

/**
 * Aim the eyes for `t`. Call after the tank has placed and turned the fish
 * (its world matrices current): the viewer is read in the head's frame, so a
 * fish lying on its side or standing on its nose still looks at you.
 */
export function tangLook(rig: TangRig, t: number, index: number, inp: TangLookInput): TangLook {
  let viewer: Vector3 | null = null;
  if (inp.viewer && rig.head) {
    // The viewer where the model would see it with its head at rest.
    const p = rig.head.worldToLocal(_w.copy(inp.viewer)).applyMatrix4(rig.headRest);
    // Behind it, an eye cannot turn that far: it is not there to look at.
    const front = rig.eyes[0] ? p.clone().sub(rig.eyes[0].centre) : p.clone();
    viewer = front.z > -0.25 * front.length() ? p.clone() : null;
  }
  let at: TangLookAt = 'wander';
  let off = 0, offN = 0;
  for (const e of rig.eyes) {
    // The second eye a beat behind the first: a double take.
    const lag = e.side > 0 ? 0 : 0.06 + 0.12 * fishHash(index, 1519);
    const te = t - lag;
    const j = Math.floor(te / SLOT);
    const j1 = lastSaccade(index, j), j0 = lastSaccade(index, j1 - 1);
    const a1 = targetOf(rig, index, j1, e, viewer, te, inp);
    const a0 = targetOf(rig, index, j0, e, viewer, te, inp);
    // A saccade is quick: 90 ms from one to the next.
    const s = smooth((te - j1 * SLOT) / 0.09);
    const yaw = a0.yaw + (a1.yaw - a0.yaw) * s, pitch = a0.pitch + (a1.pitch - a0.pitch) * s;
    if (e.side > 0) at = s > 0.5 ? a1.at : a0.at;
    aimEye(e, yaw, pitch);
    if (viewer) {
      // Where the eye actually points (the swivel and the slide have limits) against where the viewer is.
      const v = aimAt(e, viewer);
      off += Math.hypot(v.yaw - clamp(yaw, -REACH_YAW, REACH_YAW), v.pitch - clamp(pitch, -REACH_PITCH, REACH_PITCH)); offN++;
    }
  }
  return { at, offViewer: viewer && offN ? Math.round((off / offN) * 180 / Math.PI) : null };
}

/** Swivel the box most of the way and slide the pupil for the rest. */
function aimEye(e: TangEye, yaw: number, pitch: number): void {
  const sy = clamp(yaw * 0.8, -EYE_YAW, EYE_YAW), sp = clamp(pitch * 0.8, -EYE_PITCH, EYE_PITCH);
  // The swivel in the model's axes, carried into the bone's own.
  _q.setFromAxisAngle(Y, sy).multiply(_q2.setFromAxisAngle(X, -sp));
  _q2.copy(e.eyeAxes).invert().multiply(_q).multiply(e.eyeAxes);
  e.eye.quaternion.copy(e.eyeRest).multiply(_q2);
  // The pupil: centred when it looks ahead, out to the face's edge at the limit.
  const gx = clamp((yaw - sy) / 0.35 + yaw / 1.4, -1, 1), gy = clamp((pitch - sp) / 0.3 + pitch / 0.9, -1, 1);
  _v.set((gx - PUPIL_REST.x) * PUPIL_TRAVEL, (gy - PUPIL_REST.y) * PUPIL_TRAVEL, 0).applyQuaternion(_q.copy(e.pupilAxes).invert());
  e.pupil.position.copy(e.pupilRest).add(_v);
}
