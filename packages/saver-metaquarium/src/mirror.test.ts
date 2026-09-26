import { PerspectiveCamera, Vector3, Vector4 } from 'three';
import { describe, expect, it } from 'vitest';
import { CRITICAL_ANGLE, MIRROR_GLSL, mirrorVisible, reflectCamera, SurfaceMirror } from './mirror';
import { METAQUARIUM_PARAMS } from './manifest';
import { PARAM_DOCS } from './guide';

const camAt = (p: [number, number, number], look: [number, number, number]): PerspectiveCamera => {
  const c = new PerspectiveCamera(55, 16 / 9, 1, 1400);
  c.position.set(...p); c.lookAt(...look); c.updateMatrixWorld(); c.updateProjectionMatrix();
  return c;
};
const ndc = (cam: PerspectiveCamera, p: Vector3): Vector3 => {
  const v = new Vector4(p.x, p.y, p.z, 1).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
  return new Vector3(v.x / v.w, v.y / v.w, v.z / v.w);
};

describe('surface mirror', () => {
  it('reflects the camera in the surface', () => {
    const cam = camAt([10, 20, 95], [0, 138, 0]), m = new PerspectiveCamera();
    expect(reflectCamera(cam, 150, m)).toBe(true);
    expect(m.position.toArray()).toEqual([10, 280, 95]);
    // It looks at the reflection of what the camera looks at: the reflected look direction.
    const d = new Vector3(), dm = new Vector3();
    cam.getWorldDirection(d); m.getWorldDirection(dm);
    expect(dm.x).toBeCloseTo(d.x, 6); expect(dm.y).toBeCloseTo(-d.y, 6); expect(dm.z).toBeCloseTo(d.z, 6);
  });
  it('clips at the surface: the tank is drawn, nothing above the water is', () => {
    const cam = camAt([0, 20, 95], [0, 138, 0]), m = new PerspectiveCamera();
    reflectCamera(cam, 150, m);
    const inside = (p: Vector3) => { const n = ndc(m, p); return n.z >= -1 && n.z <= 1; };
    expect(inside(new Vector3(0, 60, -20))).toBe(true);
    expect(inside(new Vector3(0, 0, -60))).toBe(true);
    expect(inside(new Vector3(0, 200, 0))).toBe(false);
  });
  it('only from under the water', () => {
    expect(reflectCamera(camAt([0, 160, 90], [0, 30, 0]), 150, new PerspectiveCamera())).toBe(false);
  });
  it('skips when nothing mirrored could be seen, draws when looking up at it', () => {
    expect(mirrorVisible(camAt([0, 60, 80], [0, 0, 0]), 150, 190, 110)).toBe(false); // looking down at the floor
    expect(mirrorVisible(camAt([0, 20, 95], [0, 138, 0]), 150, 190, 110)).toBe(true); // the surface shot
  });
  it("Snell's window is about 48.6 degrees either side of straight up, and the GLSL uses it", () => {
    expect((CRITICAL_ANGLE * 180) / Math.PI).toBeCloseTo(48.6, 1);
    expect(Math.cos(CRITICAL_ANGLE)).toBeGreaterThan(0.62);
    expect(Math.cos(CRITICAL_ANGLE)).toBeLessThan(0.7);
    expect(MIRROR_GLSL).toContain('smoothstep(0.62, 0.70, cosi)');
  });
  it('latches off for good, and is declared, off by default, documented', () => {
    const m = new SurfaceMirror();
    expect(m.off).toBe(false);
    m.latchOff();
    expect(m.off).toBe(true);
    expect(m.render({} as never, () => {}, {} as never, camAt([0, 20, 95], [0, 138, 0]), 150, { radius: 190, top: 110 })).toBe(false);
    m.dispose();
    expect(METAQUARIUM_PARAMS.surfaceMirror).toMatchObject({ type: 'number', default: 0 });
    expect(PARAM_DOCS.surfaceMirror).toBeTruthy();
  });
});
