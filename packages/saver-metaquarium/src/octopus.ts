/**
 * The octopus, alive. A floor creature, as the crab and the starfish are
 * (crab.ts): it keeps a route along its plan and goes along it in bouts,
 * stopping between them to do something. But no other creature here moves
 * three ways, and it uses them all (Huffard 2006):
 *
 *   crawl    the arms reaching and pulling in a ripple — not always the way
 *            it is looking: an octopus's heading is its own (Levy 2015)
 *   jet      mantle-first, arms trailing, going pale: it shoots up off the
 *            floor and back along its route, then parachutes down, arms
 *            spread — sometimes with a squirt of ink first
 *   tiptoe   walking backwards on its two rear arms, rolled under like treads,
 *            the other six coiled up (Abdopus, Huffard 2005)
 *
 * and at a stop: a look at you, a wave, a beckon, a reach toward something, a
 * peek (pressed flat, eyes up on stalks), a pounce (up, the web spread over,
 * down), or a nap curled up — eyes closed, pale, its colours flickering as it
 * dreams (Medeiros 2021; Pophale 2023).
 *
 * Its eyes are the octopus's own. Each pupil is a horizontal bar, and an
 * octopus's statocysts roll its eyes so the bar stays LEVEL with the world
 * however its body turns — on its back in a jet, up on two arms — up to ~80°
 * either way (Budelmann; Hanke 2019): this module turns each pupil against the
 * body's roll, every frame. It rounds the pupil when excited, slits it when
 * calm (Douglas 2020), closes its lids, raises its eyes on stalks to peek, and
 * lifts its brows — one, when curious. One eye is its favourite (most
 * octopuses have one: Byrne 2004).
 *
 * Its skin (octopusSkin, setOctopusSkin): pale in a jet and asleep, flushed
 * when excited, fading toward the floor's colour when it sits still, dream
 * colours asleep, and passing clouds — dark bands that run from the back of
 * the mantle forward and out along the arms (Mather 2004) — when it hunts.
 * Its rings glow brighter when alarmed, after the blue-ringed octopus.
 *
 * Everything is a closed form in t: the schedule hashed per (octopus, cycle),
 * the route the integral of a stop-and-go pace, every clip's time and weight
 * SET each frame, then `mixer.update(0)`.
 */
import {
  AnimationMixer, Box3, Color, Euler, Matrix4, Quaternion, Vector3,
  type AnimationAction, type AnimationClip, type Material, type MeshBasicMaterial, type Object3D,
} from 'three';
import { boutDistance, boutSpeed, type CrabInput } from './crab';
import { stackPatch } from './hooks';
import { swimPoseAtDistance, type SwimPlan } from './plan';
import { fishHash } from './swim';

export const OCTOPUS_CLIPS = ['idle', 'crawl', 'jet', 'drift', 'tiptoe', 'wave', 'beckon', 'reach', 'peek', 'ink', 'pounce', 'sleep'] as const;
export type OctopusClip = (typeof OCTOPUS_CLIPS)[number];
export type OctopusGait = 'crawl' | 'jet' | 'inkjet' | 'tiptoe';
export type OctopusStop = 'idle' | 'look' | 'wave' | 'beckon' | 'reach' | 'peek' | 'pounce' | 'sleep';
export type OctopusDoing = 'crawl' | 'jet' | 'ink' | 'drift' | 'tiptoe' | 'turn' | OctopusStop;
export type OctopusLookAt = 'wander' | 'viewer' | 'down' | 'closed';

export interface OctopusEye {
  eye: Object3D;
  pupil: Object3D;
  brow: Object3D | null;
  side: 1 | -1;
  eyeRest: { q: Quaternion; p: Vector3; s: Vector3 };
  pupilRest: { q: Quaternion; p: Vector3; s: Vector3 };
  browRest: Vector3 | null;
  /** Rest rotations in the model's axes: the eye's parent, the eye, the pupil, the brow's parent. */
  parentAxes: Quaternion;
  eyeAxes: Quaternion;
  pupilAxes: Quaternion;
  browParentAxes: Quaternion;
  eyeUp: 0 | 1 | 2;
  eyeSide: 0 | 1 | 2;
  pupilUp: 0 | 1 | 2;
  pupilSide: 0 | 1 | 2;
}

export interface OctopusRig {
  mixer: AnimationMixer;
  actions: Record<OctopusClip, AnimationAction>;
  durations: Record<OctopusClip, number>;
  /** The ground point under the crown's centre, in model space: what the tank stands on the floor. */
  anchor: Vector3;
  norm: number;
  eyes: OctopusEye[];
  siphon: Object3D | null;
  /** Its favourite eye: +1 the left, -1 the right. */
  favourite: 1 | -1;
}

const named = (root: Object3D, name: string): Object3D | undefined =>
  root.getObjectByName(name.replace('.', '')) ?? root.getObjectByName(name);

