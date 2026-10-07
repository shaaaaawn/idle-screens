/**
 * The angelfish, alive: a disc that swims with an easy beat of its tail,
 * holds station with its streamers drifting, darts when the tank makes it,
 * bends into its turns, and now and then shows itself off.
 *
 * The rig and clips come from Blender (breeds/rig/angelfish.py): a soft spine
 * (the disc's front, its back, the caudal fin — blended, so it bends as one
 * piece) and two trailing streamers; clips swim, hover, burst, display, and a
 * `bend` dial on bones of its own. All 200 angelfish tokens are one model in
 * their own paint (minted.ts), so this one rig swims them all.
 *
 * The dori's scheme (tang.ts), so it reads as an animal and not a metronome:
 *
 *   stroke   phased by time AND distance — it beats while it holds station
 *            and quickens as it swims faster; never frozen, never frantic
 *   pace     swim when cruising, hover when it idles, crossfaded by speed
 *   burst    only when the tank makes it dart (its maneuver flurry)
 *   bend     the turn the tank is steering it through, every frame, layered
 *            under whatever stroke is playing
 *   display  the one scheduled moment, a few times in a long while
 *
 * Everything is a closed form in t: each action's time and weight, then
 * `mixer.update(0)`.
 */
import { AnimationMixer, type AnimationAction, type AnimationClip, type Object3D } from 'three';
import { fishHash } from './swim';

export const ANGEL_CLIPS = ['swim', 'hover', 'burst', 'display', 'bend'] as const;
export type AngelClip = (typeof ANGEL_CLIPS)[number];
export type AngelDoing = 'swim' | 'hover' | 'burst' | 'display';

export interface AngelRig {
  mixer: AnimationMixer;
  actions: Record<AngelClip, AnimationAction>;
  durations: Record<AngelClip, number>;
}

export function rigAngel(body: Object3D, clips: readonly AnimationClip[]): AngelRig | null {
  const byName = new Map(clips.map((c) => [c.name, c]));
  if (!ANGEL_CLIPS.every((n) => byName.has(n))) return null;
  const mixer = new AnimationMixer(body);
  const actions = {} as Record<AngelClip, AnimationAction>;
  const durations = {} as Record<AngelClip, number>;
  for (const n of ANGEL_CLIPS) {
    const clip = byName.get(n)!;
    const a = mixer.clipAction(clip);
    a.play();
    a.setEffectiveWeight(0);
    actions[n] = a;
    durations[n] = clip.duration;
  }
  return { mixer, actions, durations };
}

/** Stroke seconds per unit swum, on top of one a second: the beat quickens with speed. */
export const ANGEL_STROKE = 0.01;
/** Bend-dial units per radian of turn per body length (the swim wave's measure of a turn). */
export const ANGEL_BEND = 3.2;
const DISPLAY = 3;

export interface AngelInput {
  /** How fast it is going (the tank's speed × style × travel; ~0.1 idling, 1+ cruising). */
  pace: number;
  /** The tank's maneuver flurry: > 0 while it darts. */
  flurry: number;
  /** Its heading's change over one body length, radians (+ turning to its left). */
  turn: number;
}

export interface AngelCycle { period: number; offset: number; at: number }

/** Its rhythm for the one scheduled moment: a long cycle, and where in it a display falls. */
export function angelCycle(index: number): AngelCycle {
  const period = 22 + 14 * fishHash(index, 901);
  return { period, offset: fishHash(index, 903) * period, at: 2 + (period - DISPLAY - 4) * fishHash(index, 905) };
}

/** Whether cycle `k` has a display (about one in three). */
export function angelDisplays(index: number, k: number): boolean {
  return fishHash(index * 7919 + k, 911) < 0.35;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const env = (t: number, a: number, b: number, c: number, d: number): number =>
  smooth((t - a) / (b - a)) * (1 - smooth((t - c) / (d - c)));
const posMod = (v: number, m: number): number => ((v % m) + m) % m;

export interface AngelState {
  doing: AngelDoing;
  /** Clip weights (the bend dial is always 1), for inspect and tests. */
  weights: Record<AngelClip, number>;
  /** The bend dial's setting, -1 (hard to its right) … 1 (hard to its left). */
  bend: number;
}

/** The display moment: its weight and seconds into it. Pure in (index, t). */
export function angelDisplay(index: number, t: number): { weight: number; into: number } {
  const c = angelCycle(index);
  const tau = t + c.offset;
  const k = Math.floor(tau / c.period);
  const into = tau - k * c.period - c.at;
  return { weight: angelDisplays(index, k) ? env(into, 0, 0.6, DISPLAY - 0.6, DISPLAY) : 0, into };
}

/** Sets the clips for `t`. `beat` is the distance the tank says it has swum. */
export function angelFrame(rig: AngelRig, t: number, index: number, beat: number, inp: AngelInput): AngelState {
  const D = rig.durations;
  const phase = t + beat * ANGEL_STROKE;
  const burst = clamp(inp.flurry * 1.4, 0, 1);
  const cruise = smooth((inp.pace - 0.1) / 0.5);
  const show = angelDisplay(index, t);
  const rest = 1 - show.weight;
  const stroke = rest * (1 - burst);
  const bend = clamp(inp.turn * ANGEL_BEND, -1, 1);
  const weights: Record<AngelClip, number> = {
    swim: stroke * cruise, hover: stroke * (1 - cruise), burst: rest * burst, display: show.weight, bend: 1,
  };
  const times: Record<AngelClip, number> = {
    swim: posMod(phase, D.swim),
    hover: posMod(phase * 0.8, D.hover),
    burst: posMod(t, D.burst),
    // Just inside the end: a looping action AT its duration wraps to 0, and a
    // dial pinned hard left would snap hard right.
    display: clamp(show.into, 0, D.display - 1e-4),
    bend: clamp((bend + 1) * 0.5 * D.bend, 0, D.bend - 1e-4),
  };
  for (const n of ANGEL_CLIPS) {
    const a = rig.actions[n];
    a.time = times[n];
    a.setEffectiveWeight(weights[n]);
  }
  rig.mixer.update(0);
  const doing: AngelDoing = show.weight > 0.3 ? 'display' : burst > 0.3 ? 'burst' : cruise > 0.5 ? 'swim' : 'hover';
  return { doing, weights, bend };
}
