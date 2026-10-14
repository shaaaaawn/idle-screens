import { AnimationClip, Bone, Group, Vector3, VectorKeyframeTrack } from 'three';
import { describe, expect, it } from 'vitest';
import {
  BUBBLE_AT, DOLPHIN_CATCH, DOLPHIN_CLIPS, DOLPHIN_GESTURE_CLIP, DOLPHIN_GESTURES, DOLPHIN_MOMENTS, DOLPHIN_STROKE, dolphinBlink, dolphinFrame,
  dolphinGaze, dolphinHold, dolphinLook, dolphinMoment, dolphinPersonality, MOMENT_LENGTH, PUPIL_SLIDE, pupilSlide, rigDolphin,
  type DolphinRig,
} from './dolphin';
import { actorTravel } from './dot';
import { GESTURES, OPEN_MARKS, parseVignette, poseOf } from './vignette';

const DUR: Record<string, number> = { swim: 1, glide: 3, burst: 0.5, hover: 2.4, blink: 0.4, ...MOMENT_LENGTH };

/** A stand-in for the Blender rig: the clips, two side eyes with pupils, a blowhole. */
function puppet(): Group {
  const root = new Group();
  for (const [side, s] of [['L', 1], ['R', -1]] as const) {
    // As three loads them: '.' dropped from the name; the eye on the side of the head, its pupil on the outer face.
    const eye = new Bone(); eye.name = `eye${side}`; eye.position.set(6 * s, 14, 28);
    const pupil = new Bone(); pupil.name = `pupil${side}`; pupil.position.set(1 * s, -2, 1);
    eye.add(pupil); root.add(eye);
  }
  const hole = new Bone(); hole.name = 'blowhole'; hole.position.set(0, 21, 20); root.add(hole);
  return root;
}
const clips = (names: readonly string[] = DOLPHIN_CLIPS): AnimationClip[] =>
  names.map((n) => new AnimationClip(n, DUR[n]!, [new VectorKeyframeTrack('.position', [0, DUR[n]!], [0, 0, 0, 1, 0, 0])]));
const rigged = (): DolphinRig => rigDolphin(puppet(), clips())!;
const w = (rig: DolphinRig, n: (typeof DOLPHIN_CLIPS)[number]): number => rig.actions[n].getEffectiveWeight();
const cruising = { pace: 1, flurry: 0 };

describe('dolphin: the rig', () => {
  it('needs every clip, finds its eyes and blowhole', () => {
    expect(rigDolphin(puppet(), clips(DOLPHIN_CLIPS.slice(1)))).toBeNull();
    const rig = rigged();
    expect(rig.eyes.map((e) => e.side)).toEqual([1, -1]);
    expect(rig.blowhole?.name).toBe('blowhole');
  });
});

describe('dolphin: its strokes keep time with the water it covers', () => {
  it('the swim clip is phased by distance, never by time × pace (which races as the pace changes)', () => {
    const rig = rigged();
    const tempo = dolphinPersonality(0).tempo;
    // Same distance, any hour: the same point in the stroke.
    for (const t of [3, 10000.25, 36000.5]) {
      dolphinFrame(rig, t, 0, 10, cruising);
      expect(rig.actions.swim.time).toBeCloseTo((10 * DOLPHIN_STROKE * tempo) % DUR.swim!, 6);
    }
    // A stroke's rate is its speed: 1 unit further is DOLPHIN_STROKE·tempo of clip.
    dolphinFrame(rig, 50, 0, 11, cruising);
    expect(rig.actions.swim.time).toBeCloseTo((11 * DOLPHIN_STROKE * tempo) % DUR.swim!, 6);
  });

  it('swims when cruising, hovers when slow, bursts when the tank darts it', () => {
    const rig = rigged();
    // A moment-free instant for slot 0.
    let t = 0;
    while (dolphinMoment(0, t).moment || dolphinBlink(0, t) !== null) t += 0.25;
    dolphinFrame(rig, t, 0, 0, { pace: 1, flurry: 0 });
    expect(w(rig, 'swim') + w(rig, 'glide')).toBeCloseTo(1, 6);
    dolphinFrame(rig, t, 0, 0, { pace: 0.05, flurry: 0 });
    expect(w(rig, 'hover')).toBeCloseTo(1, 6);
    dolphinFrame(rig, t, 0, 0, { pace: 1, flurry: 1 });
    expect(w(rig, 'burst')).toBeCloseTo(1, 6);
  });
});