/** Rigged at identity, before the tank scales and turns the body. */
export function rigOctopus(body: Object3D, clips: readonly AnimationClip[], norm: number, index = 0): OctopusRig | null {
  const byName = new Map(clips.map((c) => [c.name, c]));
  if (!OCTOPUS_CLIPS.every((n) => byName.has(n))) return null;
  const crown = named(body, 'body');
  if (!crown) return null;
  body.updateMatrixWorld(true);
  const centre = crown.getWorldPosition(new Vector3());
  const floor = new Box3().setFromObject(body).min.y;
  const mixer = new AnimationMixer(body);
  const actions = {} as Record<OctopusClip, AnimationAction>;
  const durations = {} as Record<OctopusClip, number>;
  for (const n of OCTOPUS_CLIPS) {
    const a = mixer.clipAction(byName.get(n)!);
    a.play();
    a.setEffectiveWeight(0);
    actions[n] = a;
    durations[n] = byName.get(n)!.duration;
  }
  const toModel = new Matrix4().copy(body.matrixWorld).invert();
  const modelQ = (o: Object3D): Quaternion => {
    const m = new Matrix4().multiplyMatrices(toModel, o.matrixWorld);
    return new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(m));
  };
  const axisAlong = (q: Quaternion, v: Vector3): 0 | 1 | 2 => {
    const e = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)].map((a) => Math.abs(a.applyQuaternion(q).dot(v)));
    return e.indexOf(Math.max(...e)) as 0 | 1 | 2;
  };
  const UP = new Vector3(0, 1, 0), SIDE = new Vector3(1, 0, 0);
  const eyes: OctopusEye[] = [];
  for (const [side, s] of [['L', 1], ['R', -1]] as const) {
    const eye = named(body, `eye.${side}`), pupil = named(body, `pupil.${side}`), brow = named(body, `brow.${side}`) ?? null;
    if (!eye || !pupil || !eye.parent) continue;
    const eyeAxes = modelQ(eye), pupilAxes = modelQ(pupil);
    eyes.push({
      eye, pupil, brow, side: s,
      eyeRest: { q: eye.quaternion.clone(), p: eye.position.clone(), s: eye.scale.clone() },
      pupilRest: { q: pupil.quaternion.clone(), p: pupil.position.clone(), s: pupil.scale.clone() },
      browRest: brow ? brow.position.clone() : null,
      parentAxes: modelQ(eye.parent), eyeAxes, pupilAxes,
      browParentAxes: brow?.parent ? modelQ(brow.parent) : new Quaternion(),
      eyeUp: axisAlong(eyeAxes, UP), eyeSide: axisAlong(eyeAxes, SIDE),
      pupilUp: axisAlong(pupilAxes, UP), pupilSide: axisAlong(pupilAxes, SIDE),
    });
  }
  return {
    mixer, actions, durations, anchor: new Vector3(centre.x, floor, centre.z), norm, eyes,
    siphon: named(body, 'siphon') ?? null, favourite: fishHash(index, 1701) < 0.55 ? 1 : -1,
  };
}

// ---------------------------------------------------------------------------
// The schedule
// ---------------------------------------------------------------------------

/** World units a bout covers per second of crawling: a bit slower than the starfish. */
export const OCTOPUS_PACE = 0.27 * 16.2;
const TURN_IN = 1.0;
const TURN_OUT = 1.2;
/** A jet's push: seconds of it, and how high it rises (body lengths). */
const JET = 1.6;
const JET_HIGH = 1.4;
/** An inked jet squirts first: the ink clip's length. */
const INK_LEAD = 1.1;

const GAITS: readonly [OctopusGait, number][] = [['crawl', 0.5], ['jet', 0.22], ['inkjet', 0.08], ['tiptoe', 0.2]];
const STOPS: readonly [OctopusStop, number][] = [
  ['look', 0.14], ['wave', 0.13], ['beckon', 0.12], ['reach', 0.14], ['peek', 0.13], ['pounce', 0.1], ['idle', 0.12], ['sleep', 0.12],
];
/** Each stop's activity: its clip, and how long it holds the stop. */
const STOP_LEN: Record<OctopusStop, number> = { idle: 3, look: 3.4, wave: 2.0, beckon: 2.2, reach: 2.4, peek: 3.0, pounce: 2.2, sleep: 8 };

export interface OctopusCycle { move: number; stop: number; offset: number }

export function octopusCycle(index: number): OctopusCycle {
  const move = 4.5 + 2.5 * fishHash(index, 1703);
  // A turn in, the longest activity (a nap) with its fades, and a turn out.
  const stop = TURN_IN + STOP_LEN.sleep + 1 + TURN_OUT + 1.5 * fishHash(index, 1705);
  return { move, stop, offset: fishHash(index, 1707) * (move + stop) };
}

export function octopusGait(index: number, k: number): OctopusGait {
  let r = fishHash(index * 7919 + k, 1709);
  return GAITS.find(([, w]) => (r -= w) < 0)?.[0] ?? 'crawl';
}

export function octopusStopAt(index: number, k: number): OctopusStop {
  let r = fishHash(index * 7907 + k, 1711);
  return STOPS.find(([, w]) => (r -= w) < 0)?.[0] ?? 'idle';
}

/** Which way it faces as it goes, against its travel (radians): ahead, sometimes sidelong; a jet and a tiptoe go backwards. */
export function octopusHeading(index: number, k: number): number {
  const g = octopusGait(index, k);
  if (g !== 'crawl') return Math.PI;
  const h = fishHash(index * 104729 + k, 1713);
  return h < 0.6 ? 0 : h < 0.8 ? 1.1 : -1.1;
}

const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const posMod = (v: number, m: number): number => ((v % m) + m) % m;
const wrap = (a: number): number => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;
const env = (u: number, a: number, b: number, c: number, d: number): number => smooth((u - a) / (b - a)) * (1 - smooth((u - c) / (d - c)));
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

export interface OctopusMoment {
  k: number;
  /** Seconds into the bout, and how far along it (0..1 of its distance). */
  u: number;
  progress: number;
  gait: OctopusGait;
  /** 0..1, how hard it is moving now. */
  speed: number;
  /** How high a jet has it (0..1 of JET_HIGH). */
  lift: number;
  /** Seconds into the stop (negative while moving). */
  intoStop: number;
}

/** Where in its bout the jet's push starts: an inked jet squirts first. */
const jetStart = (g: OctopusGait): number => (g === 'inkjet' ? INK_LEAD : 0);

