/**
 * The babyfish, alive: the babies of the metaquarium. A quick, fluttery
 * stroke with a bob and a squash-and-stretch, and now and then a moment of
 * its own — a zoom, a happy wiggle with its eyes squeezed shut, a barrel
 * roll, a curious peek, a hiccup, a chase after its own tail, a sleepy yawn —
 * and a blink in between.
 *
 * The rig and clips come from Blender (breeds/rig/babyfish.py): head, body,
 * two tail links and a forked fin as a soft spine, a dorsal fin, two eyes;
 * clips swim, zoom, wiggle, flip, peek, hiccup, tailchase, yawn, and the eye
 * clips blink, wiggle_eyes, peek_eyes, hiccup_eyes and yawn_eyes. The tank places it as any fish (it schools); this module
 * sets the clips — each action's time and weight, every frame, then
 * `mixer.update(0)` — as a closed form in t.
 *
 * The eye clips move only the eyes (every other clip leaves them at rest, and
 * the intake drops a channel a clip never moves), so they play at full weight
 * on top of whatever the body is doing.
 */
import { AnimationMixer, type AnimationAction, type AnimationClip, type Object3D } from 'three';
import { fishHash } from './swim';

export const BABY_CLIPS = [
  'swim', 'zoom', 'wiggle', 'wiggle_eyes', 'flip', 'peek', 'peek_eyes', 'blink',
  'hiccup', 'hiccup_eyes', 'tailchase', 'yawn', 'yawn_eyes',
] as const;
export type BabyClip = (typeof BABY_CLIPS)[number];
export type BabyMoment = 'zoom' | 'wiggle' | 'flip' | 'peek' | 'hiccup' | 'tailchase' | 'yawn';
export type BabyDoing = 'swim' | BabyMoment;

export interface BabyRig {
  mixer: AnimationMixer;
  actions: Record<BabyClip, AnimationAction>;
  durations: Record<BabyClip, number>;
}

export function rigBaby(body: Object3D, clips: readonly AnimationClip[]): BabyRig | null {
  const byName = new Map(clips.map((c) => [c.name, c]));
  if (!BABY_CLIPS.every((n) => byName.has(n))) return null;
  const mixer = new AnimationMixer(body);
  const actions = {} as Record<BabyClip, AnimationAction>;
  const durations = {} as Record<BabyClip, number>;
  for (const n of BABY_CLIPS) {
    const clip = byName.get(n)!;
    const a = mixer.clipAction(clip);
    a.play();
    a.setEffectiveWeight(0);
    actions[n] = a;
    durations[n] = clip.duration;
  }
  return { mixer, actions, durations };
}

/** Swim-clip seconds per unit swum: a baby's stroke is short and quick (a grown fish's is 0.045). */
export const BABY_STROKE = 0.07;
/** The moments' lengths (the rig's clips), for the schedule, which knows no rig. */
const MOMENT_LENGTH: Record<BabyMoment, number> = { zoom: 1.2, wiggle: 1.6, flip: 1.4, peek: 2.4, hiccup: 0.9, tailchase: 2.0, yawn: 3.0 };
const MOMENTS: readonly [BabyMoment, number][] = [
  ['zoom', 0.18], ['wiggle', 0.18], ['peek', 0.16], ['flip', 0.1], ['hiccup', 0.14], ['tailchase', 0.12], ['yawn', 0.12],
];
const EYES_OF: Partial<Record<BabyMoment, BabyClip>> = { wiggle: 'wiggle_eyes', peek: 'peek_eyes', hiccup: 'hiccup_eyes', yawn: 'yawn_eyes' };
/** The longest moment: every cycle leaves room for it. */
const LONGEST = Math.max(...Object.values(MOMENT_LENGTH));

export interface BabyCycle { period: number; offset: number; at: number }

/** This baby's rhythm: one moment a cycle, at a time of its own. */
export function babyCycle(index: number): BabyCycle {
  const period = 6 + 6 * fishHash(index, 1401);
  return { period, offset: fishHash(index, 1403) * period, at: 0.5 + (period - LONGEST - 1) * fishHash(index, 1405) };
}

/** The moment in cycle `k`. */
export function babyMomentAt(index: number, k: number): BabyMoment {
  let r = fishHash(index * 7793 + k, 1407);
  return MOMENTS.find(([, w]) => (r -= w) < 0)?.[0] ?? 'wiggle';
}

const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const posMod = (v: number, m: number): number => ((v % m) + m) % m;

export interface BabyState {
  doing: BabyDoing;
  /** The moment's weight against the swim (0 while just swimming). */
  weight: number;
  /** Seconds into the moment's clip. */
  into: number;
  moment: BabyMoment | null;
  /** Seconds into a blink, or -1 when its eyes are open (or a moment has them). */
  blink: number;
}

export function babyMoment(index: number, t: number): BabyState {
  const c = babyCycle(index);
  const tau = t + c.offset;
  const k = Math.floor(tau / c.period);
  const u = tau - k * c.period - c.at;
  const moment = babyMomentAt(index, k);
  const len = MOMENT_LENGTH[moment];
  const live = u >= 0 && u <= len;
  // Short fades: every clip starts and ends on the rest pose.
  const weight = live ? smooth(u / 0.15) * smooth((len - u) / 0.2) : 0;
  // A blink every few seconds of its own, unless a moment has its eyes.
  const every = 2.8 + 2.4 * fishHash(index, 1409);
  const b = posMod(t + fishHash(index, 1411) * every, every);
  const eyesBusy = live && !!EYES_OF[moment];
  return {
    doing: weight > 0.02 ? moment : 'swim',
    weight, into: Math.max(0, Math.min(len, u)), moment: live ? moment : null,
    blink: !eyesBusy && b < 0.3 ? b : -1,
  };
}

/** Sets the clips for time `t`; `beat` is the distance swum (the stroke runs on it). */
export function babyFrame(rig: BabyRig, t: number, index: number, beat: number): BabyState {
  const m = babyMoment(index, t);
  const D = rig.durations;
  for (const n of BABY_CLIPS) set(rig, n, 0, 0);
  set(rig, 'swim', posMod(beat * BABY_STROKE, D.swim), 1 - m.weight);
  if (m.moment) {
    set(rig, m.moment, Math.min(m.into, D[m.moment]), m.weight);
    const eyes = EYES_OF[m.moment];
    if (eyes) set(rig, eyes, Math.min(m.into, D[eyes]), 1);
  }
  if (m.blink >= 0) set(rig, 'blink', Math.min(m.blink, D.blink), 1);
  rig.mixer.update(0);
  return m;
}

function set(rig: BabyRig, name: BabyClip, time: number, weight: number): void {
  const a = rig.actions[name];
  a.time = time;
  a.setEffectiveWeight(weight);
}
