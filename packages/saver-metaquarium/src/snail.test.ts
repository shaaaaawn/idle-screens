import { createRng } from '@idle-screens/core';
import {
  AnimationClip, Bone, BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Quaternion, Vector3, VectorKeyframeTrack,
} from 'three';
import { describe, expect, it } from 'vitest';
import type { CrabInput } from './crab';
import { compileSwimPlan } from './plan';
import {
  dressSnail, pupilOffset, PUPIL_TRAVEL, rigSnail, SNAIL_CLIPS, snailBlinkAt, snailCycle, snailFrame, snailGaze, snailGlow, snailIdle, snailLook,
  snailMoment, snailShellLight, snailShellOf, snailSpot, snailStart, snailStopAt,
  type SnailDoing, type SnailInput, type SnailOutput, type SnailRig,
} from './snail';
import { actorTravel } from './dot';
import { OPEN_MARKS, parseVignette, poseOf } from './vignette';

const PLAN = compileSwimPlan(createRng(3).fork(1), { radius: 120, yMin: 15, yMax: 72 });
const DUR: Record<string, number> = { glide: 2.4, idle: 4, look: 3.5, retract: 5, stretch: 3.5, munch: 3, blink: 0.4 };
const STRIDE = 6;

/** A stand-in for the Blender rig: a box to stand on, a stride, the seven clips, two eyes with pupils, a shell in two parts. */
function puppet(stride = STRIDE): Group {
  const root = new Group();
  root.userData.mqStride = stride;
  const box = new Mesh(new BoxGeometry(10, 24, 36), new MeshBasicMaterial());
  box.position.set(0, 4, -3);
  root.add(box);
  for (const [side, s] of [['L', 1], ['R', -1]] as const) {
    // As three loads them: '.' dropped from the name, the eye at its centre, the pupil on its face (+z is the front).
    const eye = new Bone(); eye.name = `eye${side}`; eye.position.set(4 * s, 17, 15);
    const pupil = new Bone(); pupil.name = `pupil${side}`; pupil.position.set(-1 * s, -1, 2);
    eye.add(pupil); root.add(eye);
  }
  for (const name of ['PrimaryColor', 'SecondaryColor']) {
    const m = new MeshLambertMaterial({ color: name === 'PrimaryColor' ? '#c46a2a' : '#f0c890' }); m.name = name;
    root.add(new Mesh(new BoxGeometry(1, 1, 1), m));
  }
  return root;
}
const clips = (names: readonly string[] = SNAIL_CLIPS): AnimationClip[] =>
  names.map((n) => new AnimationClip(n, DUR[n]!, [new VectorKeyframeTrack('.position', [0, DUR[n]!], [0, 0, 0, 1, 0, 0])]));
const rigged = (): SnailRig => rigSnail(puppet(), clips(), 0.4)!;
const input = (t: number, index = 0, over: Partial<CrabInput> = {}): CrabInput => ({
  t, index, plan: PLAN, start: snailStart(PLAN, index), len: 13, scale: 0.4 * 0.8,
  ground: () => 2, camX: 0, camZ: 200, ...over,
});
const blank = (): SnailOutput => ({ x: 0, y: 0, z: 0, quaternion: new Quaternion(), fx: 0, fz: 1, tx: 1, tz: 0, trailX: 0, trailZ: 0, doing: 'glide' });
function at(index: number, k: number, u: number): number {
  const c = snailCycle(index);
  return k * (c.glide + c.stop) + u - c.offset;
}
const weight = (rig: SnailRig, n: (typeof SNAIL_CLIPS)[number]): number => rig.actions[n].getEffectiveWeight();
function stopOf(doing: SnailDoing): { index: number; k: number } {
  for (let i = 0; i < 40; i++) for (let k = 1; k < 40; k++) if (snailStopAt(i, k) === doing) return { index: i, k };
  throw new Error(doing);
}

describe('snail: the schedule', () => {
  it('glides on, never back, and holds still while it stops', () => {
    for (const index of [0, 4, 11]) {
      let prev = -Infinity;
      for (let t = 0; t < 90; t += 0.1) {
        const m = snailMoment(index, t);
        expect(m.glided).toBeGreaterThanOrEqual(prev - 1e-9);
        if (m.intoStop >= 0) expect(m.speed).toBe(0);
        prev = m.glided;
      }
    }
  });

  it('every stop turns up, and a stop has room for the turn in, the 5 s retract and the turn out', () => {
    const seen = new Set<SnailDoing>();
    for (let i = 0; i < 12; i++) for (let k = 0; k < 30; k++) seen.add(snailStopAt(i, k));
    expect([...seen].sort()).toEqual(['idle', 'look', 'munch', 'retract', 'stretch']);
    for (let i = 0; i < 40; i++) {
      const c = snailCycle(i);
      expect(c.stop).toBeGreaterThanOrEqual(0.9 + 5 + 0.35 + 1.4);
      const b = snailBlinkAt(i, 3, c.glide);
      expect(b).toBeGreaterThanOrEqual(1);
      expect(b + DUR.blink!).toBeLessThanOrEqual(c.glide);
    }
  });
});

