import { AnimationClip, Bone, Group, NumberKeyframeTrack } from 'three';
import { describe, expect, it } from 'vitest';
import { ANGLER_CLIPS, anglerCycle, anglerFrame, anglerMoment, anglerStrikes, rigAngler } from './angler';

const DUR: Record<string, number> = { swim: 1, lure: 4, chomp: 1.4, blink: 0.3 };
const puppet = (): Group => { const g = new Group(); const b = new Bone(); b.name = 'body'; g.add(b); return g; };
const clips = (names: readonly string[] = ANGLER_CLIPS): AnimationClip[] =>
  names.map((n) => new AnimationClip(n, DUR[n]!, [new NumberKeyframeTrack('body.position[x]', [0, DUR[n]!], [0, 1])]));

describe('glowfish: the angler', () => {
  it('rigs only a model that carries its four clips', () => {
    expect(rigAngler(puppet(), clips())).not.toBeNull();
    expect(rigAngler(puppet(), clips(['swim', 'blink']))).toBeNull();
  });

  it('fishes once a cycle, and strikes on some bouts but not all', () => {
    for (let i = 0; i < 6; i++) {
      const c = anglerCycle(i);
      let lured = 0, chomped = 0;
      for (let t = 0; t < c.period; t += 0.05) {
        const m = anglerMoment(i, t);
        if (m.doing === 'lure') lured += 0.05;
        if (m.doing === 'chomp') chomped += 0.05;
      }
      expect(lured).toBeGreaterThan(3.5);
      expect(lured).toBeLessThan(4.1);
      expect(chomped).toBeLessThan(1.5);
    }
    const strikes = Array.from({ length: 40 }, (_, k) => anglerStrikes(3, k));
    expect(strikes).toContain(true);
    expect(strikes).toContain(false);
  });

  it('the body clips share one whole; the blink rides on top', () => {
    for (let t = 0; t < 60; t += 0.07) {
      const w = anglerMoment(2, t).weights;
      expect(w.swim + w.lure + w.chomp).toBeCloseTo(1, 9);
      expect([0, 1]).toContain(w.blink);
    }
  });

  it('is pure in (index, t), and sets the rig it is handed', () => {
    const a = rigAngler(puppet(), clips())!, b = rigAngler(puppet(), clips())!;
    for (const t of [0.3, 7.7, 19.2]) {
      const sa = anglerFrame(a, t, 4, 123.4);
      anglerFrame(a, t + 5, 4, 300);
      const sa2 = anglerFrame(a, t, 4, 123.4);
      const sb = anglerFrame(b, t, 4, 123.4);
      expect(sa2).toEqual(sa);
      expect(sb).toEqual(sa);
      for (const n of ANGLER_CLIPS) {
        expect(b.actions[n].time).toBe(a.actions[n].time);
        expect(a.actions[n].getEffectiveWeight()).toBe(sa.weights[n]);
      }
    }
    // The tail beats with the distance swum: 1/0.045 units per beat.
    anglerFrame(a, 1, 0, 10);
    const t0 = a.actions.swim.time;
    anglerFrame(a, 1, 0, 10 + 1 / 0.045 / 4);
    expect((a.actions.swim.time - t0 + 1) % 1).toBeCloseTo(0.25, 9);
  });

  it('its light breathes, beckons and goes dark at the strike — never a flash', () => {
    for (const i of [0, 1, 5, 11]) {
      let lo = Infinity, hi = -Infinity;
      // Count the light's turns (local extrema) in every 1 s window: a flash is
      // a pair of opposing changes, and WCAG allows three a second.
      const dt = 1 / 120, turns: number[] = [];
      let prev = anglerMoment(i, 0).lure, dir = 0;
      for (let t = dt; t < 90; t += dt) {
        const v = anglerMoment(i, t).lure;
        lo = Math.min(lo, v); hi = Math.max(hi, v);
        const d = Math.sign(v - prev);
        if (d !== 0 && dir !== 0 && d !== dir && Math.abs(v - prev) > 1e-9) turns.push(t);
        if (d !== 0) dir = d;
        prev = v;
      }
      expect(lo).toBeGreaterThanOrEqual(0.15);
      expect(hi).toBeLessThanOrEqual(1);
      for (let j = 0; j < turns.length; j++) {
        const inWindow = turns.filter((t) => t >= turns[j]! && t < turns[j]! + 1).length;
        expect(inWindow).toBeLessThanOrEqual(6); // ≤ 3 flashes (6 turns) a second
      }
      // And the eyes barely breathe.
      for (let t = 0; t < 30; t += 0.25) {
        const o = anglerMoment(i, t).orbs;
        expect(o).toBeGreaterThanOrEqual(0.9);
        expect(o).toBeLessThanOrEqual(1);
      }
    }
  });

  it('the strike puts the light out, once, and it comes back', () => {
    let found = -1;
    for (let k = 0; k < 20 && found < 0; k++) if (anglerStrikes(0, k)) found = k;
    const c = anglerCycle(0);
    const strikeAt = found * c.period - c.offset + c.at + 4; // the chomp starts as the lure bout ends
    const before = anglerMoment(0, strikeAt - 0.01);
    const dark = anglerMoment(0, strikeAt + 0.5);
    const after = anglerMoment(0, strikeAt + 2);
    expect(dark.doing).toBe('chomp');
    expect(dark.lure).toBeLessThan(before.lure * 0.5);
    expect(after.lure).toBeGreaterThan(dark.lure * 1.8);
  });
});
