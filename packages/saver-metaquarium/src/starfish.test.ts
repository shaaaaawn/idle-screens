import { createRng } from '@idle-screens/core';
import {
  AnimationClip, Bone, BoxGeometry, Group, Mesh, MeshBasicMaterial, Quaternion, Vector3, VectorKeyframeTrack,
} from 'three';
import { describe, expect, it } from 'vitest';
import type { ControlTrack } from '@idle-screens/core';
import { METAQUARIUM_PARAMS } from './manifest';
import { compileSwimPlan } from './plan';
import {
  AEROBICS, classSpot, DANCE_MOVES, danceAt, danceBeats, rigStarfish, STARFISH_BLOOM, STARFISH_CLIPS, STARFISH_DANCE_BLOOM, STARFISH_PACE, STARFISH_RISE,
  STARFISH_STAND_BLOOM, starfishCycle, starfishFrame, starfishGait, starfishIdle, starfishMoment, starfishSpot,
  starfishStart, starfishStopAt, type StarfishClip, type StarfishDoing, type StarfishInput, type StarfishOutput, type StarfishRig,
} from './starfish';

const PLAN = compileSwimPlan(createRng(3).fork(1), { radius: 120, yMin: 15, yMax: 72 });
const DUR: Record<string, number> = {
  crawl: 2, idle: 4, wave: 3, stand: 4.6, curl: 3, rise: 1.2, standing: 4, walk: 1,
  ...Object.fromEntries(DANCE_MOVES.map((m) => [m, 2])),
};
const STRIDE = 24, WALK_STRIDE = 22, FEET = 17;
const FLAT: readonly StarfishClip[] = ['crawl', 'idle', 'wave', 'stand', 'curl'];
const UPRIGHT: readonly StarfishClip[] = ['standing', 'walk', ...DANCE_MOVES];

/** A stand-in for the Blender rig: a `body` bone at the disc's centre, a slab to lie on, every clip. */
function puppet(opts: { stride?: number; feet?: number } = {}): Group {
  const root = new Group();
  root.userData.mqStride = opts.stride ?? STRIDE;
  root.userData.mqWalkStride = WALK_STRIDE;
  root.userData.mqFeet = opts.feet ?? FEET;
  const bone = new Bone(); bone.name = 'body'; bone.position.set(0, 0, 0);
  root.add(bone);
  const slab = new Mesh(new BoxGeometry(42, 8, 40), new MeshBasicMaterial());
  slab.position.set(0, 4, 0);
  root.add(slab);
  return root;
}
const clips = (names: readonly string[] = STARFISH_CLIPS): AnimationClip[] =>
  names.map((n) => new AnimationClip(n, DUR[n]!, [new VectorKeyframeTrack('body.position', [0, DUR[n]!], [0, 0, 0, 1, 0, 0])]));
const rigged = (): StarfishRig => rigStarfish(puppet(), clips(), 0.375)!;
const input = (t: number, index = 0, over: Partial<StarfishInput> = {}): StarfishInput => ({
  t, index, plan: PLAN, start: starfishStart(PLAN, index), len: 16.2, scale: 0.375,
  ground: () => 3, camX: 0, camZ: 200, ...over,
});
const blank = (): StarfishOutput => ({ x: 0, y: 0, z: 0, quaternion: new Quaternion(), fx: 0, fz: 1, tx: 1, tz: 0, trailX: 0, trailZ: 0, focusX: 0, focusZ: 0, doing: 'crawl', bloom: 0 });
function at(index: number, k: number, u: number): number {
  const c = starfishCycle(index);
  return k * (c.crawl + c.stop) + u - c.offset;
}
const weight = (rig: StarfishRig, n: StarfishClip): number => rig.actions[n].getEffectiveWeight();
const total = (rig: StarfishRig, names: readonly StarfishClip[]): number => names.reduce((s, n) => s + weight(rig, n), 0);
/** A stop of this kind; `gaits` pins the bout before it and the bout after. */
function stopOf(doing: StarfishDoing, gaits?: ['crawl' | 'walk', 'crawl' | 'walk']): { index: number; k: number } {
  for (let i = 0; i < 60; i++) for (let k = 1; k < 40; k++) {
    if (starfishStopAt(i, k) !== doing) continue;
    if (gaits && (starfishGait(i, k) !== gaits[0] || starfishGait(i, k + 1) !== gaits[1])) continue;
    return { index: i, k };
  }
  throw new Error(`no ${doing}`);
}
function boutOf(gait: 'crawl' | 'walk'): { index: number; k: number } {
  for (let i = 0; i < 20; i++) for (let k = 1; k < 20; k++) if (starfishGait(i, k) === gait) return { index: i, k };
  throw new Error(`no ${gait}`);
}

