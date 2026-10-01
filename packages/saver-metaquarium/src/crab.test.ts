import { createRng } from '@idle-screens/core';
import {
  AnimationClip, Bone, BoxGeometry, Group, Mesh, MeshBasicMaterial, Quaternion, Vector3, VectorKeyframeTrack,
} from 'three';
import { describe, expect, it } from 'vitest';
import {
  boutDistance, boutSpeed, CRAB_CLIPS, CRAB_PACE, crabCycle, crabFrame, crabIdle, crabLead, crabMoment, crabSpot, crabStart, crabStopAt,
  rigCrab, type CrabDoing, type CrabInput, type CrabOutput, type CrabRig,
} from './crab';
import { compileSwimPlan } from './plan';

const PLAN = compileSwimPlan(createRng(3).fork(1), { radius: 120, yMin: 15, yMax: 72 });
const DUR: Record<string, number> = { walk: 1, idle: 4, pinch: 2, forage: 3, wave: 3, cheer: 2.5 };
const STRIDE = 6 / 0.55;

/** A stand-in for the Blender rig: a `body` bone, a box to stand on, the six clips. */
function puppet(opts: { stride?: number; clips?: readonly string[] } = {}): Group {
  const root = new Group();
  root.userData.mqStride = opts.stride ?? STRIDE;
  const bone = new Bone(); bone.name = 'body'; bone.position.set(11, -11, -26);
  root.add(bone);
  const box = new Mesh(new BoxGeometry(48, 22, 44), new MeshBasicMaterial());
  box.position.set(11, -6, -20);
  root.add(box);
  return root;
}
const clips = (names: readonly string[] = CRAB_CLIPS): AnimationClip[] =>
  names.map((n) => new AnimationClip(n, DUR[n]!, [new VectorKeyframeTrack('body.position', [0, DUR[n]!], [0, 0, 0, 1, 0, 0])]));
const rigged = (): CrabRig => rigCrab(puppet(), clips(), 0.375)!;

const input = (t: number, index = 0, over: Partial<CrabInput> = {}): CrabInput => ({
  t, index, plan: PLAN, start: crabStart(PLAN, index), len: 16.2, scale: 0.375 * 0.9,
  ground: () => 3, camX: 0, camZ: 200, ...over,
});
const blank = (): CrabOutput => ({ x: 0, y: 0, z: 0, quaternion: new Quaternion(), fx: 0, fz: 1, tx: 1, tz: 0, trailX: 0, trailZ: 0, doing: 'walk' });

/** A time `u` seconds into bout `k`'s cycle for crab `index`. */
function at(index: number, k: number, u: number): number {
  const c = crabCycle(index);
  return k * (c.walk + c.stop) + u - c.offset;
}
const weight = (rig: CrabRig, n: (typeof CRAB_CLIPS)[number]): number => rig.actions[n].getEffectiveWeight();

describe('crab: the schedule', () => {
  it('a bout eases in, cruises and eases out, and its distance is its speed integrated', () => {
    const walk = 5;
    expect(boutSpeed(0, walk)).toBe(0);
    expect(boutSpeed(walk / 2, walk)).toBe(1);
    expect(boutSpeed(walk, walk)).toBe(0);
    expect(boutSpeed(walk + 1, walk)).toBe(0);
    let sum = 0;
    const dt = 1e-3;
    for (let u = 0; u < walk; u += dt) {
      sum += ((boutSpeed(u, walk) + boutSpeed(u + dt, walk)) / 2) * dt;
      if (Math.abs(u - Math.round(u * 4) / 4) < dt / 2) expect(boutDistance(u + dt, walk)).toBeCloseTo(sum, 3);
    }
    expect(boutDistance(walk, walk)).toBeCloseTo(walk - 0.45, 6);
    expect(boutDistance(walk + 3, walk)).toBe(boutDistance(walk, walk));
  });

  it('walks on, never back, and stands still while it stops', () => {
    for (const index of [0, 3, 9]) {
      let prev = -Infinity;
      for (let t = 0; t < 60; t += 0.1) {
        const m = crabMoment(index, t);
        expect(m.walked).toBeGreaterThanOrEqual(prev - 1e-9);
        if (m.intoStop >= 0) expect(m.speed).toBe(0);
        prev = m.walked;
      }
    }
  });

  it('every stop it can make turns up, and the cycle has room for the longest gesture', () => {
    const seen = new Set<CrabDoing>();
    for (let i = 0; i < 12; i++) for (let k = 0; k < 20; k++) seen.add(crabStopAt(i, k));
    expect([...seen].sort()).toEqual(['cheer', 'forage', 'idle', 'look', 'pinch', 'wave']);
    for (let i = 0; i < 40; i++) {
      const c = crabCycle(i);
      // turn in (0.7) + the longest clip (3) + its fade (0.3) + turn out (1)
      expect(c.stop).toBeGreaterThanOrEqual(0.7 + 3 + 0.3 + 1);
      expect(c.walk).toBeGreaterThan(2 * 0.45);
    }
    // Both sides lead, and it is drawn per bout.
    const leads = new Set(Array.from({ length: 20 }, (_, k) => crabLead(2, k)));
    expect([...leads].sort()).toEqual([-1, 1]);
  });
});