export function octopusMoment(index: number, t: number): OctopusMoment {
  const c = octopusCycle(index);
  const P = c.move + c.stop;
  const tau = t + c.offset;
  const k = Math.floor(tau / P);
  const u = tau - k * P;
  const gait = octopusGait(index, k);
  let progress = 0, speed = 0, lift = 0;
  if (gait === 'jet' || gait === 'inkjet') {
    const j0 = jetStart(gait);
    progress = boutDistance(u - j0, JET) / boutDistance(JET, JET);
    speed = boutSpeed(u - j0, JET);
    // Up in the push, then down slowly under the spread arms, landing as the move ends.
    lift = u < j0 ? 0 : u < j0 + JET ? smooth((u - j0) / JET) : 1 - smooth((u - j0 - JET) / Math.max(0.5, c.move - j0 - JET));
  } else {
    progress = boutDistance(u, c.move) / boutDistance(c.move, c.move);
    speed = boutSpeed(u, c.move);
  }
  return { k, u, progress: Math.min(1, progress), gait, speed, lift: u < c.move ? lift : 0, intoStop: u - c.move };
}

/** Where along the plan its route starts: spread by index. */
export function octopusStart(plan: SwimPlan, index: number): number {
  return fishHash(index, 1715) * plan.totalLength;
}

/** Route distance per bout (every bout covers the same, crawled or jetted). */
const perBout = (index: number): number => {
  const c = octopusCycle(index);
  return boutDistance(c.move, c.move) * OCTOPUS_PACE;
};

/** Where its route puts it at `t`, before it minds the others; `back` units further back for a trail. */
export function octopusSpot(index: number, t: number, plan: SwimPlan, start: number, back = 0): { x: number; z: number; fx: number; fz: number } {
  const m = octopusMoment(index, t);
  const pose = swimPoseAtDistance(plan, start + (m.k + m.progress) * perBout(index) - back);
  const l = Math.hypot(pose.fx, pose.fz) || 1;
  return { x: pose.x, z: pose.z, fx: pose.fx / l, fz: pose.fz / l };
}

// ---------------------------------------------------------------------------
// Its colours
// ---------------------------------------------------------------------------

/**
 * What an octopus can turn: rich colours, far apart round the wheel. Each
 * octopus draws a few of these as its own repertoire (with the coat the tank
 * dressed it in), and changes between them — an octopus can change its whole
 * colour in a fraction of a second (chromatophores, ~0.3 s: Reiter 2018); here
 * as a wave that sweeps down it from the top of its head to its arm tips.
 */
export const OCTOPUS_COATS = [
  '#ff4f6d', '#b44dff', '#21c7b8', '#ffb23f', '#ff4fc8', '#3f6dff', '#6edc3c', '#ff7a3d', '#7a3dff', '#e0384e', '#18a8ff', '#ffd23f',
] as const;
/** How many colours it has besides its own coat. */
const REPERTOIRE = 4;
/** Seconds a change takes to sweep from its head to its arm tips. */
export const OCTOPUS_SHIFT = 1.2;

