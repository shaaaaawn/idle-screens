import { describe, expect, it } from 'vitest';
import { CAST_FOV, castPose, lastStepChange, pickLandmark, shotBlendAt, SHOT_NAMES, shotBearing, shotPose, type ShotInput, type ShotPose } from './shots';
import { METAQUARIUM_PARAMS } from './manifest';
import { PARAM_DOCS } from './guide';

const pose = (): ShotPose => ({ x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, fov: 0 });
const base: ShotInput = { azimuth: 35, elevation: 15, distance: 110, ceiling: null, floor: () => 0, landmark: null };

describe('shots', () => {
  it('orbit is exactly the classic camera', () => {
    for (const [az, el, d] of [[35, 15, 110], [0, -5, 80], [270, 60, 400], [123.4, 22, 170]] as const) {
      const p = shotPose('orbit', { ...base, azimuth: az, elevation: el, distance: d }, pose());
      const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
      expect(p.x).toBe(Math.cos(e) * Math.sin(a) * d);
      expect(p.y).toBe(Math.max(10, 15 + Math.sin(e) * d));
      expect(p.z).toBe(Math.cos(e) * Math.cos(a) * d);
      expect([p.tx, p.ty, p.tz, p.fov]).toEqual([0, 35, 0, 55]);
    }
  });
  it('every shot stays in the water: above the floor, under the surface', () => {
    const ceilings = [null, 118, 132, 150, 170];
    const floors = [() => 0, (x: number, z: number) => 20 + Math.sin(x * 0.03) * 12 + Math.cos(z * 0.02) * 10];
    for (const name of SHOT_NAMES.filter((n) => n !== 'orbit')) {
      for (const ceiling of ceilings) for (const floor of floors) for (const azimuth of [0, 35, 190, 300]) for (const distance of [80, 110, 250, 400]) {
        const p = shotPose(name, { ...base, azimuth, distance, ceiling, floor, landmark: { x: 40, y: 50, z: 30, size: 30 } }, pose());
        expect(Number.isFinite(p.x + p.y + p.z + p.tx + p.ty + p.tz)).toBe(true);
        expect(p.y).toBeGreaterThanOrEqual(floor(p.x, p.z) + 6 - 1e-9);
        if (ceiling !== null) expect(p.y).toBeLessThanOrEqual(ceiling - 6 + 1e-9);
      }
    }
  });
  it('surface looks up at the water; low looks up; top looks down; macro frames the landmark', () => {
    const at = (n: (typeof SHOT_NAMES)[number], extra: Partial<ShotInput> = {}) => shotPose(n, { ...base, ceiling: 150, ...extra }, pose());
    for (const n of ['surface', 'low'] as const) { const p = at(n); expect(p.ty).toBeGreaterThan(p.y); }
    const top = at('top'); expect(top.ty).toBeLessThan(top.y);
    const m = at('macro', { landmark: { x: 40, y: 50, z: 30, size: 30 } });
    expect(Math.hypot(m.tx - 40, m.tz - 30)).toBeLessThan(1e-9);
    expect(Math.hypot(m.x - m.tx, m.y - m.ty, m.z - m.tz)).toBeLessThan(100);
  });
  it('azimuth turns every shot around its target; distance scales it', () => {
    const a = shotPose('hero', base, pose()), b = shotPose('hero', { ...base, azimuth: base.azimuth + 90 }, pose());
    expect(Math.hypot(a.x - a.tx, a.z - a.tz)).toBeCloseTo(Math.hypot(b.x - b.tx, b.z - b.tz), 9);
    const far = shotPose('front', { ...base, distance: 220 }, pose()), near = shotPose('front', base, pose());
    expect(Math.hypot(far.x, far.z)).toBeGreaterThan(Math.hypot(near.x, near.z) * 1.8);
  });
  it('pickLandmark takes the one nearest the front, deterministically', () => {
    const c = [{ x: 0, y: 30, z: 80, size: 20 }, { x: 0, y: 30, z: -80, size: 20 }];
    expect(pickLandmark(c, 0)).toBe(c[0]);
    expect(pickLandmark(c, 180)).toBe(c[1]);
    expect(pickLandmark([], 0)).toBeNull();
  });
  it('is declared and documented', () => {
    expect(METAQUARIUM_PARAMS.shot).toMatchObject({ type: 'enum', default: 'orbit' });
    expect((METAQUARIUM_PARAMS.shot as { options: string[] }).options).toEqual([...SHOT_NAMES]);
    expect(PARAM_DOCS.shot).toBeTruthy();
  });
});

describe('shotBearing (X438)', () => {
  it('is the param while nothing turns, and turns with autoRotate', () => {
    expect(shotBearing('orbit', 0, 0)).toBe(0);
    expect(shotBearing('orbit', 300, 0)).toBe(300);
    expect(shotBearing('orbit', 0, 4 * 12)).toBe(48); // autoRotate 4 °/s, 12 s in
    expect(shotBearing('orbit', 350, 20)).toBe(10); // wraps
    expect(shotBearing('orbit', 0, -30)).toBe(330);
    expect(shotBearing('hero', 0, 0)).toBe(332); // the hero shot swings 28° off
  });
});

