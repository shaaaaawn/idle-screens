/**
 * The angelfish, alive: a disc that swims with its tail and steers with its
 * fins, hangs in the water, shows itself off, and darts.
 *
 * The rig and clips come from Blender (breeds/rig/angelfish.py): the disc,
 * the back of it, the caudal fin, and the tall dorsal and anal fins with
 * their trailing streamers; clips swim, glide, burst, display. All 200
 * angelfish tokens are one model in their own paint (minted.ts), so this one
 * rig swims them all. The tank places the fish as it places any fish; this
 * module only sets the clips — each action's time and weight, every frame,
 * then `mixer.update(0)`. Everything is a closed form in t.
 *
 *   swim     always underneath, its phase from the distance swum (as the
 *            generic clip path does), so the tail beats with the travel
 *   glide    a bout per cycle: the beat all but stops, the fins ripple
 *   display  some cycles: fins raised and spread, the body tipped to show it
 *   burst    some cycles: fins folded back, two hard beats
 */
import { AnimationMixer, type AnimationAction, type AnimationClip, type Object3D } from 'three';
import { fishHash } from './swim';

export const ANGEL_CLIPS = ['swim', 'glide', 'burst', 'display'] as const;
export type AngelClip = (typeof ANGEL_CLIPS)[number];
export type AngelDoing = 'swim' | 'glide' | 'burst' | 'display';

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

/** Seconds of each bout (the one-shots' own clip lengths; a glide is held). */
const GLIDE = 5;
const DISPLAY = 3;
const BURST = 0.9;

export interface AngelCycle { period: number; offset: number; glideAt: number; actAt: number }

/** This fish's rhythm: a cycle, where in it it glides, and where its act (a display or a burst) falls. */
export function angelCycle(index: number): AngelCycle {
  const period = 12 + 8 * fishHash(index, 901);
  const glideAt = 1 + (period - GLIDE - DISPLAY - 3) * fishHash(index, 905);
  return {
    period,
    offset: fishHash(index, 903) * period,
    glideAt,
    actAt: glideAt + GLIDE + 1 + fishHash(index, 907) * 1.5,
  };
}

/** What cycle `k`'s act is: a display, a burst, or nothing. */
export function angelAct(index: number, k: number): 'display' | 'burst' | null {
  const h = fishHash(index * 7919 + k, 911);
  return h < 0.4 ? 'display' : h < 0.65 ? 'burst' : null;
}

const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const env = (t: number, a: number, b: number, c: number, d: number): number =>
  smooth((t - a) / (b - a)) * (1 - smooth((t - c) / (d - c)));
const posMod = (v: number, m: number): number => ((v % m) + m) % m;

export interface AngelState {
  doing: AngelDoing;
  /** Clip weights, for inspect and tests. */
  weights: Record<AngelClip, number>;
}

/** The moment: what it is doing, its clip times and weights. Pure in (index, t). */
export function angelMoment(index: number, t: number): AngelState & { times: Record<AngelClip, number> } {
  const c = angelCycle(index);
  const tau = t + c.offset;
  const k = Math.floor(tau / c.period);
  const u = tau - k * c.period;
  const glideW = env(u - c.glideAt, 0, 0.8, GLIDE - 0.8, GLIDE);
  const act = angelAct(index, k);
  const au = u - c.actAt;
  const displayW = act === 'display' ? env(au, 0, 0.1, DISPLAY - 0.1, DISPLAY) : 0;
  const burstW = act === 'burst' ? env(au, 0, 0.06, BURST - 0.12, BURST) : 0;
  const doing: AngelDoing = burstW > 0 ? 'burst' : displayW > 0 ? 'display' : glideW > 0.5 ? 'glide' : 'swim';
  return {
    doing,
    weights: { swim: Math.max(0, 1 - glideW - displayW - burstW), glide: glideW, burst: burstW, display: displayW },
    times: {
      swim: 0, // set from distance by angelFrame
      glide: posMod(u - c.glideAt, 4),
      burst: Math.max(0, Math.min(BURST, au)),
      display: Math.max(0, Math.min(DISPLAY, au)),
    },
  };
}

/**
 * Sets the clips for time `t`. `beat` is the distance the tank says this fish
 * has swum: the tail beats with it, as the generic clip path's does.
 */
export function angelFrame(rig: AngelRig, t: number, index: number, beat: number): AngelState {
  const m = angelMoment(index, t);
  const D = rig.durations;
  for (const n of ANGEL_CLIPS) {
    const a = rig.actions[n];
    a.time = n === 'swim' ? posMod(beat * 0.045, D.swim) : Math.min(m.times[n], D[n]);
    a.setEffectiveWeight(m.weights[n]);
  }
  rig.mixer.update(0);
  return m;
}
