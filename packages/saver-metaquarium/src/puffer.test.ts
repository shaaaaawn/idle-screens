import { AnimationClip, Bone, Group, NumberKeyframeTrack, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  PUFFER_CATCH, PUFFER_CLIPS, pufferAct, pufferActAt, pufferCycle, pufferFrame, pufferHold, pufferLook, pufferPuff, pufferRelease, rigPuffer,
  type PufferAct, type PufferClip, type PufferRig, type PufferState,
} from './puffer';

const DUR: Record<string, number> = {
  swim: 0.4, hover: 0.8, puff: 1.0, gulp: 0.35, zip: 1.4, spin: 1.6, flip: 1.4, kiss: 2.0, shimmy: 1.8, bounce: 1.5, spit: 1.2,
  yawn: 2.4, shy: 2.2, wave: 1.6, chomp: 0.9,
};
/** A blowfish's skeleton as three loads it (model axes: +z ahead, +x its left, +y up): eyes on the face, pupils on them. */
function puppet(): Group {
  const g = new Group();
  const bone = (name: string, parent: Bone | Group, x: number, y: number, z: number): Bone => { const b = new Bone(); b.name = name; b.position.set(x, y, z); parent.add(b); return b; };
  const body = bone('body', g, 0, 0, 2);
  const puff = bone('puff', body, 0, 0, 0);
  bone('mouth', puff, 0, -5, 8);
  const eyeL = bone('eyeL', puff, 5, 3, 9), eyeR = bone('eyeR', puff, -5, 3, 9);
  bone('pupilL', eyeL, 2, 1, 1); bone('pupilR', eyeR, 2, 1, 1);
  return g;
}
const clips = (names: readonly string[] = PUFFER_CLIPS): AnimationClip[] =>
  names.map((n) => new AnimationClip(n, DUR[n]!, [new NumberKeyframeTrack('body.position[x]', [0, DUR[n]!], [0, 1])]));
const rigged = (): { g: Group; rig: PufferRig } => { const g = puppet(); return { g, rig: rigPuffer(g, clips())! }; };
const w = (rig: PufferRig, n: PufferClip): number => rig.actions[n].getEffectiveWeight();
const startOf = (i: number, k: number): number => { const c = pufferCycle(i); return k * c.period + c.at - c.offset; };
function find(act: PufferAct, also: (i: number, k: number) => boolean = () => true): { i: number; k: number } {
  for (let i = 0; i < 60; i++) for (let k = 1; k < 60; k++) if (pufferActAt(i, k) === act && also(i, k)) return { i, k };
  throw new Error(act);
}
const calm = (over: Partial<PufferState> = {}): PufferState =>
  ({ doing: 'swim', act: null, weight: 0, into: 0, cycle: 0, puff: 0, face: 0, bubble: null, ...over });

describe('the blowfish (puffer.ts)', () => {
  it('rigs only a model with all its clips, and finds its eyes, pupils and mouth', () => {
    expect(rigPuffer(puppet(), clips(['swim', 'puff']))).toBeNull();
    const { rig } = rigged();
    expect(rig.eyes.map((e) => [e.side, e.eye.name, e.pupil.name])).toEqual([[1, 'eyeL', 'pupilL'], [-1, 'eyeR', 'pupilR']]);
    expect(rig.mouth?.name).toBe('mouth');
  });

  it('has a dozen acts, the puff show among the commonest; each fits its cycle', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) for (let k = 0; k < 60; k++) seen.add(pufferActAt(i, k));
    expect(seen.size).toBe(12);
    for (let i = 0; i < 40; i++) { const c = pufferCycle(i); expect(c.at + 7.2).toBeLessThanOrEqual(c.period + 1e-9); }
  });

  it('breathes a little always, and puffs up in gulps — about 2.5 a second — to a full ball', () => {
    for (let t = 0; t < 30; t += 0.1) expect(pufferPuff(1, t)).toBeGreaterThanOrEqual(0);
    const { i, k } = find('puffup');
    const s = startOf(i, k);
    // Steps: it rises in each gulp and pauses between them.
    const rate = (u: number): number => (pufferPuff(i, s + u + 0.02) - pufferPuff(i, s + u)) / 0.02;
    expect(rate(0.2)).toBeGreaterThan(rate(0.5) + 0.5);
    // A gulp's worth at a time.
    expect(pufferPuff(i, s + 0.5)).toBeGreaterThan(0.2);
    expect(pufferPuff(i, s + 0.5)).toBeLessThan(pufferPuff(i, s + 0.9));
    expect(pufferPuff(i, s + 0.9)).toBeLessThan(pufferPuff(i, s + 1.3));
    expect(pufferPuff(i, s + 3)).toBeGreaterThan(0.95);
    // And all the way back down by the end.
    expect(pufferPuff(i, s + 7.15)).toBeLessThan(0.1);
  });

  it('lets go two ways: burped out in steps (slower, the real way) or zipped off like a balloon', () => {
    const burp = find('puffup', (i, k) => pufferRelease(i, k) === 'burp'), zip = find('puffup', (i, k) => pufferRelease(i, k) === 'zip');
    const at = (x: { i: number; k: number }, u: number): number => pufferPuff(x.i, startOf(x.i, x.k) + u);
    // 0.6 s after the release begins the balloon is out; the burper is still burping.
    expect(at(zip, 4.65 + 0.6)).toBeLessThan(0.15);
    expect(at(burp, 4.65 + 0.6)).toBeGreaterThan(0.4);
    // The burper lets out a bubble with each burp.
    const { rig } = rigged();
    const keys = new Set<string>();
    for (let u = 4.6; u < 7.2; u += 0.05) {
      const b = pufferFrame(rig, startOf(burp.i, burp.k) + u, burp.i, 0, { pace: 0 }).bubble;
      if (b) keys.add(b.key);
    }
    expect(keys.size).toBe(4);
  });

  it('keeps the puff dial at full weight, and the body\'s clips always make one whole', () => {
    const { rig } = rigged();
    for (let t = 0; t < 120; t += 0.13) {
      for (const pace of [0, 1]) {
        pufferFrame(rig, t, 4, t * 8, { pace });
        expect(w(rig, 'puff')).toBe(1);
        expect(PUFFER_CLIPS.filter((n) => n !== 'puff').reduce((s, n) => s + w(rig, n), 0)).toBeCloseTo(1, 9);
      }
    }
  });

  it('holds still for an act (a kiss is given standing still), then catches up', () => {
    for (const act of ['kiss', 'puffup', 'wave'] as const) {
      // One whose next act starts after it has caught up.
      const { i, k } = find(act, (i, k) => startOf(i, k + 1) > startOf(i, k) + 7.3 + PUFFER_CATCH);
      const s = startOf(i, k);
      expect(pufferHold(i, s - 0.01)).toBeCloseTo(0, 6);
      expect(pufferHold(i, s + 1.4) - pufferHold(i, s + 0.6)).toBeGreaterThan(0.3);
      expect(pufferHold(i, s + 7.3 + PUFFER_CATCH)).toBeCloseTo(0, 6);
    }
  });

  it('turns to face whoever it kisses', () => {
    const { i, k } = find('kiss');
    const { rig } = rigged();
    expect(pufferFrame(rig, startOf(i, k) + 1.0, i, 0, { pace: 0 }).face).toBeGreaterThan(0.9);
  });
});

