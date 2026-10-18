import { describe, expect, it } from 'vitest';
import { buildCanopy } from './canopy';
import { BOOM_MAX, MARGIN, clearSightline, type SightlineInput, type Vec3 } from './sightline';

const flat = (): number => 0;
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** How far the line from target to camera dips below the height field (0 = clear). */
function worstDeficit(t: Vec3, c: Vec3, h: (x: number, z: number) => number): number {
  let w = 0;
  for (let k = 1; k <= 200; k++) {
    const f = 0.15 + (0.85 * k) / 200;
    w = Math.max(w, h(t.x + (c.x - t.x) * f, t.z + (c.z - t.z) * f) - (t.y + (c.y - t.y) * f));
  }
  return w;
}
const base = (o: Partial<SightlineInput> = {}): SightlineInput => ({
  target: { x: 0, y: 8, z: 0 }, camera: { x: 0, y: 20, z: -60 }, height: flat, minBack: 22, amount: 1, ceiling: null, ...o,
});
/** A wall across the arm at z ∈ [-40, -30], `h` tall. */
const wall = (h: number) => (_x: number, z: number): number => (z > -40 && z < -30 ? h : 0);

describe('clearSightline', () => {
  it('leaves the camera alone at amount 0, and on a clear line', () => {
    const i = base({ height: wall(80), amount: 0 });
    expect(clearSightline(i)).toBe(i.camera);
    const c = clearSightline(base());
    expect(dist(c, base().camera)).toBeLessThan(1e-9);
  });

  it('looks over low clutter with a small boom and no pull', () => {
    const c = clearSightline(base({ height: wall(16) }));
    expect(c.y).toBeGreaterThan(20);
    expect(c.y - 20).toBeLessThanOrEqual(BOOM_MAX);
    expect(c.z).toBeCloseTo(-60, 6);
    expect(worstDeficit(base().target, c, wall(16))).toBeLessThanOrEqual(MARGIN * 0.01);
  });

  it('pulls in in front of a wall too tall to look over, and the fish is in view', () => {
    const c = clearSightline(base({ height: wall(70) }));
    expect(c.z).toBeGreaterThan(-30);
    expect(worstDeficit(base().target, c, wall(70))).toBeLessThanOrEqual(0);
  });

  it('never comes closer than minBack — a wall must not flip the shot into the eye', () => {
    const tight = (_x: number, z: number): number => (z > -6 && z < -2 ? 200 : 0);
    const c = clearSightline(base({ height: tight, minBack: 22 }));
    expect(dist(c, base().target)).toBeGreaterThanOrEqual(22 - 1e-6);
  });

  it('does not dive into a clump the fish itself stands in', () => {
    const clump = (x: number, z: number): number => (Math.hypot(x, z) < 12 ? 40 : 0);
    const c = clearSightline(base({ height: clump }));
    expect(c.z).toBeCloseTo(-60, 6);
  });

  it('never booms through the water surface', () => {
    const c = clearSightline(base({ height: wall(24), ceiling: 26 }));
    expect(c.y).toBeLessThanOrEqual(20 + 1e-9);
  });

  it('half amount lands halfway between the chase camera and the cleared one', () => {
    const full = clearSightline(base({ height: wall(70) })), half = clearSightline(base({ height: wall(70), amount: 0.5 }));
    expect(half.z).toBeCloseTo((-60 + full.z) / 2, 6);
  });

  it('eases past a home instead of snapping: a fish walking by at 14 u/s, 60 frames a second', () => {
    // A home (a dome 30 across, 34 tall) beside the path, the camera riding 60 behind and 12 up.
    const canopy = buildCanopy((x, z) => { const q = Math.hypot(x - 20, z + 25) / 15; return q < 1 ? 34 * Math.sqrt(1 - q * q) : 0; }, [], 200, 64);
    const h = (x: number, z: number): number => canopy.at(x, z);
    let prev: Vec3 | null = null, worstStep = 0, pulled = false;
    for (let f = 0; f <= 600; f++) {
      const x = -70 + (14 * f) / 60;
      const t = { x, y: 8, z: 0 }, cam = { x: x + 20, y: 20, z: -57 };
      const c = clearSightline({ target: t, camera: cam, height: h, minBack: 22, amount: 1, ceiling: null });
      if (dist(c, cam) > 5) pulled = true;
      if (prev) worstStep = Math.max(worstStep, dist(c, prev) - 14 / 60);
      prev = c;
    }
    expect(pulled).toBe(true);
    // The fish moves 0.23 a frame; the camera may ease faster than that, never jump.
    expect(worstStep).toBeLessThan(0.8);
  });
});
