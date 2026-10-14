/**
 * Dot, alive: Geode Hollow's courier — the first CHARACTER (experimental).
 *
 * A box of a character on two legs, in a mail cap, its face a screen
 * (screen.ts). The rig comes from Blender (breeds/rig/dot.py): hips, a torso
 * that bows, arms with elbows and gloves, legs posed by IK, a cap and antenna
 * that follow through, a mailbag; eighteen clips. This module decides which
 * clips play, at what weight, WHERE Dot stands, and what its screen shows — a
 * closed form in t, every action's time and weight SET each frame, then
 * `mixer.update(0)`.
 *
 * On its own it walks the floor the crab's way (crab.ts): its route, a
 * stop-and-go pace, its place everything walked since t = 0, its feet in step
 * with the ground (`mqStride`). Some bouts it runs, some it sneaks on tiptoe. At each stop it has a
 * MOMENT: waves at you, cheers, stops to think (a question on its face, then
 * the idea), tips its cap, holds out a letter, points, dances, sits down for
 * a rest — or skids to a stop and glitches (its screen tears and reboots).
 * For the ones that are for you it turns to face the camera first.
 *
 * In a vignette (vignette.ts) it is an ACTOR on the floor: it walks between
 * the marks (its feet on the ground under the script's place), and the
 * gestures it has clips for (`DOT_GESTURES`) it plays with its own body,
 * each with a face: talking flaps a mouth, a nod is happy, a peek is a
 * question and then an idea.
 */
import {
  AnimationMixer, Box3, Euler, Quaternion, Vector3,
  type AnimationAction, type AnimationClip, type Object3D,
} from 'three';
import { boutDistance, boutSpeed, type CrabInput } from './crab';
import { swimPoseAtDistance, type SwimPlan } from './plan';
import type { Glyph, ScreenState } from './screen';
import { fishHash } from './swim';
import { poseOf, type ActorPose, type Gesture, type Vignette } from './vignette';

export const DOT_CLIPS = [
  'idle', 'walk', 'run', 'talk', 'nod', 'shake', 'hop', 'wiggle', 'wave', 'cheer', 'rest',
  'spin', 'peek', 'bow', 'deliver', 'point', 'glitch', 'skid',
  'clap', 'shrug', 'facepalm', 'laugh', 'salute', 'search', 'stretch', 'jump', 'trip', 'sneak', 'dance',
] as const;
export type DotClip = (typeof DOT_CLIPS)[number];
/** The vignette gestures Dot plays with its own clips (the script leaves its body alone for these). */
export const DOT_GESTURES: readonly Gesture[] = ['talk', 'nod', 'shake', 'hop', 'spin', 'wiggle', 'peek', 'bow', 'rest'];
const LOOPED: ReadonlySet<DotClip> = new Set(['idle', 'walk', 'run', 'talk', 'nod', 'shake', 'hop', 'wiggle', 'wave', 'cheer', 'rest', 'clap', 'laugh', 'sneak', 'dance']);

export type DotMoment = 'wave' | 'cheer' | 'think' | 'tip' | 'deliver' | 'point' | 'dance' | 'sit' | 'crash'
  | 'clap' | 'shrug' | 'facepalm' | 'laugh' | 'salute' | 'search' | 'stretch' | 'jump' | 'trip';
export type DotGait = 'walk' | 'run' | 'sneak';
export type DotDoing = DotGait | 'turn' | 'idle' | DotMoment | Gesture;

export interface DotRig {
  mixer: AnimationMixer;
  actions: Record<DotClip, AnimationAction>;
  durations: Record<DotClip, number>;
  /** Model units per walk cycle, per run cycle, per sneak cycle. */
  stride: number;
  runStride: number;
  sneakStride: number;
  /** The ground point between its feet, in model space: what the tank stands on the floor. */
  anchor: Vector3;
  /** The template's normalising scale (model units → a unit-size fish). */
  norm: number;
}