describe('snail: the frame', () => {
  it('rigs only a model that carries the seven clips and a stride; it turns about the middle of its footprint', () => {
    expect(rigSnail(puppet(), clips(['glide', 'idle']), 1)).toBeNull();
    expect(rigSnail(puppet(0), clips(), 1)).toBeNull();
    const r = rigged();
    expect(r.anchor.x).toBeCloseTo(0, 6);
    expect(r.anchor.y).toBeCloseTo(-8, 6);
    expect(r.anchor.z).toBeCloseTo(-3, 6);
  });

  it('glides head first along its route, on the ground, the wave keeping time with the distance', () => {
    const rig = rigged();
    const c = snailCycle(0);
    const t = at(0, 2, c.glide / 2);
    const out = snailFrame(rig, input(t), blank());
    const s = snailSpot(0, t, PLAN, snailStart(PLAN, 0));
    expect(out.doing).toBe('glide');
    expect(out.x).toBeCloseTo(s.x, 9);
    expect(out.z).toBeCloseTo(s.z, 9);
    expect(out.y).toBe(2);
    expect(out.fx * s.fx + out.fz * s.fz).toBeCloseTo(1, 9);
    expect(weight(rig, 'glide')).toBe(1);
    expect(weight(rig, 'idle')).toBe(0);
    // One glide cycle per stride covered.
    const inp = input(0);
    const t2 = t + 0.5;
    const a = rig.actions.glide.time;
    snailFrame(rig, { ...inp, t: t2 }, blank());
    const b = rig.actions.glide.time;
    const p2 = snailSpot(0, t2, PLAN, inp.start);
    const moved = Math.hypot(p2.x - s.x, p2.z - s.z);
    const cycles = (((b - a) % DUR.glide! + DUR.glide!) % DUR.glide!) / DUR.glide!;
    expect(cycles).toBeCloseTo(moved / (STRIDE * inp.scale), 2);
  });

  it('a look plays at full weight mid-stop, turned to the camera; a munch keeps to its route', () => {
    const { index, k } = stopOf('look');
    const rig = rigged();
    const c = snailCycle(index);
    const out = snailFrame(rig, input(at(index, k, c.glide + 0.9 + 1.5), index), blank());
    expect(out.doing).toBe('look');
    expect(weight(rig, 'look')).toBeCloseTo(1, 6);
    expect(rig.actions.look.time).toBeCloseTo(1.5, 6);
    expect(weight(rig, 'glide')).toBe(0);
    const to = new Vector3(-out.x, 0, 200 - out.z).normalize();
    expect(out.fx * to.x + out.fz * to.z).toBeGreaterThan(0.999);

    const m = stopOf('munch');
    const mc = snailCycle(m.index);
    const t = at(m.index, m.k, mc.glide + 2);
    const munch = snailFrame(rig, input(t, m.index), blank());
    const s = snailSpot(m.index, t, PLAN, snailStart(PLAN, m.index));
    expect(munch.doing).toBe('munch');
    expect(munch.fx * s.fx + munch.fz * s.fz).toBeCloseTo(1, 9);
    expect(weight(rig, 'munch')).toBeCloseTo(1, 6);
  });

  it('a retract plays whole, and it sets off again facing its route', () => {
    const { index, k } = stopOf('retract');
    const rig = rigged();
    const c = snailCycle(index);
    snailFrame(rig, input(at(index, k, c.glide + 0.9 + 4.9), index), blank());
    expect(weight(rig, 'retract')).toBeGreaterThan(0.5);
    expect(rig.actions.retract.time).toBeCloseTo(4.9, 6);
    const end = snailFrame(rig, input(at(index, k, c.glide + c.stop - 1e-6), index), blank());
    const s = snailSpot(index, at(index, k + 1, 0), PLAN, snailStart(PLAN, index));
    expect(end.fx * s.fx + end.fz * s.fz).toBeGreaterThan(0.999);
  });

  it('blinks once a glide, over the glide, at full weight', () => {
    const rig = rigged();
    const c = snailCycle(2);
    const b = snailBlinkAt(2, 5, c.glide);
    snailFrame(rig, input(at(2, 5, b + 0.1), 2), blank());
    expect(rig.actions.blink.time).toBeCloseTo(0.1, 6);
    expect(weight(rig, 'blink')).toBeCloseTo(weight(rig, 'glide'), 9);
    snailFrame(rig, input(at(2, 5, b - 0.1), 2), blank());
    expect(weight(rig, 'blink')).toBe(0);
  });

  it('is pure in its input', () => {
    const a = rigged(), b = rigged();
    for (const t of [0, 5.5, 21.25, 63]) {
      const oa = snailFrame(a, input(t, 7), blank());
      snailFrame(a, input(t + 11, 7), blank());
      const oa2 = snailFrame(a, input(t, 7), blank());
      const ob = snailFrame(b, input(t, 7), blank());
      for (const o of [oa2, ob]) {
        expect([o.x, o.y, o.z, o.fx, o.fz, o.doing]).toEqual([oa.x, oa.y, oa.z, oa.fx, oa.fz, oa.doing]);
        expect(o.quaternion.equals(oa.quaternion)).toBe(true);
      }
      for (const n of SNAIL_CLIPS) expect(b.actions[n].time).toBe(a.actions[n].time);
    }
  });

  it('gives a neighbour room, and placed by a script it idles on the spot', () => {
    const rig = rigged();
    const t = at(0, 1, 2);
    const s = snailSpot(0, t, PLAN, snailStart(PLAN, 0));
    const out = snailFrame(rig, input(t, 0, { others: [0, s.x, s.z, 1, s.x + 2, s.z] }), blank());
    expect(out.x).toBeLessThan(s.x);
    snailIdle(rig, 3, 0);
    expect(weight(rig, 'idle')).toBe(1);
    for (const n of SNAIL_CLIPS) if (n !== 'idle') expect(weight(rig, n)).toBe(0);
  });
});

