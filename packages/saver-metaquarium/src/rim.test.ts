import { BoxGeometry, MeshBasicMaterial, MeshLambertMaterial, ShaderLib, type Material } from 'three';
import { describe, expect, it } from 'vitest';
import { FISH_RIM, addRimNormals, patchFishRim, setFishRim } from './rim';
import { METAQUARIUM_PARAMS } from './manifest';
import { PARAM_DOCS } from './guide';

type Shader = { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string };
const compile = (m: Material, s: Shader): Shader => { m.onBeforeCompile(s as never, null as never); return s; };

describe('fishRim', () => {
  it('is off by default and documented', () => {
    expect(METAQUARIUM_PARAMS.fishRim).toMatchObject({ type: 'number', default: 0, min: 0, max: 1, ease: 'smooth' });
    expect(PARAM_DOCS.fishRim).toMatch(/dark water/);
  });

  it('patches lit fish coats only, once, on the envelope normal', () => {
    const coat = new MeshLambertMaterial();
    expect(patchFishRim(coat)).toBe(false); // not a fish coat
    coat.userData.mqFish = true;
    expect(patchFishRim(coat)).toBe(true);
    expect(patchFishRim(coat)).toBe(false);
    const s = compile(coat, { uniforms: {}, vertexShader: ShaderLib.lambert.vertexShader, fragmentShader: ShaderLib.lambert.fragmentShader });
    expect(s.uniforms.uMqRim).toBe(FISH_RIM);
    expect(s.vertexShader).toMatch(/vMqRimN = normalMatrix \* \(dot\(aMqRimN, aMqRimN\) > 0\.0 \? aMqRimN : objectNormal\)/);
    expect(s.fragmentShader).toMatch(/outgoingLight \+= uMqRim\.rgb/);
    // A flat (unlit) coat has no light to add to: left as it was.
    const flat = new MeshBasicMaterial();
    flat.userData.mqFish = true;
    patchFishRim(flat);
    const f = compile(flat, { uniforms: {}, vertexShader: ShaderLib.basic.vertexShader, fragmentShader: ShaderLib.basic.fragmentShader });
    expect(f.uniforms.uMqRim).toBeUndefined();
  });

  it('gives a geometry the normal of its envelope, once: outward, unit length', () => {
    const g = new BoxGeometry(40, 10, 10, 4, 1, 1);
    expect(addRimNormals(g)).toBe(true);
    expect(addRimNormals(g)).toBe(false);
    const n = g.getAttribute('aMqRimN'), p = g.getAttribute('position');
    for (let i = 0; i < n.count; i++) {
      expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 5);
      // Outward: the same side as the vertex, on every axis.
      for (const [a, b] of [[n.getX(i), p.getX(i)], [n.getY(i), p.getY(i)], [n.getZ(i), p.getZ(i)]] as const) if (Math.abs(b) > 1e-6) expect(Math.sign(a)).toBe(Math.sign(b));
    }
    // A long body's flank faces sideways, not along it: the ellipsoid, not the box's corner.
    const flank = [...Array(n.count).keys()].find((i) => Math.abs(p.getX(i)) < 1e-6 && p.getY(i) > 0)!;
    expect(Math.abs(n.getY(flank))).toBeGreaterThan(Math.abs(n.getX(flank)));
  });

  it('takes the water\'s light, scaled by the amount and dimmed with the house lights', () => {
    setFishRim({ tint: '#ff0000', surface: null, rays: null, house: 1, amount: 1 });
    const full = FISH_RIM.value.x;
    expect(full).toBeGreaterThan(FISH_RIM.value.y);
    setFishRim({ tint: '#ff0000', surface: null, rays: null, house: 0.5, amount: 1 });
    expect(FISH_RIM.value.x).toBeCloseTo(full / 2, 6);
    setFishRim({ tint: '', surface: null, rays: null, house: 1, amount: 0 });
    expect(FISH_RIM.value.toArray()).toEqual([0, 0, 0, 0]);
  });
});