/** This octopus's own colours: indices into OCTOPUS_COATS, distinct. */
export function octopusRepertoire(index: number): number[] {
  const out: number[] = [];
  for (let n = 0; out.length < REPERTOIRE && n < 64; n++) {
    const c = Math.floor(fishHash(index * 131 + n, 1741) * OCTOPUS_COATS.length);
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

/** The colour changes in cycle k: (seconds into the cycle) — at most stops, sometimes mid-crawl. */
function shiftsIn(index: number, k: number): number[] {
  const c = octopusCycle(index), out: number[] = [];
  if (octopusGait(index, k) === 'crawl' && fishHash(index * 433 + k, 1743) < 0.4) out.push(c.move * 0.5);
  if (fishHash(index * 439 + k, 1745) < 0.75) out.push(c.move + TURN_IN * 0.4);
  return out;
}

/** The coat a change puts on: 0 its own, 1.. its repertoire. Its own hash
 *  alone, so any frame agrees on it (now and then the same coat again: a
 *  change you do not see). */
function coatOf(index: number, k: number, slot: number): number {
  return Math.floor(fishHash(index * 911 + k * 3 + slot, 1747) * (REPERTOIRE + 1));
}

export interface OctopusCoat {
  /** The coat it is changing from, and to: 0 its own (as dressed), 1.. its repertoire. */
  from: number;
  to: number;
  /** How far the change has swept (0 just begun, 1 done). */
  wave: number;
}

/** Its colour at `t`: the last change and the one before it. A closed form: the changes are hashed per cycle. */
export function octopusCoat(index: number, t: number): OctopusCoat {
  const c = octopusCycle(index), P = c.move + c.stop;
  const tau = t + c.offset, k = Math.floor(tau / P), u = tau - k * P;
  // Back through the cycles until two are found (most cycles have one; a long run of none is rare, but still has a last change).
  const found: { kk: number; slot: number; when: number }[] = [];
  for (let kk = k; kk > k - 64 && found.length < 2; kk--) {
    const list = shiftsIn(index, kk);
    for (let slot = list.length - 1; slot >= 0 && found.length < 2; slot--) {
      if (kk === k && list[slot]! > u) continue;
      found.push({ kk, slot, when: kk * P + list[slot]! });
    }
  }
  const [last, before] = found;
  const coat = last ? coatOf(index, last.kk, last.slot) : 0;
  const prevCoat = before ? coatOf(index, before.kk, before.slot) : 0;
  const at = last ? last.when : -Infinity;
  const wave = Math.min(1, Math.max(0, (tau - at) / OCTOPUS_SHIFT));
  return { from: prevCoat, to: coat, wave };
}

// ---------------------------------------------------------------------------
// The frame
// ---------------------------------------------------------------------------

export type OctopusInput = CrabInput;

/** How it feels, for its skin and its rings (setOctopusSkin). */
export interface OctopusMood {
  pale: number;
  flush: number;
  /** Toward the floor's colour. */
  camo: number;
  /** Passing clouds: how dark the bands, and where they are (radians of phase). */
  cloud: number;
  cloudPhase: number;
  /** Dreaming: how much its colours wander, and which way. */
  dream: number;
  dreamHue: number;
  /** Its rings' glow (1 = full). */
  rings: number;
}

export interface OctopusOutput {
  x: number; y: number; z: number;
  quaternion: Quaternion;
  fx: number; fz: number;
  tx: number; tz: number;
  trailX: number; trailZ: number;
  /** The floor under it (a jet lifts it above). */
  groundY: number;
  /** How high it is off the floor (0..1 of a jet's height). */
  lift: number;
  doing: OctopusDoing;
  /** What it is doing, in the terms its eyes need. */
  stop: OctopusStop | null;
  intoActivity: number;
  mood: OctopusMood;
  /** Ink to let go: its key and when (the tank's InkLayer). */
  ink: { key: string; t: number } | null;
  /** Its colour, changing (setOctopusSkin). */
  coat: OctopusCoat;
}

export function newOctopusOutput(): OctopusOutput {
  return {
    x: 0, y: 0, z: 0, quaternion: new Quaternion(), fx: 0, fz: 1, tx: 0, tz: 1, trailX: 0, trailZ: 0, groundY: 0, lift: 0,
    doing: 'idle', stop: null, intoActivity: 0,
    mood: { pale: 0, flush: 0, camo: 0, cloud: 0, cloudPhase: 0, dream: 0, dreamHue: 0, rings: 0.3 }, ink: null,
    coat: { from: 0, to: 0, wave: 1 },
  };
}

/** A placed octopus (a vignette's, or a formation's): at rest, still looking about and changing colour. */
export function octopusPlaced(index: number, t: number, out: OctopusOutput): OctopusOutput {
  out.doing = 'idle'; out.stop = null; out.intoActivity = 0; out.lift = 0; out.ink = null;
  const m = out.mood;
  m.pale = 0; m.flush = 0; m.camo = 0; m.cloud = 0; m.cloudPhase = 0; m.dream = 0; m.dreamHue = 0; m.rings = 0.3;
  out.coat = octopusCoat(index, t);
  return out;
}

const ROOM = 1.2;
const euler = new Euler(0, 0, 0, 'YXZ');
/** Stops it turns to face the viewer for. */
const FACES: ReadonlySet<OctopusStop> = new Set(['look', 'wave', 'beckon', 'reach', 'peek']);

export function octopusFrame(rig: OctopusRig, inp: OctopusInput, out: OctopusOutput): OctopusOutput {
  const { index, t, len } = inp;
  const c = octopusCycle(index);
  const m = octopusMoment(index, t);
  const pose = octopusSpot(index, t, inp.plan, inp.start);
  let x = pose.x, z = pose.z;
  // Elbow room, the crab's way (pure in t: the others' spots are their closed forms).
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
  const moveYaw = travel + octopusHeading(index, m.k);
  let yaw = moveYaw;
  let doing: OctopusDoing = m.gait === 'inkjet' ? (m.u < INK_LEAD ? 'ink' : m.u < INK_LEAD + JET ? 'jet' : 'drift')
    : m.gait === 'jet' ? (m.u < JET ? 'jet' : 'drift') : m.gait;
  let stop: OctopusStop | null = null;
  let intoActivity = 0;
  if (m.intoStop >= 0) {
    stop = octopusStopAt(index, m.k);
    const faceCam = FACES.has(stop) && Number.isFinite(inp.camX);
    const faceYaw = faceCam ? Math.atan2(inp.camX - x, inp.camZ - z) : moveYaw;
    const nextYaw = travel + octopusHeading(index, m.k + 1);
    const dIn = wrap(faceYaw - moveYaw);
    let dOut = wrap(nextYaw - faceYaw);
    if (Math.abs(Math.abs(dOut) - Math.PI) < 1e-3) dOut = Math.PI;
    const a = m.intoStop / TURN_IN, b = (m.intoStop - (c.stop - TURN_OUT)) / TURN_OUT;
    yaw = moveYaw + dIn * smooth(a) + dOut * smooth(b);
    intoActivity = m.intoStop - TURN_IN;
    // The activity lasts as long as it does (a nap fills the stop); after it,
    // it just sits — breathing, looking about — until it turns to go.
    // Its idle begins there, so its mood (the camouflage) ramps in from nothing
    // rather than jumping to the plateau the fade-out just left.
    if (stop !== 'sleep' && intoActivity > STOP_LEN[stop] + 0.4) { intoActivity -= STOP_LEN[stop] + 0.4; stop = 'idle'; }
    doing = (a < 1 && Math.abs(dIn) > 0.05) || (b > 0 && Math.abs(dOut) > 0.05) ? 'turn' : stop;
  }
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const rx = fz, rz = -fx;
  // On the ground, tilted with it (the crab's footprint rule); a jet lifts it.
  const g = inp.ground;
  const lf = len * 0.35, ls = len * 0.35;
  const hc = g(x, z);
  const hf = g(x + fx * lf, z + fz * lf), hb = g(x - fx * lf, z - fz * lf);
  const hr = g(x + rx * ls, z + rz * ls), hl = g(x - rx * ls, z - rz * ls);
  const ground = Math.max(hc, (hf + hb) / 2, (hr + hl) / 2);
  const settle = 1 - m.lift;
  const lim = 0.6;
  const pitch = clamp(Math.atan2(hf - hb, 2 * lf), -lim, lim) * settle;
  const roll = clamp(Math.atan2(hr - hl, 2 * ls), -lim, lim) * settle;
  euler.set(-pitch, yaw, roll);
  out.quaternion.setFromEuler(euler);
  out.x = x; out.z = z; out.groundY = ground;
  out.lift = m.lift;
  out.y = ground + m.lift * JET_HIGH * len;
  out.fx = fx; out.fz = fz;
  out.tx = pose.fx; out.tz = pose.fz;
  const trail = octopusSpot(index, t, inp.plan, inp.start, len * 2);
  out.trailX = trail.x + (x - pose.x); out.trailZ = trail.z + (z - pose.z);
  out.doing = doing; out.stop = stop; out.intoActivity = intoActivity;

  // ---- Clips -------------------------------------------------------------
  const D = rig.durations;
  for (const n of OCTOPUS_CLIPS) set(rig, n, 0, 0);
  let used = 0;
  const moving = m.intoStop < 0;
  if (moving && (m.gait === 'crawl' || m.gait === 'tiptoe')) {
    // The ripple and the treads run on distance, so the arms never slide.
    const stepped = boutDistance(m.u, c.move) * OCTOPUS_PACE;
    const stride = (m.gait === 'crawl' ? 0.55 : 0.4) * len;
    const w = m.gait === 'tiptoe' ? smooth(m.u / 0.6) * smooth((c.move - m.u) / 0.6) : m.speed;
    set(rig, m.gait, posMod((stepped / stride) * D[m.gait], D[m.gait]), w);
    used = w;
  } else if (moving) {
    const j0 = jetStart(m.gait);
    const wi = m.gait === 'inkjet' ? env(m.u, 0, 0.15, INK_LEAD - 0.1, INK_LEAD + 0.15) : 0;
    const wj = env(m.u, j0, j0 + 0.25, j0 + JET, j0 + JET + 0.35);
    const wd = env(m.u, j0 + JET - 0.1, j0 + JET + 0.35, c.move - 0.5, c.move);
    // The ink hands to the jet, the jet to the drift: where two overlap, they share.
    const over = Math.max(1, wi + wj + wd);
    if (wi) set(rig, 'ink', Math.min(m.u, D.ink), wi / over);
    set(rig, 'jet', posMod(m.u - j0, D.jet), wj / over);
    set(rig, 'drift', posMod(m.u, D.drift), wd / over);
    used = (wi + wj + wd) / over;
  } else if (stop && stop !== 'idle' && stop !== 'look') {
    const len2 = stop === 'sleep' ? STOP_LEN.sleep : D[stop];
    const w = smooth(intoActivity / (stop === 'sleep' ? 1 : 0.25)) * smooth((len2 + 0.3 - intoActivity) / (stop === 'sleep' ? 1 : 0.3));
    set(rig, stop, stop === 'sleep' ? posMod(intoActivity, D.sleep) : clamp(intoActivity, 0, D[stop]), w);
    used = w;
  }
  set(rig, 'idle', posMod(t + fishHash(index, 1717) * D.idle, D.idle), Math.max(0, 1 - used));
  rig.mixer.update(0);

  // ---- Mood ----------------------------------------------------------------
  const md = out.mood;
  const jetting = moving && (m.gait === 'jet' || m.gait === 'inkjet') ? env(m.u, jetStart(m.gait), jetStart(m.gait) + 0.3, jetStart(m.gait) + JET + 0.4, c.move) : 0;
  const inking = moving && m.gait === 'inkjet' ? env(m.u, 0.3, 0.5, 0.9, 1.4) : 0;
  const act = (s: OctopusStop): number => (stop === s ? env(intoActivity, 0, 0.5, STOP_LEN[s] - 0.3, STOP_LEN[s] + 0.4) : 0);
  const sleeping = act('sleep');
  md.pale = Math.max(0.75 * jetting, inking, 0.6 * sleeping);
  md.flush = Math.max(0.7 * act('pounce'), 0.35 * act('wave'), 0.35 * act('beckon'));
  md.camo = Math.max(0.55 * act('idle'), 0.45 * act('look'), 0.6 * act('peek'));
  md.cloud = Math.max(act('reach'), 0.9 * act('pounce'));
  md.cloudPhase = t * Math.PI * 2 * 1.1;
  // Asleep: a quiet pale, and now and then a bout of dream colours (Medeiros 2021: a short active bout amid the quiet).
  const dreamAt = posMod(intoActivity, 4.5);
  md.dream = sleeping * env(dreamAt, 1.2, 1.6, 2.8, 3.4);
  md.dreamHue = Math.sin(t * 2.3 + index) * 0.5;
  md.rings = Math.max(0.3, inking, 0.8 * jetting * (1 - smooth((m.u - jetStart(m.gait) - 0.6) / 0.5)), 0.6 * act('pounce'));
  out.ink = moving && m.gait === 'inkjet' && m.u >= 0.55 && m.u < 2.5 ? { key: `${index}:${m.k}`, t: t - (m.u - 0.55) } : null;
  out.coat = octopusCoat(index, t);
  return out;
}

function set(rig: OctopusRig, name: OctopusClip, time: number, weight: number): void {
  const a = rig.actions[name];
  a.time = time;
  a.setEffectiveWeight(weight);
}

/** An octopus the tank is placing itself (a script's actor, a formation's seat): idle on the spot. */
export function octopusIdle(rig: OctopusRig, t: number, index: number): void {
  const D = rig.durations;
  for (const n of OCTOPUS_CLIPS) set(rig, n, 0, 0);
  set(rig, 'idle', posMod(t + fishHash(index, 1717) * D.idle, D.idle), 1);
  rig.mixer.update(0);
}

// ---------------------------------------------------------------------------
// The eyes
// ---------------------------------------------------------------------------

/** The eye's face around its pupil's resting centre (model units), and the pupil's size on it. */
const FACE = { x0: -4, x1: 4, y0: -3, y1: 3, pw: 4, ph: 2 };
/** As far as an octopus can roll its eye to keep the pupil level (Budelmann: ~80°). */
const LEVEL_LIMIT = (80 * Math.PI) / 180;
const REACH_YAW = 1.1, REACH_PITCH = 0.7;
const SLOT = 0.45;

export interface OctopusLookInput {
  viewer: Vector3 | null;
  state: OctopusOutput;
}

export interface OctopusLook {
  at: OctopusLookAt;
  /** Lids, left then right (0 open, 1 shut). */
  lids: [number, number];
  /** Pupil height (1 the resting bar; 2+ round). */
  pupil: number;
  /** Degrees the pupils turn to stay level, and how far the body is rolled from upright (the left eye's). */
  pupilRoll: number;
  bodyRoll: number;
  offViewer: number | null;
}

interface Aim { yaw: number; pitch: number; at: OctopusLookAt }

const _v = new Vector3(), _w = new Vector3(), _q = new Quaternion(), _q2 = new Quaternion(), _q3 = new Quaternion();
const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);

function viewerAim(e: OctopusEye, viewer: Vector3): Aim | null {
  e.eye.getWorldPosition(_v);
  const d = _w.copy(viewer).sub(_v);
  e.eye.parent!.getWorldQuaternion(_q);
  d.applyQuaternion(_q.invert()).applyQuaternion(e.parentAxes);
  if (d.z < -0.2 * d.length()) return null;
  const aim = { yaw: Math.atan2(d.x, d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)), at: 'viewer' as const };
  return Math.abs(aim.yaw) < REACH_YAW + 0.15 && Math.abs(aim.pitch) < REACH_PITCH + 0.15 ? aim : null;
}

