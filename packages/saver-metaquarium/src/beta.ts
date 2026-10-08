/**
 * The betafish, alive — and each one its own character.
 *
 * The rig and clips come from Blender (breeds/rig/betafish.py): a four-bone
 * spine, the caudal fan as three rays (upper, middle, lower) of two bones
 * each, a two-bone dorsal, a pectoral and a two-bone ventral on each flank,
 * gill covers that flare — soft, so the silk fins bend and never crack.
 * Clips swim, hover, burst, ten moments (flare, spin, gulp, shimmy, rest,
 * dance, flick, bow, billow, curl) and four dials (bend, lookYaw, lookPitch,
 * spread) on bones of their own. All 256 betafish tokens are one model
 * painted by their own atlases (minted.ts), so this one rig swims them all.
 * (Until it, an authored four-bone skin wagged the tail, the same on every fish.)
 *
 * The body, the angelfish's scheme (angel.ts):
 *
 *   stroke   phased by time AND distance, at the fish's own tempo
 *   pace     swim when cruising, hover when it idles, crossfaded by speed
 *   burst    only when the tank makes it dart, eased in and out
 *   bend     a C round the turn the tank steers it through
 *   spread   its fins: open when it idles, laid back as it speeds, and —
 *            for a fighter — thrown wide at the viewer: a betta flares at
 *            what it sees (its reflection, you)
 *   look     the head turns into a turn, about the water, and to the viewer
 *
 * The character: a temperament (fighter, dreamer, showoff, curious), a
 * favourite move, its own tempo and rhythm of moments.
 *
 * Everything is a closed form in t: each action's time and weight, then
 * `mixer.update(0)`.
 */
import { AnimationMixer, type AnimationAction, type AnimationClip, type Object3D } from 'three';
import { mintedViewer } from './eyes';
import { inFront, turnDial } from './heading';
import { fishHash } from './swim';

export const BETA_MOMENTS = ['flare', 'spin', 'gulp', 'shimmy', 'rest', 'dance', 'flick', 'bow', 'billow', 'curl'] as const;
export type BetaMoment = (typeof BETA_MOMENTS)[number];
export const BETA_CLIPS = ['swim', 'hover', 'burst', ...BETA_MOMENTS, 'bend', 'lookYaw', 'lookPitch', 'spread'] as const;
export type BetaClip = (typeof BETA_CLIPS)[number];
export type BetaDoing = 'swim' | 'hover' | 'burst' | BetaMoment;
export type BetaTemper = 'fighter' | 'dreamer' | 'showoff' | 'curious';

export interface BetaRig {
  mixer: AnimationMixer;
  actions: Record<BetaClip, AnimationAction>;
  durations: Record<BetaClip, number>;
}

