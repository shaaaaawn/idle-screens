import { AnimationClip, Bone, Group, NumberKeyframeTrack, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { BUNDLED_BREEDS } from './breeds';
import { bonesOf, momentSnaps, swimMotion } from './rig-snaps';
import {
  SEAHORSE_CLIPS, SEAHORSE_MOMENTS, rigSeahorse, seahorseFrame, seahorseMoment, seahorseMomentOf, seahorsePersonality, type SeahorseInput,
} from './seahorse';

const DUR: Record<string, number> = {
  swim: 2, hover: 3, burst: 1, coil: 5, twirl: 4.6, dance: 5.2, snick: 3, bow: 3.6, bob: 3.4, lookabout: 4.4, stretch: 4,
  wag: 3.6, tilt: 3.6, curl: 2, grip: 2, aim: 2, lean: 2, lookYaw: 2, lookPitch: 2,
};
const puppet = (): Group => { const g = new Group(); const b = new Bone(); b.name = 'body'; g.add(b); return g; };
const clips = (names: readonly string[] = SEAHORSE_CLIPS): AnimationClip[] =>
  names.map((n) => new AnimationClip(n, DUR[n]!, [new NumberKeyframeTrack('body.position[x]', [0, DUR[n]!], [0, 1])]));
const cruising: SeahorseInput = { pace: 1, flurry: 0, turn: 0, viewer: null };
const len = (n: string): number => DUR[n]!;
const of = (temper: string): number => [...Array(80).keys()].find((i) => seahorsePersonality(i).temper === temper)!;

describe('seahorse: the seahorse', () => {
  it('rigs only a model that carries every clip — the moments and the dials included', () => {
    expect(rigSeahorse(puppet(), clips())).not.toBeNull();
    expect(rigSeahorse(puppet(), clips(SEAHORSE_CLIPS.filter((n) => n !== 'curl')))).toBeNull();
  });

  it('swims cruising and hovers idling; bursts only when the tank makes it dart', () => {
    const r = rigSeahorse(puppet(), clips())!;
    const t = [...Array(400).keys()].map((i) => i * 0.25).find((u) => seahorseMoment(0, u, len).weight === 0)!;
    expect(seahorseFrame(r, t, 0, 0, { ...cruising, pace: 1.2 }).doing).toBe('swim');
    expect(seahorseFrame(r, t, 0, 0, { ...cruising, pace: 0.05 }).doing).toBe('hover');
    const s = seahorseFrame(r, t, 0, 0, { ...cruising, flurry: 1 });
    expect(s.doing).toBe('burst');
    expect(s.weights.swim + s.weights.hover).toBeCloseTo(0, 9);
    for (let u = 0; u < 120; u += 0.1) expect(seahorseFrame(r, u, 3, u * 5, cruising).weights.burst).toBe(0);
  });

  it('the body clips share one whole; the six dials ride bones of their own', () => {
    const r = rigSeahorse(puppet(), clips())!;
    for (let t = 0; t < 120; t += 0.07) {
      const w = seahorseFrame(r, t, 2, t * 7, { ...cruising, pace: 0.5 + 0.5 * Math.sin(t), flurry: Math.max(0, Math.sin(t * 0.3)) }).weights;
      const body = ['swim', 'hover', 'burst', ...SEAHORSE_MOMENTS].reduce((sum, n) => sum + w[n as keyof typeof w], 0);
      expect(body).toBeCloseTo(1, 9);
      expect([w.curl, w.grip, w.aim, w.lean, w.lookYaw, w.lookPitch]).toEqual([1, 1, 1, 1, 1, 1]);
    }
  });

  it('coils its tail hanging in the water, lets it out to swim, streams it in a dart — a shy one most coiled — and leans into a swim', () => {
    const r = rigSeahorse(puppet(), clips())!;
    const mean = (index: number, inp: SeahorseInput, key: 'curl' | 'lean'): number => {
      let s = 0; for (let t = 0; t < 60; t += 0.5) s += seahorseFrame(r, t, index, t, inp)[key]; return s / 120;
    };
    const i = of('dancer');
    expect(mean(i, { ...cruising, pace: 0.05 }, 'curl')).toBeGreaterThan(mean(i, cruising, 'curl') + 0.5);
    expect(mean(i, { ...cruising, flurry: 1 }, 'curl')).toBeLessThan(mean(i, cruising, 'curl'));
    expect(mean(of('shy'), cruising, 'curl')).toBeGreaterThan(mean(of('dancer'), cruising, 'curl'));
    expect(mean(i, cruising, 'lean')).toBeGreaterThan(mean(i, { ...cruising, pace: 0.05 }, 'lean') + 0.4);
    for (const flurry of [0, 9]) for (const v of [-9, 9]) {
      seahorseFrame(r, 1, 0, 0, { pace: 0, flurry, turn: v, viewer: { yaw: v, pitch: v } });
      for (const n of ['curl', 'lean', 'lookYaw', 'lookPitch'] as const) {
        expect(r.actions[n].time).toBeGreaterThanOrEqual(0);
        expect(r.actions[n].time).toBeLessThan(DUR[n]!);
      }
    }
  });

  it('turns its head to the viewer when its eyes hold theirs — a curious one most', () => {
    const r = rigSeahorse(puppet(), clips())!;
    const toward = (index: number): number => {
      let d = 0;
      for (let t = 0; t < 300; t += 0.25) {
        d += seahorseFrame(r, t, index, t, { ...cruising, viewer: { yaw: 0.45, pitch: 0 } }).look.yaw - seahorseFrame(r, t, index, t, cruising).look.yaw;
      }
      return d / 1200;
    };
    expect(toward(of('curious'))).toBeGreaterThan(0.05);
    expect(toward(of('curious'))).toBeGreaterThan(toward(of('hunter')));
  });

  it('holding on, it wraps its tail, stands, keeps to the moments that leave its tail alone, and looks at a partner', () => {
    const r = rigSeahorse(puppet(), clips())!;
    for (let t = 0; t < 200; t += 0.13) {
      const s = seahorseFrame(r, t, 5, t * 3, { ...cruising, flurry: 1, hold: { grip: 1, aim: 1, reach: 1, gaze: -0.7 } });
      expect(s.weights.burst).toBe(0);
      for (const m of ['coil', 'twirl', 'dance', 'wag'] as const) expect(s.weights[m]).toBe(0);
      expect(s.curl).toBeCloseTo(0, 12);
      expect(s.look.yaw).toBeCloseTo(-0.7, 9);
      expect(['hold', 'snick', 'bow', 'bob', 'lookabout', 'stretch', 'tilt']).toContain(s.doing);
      expect(r.actions.grip.time).toBeCloseTo(2, 3);
      expect(r.actions.aim.time).toBeCloseTo(2, 3);
    }
    // Not holding, the grip is at rest and the loop forward.
    seahorseFrame(r, 3, 5, 3, cruising);
    expect(r.actions.grip.time).toBe(0);
    expect(r.actions.aim.time).toBeCloseTo(1, 9);
  });

  it('every seahorse its own character: tempers, favourites and tempos spread across the 40', () => {
    const cast = [...Array(40).keys()].map(seahorsePersonality);
    const n = new Map<string, number>();
    for (const p of cast) n.set(p.temper, (n.get(p.temper) ?? 0) + 1);
    for (const t of ['dancer', 'hunter', 'shy', 'curious']) expect(n.get(t), t).toBeGreaterThanOrEqual(4);
    expect(new Set(cast.map((p) => p.favourite)).size).toBeGreaterThanOrEqual(8);
    expect(Math.max(...cast.map((p) => p.tempo)) - Math.min(...cast.map((p) => p.tempo))).toBeGreaterThan(0.25);
    const acts = (index: number): string => [...Array(240).keys()].map((i) => seahorseMoment(index, i * 0.5, len).moment ?? '-').join(',');
    expect(new Set([0, 1, 2, 3, 4, 5].map(acts)).size).toBe(6);
  });

  it('acts from its own repertoire: a dancer twirls and dances, a hunter snicks, a shy one coils', () => {
    const moves = (temper: string): Set<string> => {
      const out = new Set<string>();
      for (let i = 0; i < 80; i++) if (seahorsePersonality(i).temper === temper) for (let k = 0; k < 30; k++) out.add(seahorseMomentOf(i, k));
      return out;
    };
    expect([...moves('dancer')]).toEqual(expect.arrayContaining(['twirl', 'dance', 'bob', 'wag']));
    expect([...moves('hunter')]).toEqual(expect.arrayContaining(['snick', 'lookabout']));
    expect([...moves('shy')]).toEqual(expect.arrayContaining(['coil', 'bow']));
    for (const t of ['hunter', 'shy', 'curious']) expect([...moves(t)]).not.toContain('twirl');
  });

  it('is pure in (index, t), and its fin beats on time as well as distance', () => {
    const a = rigSeahorse(puppet(), clips())!, b = rigSeahorse(puppet(), clips())!;
    for (const t of [0.4, 8.1, 21.7]) {
      const sa = seahorseFrame(a, t, 4, 88.8, cruising);
      seahorseFrame(a, t + 3, 4, 200, cruising);
      expect(seahorseFrame(a, t, 4, 88.8, cruising)).toEqual(sa);
      expect(seahorseFrame(b, t, 4, 88.8, cruising)).toEqual(sa);
    }
    seahorseFrame(a, 10, 0, 50, cruising);
    const t0 = a.actions.swim.time;
    seahorseFrame(a, 10.4, 0, 50, cruising);
    expect((a.actions.swim.time - t0 + DUR.swim!) % DUR.swim!).toBeCloseTo(0.4 * seahorsePersonality(0).tempo, 9);
  });
});

describe('seahorse: the real rig', () => {
  const load = async (): Promise<{ scene: Object3D; animations: AnimationClip[] }> => {
    const b = Buffer.from((await BUNDLED_BREEDS.seahorse!()).default, 'base64');
    return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
  };

  it('carries the bones: trunk, neck, head and snout, a three-bone fin, a six-bone tail with a curl above each', async () => {
    const gltf = await load();
    expect(rigSeahorse(gltf.scene, gltf.animations)).not.toBeNull();
    expect(bonesOf(gltf.scene).map((o) => o.name)).toEqual(expect.arrayContaining(
      ['trunk', 'neck', 'head', 'snout', 'fin1', 'fin2', 'fin3', 't1', 't2', 't3', 't4', 't5', 't6', 'c1', 'c6', 'roll', 'lean', 'lookY', 'lookP', 'a4', 'g4', 'g5', 'g6']));
  });

  it('grips: the tail\'s last bones wrap a loop round its grasp, to whichever side the aim says', async () => {
    const gltf = await load();
    const rig = rigSeahorse(gltf.scene, gltf.animations)!;
    expect(rig.grasp?.name).toBe('grasp');
    const at = (name: string) => { const v = new Vector3(); gltf.scene.getObjectByName(name)!.getWorldPosition(v); return v; };
    const pose = (grip: number, aim: number) => {
      seahorseFrame(rig, 40, 6, 0, { pace: 0, flurry: 0, turn: 0, viewer: null, hold: { grip, aim, reach: 1 } });
      gltf.scene.updateMatrixWorld(true);
    };
    for (const aim of [1, -1]) {
      pose(1, aim);
      const g = at('grasp'), t3 = at('t3');
      // Its left is +x; the grasp beside the straight tail, below where it hangs from.
      expect(Math.sign(g.x - t3.x)).toBe(aim);
      expect(g.y).toBeLessThan(t3.y);
      // t4, t5, t6 each start on the loop, a tail's-centreline radius from the grasp, about its upright.
      for (const b of ['t4', 't5', 't6']) {
        const p = at(b);
        expect(Math.hypot(p.x - g.x, p.z - g.z), b).toBeGreaterThan(3.2);
        expect(Math.hypot(p.x - g.x, p.z - g.z), b).toBeLessThan(4.4);
        expect(Math.abs(p.y - g.y), b).toBeLessThan(2.5);
      }
    }
    // At rest the grasp is nowhere near a loop round it.
    pose(0, 0);
    expect(Math.hypot(at('t6').x - at('grasp').x, at('t6').z - at('grasp').z)).toBeGreaterThan(4.4);
  });

  it('plays every moment alone without a snap', async () => {
    const gltf = await load();
    expect(momentSnaps(gltf.scene, rigSeahorse(gltf.scene, gltf.animations)!, SEAHORSE_MOMENTS)).toEqual([]);
  });

  it('moves fluidly through a minute — one seahorse of each temperament', async () => {
    const gltf = await load();
    const rig = rigSeahorse(gltf.scene, gltf.animations)!;
    const cast = (['dancer', 'hunter', 'shy', 'curious'] as const).map(of);
    const m = swimMotion(gltf.scene, cast, (t, fish, beat, inp) => { seahorseFrame(rig, t, fish, beat, inp); });
    expect(m.p99).toBeLessThan(0.1);
    expect(m.worstAcc, m.worstAt).toBeLessThan(0.03);
    expect(m.worstStep).toBeLessThan(0.35);
  });
});
