import { createRng } from '@idle-screens/core';
import {
  AnimationClip, Bone, BoxGeometry, Group, Mesh, MeshBasicMaterial, Quaternion, Vector3, VectorKeyframeTrack,
} from 'three';
import { describe, expect, it } from 'vitest';
import type { CrabInput } from './crab';
import { compileSwimPlan } from './plan';
import {
  rigStarfish, STARFISH_BLOOM, STARFISH_CLIPS, STARFISH_PACE, STARFISH_STAND_BLOOM, starfishCycle, starfishFrame, starfishIdle, starfishMoment, starfishSpot,
  starfishStart, starfishStopAt, type StarfishDoing, type StarfishOutput, type StarfishRig,
} from './starfish';

const PLAN = compileSwimPlan(createRng(3).fork(1), { radius: 120, yMin: 15, yMax: 72 });
const DUR: Record<string, number> = { crawl: 2, idle: 4, wave: 3, stand: 4.6, curl: 3 };
const STRIDE = 24;

/** A stand-in for the Blender rig: a `body` bone at the disc's centre, a slab to lie on, the five clips. */
function puppet(opts: { stride?: number } = {}): Group {
  const root = new Group();
  root.userData.mqStride = opts.stride ?? STRIDE;
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
const input = (t: number, index = 0, over: Partial<CrabInput> = {}): CrabInput => ({
  t, index, plan: PLAN, start: starfishStart(PLAN, index), len: 16.2, scale: 0.375,
  ground: () => 3, camX: 0, camZ: 200, ...over,
});
const blank = (): StarfishOutput => ({ x: 0, y: 0, z: 0, quaternion: new Quaternion(), fx: 0, fz: 1, tx: 1, tz: 0, trailX: 0, trailZ: 0, doing: 'crawl', bloom: 0 });
function at(index: number, k: number, u: number): number {
  const c = starfishCycle(index);
  return k * (c.crawl + c.stop) + u - c.offset;
}
const weight = (rig: StarfishRig, n: (typeof STARFISH_CLIPS)[number]): number => rig.actions[n].getEffectiveWeight();
function stopOf(doing: StarfishDoing): { index: number; k: number } {
  for (let i = 0; i < 40; i++) for (let k = 1; k < 30; k++) if (starfishStopAt(i, k) === doing) return { index: i, k };
  throw new Error(`no ${doing}`);
}

describe('starfish: the schedule', () => {
  it('crawls on, never back, and lies still while it stops', () => {
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

  it('every stop turns up, and every stop has room for a turn in, the stand and a turn out', () => {
    const seen = new Set<StarfishDoing>();
    for (let i = 0; i < 12; i++) for (let k = 0; k < 30; k++) seen.add(starfishStopAt(i, k));
    expect([...seen].sort()).toEqual(['curl', 'idle', 'look', 'stand', 'wave']);
    for (let i = 0; i < 40; i++) {
      const c = starfishCycle(i);
      expect(c.stop).toBeGreaterThanOrEqual(0.9 + DUR.stand! + 0.3 + 1.2);
      expect(c.crawl).toBeGreaterThan(2 * 0.45);
    }
  });
});

describe('starfish: the frame', () => {
  it('rigs only a model that carries the five clips and a stride, lying on the floor', () => {
    expect(rigged()).not.toBeNull();
    expect(rigStarfish(puppet(), clips(['crawl', 'idle']), 1)).toBeNull();
    expect(rigStarfish(puppet({ stride: 0 }), clips(), 1)).toBeNull();
    const r = rigged();
    expect([r.anchor.x, r.anchor.y, r.anchor.z]).toEqual([0, 0, 0]);
  });

  it('crawls face first along its route, on the ground, the ripple at full weight', () => {
    const rig = rigged();
    const t = at(0, 2, starfishCycle(0).crawl / 2);
    const out = starfishFrame(rig, input(t), blank());
    const s = starfishSpot(0, t, PLAN, starfishStart(PLAN, 0));
    expect(out.doing).toBe('crawl');
    expect([out.x, out.z]).toEqual([s.x, s.z]);
    expect(out.y).toBe(3);
    expect(out.fx * s.fx + out.fz * s.fz).toBeCloseTo(1, 9);
    expect(weight(rig, 'crawl')).toBe(1);
    expect(weight(rig, 'idle')).toBe(0);
  });

  it('the ripple runs on distance: one crawl cycle per stride crawled, and still when it stops', () => {
    const rig = rigged();
    const inp = input(0);
    const t1 = at(0, 3, starfishCycle(0).crawl / 2), t2 = t1 + 0.05;
    starfishFrame(rig, { ...inp, t: t1 }, blank());
    const a = rig.actions.crawl.time;
    const p1 = starfishSpot(0, t1, PLAN, inp.start);
    starfishFrame(rig, { ...inp, t: t2 }, blank());
    const b = rig.actions.crawl.time;
    const p2 = starfishSpot(0, t2, PLAN, inp.start);
    const crawled = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    expect((b - a) / DUR.crawl!).toBeCloseTo(crawled / (STRIDE * inp.scale), 2);
    // A slow pace: a starfish crawls about half as fast as a crab walks.
    expect(STARFISH_PACE).toBeLessThan(0.6 * 0.55 * 16.2 * 1.01);
  });

  for (const doing of ['stand', 'wave'] as const) {
    it(`${doing}s at full weight mid-stop, face to the camera`, () => {
      const { index, k } = stopOf(doing);
      const rig = rigged();
      const c = starfishCycle(index);
      const out = starfishFrame(rig, input(at(index, k, c.crawl + 0.9 + 1.5), index), blank());
      expect(out.doing).toBe(doing);
      expect(weight(rig, doing)).toBeCloseTo(1, 6);
      expect(rig.actions[doing].time).toBeCloseTo(1.5, 6);
      expect(weight(rig, 'crawl')).toBe(0);
      expect(weight(rig, 'idle')).toBeCloseTo(0, 6);
      const to = new Vector3(0 - out.x, 0, 200 - out.z).normalize();
      expect(out.fx * to.x + out.fz * to.z).toBeGreaterThan(0.999);
    });
  }

  it('throws little of its glow lying on the floor, and flares as it stands — never in a jump', () => {
    const rig = rigged();
    const crawling = starfishFrame(rig, input(at(0, 2, starfishCycle(0).crawl / 2)), blank());
    expect(crawling.bloom).toBe(STARFISH_BLOOM);
    const { index, k } = stopOf('stand');
    const c = starfishCycle(index);
    const mid = starfishFrame(rig, input(at(index, k, c.crawl + 0.9 + 2.3), index), blank());
    expect(mid.bloom).toBeCloseTo(STARFISH_STAND_BLOOM, 6);
    // Sampled at 60 fps through the whole stop: no frame-to-frame step a viewer reads as a flash.
    let prev = STARFISH_BLOOM;
    for (let u = c.crawl; u < c.crawl + c.stop; u += 1 / 60) {
      const b = starfishFrame(rig, input(at(index, k, u), index), blank()).bloom;
      expect(Math.abs(b - prev)).toBeLessThan(0.05);
      prev = b;
    }
  });

  it('a curl is its own business: it stays facing its route', () => {
    const { index, k } = stopOf('curl');
    const rig = rigged();
    const c = starfishCycle(index);
    const before = starfishFrame(rig, input(at(index, k, c.crawl - 0.01), index), blank());
    const fb = [before.fx, before.fz];
    const out = starfishFrame(rig, input(at(index, k, c.crawl + 0.9 + 1.2), index), blank());
    expect(out.doing).toBe('curl');
    expect(weight(rig, 'curl')).toBeCloseTo(1, 6);
    expect(out.fx * fb[0]! + out.fz * fb[1]!).toBeCloseTo(1, 6);
  });

  it('turns back to its route by the end of the stop, and sets off facing it', () => {
    const { index, k } = stopOf('stand');
    const c = starfishCycle(index);
    const rig = rigged();
    const end = starfishFrame(rig, input(at(index, k, c.crawl + c.stop - 1e-6), index), blank());
    const fe = [end.fx, end.fz];
    const next = starfishFrame(rig, input(at(index, k + 1, 0.01), index), blank());
    expect(next.fx * fe[0]! + next.fz * fe[1]!).toBeCloseTo(1, 3);
  });

  it('every frame\'s clip weights make one whole', () => {
    const rig = rigged();
    for (let t = 0; t < 90; t += 0.37) {
      starfishFrame(rig, input(t, 6), blank());
      const sum = STARFISH_CLIPS.reduce((s, n) => s + weight(rig, n), 0);
      expect(sum).toBeGreaterThan(0.999);
      expect(sum).toBeLessThan(1.35); // a gesture fading over a turn's ripple overlaps a little, never stacks up
    }
  });

  it('is pure in its input', () => {
    const a = rigged(), b = rigged();
    for (const t of [0, 3.3, 17.25, 41]) {
      const oa = starfishFrame(a, input(t, 5), blank());
      starfishFrame(a, input(t + 9, 5), blank());
      const oa2 = starfishFrame(a, input(t, 5), blank());
      const ob = starfishFrame(b, input(t, 5), blank());
      for (const o of [oa2, ob]) {
        expect([o.x, o.y, o.z, o.fx, o.fz, o.doing]).toEqual([oa.x, oa.y, oa.z, oa.fx, oa.fz, oa.doing]);
        expect(o.quaternion.equals(oa.quaternion)).toBe(true);
      }
      for (const n of STARFISH_CLIPS) expect(b.actions[n].time).toBe(a.actions[n].time);
    }
  });

  it('lies on a slope, tilted with it, and never sinks into the ground', () => {
    const rig = rigged();
    const t = at(1, 2, 2);
    const gentle = starfishFrame(rig, input(t, 1, { ground: (x) => 0.2 * x }), blank());
    const up = new Vector3(0, 1, 0).applyQuaternion(gentle.quaternion);
    expect(up.y).toBeLessThan(0.999);
    expect(up.y).toBeGreaterThan(Math.cos(0.3));
    const wall = starfishFrame(rig, input(t, 1, { ground: (x, z) => 5 * x + 5 * z }), blank());
    expect(new Vector3(0, 1, 0).applyQuaternion(wall.quaternion).y).toBeGreaterThan(Math.cos(0.75) ** 2 - 1e-9);
    expect(wall.y).toBeGreaterThanOrEqual(5 * wall.x + 5 * wall.z - 1e-9);
  });

  it('gives a neighbour room — a crab or another starfish', () => {
    const rig = rigged();
    const t = at(3, 2, 1.5);
    const alone = starfishFrame(rig, input(t, 3), blank());
    const s = starfishSpot(3, t, PLAN, starfishStart(PLAN, 3));
    const crowded = starfishFrame(rig, input(t, 3, { others: [3, s.x, s.z, 7, s.x + 2, s.z] }), blank());
    expect(crowded.x).toBeLessThan(alone.x);
    expect(Math.hypot(crowded.x - alone.x, crowded.z - alone.z)).toBeGreaterThan(1);
  });

  it('an actor a script is placing just idles where it is put', () => {
    const rig = rigged();
    starfishFrame(rig, input(at(0, 2, 1.7)), blank());
    starfishIdle(rig, 12.5, 0);
    expect(weight(rig, 'idle')).toBe(1);
    for (const n of ['crawl', 'wave', 'stand', 'curl'] as const) expect(weight(rig, n)).toBe(0);
  });
});
