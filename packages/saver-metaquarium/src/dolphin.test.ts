import { AnimationClip, AnimationMixer, Bone, Group, type Object3D, type SkinnedMesh, Vector3, VectorKeyframeTrack } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import {
  BANK, BUBBLE_AT, DOLPHIN_CATCH, DOLPHIN_CHARACTER, dolphinBank, dolphinUpright, UPRIGHT, dolphinLeap, dolphinLeapAhead, dolphinLeapAt, dolphinLeapStart, dolphinTurn, LEAP, FLIP_TURN, SPIN_TURN, DOLPHIN_CLIPS, DOLPHIN_GESTURE_CLIP, DOLPHIN_GESTURES, DOLPHIN_MOMENTS, DOLPHIN_STROKE, dolphinBlink, dolphinFrame,
  dolphinGaze, dolphinHold, dolphinLook, dolphinMoment, dolphinPersonality, MOMENT_LENGTH, PUPIL_SLIDE, pupilSlide, rigDolphin,
  type DolphinRig,
} from './dolphin';
import { BUNDLED_BREEDS } from './breeds';
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

describe('dolphin: a flip and a roll turn the whole dolphin, smoothly', () => {
  it('the turn runs from rest to a whole turn with no step, easing in and out', () => {
    for (const [m, T, L] of [['flip', FLIP_TURN, MOMENT_LENGTH.flip], ['spin', SPIN_TURN, MOMENT_LENGTH.spin]] as const) {
      const at = (t: number): number => { const r = dolphinTurn(m, t); return m === 'flip' ? r.pitch : r.roll; };
      expect(Math.abs(at(0))).toBe(0);
      expect(at(L)).toBeCloseTo(T.angle, 9);
      let prev = at(0), top = 0;
      for (let t = 0.01; t <= L; t += 0.01) {
        const a = at(t), step = Math.abs(a - prev);
        top = Math.max(top, step);
        expect(Math.sign(a - prev) * Math.sign(T.angle)).toBeGreaterThanOrEqual(0); // always the one way: never unwinds
        prev = a;
      }
      // The fastest 10 ms is a gentle step (≈ 1.9 × the average), never a jump.
      expect(top).toBeLessThan((Math.abs(T.angle) / ((T.to - T.from) / 0.01)) * 2);
      // At rest before and after: the clip's ends match the swim it blends with.
      expect(Math.abs(at(T.from - 0.05))).toBe(0);
      expect(at(T.to + 0.05)).toBeCloseTo(T.angle, 9);
    }
    expect(dolphinTurn('chatter', 1)).toEqual({ pitch: 0, roll: 0 });
  });

  it('plays the turn whatever the moment\'s weight, once, and reports it with the state', () => {
    const rig = rigged();
    // A vignette's hop at a quarter weight still turns the whole way (a partial turn would unwind).
    const s = dolphinFrame(rig, 100, 0, 0, { pace: 0, flurry: 0, actor: true, gesture: { name: 'hop', at: 1.25, weight: 0.25 } });
    expect(s.turn.pitch).toBeCloseTo(dolphinTurn('flip', 1.25).pitch, 9);
    // Held past its clip it does not flip again: it rests at the whole turn.
    const late = dolphinFrame(rig, 100, 0, 0, { pace: 0, flurry: 0, actor: true, gesture: { name: 'hop', at: MOMENT_LENGTH.flip + 1, weight: 1 } });
    expect(late.turn.pitch).toBeCloseTo(FLIP_TURN.angle, 9);
    expect(rig.actions.flip.time).toBeCloseTo(MOMENT_LENGTH.flip - 1e-4, 6);
    expect(dolphinFrame(rig, 100, 0, 0, { pace: 1, flurry: 0, actor: true }).turn).toEqual({ pitch: 0, roll: 0 });
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

/**
 * The real model, measured against the real animal (Fish 1998, J Exp Biol 201: Tursiops; Fish's
 * kinematic regressions; the NOAA Fisheries side profile). Shape is judged as SHAPE — a cartoon may
 * be plumper than life — so these pin where it goes wrong, not how fat it is.
 */
describe('dolphin: the real model, against the real animal', () => {
  const load = async (): Promise<{ scene: Object3D; animations: AnimationClip[] }> => {
    const b = Buffer.from((await BUNDLED_BREEDS.dolphin!()).default, 'base64');
    return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
  };
  /** Every bind-pose vertex, in the model's frame (nose toward +z). */
  const points = (scene: Object3D): Vector3[] => {
    scene.updateMatrixWorld(true);
    const out: Vector3[] = [];
    scene.traverse((o) => {
      const m = o as SkinnedMesh;
      if (!m.isMesh) return;
      const p = m.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) out.push(new Vector3().fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld));
    });
    return out;
  };

  it('a tail stock that is a keel, deep into the flukes; flukes a quarter-ish of its length across', async () => {
    const pts = points((await load()).scene);
    const z0 = Math.min(...pts.map((p) => p.z)), z1 = Math.max(...pts.map((p) => p.z)), L = z1 - z0;
    /** Depth and width of what lies in a slab at fraction f back from the nose. */
    const slab = (f: number) => {
      const z = z1 - f * L, s = pts.filter((p) => Math.abs(p.z - z) < L * 0.012);
      return { depth: Math.max(...s.map((p) => p.y)) - Math.min(...s.map((p) => p.y)), width: Math.max(...s.map((p) => p.x)) - Math.min(...s.map((p) => p.x)) };
    };
    // Narrowing from the dorsal back, then a KEEL into the flukes: one cube thin, four deep. (A round
    // thin stalk there read as a stick, the dolphin as a swordfish.)
    for (const f of [0.73, 0.79]) expect(slab(f).width / slab(f).depth, `f ${f}`).toBeLessThan(0.7);
    for (const f of [0.82, 0.85]) {
      const { depth, width } = slab(f);
      expect(width / depth, `f ${f}`).toBeLessThan(0.4);
      expect(depth / L, `f ${f}`).toBeGreaterThan(0.08);
    }
    // The taper behind the dorsal runs smoothly: no step between the body and the stock.
    const d = [0.65, 0.72, 0.79, 0.85].map((f) => slab(f).depth);
    for (let i = 1; i < d.length; i++) expect(d[i]! / d[i - 1]!, `taper ${i}`).toBeGreaterThan(0.7);
    // The flukes: span 0.25 L in life (a cartoon's a little more), widest in the last eighth.
    const tail = pts.filter((p) => p.z < z0 + L * 0.12);
    const span = Math.max(...tail.map((p) => p.x)) - Math.min(...tail.map((p) => p.x));
    expect(span / L).toBeGreaterThan(0.24);
    expect(span / L).toBeLessThan(0.33);
  });

  it('strokes from the flukes: tip heave ~0.2 of its length, the head near still, harder in a burst', async () => {
    const g = await load();
    const pts = points(g.scene), z0 = Math.min(...pts.map((p) => p.z)), z1 = Math.max(...pts.map((p) => p.z)), L = z1 - z0;
    // The tips: the vertices furthest forward and furthest back, followed through the skin.
    let nose: [SkinnedMesh, number] | null = null, tail: [SkinnedMesh, number] | null = null, nz = -Infinity, tz = Infinity;
    const v = new Vector3();
    g.scene.traverse((o) => {
      const m = o as SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      const p = m.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
        if (v.z > nz) { nz = v.z; nose = [m, i]; }
        if (v.z < tz) { tz = v.z; tail = [m, i]; }
      }
    });
    const heave = (name: string) => {
      const clip = g.animations.find((c) => c.name === name)!;
      const mixer = new AnimationMixer(g.scene), act = mixer.clipAction(clip);
      act.play();
      const ys: Array<[number, number]> = [];
      for (let k = 0; k <= 40; k++) {
        act.time = (clip.duration * k) / 40; mixer.update(0); g.scene.updateMatrixWorld(true);
        const at = ([m, i]: [SkinnedMesh, number]) => m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld).y;
        ys.push([at(nose!), at(tail!)]);
      }
      mixer.stopAllAction();
      const p2p = (j: 0 | 1) => (Math.max(...ys.map((y) => y[j])) - Math.min(...ys.map((y) => y[j]))) / L;
      return { head: p2p(0), flukes: p2p(1) };
    };
    const swim = heave('swim'), burst = heave('burst'), glide = heave('glide');
    // Fish 1998: the flukes' trailing edge heaves ~0.2 L peak to peak, at every speed.
    expect(swim.flukes).toBeGreaterThan(0.15);
    expect(swim.flukes).toBeLessThan(0.3);
    expect(swim.head).toBeLessThan(0.05);
    expect(burst.flukes).toBeGreaterThan(swim.flukes);
    expect(glide.flukes).toBeLessThan(swim.flukes);
  });
});