/** Rigs a freshly cloned Dot (identity transform), or null when the model carries no Dot rig. */
export function rigDot(body: Object3D, clips: readonly AnimationClip[], norm: number): DotRig | null {
  const byName = new Map(clips.map((c) => [c.name, c]));
  if (!DOT_CLIPS.every((n) => byName.has(n))) return null;
  let stride = 0, runStride = 0, sneakStride = 0;
  body.traverse((o) => {
    if (typeof o.userData.mqStride === 'number') stride = o.userData.mqStride;
    if (typeof o.userData.mqRunStride === 'number') runStride = o.userData.mqRunStride;
    if (typeof o.userData.mqSneakStride === 'number') sneakStride = o.userData.mqSneakStride;
  });
  if (!(stride > 0) || !(runStride > 0) || !(sneakStride > 0)) return null;
  body.updateMatrixWorld(true);
  const box = new Box3().setFromObject(body);
  const mixer = new AnimationMixer(body);
  const actions = {} as Record<DotClip, AnimationAction>;
  const durations = {} as Record<DotClip, number>;
  for (const n of DOT_CLIPS) {
    const clip = byName.get(n)!;
    const a = mixer.clipAction(clip);
    a.play();
    a.setEffectiveWeight(0);
    actions[n] = a;
    durations[n] = clip.duration;
  }
  // Between its feet: the box's middle across, its floor, and the middle of its depth less the mailbag behind.
  return { mixer, actions, durations, stride, runStride, sneakStride, anchor: new Vector3((box.min.x + box.max.x) / 2, box.min.y, 0), norm };
}

// ---------------------------------------------------------------------------
// The schedule
// ---------------------------------------------------------------------------

const posMod = (v: number, m: number): number => ((v % m) + m) % m;
const TURN_IN = 0.8;
const TURN_OUT = 1.0;
/** Walking speed in world units per second: a brisk courier, a bit slower than a crab. Its own pace. */
export const DOT_PACE = 0.42 * 16.2;
/** How far each gait goes in a bout, against a walk. */
export const GAIT_PACE: Record<DotGait, number> = { walk: 1, run: 1.9, sneak: 0.45 };
/** Its bouts go round this pattern (where it starts, per Dot): a closed form, so where it is stays a pure function of t. */
const GAITS: readonly DotGait[] = ['walk', 'walk', 'run', 'walk', 'sneak', 'walk'];
const GAITS_PACE = GAITS.reduce((a, g) => a + GAIT_PACE[g], 0);

/** How long each moment's clip runs (in its stop, after the turn in). */
export const MOMENT_LENGTH: Record<DotMoment, number> = {
  wave: 3.6, cheer: 3.0, think: 3.0, tip: 2.0, deliver: 2.8, point: 2.0, dance: 4.0, sit: 6.0, crash: 4.6,
  clap: 2.5, shrug: 1.6, facepalm: 2.4, laugh: 3.0, salute: 2.0, search: 3.0, stretch: 3.0, jump: 1.4, trip: 2.4,
};
const MOMENTS: readonly [DotMoment, number][] = [
  ['wave', 0.1], ['think', 0.08], ['deliver', 0.08], ['cheer', 0.06], ['tip', 0.05], ['point', 0.05], ['dance', 0.07], ['sit', 0.05], ['crash', 0.04],
  ['clap', 0.06], ['shrug', 0.05], ['facepalm', 0.04], ['laugh', 0.06], ['salute', 0.04], ['search', 0.06], ['stretch', 0.04], ['jump', 0.05], ['trip', 0.02],
];
/** The moments it turns to you for. */
const FOR_YOU: ReadonlySet<DotMoment> = new Set(['wave', 'cheer', 'tip', 'deliver', 'dance', 'clap', 'laugh', 'salute', 'jump']);
const MOMENT_CLIP: Record<DotMoment, DotClip> = {
  wave: 'wave', cheer: 'cheer', think: 'peek', tip: 'bow', deliver: 'deliver', point: 'point', dance: 'dance', sit: 'rest', crash: 'glitch',
  clap: 'clap', shrug: 'shrug', facepalm: 'facepalm', laugh: 'laugh', salute: 'salute', search: 'search', stretch: 'stretch', jump: 'jump', trip: 'trip',
};

