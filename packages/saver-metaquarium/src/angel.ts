/**
 * The angelfish, alive — and each one its own creature.
 *
 * The rig and clips come from Blender (breeds/rig/angelfish.py): a soft spine
 * (snout, head, body, the back three — blended, so it bends as one piece),
 * the dorsal and anal fins as chains along their arcs, a roll bone; clips
 * swim, hover, burst, display, nine moments (nibble, curious, kiss, soar,
 * pirouette, bow, flutter, sway, stretch) and three dials (bend, lookYaw,
 * lookPitch) on bones of their own. All 200 angelfish tokens are one model
 * in their own paint (minted.ts), so this one rig swims them all.
 *
 * The body, the dori's scheme (tang.ts), so it reads as an animal and not a
 * metronome:
 *
 *   stroke   phased by time AND distance, at the fish's own tempo — it beats
 *            while it holds station and quickens as it swims faster
 *   pace     swim when cruising, hover when it idles, crossfaded by speed
 *   burst    only when the tank makes it dart (its maneuver flurry)
 *   bend     the turn the tank is steering it through, under any stroke
 *   look     the head turns — into a turn, about the water, and to the
 *            viewer when its eyes hold theirs (eyes.ts mintedViewer)
 *
 * The creature: a PERSONALITY drawn from its slot — a temperament (graceful,
 * playful, curious), a favourite move, its own tempo and its own rhythm of
 * moments — so a school is a cast, not a chorus line. Every moment comes from
 * its temperament's repertoire on its own schedule.
 *
 * Everything is a closed form in t: each action's time and weight, then
 * `mixer.update(0)`.
 */
import { AnimationMixer, type AnimationAction, type AnimationClip, type Object3D } from 'three';
import { mintedViewer } from './eyes';
import { fishHash } from './swim';

export const ANGEL_MOMENTS = ['display', 'nibble', 'curious', 'kiss', 'soar', 'pirouette', 'bow', 'flutter', 'sway', 'stretch'] as const;
export type AngelMoment = (typeof ANGEL_MOMENTS)[number];
export const ANGEL_CLIPS = ['swim', 'hover', 'burst', ...ANGEL_MOMENTS, 'bend', 'lookYaw', 'lookPitch'] as const;
export type AngelClip = (typeof ANGEL_CLIPS)[number];
export type AngelDoing = 'swim' | 'hover' | 'burst' | AngelMoment;
export type AngelTemper = 'graceful' | 'playful' | 'curious';

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
/** How far the head turns, radians, at a look dial's end (the rig's own reach). */
export const ANGEL_LOOK = { yaw: 0.5, pitch: 0.32 } as const;

/** Each temperament's repertoire: its moments, by how often it reaches for them. */
const REPERTOIRE: Record<AngelTemper, ReadonlyArray<readonly [AngelMoment, number]>> = {
  graceful: [['soar', 3], ['bow', 2], ['stretch', 2], ['sway', 2], ['display', 2], ['curious', 1]],
  playful: [['pirouette', 3], ['flutter', 3], ['kiss', 2], ['sway', 2], ['nibble', 1], ['display', 1]],
  curious: [['curious', 3], ['nibble', 3], ['kiss', 2], ['bow', 1], ['flutter', 1], ['display', 1]],
};
const TEMPERS: readonly AngelTemper[] = ['graceful', 'playful', 'curious'];

export interface AngelPersonality {
  temper: AngelTemper;
  /** Its own move, reached for twice as often as its temperament would. */
  favourite: AngelMoment;
  /** Its stroke's tempo, 0.8–1.25 of the breed's. */
  tempo: number;
  /** Seconds between moments: a playful fish acts more often than a graceful one. */
  period: number;
  /** 0..1: how often its gaze — and head — turn to the viewer. */
  curiosity: number;
}

/** This fish's character, from its slot alone. */
export function angelPersonality(index: number): AngelPersonality {
  const temper = TEMPERS[Math.floor(fishHash(index, 941) * TEMPERS.length) % TEMPERS.length]!;
  const rep = REPERTOIRE[temper];
  const favourite = rep[Math.floor(fishHash(index, 943) * rep.length) % rep.length]![0];
  const base = temper === 'playful' ? 7 : temper === 'curious' ? 9 : 11;
  return {
    temper,
    favourite,
    tempo: 0.8 + 0.45 * fishHash(index, 945),
    period: base + 6 * fishHash(index, 947),
    curiosity: temper === 'curious' ? 0.9 : temper === 'playful' ? 0.6 : 0.4,
  };
}

/** Which moment cycle `k` of this fish brings: its repertoire, weighted, its favourite doubled. */
export function angelMomentOf(index: number, k: number): AngelMoment {
  const p = angelPersonality(index);
  const rep = REPERTOIRE[p.temper].map(([m, w]) => [m, m === p.favourite ? w * 2 : w] as const);
  const total = rep.reduce((s, [, w]) => s + w, 0);
  let x = fishHash(index * 7919 + k, 949) * total;
  for (const [m, w] of rep) { x -= w; if (x < 0) return m; }
  return rep[rep.length - 1]![0];
}