/**
 * How far the eye's face is rolled from level, about the way it looks: the
 * world's up seen in the face's own axes. The pupil turns back by as much
 * (within LEVEL_LIMIT) — what a statocyst does for a real octopus.
 */
export function eyeRoll(e: OctopusEye): number {
  e.eye.getWorldQuaternion(_q);
  // The face's right and up in the world: the model's +x and +y carried
  // through the eye (its world rotation, undoing its rest axes).
  _q2.copy(_q).multiply(_q3.copy(e.eyeAxes).invert());
  const a = _v.copy(X).applyQuaternion(_q2).y;
  const b = _w.copy(Y).applyQuaternion(_q2).y;
  return Math.atan2(a, b);
}

function saccade(index: number, j: number): boolean {
  return fishHash(index * 4241 + j, 1721) < 0.28;
}
function lastSaccade(index: number, j: number): number {
  for (let k = 0; k < 24; k++) if (saccade(index, j - k)) return j - k;
  return j - 24;
}

export function octopusLook(rig: OctopusRig, t: number, index: number, inp: OctopusLookInput): OctopusLook {
  const s = inp.state;
  const lids: [number, number] = [0, 0];
  let pupil = 1, periscope = 0;
  const brows: [number, number] = [0, 0];
  const you = rig.eyes.map((e) => (inp.viewer ? viewerAim(e, inp.viewer) : null));
  const aims: Aim[] = rig.eyes.map((e, i) => {
    // Its favourite eye finds you more; the other wanders more: lateralised.
    const fav = e.side === rig.favourite;
    const lag = fav ? 0 : 0.08 + 0.1 * fishHash(index, 1723);
    const te = t - lag;
    const j = Math.floor(te / SLOT);
    const j1 = lastSaccade(index, j), j0 = lastSaccade(index, j1 - 1);
    const pick = (jj: number): Aim => {
      if (you[i] && fishHash(index * 977 + jj, 1725) < (fav ? 0.6 : 0.4)) return you[i]!;
      const own = fishHash(index * 613 + jj, 1727) < 0.3 ? e.side : 0;
      return { yaw: (fishHash(index * 31 + jj * 3 + own, 1729) * 2 - 1) * 0.9, pitch: (fishHash(index * 37 + jj * 3 + own, 1731) * 2 - 1) * 0.45, at: 'wander' };
    };
    const a0 = pick(j0), a1 = pick(j1);
    const k = smooth((te - j1 * SLOT) / 0.09);
    return { yaw: a0.yaw + (a1.yaw - a0.yaw) * k, pitch: a0.pitch + (a1.pitch - a0.pitch) * k, at: k > 0.5 ? a1.at : a0.at };
  });
  const toYou = (): void => { rig.eyes.forEach((_, i) => { if (you[i]) aims[i] = you[i]!; }); };
  const u = s.intoActivity;
  const act = (n: OctopusStop): number => (s.stop === n ? env(u, 0, 0.4, STOP_LEN[n] - 0.3, STOP_LEN[n] + 0.4) : 0);
  // Brows up a little whenever it looks at you, one higher when it is curious.
  switch (s.stop) {
    case 'look': toYou(); brows[0] = brows[1] = 0.6 * act('look'); brows[rig.favourite > 0 ? 0 : 1] = act('look'); pupil = 1.6; break;
    case 'wave': case 'beckon': toYou(); brows[0] = brows[1] = act(s.stop); pupil = 1.8; break;
    case 'reach': rig.eyes.forEach((_, i) => { aims[i] = { yaw: 0.15 * rig.eyes[i]!.side * -1, pitch: -0.1, at: 'wander' }; }); pupil = 2.2; brows[0] = brows[1] = 0.5 * act('reach'); break;
    case 'peek': {
      // Pressed flat, the eyes up on their stalks, looking round.
      periscope = act('peek');
      toYou();
      brows[0] = brows[1] = periscope;
      break;
    }
    case 'pounce': pupil = 2.4; brows[0] = brows[1] = 0.4 * act('pounce'); rig.eyes.forEach((_, i) => { aims[i] = { yaw: 0, pitch: -0.5, at: 'down' }; }); break;
    case 'sleep': {
      // Eyes shut (O. laqueus sleeps so: Pophale 2023) — and they twitch as it dreams.
      const shut = act('sleep');
      lids[0] = lids[1] = shut * (1 - 0.6 * s.mood.dream);
      pupil = 0.7;
      break;
    }
    default: if (s.doing === 'jet' || s.doing === 'ink') pupil = 0.6; break;
  }
  // A slow blink now and then (an octopus has a ring of lid it closes).
  const every = 6 + 4 * fishHash(index, 1733);
  const b = posMod(t + fishHash(index, 1735) * every, every);
  const blink = Math.sin(Math.PI * clamp(b / 0.35, 0, 1));
  lids[0] = Math.max(lids[0], blink); lids[1] = Math.max(lids[1], blink);
  let off = 0, offN = 0, pupilRoll = 0, bodyRoll = 0;
  let at: OctopusLookAt = s.stop === 'sleep' && lids[0] > 0.8 ? 'closed' : 'wander';
  rig.eyes.forEach((e, i) => {
    const aim = aims[i]!;
    if (at !== 'closed' && (aim.at === 'viewer' || (i === 0 && at === 'wander'))) at = aim.at;
    // The eye first (its swivel turns its face too), then the pupil, turned
    // against the face's roll as it now is.
    setEyeBox(e, aim.yaw, aim.pitch, clamp(lids[i]!, 0, 1), periscope, brows[i]!);
    e.eye.updateMatrixWorld(false);
    const roll = eyeRoll(e);
    const turn = clamp(-roll, -LEVEL_LIMIT, LEVEL_LIMIT);
    if (i === 0) { pupilRoll = turn; bodyRoll = roll; }
    setPupil(e, aim.yaw, aim.pitch, pupil, turn);
    if (you[i]) { off += Math.hypot(you[i]!.yaw - clamp(aim.yaw, -REACH_YAW, REACH_YAW), you[i]!.pitch - clamp(aim.pitch, -REACH_PITCH, REACH_PITCH)); offN++; }
  });
  const deg = (r: number): number => Math.round((r * 180) / Math.PI);
  return {
    at, lids: [Math.round(lids[0] * 100) / 100, Math.round(lids[1] * 100) / 100], pupil: Math.round(pupil * 100) / 100,
    pupilRoll: deg(pupilRoll), bodyRoll: deg(bodyRoll), offViewer: offN ? deg(off / offN) : null,
  };
}

