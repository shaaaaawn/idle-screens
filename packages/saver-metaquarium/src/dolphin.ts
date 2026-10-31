/**
 * The dolphin, alive: Dot's friend. EXPERIMENTAL.
 *
 * The rig and clips come from Blender (breeds/rig/dolphin.py): a soft body
 * (head, body, two tail links and the flat flukes) that strokes UP AND DOWN
 * — a shark sweeps side to side — a jaw that chatters, flippers, a blowhole,
 * eyes that blink and squint, and pupils no clip moves. Clips swim, glide,
 * burst, hover, seven moments (chatter, nod, shake, spin, flip, wave, bubble)
 * and blink.
 *
 *   stroke   phased by the DISTANCE swum (the tank's `beat`, or an actor's
 *            scripted travel — never time × pace, which races as the pace
 *            changes), at this dolphin's own tempo
 *   pace     swimming when cruising, with coasting glides between bouts of
 *            strokes; holding station (hover) when slow; a burst when the
 *            tank makes it dart
 *   moments  a personality from its slot — playful, chatty, curious or a
 *            show-off — picks a moment every so often: it slows for it
 *            (`dolphinHold`, made good after), and for the friendly ones it
 *            turns its eye to you (`face`)
 *   eyes     `dolphinLook`, after the tank places it: each pupil slides over
 *            its eye's outer face — at you, at whoever a vignette has it
 *            talking to (Dot), ahead, up after its bubble, about in saccades
 *   blink    every few seconds, layered over whatever it is doing
 *
 * In a vignette it plays the gestures it has clips for with its own body
 * (DOLPHIN_GESTURES: talk is a chatter, hop a flip, wiggle a wave…).
 *
 * Everything is a closed form in t: each action's time and weight, then
 * `mixer.update(0)`.
 */
import { AnimationMixer, Matrix4, Quaternion, Vector3, type AnimationAction, type AnimationClip, type Object3D } from 'three';
import { fishHash } from './swim';
import type { Gesture } from './vignette';

export const DOLPHIN_MOMENTS = ['chatter', 'nod', 'shake', 'spin', 'flip', 'wave', 'bubble'] as const;
export type DolphinMoment = (typeof DOLPHIN_MOMENTS)[number];
export const DOLPHIN_CLIPS = ['swim', 'glide', 'burst', 'hover', ...DOLPHIN_MOMENTS, 'blink'] as const;
export type DolphinClip = (typeof DOLPHIN_CLIPS)[number];
export type DolphinDoing = 'swim' | 'glide' | 'burst' | 'hover' | DolphinMoment;
export type DolphinTemper = 'playful' | 'chatty' | 'curious' | 'showoff';

/** The vignette gestures it plays with its own clips, and which. */
export const DOLPHIN_GESTURE_CLIP: Readonly<Partial<Record<Gesture, DolphinMoment>>> = {
  talk: 'chatter', nod: 'nod', bow: 'nod', shake: 'shake', hop: 'flip', spin: 'spin', wiggle: 'wave', peek: 'bubble',
  toprock: 'spin', footwork: 'wave', windmill: 'spin', headspin: 'flip', freeze: 'wave', drop: 'flip',
};
export const DOLPHIN_GESTURES = Object.keys(DOLPHIN_GESTURE_CLIP) as Gesture[];

/** An eye: its pupil slides over the box's outer face. */
export interface DolphinEye {
  eye: Object3D;
  pupil: Object3D;
  /** +1 its left eye (+x), -1 its right. */
  side: 1 | -1;
  pupilRest: Vector3;
  /** The eye bone's rest rotation in the model's axes: a model-axis slide carried into the bone's own. */
  eyeAxes: Quaternion;
}

export interface DolphinRig {
  body: Object3D;
  eyes: DolphinEye[];
  /** Where the bubble leaves from. */
  blowhole: Object3D | null;
  /** The body bone: the centre a flip or a roll turns the whole dolphin about (dolphinTurn). */
  pivot: Object3D | null;
  /** The spine, nose to flukes (head, body, tail1, tail2, flukes): a banked turn's curl bends these. */
  spine: Object3D[];
  mixer: AnimationMixer;
  actions: Record<DolphinClip, AnimationAction>;
  durations: Record<DolphinClip, number>;
}

