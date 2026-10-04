/**
 * The blowfish — a pufferfish, and a flirt. Two calls a frame, both closed
 * forms in t (breeds/rig/blowfish.py has the rig and its clips):
 *
 *   pufferFrame  the body, before the tank places it. How puffed it is — a
 *                dial (the `puff` clip's time): it breathes a little always;
 *                now and then it puts on a show, gulping itself round at a
 *                puffer's 2.5 gulps a second (Wainwright & Turingan 1997),
 *                holding it, and letting it go — burping the water back out
 *                (the real way: slower than it went in) or, sometimes, zipping
 *                round like a let-go balloon. The rest of the time an act a
 *                cycle: a kiss, a shimmy, a pirouette, a back flip, bounces,
 *                a water jet, a yawn, a shy turn, a wave, a crunch, a little
 *                pout of a half puff.
 *   pufferLook   the eyes, after the tank has placed it. True puffers CAN
 *                close their eyes — the eyeball draws in and the skin closes
 *                round it like an aperture (Ogimoto 2021) — so these eyes do
 *                what no other fish's here can: wink. It scans in saccades,
 *                finds the viewer and holds their eye (pupils wide — it likes
 *                what it sees), and flirts: a wink, batted lashes, slow
 *                bedroom eyes, a sly side-eye, an eyebrow flash. Its eyes
 *                close for the kiss, peek through half-shut lids when shy,
 *                go wide and tiny-pupilled as it gulps, and roll every which
 *                way when it zips.
 *
 * No state: every schedule is hashed, every shift a short crossfade between
 * targets both evaluated at t.
 */
import { AnimationMixer, Matrix4, Quaternion, Vector3, type AnimationAction, type AnimationClip, type Object3D } from 'three';
import { fishHash } from './swim';

export const PUFFER_CLIPS = [
  'swim', 'hover', 'puff', 'gulp', 'zip', 'spin', 'flip', 'kiss', 'shimmy', 'bounce', 'spit', 'yawn', 'shy', 'wave', 'chomp',
] as const;
export type PufferClip = (typeof PUFFER_CLIPS)[number];
/** An act: a clip of its own, a puff show, or a half-puffed pout. */
export type PufferAct = 'kiss' | 'shimmy' | 'spin' | 'flip' | 'bounce' | 'spit' | 'yawn' | 'shy' | 'wave' | 'chomp' | 'puffup' | 'pout';
export type PufferDoing = 'swim' | 'hover' | PufferAct;
/** What the eyes are doing about the viewer. */
export type PufferFlirt = 'wink' | 'bat' | 'bedroom' | 'sideeye' | 'brows';
export type PufferLookAt = 'wander' | 'viewer' | 'away' | 'down' | 'dizzy';

export interface PufferEye {
  eye: Object3D;
  pupil: Object3D;
  side: 1 | -1;
  eyeRest: { q: Quaternion; p: Vector3; s: Vector3 };
  pupilRest: { p: Vector3; s: Vector3 };
  /** Rest rotations in the model's axes: the eye's parent (for the eye's moves), the eye (for the pupil's slide). */
  parentAxes: Quaternion;
  eyeAxes: Quaternion;
  /** Which of the eye's own axes is the model's up and which its side; the same for the pupil. */
  eyeUp: 0 | 1 | 2;
  eyeSide: 0 | 1 | 2;
  pupilUp: 0 | 1 | 2;
  pupilSide: 0 | 1 | 2;
}

export interface PufferRig {
  mixer: AnimationMixer;
  actions: Record<PufferClip, AnimationAction>;
  durations: Record<PufferClip, number>;
  eyes: PufferEye[];
  /** The mouth, where a kiss's or a jet's bubble leaves from. */
  mouth: Object3D | null;
}

const named = (root: Object3D, name: string): Object3D | undefined =>
  root.getObjectByName(name.replace('.', '')) ?? root.getObjectByName(name);

