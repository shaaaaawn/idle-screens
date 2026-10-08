/**
 * The sea turtle, alive — and each one its own character.
 *
 * The rig and clips come from Blender (breeds/rig/seaturtle.py): a rigid
 * shell, a neck blending it into the head, each fore-flipper a chain of three
 * (so a stroke runs out along the wing and the tip curls after it), the hind
 * flippers and the tail — soft, so the skin bends and never cracks. Clips
 * swim, glide, paddle, burst, ten moments (breathe, lookback, barrel,
 * somersault, wave, wipe, stretch, tuck, nod, flap) and four dials (steer,
 * lookYaw, lookPitch, reach) on bones of their own. All 16 turtle tokens are
 * one model in their own paint (minted.ts), so this one rig swims them all.
 *
 * The body, the angelfish's scheme (angel.ts):
 *
 *   stroke   phased by time AND distance, at the turtle's own tempo — it
 *            beats while it holds station and quickens as it swims faster
 *   pace     flying when cruising (with long glides between bouts of
 *            strokes, more for a voyager), sculling in place when it idles
 *   burst    only when the tank makes it dart
 *   steer    the inner wing brakes and the outer reaches through a turn
 *            (the tank banks the shell; this is the wings' part)
 *   look     the neck turns — into a turn, about the water, to the viewer
 *            when its eyes hold theirs — and reaches: a curious turtle
 *            stretches toward you, a shy one draws its head in
 *
 * The character: a PERSONALITY drawn from its slot — a temperament (voyager,
 * playful, shy, curious), a favourite move, its own tempo, how much it glides
 * and how it meets a viewer.
 *
 * Everything is a closed form in t: each action's time and weight, then
 * `mixer.update(0)`.
 */
import { AnimationMixer, type AnimationAction, type AnimationClip, type Object3D } from 'three';
import { mintedViewer } from './eyes';
import { inFront, turnDial } from './heading';
import { fishHash } from './swim';

export const TURTLE_MOMENTS = ['breathe', 'lookback', 'barrel', 'somersault', 'wave', 'wipe', 'stretch', 'tuck', 'nod', 'flap'] as const;
export type TurtleMoment = (typeof TURTLE_MOMENTS)[number];
export const TURTLE_CLIPS = ['swim', 'glide', 'paddle', 'burst', ...TURTLE_MOMENTS, 'steer', 'lookYaw', 'lookPitch', 'reach'] as const;
export type TurtleClip = (typeof TURTLE_CLIPS)[number];
export type TurtleDoing = 'swim' | 'glide' | 'paddle' | 'burst' | TurtleMoment;
export type TurtleTemper = 'voyager' | 'playful' | 'shy' | 'curious';

export interface TurtleRig {
  mixer: AnimationMixer;
  actions: Record<TurtleClip, AnimationAction>;
  durations: Record<TurtleClip, number>;
}

export function rigTurtle(body: Object3D, clips: readonly AnimationClip[]): TurtleRig | null {
  const byName = new Map(clips.map((c) => [c.name, c]));
  if (!TURTLE_CLIPS.every((n) => byName.has(n))) return null;
  const mixer = new AnimationMixer(body);
  const actions = {} as Record<TurtleClip, AnimationAction>;
  const durations = {} as Record<TurtleClip, number>;
  for (const n of TURTLE_CLIPS) {
    const clip = byName.get(n)!;
    const a = mixer.clipAction(clip);
    a.play();
    a.setEffectiveWeight(0);
    actions[n] = a;
    durations[n] = clip.duration;
  }
  return { mixer, actions, durations };
}

/** Stroke seconds per unit swum, on top of 0.8 a second: the beat quickens with speed. */
export const TURTLE_STROKE = 0.02;
/** The dial's gain on its turn (heading.ts chordTurn, radians a body length): through tanh, the
 *  routes' 90th-percentile turn (~1.7, measured live) leans it ~0.7 — never pinned hard over. */
export const TURTLE_STEER = 0.5;
/** How far the neck turns, radians, at a look dial's end (the rig's own reach). */
export const TURTLE_LOOK = { yaw: 0.5, pitch: 0.3 } as const;