export interface DotCycle { walk: number; stop: number; offset: number }

export function dotCycle(index: number): DotCycle {
  const walk = 4 + 4 * fishHash(index, 1601);
  // Room for a turn in, the longest moment (the 6 s sit) with its fades, and a turn out.
  const stop = 8.4 + 2 * fishHash(index, 1603);
  return { walk, stop, offset: fishHash(index, 1605) * (walk + stop) };
}

export function dotMomentAt(index: number, k: number): DotMoment {
  let r = fishHash(index * 7841 + k, 1607);
  return MOMENTS.find(([, w]) => (r -= w) < 0)?.[0] ?? 'wave';
}

const gaitPhase = (index: number): number => Math.floor(fishHash(index, 1609) * GAITS.length);

/** How it covers bout `k`: walking, running or sneaking. */
export function dotGait(index: number, k: number): DotGait {
  return GAITS[posMod(k + gaitPhase(index), GAITS.length)]!;
}

/** Bouts 0..k-1 in walking lengths: whole turns of the pattern, then the rest one by one (at most five). */
function gaitsBefore(index: number, k: number): number {
  const whole = Math.floor(k / GAITS.length);
  let sum = whole * GAITS_PACE;
  for (let b = whole * GAITS.length; b < k; b++) sum += GAIT_PACE[dotGait(index, b)];
  return sum;
}

export interface DotMomentT { walked: number; k: number; u: number; speed: number; intoStop: number }

export function dotMoment(index: number, t: number): DotMomentT {
  const c = dotCycle(index);
  const P = c.walk + c.stop, tau = t + c.offset;
  const k = Math.floor(tau / P), u = tau - k * P;
  // Distance in walking lengths: each bout its gait's.
  const whole = boutDistance(c.walk, c.walk);
  const walked = gaitsBefore(index, k) * whole + boutDistance(u, c.walk) * GAIT_PACE[dotGait(index, k)];
  return { walked, k, u, speed: boutSpeed(u, c.walk), intoStop: u - c.walk };
}

/** Where along the plan its route starts: spread by index. */
export function dotStart(plan: SwimPlan, index: number): number {
  return fishHash(index, 1611) * plan.totalLength;
}

/** Where its route puts it at `t`, before it minds the others; `back` units further back for a trail. */
export function dotSpot(index: number, t: number, plan: SwimPlan, start: number, back = 0): { x: number; z: number; fx: number; fz: number } {
  const pose = swimPoseAtDistance(plan, start + dotMoment(index, t).walked * DOT_PACE - back);
  const l = Math.hypot(pose.fx, pose.fz) || 1;
  return { x: pose.x, z: pose.z, fx: pose.fx / l, fz: pose.fz / l };
}

// ---------------------------------------------------------------------------
// The face
// ---------------------------------------------------------------------------

/** The faces it wears between moments: content, mostly. */
const MOODS: readonly Glyph[] = ['neutral', 'happy', 'neutral', 'happy', 'wink', 'cool', 'love', 'neutral'];
const SLOT = 3.2;    // seconds an expression holds
const WIPE = 0.25;   // the scan-down refresh
const BLINK = 0.16;

const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const wrap = (a: number): number => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;

/** The screen showing `to`, wiped in over `from` at `into` seconds. */
function face(from: Glyph, to: Glyph, into: number): ScreenState {
  return { from, to, wipe: smooth(into / WIPE), mode: 'face', level: 1 };
}