/** Rigged at identity, before the tank scales and turns the body. */
export function rigPuffer(body: Object3D, clips: readonly AnimationClip[]): PufferRig | null {
  const byName = new Map(clips.map((c) => [c.name, c]));
  if (!PUFFER_CLIPS.every((n) => byName.has(n))) return null;
  const mixer = new AnimationMixer(body);
  const actions = {} as Record<PufferClip, AnimationAction>;
  const durations = {} as Record<PufferClip, number>;
  for (const n of PUFFER_CLIPS) {
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
    return new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(m));
  };
  /** The bone's own axis that lies along model axis `v`. */
  const axisAlong = (q: Quaternion, v: Vector3): 0 | 1 | 2 => {
    const e = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)].map((a) => Math.abs(a.applyQuaternion(q).dot(v)));
    return e.indexOf(Math.max(...e)) as 0 | 1 | 2;
  };
  const UP = new Vector3(0, 1, 0), SIDE = new Vector3(1, 0, 0);
  const eyes: PufferEye[] = [];
  for (const [side, s] of [['L', 1], ['R', -1]] as const) {
    const eye = named(body, `eye.${side}`), pupil = named(body, `pupil.${side}`);
    if (!eye || !pupil || !eye.parent) continue;
    const eyeAxes = modelQ(eye), pupilAxes = modelQ(pupil);
    eyes.push({
      eye, pupil, side: s,
      eyeRest: { q: eye.quaternion.clone(), p: eye.position.clone(), s: eye.scale.clone() },
      pupilRest: { p: pupil.position.clone(), s: pupil.scale.clone() },
      parentAxes: modelQ(eye.parent), eyeAxes,
      eyeUp: axisAlong(eyeAxes, UP), eyeSide: axisAlong(eyeAxes, SIDE),
      pupilUp: axisAlong(pupilAxes, UP), pupilSide: axisAlong(pupilAxes, SIDE),
    });
  }
  return { mixer, actions, durations, eyes, mouth: named(body, 'mouth') ?? null };
}

// ---------------------------------------------------------------------------
// The body: acts, and the puff dial
// ---------------------------------------------------------------------------

/** Swim-clip seconds per unit swum, on top of one a second: the flutter quickens with speed (3-6 Hz, Gordon 1996). */
export const PUFFER_STROKE = 0.01;
const ACT_LENGTH: Record<PufferAct, number> = {
  kiss: 2.0, shimmy: 1.8, spin: 1.6, flip: 1.4, bounce: 1.5, spit: 1.2, yawn: 2.4, shy: 2.2, wave: 1.6, chomp: 0.9,
  puffup: 6.2, pout: 2.4,
};
const ACTS: readonly [PufferAct, number][] = [
  ['puffup', 0.15], ['kiss', 0.12], ['shimmy', 0.09], ['wave', 0.09], ['shy', 0.08], ['pout', 0.08], ['spin', 0.08],
  ['bounce', 0.07], ['flip', 0.06], ['spit', 0.06], ['yawn', 0.06], ['chomp', 0.06],
];
const LONGEST = Math.max(...Object.values(ACT_LENGTH));

export interface PufferCycle { period: number; offset: number; at: number }

/** One act a cycle — a lively one: 8 to 13 s. */
export function pufferCycle(index: number): PufferCycle {
  const period = 8 + 5 * fishHash(index, 1601);
  return { period, offset: fishHash(index, 1603) * period, at: 0.4 + Math.max(0, period - LONGEST - 0.8) * fishHash(index, 1605) };
}

export function pufferActAt(index: number, k: number): PufferAct {
  let r = fishHash(index * 7793 + k, 1607);
  return ACTS.find(([, w]) => (r -= w) < 0)?.[0] ?? 'kiss';
}

const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const posMod = (v: number, m: number): number => ((v % m) + m) % m;
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
const env = (u: number, a: number, b: number, c: number, d: number): number => smooth((u - a) / (b - a)) * (1 - smooth((u - c) / (d - c)));

export interface PufferActNow { act: PufferAct | null; weight: number; into: number; cycle: number }

export function pufferAct(index: number, t: number): PufferActNow {
  const c = pufferCycle(index);
  const tau = t + c.offset;
  const k = Math.floor(tau / c.period);
  const u = tau - k * c.period - c.at;
  const act = pufferActAt(index, k);
  const len = ACT_LENGTH[act];
  if (u < 0 || u > len) return { act: null, weight: 0, into: 0, cycle: k };
  return { act, weight: smooth(u / 0.2) * smooth((len - u) / 0.3), into: u, cycle: k };
}

// The puff show: gulps, a hold, a release.
const GULPS = 4;
const GULP_EVERY = 0.4;                  // 2.5 gulps a second
const HOLD_FROM = GULPS * GULP_EVERY + 0.2;
const RELEASE_AT = HOLD_FROM + 2.2;
const BURPS = 4;
const BURP_EVERY = 0.45;

