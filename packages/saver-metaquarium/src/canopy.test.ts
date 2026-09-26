import { describe, expect, it } from 'vitest';
import { buildCanopy, shoalLiftTable, swayReach } from './canopy';

describe('canopy', () => {
  const ground = (x: number, z: number): number => 2 + Math.sin(x * 0.01) * 3 + Math.cos(z * 0.013) * 2;
  it('is the ground where nothing grows, and outside the grid', () => {
    const c = buildCanopy(ground, []);
    for (const [x, z] of [[0, 0], [50, -80], [-120, 33]] as const) expect(Math.abs(c.at(x, z) - ground(x, z))).toBeLessThan(0.6);
    expect(c.at(500, 0)).toBe(ground(500, 0));
  });
  it('covers a plant tip and the room it sweeps, at full height', () => {
    const tip = { x: 30, z: -20, y: 46, r: 6 + swayReach(44) };
    const c = buildCanopy(ground, [tip]);
    expect(c.at(30, -20)).toBeGreaterThan(45);
    // Its sway: well out from the stem, still covered.
    expect(c.at(30 + tip.r * 0.8, -20)).toBeGreaterThan(40);
    // Far away: the ground again.
    expect(c.at(-90, 80)).toBeLessThan(8);
  });
  it('ramps instead of stepping, so headings never snap', () => {
    const c = buildCanopy(() => 0, [{ x: 0, z: 0, y: 40, r: 10 }]);
    let worst = 0;
    for (let x = -60; x < 60; x += 0.5) worst = Math.max(worst, Math.abs(c.at(x + 0.5, 0) - c.at(x, 0)));
    expect(worst).toBeLessThan(40 / 6);
  });
  it('swayReach grows with height and saturates', () => {
    expect(swayReach(2)).toBeLessThan(swayReach(20));
    expect(swayReach(200)).toBeCloseTo(3.3 * (9 + 0.36), 9);
  });
  it('the lift table rises ahead of a tall bed and holds past it', () => {
    const c = buildCanopy(() => 0, [{ x: 50, z: 0, y: 40, r: 8 }]);
    // A straight route along x from -100 to 100 and back, 400 long.
    const pose = (d: number) => ({ x: d < 200 ? -100 + d : 300 - d, z: 0 });
    const t = shoalLiftTable(400, c, 6, pose, 400);
    expect(t[140]!).toBeGreaterThan(35); // d=140 is x=40: at the bed
    expect(t[120]!).toBeGreaterThan(35); // x=20: within six lengths ahead of it
    expect(t[60]!).toBeLessThan(5); // x=-40: open water
  });
});
