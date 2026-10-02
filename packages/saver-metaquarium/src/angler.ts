/**
 * The glowfish (an anglerfish), alive: swims with its tail, stops to fish
 * with its lure, strikes, blinks — and its light lives with it.
 *
 * The rig and clips come from Blender (breeds/rig/glowfish.py): a lower jaw,
 * a head that flips open, a tail, blinking eyes and a three-link lure; clips
 * swim, lure, chomp, blink. The tank places the fish as it places any fish;
 * this module only sets the clips — each action's time and weight, every
 * frame, then `mixer.update(0)` — and the light levels of its glowing parts.
 * Everything is a closed form in t.
 *
 *   swim    always underneath, its phase from the distance swum (as the
 *           generic clip path does), so the tail beats with the travel
 *   lure    a bout per cycle: it hovers nose-down, mouth agape, and fishes
 *   chomp   on some bouts the bait is taken: the head flips open, it lunges
 *   blink   on its own clock; it keys only the eyes, so it layers over all
 *
 * The light. The lure breathes slowly; while fishing it beckons, a slow pulse;
 * at the strike it goes dark and comes back. Flash-safe by construction: no
 * level changes faster than 1.5 Hz (WCAG's line is 3 flashes a second), and
 * the strike's dimming is one fall and one rise, never a train.
 */
import { AnimationMixer, type AnimationAction, type AnimationClip, type Object3D } from 'three';
import { fishHash } from './swim';

export const ANGLER_CLIPS = ['swim', 'lure', 'chomp', 'blink'] as const;
export type AnglerClip = (typeof ANGLER_CLIPS)[number];
export type AnglerDoing = 'swim' | 'lure' | 'chomp';

export interface AnglerRig {
  mixer: AnimationMixer;
  actions: Record<AnglerClip, AnimationAction>;
  durations: Record<AnglerClip, number>;
}

export function rigAngler(body: Object3D, clips: readonly AnimationClip[]): AnglerRig | null {
  const byName = new Map(clips.map((c) => [c.name, c]));
  if (!ANGLER_CLIPS.every((n) => byName.has(n))) return null;
  const mixer = new AnimationMixer(body);
  const actions = {} as Record<AnglerClip, AnimationAction>;
  const durations = {} as Record<AnglerClip, number>;
  for (const n of ANGLER_CLIPS) {
    const clip = byName.get(n)!;
    const a = mixer.clipAction(clip);
    a.play();
    a.setEffectiveWeight(0);
    actions[n] = a;
    durations[n] = clip.duration;
  }
  return { mixer, actions, durations };
}

/** Seconds of a lure bout and of a strike (the clips' own lengths). */
const LURE = 4;
const CHOMP = 1.4;
const BLINK = 0.3;

export interface AnglerCycle { period: number; offset: number; at: number; blinkEvery: number; blinkOffset: number }

/** This fish's rhythm: a cycle, where in it the fishing starts, and how often it blinks. */
export function anglerCycle(index: number): AnglerCycle {
  const period = 11 + 7 * fishHash(index, 801);
  return {
    period,
    offset: fishHash(index, 803) * period,
    at: 1.5 + (period - LURE - CHOMP - 3) * fishHash(index, 805),
    blinkEvery: 2.6 + 2.4 * fishHash(index, 807),
    blinkOffset: fishHash(index, 809) * 5,
  };
}

/** Whether the bait is taken at the end of bout `k`. */
export function anglerStrikes(index: number, k: number): boolean {
  return fishHash(index * 7907 + k, 811) < 0.55;
}

const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const env = (t: number, a: number, b: number, c: number, d: number): number =>
  smooth((t - a) / (b - a)) * (1 - smooth((t - c) / (d - c)));
const posMod = (v: number, m: number): number => ((v % m) + m) % m;

export interface AnglerState {
  doing: AnglerDoing;
  /** Light levels, 0..1, multiplying each glowing part's colour: the lure (the esca) and the eyes. */
  lure: number;
  orbs: number;
  /** Clip weights, for inspect and tests. */
  weights: Record<AnglerClip, number>;
}

/** The moment: what it is doing, its clip times and weights, its light. Pure in (index, t). */
export function anglerMoment(index: number, t: number): AnglerState & { times: Record<AnglerClip, number> } {
  const c = anglerCycle(index);
  const tau = t + c.offset;
  const k = Math.floor(tau / c.period);
  const u = tau - k * c.period - c.at; // seconds into this bout's fishing
  const strike = anglerStrikes(index, k);
  const lureW = env(u, 0, 0.6, LURE - 0.6, LURE);
  const cu = u - LURE; // seconds into the strike
  const chompW = strike ? env(cu, 0, 0.08, CHOMP - 0.25, CHOMP) : 0;
  const b = posMod(t + c.blinkOffset, c.blinkEvery);
  const blinkW = b < BLINK ? 1 : 0;
  const doing: AnglerDoing = chompW > 0 ? 'chomp' : lureW > 0 ? 'lure' : 'swim';

  // The light: breathing always; beckoning while fishing; dark at the strike.
  const phase = fishHash(index, 813) * Math.PI * 2;
  const breath = 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.16 * t + phase));
  const beckon = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.9 * t + phase));
  const dark = strike ? env(cu, 0.25, 0.45, 0.6, 1.4) : 0;
  const lure = (breath + (beckon - breath) * lureW) * (1 - 0.7 * dark);
  const orbs = 0.9 + 0.1 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.11 * t + phase * 1.3));

  return {
    doing, lure, orbs,
    weights: { swim: Math.max(0, 1 - lureW - chompW), lure: lureW, chomp: chompW, blink: blinkW },
    times: {
      swim: 0, // set from distance by anglerFrame
      lure: Math.max(0, Math.min(LURE, u)),
      chomp: Math.max(0, Math.min(CHOMP, cu)),
      blink: Math.min(BLINK, b),
    },
  };
}

/**
 * Sets the clips for time `t` and returns the light. `beat` is the distance
 * the tank says this fish has swum (its effort, or its carrier's in a
 * formation): the tail beats with it, as the generic clip path's does.
 */
export function anglerFrame(rig: AnglerRig, t: number, index: number, beat: number): AnglerState {
  const m = anglerMoment(index, t);
  const D = rig.durations;
  for (const n of ANGLER_CLIPS) {
    const a = rig.actions[n];
    a.time = n === 'swim' ? posMod(beat * 0.045, D.swim) : Math.min(m.times[n], D[n]);
    a.setEffectiveWeight(m.weights[n]);
  }
  rig.mixer.update(0);
  return m;
}