/** How it lets go: burping it back out (the real way), or zipping off like a balloon. */
export function pufferRelease(index: number, cycle: number): 'burp' | 'zip' {
  return fishHash(index * 389 + cycle, 1609) < 0.35 ? 'zip' : 'burp';
}

/** How puffed it is (0 relaxed, 1 a full ball) — a breath always, a show now and then. */
export function pufferPuff(index: number, t: number): number {
  const breath = 0.035 * (0.5 + 0.5 * Math.sin((2 * Math.PI * t) / 2.8 + fishHash(index, 1611) * 6.28));
  const a = pufferAct(index, t);
  if (a.act === 'pout') {
    // Two gulps' worth, held a moment, let out: a little practice puff.
    const up = smooth((a.into - 0.15) / 0.3) * 0.22 + smooth((a.into - 0.55) / 0.3) * 0.23;
    return breath + up * (1 - smooth((a.into - 1.6) / 0.6));
  }
  if (a.act !== 'puffup') return breath;
  const u = a.into;
  let p = 0;
  // Each gulp a quick swell with a little overshoot.
  for (let g = 0; g < GULPS; g++) {
    const x = (u - 0.15 - g * GULP_EVERY) / 0.22;
    p += (smooth(x) + 0.25 * Math.sin(Math.PI * clamp(x, 0, 1)) * (1 - smooth(x - 1))) / GULPS;
  }
  p = Math.min(1.04, p);
  if (u >= HOLD_FROM) p = 1 - 0.035 * (0.5 + 0.5 * Math.sin((u - HOLD_FROM) * 5.3)) * smooth((u - HOLD_FROM) / 0.3);
  if (u >= RELEASE_AT) {
    const r = u - RELEASE_AT;
    if (pufferRelease(index, a.cycle) === 'zip') p *= 1 - smooth(r / 0.55);
    else {
      let out = 0;
      for (let b = 0; b < BURPS; b++) out += smooth((r - b * BURP_EVERY) / 0.25) / BURPS;
      p *= 1 - out;
    }
  }
  return breath + Math.max(0, p) * (1 - breath);
}

/** How much of its travel an act holds back (a kiss is given standing still; a puffed ball can barely swim). */
const HOLD: Record<PufferAct, number> = {
  puffup: 0.92, pout: 0.6, kiss: 0.9, wave: 0.8, shy: 0.6, yawn: 0.7, bounce: 0.7, shimmy: 0.7, spit: 0.5,
  chomp: 0.6, spin: 0.5, flip: 0.5,
};
export const PUFFER_CATCH = 4;

/** Seconds of cruising held back at `t` (the tank subtracts that much travel), made good over PUFFER_CATCH after. */
export function pufferHold(index: number, t: number): number {
  const c = pufferCycle(index);
  const k = Math.floor((t + c.offset) / c.period);
  let held = 0;
  for (const kk of [k - 1, k]) {
    const act = pufferActAt(index, kk);
    const start = kk * c.period + c.at - c.offset, len = ACT_LENGTH[act];
    if (t <= start) continue;
    const span = Math.min(t, start + len) - start;
    let area = 0;
    for (let u0 = 0; u0 < span; u0 += 0.05) {
      const dt = Math.min(0.05, span - u0), u = u0 + dt / 2;
      area += smooth(u / 0.2) * smooth((len - u) / 0.3) * dt;
    }
    held += HOLD[act] * area * (t > start + len ? 1 - smooth((t - start - len) / PUFFER_CATCH) : 1);
  }
  return held;
}

export interface PufferInput {
  /** How fast it is cruising relative to an ordinary fish (0 holds station). */
  pace: number;
}

export interface PufferState {
  doing: PufferDoing;
  act: PufferAct | null;
  weight: number;
  into: number;
  cycle: number;
  /** How puffed (0..1). */
  puff: number;
  /** Turn to face the viewer this much (0..1): a kiss is given to someone. */
  face: number;
  /** A bubble to let go: its key, when it left (t) and its size in body lengths (the tank's BurpLayer). */
  bubble: { key: string; t: number; size: number } | null;
}

