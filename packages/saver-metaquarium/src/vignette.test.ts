import { describe, expect, it } from 'vitest';
import { GESTURES, INTERIOR_MARKS, OPEN_MARKS, parseVignette, poseOf, resolveVignette, VIGNETTES } from './vignette';

const tea = (): ReturnType<typeof parseVignette> => parseVignette(VIGNETTES.tea!, INTERIOR_MARKS);
const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('vignettes', () => {
  it('every shipped example parses clean against the room it is written for', () => {
    for (const [name, script] of Object.entries(VIGNETTES)) {
      const v = parseVignette(script, INTERIOR_MARKS);
      expect(v.problems, name).toEqual([]);
      expect(v.actors).toBeGreaterThanOrEqual(2);
      expect(v.actors).toBeLessThanOrEqual(3);
      expect(v.duration).toBeGreaterThan(20);
    }
    expect(resolveVignette('tea')).toBe(VIGNETTES.tea);
    expect(resolveVignette('a >left')).toBe('a >left');
  });

  it('is a pure function of time, and loops without a cut', () => {
    const v = tea();
    for (const t of [0, 3.3, 17.9, 41]) expect(poseOf(v, 0, t)).toEqual(poseOf(v, 0, t));
    for (let a = 0; a < v.actors; a += 1) {
      expect(dist(poseOf(v, a, v.duration - 0.01)!, poseOf(v, a, 0.01)!)).toBeLessThan(1.5);
      expect(poseOf(v, a, 5 + v.duration)!.x).toBeCloseTo(poseOf(v, a, 5)!.x, 6);
    }
    expect(poseOf(v, 2, 1)).toBeNull(); // no third actor in a two-hander
  });

  it('nobody teleports, nobody shares a body, headings are always unit', () => {
    for (const script of Object.values(VIGNETTES)) {
      const v = parseVignette(script, INTERIOR_MARKS);
      let prev = Array.from({ length: v.actors }, (_, a) => poseOf(v, a, 0)!);
      for (let t = 0.05; t < v.duration; t += 0.05) {
        const now = Array.from({ length: v.actors }, (_, a) => poseOf(v, a, t)!);
        now.forEach((p, a) => {
          expect(dist(p, prev[a]!) / 0.05).toBeLessThan(70); // units/s — brisk, never a jump
          expect(Math.hypot(p.fx, p.fy, p.fz)).toBeCloseTo(1, 3);
          expect(p.y).toBeGreaterThanOrEqual(9);
        });
        prev = now;
      }
    }
  });

  it('turn-taking: while one talks the other listens, facing them', () => {
    const v = parseVignette('4s: a =table, b =table | 6s: a @b talk, b @a nod | 6s: b @a talk, a @b shake', INTERIOR_MARKS);
    const a = poseOf(v, 0, 7)!, b = poseOf(v, 1, 7)!;
    expect(a.doing).toBe('talk');
    expect(b.doing).toBe('nod');
    // b looks at a: forward · (a − b) > 0
    expect(b.fx * (a.x - b.x) + b.fz * (a.z - b.z)).toBeGreaterThan(0);
    expect(poseOf(v, 1, 13)!.doing).toBe('talk');
    expect(poseOf(v, 0, 13)!.doing).toBe('shake');
    expect(dist(a, b)).toBeGreaterThan(18); // either side of the table, not inside each other
  });

  it('a follower travels with its leader and lands beside it', () => {
    const v = parseVignette('3s: a =door, b =door | a >bed, b follow a', INTERIOR_MARKS);
    const end = v.beats[1]!.t0 + v.beats[1]!.dur - 0.05;
    expect(dist(poseOf(v, 0, end)!, poseOf(v, 1, end)!)).toBeLessThan(24);
    expect(dist(poseOf(v, 1, end)!, poseOf(v, 1, 1)!)).toBeGreaterThan(80);
  });

  it('bad scripts say what is wrong and what IS allowed, and never throw', () => {
    const v = parseVignette('a >kitchen juggle, z hop | b @q', OPEN_MARKS);
    const all = v.problems.join(' ');
    expect(all).toMatch(/no mark "kitchen"/);
    expect(all).toMatch(/unknown word "juggle"/);
    expect(all).toMatch(/names no actor/);
    expect(all).toMatch(/marks: centre, left/);
    expect(all).toContain(GESTURES[0]);
    expect(parseVignette('', OPEN_MARKS)).toMatchObject({ actors: 0, duration: 0, problems: [] });
  });
});