describe('the blowfish\'s eyes', () => {
  const viewer = new Vector3(10, 4, 80);  // in front of it, a little to its left
  const look = (rig: PufferRig, t: number, state: PufferState, v: Vector3 | null = viewer) => pufferLook(rig, t, 3, { viewer: v, state });

  it('winks: one eye shut while the other stays open', () => {
    const { g, rig } = rigged();
    g.updateMatrixWorld(true);
    let winked = false;
    for (let t = 0; t < 200 && !winked; t += 0.04) {
      const l = look(rig, t, calm());
      if (l.flirt === 'wink' && Math.max(...l.lids) > 0.9 && Math.min(...l.lids) < 0.3) winked = true;
    }
    expect(winked).toBe(true);
  });

  it('flirts only with a viewer it can see — never with nobody, never behind it', () => {
    const { g, rig } = rigged();
    g.updateMatrixWorld(true);
    for (let t = 0; t < 60; t += 0.1) {
      expect(look(rig, t, calm(), null).flirt).toBeNull();
      expect(look(rig, t, calm(), new Vector3(0, 0, -300)).flirt).toBeNull();
    }
  });

  it('finds the viewer and holds their eye, its pupils wide', () => {
    const { g, rig } = rigged();
    g.updateMatrixWorld(true);
    let n = 0;
    const offs: number[] = [];
    for (let t = 0; t < 60; t += 0.1) {
      const l = look(rig, t, calm());
      n++;
      if (l.at === 'viewer') offs.push(l.offViewer!);
      if (l.flirt) expect(l.pupil).toBeGreaterThan(1.2);
    }
    expect(offs.length / n).toBeGreaterThan(0.3);
    // On the viewer: most of the time right on them (the second eye, a beat behind, only now and then still catching up).
    offs.sort((a, b) => a - b);
    expect(offs[Math.floor(offs.length / 2)]).toBeLessThan(5);
    expect(offs[Math.floor(offs.length * 0.9)]).toBeLessThan(35);
  });

  it('shuts both eyes for the kiss', () => {
    const { g, rig } = rigged();
    g.updateMatrixWorld(true);
    const l = look(rig, 0, calm({ act: 'kiss', weight: 1, into: 0.75, doing: 'kiss' }));
    expect(l.lids[0]).toBeGreaterThan(0.9);
    expect(l.lids[1]).toBeGreaterThan(0.9);
  });

  it('closes an eye by squeezing it top to bottom, and dilates a pupil without it leaving the eye', () => {
    const { g, rig } = rigged();
    g.updateMatrixWorld(true);
    look(rig, 0, calm({ act: 'kiss', weight: 1, into: 0.75, doing: 'kiss' }));
    const e = rig.eyes[0]!;
    const up = e.eye.scale.getComponent(e.eyeUp), side = e.eye.scale.getComponent(e.eyeSide);
    expect(up).toBeLessThan(0.2);
    expect(side).toBeGreaterThan(0.8);
    expect(e.pupil.scale.getComponent(e.pupilUp)).toBeCloseTo(1.3, 6);
  });

  it('is pure in t: the same moment looks the same, whatever came before', () => {
    const a = rigged(), b = rigged();
    a.g.updateMatrixWorld(true); b.g.updateMatrixWorld(true);
    for (const t of [4.4, 19.7, 33.1]) {
      look(a.rig, t + 3, calm()); const la = look(a.rig, t, calm()); const lb = look(b.rig, t, calm());
      expect(la).toEqual(lb);
      for (let i = 0; i < 2; i++) {
        expect(a.rig.eyes[i]!.pupil.position.toArray()).toEqual(b.rig.eyes[i]!.pupil.position.toArray());
        expect(a.rig.eyes[i]!.eye.scale.toArray()).toEqual(b.rig.eyes[i]!.eye.scale.toArray());
      }
    }
  });
});

describe('the act schedule', () => {
  it('is pure', () => {
    for (const t of [3, 50, 777]) expect(pufferAct(5, t)).toEqual(pufferAct(5, t));
  });
});