describe('starfish: the schedule', () => {
  it('moves on, never back, and stays put while it stops', () => {
    for (const index of [0, 3, 9]) {
      let prev = -Infinity;
      for (let t = 0; t < 80; t += 0.1) {
        const m = starfishMoment(index, t);
        expect(m.crawled).toBeGreaterThanOrEqual(prev - 1e-9);
        if (m.intoStop >= 0) expect(m.speed).toBe(0);
        prev = m.crawled;
      }
    }
  });

  it('every stop turns up, both gaits turn up, and a stop has room to sit, turn, stand, turn back and rise', () => {
    const seen = new Set<StarfishDoing>(), gaits = new Set<string>();
    for (let i = 0; i < 12; i++) for (let k = 0; k < 30; k++) { seen.add(starfishStopAt(i, k)); gaits.add(starfishGait(i, k)); }
    expect([...seen].sort()).toEqual(['curl', 'idle', 'look', 'stand', 'wave']);
    expect([...gaits].sort()).toEqual(['crawl', 'walk']);
    for (let i = 0; i < 40; i++) {
      const c = starfishCycle(i);
      expect(c.stop).toBeGreaterThanOrEqual(STARFISH_RISE + 0.9 + DUR.stand! + 0.3 + 1.2 + STARFISH_RISE);
      expect(c.crawl).toBeGreaterThan(2 * 0.45);
    }
  });
});

describe('starfish: lying down', () => {
  it('rigs only a model that carries every clip, both strides and its feet, lying on the floor', () => {
    expect(rigged()).not.toBeNull();
    expect(rigStarfish(puppet(), clips(['crawl', 'idle', 'wave', 'stand', 'curl']), 1)).toBeNull();
    expect(rigStarfish(puppet({ stride: 0 }), clips(), 1)).toBeNull();
    expect(rigStarfish(puppet({ feet: 0 }), clips(), 1)).toBeNull();
    const r = rigged();
    expect([r.anchor.x, r.anchor.y, r.anchor.z]).toEqual([0, 0, 0]);
    expect([r.walkStride, r.feet]).toEqual([WALK_STRIDE, FEET]);
  });

  it('crawls face first along its route, on the ground, the ripple at full weight', () => {
    const { index, k } = boutOf('crawl');
    const rig = rigged();
    const t = at(index, k, starfishCycle(index).crawl / 2);
    const out = starfishFrame(rig, input(t, index), blank());
    const s = starfishSpot(index, t, PLAN, starfishStart(PLAN, index));
    expect(out.doing).toBe('crawl');
    expect([out.x, out.z]).toEqual([s.x, s.z]);
    expect([out.focusX, out.focusZ]).toEqual([s.x, s.z]);
    expect(out.y).toBe(3);
    expect(out.fx * s.fx + out.fz * s.fz).toBeCloseTo(1, 9);
    expect(weight(rig, 'crawl')).toBe(1);
    expect(total(rig, UPRIGHT)).toBe(0);
  });

  it('the ripple runs on distance: one crawl cycle per stride crawled', () => {
    const { index, k } = boutOf('crawl');
    const rig = rigged();
    const inp = input(0, index);
    const t1 = at(index, k, starfishCycle(index).crawl / 2), t2 = t1 + 0.05;
    starfishFrame(rig, { ...inp, t: t1 }, blank());
    const a = rig.actions.crawl.time;
    const p1 = starfishSpot(index, t1, PLAN, inp.start);
    starfishFrame(rig, { ...inp, t: t2 }, blank());
    const p2 = starfishSpot(index, t2, PLAN, inp.start);
    expect((rig.actions.crawl.time - a) / DUR.crawl!).toBeCloseTo(Math.hypot(p2.x - p1.x, p2.z - p1.z) / (STRIDE * inp.scale), 2);
    expect(STARFISH_PACE).toBeLessThan(0.6 * 0.55 * 16.2 * 1.01);
  });

  for (const doing of ['stand', 'wave'] as const) {
    it(`${doing}s at full weight mid-stop, face to the camera`, () => {
      const { index, k } = stopOf(doing, ['crawl', 'crawl']);
      const rig = rigged();
      const c = starfishCycle(index);
      const out = starfishFrame(rig, input(at(index, k, c.crawl + 0.9 + 1.5), index), blank());
      expect(out.doing).toBe(doing);
      expect(weight(rig, doing)).toBeCloseTo(1, 6);
      expect(rig.actions[doing].time).toBeCloseTo(1.5, 6);
      const to = new Vector3(0 - out.x, 0, 200 - out.z).normalize();
      expect(out.fx * to.x + out.fz * to.z).toBeGreaterThan(0.999);
    });
  }

  it('lies on a slope, tilted with it, and never sinks into the ground', () => {
    const { index, k } = boutOf('crawl');
    const rig = rigged();
    const t = at(index, k, 2);
    const gentle = starfishFrame(rig, input(t, index, { ground: (x) => 0.2 * x }), blank());
    const up = new Vector3(0, 1, 0).applyQuaternion(gentle.quaternion);
    expect(up.y).toBeLessThan(0.999);
    expect(up.y).toBeGreaterThan(Math.cos(0.3));
    const wall = starfishFrame(rig, input(t, index, { ground: (x, z) => 5 * x + 5 * z }), blank());
    expect(new Vector3(0, 1, 0).applyQuaternion(wall.quaternion).y).toBeGreaterThan(Math.cos(0.75) ** 2 - 1e-9);
    expect(wall.y).toBeGreaterThanOrEqual(5 * wall.x + 5 * wall.z - 1e-9);
  });

  it('throws little of its glow lying down, flares as it stands — never in a jump', () => {
    const rig = rigged();
    const { index: ci, k: ck } = boutOf('crawl');
    expect(starfishFrame(rig, input(at(ci, ck, starfishCycle(ci).crawl / 2), ci), blank()).bloom).toBe(STARFISH_BLOOM);
    const { index, k } = stopOf('stand');
    const c = starfishCycle(index);
    let prev = NaN, top = 0;
    for (let u = 0; u < c.crawl + c.stop; u += 1 / 60) {
      const b = starfishFrame(rig, input(at(index, k, u), index), blank()).bloom;
      if (!Number.isNaN(prev)) expect(Math.abs(b - prev)).toBeLessThan(0.05);
      prev = b; top = Math.max(top, b);
    }
    expect(top).toBeCloseTo(STARFISH_STAND_BLOOM, 3);
  });
});

