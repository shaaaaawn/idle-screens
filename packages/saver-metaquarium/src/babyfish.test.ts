import { AnimationClip, Bone, Group, NumberKeyframeTrack } from 'three';
import { describe, expect, it } from 'vitest';
import { BABY_CLIPS, BABY_STROKE, babyCycle, babyEpisodes, babyFrame, babyLag, babyMoment, babyMomentAt, rigBaby, type BabyClip, type BabyLeader, type BabyRig } from './babyfish';

const DUR: Record<string, number> = {
  swim: 0.5, zoom: 1.2, wiggle: 1.6, wiggle_eyes: 1.6, flip: 1.4, peek: 2.4, peek_eyes: 2.4, blink: 0.3,
  hiccup: 0.9, hiccup_eyes: 0.9, tailchase: 2.0, yawn: 3.0, yawn_eyes: 3.0,
};
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

  it('finds its eyes (three loads eye.L as eyeL), where the hiccup bubble leaves from', () => {
    expect(rigged().eyes).toBeNull();
    const g = puppet();
    for (const n of ['eyeL', 'eyeR']) { const b = new Bone(); b.name = n; g.add(b); }
    expect(rigBaby(g, clips())!.eyes!.map((e) => e.name)).toEqual(['eyeL', 'eyeR']);
  });

  it('every moment turns up, one a cycle, and each fits its cycle', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) for (let k = 0; k < 30; k++) seen.add(babyMomentAt(i, k));
    expect([...seen].sort()).toEqual(['flip', 'hiccup', 'peek', 'tailchase', 'wiggle', 'yawn', 'zoom']);
    for (let i = 0; i < 40; i++) {
      const c = babyCycle(i);
      expect(c.at).toBeGreaterThanOrEqual(0.5);
      expect(c.at + 3.0).toBeLessThanOrEqual(c.period); // the longest moment (the yawn) ends inside its cycle
    }
  });

  it('swims on the distance swum, a quick short stroke, and the body\'s weight always makes one whole', () => {
    const rig = rigged();
    babyFrame(rig, 0.3, 2, 10);
    expect(rig.actions.swim.time).toBeCloseTo((10 * BABY_STROKE) % DUR.swim!, 9);
    for (let t = 0; t < 90; t += 0.13) {
      babyFrame(rig, t, 5, t * 7);
      const body = weight(rig, 'swim') + (['zoom', 'wiggle', 'flip', 'peek', 'hiccup', 'tailchase', 'yawn'] as const).reduce((s, n) => s + weight(rig, n), 0);
      expect(body).toBeCloseTo(1, 9);
    }
  });

  for (const [moment, eyes] of [['wiggle', 'wiggle_eyes'], ['peek', 'peek_eyes'], ['hiccup', 'hiccup_eyes'], ['yawn', 'yawn_eyes']] as const) {
    it(`a ${moment} brings its own eyes, at full weight over it, and no blink fights them`, () => {
      const { index, k } = cycleOf(moment);
      const rig = rigged();
      const m = babyFrame(rig, at(index, k, 0.4), index, 3);
      expect(m.doing).toBe(moment);
      expect(weight(rig, moment)).toBeCloseTo(1, 6);
      expect(weight(rig, eyes)).toBe(1);
      expect(rig.actions[eyes].time).toBeCloseTo(0.4, 6);
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

  describe('babies copy each other', () => {
    // A line of six: each copies the one ahead; baby 10 leads.
    const line: BabyLeader = (i) => (i > 10 && i <= 15 ? i - 1 : null);
    const LEN: Record<string, number> = { zoom: 1.2, wiggle: 1.6, flip: 1.4, peek: 2.4, hiccup: 0.9, tailchase: 2.0, yawn: 3.0 };

    it('a moment the baby ahead starts turns up a beat later, the same moment', () => {
      let copied = 0;
      for (const e of babyEpisodes(11, 0, 600, line)) {
        if (e.origin === 11) continue;
        copied++;
        const ahead = babyEpisodes(10, e.start - babyLag(11) - 0.01, e.start - babyLag(11) + 0.01, line);
        expect(ahead.some((a) => a.moment === e.moment && Math.abs(a.start + babyLag(11) - e.start) < 1e-9)).toBe(true);
      }
      expect(copied).toBeGreaterThan(20);
    });

    it('runs down the line — a moment of the leader reaches the back now and then', () => {
      const back = babyEpisodes(15, 0, 1200, line);
      expect(back.some((e) => e.origin === 10)).toBe(true);
    });

    it('yawns are catching: more of them spread than barrel rolls', () => {
      const rate = (m: string): number => {
        const lead = babyEpisodes(10, 0, 6000).filter((e) => e.moment === m);
        const got = babyEpisodes(11, 0, 6000, line).filter((e) => e.moment === m && e.origin === 10).length;
        return got / lead.length;
      };
      expect(rate('yawn')).toBeGreaterThan(rate('flip') + 0.2);
    });

    it('never two moments at once, and its own give way to the caught ones', () => {
      for (const i of [11, 13, 15]) {
        const eps = babyEpisodes(i, 0, 900, line);
        for (let j = 1; j < eps.length; j++) expect(eps[j]!.start).toBeGreaterThanOrEqual(eps[j - 1]!.start + LEN[eps[j - 1]!.moment]!);
      }
    });

    it('the leader is not moved by who copies it', () => {
      for (let t = 0; t < 120; t += 0.37) expect(babyMoment(10, t, line)).toEqual(babyMoment(10, t));
    });

    it('a caught moment plays like its own: the body weight still makes one whole, and the state says it was caught', () => {
      const rig = rigged();
      let caught = 0;
      for (let t = 0; t < 200; t += 0.11) {
        const m = babyFrame(rig, t, 13, t * 7, line);
        if (m.caught) caught++;
        const body = weight(rig, 'swim') + (['zoom', 'wiggle', 'flip', 'peek', 'hiccup', 'tailchase', 'yawn'] as const).reduce((s, n) => s + weight(rig, n), 0);
        expect(body).toBeCloseTo(1, 9);
      }
      expect(caught).toBeGreaterThan(50);
    });

    it('is pure in (index, t, beat, leader)', () => {
      const a = rigged(), b = rigged();
      for (const t of [3.3, 41.2, 77.7]) {
        const ma = babyFrame(a, t, 14, 50, line); babyFrame(a, t + 9, 14, 90, line);
        expect(babyFrame(b, t, 14, 50, line)).toEqual(ma);
      }
    });
  });
});