/** The spine's bones, nose to flukes (breeds/rig/dolphin.py SPINE). */
const SPINE_BONES = ['head', 'body', 'tail1', 'tail2', 'flukes'] as const;
/** How much of a curl each spine bone takes (sign: + bends that bone's far end toward the belly). */
const CURL_SHARE = [-0.6, 0, 0.6, 1, 1] as const;

/** three drops the '.' from a bone's name ('eye.L' arrives as 'eyeL'). */
const named = (root: Object3D, name: string): Object3D | undefined =>
  root.getObjectByName(name) ?? root.getObjectByName(name.replace('.', ''));

/** Rigs a freshly cloned dolphin body (identity transform), or null when the
 *  model carries no dolphin rig — then it swims like any other breed. */
export function rigDolphin(body: Object3D, clips: readonly AnimationClip[]): DolphinRig | null {
  const byName = new Map(clips.map((c) => [c.name, c]));
  if (!DOLPHIN_CLIPS.every((n) => byName.has(n))) return null;
  body.updateMatrixWorld(true);
  const toModel = new Matrix4().copy(body.matrixWorld).invert();
  const eyes: DolphinEye[] = [];
  for (const [side, s] of [['L', 1], ['R', -1]] as const) {
    const eye = named(body, `eye.${side}`), pupil = named(body, `pupil.${side}`);
    if (!eye || !pupil) continue;
    const m = new Matrix4().multiplyMatrices(toModel, eye.matrixWorld);
    eyes.push({ eye, pupil, side: s, pupilRest: pupil.position.clone(), eyeAxes: new Quaternion().setFromRotationMatrix(m.extractRotation(m)) });
  }
  const mixer = new AnimationMixer(body);
  const actions = {} as Record<DolphinClip, AnimationAction>;
  const durations = {} as Record<DolphinClip, number>;
  for (const n of DOLPHIN_CLIPS) {
    const clip = byName.get(n)!;
    const a = mixer.clipAction(clip);
    a.play();
    a.setEffectiveWeight(0);
    actions[n] = a;
    durations[n] = clip.duration;
  }
  const spine = SPINE_BONES.map((n) => named(body, n)).filter((b): b is Object3D => !!b);
  return { body, eyes, blowhole: named(body, 'blowhole') ?? null, pivot: named(body, 'body') ?? null, spine, mixer, actions, durations };
}

/** Swim-clip seconds per unit swum: a stroke (1 s of clip) every 25 units, about a body length. */
export const DOLPHIN_STROKE = 0.04;
/** The bubble leaves the blowhole this far into the `bubble` clip (when the puff peaks). */
export const BUBBLE_AT = 0.62;
/** The moments that are for you: it turns its eye your way for them. */
const FRIENDLY: ReadonlySet<DolphinMoment> = new Set(['chatter', 'nod', 'shake', 'wave', 'bubble']);
/** How much of its cruising each moment holds back (1: stops; a flip is done on the move). */
const HOLD: Readonly<Record<DolphinMoment, number>> = { chatter: 0.85, nod: 0.75, shake: 0.75, spin: 0.25, flip: 0.35, wave: 0.85, bubble: 0.9 };
/** Seconds over which a held dolphin makes its lost ground good (a quick catch-up, not a jump). */
export const DOLPHIN_CATCH = 5;
/** Each moment's length (s): the clips' (breeds/rig/dolphin.py), for the pure schedule. */
export const MOMENT_LENGTH: Readonly<Record<DolphinMoment, number>> = { chatter: 2.6, nod: 1.6, shake: 1.6, spin: 2.2, flip: 2.8, wave: 2.4, bubble: 2.6 };

const REPERTOIRE: Record<DolphinTemper, ReadonlyArray<readonly [DolphinMoment, number]>> = {
  playful: [['flip', 3], ['spin', 3], ['wave', 2], ['chatter', 2], ['bubble', 1]],
  chatty: [['chatter', 4], ['nod', 2], ['wave', 2], ['shake', 1], ['bubble', 1]],
  curious: [['bubble', 3], ['wave', 2], ['nod', 2], ['chatter', 2], ['shake', 1]],
  showoff: [['flip', 4], ['spin', 3], ['chatter', 1], ['wave', 1]],
};
const TEMPERS: readonly DolphinTemper[] = ['playful', 'chatty', 'curious', 'showoff'];

