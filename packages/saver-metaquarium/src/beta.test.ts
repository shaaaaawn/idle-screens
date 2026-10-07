import { AnimationClip, Bone, Group, NumberKeyframeTrack, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { BETA_CLIPS, BETA_MOMENTS, betaFrame, betaMoment, betaMomentOf, betaPersonality, rigBeta, type BetaInput } from './beta';
import { BUNDLED_BREEDS } from './breeds';
import { bonesOf, momentSnaps, swimMotion } from './rig-snaps';

const DUR: Record<string, number> = {
  swim: 1.6, hover: 3, burst: 0.8, flare: 4.2, spin: 4.4, gulp: 3.8, shimmy: 2.6, rest: 6, dance: 5, flick: 2.4, bow: 3.6,
  billow: 4, curl: 4, bend: 2, lookYaw: 2, lookPitch: 2, spread: 2,
};
const puppet = (): Group => { const g = new Group(); const b = new Bone(); b.name = 'body'; g.add(b); return g; };
const clips = (names: readonly string[] = BETA_CLIPS): AnimationClip[] =>
  names.map((n) => new AnimationClip(n, DUR[n]!, [new NumberKeyframeTrack('body.position[x]', [0, DUR[n]!], [0, 1])]));
const cruising: BetaInput = { pace: 1, flurry: 0, turn: 0, viewer: null };
const len = (n: string): number => DUR[n]!;
const of = (temper: string): number => [...Array(80).keys()].find((i) => betaPersonality(i).temper === temper)!;

describe('betafish: the betta', () => {
  it('rigs only a model that carries every clip — the moments and the dials included', () => {
    expect(rigBeta(puppet(), clips())).not.toBeNull();
    expect(rigBeta(puppet(), clips(BETA_CLIPS.filter((n) => n !== 'spread')))).toBeNull();
  });

  it('swims cruising and hovers idling; bursts only when the tank makes it dart', () => {
    const r = rigBeta(puppet(), clips())!;
    const t = [...Array(400).keys()].map((i) => i * 0.25).find((u) => betaMoment(0, u, len).weight === 0)!;
    expect(betaFrame(r, t, 0, 0, { ...cruising, pace: 1.2 }).doing).toBe('swim');
    expect(betaFrame(r, t, 0, 0, { ...cruising, pace: 0.05 }).doing).toBe('hover');
    const s = betaFrame(r, t, 0, 0, { ...cruising, flurry: 1 });
    expect(s.doing).toBe('burst');
    expect(s.weights.swim + s.weights.hover).toBeCloseTo(0, 9);
    for (let u = 0; u < 120; u += 0.1) expect(betaFrame(r, u, 3, u * 5, cruising).weights.burst).toBe(0);
  });

  it('the body clips share one whole; the four dials ride bones of their own', () => {
    const r = rigBeta(puppet(), clips())!;
    for (let t = 0; t < 120; t += 0.07) {
      const w = betaFrame(r, t, 2, t * 7, { ...cruising, pace: 0.5 + 0.5 * Math.sin(t), flurry: Math.max(0, Math.sin(t * 0.3)) }).weights;
      const body = ['swim', 'hover', 'burst', ...BETA_MOMENTS].reduce((sum, n) => sum + w[n as keyof typeof w], 0);
      expect(body).toBeCloseTo(1, 9);
      expect([w.bend, w.lookYaw, w.lookPitch, w.spread]).toEqual([1, 1, 1, 1]);
    }
  });

  it('bends into a turn — to its left for +, its right for − — and no dial ever wraps', () => {
    const r = rigBeta(puppet(), clips())!;
    expect(betaFrame(r, 1, 0, 0, { ...cruising, turn: 0.1 }).bend).toBeGreaterThan(0.2);
    expect(betaFrame(r, 1, 0, 0, { ...cruising, turn: -0.1 }).bend).toBeLessThan(-0.2);
    for (const turn of [-5, 5]) for (const v of [-9, 9]) for (const flurry of [0, 9]) for (const pace of [0, 2]) {
      betaFrame(r, 1, 0, 0, { pace, turn, flurry, viewer: { yaw: v, pitch: v } });
      for (const n of ['bend', 'lookYaw', 'lookPitch', 'spread'] as const) {
        expect(r.actions[n].time).toBeGreaterThanOrEqual(0);
        expect(r.actions[n].time).toBeLessThan(DUR[n]!);
      }
    }
  });

  it('spreads its fins idling, lays them back to swim and dart — and a fighter throws them wide at the viewer', () => {
    const r = rigBeta(puppet(), clips())!;
    const mean = (index: number, inp: BetaInput): number => {
      let s = 0; for (let t = 0; t < 300; t += 0.25) s += betaFrame(r, t, index, t, inp).spread; return s / 1200;
    };
    const f = of('fighter'), d = of('dreamer');
    expect(mean(f, { ...cruising, pace: 0.05 })).toBeGreaterThan(mean(f, cruising) + 0.3);
    expect(mean(f, { ...cruising, flurry: 1 })).toBeLessThan(mean(f, cruising));
    const seen = { ...cruising, viewer: { yaw: 0.3, pitch: 0 } };
    expect(mean(f, seen) - mean(f, cruising)).toBeGreaterThan(0.1);
    expect(mean(f, seen) - mean(f, cruising)).toBeGreaterThan(3 * (mean(d, seen) - mean(d, cruising)));
  });

  it('turns its head to the viewer when its eyes hold theirs — a curious one most, a dreamer least', () => {
    const r = rigBeta(puppet(), clips())!;
    const toward = (index: number): number => {
      let s = 0;
      for (let t = 0; t < 300; t += 0.25) s += betaFrame(r, t, index, t, { ...cruising, viewer: { yaw: 0.35, pitch: 0 } }).look.yaw - betaFrame(r, t, index, t, cruising).look.yaw;
      return s / 1200;
    };
    expect(toward(of('curious'))).toBeGreaterThan(0.05);
    expect(toward(of('curious'))).toBeGreaterThan(toward(of('dreamer')));
  });

  it('every betta its own character: tempers, favourites and tempos spread across a school', () => {
    const cast = [...Array(256).keys()].map(betaPersonality);
    const n = new Map<string, number>();
    for (const p of cast) n.set(p.temper, (n.get(p.temper) ?? 0) + 1);
    for (const t of ['fighter', 'dreamer', 'showoff', 'curious']) expect(n.get(t)! / 256, t).toBeGreaterThan(0.15);
    expect(new Set(cast.map((p) => p.favourite)).size).toBe(10);
    expect(Math.max(...cast.map((p) => p.tempo)) - Math.min(...cast.map((p) => p.tempo))).toBeGreaterThan(0.3);
    const acts = (index: number): string => [...Array(240).keys()].map((i) => betaMoment(index, i * 0.5, len).moment ?? '-').join(',');
    expect(new Set([0, 1, 2, 3, 4, 5].map(acts)).size).toBe(6);
  });

  it('acts from its own repertoire: a fighter flares and flicks, a dreamer billows and rests', () => {
    const moves = (temper: string): Set<string> => {
      const out = new Set<string>();
      for (let i = 0; i < 80; i++) if (betaPersonality(i).temper === temper) for (let k = 0; k < 30; k++) out.add(betaMomentOf(i, k));
      return out;
    };
    expect([...moves('fighter')]).toEqual(expect.arrayContaining(['flare', 'flick', 'shimmy', 'curl']));
    expect([...moves('dreamer')]).toEqual(expect.arrayContaining(['billow', 'rest', 'gulp']));
    expect([...moves('showoff')]).toEqual(expect.arrayContaining(['dance', 'spin', 'flare']));
    expect([...moves('dreamer')]).not.toContain('flare');
  });

  it('is pure in (index, t), and the stroke runs on time as well as distance', () => {
    const a = rigBeta(puppet(), clips())!, b = rigBeta(puppet(), clips())!;
    for (const t of [0.4, 8.1, 21.7]) {
      const sa = betaFrame(a, t, 4, 88.8, cruising);
      betaFrame(a, t + 3, 4, 200, cruising);
      expect(betaFrame(a, t, 4, 88.8, cruising)).toEqual(sa);
      expect(betaFrame(b, t, 4, 88.8, cruising)).toEqual(sa);
    }
    betaFrame(a, 10, 0, 50, cruising);
    const t0 = a.actions.swim.time;
    betaFrame(a, 10.4, 0, 50, cruising);
    expect((a.actions.swim.time - t0 + DUR.swim!) % DUR.swim!).toBeCloseTo(0.4 * betaPersonality(0).tempo, 9);
  });
});

describe('betafish: the real rig', () => {
  const load = async (): Promise<{ scene: Object3D; animations: AnimationClip[] }> => {
    const b = Buffer.from((await BUNDLED_BREEDS.betafish!()).default, 'base64');
    return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
  };

  it('carries the bones: a spine, a fan of three two-bone rays, the dorsal, flank fins and gill covers', async () => {
    const gltf = await load();
    expect(rigBeta(gltf.scene, gltf.animations)).not.toBeNull();
    expect(bonesOf(gltf.scene).map((o) => o.name)).toEqual(expect.arrayContaining([
      'head', 'body', 'rear', 'ped', 'cU1', 'cU2', 'cM1', 'cM2', 'cL1', 'cL2', 'd1', 'd2',
      'pecR', 'pecL', 'ven1R', 'ven2R', 'ven1L', 'ven2L', 'gillR', 'gillL', 'roll', 'flexR', 'flexP', 'sU', 'sL', 'sD', 'gR', 'gL']));
  });

  it('plays every moment alone without a snap', async () => {
    const gltf = await load();
    expect(momentSnaps(gltf.scene, rigBeta(gltf.scene, gltf.animations)!, BETA_MOMENTS)).toEqual([]);
  });

  it('moves fluidly through a minute — one betta of each temperament', async () => {
    const gltf = await load();
    const rig = rigBeta(gltf.scene, gltf.animations)!;
    const cast = (['fighter', 'dreamer', 'showoff', 'curious'] as const).map(of);
    const m = swimMotion(gltf.scene, cast, (t, fish, beat, inp) => { betaFrame(rig, t, fish, beat, inp); });
    expect(m.p99).toBeLessThan(0.1);
    expect(m.worstAcc, m.worstAt).toBeLessThan(0.03);
    expect(m.worstStep).toBeLessThan(0.35);
  });
});
