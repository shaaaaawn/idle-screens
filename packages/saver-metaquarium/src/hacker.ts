/**
 * The hackerfish, alive: half fish, half computer. Its fins paddle, it hacks,
 * it crashes and reboots — and its face is a screen (screen.ts).
 *
 * The rig and clips come from Blender (breeds/rig/hackerfish.py): the box, its
 * screen, two paddle fins and a tail; clips swim, type, glitch. The tank
 * places it as any fish; this module sets the clips (each action's time and
 * weight, every frame, then `mixer.update(0)`) and what the screen shows. A
 * closed form in t throughout.
 *
 *   faces   most of the time: an expression every few seconds, refreshed by a
 *           scan-down wipe; the neutral face (the designer's) blinks
 *   hack    once a cycle: a focused face, then code rain while the fins type
 *   crash   on some cycles, after the hack: the screen tears (glitch), shows
 *           x_x, boots with a spinner, and comes back happy
 */
import { AnimationMixer, type AnimationAction, type AnimationClip, type Object3D } from 'three';
import type { Glyph, ScreenState } from './screen';
import { fishHash } from './swim';

export const HACKER_CLIPS = ['swim', 'type', 'glitch'] as const;
export type HackerClip = (typeof HACKER_CLIPS)[number];
export type HackerDoing = 'swim' | 'hack' | 'crash' | 'boot';

export interface HackerRig {
  mixer: AnimationMixer;
  actions: Record<HackerClip, AnimationAction>;
  durations: Record<HackerClip, number>;
}

export function rigHacker(body: Object3D, clips: readonly AnimationClip[]): HackerRig | null {
  const byName = new Map(clips.map((c) => [c.name, c]));
  if (!HACKER_CLIPS.every((n) => byName.has(n))) return null;
  const mixer = new AnimationMixer(body);
  const actions = {} as Record<HackerClip, AnimationAction>;
  const durations = {} as Record<HackerClip, number>;
  for (const n of HACKER_CLIPS) {
    const clip = byName.get(n)!;
    const a = mixer.clipAction(clip);
    a.play();
    a.setEffectiveWeight(0);
    actions[n] = a;
    durations[n] = clip.duration;
  }
  return { mixer, actions, durations };
}

const TYPE = 2.4;    // the type clip
const GLITCH = 1.0;  // the glitch clip
const DEAD = 0.7;    // x_x, after the tear
const BOOT = 1.8;    // the spinner
const SLOT = 3.5;    // seconds an expression holds
const WIPE = 0.3;    // the scan-down refresh
const BLINK = 0.18;

/** Faces it wears between hacks: the designer's own twice as often as any other. */
const MOODS: readonly Glyph[] = ['neutral', 'neutral', 'happy', 'wink', 'cool', 'love', 'surprised', 'sleepy'];

export interface HackerCycle { period: number; offset: number; at: number; blinkEvery: number; blinkOffset: number; slotOffset: number }

export function hackerCycle(index: number): HackerCycle {
  const period = 14 + 8 * fishHash(index, 901);
  return {
    period,
    offset: fishHash(index, 903) * period,
    // Room before the hack for a face or two, and after it for a whole crash.
    at: 2 + (period - 2 - TYPE - 1.5 - GLITCH - DEAD - BOOT - 1) * fishHash(index, 905),
    blinkEvery: 3.1 + 1.4 * fishHash(index, 907),
    blinkOffset: fishHash(index, 909) * 4,
    slotOffset: fishHash(index, 911) * SLOT,
  };
}

/** Whether the hack in cycle `k` ends in a crash. */
export function hackerCrashes(index: number, k: number): boolean {
  return fishHash(index * 7841 + k, 913) < 0.4;
}

export function moodAt(index: number, slot: number): Glyph {
  return MOODS[Math.floor(fishHash(index * 131 + slot, 915) * MOODS.length) % MOODS.length]!;
}

const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const env = (t: number, a: number, b: number, c: number, d: number): number =>
  smooth((t - a) / (b - a)) * (1 - smooth((t - c) / (d - c)));
const posMod = (v: number, m: number): number => ((v % m) + m) % m;

export interface HackerMoment {
  doing: HackerDoing;
  weights: Record<HackerClip, number>;
  times: Record<HackerClip, number>;
  screen: ScreenState;
}

