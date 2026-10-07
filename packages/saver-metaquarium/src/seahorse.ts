/**
 * The seahorse, alive — and each one its own character.
 *
 * The rig and clips come from Blender (breeds/rig/seahorse.py): a rigid trunk,
 * a neck blending it into the head and the head into the snout, the dorsal
 * fin as three bones down the back (a ripple runs along it), and the
 * prehensile tail as a chain of six along its curve — soft, so it coils into
 * a smooth spiral. Clips swim, hover, burst, ten moments (coil, twirl, dance,
 * snick, bow, bob, lookabout, stretch, wag, tilt) and four dials (curl, lean,
 * lookYaw, lookPitch) on bones of their own. All 40 seahorse tokens are one
 * model in their own paint (minted.ts), so this one rig swims them all.
 * (Until it, a vertex patch rippled the fin and coiled the tail; this module
 * had that job.)
 *
 * The body, the angelfish's scheme (angel.ts):
 *
 *   ripple   the fin's beat, phased by time AND distance at its own tempo
 *   pace     swim when cruising, hover when it idles, crossfaded by speed
 *   burst    only when the tank makes it dart, eased in and out
 *   lean     it leans into a swim and stands upright to hover
 *   curl     the tail: coiled when it hangs in the water, let out as it
 *            swims, streaming back in a dart — more coiled for a shy one
 *   look     the head turns into a turn, about the water, and to the viewer
 *            when its eyes hold theirs
 *
 * The character: a temperament (dancer, hunter, shy, curious), a favourite
 * move, its own tempo and rhythm of moments.
 *
 * Everything is a closed form in t: each action's time and weight, then
 * `mixer.update(0)`.
 */
import { AnimationMixer, type AnimationAction, type AnimationClip, type Object3D } from 'three';
import { mintedViewer } from './eyes';
import { fishHash } from './swim';

export const SEAHORSE_MOMENTS = ['coil', 'twirl', 'dance', 'snick', 'bow', 'bob', 'lookabout', 'stretch', 'wag', 'tilt'] as const;
export type SeahorseMoment = (typeof SEAHORSE_MOMENTS)[number];
export const SEAHORSE_CLIPS = ['swim', 'hover', 'burst', ...SEAHORSE_MOMENTS, 'curl', 'lean', 'lookYaw', 'lookPitch'] as const;
export type SeahorseClip = (typeof SEAHORSE_CLIPS)[number];
export type SeahorseDoing = 'swim' | 'hover' | 'burst' | SeahorseMoment;
export type SeahorseTemper = 'dancer' | 'hunter' | 'shy' | 'curious';

export interface SeahorseRig {
  mixer: AnimationMixer;
  actions: Record<SeahorseClip, AnimationAction>;
  durations: Record<SeahorseClip, number>;
}

export function rigSeahorse(body: Object3D, clips: readonly AnimationClip[]): SeahorseRig | null {
  const byName = new Map(clips.map((c) => [c.name, c]));
  if (!SEAHORSE_CLIPS.every((n) => byName.has(n))) return null;
  const mixer = new AnimationMixer(body);
  const actions = {} as Record<SeahorseClip, AnimationAction>;
  const durations = {} as Record<SeahorseClip, number>;
  for (const n of SEAHORSE_CLIPS) {
    const clip = byName.get(n)!;
    const a = mixer.clipAction(clip);
    a.play();
    a.setEffectiveWeight(0);
    actions[n] = a;
    durations[n] = clip.duration;
  }
  return { mixer, actions, durations };
}

/** Ripple seconds per unit swum, on top of one a second: the fin beats harder as it swims faster. */
export const SEAHORSE_STROKE = 0.01;
/** How far the neck turns, radians, at a look dial's end (the rig's own reach). */
export const SEAHORSE_LOOK = { yaw: 0.5, pitch: 0.3 } as const;

const REPERTOIRE: Record<SeahorseTemper, ReadonlyArray<readonly [SeahorseMoment, number]>> = {
  dancer: [['twirl', 3], ['dance', 3], ['bob', 2], ['wag', 2], ['tilt', 1]],
  hunter: [['snick', 3], ['lookabout', 2], ['bow', 1], ['coil', 1], ['stretch', 1]],
  shy: [['coil', 3], ['bow', 2], ['lookabout', 2], ['tilt', 1], ['stretch', 1]],
  curious: [['tilt', 3], ['lookabout', 2], ['snick', 2], ['bob', 1], ['stretch', 1]],
};
const TEMPERS: readonly SeahorseTemper[] = ['dancer', 'hunter', 'shy', 'curious'];

export interface SeahorsePersonality {
  temper: SeahorseTemper;
  /** Its own move, reached for twice as often as its temperament would. */
  favourite: SeahorseMoment;
  /** Its fin's tempo, 0.8–1.15 of the breed's. */
  tempo: number;
  /** Seconds between moments. */
  period: number;
  /** 0..1: how often its gaze — and head — turn to the viewer. */
  curiosity: number;
  /** How coiled its tail rests (-1..1 on the curl dial). */
  coil: number;
}

export function seahorsePersonality(index: number): SeahorsePersonality {
  const temper = TEMPERS[Math.floor(fishHash(index, 981) * TEMPERS.length) % TEMPERS.length]!;
  const rep = REPERTOIRE[temper];
  const favourite = rep[Math.floor(fishHash(index, 983) * rep.length) % rep.length]![0];
  return {
    temper,
    favourite,
    tempo: 0.8 + 0.35 * fishHash(index, 985),
    period: { dancer: 8, hunter: 10, shy: 12, curious: 9 }[temper] + 5 * fishHash(index, 987),
    curiosity: { dancer: 0.5, hunter: 0.4, shy: 0.5, curious: 0.9 }[temper],
    coil: { dancer: 0, hunter: 0.15, shy: 0.4, curious: 0.1 }[temper],
  };
}