describe('starfish: standing up', () => {
  it('walks some bouts upright, on its feet ahead of its resting place, phased by distance', () => {
    const { index, k } = boutOf('walk');
    const rig = rigged();
    const c = starfishCycle(index);
    const inp = input(0, index);
    const t1 = at(index, k, c.crawl / 2), t2 = t1 + 0.05;
    const out = starfishFrame(rig, { ...inp, t: t1 }, blank());
    expect(out.doing).toBe('walk');
    expect(weight(rig, 'walk')).toBe(1);
    expect(total(rig, FLAT)).toBe(0);
    // Its feet: mqFeet ahead along its facing, where the camera looks and the ground is read.
    expect(Math.hypot(out.focusX - out.x, out.focusZ - out.z)).toBeCloseTo(FEET * inp.scale, 9);
    expect((out.focusX - out.x) * out.fx + (out.focusZ - out.z) * out.fz).toBeGreaterThan(0);
    // Upright: it does not lean with a slope.
    const slope = starfishFrame(rig, { ...inp, t: t1, ground: (x) => 0.4 * x }, blank());
    expect(new Vector3(0, 1, 0).applyQuaternion(slope.quaternion).y).toBeCloseTo(1, 9);
    expect(slope.y).toBeCloseTo(0.4 * slope.focusX, 9);
    starfishFrame(rig, { ...inp, t: t1 }, blank());
    const a = rig.actions.walk.time;
    starfishFrame(rig, { ...inp, t: t2 }, blank());
    const p1 = starfishSpot(index, t1, PLAN, inp.start), p2 = starfishSpot(index, t2, PLAN, inp.start);
    expect((rig.actions.walk.time - a) / DUR.walk!).toBeCloseTo(Math.hypot(p2.x - p1.x, p2.z - p1.z) / (WALK_STRIDE * inp.scale), 2);
  });

  it('gets up before a walk and sits after it by the rise clip, its weight never left to the bind pose', () => {
    const { index, k } = stopOf('idle', ['walk', 'walk']);
    const rig = rigged();
    const c = starfishCycle(index);
    const doings = new Set<StarfishDoing>();
    for (let u = c.crawl - 0.5; u < c.crawl + c.stop + 0.5; u += 0.02) {
      const out = starfishFrame(rig, input(at(index, k, u), index), blank());
      doings.add(out.doing);
      expect(STARFISH_CLIPS.reduce((s, n) => s + weight(rig, n), 0)).toBeCloseTo(1, 9);
      // Standing, nothing flat plays; lying, nothing upright.
      if (out.doing === 'walk') expect(total(rig, FLAT)).toBe(0);
      if (out.doing === 'idle') expect(total(rig, UPRIGHT) + weight(rig, 'rise')).toBe(0);
    }
    expect([...doings]).toEqual(expect.arrayContaining(['walk', 'sit', 'idle', 'rise']));
    // Mid-sit it is the rise clip played back.
    starfishFrame(rig, input(at(index, k, c.crawl + 0.6), index), blank());
    expect(weight(rig, 'rise')).toBe(1);
    expect(rig.actions.rise.time).toBeCloseTo(STARFISH_RISE - 0.6, 9);
  });

  it('every frame of its own life makes one whole (a gesture over a turn overlaps a little, never stacks up)', () => {
    const rig = rigged();
    for (let t = 0; t < 120; t += 0.37) {
      starfishFrame(rig, input(t, 6), blank());
      const sum = STARFISH_CLIPS.reduce((s, n) => s + weight(rig, n), 0);
      expect(sum).toBeGreaterThan(0.999);
      expect(sum).toBeLessThan(1.35);
    }
  });

  it('is pure in its input', () => {
    const a = rigged(), b = rigged();
    for (const t of [0, 3.3, 17.25, 41, 77.7]) {
      const oa = starfishFrame(a, input(t, 5), blank());
      starfishFrame(a, input(t + 9, 5), blank());
      const oa2 = starfishFrame(a, input(t, 5), blank());
      const ob = starfishFrame(b, input(t, 5), blank());
      for (const o of [oa2, ob]) {
        expect([o.x, o.y, o.z, o.fx, o.fz, o.doing, o.focusX]).toEqual([oa.x, oa.y, oa.z, oa.fx, oa.fz, oa.doing, oa.focusX]);
        expect(o.quaternion.equals(oa.quaternion)).toBe(true);
      }
      for (const n of STARFISH_CLIPS) expect(b.actions[n].time).toBe(a.actions[n].time);
    }
  });

  it('gives a neighbour room — a crab or another starfish', () => {
    const rig = rigged();
    const { index, k } = boutOf('crawl');
    const t = at(index, k, 1.5);
    const alone = starfishFrame(rig, input(t, index), blank());
    const s = starfishSpot(index, t, PLAN, starfishStart(PLAN, index));
    const crowded = starfishFrame(rig, input(t, index, { others: [index, s.x, s.z, 99, s.x + 2, s.z] }), blank());
    expect(crowded.x).toBeLessThan(alone.x);
  });

  it('an actor a script is placing just idles where it is put', () => {
    const rig = rigged();
    starfishFrame(rig, input(13), blank());
    starfishIdle(rig, 12.5, 0);
    expect(weight(rig, 'idle')).toBe(1);
    expect(STARFISH_CLIPS.reduce((s, n) => s + weight(rig, n), 0)).toBe(1);
  });
});