describe('dolphin: its moments', () => {
  it('each dolphin is someone: a temperament, a favourite it has a repertoire for, its own tempo', () => {
    const tempers = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const p = dolphinPersonality(i);
      tempers.add(p.temper);
      expect(DOLPHIN_MOMENTS).toContain(p.favourite);
      expect(p.tempo).toBeGreaterThanOrEqual(0.85);
      expect(p.tempo).toBeLessThanOrEqual(1.2);
      expect(p.period).toBeGreaterThan(Math.max(...Object.values(MOMENT_LENGTH)) + 2);
    }
    expect(tempers.size).toBe(4);
  });

  it('plays every moment in time, softly in and out, and never two at once', () => {
    const seen = new Set<string>();
    for (const index of [0, 3, 7, 12]) {
      let prev: { m: string | null; start: number } = { m: null, start: -1 };
      for (let t = 0; t < 600; t += 0.05) {
        const m = dolphinMoment(index, t);
        if (!m.moment) { expect(m.weight).toBe(0); prev = { m: null, start: -1 }; continue; }
        seen.add(m.moment);
        expect(m.into).toBeGreaterThanOrEqual(0);
        expect(m.into).toBeLessThanOrEqual(MOMENT_LENGTH[m.moment]);
        // One moment runs to its end before the next begins.
        if (prev.m) { expect(m.moment).toBe(prev.m); expect(m.start).toBeCloseTo(prev.start, 6); }
        prev = { m: m.moment, start: m.start };
        if (m.into < 0.02 || m.into > MOMENT_LENGTH[m.moment] - 0.02) expect(m.weight).toBeLessThan(0.02);
      }
    }
    expect([...seen].sort()).toEqual([...DOLPHIN_MOMENTS].sort());
  });

  it('slows for a moment and makes the ground good after: no jumps, nothing left owing', () => {
    for (const index of [0, 5, 9]) {
      let prev = dolphinHold(index, 0);
      for (let t = 0.05; t < 300; t += 0.05) {
        const h = dolphinHold(index, t);
        // Never more than a second of travel per second held, never a jump.
        expect(Math.abs(h - prev)).toBeLessThan(0.051);
        expect(h).toBeGreaterThanOrEqual(0);
        prev = h;
      }
      // Find a moment's end; a catch-up later nothing is owed.
      let t = 0;
      while (!dolphinMoment(index, t).moment) t += 0.05;
      const m = dolphinMoment(index, t);
      const end = m.start + MOMENT_LENGTH[m.moment!];
      expect(dolphinHold(index, end + 0.01)).toBeGreaterThan(0);
      expect(dolphinHold(index, end + DOLPHIN_CATCH + 0.01)).toBeLessThan(1e-9);
    }
  });

  it('turns its eye to you for the friendly ones, not for a flip', () => {
    const rig = rigged();
    let friendly = false, showy = false;
    for (let t = 0; t < 400; t += 0.1) {
      const m = dolphinMoment(1, t);
      if (!m.moment || m.weight < 0.9) continue;
      const s = dolphinFrame(rig, t, 1, t * 20, cruising);
      if (m.moment === 'flip' || m.moment === 'spin') { expect(s.face).toBe(0); showy = true; } else { expect(s.face).toBeGreaterThan(0.89); friendly = true; }
      expect(s.doing).toBe(m.moment);
    }
    expect(friendly || showy).toBe(true);
  });

  it('lets one bubble go from its blowhole at the puff, with a key that holds for that bubble', () => {
    const rig = rigged();
    let index = 0, t = 0;
    search: for (; index < 40; index++) for (t = 0; t < 400; t += 0.05) if (dolphinMoment(index, t).moment === 'bubble') break search;
    const start = dolphinMoment(index, t).start;
    expect(dolphinFrame(rig, start + BUBBLE_AT - 0.05, index, 0, cruising).bubble).toBeNull();
    const a = dolphinFrame(rig, start + BUBBLE_AT + 0.05, index, 0, cruising).bubble!;
    const b = dolphinFrame(rig, start + BUBBLE_AT + 0.6, index, 0, cruising).bubble!;
    expect(a.key).toBe(b.key);
    expect(a.t).toBeCloseTo(start + BUBBLE_AT, 6);
  });
});

describe('dolphin: in a vignette', () => {
  it('plays the gestures it has clips for with its own body', () => {
    for (const g of DOLPHIN_GESTURES) {
      expect(GESTURES).toContain(g);
      expect(DOLPHIN_MOMENTS).toContain(DOLPHIN_GESTURE_CLIP[g]);
    }
    expect(DOLPHIN_GESTURE_CLIP.talk).toBe('chatter');
    expect(DOLPHIN_GESTURE_CLIP.hop).toBe('flip');
    expect(DOLPHIN_GESTURE_CLIP.wiggle).toBe('wave');
    const rig = rigged();
    const s = dolphinFrame(rig, 100, 0, 0, { pace: 0, flurry: 0, actor: true, gesture: { name: 'talk', at: 1.2, weight: 1 } });
    expect(s.doing).toBe('chatter');
    expect(w(rig, 'chatter')).toBe(1);
    expect(rig.actions.chatter.time).toBeCloseTo(1.2, 6);
    // A gesture longer than its clip plays it again.
    dolphinFrame(rig, 100, 0, 0, { pace: 0, flurry: 0, actor: true, gesture: { name: 'nod', at: MOMENT_LENGTH.nod + 0.3, weight: 1 } });
    expect(rig.actions.nod.time).toBeCloseTo(0.3, 6);
  });

  it('as an actor takes no moments of its own: the script says what it does', () => {
    const rig = rigged();
    for (let t = 0; t < 200; t += 0.5) {
      const s = dolphinFrame(rig, t, 2, t * 10, { pace: 1, flurry: 0, actor: true });
      expect(DOLPHIN_MOMENTS as readonly string[]).not.toContain(s.doing);
    }
  });
});

