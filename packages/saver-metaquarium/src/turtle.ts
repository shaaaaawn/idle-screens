/**
 * The sea turtle, alive: it flies through the water on its fore-flippers,
 * glides with them swept back, hangs in place sculling with its hind ones,
 * and turns its head to look about.
 *
 * The rig and clips come from Blender (breeds/rig/seaturtle.py): the shell,
 * the head, two fore-flippers and two hind; clips swim, glide, look, paddle.
 * All 16 turtle tokens are one model in their own paint (minted.ts), so this
 * one rig swims them all. Until it, the turtle glided rigid (it is on the
 * body wave's NO_WAVE list). This module only sets the clips — each action's
 * time and weight, every frame, then `mixer.update(0)`. A closed form in t.
 *
 *   swim     always underneath, its stroke phased from the distance swum
 *   glide    a long bout per cycle: flippers swept back, held
 *   look     some cycles: the head turns aside, holds, comes back
 *   paddle   some cycles: hanging in place, sculling
 */
import { AnimationMixer, type AnimationAction, type AnimationClip, type Object3D } from 'three';
import { fishHash } from './swim';

export const TURTLE_CLIPS = ['swim', 'glide', 'look', 'paddle'] as const;
export type TurtleClip = (typeof TURTLE_CLIPS)[number];
export type TurtleDoing = 'swim' | 'glide' | 'look' | 'paddle';

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

/** Seconds of each bout (a glide and a paddle are held; a look is its clip). */
const GLIDE = 7;
const LOOK = 3;
const PADDLE = 4;

export interface TurtleCycle { period: number; offset: number; glideAt: number; actAt: number }

/** This turtle's rhythm: a cycle, where in it it glides, and where its act (a look or a paddle) falls. */
export function turtleCycle(index: number): TurtleCycle {
  const period = 18 + 10 * fishHash(index, 921);
  const glideAt = 1 + (period - GLIDE - PADDLE - 4) * fishHash(index, 925);
  return {
    period,
    offset: fishHash(index, 923) * period,
    glideAt,
    actAt: glideAt + GLIDE + 1.5 + fishHash(index, 927) * 1.5,
  };
}

/** What cycle `k`'s act is: a look about, a paddle in place, or nothing. */
export function turtleAct(index: number, k: number): 'look' | 'paddle' | null {
  const h = fishHash(index * 7927 + k, 931);
  return h < 0.4 ? 'look' : h < 0.7 ? 'paddle' : null;
}

const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const env = (t: number, a: number, b: number, c: number, d: number): number =>
  smooth((t - a) / (b - a)) * (1 - smooth((t - c) / (d - c)));
const posMod = (v: number, m: number): number => ((v % m) + m) % m;

export interface TurtleState {
  doing: TurtleDoing;
  /** Clip weights, for inspect and tests. */
  weights: Record<TurtleClip, number>;
}

/** The moment: what it is doing, its clip times and weights. Pure in (index, t). */
export function turtleMoment(index: number, t: number): TurtleState & { times: Record<TurtleClip, number> } {
  const c = turtleCycle(index);
  const tau = t + c.offset;
  const k = Math.floor(tau / c.period);
  const u = tau - k * c.period;
  const glideW = env(u - c.glideAt, 0, 1.2, GLIDE - 1.2, GLIDE);
  const act = turtleAct(index, k);
  const au = u - c.actAt;
  const lookW = act === 'look' ? env(au, 0, 0.2, LOOK - 0.2, LOOK) : 0;
  const paddleW = act === 'paddle' ? env(au, 0, 0.6, PADDLE - 0.6, PADDLE) : 0;
  const doing: TurtleDoing = lookW > 0.5 ? 'look' : paddleW > 0.5 ? 'paddle' : glideW > 0.5 ? 'glide' : 'swim';
  return {
    doing,
    weights: { swim: Math.max(0, 1 - glideW - lookW - paddleW), glide: glideW, look: lookW, paddle: paddleW },
    times: {
      swim: 0, // set from distance by turtleFrame
      glide: posMod(u - c.glideAt, 5),
      look: Math.max(0, Math.min(LOOK, au)),
      paddle: posMod(au, 2),
    },
  };
}

/**
 * Sets the clips for time `t`. `beat` is the distance the tank says this fish
 * has swum: the tail beats with it, as the generic clip path's does.
 */
export function turtleFrame(rig: TurtleRig, t: number, index: number, beat: number): TurtleState {
  const m = turtleMoment(index, t);
  const D = rig.durations;
  for (const n of TURTLE_CLIPS) {
    const a = rig.actions[n];
    a.time = n === 'swim' ? posMod(beat * 0.045, D.swim) : Math.min(m.times[n], D[n]);
    a.setEffectiveWeight(m.weights[n]);
  }
  rig.mixer.update(0);
  return m;
}