/** The bubbles an act lets go: a kiss's, a jet's, a burp's. Keyed so each is emitted once. */
function bubbleOf(index: number, a: PufferActNow): PufferState['bubble'] {
  const key = (n: string, at: number, size: number): PufferState['bubble'] =>
    a.into >= at ? { key: `${index}:${a.cycle}:${n}`, t: at - a.into, size } : null;
  if (a.act === 'kiss' && a.into < 1.6) return key('kiss', 1.06, 0.12);
  if (a.act === 'spit') for (const at of [0.8, 0.55, 0.3]) if (a.into >= at && a.into < at + 0.3) return key(`spit${at}`, at, 0.07);
  if (a.act === 'puffup' && pufferRelease(index, a.cycle) === 'burp') {
    for (let b = BURPS - 1; b >= 0; b--) {
      const at = RELEASE_AT + b * BURP_EVERY + 0.05;
      if (a.into >= at && a.into < at + 0.4) return key(`burp${b}`, at, 0.1);
    }
  }
  return null;
}

/** Sets the clips for `t`; `beat` is the distance swum. */
export function pufferFrame(rig: PufferRig, t: number, index: number, beat: number, inp: PufferInput): PufferState {
  const a = pufferAct(index, t);
  const D = rig.durations;
  for (const n of PUFFER_CLIPS) set(rig, n, 0, 0);
  const puff = pufferPuff(index, t);
  // The dial, always at full weight: no other clip moves what it moves.
  set(rig, 'puff', clamp(puff, 0, 0.999) * D.puff, 1);
  // What the act plays: its own clip, or for a show the gulps and the release.
  let clip: PufferClip | null = null, time = 0;
  if (a.act === 'puffup') {
    const u = a.into;
    if (u < HOLD_FROM) { clip = 'gulp'; time = posMod(u - 0.15, GULP_EVERY) * (D.gulp / GULP_EVERY); }
    else if (u >= RELEASE_AT) {
      const r = u - RELEASE_AT;
      if (pufferRelease(index, a.cycle) === 'zip') { clip = 'zip'; time = Math.min(r, D.zip); }
      else if (r < BURPS * BURP_EVERY) { clip = 'gulp'; time = posMod(r, BURP_EVERY) * (D.gulp / BURP_EVERY); }
    }
  } else if (a.act === 'pout') {
    if (a.into < 0.9) { clip = 'gulp'; time = posMod(a.into - 0.15, GULP_EVERY) * (D.gulp / GULP_EVERY); }
  } else if (a.act) { clip = a.act; time = a.into; }
  const w = clip ? a.weight : 0;
  const cruise = smooth((inp.pace - 0.1) / 0.5);
  const phase = t + beat * PUFFER_STROKE;
  set(rig, 'swim', posMod(phase, D.swim), (1 - w) * cruise);
  set(rig, 'hover', posMod(phase, D.hover), (1 - w) * (1 - cruise));
  if (clip) set(rig, clip, Math.min(time, D[clip]), w);
  rig.mixer.update(0);
  const face = a.act === 'kiss' || a.act === 'wave' || a.act === 'shimmy' ? a.weight : a.act === 'shy' ? a.weight * env(a.into, 0.9, 1.1, 1.4, 1.7) : 0;
  const doing: PufferDoing = a.act && a.weight > 0.02 ? a.act : cruise > 0.5 ? 'swim' : 'hover';
  const bubble = bubbleOf(index, a);
  // A bubble's time comes back relative to now: make it the moment it left.
  if (bubble) bubble.t += t;
  return { doing, act: a.act, weight: a.weight, into: a.into, cycle: a.cycle, puff, face, bubble };
}

function set(rig: PufferRig, name: PufferClip, time: number, weight: number): void {
  const a = rig.actions[name];
  a.time = time;
  a.setEffectiveWeight(weight);
}

// ---------------------------------------------------------------------------
// The eyes
// ---------------------------------------------------------------------------

/** The eye's face, from the pupil's resting centre (model units), and the pupil's size on it. */
const FACE = { x0: -5, x1: 1, y0: -4, y1: 2, pw: 2, ph: 4 };
/** How far it can look: as far as the slide reaches, and a little swivel of the eye. */
const REACH_YAW = 1.2, REACH_PITCH = 0.7;
const SLOT = 0.3;

export interface PufferLookInput {
  /** The viewer in world space, or null (riding in its eye). */
  viewer: Vector3 | null;
  state: PufferState;
}

export interface PufferLook {
  at: PufferLookAt;
  flirt: PufferFlirt | null;
  /** How shut each eye is (0 open, 1 closed), left then right. */
  lids: [number, number];
  /** Pupil size (1 rest). */
  pupil: number;
  /** Degrees between where the eyes point and the viewer (null: none in reach). */
  offViewer: number | null;
}