const REPERTOIRE: Record<TurtleTemper, ReadonlyArray<readonly [TurtleMoment, number]>> = {
  voyager: [['breathe', 3], ['stretch', 2], ['lookback', 2], ['nod', 1], ['barrel', 1]],
  playful: [['barrel', 3], ['somersault', 3], ['flap', 3], ['wave', 2], ['nod', 1]],
  shy: [['tuck', 3], ['lookback', 2], ['wipe', 2], ['nod', 1], ['breathe', 1]],
  curious: [['nod', 2], ['wave', 2], ['wipe', 2], ['lookback', 2], ['stretch', 1], ['breathe', 1]],
};
const TEMPERS: readonly TurtleTemper[] = ['voyager', 'playful', 'shy', 'curious'];

export interface TurtlePersonality {
  temper: TurtleTemper;
  /** Its own move, reached for twice as often as its temperament would. */
  favourite: TurtleMoment;
  /** Its stroke's tempo, 0.85–1.2 of the breed's. */
  tempo: number;
  /** Seconds between moments. */
  period: number;
  /** 0..1: how often its gaze — and neck — turn to the viewer. */
  curiosity: number;
  /** Its neck when it meets the viewer: + stretches toward them, − draws in. */
  reach: number;
  /** The share of its cruising spent gliding, wings swept back. */
  glide: number;
}

export function turtlePersonality(index: number): TurtlePersonality {
  const temper = TEMPERS[Math.floor(fishHash(index, 961) * TEMPERS.length) % TEMPERS.length]!;
  const rep = REPERTOIRE[temper];
  const favourite = rep[Math.floor(fishHash(index, 963) * rep.length) % rep.length]![0];
  const base = { voyager: 14, playful: 8, shy: 12, curious: 10 }[temper];
  return {
    temper,
    favourite,
    tempo: 0.85 + 0.35 * fishHash(index, 965),
    period: base + 6 * fishHash(index, 967),
    curiosity: { voyager: 0.3, playful: 0.6, shy: 0.5, curious: 0.9 }[temper],
    reach: { voyager: 0, playful: 0.3, shy: -0.7, curious: 0.8 }[temper],
    glide: temper === 'voyager' ? 0.6 : 0.3 + 0.1 * fishHash(index, 969),
  };
}

export function turtleMomentOf(index: number, k: number): TurtleMoment {
  const p = turtlePersonality(index);
  const rep = REPERTOIRE[p.temper].map(([m, w]) => [m, m === p.favourite ? w * 2 : w] as const);
  const total = rep.reduce((s, [, w]) => s + w, 0);
  let x = fishHash(index * 7919 + k, 971) * total;
  for (const [m, w] of rep) { x -= w; if (x < 0) return m; }
  return rep[rep.length - 1]![0];
}

