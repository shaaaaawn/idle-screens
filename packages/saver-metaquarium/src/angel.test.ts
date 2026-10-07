import { AnimationClip, Bone, Group, NumberKeyframeTrack, Quaternion, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { ANGEL_CLIPS, angelCycle, angelDisplay, angelDisplays, angelFrame, rigAngel, type AngelInput } from './angel';
import { BUNDLED_BREEDS } from './breeds';

const DUR: Record<string, number> = { swim: 1.6, hover: 4, burst: 0.9, display: 3, bend: 2 };
const puppet = (): Group => { const g = new Group(); const b = new Bone(); b.name = 'body'; g.add(b); return g; };
const clips = (names: readonly string[] = ANGEL_CLIPS): AnimationClip[] =>
  names.map((n) => new AnimationClip(n, DUR[n]!, [new NumberKeyframeTrack('body.position[x]', [0, DUR[n]!], [0, 1])]));
const cruising: AngelInput = { pace: 1, flurry: 0, turn: 0 };

describe('angelfish: the angel', () => {
  it('rigs only a model that carries all its clips, the bend dial included', () => {
    expect(rigAngel(puppet(), clips())).not.toBeNull();
    expect(rigAngel(puppet(), clips(['swim', 'hover', 'burst', 'display']))).toBeNull();
  });

  it('swims cruising and hovers idling, crossfaded by pace; bursts only when the tank makes it dart', () => {
    const r = rigAngel(puppet(), clips())!;
    const quiet = (t: number): boolean => angelDisplay(0, t).weight === 0;
    const t = [...Array(400).keys()].map((i) => i * 0.25).find(quiet)!;
    expect(angelFrame(r, t, 0, 0, { pace: 1.2, flurry: 0, turn: 0 }).doing).toBe('swim');
    expect(angelFrame(r, t, 0, 0, { pace: 0.05, flurry: 0, turn: 0 }).doing).toBe('hover');
    const s = angelFrame(r, t, 0, 0, { pace: 1, flurry: 1, turn: 0 });
    expect(s.doing).toBe('burst');
    expect(s.weights.swim + s.weights.hover).toBeCloseTo(0, 9);
    // Never a burst without a dart, whatever the time.
    for (let u = 0; u < 120; u += 0.1) expect(angelFrame(r, u, 3, u * 5, cruising).weights.burst).toBe(0);
  });

  it('the body clips share one whole; the bend dial rides on its own bones', () => {
    const r = rigAngel(puppet(), clips())!;
    for (let t = 0; t < 120; t += 0.07) {
      const w = angelFrame(r, t, 2, t * 7, { pace: 0.5 + 0.5 * Math.sin(t), flurry: Math.max(0, Math.sin(t * 0.3)), turn: 0 }).weights;
      expect(w.swim + w.hover + w.burst + w.display).toBeCloseTo(1, 9);
      expect(w.bend).toBe(1);
    }
  });

  it('bends into a turn — to its left for +, its right for − — and the dial never wraps', () => {
    const r = rigAngel(puppet(), clips())!;
    expect(angelFrame(r, 1, 0, 0, { ...cruising, turn: 0 }).bend).toBe(0);
    expect(angelFrame(r, 1, 0, 0, { ...cruising, turn: 0.1 }).bend).toBeGreaterThan(0.2);
    expect(angelFrame(r, 1, 0, 0, { ...cruising, turn: -0.1 }).bend).toBeLessThan(-0.2);
    for (const turn of [-5, -1, 1, 5]) {
      angelFrame(r, 1, 0, 0, { ...cruising, turn });
      expect(r.actions.bend.time).toBeGreaterThanOrEqual(0);
      expect(r.actions.bend.time).toBeLessThan(DUR.bend!);
    }
  });

  it('shows off rarely: a display in about a third of its long cycles', () => {
    for (let i = 0; i < 6; i++) expect(angelCycle(i).period).toBeGreaterThanOrEqual(22);
    const shows = Array.from({ length: 300 }, (_, k) => angelDisplays(4, k)).filter(Boolean).length;
    expect(shows / 300).toBeGreaterThan(0.25);
    expect(shows / 300).toBeLessThan(0.45);
  });

  it('is pure in (index, t), and the stroke runs on time as well as distance — it beats while it holds station', () => {
    const a = rigAngel(puppet(), clips())!, b = rigAngel(puppet(), clips())!;
    for (const t of [0.4, 8.1, 21.7]) {
      const sa = angelFrame(a, t, 4, 88.8, cruising);
      angelFrame(a, t + 3, 4, 200, cruising);
      expect(angelFrame(a, t, 4, 88.8, cruising)).toEqual(sa);
      expect(angelFrame(b, t, 4, 88.8, cruising)).toEqual(sa);
    }
    angelFrame(a, 1, 0, 50, cruising);
    const t0 = a.actions.swim.time;
    angelFrame(a, 1.4, 0, 50, cruising); // no distance swum, yet the stroke moved on
    expect((a.actions.swim.time - t0 + DUR.swim!) % DUR.swim!).toBeCloseTo(0.4, 9);
  });
});

describe('angelfish: the real rig, swum for a minute', () => {
  it('moves fluidly: a steady swim never ticks or snaps, and a dart never jumps', async () => {
    const b = Buffer.from((await BUNDLED_BREEDS.angelfish!()).default, 'base64');
    const gltf = await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
    const rig = rigAngel(gltf.scene, gltf.animations)!;
    expect(rig).not.toBeNull();
    const bones: Object3D[] = [];
    gltf.scene.traverse((o) => { if ((o as Bone).isBone) bones.push(o); });
    expect(bones.map((o) => o.name)).toEqual(expect.arrayContaining(['head', 's1', 'tail', 'd1', 'd3', 'a1', 'a3']));
    const q1 = bones.map(() => new Quaternion()), q2 = bones.map(() => new Quaternion());
    const q = new Quaternion(), v1 = new Quaternion(), v2 = new Quaternion();
    let beat = 0, worstStep = 0, worstAcc = 0, worstAt = '';
    const steady: number[] = [];
    for (let i = 0; i <= 60 * 30; i++) {
      const t = i / 30;
      // Idle to cruising and back, a dart now and then, weaving turns.
      const pace = 0.6 + 0.6 * Math.sin(t * 0.21);
      const flurry = Math.max(0, Math.sin(t * 0.37) - 0.85) * 6;
      const turn = 0.25 * Math.sin(t * 0.5) + 0.1 * Math.sin(t * 1.3);
      beat += (pace * 12) / 30;
      angelFrame(rig, t, 6, beat, { pace, flurry, turn });
      gltf.scene.updateMatrixWorld(true);
      bones.forEach((bone, k) => {
        bone.getWorldQuaternion(q);
        if (i > 1) {
          const step = q.angleTo(q1[k]!);
          worstStep = Math.max(worstStep, step);
          if (flurry === 0) {
            steady.push(step);
            // The change in its turning, frame to frame: a snap is a spike here.
            v1.copy(q).multiply(q1[k]!.clone().invert());
            v2.copy(q1[k]!).multiply(q2[k]!.clone().invert());
            const acc = v1.angleTo(v2);
            if (acc > worstAcc) { worstAcc = acc; worstAt = `${bone.name} at ${t.toFixed(2)} s`; }
          }
        }
        q2[k]!.copy(q1[k]!);
        q1[k]!.copy(q);
      });
    }
    steady.sort((x, y) => x - y);
    // Measured: swimming, hovering and turning, the streamers move up to ~0.05
    // rad a frame and their turning changes by at most ~0.017 — a snap (a
    // wrapped dial, a phase jump) would be a whole swing in one frame.
    expect(steady[Math.floor(steady.length * 0.99)]!).toBeLessThan(0.07);
    expect(worstAcc, worstAt).toBeLessThan(0.03);
    // Mid-dart the caudal fin strokes fast, but never a whole swing at once.
    expect(worstStep).toBeLessThan(0.35);
  });
});