interface Aim { yaw: number; pitch: number; at: PufferLookAt }

const _v = new Vector3(), _w = new Vector3(), _q = new Quaternion(), _q2 = new Quaternion();

/** The viewer as an aim from eye `e` — in the model's rest axes, so a squashed or puffed body does not skew it. */
function viewerAim(e: PufferEye, viewer: Vector3): Aim | null {
  e.eye.getWorldPosition(_v);
  const d = _w.copy(viewer).sub(_v);
  e.eye.parent!.getWorldQuaternion(_q);
  d.applyQuaternion(_q.invert()).applyQuaternion(e.parentAxes);
  if (d.z < -0.2 * d.length()) return null;  // behind it
  const aim = { yaw: Math.atan2(d.x, d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)), at: 'viewer' as const };
  return Math.abs(aim.yaw) < REACH_YAW + 0.15 && Math.abs(aim.pitch) < REACH_PITCH + 0.15 ? aim : null;
}

function saccade(index: number, j: number): boolean {
  return fishHash(index * 4241 + j, 1621) < 0.35;
}
function lastSaccade(index: number, j: number): number {
  for (let k = 0; k < 24; k++) if (saccade(index, j - k)) return j - k;
  return j - 24;
}

/** Whether eye-slot `j` is one where the eyes go their own ways (a puffer's eyes can). */
function googly(index: number, j: number): boolean {
  return fishHash(index * 613 + j, 1623) < 0.18;
}

function wanderAim(index: number, j: number, side: number): Aim {
  const own = googly(index, j) ? side : 0;
  const h1 = fishHash(index * 31 + j * 3 + own, 1625), h2 = fishHash(index * 37 + j * 3 + own, 1627);
  return { yaw: (h1 * 2 - 1) * 1.0, pitch: (h2 * 2 - 1) * 0.5, at: 'wander' };
}

/** A flirt window: every few seconds with the viewer in reach, one of five looks. */
const FLIRT_SLOT = 1.6;
const FLIRT_LEN: Record<PufferFlirt, number> = { wink: 0.9, bat: 1.1, bedroom: 2.6, sideeye: 2.2, brows: 0.8 };
const FLIRTS: readonly [PufferFlirt, number][] = [['wink', 0.3], ['bat', 0.2], ['bedroom', 0.2], ['sideeye', 0.15], ['brows', 0.15]];

function flirtAt(index: number, t: number): { flirt: PufferFlirt; u: number } | null {
  const j = Math.floor(t / FLIRT_SLOT);
  for (const jj of [j, j - 1]) {
    if (fishHash(index * 911 + jj, 1631) > 0.28) continue;
    let r = fishHash(index * 919 + jj, 1633);
    const flirt = FLIRTS.find(([, w]) => (r -= w) < 0)?.[0] ?? 'wink';
    const u = t - jj * FLIRT_SLOT;
    if (u >= 0 && u <= FLIRT_LEN[flirt]) return { flirt, u };
  }
  return null;
}

const blink = (u: number, at: number, len = 0.22): number => Math.sin(Math.PI * clamp((u - at) / len, 0, 1));

/**
 * Aim, open and close the eyes for `t`. Call after the tank has placed and
 * turned the fish (world matrices current).
 */