describe('snail: the eyes', () => {
  it('looks at you when it stops to look, down when it grazes, and mostly ahead as it glides', () => {
    expect(snailGaze(0, 3, 'look').at).toBe('viewer');
    expect(snailGaze(0, 3, 'munch')).toMatchObject({ at: 'down', gy: -1 });
    const seen = { viewer: 0, ahead: 0, wander: 0 } as Record<string, number>;
    for (let t = 0; t < 400; t += 0.8) seen[snailGaze(3, t, 'glide').at] = (seen[snailGaze(3, t, 'glide').at] ?? 0) + 1;
    expect(seen.ahead).toBeGreaterThan(seen.wander!);
    expect(seen.viewer).toBeGreaterThan(0);
    // A saccade holds for its slot: pure in t, and steps rather than drifts.
    expect(snailGaze(5, 9.65, 'idle')).toEqual(snailGaze(5, 10.35, 'idle')); // one slot: 9.6 ≤ t < 10.4
  });

  it('slides each pupil within its face, its rest (inner, low) the gaze down and in', () => {
    for (const side of [1, -1] as const) {
      for (const gx of [-3, -1, -0.4, 0, 0.5, 1, 3]) for (const gy of [-3, -1, 0, 1, 3]) {
        const o = pupilOffset(side, gx, gy);
        // Two cells of travel over a three-cell face: from rest out to the far edge, never off it.
        expect(side * o.x).toBeGreaterThanOrEqual(-1e-9);
        expect(side * o.x).toBeLessThanOrEqual(2 * PUPIL_TRAVEL + 1e-9);
        expect(o.y).toBeGreaterThanOrEqual(0);
        expect(o.y).toBeLessThanOrEqual(2 * PUPIL_TRAVEL);
      }
      // Looking toward its own side moves the pupil outward; looking down and in is where it rests.
      expect(side * pupilOffset(side, side, 0).x).toBeCloseTo(2 * PUPIL_TRAVEL, 9);
      expect(pupilOffset(side, -side, -1)).toEqual({ x: 0, y: 0 });
    }
  });

  it('turns its pupils toward the viewer: off to its left, both slide left', () => {
    const rig = rigged();
    expect(rig.eyes.map((e) => e.side)).toEqual([1, -1]);
    const rest = rig.eyes.map((e) => e.pupil.position.clone());
    snailLook(rig, 2, 0, 'look', new Vector3(300, 17, 300));
    const leftward = rig.eyes.map((e, i) => e.pupil.position.x - rest[i]!.x);
    snailLook(rig, 2, 0, 'look', new Vector3(-300, 17, 300));
    const rightward = rig.eyes.map((e, i) => e.pupil.position.x - rest[i]!.x);
    for (let i = 0; i < 2; i++) expect(leftward[i]!).toBeGreaterThan(rightward[i]!);
    // No viewer (riding in its eye): it does not look at one.
    expect(snailLook(rig, 2, 0, 'look', null)).toBe('wander');
  });
});