/** Where a face wipe stands at `t`: the expression slots, and the blink. */
function faces(index: number, t: number, c: HackerCycle): ScreenState {
  const s = t + c.slotOffset;
  const slot = Math.floor(s / SLOT), u = s - slot * SLOT;
  const to = moodAt(index, slot), from = moodAt(index, slot - 1);
  if (u < WIPE) return { from, to, wipe: u / WIPE, mode: 'face', level: 1 };
  const blink = to === 'neutral' && posMod(t + c.blinkOffset, c.blinkEvery) < BLINK;
  return { from: blink ? 'blink' : to, to: blink ? 'blink' : to, wipe: 0, mode: 'face', level: 1 };
}

/** Back up after a reboot: x_x wipes to happy, which holds until the next
 *  expression slot, and that slot's wipe starts from happy. Null once the
 *  ordinary faces have taken over. */
function back(index: number, t: number, g: number, c: HackerCycle): ScreenState | null {
  const v = g - (GLITCH + DEAD + BOOT);
  if (v < WIPE) return { from: 'dead', to: 'happy', wipe: v / WIPE, mode: 'face', level: 1 };
  const bootEnd = t - v + c.slotOffset;
  const next = (Math.floor(bootEnd / SLOT) + 1) * SLOT;   // the first slot boundary after the boot
  const s = t + c.slotOffset;
  if (s < next) return { from: 'happy', to: 'happy', wipe: 0, mode: 'face', level: 1 };
  if (s < next + WIPE) return { from: 'happy', to: moodAt(index, next / SLOT), wipe: (s - next) / WIPE, mode: 'face', level: 1 };
  return null;
}

export function hackerMoment(index: number, t: number): HackerMoment {
  const c = hackerCycle(index);
  const tau = t + c.offset;
  const k = Math.floor(tau / c.period);
  const u = tau - k * c.period - c.at; // seconds into this cycle's hack
  const crash = hackerCrashes(index, k);
  const g = u - TYPE - 1.5;           // seconds into the crash
  const typeW = env(u, 0, 0.3, TYPE - 0.35, TYPE);
  const glitchW = crash ? env(g, 0, 0.1, GLITCH - 0.3, GLITCH) : 0;
  const weights = { swim: Math.max(0, 1 - typeW - glitchW), type: typeW, glitch: glitchW };
  const times = { swim: 0, type: Math.max(0, Math.min(TYPE, u)), glitch: Math.max(0, Math.min(GLITCH, g)) };

  let screen: ScreenState;
  let doing: HackerDoing = 'swim';
  if (crash && g >= 0 && g < GLITCH + DEAD + BOOT) {
    if (g < GLITCH) { screen = { from: 'glitchy', to: 'glitchy', wipe: 0, mode: 'glitch', level: 1 }; doing = 'crash'; }
    else if (g < GLITCH + DEAD) {
      screen = { from: 'glitchy', to: 'dead', wipe: Math.min(1, (g - GLITCH) / WIPE), mode: 'face', level: 1 }; doing = 'crash';
    } else { screen = { from: 'dead', to: 'dead', wipe: 0, mode: 'boot', level: 0.75 }; doing = 'boot'; }
  } else if (crash && g >= GLITCH + DEAD + BOOT && back(index, t, g, c)) {
    screen = back(index, t, g, c)!;
  } else if (u >= -0.6 && u < TYPE + 0.6) {
    doing = u >= 0 && u < TYPE ? 'hack' : 'swim';
    if (u >= 0.25 && u < TYPE - 0.2) screen = { from: 'focus', to: 'focus', wipe: 0, mode: 'rain', level: 1 };
    else if (u < 0) screen = { from: faces(index, t, c).to, to: 'focus', wipe: Math.min(1, (u + 0.6) / WIPE), mode: 'face', level: 1 };
    else if (u < TYPE) screen = { from: 'focus', to: 'focus', wipe: 0, mode: 'face', level: 1 };
    else screen = { from: 'focus', to: faces(index, t, c).to, wipe: Math.min(1, (u - TYPE) / WIPE), mode: 'face', level: 1 };
  } else {
    screen = faces(index, t, c);
  }
  return { doing, weights, times, screen };
}

/** Sets the clips for time `t`; `beat` is the distance swum (the tail beats with it). */
export function hackerFrame(rig: HackerRig, t: number, index: number, beat: number): HackerMoment {
  const m = hackerMoment(index, t);
  const D = rig.durations;
  for (const n of HACKER_CLIPS) {
    const a = rig.actions[n];
    a.time = n === 'swim' ? posMod(beat * 0.045, D.swim) : Math.min(m.times[n], D[n]);
    a.setEffectiveWeight(m.weights[n]);
  }
  rig.mixer.update(0);
  return m;
}