export function pufferLook(rig: PufferRig, t: number, index: number, inp: PufferLookInput): PufferLook {
  const s = inp.state;
  const lids: [number, number] = [0, 0];
  let pupil = 1, lift = 0, at: PufferLookAt = 'wander';
  let flirt: PufferFlirt | null = null;
  let off = 0, offN = 0, anyViewer = false;
  // An everyday slow blink, every few seconds (both eyes).
  const every = 3.5 + 3 * fishHash(index, 1635);
  const b = posMod(t + fishHash(index, 1637) * every, every);
  const daily = blink(b, 0, 0.3);
  const aims: Aim[] = [];
  for (const e of rig.eyes) {
    const you = inp.viewer ? viewerAim(e, inp.viewer) : null;
    if (you) anyViewer = true;
    // The second eye a beat behind: a double take.
    const lag = e.side > 0 ? 0 : 0.05 + 0.1 * fishHash(index, 1639);
    const te = t - lag;
    const j = Math.floor(te / SLOT);
    const j1 = lastSaccade(index, j), j0 = lastSaccade(index, j1 - 1);
    const pick = (jj: number): Aim => (you && fishHash(index * 977 + jj, 1641) < 0.55 ? you : wanderAim(index, jj, e.side));
    const a0 = pick(j0), a1 = pick(j1);
    const k = smooth((te - j1 * SLOT) / 0.08);
    aims.push({ yaw: a0.yaw + (a1.yaw - a0.yaw) * k, pitch: a0.pitch + (a1.pitch - a0.pitch) * k, at: k > 0.5 ? a1.at : a0.at });
  }
  // The act's say over the eyes.
  const youL = inp.viewer && rig.eyes[0] ? viewerAim(rig.eyes[0], inp.viewer) : null;
  const youR = inp.viewer && rig.eyes[1] ? viewerAim(rig.eyes[1], inp.viewer) : null;
  const atYou = (i: number): Aim | null => (i === 0 ? youL : youR);
  const set = (i: number, a: Aim | null): void => { if (a && aims[i]) aims[i] = a; };
  const w = s.weight, u = s.into;
  switch (s.act) {
    case 'kiss': {
      // Eyes on you, shut for the pucker, open at the mwah — and a wink after.
      rig.eyes.forEach((_, i) => set(i, atYou(i)));
      const shut = env(u, 0.35, 0.5, 0.95, 1.05) * w;
      lids[0] = Math.max(shut, blink(u, 1.35, 0.35)); lids[1] = shut;
      pupil = 1.3;
      break;
    }
    case 'shy': {
      // Look away and down, then peek back through half-shut lids.
      const peek = env(u, 0.9, 1.1, 1.4, 1.7);
      rig.eyes.forEach((_, i) => set(i, peek > 0.5 ? atYou(i) : { yaw: -0.8, pitch: -0.5, at: 'away' }));
      lids[0] = lids[1] = 0.35 * w;
      pupil = 1.2;
      break;
    }
    case 'puffup': case 'pout': {
      // Wide eyes, tiny pupils as it gulps; as it zips, they roll every which way.
      pupil = 1 - 0.3 * clamp(s.puff * 1.4, 0, 1);
      if (s.act === 'puffup' && u >= RELEASE_AT && pufferRelease(index, s.cycle) === 'zip') {
        rig.eyes.forEach((e, i) => set(i, { yaw: Math.sin(t * 13 + e.side * 1.7) * 1.1, pitch: Math.cos(t * 11 + e.side) * 0.6, at: 'dizzy' }));
      }
      break;
    }
    case 'yawn': lids[0] = lids[1] = 0.75 * env(u, 0.4, 0.8, 1.5, 1.9); break;
    case 'chomp': rig.eyes.forEach((_, i) => set(i, { yaw: 0, pitch: -0.55, at: 'down' })); break;
    case 'wave': case 'shimmy': case 'bounce':
      rig.eyes.forEach((_, i) => set(i, atYou(i)));
      pupil = 1.25;
      if (s.act === 'wave') lift = env(u, 0.3, 0.42, 0.52, 0.7);
      if (s.act === 'shimmy') lids[0] = lids[1] = 0.4 * w;
      break;
    default: break;
  }
  // Flirting, when the act leaves the eyes free and the viewer is in reach.
  const free = !s.act || s.weight < 0.05 || s.act === 'spin' || s.act === 'flip' || s.act === 'spit';
  const f = free && youL && youR ? flirtAt(index, t) : null;
  if (f) {
    flirt = f.flirt;
    aims[0] = youL!; if (aims[1]) aims[1] = youR!;
    pupil = 1.35;
    const fu = f.u, len = FLIRT_LEN[f.flirt];
    const fade = env(fu, 0, 0.12, len - 0.15, len);
    if (f.flirt === 'wink') {
      // The eye nearer the viewer winks; the other smiles a little.
      const near = Math.abs(youL!.yaw) < Math.abs(youR!.yaw) ? 0 : 1;
      lids[near] = Math.max(lids[near], blink(fu, 0.2, 0.42));
      lids[1 - near] = Math.max(lids[1 - near], 0.25 * fade);
    } else if (f.flirt === 'bat') {
      const flick = blink(fu, 0.1, 0.2) + blink(fu, 0.38, 0.2) + blink(fu, 0.66, 0.2);
      lids[0] = Math.max(lids[0], 0.85 * flick); lids[1] = Math.max(lids[1], 0.85 * flick);
    } else if (f.flirt === 'bedroom') {
      const half = 0.5 * env(fu, 0.1, 0.8, 1.9, 2.5);
      lids[0] = Math.max(lids[0], half); lids[1] = Math.max(lids[1], half);
    } else if (f.flirt === 'sideeye') {
      // A sly look: pupils hard to the corner nearest you, a squint.
      for (let i = 0; i < aims.length; i++) aims[i] = { ...aims[i]!, yaw: aims[i]!.yaw * 1.6 + Math.sign(aims[i]!.yaw || 1) * 0.3 };
      lids[0] = Math.max(lids[0], 0.3 * fade); lids[1] = Math.max(lids[1], 0.3 * fade);
    } else {
      lift = Math.max(lift, env(fu, 0.05, 0.15, 0.35, 0.6));
    }
  }
  lids[0] = Math.max(lids[0], daily); lids[1] = Math.max(lids[1], daily);
  for (let i = 0; i < rig.eyes.length; i++) {
    const e = rig.eyes[i]!, aim = aims[i]!;
    if (aim.at === 'viewer') at = 'viewer'; else if (i === 0) at = aim.at;
    setEye(e, aim.yaw, aim.pitch, clamp(lids[i]!, 0, 1), pupil, lift);
    const you = atYou(i);
    if (you) { off += Math.hypot(you.yaw - clamp(aim.yaw, -REACH_YAW, REACH_YAW), you.pitch - clamp(aim.pitch, -REACH_PITCH, REACH_PITCH)); offN++; }
  }
  return {
    at, flirt, lids: [Math.round(lids[0] * 100) / 100, Math.round(lids[1] * 100) / 100],
    pupil: Math.round(pupil * 100) / 100,
    offViewer: anyViewer && offN ? Math.round((off / offN) * 180 / Math.PI) : null,
  };
}