function setEyeBox(e: OctopusEye, yaw: number, pitch: number, lid: number, periscope: number, brow: number): void {
  // The eye: a little swivel, closing top to bottom, up on its stalk to peek.
  const sy = clamp(yaw * 0.15, -0.16, 0.16), sp = clamp(pitch * 0.15, -0.1, 0.1);
  _q.setFromAxisAngle(Y, sy).multiply(_q2.setFromAxisAngle(X, -sp));
  _q2.copy(e.eyeAxes).invert().multiply(_q).multiply(e.eyeAxes);
  e.eye.quaternion.copy(e.eyeRest.q).multiply(_q2);
  const sc = e.eye.scale.copy(e.eyeRest.s);
  sc.setComponent(e.eyeUp, sc.getComponent(e.eyeUp) * (1 - 0.9 * lid));
  e.eye.position.copy(e.eyeRest.p).add(_v.set(0, 3.2 * periscope, 0.6 * periscope).applyQuaternion(_q.copy(e.parentAxes).invert()));
  // The brow: up with interest (and with the eye, on its stalk).
  if (e.brow && e.browRest) e.brow.position.copy(e.browRest).add(_v.set(0, 1.4 * brow + 3.2 * periscope, 0).applyQuaternion(_q.copy(e.browParentAxes).invert()));
}