describe('starfish: the dance', () => {
  it('aerobics: everyone on the same move, the routine in eight-counts, a bar per clip, round again', () => {
    expect(danceAt('aerobics', 0, 0)).toEqual({ move: 'march', beat: 0 });
    expect(danceAt('aerobics', 3, 17).move).toBe('jacks');
    expect(danceAt('aerobics', 0, 17)).toEqual(danceAt('aerobics', 6, 17));
    const length = AEROBICS.reduce((s, [, n]) => s + n, 0);
    expect(danceAt('aerobics', 0, length + 5)).toEqual(danceAt('aerobics', 0, 5));
    expect(new Set(AEROBICS.map(([m]) => m))).toEqual(new Set(DANCE_MOVES));
    for (const [, n] of AEROBICS) expect(n % 4).toBe(0); // whole bars: every cut is on a bar line
  });

  it('freestyle: each dancer its own move, changing every eight counts', () => {
    const at16 = new Set([0, 1, 2, 3, 4, 5, 6, 7].map((i) => danceAt('freestyle', i, 16.5).move));
    expect(at16.size).toBeGreaterThan(2);
    expect(danceAt('freestyle', 2, 16.5).move).toBe(danceAt('freestyle', 2, 23.9).move);
    expect(danceAt('freestyle', 2, 16.5).beat).toBeCloseTo(0.5, 9);
  });

  it('the class: an instructor out front, rows of four filled front first, centred', () => {
    expect(classSpot(0, 8)).toEqual({ side: 0, depth: 1.25 });
    const rows = [1, 2, 3, 4, 5, 6, 7].map((s) => classSpot(s, 8));
    expect(rows.slice(0, 4).map((r) => r.depth)).toEqual([-0, -0, -0, -0]);
    expect(rows.slice(0, 4).map((r) => r.side)).toEqual([-1.5, -0.5, 0.5, 1.5]);
    expect(rows.slice(4).map((r) => [r.side, r.depth])).toEqual([[-1, -1], [0, -1], [1, -1]]);
    // A capped cast loses a back-row dancer: the front row stands where it stood.
    for (const s of [0, 1, 2, 3, 4]) expect(classSpot(s, 7)).toEqual(classSpot(s, 9));
    // Two dance side by side, no instructor.
    expect([classSpot(0, 2), classSpot(1, 2)]).toEqual([{ side: -0.5, depth: -0 }, { side: 0.5, depth: -0 }]);
  });

  it('a dancer stands on its spot, faces the class\'s way, and plays its move alone, a bar per four beats', () => {
    const rig = rigged();
    const yaw = 0.7;
    const out = starfishFrame(rig, input(50, 3, { dance: { mode: 'aerobics', beats: 18.5, x: 10, z: -4, yaw } }), blank());
    expect(out.doing).toBe('jacks');
    expect([out.focusX, out.focusZ]).toEqual([10, -4]);
    // The group sits mqFeet behind the feet: it rose over its front tips.
    expect(out.x).toBeCloseTo(10 - Math.sin(yaw) * FEET * 0.375, 9);
    expect(out.z).toBeCloseTo(-4 - Math.cos(yaw) * FEET * 0.375, 9);
    expect(out.y).toBe(3);
    expect([out.fx, out.fz]).toEqual([Math.sin(yaw), Math.cos(yaw)]);
    expect(weight(rig, 'jacks')).toBe(1);
    expect(STARFISH_CLIPS.reduce((s, n) => s + weight(rig, n), 0)).toBe(1);
    expect(rig.actions.jacks.time).toBeCloseTo((2.5 / 4) * DUR.jacks!, 9);
    expect(out.bloom).toBe(STARFISH_DANCE_BLOOM); // held: the beat (2 Hz at 120) is past the flash limit
  });
});

