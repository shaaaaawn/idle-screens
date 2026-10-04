import { AnimationClip, Bone, Group, NumberKeyframeTrack, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { rigTang, TANG_CLIPS, tangCycle, tangFrame, tangLook, tangMoment, tangMomentAt, type TangClip, type TangRig, type TangState } from './tang';

const DUR: Record<string, number> = { fly: 0.4, hover: 0.8, back: 0.36, burst: 0.3, pick: 1.0, flare: 2.6, headstand: 3.0, flop: 3.0 };
/** A dori's skeleton as three loads it: the head at the origin, the eyes either side of the face, a pupil on each (model axes: +z ahead, +x its left). */
function puppet(): Group {
  const g = new Group();
  const bone = (name: string, parent: Bone | Group, x: number, y: number, z: number): Bone => { const b = new Bone(); b.name = name; b.position.set(x, y, z); parent.add(b); return b; };
  const body = bone('body', g, 0, 0, 0);
  const head = bone('head', body, 0, 0, 8.91);
  const eyeL = bone('eyeL', head, 4, 0, 5), eyeR = bone('eyeR', head, -4, 0, 5);
  bone('pupilL', eyeL, 1, 1, 3); bone('pupilR', eyeR, 1, 1, 3);
  return g;
}
const clips = (names: readonly string[] = TANG_CLIPS): AnimationClip[] =>
  names.map((n) => new AnimationClip(n, DUR[n]!, [new NumberKeyframeTrack('body.position[x]', [0, DUR[n]!], [0, 1])]));
const rigged = (): { g: Group; rig: TangRig } => { const g = puppet(); return { g, rig: rigTang(g, clips())! }; };
const w = (rig: TangRig, n: TangClip): number => rig.actions[n].getEffectiveWeight();
/** Where an eye's box points, in the model's axes. */
const ahead = (rig: TangRig, side: 1 | -1): Vector3 => new Vector3(0, 0, 1).applyQuaternion(rig.eyes.find((e) => e.side === side)!.eye.quaternion);
const swimming: TangState = { doing: 'swim', moment: null, weight: 0, into: 0 };

describe('the dori (tang.ts)', () => {
  it('rigs only a model with all its clips, and finds its eyes and pupils', () => {
    expect(rigTang(puppet(), clips(['fly', 'hover']))).toBeNull();
    const { rig } = rigged();
    expect(rig.eyes.map((e) => [e.side, e.eye.name, e.pupil.name])).toEqual([[1, 'eyeL', 'pupilL'], [-1, 'eyeR', 'pupilR']]);
    expect(rig.eyes[0]!.centre.toArray()).toEqual([4, 0, 13.91]);
  });

  it('flies on its fins: the body\'s weight is always one whole, cruising when it has pace, hovering when it has none, the tail only when it darts', () => {
    const { rig } = rigged();
    for (let t = 0; t < 80; t += 0.17) {
      for (const [pace, flurry] of [[0, 0], [1, 0], [0.4, 0.5], [1, 1]]) {
        tangFrame(rig, t, 3, t * 9, { pace: pace!, flurry: flurry! });
        expect(TANG_CLIPS.reduce((s, n) => s + w(rig, n), 0)).toBeCloseTo(1, 9);
      }
    }
    const at = (pace: number, flurry: number): TangRig => { const r = rigged().rig; tangFrame(r, 0.2, 3, 0, { pace, flurry }); return r; };
    expect(w(at(1, 0), 'fly')).toBeGreaterThan(0.9);
    expect(w(at(0, 0), 'hover')).toBeGreaterThan(0.9);
    expect(w(at(1, 0), 'burst')).toBe(0);
    expect(w(at(1, 0.8), 'burst')).toBeGreaterThan(0.9);
  });

  it('beats its fins while it holds station — the stroke runs on time as well as distance', () => {
    const { rig } = rigged();
    tangFrame(rig, 0.2, 3, 50, { pace: 0, flurry: 0 });
    const a = rig.actions.hover.time;
    tangFrame(rig, 0.5, 3, 50, { pace: 0, flurry: 0 });
    expect(rig.actions.hover.time).not.toBeCloseTo(a, 3);
  });

  it('has a moment a cycle, playing dead the rarest, each fitting its cycle', () => {
    const seen: Record<string, number> = {};
    for (let i = 0; i < 20; i++) for (let k = 0; k < 50; k++) { const m = tangMomentAt(i, k); seen[m] = (seen[m] ?? 0) + 1; }
    expect(Object.keys(seen).sort()).toEqual(['flare', 'flop', 'headstand', 'pick', 'wary']);
    expect(seen.flop! / 1000).toBeLessThan(0.12);
    for (let i = 0; i < 40; i++) { const c = tangCycle(i); expect(c.at + 3).toBeLessThanOrEqual(c.period); }
  });

  it('turns its eyes to the viewer: the box swivels toward them and the pupil slides their way', () => {
    const { g, rig } = rigged();
    g.updateMatrixWorld(true);
    // Find a time it is looking at the viewer, out to its left and ahead.
    const viewer = new Vector3(60, 5, 40);
    let found = false;
    for (let t = 0; t < 30 && !found; t += 0.05) {
      const look = tangLook(rig, t, 2, { viewer, state: swimming });
      if (look.at !== 'viewer') continue;
      found = true;
      expect(ahead(rig, 1).x).toBeGreaterThan(0.3);           // the left eye's box turned to its left
      expect(look.offViewer).toBeLessThan(25);
    }
    expect(found).toBe(true);
  });

  it('looks about in saccades: quick jumps, then still', () => {
    const { g, rig } = rigged();
    g.updateMatrixWorld(true);
    const yaw = (t: number): number => { tangLook(rig, t, 5, { viewer: null, state: swimming }); return ahead(rig, 1).x; };
    let still = 0, n = 0;
    for (let t = 1; t < 40; t += 0.05) { if (Math.abs(yaw(t + 0.05) - yaw(t)) < 1e-6) still++; n++; }
    expect(still / n).toBeGreaterThan(0.6);   // mostly holding a gaze…
    expect(still / n).toBeLessThan(0.98);     // …but it does move
  });

  it('does not look at a viewer behind it, nor through the back of its head', () => {
    const { g, rig } = rigged();
    g.updateMatrixWorld(true);
    for (let t = 0; t < 20; t += 0.1) {
      const look = tangLook(rig, t, 2, { viewer: new Vector3(0, 0, -200), state: swimming });
      expect(look.at).not.toBe('viewer');
      expect(look.offViewer).toBeNull();
    }
  });

  it('converges both eyes on the speck before it snaps up plankton', () => {
    const { g, rig } = rigged();
    g.updateMatrixWorld(true);
    let i = 0, k = 1;
    outer: for (i = 0; i < 30; i++) for (k = 1; k < 30; k++) if (tangMomentAt(i, k) === 'pick') break outer;
    const c = tangCycle(i);
    const t = k * c.period + c.at - c.offset + 0.5;
    const state = tangMoment(i, t);
    expect(state.moment).toBe('pick');
    // Both eyes on one point just ahead and below: each turns in toward the middle.
    for (let dt = 0; dt < 0.2; dt += 0.05) {
      tangLook(rig, t + dt, i, { viewer: null, state: { doing: 'pick', ...tangMoment(i, t + dt) } });
      expect(ahead(rig, 1).x).toBeLessThan(0);
      expect(ahead(rig, -1).x).toBeGreaterThan(0);
    }
  });

  it('never blinks: no clip for it, and the eyes are never squashed', () => {
    expect(TANG_CLIPS as readonly string[]).not.toContain('blink');
    const { g, rig } = rigged();
    g.updateMatrixWorld(true);
    for (let t = 0; t < 20; t += 0.3) {
      tangLook(rig, t, 1, { viewer: new Vector3(30, 0, 80), state: swimming });
      for (const e of rig.eyes) expect(e.eye.scale.toArray()).toEqual([1, 1, 1]);
    }
  });

  it('is pure in t: the same moment aims the same, whatever came before', () => {
    const a = rigged(), b = rigged();
    a.g.updateMatrixWorld(true); b.g.updateMatrixWorld(true);
    const v = new Vector3(40, 10, 60);
    for (const t of [3.3, 17.1, 29.9]) {
      tangLook(a.rig, t + 5, 4, { viewer: v, state: swimming });
      tangLook(a.rig, t, 4, { viewer: v, state: swimming });
      tangLook(b.rig, t, 4, { viewer: v, state: swimming });
      for (let e = 0; e < 2; e++) {
        expect(a.rig.eyes[e]!.eye.quaternion.toArray()).toEqual(b.rig.eyes[e]!.eye.quaternion.toArray());
        expect(a.rig.eyes[e]!.pupil.position.toArray()).toEqual(b.rig.eyes[e]!.pupil.position.toArray());
      }
    }
  });
});
