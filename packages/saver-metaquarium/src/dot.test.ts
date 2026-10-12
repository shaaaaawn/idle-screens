import { createRng } from '@idle-screens/core';
import { AnimationClip, BoxGeometry, Group, Mesh, MeshBasicMaterial, Quaternion, Vector3, VectorKeyframeTrack } from 'three';
import { describe, expect, it } from 'vitest';
import {
  DOT_CLIPS, DOT_GESTURES, GAIT_PACE, MOMENT_LENGTH, dotCycle, dotFace, dotFrame, dotGait, dotMoment, dotMomentAt, dotSpot, dotStart,
  gestureFace, momentFace, newDotOutput, rigDot, type DotInput, type DotMoment, type DotRig,
} from './dot';
import { compileSwimPlan } from './plan';
import { GLYPHS } from './screen';
import type { ActorPose } from './vignette';

const PLAN = compileSwimPlan(createRng(3).fork(1), { radius: 120, yMin: 15, yMax: 72 });

/** A stand-in for the Blender rig: a box to stand on, its strides, every clip. */
function puppet(): Group {
  const root = new Group();
  root.userData.mqStride = 11;
  root.userData.mqRunStride = 18;
  root.userData.mqSneakStride = 8;
  const box = new Mesh(new BoxGeometry(14, 38, 10), new MeshBasicMaterial());
  box.position.set(0, 19, 0);
  root.add(box);
  return root;
}
const clips = (names: readonly string[] = DOT_CLIPS): AnimationClip[] =>
  names.map((n) => new AnimationClip(n, 1.5, [new VectorKeyframeTrack('.position', [0, 1.5], [0, 0, 0, 1, 0, 0])]));
const rigged = (): DotRig => rigDot(puppet(), clips(), 0.4)!;
const input = (t: number, index = 0, over: Partial<DotInput> = {}): DotInput => ({
  t, index, plan: PLAN, start: dotStart(PLAN, index), len: 16, scale: 0.4 * 1.2,
  ground: () => 2, camX: 0, camZ: 200, ...over,
});
const weight = (rig: DotRig, n: (typeof DOT_CLIPS)[number]): number => rig.actions[n].getEffectiveWeight();
function at(index: number, k: number, u: number): number {
  const c = dotCycle(index);
  return k * (c.walk + c.stop) + u - c.offset;
}

describe('dot: the schedule', () => {
  it('walks, runs and sneaks on, never back, and stands still while it stops', () => {
    for (const index of [0, 3, 8]) {
      let prev = -Infinity;
      for (let t = 0; t < 200; t += 0.25) {
        const m = dotMoment(index, t);
        expect(m.walked).toBeGreaterThanOrEqual(prev - 1e-9);
        if (m.intoStop >= 0) expect(m.speed).toBe(0);
        prev = m.walked;
      }
    }
  });

  it('its distance is a closed form: each bout adds its own gait\'s length, however far into the day', () => {
    const index = 5, c = dotCycle(index);
    for (const k of [3, 40, 4001]) {
      const before = dotMoment(index, at(index, k, 0)).walked;
      const after = dotMoment(index, at(index, k, c.walk + 0.5)).walked;
      const whole = dotMoment(index, at(index, 1, c.walk + 0.5)).walked - dotMoment(index, at(index, 1, 0)).walked;
      expect(after - before).toBeCloseTo((whole / GAIT_PACE[dotGait(index, 1)]) * GAIT_PACE[dotGait(index, k)], 6);
    }
    const gaits = new Set(Array.from({ length: 12 }, (_, k) => dotGait(2, k)));
    expect([...gaits].sort()).toEqual(['run', 'sneak', 'walk']);
  });

  it('every moment turns up, and the stop has room for the longest', () => {
    const seen = new Set<DotMoment>();
    for (let i = 0; i < 20; i++) for (let k = 0; k < 60; k++) seen.add(dotMomentAt(i, k));
    expect([...seen].sort()).toEqual(Object.keys(MOMENT_LENGTH).sort());
    const longest = Math.max(...Object.values(MOMENT_LENGTH));
    for (let i = 0; i < 40; i++) expect(dotCycle(i).stop).toBeGreaterThanOrEqual(0.8 + longest + 0.3 + 1.0);
  });

  it('every face it shows is a glyph the screen has', () => {
    const shown = new Set<string>();
    for (const m of Object.keys(MOMENT_LENGTH) as DotMoment[]) for (let t = 0; t < MOMENT_LENGTH[m]; t += 0.1) { const s = momentFace(m, t); shown.add(s.from); shown.add(s.to); }
    for (const g of [...DOT_GESTURES, 'rest' as const]) for (let t = 0; t < 4; t += 0.1) { const s = gestureFace(g, t); shown.add(s.from); shown.add(s.to); }
    for (let t = 0; t < 60; t += 0.2) { const s = dotFace(1, t); shown.add(s.from); shown.add(s.to); }
    for (const g of shown) expect(Object.keys(GLYPHS)).toContain(g);
  });
});

