import { createRng } from '@idle-screens/core';
import { describe, expect, it } from 'vitest';
import { buildFlora, floraSwayAt, stemAt, type FloraOptions, type FloraStem } from './flora';
import { HOLD_APPROACH, holdCycle, pickStem, seahorseHeld, seahorseHoldAt, STEM_REACH } from './holdfast';
import { seahorsePersonality } from './seahorse';

const anchors = [{ x: 0, y: 0, z: 0, color: '#2dffb0' }, { x: 80, y: 0, z: -40, color: '#4fe9ff' }];
const opts: FloraOptions = { density: 1, cap: 8, scale: 1, blocked: () => false };
const flat = (): number => 0;

describe('holdfast: when a seahorse holds on', () => {
  it('pauses its route smoothly — never backwards, never faster than time — and only while it holds', () => {
    for (const i of [0, 3, 11, 26]) {
      expect(seahorseHeld(i, 0)).toBe(0);
      let prev = 0;
      for (let t = 0.05; t < 600; t += 0.05) {
        const h = seahorseHeld(i, t), dh = h - prev;
        expect(dh).toBeGreaterThanOrEqual(-1e-9);
        expect(dh).toBeLessThanOrEqual(0.05 + 1e-9);
        // Out of a bout the route runs; well inside one it is stopped.
        const s = seahorseHoldAt(i, t);
        if (s.phase === 'none' && s.into > holdCycle(i).length + 0.06) expect(dh).toBeCloseTo(0, 9);
        if (s.phase === 'hold') expect(dh).toBeCloseTo(0.05, 5);
        prev = h;
      }
    }
  });

  it('goes over and comes back eased, wraps its tail only as it arrives, and is wholly there while it holds', () => {
    for (const i of [1, 7]) {
      let prev = seahorseHoldAt(i, 0);
      for (let t = 0.05; t < 400; t += 0.05) {
        const s = seahorseHoldAt(i, t);
        expect(Math.abs(s.reach - prev.reach)).toBeLessThan(0.025);
        expect(Math.abs(s.grip - prev.grip)).toBeLessThan(0.05);
        expect(s.grip).toBeLessThanOrEqual(s.reach + 1e-9);
        if (s.phase === 'hold') expect([s.reach, s.grip]).toEqual([1, 1]);
        if (s.phase === 'approach' && s.into < 0.5 * HOLD_APPROACH) expect(s.grip).toBe(0);
        prev = s;
      }
    }
  });

  it('a hunter or a shy one spends more of its day holding on than a curious one', () => {
    const share = (temper: string): number => {
      const ids = [...Array(80).keys()].filter((i) => seahorsePersonality(i).temper === temper);
      return ids.reduce((s, i) => { const c = holdCycle(i); return s + c.hold / c.period; }, 0) / ids.length;
    };
    expect(share('hunter')).toBeGreaterThan(share('curious'));
    expect(share('shy')).toBeGreaterThan(share('dancer'));
    for (let i = 0; i < 40; i++) expect(holdCycle(i).period).toBeGreaterThan(holdCycle(i).length);
  });
});

describe('holdfast: what it holds', () => {
  const stem = (x: number, y: number, z: number, plant: number): FloraStem => ({ x, y, z, root: 0, phase: 0, gust: 0, flex: 1, plant });

  it('takes the nearest stalk a little below it, not one in the sand, not another\'s, not out of reach', () => {
    const stems = [stem(10, 20, 0, 0), stem(4, 2, 0, 1), stem(-12, 22, 0, 2), stem(STEM_REACH + 20, 30, 0, 3)];
    expect(pickStem(stems, 0, 30, 0, 18, new Set())).toBe(0);
    expect(pickStem(stems, 0, 30, 0, 18, new Set([0]))).toBe(2);
    expect(pickStem(stems, 0, 30, 0, 18, new Set([0, 2]))).toBe(-1);
    expect(pickStem([stem(STEM_REACH + 1, 22, 0, 0)], 0, 30, 0, 18, new Set())).toBe(-1);
    // Grown up through a rock, the stalk there is inside it.
    expect(pickStem(stems, 0, 30, 0, 18, new Set(), (x) => (x > 5 ? 40 : -Infinity))).toBe(2);
  });

  it('grows stalk only on kelp and sea whips, each cell sitting on its own cube, its sway what the cube\'s vertices carry', () => {
    expect(buildFlora(anchors, flat, createRng(3), { ...opts, mix: { grass: 1, anemone: 1 } }).stems).toEqual([]);
    for (const mix of [{ kelp: 1 }, { whip: 1 }]) {
      const f = buildFlora(anchors, flat, createRng(3), { ...opts, mix });
      expect(f.stems.length).toBeGreaterThan(20);
      expect(new Set(f.stems.map((s) => s.plant)).size).toBe(f.plants);
      const g = f.parts[0]!, pos = g.getAttribute('position'), sway = g.getAttribute('aSway'), mat = g.getAttribute('aMat');
      // The vertices by the plant they sway with (root, phase, gust), indexed once.
      const key = (root: number, phase: number, gust: number): string => `${root.toFixed(3)}|${phase.toFixed(4)}|${gust.toFixed(4)}`;
      const byPlant = new Map<string, number[]>();
      for (let v = 0; v < pos.count; v++) {
        const k = key(sway.getX(v), sway.getY(v), sway.getZ(v));
        (byPlant.get(k) ?? byPlant.set(k, []).get(k)!).push(v);
      }
      for (const s of f.stems.filter((_, i) => i % 7 === 0)) {
        let found = 0;
        for (const v of byPlant.get(key(Math.fround(s.root), Math.fround(s.phase), Math.fround(s.gust))) ?? []) {
          // Within its cube (faces between cubes are culled, and runs of faces merged, so only some corners are its own).
          if (Math.abs(pos.getX(v) - s.x) > 1.7 || Math.abs(pos.getY(v) - s.y) > 1.7 || Math.abs(pos.getZ(v) - s.z) > 1.7) continue;
          expect(mat.getX(v)).toBeCloseTo(s.flex, 6);
          found++;
        }
        expect(found).toBeGreaterThan(0);
      }
    }
  });

  it('a stalk cell moves as the shader moves it: by its height, its flex, and a little lower bowed over', () => {
    const s = { ...stem(3, 20, -4, 0), root: 2, phase: 1.3, gust: 0.4, flex: 0.8 };
    for (const t of [0, 7.5, 133]) {
      const [sx, sz] = floraSwayAt(18, 1.3, 0.4, t);
      const at = stemAt(s, t, { x: 0, y: 0, z: 0 });
      expect(at.x).toBeCloseTo(3 + sx * 0.8, 9);
      expect(at.z).toBeCloseTo(-4 + sz * 0.8, 9);
      expect(at.y).toBeCloseTo(20 - ((sx * 0.8) ** 2 + (sz * 0.8) ** 2) * 0.012, 9);
    }
    for (const v of floraSwayAt(0, 1, 1, 5)) expect(v).toBeCloseTo(0, 12);
  });
});