/** Its face between moments: a mood a slot, a blink, now and then the letter it carries. */
export function dotFace(index: number, t: number): ScreenState {
  const s = Math.floor(t / SLOT), into = t - s * SLOT;
  const mood = (k: number): Glyph => (fishHash(index * 31 + k, 1613) < 0.12 ? 'mail' : MOODS[Math.floor(fishHash(index * 37 + k, 1615) * MOODS.length)]!);
  const now = mood(s), was = mood(s - 1);
  const b = SLOT * 0.55;
  if ((now === 'neutral' || now === 'happy') && into > b && into < b + BLINK) return { from: 'blink', to: 'blink', wipe: 1, mode: 'face', level: 1 };
  return face(was, now, into);
}

/** What its face shows through a moment. */
export function momentFace(m: DotMoment, into: number): ScreenState {
  switch (m) {
    case 'wave': return face('neutral', 'happy', into);
    case 'cheer': return into < 1.2 ? face('happy', 'star', into) : face('star', 'love', into - 1.2);
    case 'think': return into < 2.0 ? face('neutral', 'question', into) : face('question', 'idea', into - 2.0);
    case 'tip': return face('neutral', 'wink', into);
    case 'deliver': return into < 1.0 ? face('happy', 'mail', into) : into < 2.4 ? face('mail', 'mail', 1) : face('mail', 'happy', into - 2.4);
    case 'point': return face('neutral', 'exclaim', into);
    case 'dance': return face('happy', 'cool', into);
    case 'sit': return into < 4.5 ? face('neutral', 'sleepy', into) : face('sleepy', 'happy', into - 4.5);
    case 'clap': return face('happy', 'love', into);
    case 'shrug': return face('neutral', 'meh', into);
    case 'facepalm': return into < 0.5 ? face('neutral', 'surprised', into) : face('surprised', 'dead', into - 0.5);
    case 'laugh': {
      const open = Math.floor(into / 0.25) % 2 === 0;
      return { from: open ? 'laugh' : 'happy', to: open ? 'laugh' : 'happy', wipe: 1, mode: 'face', level: 1 };
    }
    case 'salute': return face('neutral', 'cool', into);
    case 'search': return face('neutral', 'focus', into);
    case 'stretch': return into < 2.0 ? face('neutral', 'sleepy', into) : face('sleepy', 'happy', into - 2.0);
    case 'jump': return face('happy', 'star', into);
    case 'trip': return into < 0.3 ? face('neutral', 'surprised', into) : into < 1.5 ? face('surprised', 'surprised', 1) : face('surprised', 'meh', into - 1.5);
    case 'crash':
      if (into < 0.4) return face('neutral', 'surprised', into);
      if (into < 1.4) return { from: 'surprised', to: 'surprised', wipe: 1, mode: 'glitch', level: 1 };
      if (into < 3.2) return { from: 'surprised', to: 'surprised', wipe: 1, mode: 'boot', level: 0.7 };
      return face('dead', 'happy', into - 3.2);
  }
}

/** What its face shows through a vignette gesture. Talking flaps its mouth: a glyph each 0.2 s, 2.5 flaps a second — a small patch of the screen, well inside the flash limit. */
export function gestureFace(g: Gesture, at: number): ScreenState {
  switch (g) {
    case 'talk': {
      const open = Math.floor(at / 0.2) % 2 === 0;
      return { from: open ? 'talkA' : 'talkB', to: open ? 'talkA' : 'talkB', wipe: 1, mode: 'face', level: 1 };
    }
    case 'nod': return face('neutral', 'happy', at);
    case 'shake': return face('neutral', 'focus', at);
    case 'hop': return face('happy', 'surprised', at);
    case 'spin': return at < 0.8 ? face('happy', 'star', at) : face('star', 'love', at - 0.8);
    case 'wiggle': return face('happy', 'cool', at);
    case 'peek': return at < 2 ? face('neutral', 'question', at) : face('question', 'idea', at - 2);
    case 'bow': return face('neutral', 'wink', at);
    case 'rest': return face('neutral', 'sleepy', at);
    default: return face('neutral', 'happy', at);
  }
}

// ---------------------------------------------------------------------------
// The frame
// ---------------------------------------------------------------------------