describe('cast shot', () => {
  const base = { azimuth: 0, elevation: 15, scale: 1, ceiling: 150, floor: () => 0, reach: 264 };
  const out = (): ShotPose => ({ x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, fov: 0 });

  it('aims at the leads\' middle and stands back as far as their spread needs', () => {
    const tight = castPose([{ x: 10, y: 40, z: 0 }, { x: 30, y: 40, z: 0 }], 16, base, out())!;
    expect([tight.tx, tight.ty, tight.tz]).toEqual([20, 40, 0]);
    expect(tight.fov).toBe(CAST_FOV);
    const wide = castPose([{ x: -60, y: 40, z: 0 }, { x: 100, y: 40, z: 0 }], 16, base, out())!;
    const back = (p: ShotPose): number => Math.hypot(p.x - p.tx, p.y - p.ty, p.z - p.tz);
    expect(back(wide)).toBeGreaterThan(back(tight));
    expect(back(tight)).toBeGreaterThanOrEqual(45 - 1e-9);
  });

  it('moves continuously as the leads swim (no snap when one wanders off)', () => {
    let prev: ShotPose | null = null, worst = 0;
    for (let k = 0; k <= 200; k++) {
      const x = -40 + k; // one lead swims 200 units while the others hold
      const p = castPose([{ x: 0, y: 40, z: 0 }, { x: 10, y: 45, z: 10 }, { x, y: 50, z: -20 }], 16, base, out())!;
      if (prev) worst = Math.max(worst, Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z));
      prev = p;
    }
    expect(worst).toBeLessThan(3);
  });

  it('stays in the tank and in the water, and has nothing to frame without fish', () => {
    const far = castPose([{ x: -110, y: 40, z: -110 }, { x: 110, y: 40, z: 110 }], 40, { ...base, scale: 3.6 }, out())!;
    expect(Math.hypot(far.x, far.z)).toBeLessThanOrEqual(264 + 1e-9);
    expect(far.y).toBeLessThanOrEqual(144);
    const low = castPose([{ x: 0, y: -5, z: 0 }], 16, { ...base, floor: () => 20 }, out())!;
    expect(low.ty).toBe(28);
    expect(castPose([], 16, base, out())).toBeNull();
  });
});

describe('shot blend', () => {
  const d = (t: number, value: string) => ({ t, path: 'shot', value });
  const track = { deltas: [{ t: 0, path: 'fishMix', value: 'dori:3' }, d(0, 'hero'), d(10_000, 'cast'), d(30_000, 'top')] };

  it('reads when the shot last changed, from what to what', () => {
    expect(lastStepChange(track, 'shot', 5_000)).toBeNull(); // the mount is not a cut
    expect(lastStepChange(track, 'shot', 12_000)).toEqual({ from: 'hero', to: 'cast', at: 10_000 });
    expect(lastStepChange(track, 'shot', 31_000)).toEqual({ from: 'cast', to: 'top', at: 30_000 });
    expect(lastStepChange({ deltas: [d(0, 'hero'), d(5_000, 'hero')] }, 'shot', 6_000)).toBeNull(); // no change
    expect(lastStepChange({ deltas: [] }, 'shot', 6_000)).toBeNull();
  });

  it('on a loop, the seam is a change from the second cycle on', () => {
    const loop = { ...track, loop: true, duration: 40_000 };
    expect(lastStepChange(loop, 'shot', 1_000)).toBeNull();
    expect(lastStepChange(loop, 'shot', 41_000)).toEqual({ from: 'top', to: 'hero', at: 40_000 });
    expect(lastStepChange(loop, 'shot', 52_000)).toEqual({ from: 'hero', to: 'cast', at: 50_000 });
    // A loop whose first key is late: before it, the last change was the previous cycle's last key.
    const late = { deltas: [d(5_000, 'hero'), d(20_000, 'cast')], loop: true, duration: 30_000 };
    expect(lastStepChange(late, 'shot', 32_000)).toEqual({ from: 'hero', to: 'cast', at: 20_000 });
  });

  it('eases from 0 to 1 over the blend, smoothly at both ends; no blend is a cut', () => {
    expect(shotBlendAt(0, 4)).toBe(0);
    expect(shotBlendAt(2, 4)).toBeCloseTo(0.5, 9);
    expect(shotBlendAt(4, 4)).toBe(1);
    expect(shotBlendAt(9, 4)).toBe(1);
    expect(shotBlendAt(0, 0)).toBe(1);
    const e = 1e-4;
    expect((shotBlendAt(e, 4) - shotBlendAt(0, 4)) / e).toBeLessThan(1e-3); // starts at rest
    expect((shotBlendAt(4, 4) - shotBlendAt(4 - e, 4)) / e).toBeLessThan(1e-3); // and lands at rest
  });
});
