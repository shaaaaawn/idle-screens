import { AnimationClip, Bone, Group, NumberKeyframeTrack } from 'three';
import { describe, expect, it } from 'vitest';
import { BABY_CLIPS, BABY_STROKE, babyCycle, babyFrame, babyMoment, babyMomentAt, rigBaby, type BabyClip, type BabyRig } from './babyfish';

const DUR: Record<string, number> = { swim: 0.5, zoom: 1.2, wiggle: 1.6, wiggle_eyes: 1.6, flip: 1.4, peek: 2.4, peek_eyes: 2.4, blink: 0.3 };
const puppet = (): Group => { const g = new Group(); const b = new Bone(); b.name = 'body'; g.add(b); return g; };
const clips = (names: readonly string[] = BABY_CLIPS): AnimationClip[] =>
  names.map((n) => new AnimationClip(n, DUR[n]!, [new NumberKeyframeTrack('body.position[x]', [0, DUR[n]!], [0, 1])]));
const rigged = (): BabyRig => rigBaby(puppet(), clips())!;
const weight = (rig: BabyRig, n: BabyClip): number => rig.actions[n].getEffectiveWeight();
/** A time `u` seconds after cycle k's moment starts, for baby `index`. */
const at = (index: number, k: number, u: number): number => { const c = babyCycle(index); return k * c.period + c.at + u - c.offset; };
function cycleOf(moment: string): { index: number; k: number } {
  for (let i = 0; i < 40; i++) for (let k = 1; k < 40; k++) if (babyMomentAt(i, k) === moment) return { index: i, k };
  throw new Error(moment);
}

describe('babyfish (babyfish.ts)', () => {
  it('rigs only a model that carries all its clips', () => {
    expect(rigged()).not.toBeNull();
    expect(rigBaby(puppet(), clips(['swim', 'blink']))).toBeNull();
  });

  it('every moment turns up, one a cycle, and each fits its cycle', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) for (let k = 0; k < 30; k++) seen.add(babyMomentAt(i, k));
    expect([...seen].sort()).toEqual(['flip', 'peek', 'wiggle', 'zoom']);
    for (let i = 0; i < 40; i++) {
      const c = babyCycle(i);
      expect(c.at).toBeGreaterThanOrEqual(0.5);
      expect(c.at + 2.4).toBeLessThanOrEqual(c.period); // the longest moment ends inside its cycle
    }
  });

  it('swims on the distance swum, a quick short stroke, and the body\'s weight always makes one whole', () => {
    const rig = rigged();
    babyFrame(rig, 0.3, 2, 10);
    expect(rig.actions.swim.time).toBeCloseTo((10 * BABY_STROKE) % DUR.swim!, 9);
    for (let t = 0; t < 90; t += 0.13) {
      babyFrame(rig, t, 5, t * 7);
      const body = weight(rig, 'swim') + (['zoom', 'wiggle', 'flip', 'peek'] as const).reduce((s, n) => s + weight(rig, n), 0);
      expect(body).toBeCloseTo(1, 9);
    }
  });

  for (const [moment, eyes] of [['wiggle', 'wiggle_eyes'], ['peek', 'peek_eyes']] as const) {
    it(`a ${moment} brings its own eyes, at full weight over it, and no blink fights them`, () => {
      const { index, k } = cycleOf(moment);
      const rig = rigged();
      const m = babyFrame(rig, at(index, k, 0.8), index, 3);
      expect(m.doing).toBe(moment);
      expect(weight(rig, moment)).toBeCloseTo(1, 6);
      expect(weight(rig, eyes)).toBe(1);
      expect(rig.actions[eyes].time).toBeCloseTo(0.8, 6);
      expect(weight(rig, 'blink')).toBe(0);
    });
  }

  it('blinks every few seconds between moments, briefly', () => {
    let blinks = 0, frames = 0;
    for (let t = 0; t < 60; t += 0.05) {
      const m = babyMoment(7, t);
      frames++;
      if (m.blink >= 0) { blinks++; expect(m.blink).toBeLessThan(0.3); }
    }
    expect(blinks / frames).toBeGreaterThan(0.03);
    expect(blinks / frames).toBeLessThan(0.15);
  });

  it('is pure in (index, t, beat)', () => {
    const a = rigged(), b = rigged();
    for (const t of [1.1, 17.5, 33.3]) {
      const ma = babyFrame(a, t, 3, 50); babyFrame(a, t + 4, 3, 90);
      expect(babyFrame(a, t, 3, 50)).toEqual(ma);
      expect(babyFrame(b, t, 3, 50)).toEqual(ma);
      for (const n of BABY_CLIPS) expect(b.actions[n].time).toBe(a.actions[n].time);
    }
  });
});