export interface DotInput extends CrabInput {
  /** Its vignette pose, when it is an actor this frame; and where the script has it a quarter second on (its pace). */
  act?: ActorPose | null;
  next?: ActorPose | null;
  /** As an actor: how far its script has walked it by now (`actorTravel`) — what its feet keep step with. */
  travel?: number;
}

/** Each script's walked distance per actor over one loop, sampled at 30 Hz: built once, a pure function of the script.
 *  Keyed by actor, and by actor + SOLID for the distance through the water (`solid`). */
const TRAVEL = new WeakMap<Vignette, Map<number, Float64Array>>();
const SOLID = 1 << 16;
const TRAVEL_HZ = 30;

/**
 * How far a vignette actor has walked across the floor by `t` (world units), a
 * closed form: whole loops of the script plus the way into this one. Its feet
 * take their step from this, never from t × speed — that product races the
 * legs whenever the pace changes, and the later in the day the faster
 * (`d/dt (t·v) = v + t·v'`). `solid`: through the water, height and all — a
 * swimmer's (the dolphin's) strokes cover its climbs and dives too; a walker's
 * feet only the floor.
 */
export function actorTravel(v: Vignette, actor: number, t: number, own?: (g: Gesture) => boolean, solid = false): number {
  if (!v.duration) return 0;
  let byActor = TRAVEL.get(v);
  if (!byActor) TRAVEL.set(v, (byActor = new Map()));
  const key = solid ? actor + SOLID : actor;
  let table = byActor.get(key);
  if (!table) {
    const n = Math.max(2, Math.ceil(v.duration * TRAVEL_HZ));
    table = new Float64Array(n + 1);
    let prev = poseOf(v, actor, 0, own);
    for (let i = 1; i <= n; i++) {
      const p = poseOf(v, actor, (i / n) * v.duration, own);
      table[i] = table[i - 1]! + (p && prev ? Math.hypot(p.x - prev.x, solid ? p.y - prev.y : 0, p.z - prev.z) : 0);
      prev = p;
    }
    byActor.set(key, table);
  }
  const n = table.length - 1, loop = table[n]!;
  const laps = Math.floor(t / v.duration), u = ((t - laps * v.duration) / v.duration) * n;
  const i = Math.min(n - 1, Math.floor(u)), f = u - i;
  return laps * loop + table[i]! + (table[i + 1]! - table[i]!) * f;
}

export interface DotOutput {
  x: number; y: number; z: number;
  quaternion: Quaternion;
  fx: number; fz: number;
  /** Unit travel along its route, and where the route had it two lengths ago: the follow camera's chord. */
  tx: number; tz: number;
  trailX: number; trailZ: number;
  doing: DotDoing;
  screen: ScreenState;
  /** Its antenna bulb's light: steady, a bright breath with an idea. */
  bulb: number;
}

export function newDotOutput(): DotOutput {
  return {
    x: 0, y: 0, z: 0, quaternion: new Quaternion(), fx: 0, fz: 1, tx: 0, tz: 1, trailX: 0, trailZ: 0,
    doing: 'idle', screen: { from: 'neutral', to: 'neutral', wipe: 1, mode: 'face', level: 1 }, bulb: 0.8,
  };
}

const euler = new Euler(0, 0, 0, 'YXZ');
const _up = new Vector3();
/** Closer than this many body lengths (centre to centre), two floor creatures ease apart. */
const ROOM = 1.1;

function setAction(rig: DotRig, name: DotClip, time: number, weight: number): void {
  const a = rig.actions[name];
  a.time = LOOPED.has(name) ? posMod(time, rig.durations[name]) : Math.max(0, Math.min(rig.durations[name], time));
  a.setEffectiveWeight(weight);
}

