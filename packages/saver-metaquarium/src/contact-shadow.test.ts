import { describe, expect, it } from 'vitest';
import { Quaternion, ShaderLib, Vector3, type Material } from 'three';
import { ContactShadows, SwimShadows, contactShade, swimShade, swimSpread } from './contact-shadow';
import { METAQUARIUM_PARAMS } from './manifest';
import { PARAM_DOCS } from './guide';

describe('contact shadows', () => {
  it('dark under the body and out to the feet, gone just past them', () => {
    expect(contactShade(0)).toBe(1);
    expect(contactShade(0.4)).toBe(1);
    expect(contactShade(0.75)).toBeGreaterThan(0.3);
    expect(contactShade(1)).toBe(0);
    for (let r = 0; r < 1; r += 0.05) expect(contactShade(r + 0.05)).toBeLessThanOrEqual(contactShade(r));
  });

  it('places one per walker and draws only the ones set', () => {
    const s = new ContactShadows(2);
    expect(s.mesh.count).toBe(0);
    s.set(0, 1, 2, 3, new Quaternion(), 10, 8);
    s.set(5, 0, 0, 0, new Quaternion(), 1, 1); // past capacity: ignored
    s.commit(1);
    expect(s.mesh.count).toBe(1);
    s.commit(9); // clamped to the capacity
    expect(s.mesh.count).toBe(2);
    const at = new Vector3(), m = s.mesh.instanceMatrix.array;
    at.set(m[12]!, m[13]!, m[14]!);
    expect(at.toArray()).toEqual([1, 2, 3]);
    expect(m[0]).toBeCloseTo(10);
    expect(m[10]).toBeCloseTo(8);
    expect((s.mesh.material as Material).userData.mqOwned).toBe(true);
  });
});

describe('swimmer shadows (fishShadows)', () => {
  it('is off by default and documented', () => {
    expect(METAQUARIUM_PARAMS.fishShadows).toMatchObject({ type: 'number', default: 0, min: 0, max: 1, ease: 'smooth' });
    expect(PARAM_DOCS.fishShadows).toMatch(/under the swimmers/);
  });

  it('is dark and small near the sand, wide and faint high up, gone by 110', () => {
    expect(swimShade(0)).toBe(1);
    expect(swimShade(-5)).toBe(1);
    expect(swimShade(55)).toBeCloseTo(0.5, 6);
    expect(swimShade(110)).toBe(0);
    expect(swimShade(200)).toBe(0);
    expect(swimSpread(0)).toBe(1);
    expect(swimSpread(70)).toBe(2);
    expect(swimSpread(-10)).toBe(1);
  });

  it('keeps each shadow\'s own darkness, and one draw for all', () => {
    const s = new SwimShadows(4);
    const q = new Quaternion();
    s.setShaded(0, 1, 0, 2, q, 5, 10, 0.4);
    s.setShaded(1, 3, 0, 4, q, 5, 10, 0.1);
    s.setShaded(9, 3, 0, 4, q, 5, 10, 0.9); // past capacity: ignored
    s.commit(2);
    const shade = s.mesh.geometry.getAttribute('aShade');
    expect([shade.getX(0), shade.getX(1)].map((v) => Math.round(v * 10) / 10)).toEqual([0.4, 0.1]);
    expect(s.mesh.count).toBe(2);
    expect(s.mesh.name).toBe('swim-shadows');
    const m = s.mesh.material as Material;
    const sh = { uniforms: {}, vertexShader: ShaderLib.basic.vertexShader, fragmentShader: ShaderLib.basic.fragmentShader };
    m.onBeforeCompile(sh as never, null as never);
    expect(sh.vertexShader).toMatch(/vMqShade = aShade;/);
    expect(sh.fragmentShader).toMatch(/diffuseColor\.a \*= vMqShade;/);
  });
});
