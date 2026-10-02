/**
 * The shark, alive: a slow, heavy wave down a long body, and now and then the
 * strike — snout up, jaw wide, eyes rolled back, the lunge, the snap, a thrash.
 *
 * The rig and clips come from Blender (breeds/rig/shark.py): head, a jaw ringed
 * with metal teeth, eyes, pectorals and a three-link tail; clips swim, bite.
 * The tank places it as any fish (it patrols by default); this module sets
 * the clips — each action's time and weight, every frame, then
 * `mixer.update(0)` — as a closed form in t.
 *
 *   swim   always underneath, its phase from the distance swum: the tail beats
 *          slower per unit swum than a small fish's (a big fish's stroke is long)
 *   bite   on some cycles, at a moment of its own
 */
import { AnimationMixer, type AnimationAction, type AnimationClip, type Object3D } from 'three';
import { fishHash } from './swim';

export const SHARK_CLIPS = ['swim', 'bite'] as const;
export type SharkClip = (typeof SHARK_CLIPS)[number];
export type SharkDoing = 'swim' | 'bite';

export interface SharkRig {
  mixer: AnimationMixer;
  actions: Record<SharkClip, AnimationAction>;
  durations: Record<SharkClip, number>;
}

export function rigShark(body: Object3D, clips: readonly AnimationClip[]): SharkRig | null {
  const byName = new Map(clips.map((c) => [c.name, c]));
  if (!SHARK_CLIPS.every((n) => byName.has(n))) return null;
  const mixer = new AnimationMixer(body);
  const actions = {} as Record<SharkClip, AnimationAction>;
  const durations = {} as Record<SharkClip, number>;
  for (const n of SHARK_CLIPS) {
    const clip = byName.get(n)!;
    const a = mixer.clipAction(clip);
    a.play();
    a.setEffectiveWeight(0);
    actions[n] = a;
    durations[n] = clip.duration;
  }
  return { mixer, actions, durations };
}

const BITE = 1.8;
/** Swim-clip seconds per unit swum: about half a small fish's 0.045. */
export const SHARK_STROKE = 0.025;

export interface SharkCycle { period: number; offset: number; at: number }

export function sharkCycle(index: number): SharkCycle {
  const period = 12 + 8 * fishHash(index, 951);
  return { period, offset: fishHash(index, 953) * period, at: 1 + (period - BITE - 2) * fishHash(index, 955) };
}

/** Whether it strikes in cycle `k`. */
export function sharkBites(index: number, k: number): boolean {
  return fishHash(index * 7793 + k, 957) < 0.6;
}

const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const posMod = (v: number, m: number): number => ((v % m) + m) % m;

export interface SharkMoment {
  doing: SharkDoing;
  weights: Record<SharkClip, number>;
  /** Seconds into the bite clip. */
  bite: number;
}

export function sharkMoment(index: number, t: number): SharkMoment {
  const c = sharkCycle(index);
  const tau = t + c.offset;
  const k = Math.floor(tau / c.period);
  const u = tau - k * c.period - c.at;
  // The clip starts and ends at the swim's own breathing gape, so short fades suffice.
  const w = sharkBites(index, k) ? smooth(u / 0.12) * smooth((BITE - u) / 0.25) : 0;
  return { doing: w > 0 ? 'bite' : 'swim', weights: { swim: 1 - w, bite: w }, bite: Math.max(0, Math.min(BITE, u)) };
}

/** Sets the clips for time `t`; `beat` is the distance swum (the tail beats with it). */
export function sharkFrame(rig: SharkRig, t: number, index: number, beat: number): SharkMoment {
  const m = sharkMoment(index, t);
  const D = rig.durations;
  rig.actions.swim.time = posMod(beat * SHARK_STROKE, D.swim);
  rig.actions.swim.setEffectiveWeight(m.weights.swim);
  rig.actions.bite.time = Math.min(m.bite, D.bite);
  rig.actions.bite.setEffectiveWeight(m.weights.bite);
  rig.mixer.update(0);
  return m;
}