/** Places Dot, sets its clips for time `t`, and says what its screen shows. Pure in its input. */
export function dotFrame(rig: DotRig, inp: DotInput, out: DotOutput): DotOutput {
  const { index, t, len } = inp;
  const weights = new Map<DotClip, [number, number]>();
  const play = (n: DotClip, time: number, w: number): void => { if (w > 0) weights.set(n, [time, (weights.get(n)?.[1] ?? 0) + w]); };
  const strideW = rig.stride * inp.scale, runW = rig.runStride * inp.scale;
  let x: number, z: number, yaw: number, tx: number, tz: number, trailX: number, trailZ: number;
  let doing: DotDoing, screen: ScreenState, bulb = 0.8;

  const act = inp.act;
  if (act) {
    // An actor: the script's place, its feet on the floor; walking while it travels.
    x = act.x; z = act.z;
    yaw = Math.atan2(act.fx, act.fz);
    const n = inp.next;
    const speed = n ? Math.hypot(n.x - act.x, n.z - act.z) / 0.25 : 0;
    // The step: from the distance walked, not t × speed (actorTravel says why).
    const walked = inp.travel ?? 0;
    const going = smooth((speed - 1.5) / 3);
    const running = smooth((speed - DOT_PACE * 1.4) / (DOT_PACE * 0.4));
    tx = Math.sin(yaw); tz = Math.cos(yaw);
    trailX = x - tx * len * 2; trailZ = z - tz * len * 2;
    const g = act.gesture;
    const w = g && (DOT_GESTURES as readonly string[]).includes(g.name) ? g.weight * (1 - going) : 0;
    play('walk', (walked / strideW) * rig.durations.walk, going * (1 - running) * (1 - w));
    play('run', (walked / runW) * rig.durations.run, going * running * (1 - w));
    play('idle', t + fishHash(index, 1617) * rig.durations.idle, (1 - going) * (1 - w));
    doing = going > 0.5 ? (running > 0.5 ? 'run' : 'walk') : 'idle';
    screen = going > 0.5 ? face('happy', 'happy', 1) : dotFace(index, t);
    if (g && w > 0) {
      doing = g.name;
      play(g.name as DotClip, g.at, w);
      screen = gestureFace(g.name, g.at);
      if (g.name === 'peek') bulb = g.at > 2 ? 1.6 : 0.5;
    }
  } else {
    const c = dotCycle(index);
    const m = dotMoment(index, t);
    const gait = dotGait(index, m.k);
    const pose = dotSpot(index, t, inp.plan, inp.start);
    x = pose.x; z = pose.z;
    // Elbow room, as the crab gives it.
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
    yaw = travel;
    tx = pose.fx; tz = pose.fz;
    const trail = dotSpot(index, t, inp.plan, inp.start, len * 2);
    trailX = trail.x + (x - pose.x); trailZ = trail.z + (z - pose.z);
    doing = gait;
    screen = gait === 'sneak' ? face('neutral', 'focus', 1) : dotFace(index, t);
    let turning = 0, turned = 0, actT = 0, actW = 0, moment: DotMoment | null = null;
    if (m.intoStop >= 0) {
      moment = dotMomentAt(index, m.k);
      const faceCam = FOR_YOU.has(moment) && Number.isFinite(inp.camX);
      const dIn = faceCam ? wrap(Math.atan2(inp.camX - x, inp.camZ - z) - travel) : 0;
      const a = m.intoStop / TURN_IN, b = (m.intoStop - (c.stop - TURN_OUT)) / TURN_OUT;
      yaw = travel + dIn * smooth(a) - dIn * smooth(b);
      const effort = (u: number): number => Math.sin(Math.PI * Math.min(1, Math.max(0, u))) * Math.min(1, Math.abs(dIn) / 0.4);
      turning = a < 1 ? effort(a) : b > 0 ? effort(b) : 0;
      // How far round it has turned so far this stop: only ever grows, so its feet step forward through a turn, never back.
      turned = Math.abs(dIn) * (smooth(a) + smooth(b));
      const into = m.intoStop - TURN_IN, len2 = MOMENT_LENGTH[moment];
      actT = into;
      actW = smooth(into / 0.3) * smooth((len2 + 0.3 - into) / 0.3);
      doing = turning > 0.3 ? 'turn' : actW > 0.5 ? moment : 'idle';
      if (actW > 0) screen = momentFace(moment, into);
      if (moment === 'think') bulb = into > 2.0 && into < 2.8 ? 1.6 : 0.45;
    }
    // The gait: its phase from this bout's distance, so the feet keep step with the ground.
    const moved = boutDistance(m.u, c.walk) * DOT_PACE * GAIT_PACE[gait];
    const gStride = gait === 'run' ? runW : gait === 'sneak' ? rig.sneakStride * inp.scale : strideW;
    play(gait, (moved / gStride) * rig.durations[gait], m.speed * (1 - actW));
    // A turn on the spot is walked round, whatever the bout was: a step per ~half a turn of arc under its feet.
    play('walk', ((turned * len * 0.35) / strideW) * rig.durations.walk, turning * (1 - actW));
    const gaitW = Math.max(m.speed, turning) * (1 - actW);
    if (moment && actW > 0) {
      const clip = MOMENT_CLIP[moment];
      if (moment === 'crash') {
        // The skid first, then the glitch on top as its screen tears.
        play('skid', actT, actW * (1 - smooth((actT - 1.1) / 0.3)));
        play('glitch', actT - 0.4, actW * smooth((actT - 0.4) / 0.2) * (1 - smooth((actT - 1.2) / 0.2)));
      } else play(clip, actT, actW);
    }
    play('idle', t + fishHash(index, 1617) * rig.durations.idle, Math.max(0, 1 - gaitW - actW));
  }

  // On the floor, feet and all: tilted with the slope under its stance, then
  // lifted so that no foot's reach — a stride ahead, a heel behind, a foot to
  // each side — is under the ground on a curve (a hump between its feet, a
  // dip under one), whatever the slope's tilt has done to the plane.
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const rx = fz, rz = -fx;   // its left, up × front
  const g = inp.ground, sc = inp.scale;
  const ahead = 8 * sc, behind = 4 * sc, aside = 5 * sc;
  const at = (dF: number, dS: number): number => g(x + fx * dF + rx * dS, z + fz * dF + rz * dS);
  const hc = at(0, 0);
  const hfL = at(ahead, aside), hfR = at(ahead, -aside), hbL = at(-behind, aside), hbR = at(-behind, -aside);
  // A character stands up straight on a hill: it leans into half the slope (no more than ~11°), its stance taking the rest.
  const pitch = Math.max(-0.2, Math.min(0.2, 0.5 * Math.atan2((hfL + hfR) / 2 - (hbL + hbR) / 2, ahead + behind)));
  const roll = Math.max(-0.2, Math.min(0.2, 0.5 * Math.atan2((hfL + hbL) / 2 - (hfR + hbR) / 2, 2 * aside)));
  euler.set(-pitch, yaw, roll);
  out.quaternion.setFromEuler(euler);
  // The stance's own plane (the tilt as drawn), and each reach's height on it.
  _up.set(0, 1, 0).applyQuaternion(out.quaternion);
  let lift = 0;
  for (const [dF, dS, h] of [[ahead, aside, hfL], [ahead, -aside, hfR], [-behind, aside, hbL], [-behind, -aside, hbR], [0, 0, hc]] as const) {
    const ox = fx * dF + rx * dS, oz = fz * dF + rz * dS;
    lift = Math.max(lift, h - (hc - (_up.x * ox + _up.z * oz) / _up.y));
  }
  const y = hc + lift;
  out.x = x; out.y = y; out.z = z; out.fx = fx; out.fz = fz;
  out.tx = tx; out.tz = tz; out.trailX = trailX; out.trailZ = trailZ;
  out.doing = doing; out.screen = screen; out.bulb = bulb;

  for (const n of DOT_CLIPS) {
    const w = weights.get(n);
    setAction(rig, n, w ? w[0] : 0, w ? Math.min(1, w[1]) : 0);
  }
  rig.mixer.update(0);
  return out;
}