describe('snail: the shell', () => {
  it('mix gives each snail its own; a named style gives every snail that one', () => {
    const seen = new Set(Array.from({ length: 60 }, (_, i) => snailShellOf('mix', i)));
    expect([...seen].sort()).toEqual(['banded', 'glow', 'gold', 'pearl']);
    for (const style of ['banded', 'pearl', 'gold', 'glow'] as const) expect(snailShellOf(style, 7)).toBe(style);
    expect(snailShellOf('nonsense', 7)).toBe(snailShellOf('mix', 7));
  });

  it('dresses once per style, keeps the coat for banded, and frees what it made', () => {
    const rig = rigged();
    const base = (): string[] => rig.shell.parts.map((p) => (p.mesh.material as MeshLambertMaterial).type);
    dressSnail(rig, 'pearl', true, false);
    expect(rig.shell.parts).toHaveLength(2);
    expect(rig.shell.parts.every((p) => p.mesh.material instanceof MeshPhysicalMaterial)).toBe(true);
    const pearl = rig.shell.parts[0]!.mesh.material;
    dressSnail(rig, 'pearl', true, false);
    expect(rig.shell.parts[0]!.mesh.material).toBe(pearl); // no churn frame to frame
    dressSnail(rig, 'gold', true, false);
    expect(rig.shell.parts.every((p) => p.mesh.material instanceof MeshStandardMaterial)).toBe(true);
    dressSnail(rig, 'banded', true, false);
    expect(rig.shell.parts.every((p) => p.mesh.material === p.base)).toBe(true);
    expect(base()).toEqual(['MeshLambertMaterial', 'MeshLambertMaterial']);
    // Flat lighting or the neon look: the tank's own coat.
    dressSnail(rig, 'glow', false, false);
    expect(rig.shell.style).toBe('banded');
    dressSnail(rig, 'glow', true, true);
    expect(rig.shell.style).toBe('banded');
  });

  it('a glowing spiral breathes slowly — nowhere near a flash', () => {
    const rig = rigged();
    dressSnail(rig, 'glow', true, false);
    const spiral = rig.shell.parts.find((p) => p.spiral)!.mesh.material as MeshLambertMaterial;
    const levels: number[] = [];
    for (let t = 0; t < 14; t += 0.05) {
      snailShellLight(rig, t, 2);
      const vivid = spiral.userData.mqGlow as { r: number; g: number; b: number };
      levels.push(Math.max(spiral.emissive.r, spiral.emissive.g, spiral.emissive.b) / Math.max(vivid.r, vivid.g, vivid.b));
      expect(snailGlow(t, 2)).toBeGreaterThanOrEqual(0.4 - 1e-9);
    }
    // Its steepest change over a third of a second is a small one.
    for (let i = 7; i < levels.length; i++) expect(Math.abs(levels[i]! - levels[i - 7]!)).toBeLessThan(0.1);
    expect(Math.max(...levels) - Math.min(...levels)).toBeGreaterThan(0.5);
    // Dark until lit: its own colour is a fraction of its light, so it reads as glowing, not cream.
    expect(Math.max(spiral.color.r, spiral.color.g, spiral.color.b)).toBeLessThan(0.2);
  });
});

describe('snail: a vignette actor (X490)', () => {
  // `4s: a =left | 30s: a >right`: the script puts its actors at the open stage's
  // swim height (y ≈ 34); a snail glides the floor all the same.
  const v = parseVignette('4s: a =left, b =left, c =left | 30s: a >right, b >right, c >right', OPEN_MARKS);
  const actorInput = (t: number, index = 0): SnailInput => ({
    ...input(t, index),
    act: poseOf(v, index, t), next: poseOf(v, index, t + 0.25), travel: actorTravel(v, index, t),
  });

  it('stands on the floor at its script place, facing the way the script walks it', () => {
    const rig = rigged();
    for (const t of [2, 10, 20]) {
      const act = poseOf(v, 0, t)!;
      expect(act.y).toBeGreaterThan(25); // the script's own height: mid-water
      const out = snailFrame(rig, actorInput(t), blank());
      expect(out.y).toBeCloseTo(2, 6); // the ground (input's ground is 2)
      expect(out.x).toBeCloseTo(act.x, 6);
      expect(out.z).toBeCloseTo(act.z, 6);
      expect(Math.atan2(out.fx, out.fz)).toBeCloseTo(Math.atan2(act.fx, act.fz), 6);
    }
  });

  it('glides while the script walks it, rests while it holds a mark', () => {
    const rig = rigged();
    expect(snailFrame(rig, actorInput(2), blank()).doing).toBe('idle');
    expect(weight(rig, 'idle')).toBeCloseTo(1, 6);
    expect(snailFrame(rig, actorInput(15), blank()).doing).toBe('glide');
    expect(weight(rig, 'glide')).toBeGreaterThan(0.9);
  });
});