describe('crab: the frame', () => {
  it('rigs only a model that carries the six clips and a stride', () => {
    expect(rigged()).not.toBeNull();
    expect(rigCrab(puppet(), clips(['walk', 'idle']), 1)).toBeNull();
    expect(rigCrab(puppet({ stride: 0 }), clips(), 1)).toBeNull();
    const r = rigged();
    // Stands the body on its feet: the anchor is the box's floor under the body bone.
    expect(r.anchor.x).toBeCloseTo(11, 6);
    expect(r.anchor.y).toBeCloseTo(-17, 6);
    expect(r.anchor.z).toBeCloseTo(-26, 6);
  });

  it('walks sideways, square to its travel, standing on the ground', () => {
    const rig = rigged();
    const t = at(0, 2, crabCycle(0).walk / 2);
    const out = crabFrame(rig, input(t), blank());
    const s = crabSpot(0, t, PLAN, crabStart(PLAN, 0));
    expect(out.doing).toBe('walk');
    expect(out.x).toBeCloseTo(s.x, 9);
    expect(out.z).toBeCloseTo(s.z, 9);
    expect(out.y).toBe(3);
    const travel = Math.hypot(s.fx, s.fz);
    expect(Math.abs(out.fx * s.fx + out.fz * s.fz) / travel).toBeLessThan(1e-9);
    expect(weight(rig, 'walk')).toBe(1);
    expect(weight(rig, 'idle')).toBe(0);
    // Level ground: no tilt, the quaternion is a pure yaw.
    const up = new Vector3(0, 1, 0).applyQuaternion(out.quaternion);
    expect(up.y).toBeCloseTo(1, 9);
  });

  it('never slides its feet: the gait advances one cycle per stride walked', () => {
    const rig = rigged();
    const inp = input(0);
    const t1 = at(0, 3, crabCycle(0).walk / 2), t2 = t1 + 0.05;
    crabFrame(rig, { ...inp, t: t1 }, blank());
    const a = rig.actions.walk.time;
    const p1 = crabSpot(0, t1, PLAN, inp.start);
    crabFrame(rig, { ...inp, t: t2 }, blank());
    const b = rig.actions.walk.time;
    const p2 = crabSpot(0, t2, PLAN, inp.start);
    const walked = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const cycles = Math.abs(((b - a + 1.5) % 1) - 0.5) / DUR.walk!;
    expect(cycles).toBeCloseTo(walked / (STRIDE * inp.scale), 2);
  });

  it('a gesture plays at full weight mid-stop, facing the camera when it is for show', () => {
    let found: { index: number; k: number } | null = null;
    for (let i = 0; i < 40 && !found; i++) for (let k = 1; k < 30 && !found; k++) if (crabStopAt(i, k) === 'cheer') found = { index: i, k };
    expect(found).not.toBeNull();
    const { index, k } = found!;
    const rig = rigged();
    const c = crabCycle(index);
    const out = crabFrame(rig, input(at(index, k, c.walk + 0.7 + 1.2), index), blank());
    expect(out.doing).toBe('cheer');
    expect(weight(rig, 'cheer')).toBeCloseTo(1, 6);
    expect(rig.actions.cheer.time).toBeCloseTo(1.2, 6);
    expect(weight(rig, 'walk')).toBe(0);
    expect(weight(rig, 'idle')).toBeCloseTo(0, 6);
    for (const n of ['pinch', 'forage', 'wave'] as const) expect(weight(rig, n)).toBe(0);
    // It looks at the camera (0, 200).
    const to = new Vector3(0 - out.x, 0, 200 - out.z).normalize();
    expect(out.fx * to.x + out.fz * to.z).toBeGreaterThan(0.999);
  });

  it('turns all the way round between bouts led by different sides, stepping as it goes', () => {
    let found: { index: number; k: number } | null = null;
    for (let i = 0; i < 40 && !found; i++) for (let k = 1; k < 30 && !found; k++) {
      const d = crabStopAt(i, k);
      if (crabLead(i, k) !== crabLead(i, k + 1) && d !== 'wave' && d !== 'cheer' && d !== 'look') found = { index: i, k };
    }
    const { index, k } = found!;
    const c = crabCycle(index);
    const rig = rigged();
    const before = crabFrame(rig, input(at(index, k, c.walk + c.stop - 1.0), index), blank());
    const fb = [before.fx, before.fz];
    const mid = crabFrame(rig, input(at(index, k, c.walk + c.stop - 0.5), index), blank());
    expect(mid.doing).toBe('turn');
    expect(weight(rig, 'walk')).toBeGreaterThan(0.5);
    const after = crabFrame(rig, input(at(index, k, c.walk + c.stop - 1e-6), index), blank());
    expect(after.fx * fb[0]! + after.fz * fb[1]!).toBeCloseTo(-1, 4);
    // …and the next bout sets off facing exactly that way.
    const next = crabFrame(rig, input(at(index, k + 1, 0), index), blank());
    expect(next.fx).toBeCloseTo(after.fx, 4);
    expect(next.fz).toBeCloseTo(after.fz, 4);
  });

  it('is pure in its input', () => {
    const a = rigged(), b = rigged();
    for (const t of [0, 3.3, 17.25, 41]) {
      const oa = crabFrame(a, input(t, 5), blank());
      crabFrame(a, input(t + 9, 5), blank()); // another frame in between must not matter
      const oa2 = crabFrame(a, input(t, 5), blank());
      const ob = crabFrame(b, input(t, 5), blank());
      for (const o of [oa2, ob]) {
        expect([o.x, o.y, o.z, o.fx, o.fz, o.doing]).toEqual([oa.x, oa.y, oa.z, oa.fx, oa.fz, oa.doing]);
        expect(o.quaternion.equals(oa.quaternion)).toBe(true);
      }
      for (const n of CRAB_CLIPS) expect(b.actions[n].time).toBe(a.actions[n].time);
    }
  });

  it('stands on a slope, tilted with it — never past ~40°', () => {
    const rig = rigged();
    const t = at(1, 2, 2);
    const gentle = crabFrame(rig, input(t, 1, { ground: (x) => 0.2 * x }), blank());
    const upG = new Vector3(0, 1, 0).applyQuaternion(gentle.quaternion);
    expect(upG.y).toBeLessThan(0.999);
    expect(upG.y).toBeGreaterThan(Math.cos(0.3));
    const wall = crabFrame(rig, input(t, 1, { ground: (x, z) => 5 * x + 5 * z }), blank());
    const upW = new Vector3(0, 1, 0).applyQuaternion(wall.quaternion);
    expect(upW.y).toBeGreaterThan(Math.cos(0.7) * Math.cos(0.7) - 1e-9);
    // On its feet: never below the ground under its centre.
    expect(wall.y).toBeGreaterThanOrEqual(5 * wall.x + 5 * wall.z - 1e-9);
  });

  it('keeps its own pace: a glide of size never flings it along its route', () => {
    const rig = rigged();
    for (const t of [5, 120, 900]) {
      const small = crabFrame(rig, input(t, 4), blank());
      const big = crabFrame(rig, input(t, 4, { len: 40, scale: 0.9 }), blank());
      expect([big.x, big.z]).toEqual([small.x, small.z]);
    }
    // And the legs: mid-bout, the gait phase counts only this bout's distance,
    // so it stays within one bout's worth of cycles however long the crab has walked.
    const c = crabCycle(4);
    const inp = input(0, 4);
    for (const k of [1, 50, 400]) {
      crabFrame(rig, { ...inp, t: at(4, k, c.walk / 2) }, blank());
      const cycles = (boutDistance(c.walk / 2, c.walk) * CRAB_PACE * -crabLead(4, k)) / (STRIDE * inp.scale);
      const want = (((cycles * DUR.walk!) % DUR.walk!) + DUR.walk!) % DUR.walk!;
      expect(rig.actions.walk.time).toBeCloseTo(want, 9);
    }
  });

  it('with no camera to face, a wave or a cheer is made where it stands', () => {
    let found: { index: number; k: number } | null = null;
    for (let i = 0; i < 40 && !found; i++) for (let k = 1; k < 30 && !found; k++) {
      if (crabStopAt(i, k) === 'wave' && crabLead(i, k) === crabLead(i, k + 1)) found = { index: i, k };
    }
    const { index, k } = found!;
    const c = crabCycle(index);
    const rig = rigged();
    const walking = crabFrame(rig, input(at(index, k, c.walk - 0.01), index, { camX: NaN, camZ: NaN }), blank());
    const fw = [walking.fx, walking.fz];
    const waving = crabFrame(rig, input(at(index, k, c.walk + 1.5), index, { camX: NaN, camZ: NaN }), blank());
    expect(waving.doing).toBe('wave');
    expect(waving.fx * fw[0]! + waving.fz * fw[1]!).toBeCloseTo(1, 4);
  });

  it('leaves a trail behind it along its route, for the chase camera', () => {
    const rig = rigged();
    const out = crabFrame(rig, input(at(2, 3, 2), 2), blank());
    // Two lengths back along a curving route: behind it, and a chord long
    // enough for the chase camera to take its heading from (> 0.4 lengths).
    const back = (out.x - out.trailX) * out.tx + (out.z - out.trailZ) * out.tz;
    expect(back).toBeGreaterThan(16.2 * 0.4);
    expect(Math.hypot(out.x - out.trailX, out.z - out.trailZ)).toBeLessThanOrEqual(2 * 16.2 + 1e-6);
    expect(Math.hypot(out.tx, out.tz)).toBeCloseTo(1, 9);
  });

  it('an actor a script is placing just idles where it is put', () => {
    const rig = rigged();
    crabFrame(rig, input(at(0, 2, 1.7)), blank()); // mid-walk first
    crabIdle(rig, 12.5, 0);
    expect(weight(rig, 'idle')).toBe(1);
    for (const n of ['walk', 'pinch', 'forage', 'wave', 'cheer'] as const) expect(weight(rig, n)).toBe(0);
    expect(rig.actions.idle.time).toBeGreaterThanOrEqual(0);
    expect(rig.actions.idle.time).toBeLessThan(DUR.idle!);
  });

  it('gives a neighbour room instead of walking through it', () => {
    const rig = rigged();
    const t = at(0, 2, 1.7);
    const s = crabSpot(0, t, PLAN, crabStart(PLAN, 0));
    const alone = crabFrame(rig, input(t, 0, { others: [0, s.x, s.z] }), blank()); // itself: ignored
    expect(alone.x).toBeCloseTo(s.x, 9);
    const crowded = crabFrame(rig, input(t, 0, { others: [0, s.x, s.z, 7, s.x + 2, s.z] }), blank());
    expect(crowded.x).toBeLessThan(s.x - 2); // stepped away from the crab on its +x side
    const far = crabFrame(rig, input(t, 0, { others: [7, s.x + 40, s.z] }), blank());
    expect(far.x).toBeCloseTo(s.x, 9);
  });
});