describe('dot: the frame', () => {
  it('rigs only a model with every clip and its three strides', () => {
    expect(rigged()).not.toBeNull();
    expect(rigDot(puppet(), clips(['idle', 'walk']), 1)).toBeNull();
    const bare = puppet(); delete bare.userData.mqSneakStride;
    expect(rigDot(bare, clips(), 1)).toBeNull();
  });

  it('walks its route on the ground, its gait clip at full weight', () => {
    const rig = rigged(), c = dotCycle(0);
    const t = at(0, 2, c.walk / 2);
    const out = dotFrame(rig, input(t), newDotOutput());
    const s = dotSpot(0, t, PLAN, dotStart(PLAN, 0));
    expect(out.x).toBeCloseTo(s.x, 9);
    expect(out.z).toBeCloseTo(s.z, 9);
    expect(out.y).toBe(2);
    expect(out.doing).toBe(dotGait(0, 2));
    expect(weight(rig, dotGait(0, 2))).toBe(1);
  });

  it('never sinks a foot into a curved floor: its stance clears the ground under every reach', () => {
    const rig = rigged();
    // A sharp hump and a valley, at every heading it meets them.
    const humps = [(x: number, z: number) => 6 * Math.exp(-((x % 9) ** 2 + (z % 9) ** 2) / 8), (x: number) => 0.4 * Math.abs(Math.sin(x / 3)) * 10];
    for (const ground of humps) {
      for (let t = 3; t < 120; t += 7.3) {
        const inp = input(t, 1, { ground });
        const out = dotFrame(rig, inp, newDotOutput());
        const fx = out.fx, fz = out.fz, rx = fz, rz = -fx;
        const up = new Vector3(0, 1, 0).applyQuaternion(out.quaternion);
        // Each reach on the tilted stance's plane is on or above the ground there.
        for (const [dF, dS] of [[8, 5], [8, -5], [-4, 5], [-4, -5]]) {
          const ox = fx * dF * inp.scale + rx * dS * inp.scale, oz = fz * dF * inp.scale + rz * dS * inp.scale;
          const plane = out.y - (up.x * ox + up.z * oz) / up.y;
          expect(plane).toBeGreaterThanOrEqual(ground(out.x + ox, out.z + oz) - 1e-6);
        }
        // Upright enough: a character leans into a hill, it does not fall over.
        expect(up.y).toBeGreaterThan(Math.cos(0.29));
      }
    }
  });

  it('a friendly moment faces the camera and plays its clip with its face', () => {
    let found: { index: number; k: number } | null = null;
    for (let i = 0; i < 40 && !found; i++) for (let k = 1; k < 40 && !found; k++) if (dotMomentAt(i, k) === 'clap') found = { index: i, k };
    const { index, k } = found!;
    const rig = rigged(), c = dotCycle(index);
    const out = dotFrame(rig, input(at(index, k, c.walk + 0.8 + 1.0), index), newDotOutput());
    expect(out.doing).toBe('clap');
    expect(weight(rig, 'clap')).toBeCloseTo(1, 6);
    const to = new Vector3(-out.x, 0, 200 - out.z).normalize();
    expect(out.fx * to.x + out.fz * to.z).toBeGreaterThan(0.999);
    expect(['happy', 'love']).toContain(out.screen.to);
  });

  it('as an actor it stands where the script puts it, on the floor, and talks with its own clip and a flapping mouth', () => {
    const rig = rigged();
    const act: ActorPose = { x: 10, y: 40, z: -5, fx: 0, fy: 0, fz: 1, roll: 0, doing: 'talk', lookAt: null, gesture: { name: 'talk', at: 0.1, bar: 0.1, weight: 1 } };
    const out = dotFrame(rig, input(5, 0, { act, next: act }), newDotOutput());
    expect([out.x, out.y, out.z]).toEqual([10, 2, -5]);
    expect(out.doing).toBe('talk');
    expect(weight(rig, 'talk')).toBeCloseTo(1, 9);
    expect(gestureFace('talk', 0.1).to).not.toBe(gestureFace('talk', 0.3).to);
  });

  it('is pure in its input', () => {
    const a = rigged(), b = rigged();
    for (const t of [0, 7.5, 33.3, 91]) {
      const oa = dotFrame(a, input(t, 4), newDotOutput());
      dotFrame(a, input(t + 13, 4), newDotOutput());
      const oa2 = dotFrame(a, input(t, 4), newDotOutput());
      const ob = dotFrame(b, input(t, 4), newDotOutput());
      for (const o of [oa2, ob]) {
        expect([o.x, o.y, o.z, o.doing, o.screen.to]).toEqual([oa.x, oa.y, oa.z, oa.doing, oa.screen.to]);
        expect(o.quaternion.equals(oa.quaternion)).toBe(true);
      }
      for (const n of DOT_CLIPS) expect(b.actions[n].time).toBe(a.actions[n].time);
    }
    expect(new Quaternion().equals(newDotOutput().quaternion)).toBe(true);
  });
});
