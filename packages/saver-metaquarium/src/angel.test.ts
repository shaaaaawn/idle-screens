import { AnimationClip, Bone, Group, NumberKeyframeTrack } from 'three';
import { describe, expect, it } from 'vitest';
import { ANGEL_CLIPS, angelAct, angelCycle, angelFrame, angelMoment, rigAngel } from './angel';

const DUR: Record<string, number> = { swim: 1, glide: 4, burst: 0.9, display: 3 };
const puppet = (): Group => { const g = new Group(); const b = new Bone(); b.name = 'body'; g.add(b); return g; };
const clips = (names: readonly string[] = ANGEL_CLIPS): AnimationClip[] =>
  names.map((n) => new AnimationClip(n, DUR[n]!, [new NumberKeyframeTrack('body.position[x]', [0, DUR[n]!], [0, 1])]));

describe('angelfish: the angel', () => {
  it('rigs only a model that carries its four clips', () => {
    expect(rigAngel(puppet(), clips())).not.toBeNull();
    expect(rigAngel(puppet(), clips(['swim', 'glide']))).toBeNull();
  });

  it('glides once a cycle, and some cycles show off or dart — not every one', () => {
    for (let i = 0; i < 6; i++) {
      const c = angelCycle(i);
      let glided = 0;
      for (let t = 0; t < c.period; t += 0.05) if (angelMoment(i, t).doing === 'glide') glided += 0.05;
      expect(glided).toBeGreaterThan(3);
      expect(glided).toBeLessThan(5.1);
    }
    const acts = Array.from({ length: 60 }, (_, k) => angelAct(5, k));
    expect(acts).toContain('display');
    expect(acts).toContain('burst');
    expect(acts).toContain(null);
  });

  it('the clips share one whole', () => {
    for (let t = 0; t < 90; t += 0.07) {
      const w = angelMoment(3, t).weights;
      expect(w.swim + w.glide + w.burst + w.display).toBeCloseTo(1, 9);
      for (const n of ANGEL_CLIPS) expect(w[n]).toBeGreaterThanOrEqual(0);
    }
  });

  it('is pure in (index, t), and the tail beats with the distance swum', () => {
    const a = rigAngel(puppet(), clips())!, b = rigAngel(puppet(), clips())!;
    for (const t of [0.4, 8.1, 21.7]) {
      const sa = angelFrame(a, t, 4, 88.8);
      angelFrame(a, t + 3, 4, 200);
      expect(angelFrame(a, t, 4, 88.8)).toEqual(sa);
      expect(angelFrame(b, t, 4, 88.8)).toEqual(sa);
      for (const n of ANGEL_CLIPS) expect(a.actions[n].getEffectiveWeight()).toBe(sa.weights[n]);
    }
    angelFrame(a, 1, 0, 10);
    const t0 = a.actions.swim.time;
    angelFrame(a, 1, 0, 10 + 1 / 0.045 / 4);
    expect((a.actions.swim.time - t0 + 1) % 1).toBeCloseTo(0.25, 9);
  });

  it('its eyes make the faces of what it does: proud or smitten showing off, wide at a dart', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) for (let t = 0; t < 400; t += 0.1) {
      const m = angelMoment(i, t);
      if (m.eyes.glyph) seen.add(`${m.doing}:${m.eyes.glyph}`);
      if (m.doing === 'burst' && m.eyes.glyph) expect(m.eyes.glyph).toBe('surprised');
      if (m.doing === 'display' && m.eyes.glyph) expect(['happy', 'heart']).toContain(m.eyes.glyph);
    }
    for (const want of ['display:happy', 'display:heart', 'burst:surprised', 'glide:sleepy']) expect([...seen]).toContain(want);
  });
});