describe('starfish: the beat', () => {
  const space = METAQUARIUM_PARAMS;
  it('a steady tempo: beats are bpm × t, whether or not the tempo is on the track', () => {
    expect(danceBeats(30, 128, space, null, false)).toBeCloseTo(64, 9);
    const steady: ControlTrack = { program: 'metaquarium', seed: 1, deltas: [{ t: 0, path: 'danceTempo', value: 128, ease: 'step', dur: 0 }] };
    for (const t of [0, 7.5, 30, 600]) expect(danceBeats(t, 128, space, steady, true)).toBeCloseTo((t * 128) / 60, 6);
  });

  it('a glide speeds the beat up without a jump in it, and lands on the new tempo', () => {
    // 120 BPM, then from 20 s a 4 s glide to 180.
    const track: ControlTrack = { program: 'metaquarium', seed: 1, deltas: [
      { t: 0, path: 'danceTempo', value: 120, ease: 'step', dur: 0 },
      { t: 20000, path: 'danceTempo', value: 180, ease: 'smooth', dur: 4000 },
    ] };
    const beats = (t: number): number => danceBeats(t, 120, space, track, true);
    expect(beats(10)).toBeCloseTo(20, 6);               // 2 a second before it
    let prev = beats(19);
    for (let t = 19 + 1 / 120; t < 26; t += 1 / 120) {  // through the glide at 120 fps
      const b = beats(t);
      expect(b - prev).toBeGreaterThan(0);
      expect(b - prev).toBeLessThan((180 / 60) / 120 + 1e-6); // never faster than the new tempo: no jump
      prev = b;
    }
    expect(beats(40) - beats(30)).toBeCloseTo(30, 4);   // 3 a second after it
  });
});