function setPupil(e: OctopusEye, yaw: number, pitch: number, pupil: number, roll: number): void {
  // The pupil: turned level, kept on the face (a turned bar reaches further up and down), slid to look.
  const h = FACE.ph * pupil, w = FACE.pw;
  const c = Math.abs(Math.cos(roll)), sn = Math.abs(Math.sin(roll));
  const hw = (w / 2) * c + (h / 2) * sn, hh = (w / 2) * sn + (h / 2) * c;
  const gx = (clamp(yaw / REACH_YAW, -1, 1) + 1) / 2, gy = (clamp(pitch / REACH_PITCH, -1, 1) + 1) / 2;
  const lo = (a: number, b: number, half: number, g: number): number => {
    const min = a + half, max = b - half;
    return min > max ? (a + b) / 2 : min + (max - min) * g;
  };
  _v.set(lo(FACE.x0, FACE.x1, hw, gx), lo(FACE.y0, FACE.y1, hh, gy), 0).applyQuaternion(_q.copy(e.eyeAxes).invert());
  e.pupil.position.copy(e.pupilRest.p).add(_v);
  _q.setFromAxisAngle(Z, roll);
  _q2.copy(e.pupilAxes).invert().multiply(_q).multiply(e.pupilAxes);
  e.pupil.quaternion.copy(e.pupilRest.q).multiply(_q2);
  const ps = e.pupil.scale.copy(e.pupilRest.s);
  ps.setComponent(e.pupilUp, ps.getComponent(e.pupilUp) * pupil);
}

