import { Color, MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial, Mesh, BoxGeometry, Group, type Material } from 'three';
import { describe, expect, it } from 'vitest';
import { FISH_WATER, fishWaterRad, patchFishLight, setFishWater, tagFishMaterials } from './fishlight';
import { METAQUARIUM_PARAMS } from './manifest';
import { PARAM_DOCS } from './guide';

type Shader = Parameters<Material['onBeforeCompile']>[0];
const compile = (m: Material, frag = 'void main(){\n#include <lights_fragment_maps>\n}'): Shader => {
  const s = { uniforms: {}, vertexShader: 'void main(){}', fragmentShader: frag } as unknown as Shader;
  m.onBeforeCompile(s, undefined as never);
  return s;
};
const base = { tint: '', surface: null, rays: null, fog: new Color('#0a3d5c'), floor: new Color('#123c50'), caustics: 0, house: 1, amount: 1 };

describe('fish water light', () => {
  it('tags lit coats and plates, never eyes or glow parts', () => {
    const coat = new MeshLambertMaterial(), plate = new MeshStandardMaterial(), eye = new MeshLambertMaterial(), glow = new MeshStandardMaterial(), flat = new MeshBasicMaterial();
    eye.userData.mqEye = 'pupil'; glow.userData.mqNoCaustic = true;
    const g = new Group();
    for (const m of [coat, plate, eye, glow, flat]) g.add(new Mesh(new BoxGeometry(), m));
    tagFishMaterials(g);
    expect([coat, plate, eye, glow, flat].map((m) => !!m.userData.mqFish)).toEqual([true, true, false, false, false]);
    expect(coat.clone().userData.mqFish).toBe(true);
  });
  it('patches only tagged materials, adds diffuse always and specular only where there is one', () => {
    const coat = new MeshLambertMaterial(); coat.userData.mqFish = true;
    expect(patchFishLight(new MeshLambertMaterial())).toBe(false);
    expect(patchFishLight(coat)).toBe(true);
    expect(patchFishLight(coat)).toBe(false);
    const s = compile(coat);
    expect(s.fragmentShader).toContain('irradiance += mqFishWaterRad(mqN) * uMqFishK.x');
    expect(s.fragmentShader).toMatch(/#if defined\( RE_IndirectSpecular \)\s+vec3 mqV/);
    expect(s.uniforms.uMqFishUp).toBe(FISH_WATER.up);
    // A material without lights (flat fish) is left alone by the patch body.
    const flat = new MeshBasicMaterial(); flat.userData.mqFish = true; patchFishLight(flat);
    expect(compile(flat, 'void main(){}').fragmentShader).toBe('void main(){}');
  });
  it('the field: up from above, side on the level, down from below', () => {
    const up = [1, 0, 0], side = [0, 1, 0], down = [0, 0, 1];
    expect(fishWaterRad(1, up, side, down)).toEqual([1, 0, 0]);
    expect(fishWaterRad(0, up, side, down)).toEqual([0, 1, 0]);
    expect(fishWaterRad(-1, up, side, down)).toEqual([0, 0, 1]);
  });
  it('derives the colours from the scene: the tint wins, then the surface, then the shafts', () => {
    setFishWater({ ...base, tint: '#ff0000', surface: '#00ff00', rays: '#0000ff' });
    expect(FISH_WATER.up.value.x).toBeGreaterThan(FISH_WATER.up.value.y);
    setFishWater({ ...base, surface: '#00ff00', rays: '#0000ff' });
    expect(FISH_WATER.up.value.y).toBeGreaterThan(FISH_WATER.up.value.z);
    setFishWater({ ...base, rays: '#0000ff' });
    expect(FISH_WATER.up.value.z).toBeGreaterThan(FISH_WATER.up.value.x);
  });
  it('dims with the house lights and scales with the amount', () => {
    setFishWater({ ...base, house: 1 });
    const full = FISH_WATER.up.value.length();
    setFishWater({ ...base, house: 0.4 });
    expect(FISH_WATER.up.value.length()).toBeCloseTo(full * 0.4, 6);
    setFishWater({ ...base, amount: 0 });
    expect(FISH_WATER.k.value.x).toBe(0);
    expect(FISH_WATER.k.value.y).toBe(0);
  });
  it('is declared, off by default, and documented', () => {
    expect(METAQUARIUM_PARAMS.fishAmbient).toMatchObject({ type: 'number', default: 0 });
    expect(PARAM_DOCS.fishAmbient).toBeTruthy();
  });
});
