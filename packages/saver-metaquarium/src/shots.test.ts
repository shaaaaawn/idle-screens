import { describe, expect, it } from 'vitest';
import { pickLandmark, SHOT_NAMES, shotPose, type ShotInput, type ShotPose } from './shots';
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