export interface TurtleInput {
  /** How fast it is going (the tank's speed × style × travel; ~0.1 idling, 1+ cruising). */
  pace: number;
  /** The tank's maneuver flurry: > 0 while it darts. */
  flurry: number;
  /** Its heading's change over one body length, radians (+ turning to its left). */
  turn: number;
  /** Where the viewer is from its head, radians: yaw + to its left, pitch + up. Null: no viewer. */
  viewer: { yaw: number; pitch: number } | null;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const env = (t: number, a: number, b: number, c: number, d: number): number =>
  smooth((t - a) / (b - a)) * (1 - smooth((t - c) / (d - c)));
const posMod = (v: number, m: number): number => ((v % m) + m) % m;

/** The moment playing at `t`: which, its weight, seconds into it. Pure in (index, t). */
export function turtleMoment(index: number, t: number, length: (m: TurtleMoment) => number): { moment: TurtleMoment | null; weight: number; into: number } {
  const p = turtlePersonality(index);
  const tau = t + fishHash(index, 973) * p.period;
  const k = Math.floor(tau / p.period);
  const moment = turtleMomentOf(index, k);
  const L = length(moment);
  const at = 0.5 + Math.max(0, p.period - L - 1) * 0.5 * fishHash(index * 31 + k, 975);
  const into = tau - k * p.period - at;
  const weight = env(into, 0, 0.5, L - 0.5, L);
  return { moment: weight > 0 ? moment : null, weight, into };
}

/** 0..1: how far into a glide it is at `t` — long bouts, wings swept back, between bouts of strokes. */
export function turtleGlide(index: number, t: number): number {
  const p = turtlePersonality(index);
  const P = 10 + 6 * fishHash(index, 977), L = p.glide * P;
  return env(posMod(t + fishHash(index, 979) * P, P), 0, 1.5, L - 1.5, L);
}

export interface TurtleState {
  doing: TurtleDoing;
  temper: TurtleTemper;
  /** Clip weights (the dials are always 1), for inspect and tests. */
  weights: Record<TurtleClip, number>;
  /** The steer dial, -1 (hard to its right) … 1 (hard to its left). */
  steer: number;
  /** The neck's look and reach, as the dials' settings (-1..1 each). */
  look: { yaw: number; pitch: number; reach: number };
}

/** Sets the clips for `t`. `beat` is the distance the tank says it has swum. */
export function turtleFrame(rig: TurtleRig, t: number, index: number, beat: number, inp: TurtleInput): TurtleState {
  const D = rig.durations;
  const p = turtlePersonality(index);
  const phase = (t * 0.8 + beat * TURTLE_STROKE) * p.tempo;
  const cruise = smooth((inp.pace - 0.1) / 0.5);
  // A moment, once begun, is finished before a dart takes the body: cut
  // short, a pirouette or a somersault would unwind half a turn in a frame
  // or two. (The tank still darts it along; only the stroke waits.)
  const m = turtleMoment(index, t, (n) => D[n]);
  const mw = m.weight;
  // Eased in and out: the tank's flurry starts and stops with a corner,
  // and a weight that follows it straight jerks the fins at each end.
  const dart = smooth(inp.flurry * 1.4);
  const burst = dart * (1 - m.weight);
  const stroke = (1 - m.weight) * (1 - dart);
  const g = turtleGlide(index, t);
  const steer = turnDial(inp.turn, TURTLE_STEER);

  // The neck: a slow wander, a lead into the turn, and — when its eyes hold
  // the viewer's — turned to them, stretched out or drawn in by its nature.
  const wanderYaw = 0.3 * Math.sin(t * 0.31 + index * 1.3) + 0.15 * Math.sin(t * 0.83 + index * 0.7);
  const wanderPitch = 0.25 * Math.sin(t * 0.23 + index * 2.1);
  const toViewer = inp.viewer ? mintedViewer(index, t - 0.2, 0.6) * p.curiosity * inFront(inp.viewer.yaw) : 0;
  const vYaw = inp.viewer ? clamp(inp.viewer.yaw / TURTLE_LOOK.yaw, -1, 1) : 0;
  const vPitch = inp.viewer ? clamp(inp.viewer.pitch / TURTLE_LOOK.pitch, -1, 1) : 0;
  const yaw = clamp((wanderYaw * (1 - cruise * 0.4) + steer * 0.4) * (1 - toViewer) + vYaw * toViewer, -1, 1);
  const pitch = clamp(wanderPitch * (1 - toViewer) + vPitch * toViewer, -1, 1);
  const reach = clamp(0.15 * Math.sin(t * 0.19 + index * 0.9) * (1 - toViewer) + p.reach * toViewer - 0.5 * burst, -1, 1);

  const weights = {} as Record<TurtleClip, number>;
  for (const n of TURTLE_CLIPS) weights[n] = 0;
  weights.swim = stroke * cruise * (1 - g);
  weights.glide = stroke * cruise * g;
  weights.paddle = stroke * (1 - cruise);
  weights.burst = burst;
  if (m.moment) weights[m.moment] = mw;
  weights.steer = 1; weights.lookYaw = 1; weights.lookPitch = 1; weights.reach = 1;
  const dial = (v: number, d: number): number => clamp((v + 1) * 0.5 * d, 0, d - 1e-4);
  const times = {} as Record<TurtleClip, number>;
  for (const n of TURTLE_CLIPS) times[n] = 0;
  times.swim = posMod(phase, D.swim);
  times.glide = posMod(t, D.glide);
  times.paddle = posMod(phase, D.paddle);
  times.burst = posMod(t, D.burst);
  if (m.moment) times[m.moment] = clamp(m.into, 0, D[m.moment] - 1e-4);
  times.steer = dial(steer, D.steer);
  times.lookYaw = dial(yaw, D.lookYaw);
  times.lookPitch = dial(pitch, D.lookPitch);
  times.reach = dial(reach, D.reach);
  for (const n of TURTLE_CLIPS) {
    const a = rig.actions[n];
    a.time = times[n];
    a.setEffectiveWeight(weights[n]);
  }
  rig.mixer.update(0);
  const doing: TurtleDoing = burst > 0.3 ? 'burst' : m.moment && mw > 0.3 ? m.moment : cruise > 0.5 ? (g > 0.5 ? 'glide' : 'swim') : 'paddle';
  return { doing, temper: p.temper, weights, steer, look: { yaw, pitch, reach } };
}
