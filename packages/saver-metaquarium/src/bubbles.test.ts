import { createRng } from '@idle-screens/core';
import { Points, type Material } from 'three';
import { describe, expect, it } from 'vitest';
import {
  gateOpen, hash, KIND, layoutBubbles, riseTime, snapPeriod, streamAt, WINDOW, RISE_CAP,
  type BubbleState, type Instance,
} from './bubbles';
import { buildScenery, type SceneryOptions } from './scenery';

const vents = [
  { x: 0, y: 0, z: 0, color: '#49cfff' },
  { x: 40, y: 5, z: -20, color: '#ff67bc' },
];
const pearls = Array.from({ length: 30 }, (_, i) => ({ x: i, y: 8, z: 0, color: '#fff', sway: [0, i * 0.3, i * 0.7] as [number, number, number] }));
const opts = { streams: 1, pearling: 1, mist: 1, cap: 8, scale: 1 };
const lay = () => layoutBubbles(vents, pearls, createRng(7), opts);
const st = (): BubbleState => ({ visible: false, x: 0, y: 0, z: 0, r: 0, age: 0, emission: 0 });

/** Group a stream's instances (same site and kind). */
function streams(inst: Instance[], kind: number): Instance[][] {
  const by = new Map<string, Instance[]>();
  for (const i of inst) if (i.q[3] === kind) {
    const k = `${i.site.join()}|${i.p[0]}|${i.p[1]}`;
    by.set(k, [...(by.get(k) ?? []), i]);
  }
  return [...by.values()];
}

describe('bubble lifecycle', () => {
  it('periods divide the window, so t mod WINDOW is seamless', () => {
    for (const p of [0.3, 0.37, 1.1, 25, 71.3, 110]) {
      const q = snapPeriod(p);
      expect(Math.abs(WINDOW / q - Math.round(WINDOW / q))).toBeLessThan(1e-9);
      expect(Math.abs(q - p) / p).toBeLessThan(0.02);
    }
  });
  it('riseTime inverts the climb', () => {
    const v = 3, h = 118, t = riseTime(h, v);
    expect(v * t + 0.5 * 0.08 * v * t * t).toBeCloseTo(h, 6);
  });
  it('shows every live emission of a stream by exactly one instance, at the age it really has', () => {
    for (const kind of [KIND.stream, KIND.pearl]) {
      for (const group of streams(lay(), kind)) {
        const [P, phi] = group[0]!.p;
        for (const t of [0, 3.3, 57.1, 600.05, 1199.9]) {
          const seen = new Map<number, number>();
          for (const inst of group) {
            const s = streamAt(inst, t, null, RISE_CAP, st());
            // The emission this instance shows really was born `age` ago.
            expect((s.emission * P - phi + s.age) - t).toBeCloseTo(0, 6);
            if (s.age < P + riseTime(RISE_CAP, inst.p[3] * 0.88) + 0.75) seen.set(s.emission, (seen.get(s.emission) ?? 0) + 1);
          }
          // Every emission younger than the longest life has an instance, and only one.
          const newest = Math.floor((t + phi) / P);
          const life = P + riseTime(RISE_CAP, group[0]!.p[3] * 0.88) + 0.75;
          for (let k = newest; (t + phi) - k * P < life; k--) expect(seen.get(k)).toBe(1);
        }
      }
    }
  });
  it('gates by EMISSION time: a bubble in flight is never cut off, and a stream really rests', () => {
    const group = streams(lay(), KIND.stream)[0]!.slice(0, 30);
    let rested = 0;
    for (let t = 0; t < 400; t += 1.3) {
      for (const inst of group) {
        const a = streamAt(inst, t, null, RISE_CAP, st()), b = streamAt(inst, t + 0.2, null, RISE_CAP, st());
        // Same emission, both still in their life: visibility cannot change.
        if (a.emission === b.emission && b.age < inst.p[0] + riseTime(RISE_CAP, inst.p[3] * 1.12)) expect(b.visible).toBe(a.visible);
      }
      if (!gateOpen(KIND.stream, group[0]!.q[1], group[0]!.q[2], t)) rested++;
    }
    expect(rested).toBeGreaterThan(15);
    expect(rested).toBeLessThan(290);
  });
  it('is the same frame at t and t + WINDOW (hash and gates repeat in the window)', () => {
    for (const inst of lay().filter((i) => i.q[3] !== KIND.mist)) {
      const a = streamAt(inst, 431.7, 60, RISE_CAP, st()), b = streamAt(inst, 431.7 + WINDOW, 60, RISE_CAP, st());
      expect(b.visible).toBe(a.visible);
      expect(b.y).toBeCloseTo(a.y, 3);
      expect(b.r).toBeCloseTo(a.r, 6);
    }
  });
  it('stops at a surface overhead and never rises past it', () => {
    for (const inst of lay().filter((i) => i.q[3] === KIND.stream)) {
      for (let t = 0; t < 120; t += 1.7) {
        const s = streamAt(inst, t, 40, RISE_CAP, st());
        if (s.visible) expect(s.y + s.r).toBeLessThanOrEqual(40 + 1e-6);
      }
    }
  });
  it('fits the quality budget, and pearls need somewhere to grow', () => {
    for (const cap of [4, 8, 12]) {
      const n = layoutBubbles(vents, [], createRng(1), { ...opts, pearling: 0, mist: 0, cap }).length;
      expect(n).toBeLessThanOrEqual(cap * 100 + 200); // the budget, less one stream's rounding
    }
    expect(layoutBubbles(vents, [], createRng(1), { ...opts, streams: 0, mist: 0 })).toHaveLength(0);
    expect(hash(3) === hash(3)).toBe(true);
  });
});

describe('bubbles in the world', () => {
  const off: SceneryOptions = { rocks: 0, veins: 0.7, homes: 0, flora: 0, bubbles: 0, snow: 0, cap: 8, scale: 1 };
  const terrain = (): number => 0;
  const world = (o: Partial<SceneryOptions>) => buildScenery([], createRng(42), terrain, { ...off, ...o });
  const names = (w: ReturnType<typeof world>) => w.group.children.map((c) => c.name);
  it('classic stays the default: the old puffs, and no live layer', () => {
    const w = world({ bubbles: 1 });
    expect(names(w)).toContain('bubble-vents');
    expect(names(w)).not.toContain('bubbles-live');
  });
  it('live replaces the puffs with one draw carrying streams, pearls and mist', () => {
    const w = world({ bubbles: 1, bubbleStyle: 'live', flora: 1, pearling: 1, mist: 1 });
    expect(names(w)).not.toContain('bubble-vents');
    expect(names(w).filter((n) => n === 'bubbles-live')).toHaveLength(1);
    expect(w.counts.bubbleStreams).toBeGreaterThan(0);
    expect(w.counts.pearls).toBeGreaterThan(0);
    expect(w.counts.mist).toBeGreaterThan(0);
    const pts = w.group.children.find((c) => c.name === 'bubbles-live') as Points;
    expect((pts.material as Material).userData.mqOwned).toBe(true);
    expect(pts.geometry.userData.mqOwned).toBe(true);
    w.setSurface(90);
    w.setFrame(86_400 * 3 + 0.5);
  });
  it('pearling with no flora grows nothing', () => {
    const w = world({ pearling: 1 });
    expect(w.counts.pearls ?? 0).toBe(0);
  });
  it('mist alone builds', () => {
    expect(world({ mist: 1 }).counts.mist).toBeGreaterThan(0);
  });
});