describe('dolphin: banked turns and breaches', () => {
  const loadRig = async () => {
    const b = Buffer.from((await BUNDLED_BREEDS.dolphin!()).default, 'base64');
    const g = await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
    return { g, rig: rigDolphin(g.scene, g.animations)! };
  };

  it('cruises nearly level and banks deep only in a hard turn', () => {
    // The tank's routes turn ~0.5 rad a body length half the time (measured): that stays under 15°.
    expect(Math.abs(dolphinBank(0.5).roll)).toBeLessThan((15 * Math.PI) / 180);
    expect(dolphinBank(0.5).curl).toBe(0);
    // The hardest turns roll it most of the way onto its side, and curl it.
    expect(Math.abs(dolphinBank(BANK.to).roll)).toBeGreaterThan(1.2);
    expect(dolphinBank(BANK.to).curl).toBeCloseTo(BANK.curl, 6);
    expect(dolphinBank(-0.9).roll).toBeCloseTo(-dolphinBank(0.9).roll, 9);
    // Smooth: no step anywhere along it.
    for (let a = 0; a < 1.5; a += 0.01) expect(Math.abs(dolphinBank(a + 0.01).roll - dolphinBank(a).roll)).toBeLessThan(0.05);
  });

  it('in a hard turn it rolls its belly to the turn and bends round it: both ends nearer the centre than its middle', async () => {
    const { g, rig } = await loadRig();
    // First, in its own frame (no roll): the curl is VENTRAL — the flukes bend toward the belly (down).
    const flukesY = (turn: number): number => {
      dolphinFrame(rig, 50, 0, 0, { pace: 1, flurry: 0, turn, actor: true });
      g.scene.updateMatrixWorld(true);
      let lo = Infinity, y = 0;
      const p3 = new Vector3();
      g.scene.traverse((o) => {
        const m = o as SkinnedMesh;
        if (!m.isSkinnedMesh) return;
        const p = m.geometry.getAttribute('position');
        for (let i = 0; i < p.count; i++) { m.getVertexPosition(i, p3).applyMatrix4(m.matrixWorld); if (p3.z < lo) { lo = p3.z; y = p3.y; } }
      });
      return y;
    };
    expect(flukesY(0.95)).toBeLessThan(flukesY(0) - 2);
    const holder = new Group(); holder.add(g.scene);
    // Turning to its left (+): the centre is off its left side, +x in its own frame (nose +z).
    const s = dolphinFrame(rig, 50, 0, 0, { pace: 1, flurry: 0, turn: 0.95, actor: true });
    holder.rotation.z = s.bank;
    holder.updateMatrixWorld(true);
    const v = new Vector3();
    let nose = -Infinity, tail = Infinity, noseX = 0, tailX = 0;
    g.scene.traverse((o) => {
      const m = o as SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      const p = m.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld);
        if (v.z > nose) { nose = v.z; noseX = v.x; }
        if (v.z < tail) { tail = v.z; tailX = v.x; }
      }
    });
    const mid = rig.pivot!.getWorldPosition(new Vector3());
    expect(noseX).toBeGreaterThan(mid.x);
    expect(tailX).toBeGreaterThan(mid.x);
  });

  it('the curl is set fresh each frame, never piled up', async () => {
    const { rig } = await loadRig();
    const at = () => { dolphinFrame(rig, 40, 2, 10, { pace: 1, flurry: 0, turn: 0.95, actor: true }); return rig.spine.map((b) => b.quaternion.clone()); };
    const a = at(), b = at();
    a.forEach((q, i) => expect(q.angleTo(b[i]!)).toBeLessThan(1e-9));
  });

  it('a breach: early in a tank, between its moments, never two at once, deterministic', () => {
    for (let index = 0; index < 8; index++) {
      // The first comes early (6–10 s, later only if a moment is in the way), so a tank shows one.
      expect(dolphinLeapStart(index, 0)).toBeLessThan(25);
      let prev = -Infinity;
      for (let k = 0; k < 12; k++) {
        const s0 = dolphinLeapStart(index, k);
        expect(s0).toBeGreaterThan(prev + LEAP.run + LEAP.air + LEAP.dive);
        prev = s0;
        // No moment of its own overlaps its flight.
        for (let t = s0; t <= s0 + LEAP.run + LEAP.air + LEAP.dive; t += 0.1) expect(dolphinMoment(index, t).moment, `fish ${index} leap ${k} at ${t}`).toBeNull();
      }
      expect(dolphinLeapAt(index, 123.4)).toEqual(dolphinLeapAt(index, 123.4));
    }
  });

  it('runs ahead along its route and gives it back slower than it swims: never backwards', () => {
    for (let index = 0; index < 8; index++) {
      let before = dolphinLeapAhead(index, 0);
      for (let t = 0.05; t < 400; t += 0.05) {
        const now = dolphinLeapAhead(index, t);
        // d(ahead)/dt > -1: its speed along the route is (1 + that) × cruising.
        // Even two leaps' give-backs overlapping leave it going forward.
        expect((now - before) / 0.05, `fish ${index} at ${t}`).toBeGreaterThan(-0.92);
        before = now;
      }
    }
  });

  it('flies a parabola above the surface, along its path: nose up on the run, level at the top, down into the dive', () => {
    const index = 1, start = dolphinLeapStart(index, 0), S = 118, routeY = 45, L = 37, pace = 9;
    const at = (u: number) => dolphinLeap(index, start + u, S, routeY, L, pace)!;
    // The air: y against time is a parabola (fit three points, check the rest).
    const t0 = LEAP.run + 0.05, t1 = LEAP.run + LEAP.air / 2, t2 = LEAP.run + LEAP.air - 0.05;
    const [y0, y1, y2] = [at(t0).y, at(t1).y, at(t2).y];
    const q = (t: number) => y0 * ((t - t1) * (t - t2)) / ((t0 - t1) * (t0 - t2)) + y1 * ((t - t0) * (t - t2)) / ((t1 - t0) * (t1 - t2)) + y2 * ((t - t0) * (t - t1)) / ((t2 - t0) * (t2 - t1));
    for (let u = t0; u <= t2; u += 0.05) expect(Math.abs(at(u).y - q(u))).toBeLessThan(0.5);
    // Above the surface by about its height at the top.
    expect(at(t1).y - S).toBeGreaterThan(LEAP.height * L * 0.8);
    expect(at(LEAP.run * 0.8).pitch).toBeGreaterThan(0.5);
    expect(Math.abs(at(t1).pitch)).toBeLessThan(0.1);
    expect(at(LEAP.run + LEAP.air + 0.2).pitch).toBeLessThan(-0.5);
    // In and out of its route with no step: its height moves smoothly from the run's start to the dive's end.
    for (let u = 0.02; u < LEAP.run + LEAP.air + LEAP.dive; u += 0.02) expect(Math.abs(at(u).y - at(u - 0.02).y), `u ${u}`).toBeLessThan(4);
    expect(at(0.01).y).toBeCloseTo(routeY, 0);
  });
});

