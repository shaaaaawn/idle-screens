import { describe, expect, it } from 'vitest';
import { trailEchoes, trailFillBudget } from './trail';

describe('trailEchoes (X469)', () => {
  const W = 1600;
  const H = 900;
  it('a slow mover whose echoes overlap gets exactly the old 24 time samples, no extras', () => {
    const pos = (t: number) => ({ x: 100 + t * 0.01, y: 450 }); // 10 px/s
    const ec = trailEchoes({ length: 2400, fade: 0.5 }, 5000, 1, 20, pos, W, H, true, 480);
    expect(ec).toHaveLength(24);
    ec.forEach((e, i) => expect(e.t).toBeCloseTo(5000 - ((i + 1) / 24) * 2400, 9));
  });

  it('a fast mover is gap-filled until neighbouring echoes sit within half a radius', () => {
    const pos = (t: number) => ({ x: 800 + 300 * Math.cos(t / 2000), y: 450 + 300 * Math.sin(t / 2000) }); // 150 px/s on a circle
    const ec = trailEchoes({ length: 5000, fade: 0.15 }, 8000, 1, 20, pos, W, H, true, 480);
    expect(ec.length).toBeGreaterThan(24);
    let prev = pos(8000);
    let worst = 0;
    for (const e of ec) {
      worst = Math.max(worst, Math.hypot(e.x - prev.x, e.y - prev.y) / e.r);
      prev = e;
      // Every echo sits on the curve (sampled at its own time, not interpolated in space).
      const p = pos(e.t);
      expect(Math.hypot(p.x - e.x, p.y - e.y)).toBeLessThan(1e-9);
    }
    expect(worst).toBeLessThanOrEqual(0.5 + 1e-9);
    // Head-first (k monotone); a filled span's echoes share its ink, so none outshines the head.
    for (let i = 1; i < ec.length; i++) expect(ec[i]!.k).toBeGreaterThan(ec[i - 1]!.k);
    for (const e of ec) expect(e.alpha).toBeLessThanOrEqual(1);
  });

  it('the fill is budgeted: never more than the cap of extra echoes', () => {
    const pos = (t: number) => ({ x: 800 + 400 * Math.cos(t / 100), y: 450 + 400 * Math.sin(t / 100) });
    const ec = trailEchoes({ length: 5000 }, 9000, 1, 4, pos, W, H, true, 50);
    expect(ec.length).toBeLessThanOrEqual(24 + 50);
    expect(trailFillBudget(1)).toBe(1200);
    expect(trailFillBudget(10)).toBe(480);
    expect(trailFillBudget(400)).toBe(12);
    expect(trailFillBudget(10000)).toBe(8);
  });

  it('stops at a wrap seam', () => {
    const pos = (t: number) => ({ x: (t * 0.5) % W, y: 450 });
    const ec = trailEchoes({ length: 5000 }, 3300, 1, 10, pos, W, H, true, 480);
    for (const e of ec) expect(e.x).toBeLessThanOrEqual(pos(3300).x);
  });
});

describe('trailEchoes: a filled span keeps the ink of the echo it replaces', () => {
  const pos = (t: number) => ({ x: 100 + t * 0.4, y: 450 }); // 400 px/s, straight
  const W = 1600;
  const H = 900;
  it('additive: alphas along the ribbon sum to about one echo per point, not many', () => {
    const ec = trailEchoes({ length: 2400, fade: 0 }, 3000, 0.8, 20, pos, W, H, true, 1200, 0, true);
    expect(ec.length).toBeGreaterThan(24);
    // Sample the ribbon's centreline: summed disc alpha at a point mid-trail.
    const x = pos(3000 - 1200).x;
    const sum = ec.filter((e) => Math.abs(e.x - x) <= e.r).reduce((s, e) => s + e.alpha, 0);
    expect(sum).toBeGreaterThan(0.8 * 0.6);
    expect(sum).toBeLessThan(0.8 * 1.6);
  });
  it('source-over: the composited alpha at a point stays about one echo\'s', () => {
    const ec = trailEchoes({ length: 2400, fade: 0 }, 3000, 0.5, 20, pos, W, H, true, 1200);
    const x = pos(3000 - 1200).x;
    const through = ec.filter((e) => Math.abs(e.x - x) <= e.r).reduce((s, e) => s * (1 - e.alpha), 1);
    expect(1 - through).toBeGreaterThan(0.5 * 0.6);
    expect(1 - through).toBeLessThan(Math.min(1, 0.5 * 1.6));
  });
});