export interface DolphinPersonality {
  temper: DolphinTemper;
  /** Its own move, reached for twice as often as its temperament would. */
  favourite: DolphinMoment;
  /** Its stroke's tempo, 0.85–1.2 of the breed's. */
  tempo: number;
  /** Seconds between moments. */
  period: number;
  /** 0..1: how often its eyes come to you between moments. */
  curiosity: number;
}

export function dolphinPersonality(index: number): DolphinPersonality {
  const temper = TEMPERS[Math.floor(fishHash(index, 1601) * TEMPERS.length) % TEMPERS.length]!;
  const rep = REPERTOIRE[temper];
  const favourite = rep[Math.floor(fishHash(index, 1603) * rep.length) % rep.length]![0];
  const base = { playful: 9, chatty: 10, curious: 11, showoff: 9 }[temper];
  return {
    temper,
    favourite,
    tempo: 0.85 + 0.35 * fishHash(index, 1605),
    period: base + 5 * fishHash(index, 1607),
    curiosity: { playful: 0.5, chatty: 0.7, curious: 0.9, showoff: 0.6 }[temper],
  };
}

export function dolphinMomentOf(index: number, k: number): DolphinMoment {
  const p = dolphinPersonality(index);
  const rep = REPERTOIRE[p.temper].map(([m, w]) => [m, m === p.favourite ? w * 2 : w] as const);
  const total = rep.reduce((s, [, w]) => s + w, 0);
  let x = fishHash(index * 7919 + k, 1609) * total;
  // The last takes what is left (and any rounding at the very top).
  for (let i = 0; i < rep.length - 1; i++) { x -= rep[i]![1]; if (x < 0) return rep[i]![0]; }
  return rep[rep.length - 1]![0];
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const env = (t: number, a: number, b: number, c: number, d: number): number =>
  smooth((t - a) / (b - a)) * (1 - smooth((t - c) / (d - c)));
const posMod = (v: number, m: number): number => ((v % m) + m) % m;

/** Cycle k's moment: which, when it starts (s, on the shared clock). */
function slotOf(index: number, k: number): { moment: DolphinMoment; start: number } {
  const p = dolphinPersonality(index);
  const moment = dolphinMomentOf(index, k);
  const L = MOMENT_LENGTH[moment];
  const at = 0.5 + Math.max(0, p.period - L - 1) * fishHash(index * 31 + k, 1611);
  return { moment, start: k * p.period + at - fishHash(index, 1613) * p.period };
}

/** The moment playing at `t`: which, its weight, seconds into it. Pure in (index, t). */
export function dolphinMoment(index: number, t: number): { moment: DolphinMoment | null; weight: number; into: number; start: number } {
  const p = dolphinPersonality(index);
  const k = Math.floor((t + fishHash(index, 1613) * p.period) / p.period);
  for (const kk of [k, k - 1]) {
    const s = slotOf(index, kk), L = MOMENT_LENGTH[s.moment], into = t - s.start;
    if (into >= 0 && into <= L) return { moment: s.moment, weight: env(into, 0, 0.35, L - 0.35, L), into, start: s.start };
  }
  return { moment: null, weight: 0, into: 0, start: 0 };
}

/** Seconds of cruising held back at `t` (the tank subtracts that much travel), made good over DOLPHIN_CATCH after. */
export function dolphinHold(index: number, t: number): number {
  const p = dolphinPersonality(index);
  const k = Math.floor((t + fishHash(index, 1613) * p.period) / p.period);
  let held = 0;
  for (const kk of [k - 1, k]) {
    const s = slotOf(index, kk), L = MOMENT_LENGTH[s.moment];
    if (t <= s.start) continue;
    const span = Math.min(t, s.start + L) - s.start;
    let area = 0;
    for (let u0 = 0; u0 < span; u0 += 0.05) {
      const dt = Math.min(0.05, span - u0), u = u0 + dt / 2;
      area += env(u, 0, 0.4, L - 0.4, L) * dt;
    }
    held += HOLD[s.moment] * area * (t > s.start + L ? 1 - smooth((t - s.start - L) / DOLPHIN_CATCH) : 1);
  }
  return held;
}

/** A blink: every few seconds (its own rhythm), 0.4 s long; null between. Seconds into the blink. */
export function dolphinBlink(index: number, t: number): number | null {
  const P = 3.2 + 2.4 * fishHash(index, 1615);
  const k = Math.floor(t / P);
  const at = (k + 0.15 + 0.6 * fishHash(index * 13 + k, 1617)) * P;
  const into = t - at;
  return into >= 0 && into < 0.4 ? into : null;
}

export interface DolphinInput {
  /** How fast it is going (the tank's speed × style × travel; ~0.1 idling, 1+ cruising). */
  pace: number;
  /** The tank's maneuver flurry: > 0 while it darts. */
  flurry: number;
  /** A vignette gesture it plays with its own clips (DOLPHIN_GESTURES), or null. */
  gesture?: { name: Gesture; at: number; weight: number } | null;
  /** A vignette's actor: the script says what it does, so no moments of its own. */
  actor?: boolean;
  /** Its heading's change across one body length (radians, + to its left): how hard it is turning. */
  turn?: number;
  /** The leap under way (dolphinLeap), if any: which part, and how much of the body it has. */
  leap?: { phase: LeapPhase; w: number } | null;
}

export interface DolphinState {
  doing: DolphinDoing;
  temper: DolphinTemper;
  /** Clip weights, for inspect and tests. */
  weights: Record<DolphinClip, number>;
  /** 0..1: how far it turns its eye to the viewer (the tank turns it). */
  face: number;
  /** A bubble to let go from the blowhole: its key and when it leaves (s). */
  bubble: { key: string; t: number } | null;
  /** Seconds into the moment playing, if one is. */
  into: number;
  /** The whole-body turn a flip (pitch, + head down) or a roll (+ about its nose) puts on it now, radians. */
  turn: { pitch: number; roll: number };
  /** Its bank into a turn (the tank rolls it about its length by this, in place of a fish's lean), radians. */
  bank: number;
}

/**
 * The flip's loop and the spin's roll: when each turns, in its clip's seconds (breeds/rig/dolphin.py
 * keeps the curl, the tuck and the strokes; the TURN is here). A whole turn baked into a bone comes
 * apart when the mixer blends it — past half a turn a partial weight interpolates the short way and
 * the body unwinds mid-flip — so the tank turns the whole dolphin about its body bone instead: one
 * smooth angle, never blended, a whole turn from rest back to rest.
 */
export const FLIP_TURN = { from: 0.3, to: 2.2, angle: -2 * Math.PI } as const;
export const SPIN_TURN = { from: 0.25, to: 1.85, angle: 2 * Math.PI } as const;

/** The whole-body turn at `clipT` seconds into `moment`: a smooth start and stop (smootherstep), whole turns at the ends. */
export function dolphinTurn(moment: DolphinMoment | null, clipT: number): { pitch: number; roll: number } {
  const ease = (x: number): number => { const c = clamp(x, 0, 1); return c * c * c * (c * (c * 6 - 15) + 10); };
  if (moment === 'flip') return { pitch: FLIP_TURN.angle * ease((clipT - FLIP_TURN.from) / (FLIP_TURN.to - FLIP_TURN.from)), roll: 0 };
  if (moment === 'spin') return { pitch: 0, roll: SPIN_TURN.angle * ease((clipT - SPIN_TURN.from) / (SPIN_TURN.to - SPIN_TURN.from)) };
  return { pitch: 0, roll: 0 };
}

/**
 * A dolphin's banked turn. Measured on dolphins (Maresh et al. 2004, Marine Mammal Science 20): the
 * tightest turns are a ROLL of up to ~90° and then a VENTRAL flexion — it rolls its belly toward the
 * turn's centre and bends round it, not sideways. A fish leans a little into every curve (heading.ts);
 * a dolphin cruises nearly level (the tank's routes turn ~0.5 rad a body length half the time) and only
 * a hard turn takes the roll and the curl, eased in. `turn` is the heading's change across a body
 * length (+ to its left); `roll` turns it about its length (the tank's rotateZ), `curl` bends the spine.
 */
export const BANK = { from: 0.6, to: 0.95, lean: 0.25, deep: 1.05, curl: 0.16 } as const;
export function dolphinBank(turn: number): { roll: number; curl: number } {
  const a = Math.abs(turn), deep = smooth((a - BANK.from) / (BANK.to - BANK.from));
  return { roll: Math.sign(turn) * (BANK.lean * Math.min(a, BANK.to) + BANK.deep * deep), curl: BANK.curl * deep };
}

/**
 * A breach. Where the water has an open surface, now and then a dolphin runs up at it, leaves it in a
 * ballistic arc and dives back (Au & Weihs 1980: the centre of mass flies a parabola, the body along its
 * path). Closed form in t, from slots like its moments' (never over one). The drawn height is the route's
 * or the leap's curve, whichever is HIGHER (a soft max): the curve climbs at the exit speed toward the
 * surface, flies the parabola above it, and dives back at the same speed until it meets the route again.
 * Along the route it runs ahead (the tank pushes it on, `dolphinLeapAhead`) and gives that back slowly
 * after — slower than it cruises, so it never swims backwards.
 */
export type LeapPhase = 'run' | 'air' | 'dive';
export const LEAP = {
  /** Seconds climbing to the surface, in the air, and diving back. */
  run: 1.6, air: 1.3, dive: 1.8,
  /** The arc's height above the surface, in body lengths. */
  height: 0.5,
  /** Extra cruising per second while it runs and flies (the push along the route), and seconds to give it back. */
  boost: 3, giveBack: 20,
  /** The soft max's width (units): how smoothly it leaves its route for the curve. */
  soft: 15,
  /** Seconds between leaps, by temperament (and the first comes early, so a tank shows one). */
  every: { playful: 38, chatty: 60, curious: 50, showoff: 34 } as Readonly<Record<DolphinTemper, number>>,
} as const;
const LEAP_LEN = LEAP.run + LEAP.air + LEAP.dive;

/** Leap k's start (s): every so often, moved on to the first gap among its moments that it fits. */
export function dolphinLeapStart(index: number, k: number): number {
  const p = dolphinPersonality(index);
  // Jittered by a tenth of the spacing either way, added (not scaled by k, which lets late leaps cross).
  let at = 6 + 4 * fishHash(index, 1631) + LEAP.every[p.temper] * (k + 0.2 * (fishHash(index * 13 + k, 1633) - 0.5));
  // The moments near it, in order: start after any it would overlap (a second's margin either side).
  const k0 = Math.floor((at + fishHash(index, 1613) * p.period) / p.period) - 1;
  for (let kk = k0; kk < k0 + 8; kk++) {
    const sl = slotOf(index, kk), end = sl.start + MOMENT_LENGTH[sl.moment];
    if (end + 1 <= at) continue;
    if (sl.start - 1 >= at + LEAP_LEN) break;
    at = end + 1;
  }
  return at;
}

/** The starts of the leaps begun in the last `back` seconds before `t` (latest first). */
function leapsBefore(index: number, t: number, back: number): number[] {
  const every = LEAP.every[dolphinPersonality(index).temper];
  const k = Math.max(0, Math.floor((t - 6) / every));
  const out: number[] = [];
  for (let kk = k + 1; kk >= Math.max(0, k - 2); kk--) {
    const start = dolphinLeapStart(index, kk);
    if (start <= t && start >= t - back) out.push(start);
  }
  return out.sort((x, y) => y - x);
}

/** The leap in flight at `t` (from its run to the end of its dive): its start, seconds into it. */
export function dolphinLeapAt(index: number, t: number): { start: number; into: number } | null {
  const start = leapsBefore(index, t, LEAP_LEN + 0.5)[0];
  return start === undefined ? null : { start, into: t - start };
}

/** ∫ of smoothstep(x / e) from 0 to x: a ramp's area, then 1 per second. */
const rampArea = (x: number, e: number): number => {
  if (x <= 0) return 0;
  if (x >= e) return e / 2 + (x - e);
  const c = x / e;
  return e * (c * c * c - (c * c * c * c) / 2);
};

/**
 * Seconds of cruising it is AHEAD of its route at `t` (the tank adds that much travel; 0 between leaps).
 * Each leap pushes it on by `boost` from a third of its run to halfway down its dive (eased in and out
 * over 0.6 s), then gives it all back over `giveBack` — at most 0.6 of its cruising speed, so it slows
 * after a breach but never swims backwards. Leaps' pushes add, so one that starts before the last has
 * been given back never jumps.
 */
export function dolphinLeapAhead(index: number, t: number): number {
  const a = LEAP.run * 0.3, b = LEAP.run + LEAP.air + LEAP.dive * 0.5, e = 0.6;
  const full = LEAP.boost * (b - a - e);
  let ahead = 0;
  for (const start of leapsBefore(index, t, LEAP_LEN + LEAP.giveBack + 1)) {
    const u = t - start;
    ahead += LEAP.boost * (rampArea(u - a, e) - rampArea(u - (b - e), e)) - full * smooth((u - b) / LEAP.giveBack);
  }
  return Math.max(0, ahead);
}

/**
 * The leap's drawn height and pitch at `t`, given the surface, the route's height there, its body
 * length and its cruising speed (units/s). Null between leaps. `pitch` is + nose up, from the drawn
 * path: its rise over its run along the route, the push included.
 */
export function dolphinLeap(index: number, t: number, surface: number, routeY: number, L: number, pace: number):
  { y: number; pitch: number; phase: LeapPhase; w: number; start: number; into: number } | null {
  const l = dolphinLeapAt(index, t);
  if (!l) return null;
  const vy = (4 * LEAP.height * L) / LEAP.air, g = (2 * vy) / LEAP.air;
  const curve = (u: number): number => {
    if (u < LEAP.run) return surface - vy * (LEAP.run - u);
    if (u <= LEAP.run + LEAP.air) { const a = u - LEAP.run; return surface + vy * a - 0.5 * g * a * a; }
    return surface - vy * (u - LEAP.run - LEAP.air);
  };
  // In and out over half a second at the window's ends, where the curve is far below anyway.
  const fade = (u: number): number => smooth(u / 0.5) * (1 - smooth((u - LEAP_LEN) / 0.5));
  const yAt = (u: number): number => {
    const c = curve(u), d = c - routeY, k = LEAP.soft;
    return routeY + fade(u) * (d + Math.sqrt(d * d + k * k) - k) / 2;
  };
  const h = 0.02, u = l.into;
  const rise = (yAt(u + h) - yAt(u - h)) / (2 * h);
  const ahead = (dolphinLeapAhead(index, t + h) - dolphinLeapAhead(index, t - h)) / (2 * h);
  const run = Math.max(1e-3, pace * (1 + ahead));
  const phase: LeapPhase = u < LEAP.run ? 'run' : u <= LEAP.run + LEAP.air ? 'air' : 'dive';
  return { y: yAt(u), pitch: Math.atan2(rise, run), phase, w: fade(u), start: l.start, into: u };
}

/** Sets the clips for `t`. `beat` is the distance it has swum (the tank's, or an actor's travel). */
export function dolphinFrame(rig: DolphinRig, t: number, index: number, beat: number, inp: DolphinInput): DolphinState {
  const D = rig.durations;
  const p = dolphinPersonality(index);
  // A vignette's gesture takes the place of its own moments.
  const g = inp.gesture && DOLPHIN_GESTURE_CLIP[inp.gesture.name] ? inp.gesture : null;
  const own = inp.actor ? { moment: null, weight: 0, into: 0 } : dolphinMoment(index, t);
  const moment: DolphinMoment | null = g ? DOLPHIN_GESTURE_CLIP[g.name]! : own.moment;
  const mw = g ? clamp(g.weight, 0, 1) : own.weight;
  const into = g ? g.at : own.into;
  // A one-shot held longer than its clip plays again (a beat may be long), but a flip or a roll plays once.
  // A flip or a roll once, never looped: a second turn could be cut off mid-air when the beat ends.
  const once = moment === 'flip' || moment === 'spin';
  const mt = moment ? (once ? clamp(into, 0, D[moment]) : posMod(into, D[moment])) : 0;

  const cruise = smooth((inp.pace - 0.1) / 0.5);
  // A leap takes the body: a burst up the run, the flukes still in the air, swimming down the dive.
  const lw = inp.leap ? clamp(inp.leap.w, 0, 1) * (1 - mw) : 0;
  // Eased: the tank's flurry starts and stops with a corner, and a weight that follows it straight jerks.
  const dart = smooth(inp.flurry * 1.4) * (1 - mw) * (1 - lw);
  const stroke = (1 - mw) * (1 - dart) * (1 - lw);
  // Coasting: long glides between bouts of strokes, after the catch-up.
  const GP = 9 + 5 * fishHash(index, 1619);
  const glideShare = { playful: 0.3, chatty: 0.35, curious: 0.45, showoff: 0.25 }[p.temper];
  const gl = env(posMod(t + fishHash(index, 1621) * GP, GP), 0, 1.2, glideShare * GP - 1.2, glideShare * GP);

  const weights = {} as Record<DolphinClip, number>;
  for (const n of DOLPHIN_CLIPS) weights[n] = 0;
  weights.swim = stroke * cruise * (1 - gl);
  weights.glide = stroke * cruise * gl;
  weights.hover = stroke * (1 - cruise);
  weights.burst = dart;
  if (inp.leap && lw > 0) {
    const n = inp.leap.phase === 'run' ? 'burst' : inp.leap.phase === 'air' ? 'glide' : 'swim';
    weights[n] += lw;
  }
  if (moment) weights[moment] = mw;
  // A blink over the clips that leave the eyes alone (the moments squint and blink on their own).
  const bl = dolphinBlink(index, t);
  weights.blink = bl !== null ? 1 - mw : 0;

  const phase = beat * DOLPHIN_STROKE * p.tempo;
  const times = {} as Record<DolphinClip, number>;
  for (const n of DOLPHIN_CLIPS) times[n] = 0;
  times.swim = posMod(phase, D.swim);
  times.glide = posMod(t * p.tempo, D.glide);
  times.hover = posMod(t * p.tempo, D.hover);
  times.burst = posMod(t, D.burst);
  if (moment) times[moment] = clamp(mt, 0, D[moment] - 1e-4);
  times.blink = bl ?? 0;
  for (const n of DOLPHIN_CLIPS) {
    const a = rig.actions[n];
    a.time = times[n];
    a.setEffectiveWeight(weights[n]);
  }
  rig.mixer.update(0);

  // A hard turn: the roll (the tank's) and the curl, round the turn's centre (dolphinBank); not while a
  // moment, a breach or the friendly face-turn has the body. After the mixer, which rewrites every spine
  // bone each frame (the stroke clips key them all), so the curl never accumulates.
  const friendly = moment && FRIENDLY.has(moment) && !g ? mw : 0;
  const free = (1 - mw) * (1 - lw) * (1 - friendly);
  const bk = dolphinBank(inp.turn ?? 0);
  const curl = bk.curl * free * Math.sign(inp.turn ?? 0);
  if (Math.abs(curl) > 1e-5) rig.spine.forEach((b, i) => b.rotateX(curl * CURL_SHARE[i]!));

  // Its own bubble (a vignette's `peek` too): let go at the puff.
  let bubble: DolphinState['bubble'] = null;
  if (moment === 'bubble' && mw > 0 && mt >= BUBBLE_AT) {
    const start = t - mt;
    bubble = { key: `dolphin:${index}:${start.toFixed(2)}`, t: start + BUBBLE_AT };
  }
  const face = friendly;
  const doing: DolphinDoing = moment && mw > 0.3 ? moment : dart > 0.3 ? 'burst' : cruise > 0.5 ? (gl > 0.5 ? 'glide' : 'swim') : 'hover';
  // The turn plays whenever the moment does, whatever its weight: it is the whole body, not a pose to blend.
  const turn = moment && mw > 0 ? dolphinTurn(moment, mt) : { pitch: 0, roll: 0 };
  return { doing, temper: p.temper, weights, face, bubble, into: moment ? mt : 0, turn, bank: bk.roll * free };
}

// ---------------------------------------------------------------------------
// The eyes
// ---------------------------------------------------------------------------

/** A pupil's travel on its eye's outer face, model units from where it rests (front and low): back, and up. */
export const PUPIL_SLIDE = { back: 2, up: 4 } as const;
/** How far it can look, pupils only (radians to the face's edge). */
const REACH_FWD = 0.8, REACH_UP = 0.6;
/** A saccade slot: on each one the eyes may jump to a new spot. */
const SLOT = 0.9;

export type DolphinLookAt = 'viewer' | 'friend' | 'ahead' | 'up' | 'wander';

/** Where the eyes look, as a gaze in -1..1 (f + forward, u + up), and what at. Pure in (index, t, state). */
export function dolphinGaze(index: number, t: number, doing: DolphinDoing, into: number, friend: boolean): { at: DolphinLookAt; gf: number; gu: number } {
  if (doing === 'bubble' && into > BUBBLE_AT) return { at: 'up', gf: 0.2, gu: 1 };
  if (friend) return { at: 'friend', gf: 0, gu: 0 };
  if (doing === 'chatter' || doing === 'wave' || doing === 'nod' || doing === 'shake') return { at: 'viewer', gf: 0, gu: 0 };
  const j = Math.floor(t / SLOT);
  const r = fishHash(index * 6907 + j, 1623);
  const p = dolphinPersonality(index);
  if (r < 0.3 * p.curiosity) return { at: 'viewer', gf: 0, gu: 0 };
  const gf = 2 * fishHash(index * 6911 + j, 1625) - 1, gu = 2 * fishHash(index * 6917 + j, 1627) - 1;
  if ((doing === 'swim' || doing === 'burst') && r < 0.75) return { at: 'ahead', gf: 0.7 + 0.3 * gf, gu: -0.1 + 0.25 * gu };
  return { at: 'wander', gf: 0.8 * gf, gu: 0.7 * gu };
}

/** A pupil's slide for a gaze, in the model's axes (y up, z forward), from where it rests. */
export function pupilSlide(gf: number, gu: number): { y: number; z: number } {
  const c = (v: number): number => clamp(v, -1, 1);
  // Rest is the front and low corner of its travel: forward 1 is rest, back -1 is PUPIL_SLIDE.back behind.
  return { y: (c(gu) + 1) * 0.5 * PUPIL_SLIDE.up, z: -(1 - c(gf)) * 0.5 * PUPIL_SLIDE.back };
}

const _m = new Matrix4(), _q = new Quaternion(), _q2 = new Quaternion(), _v = new Vector3(), _c = new Vector3(), _e = new Matrix4();

/**
 * Slides each pupil for this frame, after the tank has placed the dolphin
 * (its group's matrices current). `viewer`: the camera in world space, or
 * null (riding in its eye). `friend`: a point it should look at instead (a
 * vignette partner), or null.
 */
export function dolphinLook(rig: DolphinRig, t: number, index: number, state: Pick<DolphinState, 'doing' | 'into'>, viewer: Vector3 | null, friend: Vector3 | null = null): DolphinLookAt {
  const g = dolphinGaze(index, t, state.doing, state.into, !!friend);
  let at = g.at, gf0 = g.gf, gu0 = g.gu;
  const target = at === 'friend' ? friend : at === 'viewer' ? viewer : null;
  // Nobody to look at (riding in its eye): it watches where it is going.
  if ((at === 'viewer' || at === 'friend') && !target) { at = 'ahead'; gf0 = 0.8; gu0 = -0.1; }
  const toModel = _m.copy(rig.body.matrixWorld).invert();
  for (const e of rig.eyes) {
    let gf = gf0, gu = gu0;
    if (target) {
      // The target from this eye, in the eye's rest axes (model axes): what its pupil can reach.
      _e.multiplyMatrices(toModel, e.eye.matrixWorld);
      _c.setFromMatrixPosition(_e);
      _q.setFromRotationMatrix(_e.extractRotation(_e));
      _v.copy(target).applyMatrix4(toModel).sub(_c).applyQuaternion(_q.invert()).applyQuaternion(e.eyeAxes);
      const out = _v.x * e.side;
      // On its other side, this eye cannot see it: it looks ahead.
      if (out < 0.15 * Math.hypot(_v.y, _v.z)) { gf = 0.8; gu = 0; } else {
        gf = Math.atan2(_v.z, out) / REACH_FWD; gu = Math.atan2(_v.y, Math.hypot(out, _v.z)) / REACH_UP;
      }
    }
    const o = pupilSlide(gf, gu);
    // Model axes into the eye bone's own (the pupil's position is in its parent's frame).
    _v.set(0, o.y, o.z).applyQuaternion(_q2.copy(e.eyeAxes).invert());
    e.pupil.position.copy(e.pupilRest).add(_v);
  }
  return at;
}
