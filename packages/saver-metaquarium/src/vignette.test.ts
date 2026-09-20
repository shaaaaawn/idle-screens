import { describe, expect, it } from 'vitest';
import { GESTURES, INTERIOR_MARKS, OPEN_MARKS, parseVignette, poseOf, resolveVignette, VIGNETTES } from './vignette';

/** duet and trio are written for the open stage; the rest for the geode room. */
const marksFor = (name: string): typeof OPEN_MARKS => (name === 'duet' || name === 'trio' ? OPEN_MARKS : INTERIOR_MARKS);
const tea = (): ReturnType<typeof parseVignette> => parseVignette(VIGNETTES.tea!, INTERIOR_MARKS);
const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('vignettes', () => {
  it('every shipped example parses clean against the room it is written for', () => {
    for (const [name, script] of Object.entries(VIGNETTES)) {
      const v = parseVignette(script, marksFor(name));
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
    expect(poseOf(v, 2, 1)).toBeNull(); // no third actor in a two-hander
    for (const [name, script] of Object.entries(VIGNETTES)) {
      const v = parseVignette(script, marksFor(name));
      for (let a = 0; a < v.actors; a += 1) {
        // The blocking repeats every `duration`…
        expect(poseOf(v, a, 5 + v.duration)!.x).toBeCloseTo(poseOf(v, a, 5)!.x, 6);
        // …and the seam is invisible: the frame either side of it, in REAL
        // time, differs by no more than 0.02 s of motion. Sampled as D ± 0.01
        // rather than (D − 0.01, 0.01) because the alive bob rides the raw
        // clock (vignette.ts: `sin(tSec * 1.25 + …) * 0.9`), so it is
        // continuous across the wrap but not periodic in it — comparing
        // against t = 0.01 would measure the bob's phase, not the seam.
        // Bound: a jump-free walk covers < 70 u/s (below) → 1.4, plus the
        // bob's own 0.9 · 1.25 · 0.02 ≈ 0.02.
        const before = poseOf(v, a, v.duration - 0.01)!, after = poseOf(v, a, v.duration + 0.01)!;
        expect(dist(before, after), `${name} actor ${a}`).toBeLessThan(1.45);
      }
    }
  });

  it('nobody teleports, headings are always unit', () => {
    for (const [name, script] of Object.entries(VIGNETTES)) {
      const marks = marksFor(name);
      const v = parseVignette(script, marks);
      expect(v.problems, name).toEqual([]); // parsed for its own stage, so every cue moves someone
      // The fastest honest move on this stage: a follower closes on its leader
      // over the first half of a beat (`smoother(u * 2)`, peak slope 3.75), so
      // the longest span between two marks in the shortest beat bounds every
      // walk, circle and follow. A jump covers a span in ONE tick — 20× that.
      const at = Object.values(marks);
      const span = Math.max(...at.flatMap((m) => at.map((n) => dist(m, n))));
      const cap = (3.75 * span) / Math.min(...v.beats.map((b) => b.dur));
      let prev = Array.from({ length: v.actors }, (_, a) => poseOf(v, a, 0)!);
      for (let t = 0.05; t < v.duration; t += 0.05) {
        const now = Array.from({ length: v.actors }, (_, a) => poseOf(v, a, t)!);
        now.forEach((p, a) => {
          expect(dist(p, prev[a]!) / 0.05, `${name} actor ${a} at ${t}`).toBeLessThan(cap); // units/s — brisk, never a jump
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

  it('"follow" onto a mark is a validation problem, not a silent no-op', () => {
    const v = parseVignette('a follow rug', INTERIOR_MARKS);
    expect(v.problems.join(' ')).toMatch(/follow/);
  });

  it('a circle beat leaves the actor where it actually ends, not the stale > destination', () => {
    const v = parseVignette('a >door circle rug | a >table', INTERIOR_MARKS);
    expect(v.problems).toEqual([]);
    const b0 = v.beats[0]!;
    // Right before the circle beat ends, the actor is back near where the
    // beat started (the ring eases back to `from`). Right after, the next
    // beat's walk begins — it should pick up from that same spot, not from
    // the `>door` destination the circle cue left stale in `state[i].to`.
    const before = poseOf(v, 0, b0.t0 + b0.dur - 0.01)!;
    const after = poseOf(v, 0, b0.t0 + b0.dur + 0.01)!;
    expect(dist(before, after)).toBeLessThan(2);
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
