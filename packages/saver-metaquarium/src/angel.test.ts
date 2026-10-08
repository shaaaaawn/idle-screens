import { AnimationClip, Bone, Group, NumberKeyframeTrack, Quaternion, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { ANGEL_CLIPS, ANGEL_MOMENTS, angelFrame, angelMoment, angelMomentOf, angelPersonality, rigAngel, type AngelInput } from './angel';
import { BUNDLED_BREEDS } from './breeds';

const DUR: Record<string, number> = {
  swim: 1.6, hover: 3.2, burst: 0.9, display: 3, nibble: 2.4, curious: 3, kiss: 2, soar: 4, pirouette: 2.4,
  bow: 2.6, flutter: 1.6, sway: 4, stretch: 2.6, bend: 2, lookYaw: 2, lookPitch: 2,
};
const puppet = (): Group => { const g = new Group(); const b = new Bone(); b.name = 'body'; g.add(b); return g; };
const clips = (names: readonly string[] = ANGEL_CLIPS): AnimationClip[] =>
  names.map((n) => new AnimationClip(n, DUR[n]!, [new NumberKeyframeTrack('body.position[x]', [0, DUR[n]!], [0, 1])]));
const cruising: AngelInput = { pace: 1, flurry: 0, turn: 0, viewer: null };

describe('angelfish: the angel', () => {
  it('rigs only a model that carries every clip — the moments and the dials included', () => {
    expect(rigAngel(puppet(), clips())).not.toBeNull();
    expect(rigAngel(puppet(), clips(ANGEL_CLIPS.filter((n) => n !== 'lookYaw')))).toBeNull();
  });

  it('swims cruising and hovers idling, crossfaded by pace; bursts only when the tank makes it dart', () => {
    const r = rigAngel(puppet(), clips())!;
    const quiet = (t: number): boolean => angelMoment(0, t, (n) => DUR[n]!).weight === 0;
    const t = [...Array(400).keys()].map((i) => i * 0.25).find(quiet)!;
    expect(angelFrame(r, t, 0, 0, { ...cruising, pace: 1.2 }).doing).toBe('swim');
    expect(angelFrame(r, t, 0, 0, { ...cruising, pace: 0.05 }).doing).toBe('hover');
    const s = angelFrame(r, t, 0, 0, { ...cruising, flurry: 1 });
    expect(s.doing).toBe('burst');
    expect(s.weights.swim + s.weights.hover).toBeCloseTo(0, 9);
    for (let u = 0; u < 120; u += 0.1) expect(angelFrame(r, u, 3, u * 5, cruising).weights.burst).toBe(0);
  });

  it('the body clips share one whole; the three dials ride bones of their own', () => {
    const r = rigAngel(puppet(), clips())!;
    for (let t = 0; t < 120; t += 0.07) {
      const w = angelFrame(r, t, 2, t * 7, { ...cruising, pace: 0.5 + 0.5 * Math.sin(t), flurry: Math.max(0, Math.sin(t * 0.3)) }).weights;
      const body = ['swim', 'hover', 'burst', ...ANGEL_MOMENTS].reduce((sum, n) => sum + w[n as keyof typeof w], 0);
      expect(body).toBeCloseTo(1, 9);
      expect([w.bend, w.lookYaw, w.lookPitch]).toEqual([1, 1, 1]);
    }
  });

  it('bends into a turn — to its left for +, its right for − — and no dial ever wraps', () => {
    const r = rigAngel(puppet(), clips())!;
    expect(angelFrame(r, 1, 0, 0, { ...cruising, turn: 0 }).bend).toBe(0);
    expect(angelFrame(r, 1, 0, 0, { ...cruising, turn: 0.6 }).bend).toBeGreaterThan(0.2);
    expect(angelFrame(r, 1, 0, 0, { ...cruising, turn: -0.6 }).bend).toBeLessThan(-0.2);
    for (const turn of [-5, -1, 1, 5]) for (const yaw of [-9, 9]) {
      angelFrame(r, 1, 0, 0, { ...cruising, turn, viewer: { yaw, pitch: yaw } });
      for (const n of ['bend', 'lookYaw', 'lookPitch'] as const) {
        expect(r.actions[n].time).toBeGreaterThanOrEqual(0);
        expect(r.actions[n].time).toBeLessThan(DUR[n]!);
      }
    }
  });

  it('turns its head to the viewer when its eyes hold theirs — and only a curious fish often', () => {
    const r = rigAngel(puppet(), clips())!;
    const towards = (index: number): number => {
      let n = 0, to = 0;
      for (let t = 0; t < 300; t += 0.25) {
        const s = angelFrame(r, t, index, t * 10, { ...cruising, viewer: { yaw: 0.45, pitch: 0 } });
        n++; if (s.look.yaw > 0.7) to++;
      }
      return to / n;
    };
    const curious = [...Array(60).keys()].find((i) => angelPersonality(i).temper === 'curious')!;
    const graceful = [...Array(60).keys()].find((i) => angelPersonality(i).temper === 'graceful')!;
    expect(towards(curious)).toBeGreaterThan(0.05);
    expect(towards(curious)).toBeGreaterThan(towards(graceful));
    // No viewer, no turning to one: the head only wanders and leads the turns.
    const s = angelFrame(r, 50, curious, 500, { ...cruising, viewer: null });
    expect(Math.abs(s.look.yaw)).toBeLessThan(0.7);
  });

  it('every fish its own creature: tempers, favourites and tempos spread across a school', () => {
    const cast = [...Array(200).keys()].map(angelPersonality);
    const tempers = new Map<string, number>();
    for (const p of cast) tempers.set(p.temper, (tempers.get(p.temper) ?? 0) + 1);
    for (const t of ['graceful', 'playful', 'curious']) expect(tempers.get(t)! / 200).toBeGreaterThan(0.2);
    expect(new Set(cast.map((p) => p.favourite)).size).toBeGreaterThanOrEqual(8);
    expect(Math.max(...cast.map((p) => p.tempo)) - Math.min(...cast.map((p) => p.tempo))).toBeGreaterThan(0.35);
    // Two fish side by side over two minutes act differently.
    const acts = (index: number): string => [...Array(240).keys()].map((i) => angelMoment(index, i * 0.5, (n) => DUR[n]!).moment ?? '-').join(',');
    const seen = new Set([0, 1, 2, 3, 4, 5].map(acts));
    expect(seen.size).toBe(6);
  });

  it('acts from its own repertoire: a playful fish pirouettes and flutters, a graceful one soars and bows', () => {
    const of = (temper: string): Set<string> => {
      const out = new Set<string>();
      for (let i = 0; i < 60; i++) if (angelPersonality(i).temper === temper) for (let k = 0; k < 30; k++) out.add(angelMomentOf(i, k));
      return out;
    };
    expect([...of('playful')]).toEqual(expect.arrayContaining(['pirouette', 'flutter', 'kiss']));
    expect([...of('playful')]).not.toContain('soar');
    expect([...of('graceful')]).toEqual(expect.arrayContaining(['soar', 'bow', 'stretch']));
    expect([...of('graceful')]).not.toContain('pirouette');
    expect([...of('curious')]).toEqual(expect.arrayContaining(['curious', 'nibble']));
  });

  it('is pure in (index, t), and the stroke runs on time as well as distance — it beats while it holds station', () => {
    const a = rigAngel(puppet(), clips())!, b = rigAngel(puppet(), clips())!;
    for (const t of [0.4, 8.1, 21.7]) {
      const sa = angelFrame(a, t, 4, 88.8, cruising);
      angelFrame(a, t + 3, 4, 200, cruising);
      expect(angelFrame(a, t, 4, 88.8, cruising)).toEqual(sa);
      expect(angelFrame(b, t, 4, 88.8, cruising)).toEqual(sa);
    }
    const tempo = angelPersonality(0).tempo;
    const quiet = [...Array(400).keys()].map((i) => i * 0.1).find((t) => angelMoment(0, t, (n) => DUR[n]!).weight === 0 && angelMoment(0, t + 0.4, (n) => DUR[n]!).weight === 0)!;
    angelFrame(a, quiet, 0, 50, cruising);
    const t0 = a.actions.swim.time;
    angelFrame(a, quiet + 0.4, 0, 50, cruising); // no distance swum, yet the stroke moved on
    expect((a.actions.swim.time - t0 + DUR.swim!) % DUR.swim!).toBeCloseTo(0.4 * tempo, 9);
  });
});

describe('angelfish: the real rig, swum for a minute', () => {
  const load = async (): Promise<{ scene: Object3D; animations: AnimationClip[] }> => {
    const b = Buffer.from((await BUNDLED_BREEDS.angelfish!()).default, 'base64');
    return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
  };

  it('plays every moment alone without a snap: no gesture moves faster than the eye can follow', async () => {
    const gltf = await load();
    const rig = rigAngel(gltf.scene, gltf.animations)!;
    const bones: Object3D[] = [];
    gltf.scene.traverse((o) => { if ((o as Bone).isBone) bones.push(o); });
    const q = new Quaternion(), v1 = new Quaternion(), v2 = new Quaternion();
    const snaps: string[] = [];
    for (const m of ANGEL_MOMENTS) {
      const q1 = bones.map(() => new Quaternion()), q2 = bones.map(() => new Quaternion());
      let worst = 0, at = '';
      for (const n of ANGEL_CLIPS) rig.actions[n].setEffectiveWeight(n === m ? 1 : 0);
      const frames = Math.floor(rig.durations[m] * 30);
      for (let i = 0; i <= frames; i++) {
        rig.actions[m].time = Math.min(i / 30, rig.durations[m] - 1e-4);
        rig.mixer.update(0);
        gltf.scene.updateMatrixWorld(true);
        bones.forEach((bone, k) => {
          bone.getWorldQuaternion(q);
          if (i > 1) {
            v1.copy(q).multiply(q1[k]!.clone().invert());
            v2.copy(q1[k]!).multiply(q2[k]!.clone().invert());
            const acc = v1.angleTo(v2);
            if (acc > worst) { worst = acc; at = `${m}: ${bone.name} at ${(i / 30).toFixed(2)} s`; }
          }
          q2[k]!.copy(q1[k]!);
          q1[k]!.copy(q);
        });
      }
      if (worst >= 0.03) snaps.push(`${at} (${worst.toFixed(3)})`);
    }
    expect(snaps).toEqual([]);
  });

  it('moves fluidly: a steady swim never ticks or snaps, and a dart never jumps', async () => {
    const gltf = await load();
    const rig = rigAngel(gltf.scene, gltf.animations)!;
    expect(rig).not.toBeNull();
    const bones: Object3D[] = [];
    gltf.scene.traverse((o) => { if ((o as Bone).isBone) bones.push(o); });
    expect(bones.map((o) => o.name)).toEqual(expect.arrayContaining(['snout', 'head', 'body', 'tail', 'd1', 'd3', 'a1', 'a3']));
    const q1 = bones.map(() => new Quaternion()), q2 = bones.map(() => new Quaternion());
    const q = new Quaternion(), v1 = new Quaternion(), v2 = new Quaternion();
    let worstStep = 0, worstAcc = 0, worstAt = '';
    const steady: number[] = [];
    // A fish of each temperament, and one whose favourite is the quickest move (flutter).
    const cast = (['graceful', 'playful', 'curious'] as const).map((tp) => [...Array(60).keys()].find((n) => angelPersonality(n).temper === tp)!);
    for (const fish of [...cast, 6]) {
      let beat = 0;
      for (let i = 0; i <= 60 * 30; i++) {
        const t = i / 30;
        // Idle to cruising and back, a dart now and then, weaving turns.
        const pace = 0.6 + 0.6 * Math.sin(t * 0.21);
        const flurry = Math.max(0, Math.sin(t * 0.37) - 0.85) * 6;
        const turn = 0.25 * Math.sin(t * 0.5) + 0.1 * Math.sin(t * 1.3);
        beat += (pace * 12) / 30;
        angelFrame(rig, t, fish, beat, { pace, flurry, turn, viewer: { yaw: 0.4 * Math.sin(t * 0.2), pitch: 0.1 } });
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
              if (acc > worstAcc) { worstAcc = acc; worstAt = `fish ${fish}: ${bone.name} at ${t.toFixed(2)} s`; }
            }
          }
          q2[k]!.copy(q1[k]!);
          q1[k]!.copy(q);
        });
      }
    }
    steady.sort((x, y) => x - y);
    // Swimming, hovering, turning and acting (a pirouette spins the whole fish
    // ~0.13 rad a frame at its fastest, on purpose), the p99 stays under 0.1;
    // what a snap would show is a spike in the CHANGE of turning, below.
    expect(steady[Math.floor(steady.length * 0.99)]!).toBeLessThan(0.1);
    expect(worstAcc, worstAt).toBeLessThan(0.03);
    // Mid-dart the caudal fin strokes fast, but never a whole swing at once.
    expect(worstStep).toBeLessThan(0.35);
  });
});
