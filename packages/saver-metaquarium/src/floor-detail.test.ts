import { MeshBasicMaterial, ShaderLib, type Material } from 'three';
import { describe, expect, it } from 'vitest';
import { FLOOR_DETAIL, FLOOR_RIM, floorShade, patchFloorDetail } from './floor-detail';
import { METAQUARIUM_PARAMS } from './manifest';
import { PARAM_DOCS } from './guide';

type Shader = { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string };
const compile = (m: Material, s: Shader): Shader => { m.onBeforeCompile(s as never, null as never); return s; };

describe('floorDetail', () => {
  it('is off by default and documented', () => {
    expect(METAQUARIUM_PARAMS.floorDetail).toMatchObject({ type: 'number', default: 0, min: 0, max: 1, ease: 'smooth' });
    expect(PARAM_DOCS.floorDetail).toMatch(/ripples/);
  });

  it('shades the seabed around its own colour, never into black or white', () => {
    let lo = Infinity, hi = -Infinity, sum = 0, n = 0;
    for (let x = -300; x <= 300; x += 3.7) for (let z = -300; z <= 300; z += 4.1) {
      const s = floorShade(x, z, 60);
      lo = Math.min(lo, s); hi = Math.max(hi, s); sum += s; n += 1;
    }
    expect(lo).toBeGreaterThan(0.75);
    expect(hi).toBeLessThan(1.25);
    expect(sum / n).toBeCloseTo(1, 1);
    expect(hi - lo).toBeGreaterThan(0.2); // it is visibly there
  });

  it('quiets the ripples and grain with distance, so far sand does not shimmer', () => {
    const spread = (d: number): number => {
      let lo = Infinity, hi = -Infinity;
      for (let x = 0; x < 40; x += 0.5) { const s = floorShade(x, 7, d); lo = Math.min(lo, s); hi = Math.max(hi, s); }
      return hi - lo;
    };
    expect(spread(500)).toBeLessThan(spread(60) * 0.6);
  });

  it('patches the floor once, fading its rim into the fog before the disc ends', () => {
    const m = new MeshBasicMaterial();
    expect(patchFloorDetail(m)).toBe(true);
    expect(patchFloorDetail(m)).toBe(false);
    const s = compile(m, { uniforms: {}, vertexShader: ShaderLib.basic.vertexShader, fragmentShader: ShaderLib.basic.fragmentShader });
    expect(s.uniforms.uMqFloorDetail).toBe(FLOOR_DETAIL);
    expect(s.vertexShader).toMatch(/vMqFloorW = \(modelMatrix \* vec4\(transformed, 1\.0\)\)\.xyz;/);
    expect(s.fragmentShader).toMatch(/diffuseColor\.rgb \*= mix\(1\.0, mqFloorShade/);
    expect(s.fragmentShader).toMatch(/gl_FragColor\.rgb = mix\(gl_FragColor\.rgb, fogColor/);
    expect(FLOOR_RIM[1]).toBeLessThan(600);
  });
});
