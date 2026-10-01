import { AnimationClip, Bone, Group, NumberKeyframeTrack } from 'three';
import { describe, expect, it } from 'vitest';
import { SHARK_CLIPS, SHARK_STROKE, rigShark, sharkBites, sharkCycle, sharkFrame, sharkMoment } from './shark';

const DUR: Record<string, number> = { swim: 1.2, bite: 1.8 };
const puppet = (): Group => { const g = new Group(); const b = new Bone(); b.name = 'body'; g.add(b); return g; };
const clips = (names: readonly string[] = SHARK_CLIPS): AnimationClip[] =>
  names.map((n) => new AnimationClip(n, DUR[n]!, [new NumberKeyframeTrack('body.position[x]', [0, DUR[n]!], [0, 1])]));

describe('the shark (shark.ts)', () => {
  it('rigs only a model that carries its two clips', () => {
    expect(rigShark(puppet(), clips())).not.toBeNull();
    expect(rigShark(puppet(), clips(['swim']))).toBeNull();
  });

  it('strikes on some cycles, once, for the length of the bite', () => {
    const strikes = Array.from({ length: 40 }, (_, k) => sharkBites(1, k));
    expect(strikes).toContain(true);
    expect(strikes).toContain(false);
    for (const i of [0, 2, 7]) {
      const c = sharkCycle(i);
      for (let k = 1; k < 6; k++) {
        let biting = 0;
        for (let t = k * c.period - c.offset; t < (k + 1) * c.period - c.offset; t += 0.02) if (sharkMoment(i, t).doing === 'bite') biting += 0.02;
        if (sharkBites(i, k)) { expect(biting).toBeGreaterThan(1.5); expect(biting).toBeLessThan(1.85); } else expect(biting).toBe(0);
      }
    }
  });

  it('the clips share one whole, and it is pure in (index, t)', () => {
    for (let t = 0; t < 90; t += 0.11) { const w = sharkMoment(3, t).weights; expect(w.swim + w.bite).toBeCloseTo(1, 9); }
    const a = rigShark(puppet(), clips())!, b = rigShark(puppet(), clips())!;
    for (const t of [2.2, 30.5]) {
      const m = sharkFrame(a, t, 3, 80); sharkFrame(a, t + 3, 3, 9);
      expect(sharkFrame(a, t, 3, 80)).toEqual(m);
      expect(sharkFrame(b, t, 3, 80)).toEqual(m);
      for (const n of SHARK_CLIPS) expect(b.actions[n].time).toBe(a.actions[n].time);
    }
  });

  it('beats its tail slower per unit swum than a small fish', () => {
    const a = rigShark(puppet(), clips())!;
    sharkFrame(a, 0, 0, 0);
    const t0 = a.actions.swim.time;
    sharkFrame(a, 0, 0, 10);
    expect(a.actions.swim.time - t0).toBeCloseTo(10 * SHARK_STROKE, 9);
    expect(SHARK_STROKE).toBeLessThan(0.045);
  });
});
