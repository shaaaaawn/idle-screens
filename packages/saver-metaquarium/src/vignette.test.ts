import { describe, expect, it } from 'vitest';
import { actorTravel } from './dot';
import { DANCES, GESTURES, INTERIOR_MARK_POLAR, INTERIOR_MARKS, OPEN_MARKS, parseVignette, poseAcross, poseOf, resolveVignette, snapBetween, VIGNETTES } from './vignette';

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

  it('dances: reported to the fish that dances them itself, done with the whole body by any other', () => {
    const v = parseVignette('4s: a =centre | 4s: a windmill | 4s: a headspin', OPEN_MARKS);
    expect(v.problems).toEqual([]);
    const plain = poseOf(v, 0, 6)!, own = poseOf(v, 0, 6, (g) => g === 'windmill')!;
    expect(plain.doing).toBe('windmill');
    expect(plain.gesture?.name).toBe('windmill');
    expect(own.gesture).toEqual(plain.gesture);
    expect(Math.abs(plain.roll - own.roll)).toBeGreaterThan(0.1); // the whole-body roll, left to the clip
    expect(own.x).toBeCloseTo(plain.x, 6);
    expect(poseOf(v, 0, 10)!.gesture?.name).toBe('headspin');
  });

  it('a gesture\'s clocks are real seconds, and a dance\'s bar is its beat\'s', () => {
    // Standing (the actor has arrived) and travelled-in beats both: the beat starts at 4 s.
    for (const script of ['4s: a =centre | 4s: a windmill', '4s: a =left | 4s: a >right windmill']) {
      const v = parseVignette(script, OPEN_MARKS);
      const a = poseOf(v, 0, 7)!.gesture!, b = poseOf(v, 0, 7.5)!.gesture!;
      expect(b.at - a.at, script).toBeCloseTo(0.5, 6);
      expect(a.bar, script).toBeCloseTo(3, 6);
      expect(b.bar, script).toBeCloseTo(3.5, 6);
      expect(a.at, script).toBeLessThan(a.bar);
    }
  });

  it('every dance moves a fish with no clips for it', () => {
    for (const d of DANCES) {
      const v = parseVignette(`4s: a =centre | 4s: a ${d}`, OPEN_MARKS);
      const still = poseOf(v, 0, 3.9)!, at = (t: number) => poseOf(v, 0, t)!;
      const moved = [4.6, 5.3, 6.1, 6.9].some((t) => {
        const p = at(t);
        return Math.abs(p.y - still.y) > 0.3 || Math.abs(p.roll - still.roll) > 0.05 || Math.hypot(p.fx - still.fx, p.fy - still.fy, p.fz - still.fz) > 0.05;
      });
      expect(moved, d).toBe(true);
    }
  });
});

describe('a later `=mark` (X444a)', () => {
  // `=` places with no travel: in a later beat the actor is there from the
  // beat's first moment, not left where it was until the next beat cuts it over.
  const v = parseVignette('3s: a =left, b =right | 4s: a =right | 4s: a >left', OPEN_MARKS);
  const right = { x: OPEN_MARKS.right!.x, z: OPEN_MARKS.right!.z };

  it('snaps at the start of its beat and holds the mark through it', () => {
    expect(v.problems).toEqual([]);
    const before = poseOf(v, 0, 2.9)!;
    expect(before.x).toBeLessThan(-40); // at left
    for (const t of [3.02, 4, 5.5, 6.95]) {
      const p = poseOf(v, 0, t)!;
      expect(Math.hypot(p.x - right.x, p.z - right.z), `t=${t}`).toBeLessThan(25); // its spot at right (a STANDOFF ring)
    }
    // No jump at the next boundary: the walk off starts from where it stood.
    const end = poseOf(v, 0, 6.999)!, start = poseOf(v, 0, 7.001)!;
    expect(Math.hypot(end.x - start.x, end.z - start.z)).toBeLessThan(0.5);
  });

  it('turns no heading toward the cut: the facing is steady across the snap', () => {
    const h = (t: number): number => { const p = poseOf(v, 0, t)!; return Math.atan2(p.fx, p.fz); };
    const turn = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    // Just before the snap the actor stands at left; the lookahead must not see it across the room.
    expect(turn(h(2.8), h(2.97))).toBeLessThan(0.05);
    expect(poseOf(v, 0, 2.97)!.doing).toBe('idle');
  });

  it('a first-beat `=` is unchanged: the opening places, the loop walks home to it', () => {
    const w = parseVignette('3s: a =left, b =right | 4s: a >right', OPEN_MARKS);
    expect(poseOf(w, 0, 1)!.x).toBeLessThan(-40);
  });
});

describe('a `=` cut, sampled across (X444a)', () => {
  const v = parseVignette('3s: a =left, b =right | 4s: a =right | 4s: a >left', OPEN_MARKS);
  it('snapBetween sees the cut only across its boundary; poseAcross reads no velocity through it', () => {
    expect(snapBetween(v, 0, 2.9, 3.1)).toBe(true);
    expect(snapBetween(v, 0, 3.1, 2.9)).toBe(true);
    expect(snapBetween(v, 0, 3.0, 3.2)).toBe(false); // already cut
    expect(snapBetween(v, 1, 2.9, 3.1)).toBe(false); // b is not cut
    expect(snapBetween(v, 0, 2.9 + v.duration, 3.1 + v.duration)).toBe(true); // every loop
    const now = poseOf(v, 0, 2.9)!, on = poseAcross(v, 0, 2.9, 0.25)!;
    expect(Math.hypot(on.x - now.x, on.z - now.z)).toBeLessThan(1e-9);
  });
  it('a walking actor reads its walk: dot.actorTravel counts no steps for the jump', () => {
    const before = actorTravel(v, 0, 2.95), after = actorTravel(v, 0, 3.05);
    expect(after - before).toBeLessThan(1);
  });
});

describe('the interior mark table (X447 docs)', () => {
  it('names every furniture mark where INTERIOR_MARKS puts it', () => {
    for (const [name, p] of Object.entries(INTERIOR_MARK_POLAR)) {
      const m = INTERIOR_MARKS[name]!;
      expect(Math.hypot(m.x, m.z), name).toBeCloseTo(p.r, 9);
      expect(((Math.atan2(m.z, m.x) * 180) / Math.PI + 360) % 360, name).toBeCloseTo(p.deg, 9);
      expect(m.y).toBe(p.y);
    }
    expect(Object.keys(INTERIOR_MARK_POLAR).length + 3).toBe(Object.keys(INTERIOR_MARKS).length); // + rug, centre, chandelier
  });
});