export function rigBeta(body: Object3D, clips: readonly AnimationClip[]): BetaRig | null {
  const byName = new Map(clips.map((c) => [c.name, c]));
  if (!BETA_CLIPS.every((n) => byName.has(n))) return null;
  const mixer = new AnimationMixer(body);
  const actions = {} as Record<BetaClip, AnimationAction>;
  const durations = {} as Record<BetaClip, number>;
  for (const n of BETA_CLIPS) {
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
export const BETA_STROKE = 0.01;
/** The dial's gain on its turn (heading.ts chordTurn, radians a body length): through tanh, the
 *  routes' 90th-percentile turn (~1.7, measured live) leans it ~0.7 — never pinned hard over. */
export const BETA_BEND = 0.5;
/** How far the head turns, radians, at a look dial's end (the rig's own reach). */
export const BETA_LOOK = { yaw: 0.4, pitch: 0.25 } as const;

const REPERTOIRE: Record<BetaTemper, ReadonlyArray<readonly [BetaMoment, number]>> = {
  fighter: [['flare', 3], ['flick', 2], ['shimmy', 2], ['curl', 2], ['spin', 1]],
  dreamer: [['billow', 3], ['rest', 3], ['gulp', 2], ['dance', 1], ['bow', 1]],
  showoff: [['dance', 3], ['spin', 2], ['flare', 2], ['curl', 2], ['billow', 1]],
  curious: [['gulp', 2], ['bow', 2], ['shimmy', 2], ['flick', 1], ['curl', 1], ['billow', 1]],
};
const TEMPERS: readonly BetaTemper[] = ['fighter', 'dreamer', 'showoff', 'curious'];

/**
 * How each temperament's eyes move (eyes.ts mintedLook): a fighter's dart and
 * hold short, and come to you often — and lock on while it displays; a
 * dreamer's drift long and slow; a showoff keeps glancing at the camera; a
 * curious one's rove widest.
 */
export const BETA_LOOK_STYLE: Record<BetaTemper, { hold: readonly [number, number]; dart: number; amp: number; viewerEvery: number }> = {
  fighter: { hold: [0.4, 1.2], dart: 0.09, amp: 0.8, viewerEvery: 0.6 },
  dreamer: { hold: [2.5, 5], dart: 0.5, amp: 0.55, viewerEvery: 2 },
  showoff: { hold: [0.8, 2], dart: 0.12, amp: 0.9, viewerEvery: 0.45 },
  curious: { hold: [0.5, 1.5], dart: 0.1, amp: 1, viewerEvery: 0.8 },
};

export interface BetaPersonality {
  temper: BetaTemper;
  /** Its own move, reached for twice as often as its temperament would. */
  favourite: BetaMoment;
  /** Its stroke's tempo, 0.8–1.2 of the breed's. */
  tempo: number;
  /** Seconds between moments. */
  period: number;
  /** 0..1: how often its gaze — and head — turn to the viewer. */
  curiosity: number;
  /** How its fins rest (the spread dial, -1..1), and how wide they go for a viewer. */
  spread: number;
  display: number;
}

export function betaPersonality(index: number): BetaPersonality {
  const temper = TEMPERS[Math.floor(fishHash(index, 1001) * TEMPERS.length) % TEMPERS.length]!;
  const rep = REPERTOIRE[temper];
  const favourite = rep[Math.floor(fishHash(index, 1003) * rep.length) % rep.length]![0];
  return {
    temper,
    favourite,
    tempo: 0.8 + 0.4 * fishHash(index, 1005),
    period: { fighter: 8, dreamer: 12, showoff: 8, curious: 10 }[temper] + 5 * fishHash(index, 1007),
    curiosity: { fighter: 0.8, dreamer: 0.3, showoff: 0.6, curious: 0.9 }[temper],
    spread: { fighter: 0.1, dreamer: -0.1, showoff: 0.3, curious: 0 }[temper],
    display: { fighter: 0.9, dreamer: 0, showoff: 0.5, curious: 0.2 }[temper],
  };
}

export function betaMomentOf(index: number, k: number): BetaMoment {
  const p = betaPersonality(index);
  const rep = REPERTOIRE[p.temper].map(([m, w]) => [m, m === p.favourite ? w * 2 : w] as const);
  const total = rep.reduce((s, [, w]) => s + w, 0);
  let x = fishHash(index * 7919 + k, 1009) * total;
  for (const [m, w] of rep) { x -= w; if (x < 0) return m; }
  return rep[rep.length - 1]![0];
}

export interface BetaInput {
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
export function betaMoment(index: number, t: number, length: (m: BetaMoment) => number): { moment: BetaMoment | null; weight: number; into: number } {
  const p = betaPersonality(index);
  const tau = t + fishHash(index, 1011) * p.period;
  const k = Math.floor(tau / p.period);
  const moment = betaMomentOf(index, k);
  const L = length(moment);
  const at = 0.5 + Math.max(0, p.period - L - 1) * 0.5 * fishHash(index * 31 + k, 1013);
  const into = tau - k * p.period - at;
  const weight = env(into, 0, 0.5, L - 0.5, L);
  return { moment: weight > 0 ? moment : null, weight, into };
}

export interface BetaState {
  doing: BetaDoing;
  temper: BetaTemper;
  /** Clip weights (the dials are always 1), for inspect and tests. */
  weights: Record<BetaClip, number>;
  /** The dials' settings, -1..1 each. */
  bend: number;
  spread: number;
  /** 0..1: its eyes locked on the viewer (a fighter's or a showoff's display: flare, curl). */
  lock: number;
  look: { yaw: number; pitch: number };
}

/** Sets the clips for `t`. `beat` is the distance the tank says it has swum. */
export function betaFrame(rig: BetaRig, t: number, index: number, beat: number, inp: BetaInput): BetaState {
  const D = rig.durations;
  const p = betaPersonality(index);
  const phase = (t + beat * BETA_STROKE) * p.tempo;
  const cruise = smooth((inp.pace - 0.1) / 0.5);
  // A moment, once begun, is finished before a dart takes the body; the dart eases in and out.
  const m = betaMoment(index, t, (n) => D[n]);
  const dart = smooth(inp.flurry * 1.4);
  const burst = dart * (1 - m.weight);
  const stroke = (1 - m.weight) * (1 - dart);
  const bend = turnDial(inp.turn, BETA_BEND);

  const wanderYaw = 0.25 * Math.sin(t * 0.41 + index * 1.3) + 0.12 * Math.sin(t * 0.97 + index * 0.6);
  const wanderPitch = 0.2 * Math.sin(t * 0.27 + index * 2.2);
  const toViewer = inp.viewer ? mintedViewer(index, t - 0.15, 0.45, BETA_LOOK_STYLE[p.temper].viewerEvery) * p.curiosity * inFront(inp.viewer.yaw) : 0;
  const vYaw = inp.viewer ? clamp(inp.viewer.yaw / BETA_LOOK.yaw, -1, 1) : 0;
  const vPitch = inp.viewer ? clamp(inp.viewer.pitch / BETA_LOOK.pitch, -1, 1) : 0;
  const yaw = clamp((wanderYaw * (1 - cruise * 0.5) + bend * 0.35) * (1 - toViewer) + vYaw * toViewer, -1, 1);
  const pitch = clamp(wanderPitch * (1 - toViewer) + vPitch * toViewer, -1, 1);
  // Its fins: their own rest, laid back with speed and in a dart, thrown wide for a viewer by its nature.
  const spread = clamp(p.spread + 0.15 * Math.sin(t * 0.23 + index * 1.7) - 0.4 * cruise - 0.6 * dart + p.display * toViewer, -1, 1);

  const weights = {} as Record<BetaClip, number>;
  for (const n of BETA_CLIPS) weights[n] = 0;
  weights.swim = stroke * cruise;
  weights.hover = stroke * (1 - cruise);
  weights.burst = burst;
  if (m.moment) weights[m.moment] = m.weight;
  weights.bend = 1; weights.lookYaw = 1; weights.lookPitch = 1; weights.spread = 1;
  const dial = (v: number, d: number): number => clamp((v + 1) * 0.5 * d, 0, d - 1e-4);
  const times = {} as Record<BetaClip, number>;
  for (const n of BETA_CLIPS) times[n] = 0;
  times.swim = posMod(phase, D.swim);
  times.hover = posMod(phase, D.hover);
  times.burst = posMod(t, D.burst);
  if (m.moment) times[m.moment] = clamp(m.into, 0, D[m.moment] - 1e-4);
  times.bend = dial(bend, D.bend);
  times.lookYaw = dial(yaw, D.lookYaw);
  times.lookPitch = dial(pitch, D.lookPitch);
  times.spread = dial(spread, D.spread);
  for (const n of BETA_CLIPS) {
    const a = rig.actions[n];
    a.time = times[n];
    a.setEffectiveWeight(weights[n]);
  }
  rig.mixer.update(0);
  const doing: BetaDoing = burst > 0.3 ? 'burst' : m.moment && m.weight > 0.3 ? m.moment : cruise > 0.5 ? 'swim' : 'hover';
  const lock = p.display >= 0.5 ? Math.max(weights.flare, weights.curl) : 0;
  return { doing, temper: p.temper, weights, bend, spread, lock, look: { yaw, pitch } };
}