describe('dolphin: in a scene, its strokes cover its climbs and dives', () => {
  it('a swimmer\'s travel is through the water, height and all (a walker\'s only across the floor)', () => {
    // Down from on high to the low mark: mostly a dive.
    const v = parseVignette('3s: a =low, b =high | 8s: b >low @a | 6s: b >high', OPEN_MARKS);
    const own = (g: string): boolean => (DOLPHIN_GESTURES as readonly string[]).includes(g);
    let worst = 0, dove = false;
    for (let t = 3.5; t < 11; t += 0.5) {
      const a = poseOf(v, 1, t, own)!, b = poseOf(v, 1, t + 0.1, own)!;
      const speed3 = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / 0.1, flat = Math.hypot(b.x - a.x, b.z - a.z) / 0.1;
      if (speed3 < 3) continue;
      if (flat < speed3 * 0.8) dove = true;
      const rate = (actorTravel(v, 1, t + 0.1, own, true) - actorTravel(v, 1, t, own, true)) / 0.1;
      worst = Math.max(worst, Math.abs(rate - speed3) / speed3);
      // The floor-only measure Dot's feet use runs slow on a dive.
      expect(actorTravel(v, 1, t + 0.1, own) - actorTravel(v, 1, t, own)).toBeLessThanOrEqual(rate * 0.1 + 1e-9);
    }
    expect(dove).toBe(true);
    expect(worst).toBeLessThan(0.1);
  });
});

describe('dolphin: its eyes', () => {
  it('a pupil stays on its eye: rest is the front and low corner of its travel', () => {
    expect(pupilSlide(1, -1)).toEqual({ y: 0, z: -0 });
    expect(pupilSlide(-1, 1)).toEqual({ y: PUPIL_SLIDE.up, z: -PUPIL_SLIDE.back });
    for (const [f, u] of [[5, 5], [-5, -5], [0.3, -0.2]] as const) {
      const o = pupilSlide(f, u);
      expect(o.y).toBeGreaterThanOrEqual(0); expect(o.y).toBeLessThanOrEqual(PUPIL_SLIDE.up);
      expect(o.z).toBeLessThanOrEqual(0); expect(o.z).toBeGreaterThanOrEqual(-PUPIL_SLIDE.back);
    }
  });

  it('between moments: mostly ahead while it swims, about in saccades, now and then at you; each gaze held a while', () => {
    const seen = new Set<string>();
    for (const doing of ['swim', 'hover', 'glide'] as const) {
      for (let t = 0; t < 300; t += 0.3) {
        const g = dolphinGaze(4, t, doing, 0, false);
        seen.add(g.at);
        expect(Math.abs(g.gf)).toBeLessThanOrEqual(1);
        expect(Math.abs(g.gu)).toBeLessThanOrEqual(1);
        // Held for its saccade slot: no jitter within one.
        expect(dolphinGaze(4, Math.floor(t / 0.9) * 0.9 + 0.01, doing, 0, false)).toEqual(dolphinGaze(4, Math.floor(t / 0.9) * 0.9 + 0.85, doing, 0, false));
      }
    }
    expect([...seen].sort()).toEqual(['ahead', 'viewer', 'wander']);
  });

  it('looks at you while it chatters, at its friend in a scene, up after its bubble', () => {
    expect(dolphinGaze(0, 10, 'chatter', 1, false).at).toBe('viewer');
    expect(dolphinGaze(0, 10, 'swim', 0, true).at).toBe('friend');
    expect(dolphinGaze(0, 10, 'bubble', BUBBLE_AT + 0.2, false)).toMatchObject({ at: 'up', gu: 1 });
  });

  it('slides the near pupil toward you, and leaves the far one looking ahead', () => {
    const rig = rigged();
    rig.body.updateMatrixWorld(true);
    // Up and to its left (+x), level with its eyes and a little ahead.
    const viewer = new Vector3(200, 60, 60);
    const at = dolphinLook(rig, 10, 0, { doing: 'chatter', into: 1 }, viewer);
    expect(at).toBe('viewer');
    const [left, right] = rig.eyes;
    const dl = left!.pupil.position.clone().sub(left!.pupilRest), dr = right!.pupil.position.clone().sub(right!.pupilRest);
    // The near (left) eye's pupil rises toward the viewer above; the far one looks ahead (rest-forward, mid-height).
    expect(dl.y).toBeGreaterThan(dr.y - 1e-9);
    expect(dr.z).toBeCloseTo(-0.1 * PUPIL_SLIDE.back, 6);
    // Riding in its eye (no viewer): it watches where it is going.
    expect(dolphinLook(rig, 10, 0, { doing: 'chatter', into: 1 }, null)).toBe('ahead');
  });
});