describe('dolphin: standing up as a character', () => {
  it('stands for a character beat once it has arrived, stays up between bits, swims flat to move and for a flip', () => {
    const v = parseVignette('3s: a =left | 3s: a >centre | 3s: a talk | 2s: a nod | 2s: b talk | 2s: a bow | 3s: a >left | 2s: a hop', OPEN_MARKS);
    expect(v.problems).toEqual([]);
    const up = (t: number) => dolphinUpright(v, 0, t);
    expect(up(1)).toBe(0);                 // at its first mark, no gesture
    expect(up(4.5)).toBe(0);               // travelling
    expect(up(7.5)).toBeGreaterThan(0.99); // talking
    expect(up(10)).toBeGreaterThan(0.99);  // nodding
    expect(up(12)).toBeGreaterThan(0.99);  // listening to b, where it stands: still up
    expect(up(14)).toBeGreaterThan(0.99);  // its bow
    expect(up(16.5)).toBeLessThan(0.01);   // walking off
    // Once up, it stays up while it stays put — after a short heckle too, until its next move.
    const w = parseVignette('3s: a =left | 2s: a talk | 3s: b talk | 3s: a >right', OPEN_MARKS);
    expect(dolphinUpright(w, 0, 6)).toBeGreaterThan(0.99);
    expect(dolphinUpright(w, 0, 7.0)).toBeGreaterThan(0.99); // it lies down over the 0.7 s before it moves off
    expect(up(18)).toBe(0);                // a flip is a dolphin thing
    // Eased: no step anywhere.
    for (let t = 0; t < v.duration; t += 0.02) expect(Math.abs(up(t + 0.02) - up(t)), `t ${t}`).toBeLessThan(0.05);
    expect(DOLPHIN_CHARACTER.has('hop')).toBe(false);
  });

  it('standing, it tips its head toward its chest: its nose drops toward its belly', async () => {
    const b = Buffer.from((await BUNDLED_BREEDS.dolphin!()).default, 'base64');
    const g = await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
    const rig = rigDolphin(g.scene, g.animations)!;
    const noseY = (upright: number): number => {
      dolphinFrame(rig, 30, 0, 0, { pace: 0, flurry: 0, actor: true, upright });
      g.scene.updateMatrixWorld(true);
      let best = -Infinity, y = 0;
      const v3 = new Vector3();
      g.scene.traverse((o) => {
        const m = o as SkinnedMesh;
        if (!m.isSkinnedMesh) return;
        const p = m.geometry.getAttribute('position');
        for (let i = 0; i < p.count; i++) { m.getVertexPosition(i, v3).applyMatrix4(m.matrixWorld); if (v3.z > best) { best = v3.z; y = v3.y; } }
      });
      return y;
    };
    // In its own frame the belly is down: the nose sits lower standing than not (before the tank pitches it up).
    // The head's belly-ward sign is VENTRAL[0], which a hard turn's curl shares.
    expect(noseY(1)).toBeLessThan(noseY(0) - UPRIGHT.nod * 3);
  });
});

