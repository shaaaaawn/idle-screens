import { AnimationClip, Bone, Group, NumberKeyframeTrack, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { BUNDLED_BREEDS } from './breeds';
import { bonesOf, momentSnaps, swimMotion } from './rig-snaps';
import {
  TURTLE_CLIPS, TURTLE_MOMENTS, rigTurtle, turtleFrame, turtleGlide, turtleMoment, turtleMomentOf, turtlePersonality, type TurtleInput,
} from './turtle';

const DUR: Record<string, number> = {
  swim: 2.4, glide: 5, paddle: 2, burst: 1.3, breathe: 4.4, lookback: 4, barrel: 4.4, somersault: 5, wave: 3.6, wipe: 4.2,
  stretch: 4.4, tuck: 5, nod: 2.8, flap: 3, steer: 2, lookYaw: 2, lookPitch: 2, reach: 2,
};
const puppet = (): Group => { const g = new Group(); const b = new Bone(); b.name = 'body'; g.add(b); return g; };
const clips = (names: readonly string[] = TURTLE_CLIPS): AnimationClip[] =>
  names.map((n) => new AnimationClip(n, DUR[n]!, [new NumberKeyframeTrack('body.position[x]', [0, DUR[n]!], [0, 1])]));
const cruising: TurtleInput = { pace: 1, flurry: 0, turn: 0, viewer: null };
const len = (n: string): number => DUR[n]!;
const of = (temper: string): number => [...Array(80).keys()].find((i) => turtlePersonality(i).temper === temper)!;

describe('seaturtle: the turtle', () => {
  it('rigs only a model that carries every clip — the moments and the dials included', () => {
    expect(rigTurtle(puppet(), clips())).not.toBeNull();
    expect(rigTurtle(puppet(), clips(TURTLE_CLIPS.filter((n) => n !== 'reach')))).toBeNull();
  });

  it('flies cruising — gliding between bouts of strokes — sculls idling, and bursts only when the tank makes it dart', () => {
    const r = rigTurtle(puppet(), clips())!;
    const quiet = (t: number): boolean => turtleMoment(0, t, len).weight === 0;
    const ts = [...Array(1200).keys()].map((i) => i * 0.1).filter(quiet);
    const flying = ts.filter((t) => turtleGlide(0, t) === 0)[0]!, gliding = ts.find((t) => turtleGlide(0, t) === 1)!;
    expect(turtleFrame(r, flying, 0, 0, { ...cruising, pace: 1.2 }).doing).toBe('swim');
    expect(turtleFrame(r, gliding, 0, 0, { ...cruising, pace: 1.2 }).doing).toBe('glide');
    expect(turtleFrame(r, flying, 0, 0, { ...cruising, pace: 0.05 }).doing).toBe('paddle');
    const s = turtleFrame(r, flying, 0, 0, { ...cruising, flurry: 1 });
    expect(s.doing).toBe('burst');
    expect(s.weights.swim + s.weights.glide + s.weights.paddle).toBeCloseTo(0, 9);
    for (let u = 0; u < 120; u += 0.1) expect(turtleFrame(r, u, 3, u * 5, cruising).weights.burst).toBe(0);
  });

  it('a voyager glides most; every turtle glides some of its cruise', () => {
    const share = (i: number): number => { let g = 0; for (let t = 0; t < 120; t += 0.1) g += turtleGlide(i, t); return g / 1200; };
    expect(share(of('voyager'))).toBeGreaterThan(share(of('playful')));
    for (let i = 0; i < 16; i++) expect(share(i)).toBeGreaterThan(0.12);
  });

  it('the body clips share one whole; the four dials ride bones of their own', () => {
    const r = rigTurtle(puppet(), clips())!;
    for (let t = 0; t < 120; t += 0.07) {
      const w = turtleFrame(r, t, 2, t * 7, { ...cruising, pace: 0.5 + 0.5 * Math.sin(t), flurry: Math.max(0, Math.sin(t * 0.3)) }).weights;
      const body = ['swim', 'glide', 'paddle', 'burst', ...TURTLE_MOMENTS].reduce((sum, n) => sum + w[n as keyof typeof w], 0);
      expect(body).toBeCloseTo(1, 9);
      expect([w.steer, w.lookYaw, w.lookPitch, w.reach]).toEqual([1, 1, 1, 1]);
    }
  });

  it('steers into a turn — to its left for +, its right for − — and no dial ever wraps', () => {
    const r = rigTurtle(puppet(), clips())!;
    expect(turtleFrame(r, 1, 0, 0, { ...cruising, turn: 0 }).steer).toBe(0);
    expect(turtleFrame(r, 1, 0, 0, { ...cruising, turn: 0.1 }).steer).toBeGreaterThan(0.2);
    expect(turtleFrame(r, 1, 0, 0, { ...cruising, turn: -0.1 }).steer).toBeLessThan(-0.2);
    for (const turn of [-5, 5]) for (const v of [-9, 9]) for (const flurry of [0, 9]) {
      turtleFrame(r, 1, 0, 0, { ...cruising, turn, flurry, viewer: { yaw: v, pitch: v } });
      for (const n of ['steer', 'lookYaw', 'lookPitch', 'reach'] as const) {
        expect(r.actions[n].time).toBeGreaterThanOrEqual(0);
        expect(r.actions[n].time).toBeLessThan(DUR[n]!);
      }
    }
  });

  it('meets the viewer by its nature: a curious turtle stretches toward them, a shy one draws its head in', () => {
    const r = rigTurtle(puppet(), clips())!;
    // How far its neck reaches and turns toward a viewer, against no viewer at all.
    const meet = (index: number): { yaw: number; reach: number } => {
      let yaw = 0, reach = 0, n = 0;
      for (let t = 0; t < 300; t += 0.25) {
        const s = turtleFrame(r, t, index, t * 10, { ...cruising, viewer: { yaw: 0.45, pitch: 0 } }).look;
        const o = turtleFrame(r, t, index, t * 10, cruising).look;
        yaw += s.yaw - o.yaw; reach += s.reach - o.reach; n++;
      }
      return { yaw: yaw / n, reach: reach / n };
    };
    const curious = meet(of('curious')), shy = meet(of('shy')), voyager = meet(of('voyager'));
    expect(curious.yaw).toBeGreaterThan(0.05);
    expect(curious.yaw).toBeGreaterThan(voyager.yaw);
    expect(curious.reach).toBeGreaterThan(0.03);
    expect(shy.reach).toBeLessThan(-0.02);
    expect(Math.abs(voyager.reach)).toBeLessThan(0.01);
  });

  it('every turtle its own character: tempers, favourites and tempos spread across the 16', () => {
    const cast = [...Array(16).keys()].map(turtlePersonality);
    expect(new Set(cast.map((p) => p.temper)).size).toBe(4);
    expect(new Set(cast.map((p) => p.favourite)).size).toBeGreaterThanOrEqual(6);
    expect(Math.max(...cast.map((p) => p.tempo)) - Math.min(...cast.map((p) => p.tempo))).toBeGreaterThan(0.2);
    const acts = (index: number): string => [...Array(240).keys()].map((i) => turtleMoment(index, i * 0.5, len).moment ?? '-').join(',');
    expect(new Set([0, 1, 2, 3, 4, 5].map(acts)).size).toBe(6);
  });

  it('acts from its own repertoire: a playful turtle rolls and flips, a shy one tucks, none somersaults but the playful', () => {
    const moves = (temper: string): Set<string> => {
      const out = new Set<string>();
      for (let i = 0; i < 80; i++) if (turtlePersonality(i).temper === temper) for (let k = 0; k < 30; k++) out.add(turtleMomentOf(i, k));
      return out;
    };
    expect([...moves('playful')]).toEqual(expect.arrayContaining(['barrel', 'somersault', 'flap', 'wave']));
    expect([...moves('shy')]).toEqual(expect.arrayContaining(['tuck', 'wipe']));
    expect([...moves('voyager')]).toEqual(expect.arrayContaining(['breathe', 'stretch', 'lookback']));
    for (const t of ['voyager', 'shy', 'curious']) expect([...moves(t)]).not.toContain('somersault');
  });

  it('is pure in (index, t), and the stroke runs on time as well as distance — it beats while it holds station', () => {
    const a = rigTurtle(puppet(), clips())!, b = rigTurtle(puppet(), clips())!;
    for (const t of [0.4, 8.1, 21.7]) {
      const sa = turtleFrame(a, t, 4, 88.8, cruising);
      turtleFrame(a, t + 3, 4, 200, cruising);
      expect(turtleFrame(a, t, 4, 88.8, cruising)).toEqual(sa);
      expect(turtleFrame(b, t, 4, 88.8, cruising)).toEqual(sa);
    }
    const tempo = turtlePersonality(0).tempo;
    turtleFrame(a, 10, 0, 50, cruising);
    const t0 = a.actions.swim.time;
    turtleFrame(a, 10.4, 0, 50, cruising);
    expect((a.actions.swim.time - t0 + DUR.swim!) % DUR.swim!).toBeCloseTo(0.4 * 0.8 * tempo, 9);
  });
});

describe('seaturtle: the real rig', () => {
  const load = async (): Promise<{ scene: Object3D; animations: AnimationClip[] }> => {
    const b = Buffer.from((await BUNDLED_BREEDS.seaturtle!()).default, 'base64');
    return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
  };

  it('carries the bones: a neck, a three-bone chain in each fore-flipper, the hind flippers, the tail', async () => {
    const gltf = await load();
    expect(rigTurtle(gltf.scene, gltf.animations)).not.toBeNull();
    expect(bonesOf(gltf.scene).map((o) => o.name)).toEqual(expect.arrayContaining(['shell', 'neck', 'head', 'fR1', 'fR2', 'fR3', 'fL1', 'fL2', 'fL3', 'rR', 'rL', 'tail']));
    // The dials' and the whole-body moments' own bones: nodes above the skin's.
    for (const n of ['bank', 'lookY', 'lookP', 'withdraw', 'reach', 'steerR', 'steerL']) expect(gltf.scene.getObjectByName(n), n).toBeDefined();
  });

  it('plays every moment alone without a snap', async () => {
    const gltf = await load();
    expect(momentSnaps(gltf.scene, rigTurtle(gltf.scene, gltf.animations)!, TURTLE_MOMENTS)).toEqual([]);
  });

  it('moves fluidly through a minute — one turtle of each temperament: never a tick or a snap, and a dart never jumps', async () => {
    const gltf = await load();
    const rig = rigTurtle(gltf.scene, gltf.animations)!;
    const cast = (['voyager', 'playful', 'shy', 'curious'] as const).map(of);
    const m = swimMotion(gltf.scene, cast, (t, fish, beat, inp) => { turtleFrame(rig, t, fish, beat, inp); });
    // A barrel roll or a somersault turns the whole turtle ~0.07 rad a frame at its fastest, on purpose.
    expect(m.p99).toBeLessThan(0.1);
    expect(m.worstAcc, m.worstAt).toBeLessThan(0.03);
    expect(m.worstStep).toBeLessThan(0.35);
  });
});