// ---------------------------------------------------------------------------
// The skin
// ---------------------------------------------------------------------------

export interface OctopusSkin {
  parts: { mat: MeshBasicMaterial; base: Color; secondary: boolean; old: { value: Color } }[];
  /** Its repertoire as colours, primary and secondary: [coat][0 primary | 1 secondary]. Coat 0 is its own, per part. */
  coats: [Color, Color][];
  cloud: { value: number };
  phase: { value: number };
  wave: { value: number };
}

const CLOUD_TAG = 'mq-octopus-skin';

/** A coat's second tone (the freckles, the pale tips): lighter, a touch less saturated. */
function secondTone(c: Color): Color {
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return new Color().setHSL(hsl.h, hsl.s * 0.85, Math.min(0.85, hsl.l + 0.22));
}

/**
 * The coat's materials, their colours as dressed, its repertoire, and the
 * shader that draws a change sweeping down it and the passing clouds: dark
 * bands running from the back of the mantle forward and out along the arms
 * (Mather 2004: O. cyanea, after a pounce). Call once the coat is on
 * (applyNpcMaterials).
 */
export function octopusSkin(body: Object3D, index = 0): OctopusSkin {
  const parts: OctopusSkin['parts'] = [];
  const cloud = { value: 0 }, phase = { value: 0 }, wave = { value: 1 };
  const seen = new Set<Material>();
  body.traverse((o) => {
    const mat = (o as { material?: Material | Material[] }).material;
    for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      if (seen.has(m) || !/^(Primary|Secondary)Color/.test(m.name)) continue;
      seen.add(m);
      const mm = m as MeshBasicMaterial;
      if (!mm.color) continue;
      const old = { value: mm.color.clone() };
      parts.push({ mat: mm, base: mm.color.clone(), secondary: /^Secondary/.test(m.name), old });
      stackPatch(m, CLOUD_TAG, (shader) => {
        shader.uniforms.uMqCloud = cloud;
        shader.uniforms.uMqCloudPhase = phase;
        shader.uniforms.uMqWave = wave;
        shader.uniforms.uMqOld = old;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying float vMqCloudD;\nvarying float vMqWaveD;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
          // Bind space, glTF axes (+z ahead, +y up). The clouds run back to front and out the arms;
          // a colour change sweeps from the top of the head (0) down and out to the arm tips (1).
          vMqCloudD = -position.z + length(position.xz) * 0.6 + position.y * 0.4;
          vMqWaveD = clamp((24.0 - position.y + length(position.xz)) / 50.0, 0.0, 1.0);`);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vMqCloudD;\nvarying float vMqWaveD;\nuniform float uMqCloud;\nuniform float uMqCloudPhase;\nuniform float uMqWave;\nuniform vec3 uMqOld;')
          .replace('#include <color_fragment>', `#include <color_fragment>
          {
            // The change: its new colour where the wave has passed, the old one beyond it.
            float front = uMqWave * 1.3 - 0.15;
            diffuseColor.rgb = mix(uMqOld, diffuseColor.rgb, 1.0 - smoothstep(front - 0.12, front + 0.12, vMqWaveD));
            // Bands about a body length apart, sweeping forward and outward.
            float band = 0.5 + 0.5 * sin(vMqCloudD * 0.32 + uMqCloudPhase);
            diffuseColor.rgb *= 1.0 - uMqCloud * 0.7 * smoothstep(0.55, 0.85, band);
          }`);
      });
    }
  });
  const coats = octopusRepertoire(index).map((i): [Color, Color] => {
    const c = new Color(OCTOPUS_COATS[i]);
    return [c, secondTone(c)];
  });
  return { parts, coats, cloud, phase, wave };
}

const _hsl = { h: 0, s: 0, l: 0 };
const PALE = new Color('#f2e6df');

/** A part's colour in coat `n`: 0 its own (as dressed), else the repertoire's. */
function coatColor(skin: OctopusSkin, p: OctopusSkin['parts'][number], n: number, out: Color): Color {
  return n === 0 || !skin.coats[n - 1] ? out.copy(p.base) : out.copy(skin.coats[n - 1]![p.secondary ? 1 : 0]);
}

function dress(c: Color, mood: OctopusMood, floor: Color | null): void {
  if (mood.flush > 0) {
    c.getHSL(_hsl);
    c.setHSL(_hsl.h, Math.min(1, _hsl.s * (1 + 0.4 * mood.flush)), _hsl.l * (1 - 0.3 * mood.flush));
  }
  if (mood.dream > 0) {
    c.getHSL(_hsl);
    c.setHSL((_hsl.h + mood.dreamHue * mood.dream + 1) % 1, _hsl.s, _hsl.l);
  }
  if (floor && mood.camo > 0) c.lerp(floor, 0.55 * mood.camo);
  if (mood.pale > 0) c.lerp(PALE, 0.7 * mood.pale);
}

/** Dress the skin for this frame: its colour (changing), its mood; `floor` the floor's colour, for camouflage. */
export function setOctopusSkin(skin: OctopusSkin, mood: OctopusMood, floor: Color | null, coat: OctopusCoat = { from: 0, to: 0, wave: 1 }): void {
  skin.cloud.value = mood.cloud;
  skin.phase.value = mood.cloudPhase;
  skin.wave.value = coat.wave;
  for (const p of skin.parts) {
    dress(coatColor(skin, p, coat.to, p.mat.color), mood, floor);
    if (coat.wave >= 1) p.old.value.copy(p.mat.color);
    else dress(coatColor(skin, p, coat.from, p.old.value), mood, floor);
  }
}