describe('dolphin: standing curled, not a post', () => {
  it('standing, its tail curls toward its belly — more while it talks, and it breathes', async () => {
    const b = Buffer.from((await BUNDLED_BREEDS.dolphin!()).default, 'base64');
    const g = await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
    const rig = rigDolphin(g.scene, g.animations)!;
    const tailY = (inp: Parameters<typeof dolphinFrame>[4], t = 30): number => {
      dolphinFrame(rig, t, 0, 0, inp);
      g.scene.updateMatrixWorld(true);
      let best = Infinity, y = 0;
      const v3 = new Vector3();
      g.scene.traverse((o) => {
        const m = o as SkinnedMesh;
        if (!m.isSkinnedMesh) return;
        const p = m.geometry.getAttribute('position');
        for (let i = 0; i < p.count; i++) { m.getVertexPosition(i, v3).applyMatrix4(m.matrixWorld); if (v3.z < best) { best = v3.z; y = v3.y; } }
      });
      return y;
    };
    const lying = tailY({ pace: 0, flurry: 0, actor: true, upright: 0 });
    const standing = tailY({ pace: 0, flurry: 0, actor: true, upright: 1 });
    // The belly is down in its own frame: a tail curled belly-ward sits lower.
    expect(standing).toBeLessThan(lying - 3);
    const talking = tailY({ pace: 0, flurry: 0, actor: true, upright: 1, gesture: { name: 'talk', at: 1.2, weight: 1 } });
    expect(talking).toBeLessThan(standing);
    // Never a fixed pose: it moves with its breath.
    const ys = [0, 1, 2, 3].map((k) => tailY({ pace: 0, flurry: 0, actor: true, upright: 1 }, 30 + k * 1.5));
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.5);
  });
});
