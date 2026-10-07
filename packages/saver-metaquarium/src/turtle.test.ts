import { AnimationClip, Bone, Group, NumberKeyframeTrack } from 'three';
import { describe, expect, it } from 'vitest';
import { TURTLE_CLIPS, turtleAct, turtleCycle, turtleFrame, turtleMoment, rigTurtle } from './turtle';

const DUR: Record<string, number> = { swim: 2.4, glide: 5, look: 3, paddle: 2 };
const puppet = (): Group => { const g = new Group(); const b = new Bone(); b.name = 'body'; g.add(b); return g; };
const clips = (names: readonly string[] = TURTLE_CLIPS): AnimationClip[] =>
  names.map((n) => new AnimationClip(n, DUR[n]!, [new NumberKeyframeTrack('body.position[x]', [0, DUR[n]!], [0, 1])]));

describe('seaturtle: the turtle', () => {
  it('rigs only a model that carries its four clips', () => {
    expect(rigTurtle(puppet(), clips())).not.toBeNull();
    expect(rigTurtle(puppet(), clips(['swim', 'look']))).toBeNull();
  });

  it('glides once a cycle, and some cycles look about or paddle — not every one', () => {
    for (let i = 0; i < 6; i++) {
      const c = turtleCycle(i);
      let glided = 0;
      for (let t = 0; t < c.period; t += 0.05) if (turtleMoment(i, t).doing === 'glide') glided += 0.05;
      expect(glided).toBeGreaterThan(4);
      expect(glided).toBeLessThan(7.1);
    }
    const acts = Array.from({ length: 60 }, (_, k) => turtleAct(5, k));
    expect(acts).toContain('look');
    expect(acts).toContain('paddle');
    expect(acts).toContain(null);
  });

  it('the clips share one whole', () => {
    for (let t = 0; t < 90; t += 0.07) {
      const w = turtleMoment(3, t).weights;
      expect(w.swim + w.glide + w.look + w.paddle).toBeCloseTo(1, 9);
      for (const n of TURTLE_CLIPS) expect(w[n]).toBeGreaterThanOrEqual(0);
    }
  });

  it('is pure in (index, t), and the tail beats with the distance swum', () => {
    const a = rigTurtle(puppet(), clips())!, b = rigTurtle(puppet(), clips())!;
    for (const t of [0.4, 8.1, 21.7]) {
      const sa = turtleFrame(a, t, 4, 88.8);
      turtleFrame(a, t + 3, 4, 200);
      expect(turtleFrame(a, t, 4, 88.8)).toEqual(sa);
      expect(turtleFrame(b, t, 4, 88.8)).toEqual(sa);
      for (const n of TURTLE_CLIPS) expect(a.actions[n].getEffectiveWeight()).toBe(sa.weights[n]);
    }
    turtleFrame(a, 1, 0, 10);
    const t0 = a.actions.swim.time;
    turtleFrame(a, 1, 0, 10 + 1 / 0.045 / 4);
    // A stroke is 2.4 s of clip: a quarter of a second of it per 1/0.045/4 units swum.
    expect((a.actions.swim.time - t0 + 2.4) % 2.4).toBeCloseTo(0.25, 9);
  });

  it('its eyes: pleased after a look, content sculling, sometimes dozing on a glide', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) for (let t = 0; t < 600; t += 0.1) {
      const m = turtleMoment(i, t);
      if (m.eyes.glyph) seen.add(`${m.doing}:${m.eyes.glyph}`);
    }
    for (const want of ['paddle:sleepy', 'glide:sleepy', 'swim:happy']) expect([...seen]).toContain(want);
    expect([...seen].some((s) => s.endsWith(':happy') && (s.startsWith('look') || s.startsWith('swim')))).toBe(true);
  });
});