/** Slide the pupil (most of a look), swivel the eye a little, close it, dilate it, lift it. */
function setEye(e: PufferEye, yaw: number, pitch: number, lid: number, pupil: number, lift: number): void {
  // The eye: a little swivel (it is a slab on the face; much more would dig in).
  const sy = clamp(yaw * 0.15, -0.18, 0.18), sp = clamp(pitch * 0.15, -0.12, 0.12);
  _q.setFromAxisAngle(_v.set(0, 1, 0), sy).multiply(_q2.setFromAxisAngle(_w.set(1, 0, 0), -sp));
  _q2.copy(e.eyeAxes).invert().multiply(_q).multiply(e.eyeAxes);
  e.eye.quaternion.copy(e.eyeRest.q).multiply(_q2);
  // Closing: the eye squeezes shut top to bottom (and a little in from the sides).
  const sc = e.eye.scale.copy(e.eyeRest.s);
  sc.setComponent(e.eyeUp, sc.getComponent(e.eyeUp) * (1 - 0.9 * lid));
  sc.setComponent(e.eyeSide, sc.getComponent(e.eyeSide) * (1 - 0.15 * lid));
  // An eyebrow flash: up and a touch out.
  e.eye.position.copy(e.eyeRest.p).add(_v.set(0, 0.9 * lift, 0.5 * lift).applyQuaternion(_q.copy(e.parentAxes).invert()));
  // The pupil: centred when it looks ahead, to the face's edge at the limit,
  // and a wide pupil kept on the face. The face, from the pupil's resting
  // centre: x -5..1, up -4..2 (the pupil, 2 by 4, rests in its outer top corner).
  const gx = (clamp(yaw / REACH_YAW, -1, 1) + 1) / 2, gy = (clamp(pitch / REACH_PITCH, -1, 1) + 1) / 2;
  const hw = FACE.pw / 2 * pupil, hh = FACE.ph / 2 * pupil;
  const dx = FACE.x0 + hw + (FACE.x1 - FACE.x0 - 2 * hw) * gx, dy = FACE.y0 + hh + (FACE.y1 - FACE.y0 - 2 * hh) * gy;
  _v.set(dx, dy, 0).applyQuaternion(_q.copy(e.eyeAxes).invert());
  e.pupil.position.copy(e.pupilRest.p).add(_v);
  const ps = e.pupil.scale.copy(e.pupilRest.s);
  ps.setComponent(e.pupilUp, ps.getComponent(e.pupilUp) * pupil);
  ps.setComponent(e.pupilSide, ps.getComponent(e.pupilSide) * pupil);
}