export interface AngelInput {
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
export function angelMoment(index: number, t: number, length: (m: AngelMoment) => number): { moment: AngelMoment | null; weight: number; into: number } {
  const p = angelPersonality(index);
  const tau = t + fishHash(index, 951) * p.period;
  const k = Math.floor(tau / p.period);
  const moment = angelMomentOf(index, k);
  const L = length(moment);
  // Somewhere in the cycle's first half, so a long moment never runs into the next.
  const at = 0.5 + Math.max(0, p.period - L - 1) * 0.5 * fishHash(index * 31 + k, 953);
  const into = tau - k * p.period - at;
  // Half a second each way: the stroke it hands over from is still moving,
  // and a quicker swap jerks the fins from one motion to the other.
  const weight = env(into, 0, 0.5, L - 0.5, L);
  return { moment: weight > 0 ? moment : null, weight, into };
}

export interface AngelState {
  doing: AngelDoing;
  temper: AngelTemper;
  /** Clip weights (the dials are always 1), for inspect and tests. */
  weights: Record<AngelClip, number>;
  /** The bend dial, -1 (hard to its right) … 1 (hard to its left). */
  bend: number;
  /** The head's look, as the dials' settings (-1..1 each). */
  look: { yaw: number; pitch: number };
}

/** Sets the clips for `t`. `beat` is the distance the tank says it has swum. */
export function angelFrame(rig: AngelRig, t: number, index: number, beat: number, inp: AngelInput): AngelState {
  const D = rig.durations;
  const p = angelPersonality(index);
  const phase = (t + beat * ANGEL_STROKE) * p.tempo;
  const cruise = smooth((inp.pace - 0.1) / 0.5);
  // A moment, once begun, is finished before a dart takes the body: cut
  // short, a pirouette or a somersault would unwind half a turn in a frame
  // or two. (The tank still darts it along; only the stroke waits.)
  const m = angelMoment(index, t, (n) => D[n]);
  const mw = m.weight;
  // Eased in and out: the tank's flurry starts and stops with a corner,
  // and a weight that follows it straight jerks the fins at each end.
  const dart = smooth(inp.flurry * 1.4);
  const burst = dart * (1 - m.weight);
  const stroke = (1 - m.weight) * (1 - dart);
  const bend = clamp(inp.turn * ANGEL_BEND, -1, 1);

  // The head: a slow wander about the water, a lead into the turn, and —
  // when its eyes hold the viewer's — turned to them (eased in more slowly
  // than the eyes: the eyes arrive first, the head follows).
  const wanderYaw = 0.25 * Math.sin(t * 0.37 + index * 1.7) + 0.15 * Math.sin(t * 0.91 + index * 0.3);
  const wanderPitch = 0.2 * Math.sin(t * 0.29 + index * 2.3);
  const toViewer = inp.viewer ? mintedViewer(index, t - 0.15, 0.45) * p.curiosity : 0;
  const vYaw = inp.viewer ? clamp(inp.viewer.yaw / ANGEL_LOOK.yaw, -1, 1) : 0;
  const vPitch = inp.viewer ? clamp(inp.viewer.pitch / ANGEL_LOOK.pitch, -1, 1) : 0;
  const yaw = clamp((wanderYaw * (1 - cruise * 0.5) + bend * 0.35) * (1 - toViewer) + vYaw * toViewer, -1, 1);
  const pitch = clamp(wanderPitch * (1 - toViewer) + vPitch * toViewer, -1, 1);

  const weights = {} as Record<AngelClip, number>;
  for (const n of ANGEL_CLIPS) weights[n] = 0;
  weights.swim = stroke * cruise;
  weights.hover = stroke * (1 - cruise);
  weights.burst = burst;
  if (m.moment) weights[m.moment] = mw;
  weights.bend = 1; weights.lookYaw = 1; weights.lookPitch = 1;
  // Just inside the end: a looping action AT its duration wraps to 0, and a
  // dial pinned hard over would snap to the other side.
  const dial = (v: number, d: number): number => clamp((v + 1) * 0.5 * d, 0, d - 1e-4);
  const times = {} as Record<AngelClip, number>;
  for (const n of ANGEL_CLIPS) times[n] = 0;
  times.swim = posMod(phase, D.swim);
  times.hover = posMod(phase * 0.8, D.hover);
  times.burst = posMod(t, D.burst);
  if (m.moment) times[m.moment] = clamp(m.into, 0, D[m.moment] - 1e-4);
  times.bend = dial(bend, D.bend);
  times.lookYaw = dial(yaw, D.lookYaw);
  times.lookPitch = dial(pitch, D.lookPitch);
  for (const n of ANGEL_CLIPS) {
    const a = rig.actions[n];
    a.time = times[n];
    a.setEffectiveWeight(weights[n]);
  }
  rig.mixer.update(0);
  const doing: AngelDoing = burst > 0.3 ? 'burst' : m.moment && mw > 0.3 ? m.moment : cruise > 0.5 ? 'swim' : 'hover';
  return { doing, temper: p.temper, weights, bend, look: { yaw, pitch } };
}