export function seahorseMomentOf(index: number, k: number): SeahorseMoment {
  const p = seahorsePersonality(index);
  const rep = REPERTOIRE[p.temper].map(([m, w]) => [m, m === p.favourite ? w * 2 : w] as const);
  const total = rep.reduce((s, [, w]) => s + w, 0);
  let x = fishHash(index * 7919 + k, 989) * total;
  for (const [m, w] of rep) { x -= w; if (x < 0) return m; }
  return rep[rep.length - 1]![0];
}

export interface SeahorseInput {
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
export function seahorseMoment(index: number, t: number, length: (m: SeahorseMoment) => number): { moment: SeahorseMoment | null; weight: number; into: number } {
  const p = seahorsePersonality(index);
  const tau = t + fishHash(index, 991) * p.period;
  const k = Math.floor(tau / p.period);
  const moment = seahorseMomentOf(index, k);
  const L = length(moment);
  const at = 0.5 + Math.max(0, p.period - L - 1) * 0.5 * fishHash(index * 31 + k, 993);
  const into = tau - k * p.period - at;
  const weight = env(into, 0, 0.5, L - 0.5, L);
  return { moment: weight > 0 ? moment : null, weight, into };
}

export interface SeahorseState {
  doing: SeahorseDoing;
  temper: SeahorseTemper;
  /** Clip weights (the dials are always 1), for inspect and tests. */
  weights: Record<SeahorseClip, number>;
  /** The dials' settings, -1..1 each. */
  curl: number;
  lean: number;
  look: { yaw: number; pitch: number };
}

/** Sets the clips for `t`. `beat` is the distance the tank says it has swum. */
export function seahorseFrame(rig: SeahorseRig, t: number, index: number, beat: number, inp: SeahorseInput): SeahorseState {
  const D = rig.durations;
  const p = seahorsePersonality(index);
  const phase = (t + beat * SEAHORSE_STROKE) * p.tempo;
  const cruise = smooth((inp.pace - 0.1) / 0.5);
  // A moment, once begun, is finished before a dart takes the body (a twirl
  // cut short would unwind in a frame or two); the dart eases in and out.
  const m = seahorseMoment(index, t, (n) => D[n]);
  const dart = smooth(inp.flurry * 1.4);
  const burst = dart * (1 - m.weight);
  const stroke = (1 - m.weight) * (1 - dart);

  // The tail: coiled at rest (by its nature), let out as it swims, streaming in a dart, breathing slowly.
  const curl = clamp(p.coil + 0.5 * (1 - cruise) - 0.3 * cruise - 0.6 * dart + 0.15 * Math.sin(t * 0.27 + index * 1.9), -1, 1);
  const lean = clamp(-0.1 + 0.6 * cruise + 0.3 * dart, -1, 1);
  const turnLead = clamp(inp.turn * 3, -1, 1) * 0.4;
  const wanderYaw = 0.3 * Math.sin(t * 0.33 + index * 1.1) + 0.12 * Math.sin(t * 0.9 + index * 0.4);
  const wanderPitch = 0.25 * Math.sin(t * 0.25 + index * 2.7) - 0.3 * lean;  // it keeps its eyes level as it leans
  const toViewer = inp.viewer ? mintedViewer(index, t - 0.15, 0.5) * p.curiosity : 0;
  const vYaw = inp.viewer ? clamp(inp.viewer.yaw / SEAHORSE_LOOK.yaw, -1, 1) : 0;
  const vPitch = inp.viewer ? clamp(inp.viewer.pitch / SEAHORSE_LOOK.pitch, -1, 1) : 0;
  const yaw = clamp((wanderYaw + turnLead) * (1 - toViewer) + vYaw * toViewer, -1, 1);
  const pitch = clamp(wanderPitch * (1 - toViewer) + vPitch * toViewer, -1, 1);

  const weights = {} as Record<SeahorseClip, number>;
  for (const n of SEAHORSE_CLIPS) weights[n] = 0;
  weights.swim = stroke * cruise;
  weights.hover = stroke * (1 - cruise);
  weights.burst = burst;
  if (m.moment) weights[m.moment] = m.weight;
  weights.curl = 1; weights.lean = 1; weights.lookYaw = 1; weights.lookPitch = 1;
  const dial = (v: number, d: number): number => clamp((v + 1) * 0.5 * d, 0, d - 1e-4);
  const times = {} as Record<SeahorseClip, number>;
  for (const n of SEAHORSE_CLIPS) times[n] = 0;
  times.swim = posMod(phase, D.swim);
  times.hover = posMod(phase, D.hover);
  times.burst = posMod(t, D.burst);
  if (m.moment) times[m.moment] = clamp(m.into, 0, D[m.moment] - 1e-4);
  times.curl = dial(curl, D.curl);
  times.lean = dial(lean, D.lean);
  times.lookYaw = dial(yaw, D.lookYaw);
  times.lookPitch = dial(pitch, D.lookPitch);
  for (const n of SEAHORSE_CLIPS) {
    const a = rig.actions[n];
    a.time = times[n];
    a.setEffectiveWeight(weights[n]);
  }
  rig.mixer.update(0);
  const doing: SeahorseDoing = burst > 0.3 ? 'burst' : m.moment && m.weight > 0.3 ? m.moment : cruise > 0.5 ? 'swim' : 'hover';
  return { doing, temper: p.temper, weights, curl, lean, look: { yaw, pitch } };
}
